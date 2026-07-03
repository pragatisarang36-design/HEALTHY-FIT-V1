import { supabase } from '@/lib/supabaseClient';
import { compactBaseName, normalizeSearchKey } from '@/services/foodIntelligence';
import { isRawDryState, resolveStatePolicy } from '@/services/statePolicy';
import { profileKcalStatus } from '@/services/nutritionAccuracyRules';

/** @typedef {import('@/types/nutrition').FoodAnalysis} FoodAnalysis */
/** @typedef {import('@/types/nutrition').FoodStateKey} FoodStateKey */
/** @typedef {import('@/types/nutrition').ResolverProfile} ResolverProfile */

const USE_MASTER_DB = String(import.meta.env.VITE_USE_MASTER_NUTRITION_DB || 'true').toLowerCase() !== 'false';

const masterProfileCache = new Map();
const masterServingCache = new Map();
const masterBrandedCache = new Map();
const masterTinyGarnishCache = new Map();

const singularize = (value) => {
  const text = compactBaseName(value);
  if (text.endsWith('ies')) return `${text.slice(0, -3)}y`;
  if (text.endsWith('es')) return text.slice(0, -2);
  if (text.endsWith('s')) return text.slice(0, -1);
  return text;
};

const profileFromMasterResolutionRow = (row) => ({
  aliases: [row.canonical_name],
  category: row.category || '',
  cuisine: row.cuisine || '',
  per: { unit: 'g', amount: 100 },
  calories: Number(row.calories_per_100g) || 0,
  protein: Number(row.protein_per_100g) || 0,
  carbs: Number(row.carbs_per_100g) || 0,
  fats: Number(row.fat_per_100g) || 0,
  fiber: row.fiber_per_100g !== null && row.fiber_per_100g !== undefined ? Number(row.fiber_per_100g) : undefined,
  water: row.water_per_100g !== null && row.water_per_100g !== undefined ? Number(row.water_per_100g) : undefined,
  source: `master:${row.nutrition_source || 'unknown'}`,
  sourceTable: row.sourceTable || 'master_foods',
  foodStateKey: row.state_key,
  masterFoodId: row.food_id,
  masterFoodStateId: row.food_state_id,
  confidence: Number(row.confidence) || 0.75,
});

const profileFromBrandedRow = (row) => ({
  aliases: [row.product_name, row.brand].filter(Boolean),
  category: 'branded_packaged',
  per: { unit: 'g', amount: 100 },
  calories: Number(row.calories_per_100g) || 0,
  protein: Number(row.protein_per_100g) || 0,
  carbs: Number(row.carbs_per_100g) || 0,
  fats: Number(row.fat_per_100g) || 0,
  source: `master_branded:${row.brand || 'unknown'}`,
  sourceTable: 'master_branded_foods',
  masterFoodId: row.food_id || undefined,
  confidence: Number(row.confidence) || 0.75,
});

const profileFromTinyGarnishRow = (row) => ({
  aliases: [row.food_name, ...(row.aliases || [])].filter(Boolean),
  category: 'tiny_garnish',
  per: { unit: 'g', amount: 100 },
  calories: Number(row.calories_per_100g) || 0,
  protein: Number(row.protein_per_100g) || 0,
  carbs: Number(row.carbs_per_100g) || 0,
  fats: Number(row.fat_per_100g) || 0,
  fiber: row.fiber_per_100g !== null && row.fiber_per_100g !== undefined ? Number(row.fiber_per_100g) : undefined,
  grams: {
    serving: Number(row.default_grams) || 3,
    piece: Number(row.default_grams) || 3,
  },
  source: 'master_tiny_garnish_profiles',
  sourceTable: 'master_tiny_garnish_profiles',
  foodStateKey: 'raw',
  confidence: Number(row.confidence) || 0.7,
});

const aliasMatchScore = (row, key) => {
  const search = normalizeSearchKey(row?.search_key || row?.alias || '');
  if (!search) return 99;
  if (search === key) return 0;
  if (singularize(search) === singularize(key)) return 1;
  if (search.startsWith(`${key} `)) return 2;
  if (search.includes(` ${key} `) || search.endsWith(` ${key}`)) return 3;
  return 99;
};

const stateMatchBonus = (row, foodStateKey) => {
  const aliasState = row?.food_state?.state_key || row?.food_state_key || null;
  if (!foodStateKey || foodStateKey === 'unknown') return aliasState ? 1 : 0;
  if (aliasState === foodStateKey) return -3;
  if (stateKeysCompatible(foodStateKey, aliasState)) return -1;
  if (!aliasState) return 0;
  return 2;
};

const contextTextFor = (options = {}) =>
  [
    options.category,
    options.foodType,
    options.context,
    options.cuisine,
    options.stateSource,
  ]
    .filter(Boolean)
    .map((value) => normalizeSearchKey(value))
    .join(' ');

const contextMatchesAlias = (row, options = {}, foodStateKey = 'unknown') => {
  if (!row?.requires_context && row?.lookup_mode !== 'context_required') return true;

  const aliasState = row?.food_state?.state_key || row?.food_state_key || null;
  if (foodStateKey && foodStateKey !== 'unknown' && aliasState && stateKeysCompatible(foodStateKey, aliasState)) {
    return true;
  }

  const contextText = contextTextFor(options);
  const foodCategory = normalizeSearchKey(row?.food?.category || '');
  const foodCuisine = normalizeSearchKey(row?.food?.cuisine || row?.cuisine || '');
  const aliasCuisine = normalizeSearchKey(row?.cuisine || '');

  return Boolean(
    (foodCategory && contextText.includes(foodCategory))
    || (foodCuisine && contextText.includes(foodCuisine))
    || (aliasCuisine && contextText.includes(aliasCuisine))
  );
};

const canUseAliasRow = (row, matchMode, options = {}, foodStateKey = 'unknown') => {
  const aliasStatus = row?.alias_status || 'active';
  const lookupMode = row?.lookup_mode || 'direct';

  if (aliasStatus !== 'active') return false;
  if (matchMode === 'exact' && (lookupMode === 'disabled' || lookupMode === 'fuzzy_only')) return false;
  if (matchMode === 'fuzzy' && lookupMode === 'disabled') return false;
  if ((lookupMode === 'context_required' || row?.requires_context) && !contextMatchesAlias(row, options, foodStateKey)) return false;

  return true;
};

const RAW_STATE_KEYS = new Set(['raw', 'dry', 'uncooked']);
const COOKED_STATE_KEYS = new Set(['cooked', 'boiled', 'steamed']);
const FRIED_STATE_KEYS = new Set(['fried', 'deep_fried', 'shallow_fried']);
const DRY_HEAT_STATE_KEYS = new Set(['grilled', 'roasted', 'baked']);

const stateKeysCompatible = (requestedStateKey, candidateStateKey) => {
  if (!requestedStateKey || requestedStateKey === 'unknown' || !candidateStateKey) return true;
  if (requestedStateKey === candidateStateKey) return true;
  if (RAW_STATE_KEYS.has(requestedStateKey)) return RAW_STATE_KEYS.has(candidateStateKey);
  if (COOKED_STATE_KEYS.has(requestedStateKey)) return COOKED_STATE_KEYS.has(candidateStateKey);
  if (FRIED_STATE_KEYS.has(requestedStateKey)) return FRIED_STATE_KEYS.has(candidateStateKey);
  if (DRY_HEAT_STATE_KEYS.has(requestedStateKey)) return DRY_HEAT_STATE_KEYS.has(candidateStateKey) || COOKED_STATE_KEYS.has(candidateStateKey);
  if (requestedStateKey === 'canned') return candidateStateKey === 'canned' || COOKED_STATE_KEYS.has(candidateStateKey);
  if (requestedStateKey === 'soaked') return candidateStateKey === 'soaked' || RAW_STATE_KEYS.has(candidateStateKey);
  if (requestedStateKey === 'sprouted') return candidateStateKey === 'sprouted' || RAW_STATE_KEYS.has(candidateStateKey);
  return false;
};

const compatibleStateKeysFor = (foodStateKey) => {
  if (!foodStateKey || foodStateKey === 'unknown') return ['unknown', 'cooked', 'boiled'];
  if (RAW_STATE_KEYS.has(foodStateKey)) return [foodStateKey, ...RAW_STATE_KEYS];
  if (COOKED_STATE_KEYS.has(foodStateKey)) return [foodStateKey, ...COOKED_STATE_KEYS];
  if (FRIED_STATE_KEYS.has(foodStateKey)) return [foodStateKey, ...FRIED_STATE_KEYS];
  if (DRY_HEAT_STATE_KEYS.has(foodStateKey)) return [foodStateKey, ...DRY_HEAT_STATE_KEYS, ...COOKED_STATE_KEYS];
  if (foodStateKey === 'canned') return ['canned', 'cooked', 'boiled'];
  if (foodStateKey === 'soaked') return ['soaked', 'raw', 'dry', 'uncooked'];
  if (foodStateKey === 'sprouted') return ['sprouted', 'raw', 'dry', 'uncooked'];
  return [foodStateKey];
};

const withStatePolicyFlag = (profile, policy, reason) => profile ? ({
  ...profile,
  confidence: Number((Number(profile.confidence || 0.75) * 0.45).toFixed(3)),
  statePolicyWarning: reason,
  statePolicy: policy,
}) : null;

const withNutritionAccuracyFlag = (profile, policy, status) => profile ? ({
  ...profile,
  confidence: Number((Number(profile.confidence || 0.75) * 0.55).toFixed(3)),
  nutritionAccuracyWarning: status?.reason || 'category_kcal_density_outlier',
  statePolicy: policy,
}) : null;

const chooseBestAliasRow = (rows, key, foodStateKey, options = {}, matchMode = 'exact') =>
  (rows || [])
    .filter((row) => canUseAliasRow(row, matchMode, options, foodStateKey))
    .filter((row) => {
      const aliasState = row?.food_state?.state_key || row?.food_state_key || null;
      return !foodStateKey || foodStateKey === 'unknown' || !aliasState || stateKeysCompatible(foodStateKey, aliasState);
    })
    .map((row) => ({
      row,
      score: aliasMatchScore(row, key) + stateMatchBonus(row, foodStateKey),
    }))
    .filter((entry) => entry.score < 99)
    .sort((a, b) => a.score - b.score || normalizeSearchKey(a.row.search_key).length - normalizeSearchKey(b.row.search_key).length)[0]?.row || null;

const ALIAS_SELECT_WITH_POLICY = `
  alias,
  search_key,
  food_state_id,
  food_id,
  confidence,
  alias_status,
  lookup_mode,
  requires_context,
  risk_level,
  cuisine,
  food:master_foods(id, canonical_name, search_key, default_state_key, category, cuisine),
  food_state:master_food_states(id, state_key, state_name, is_default)
`;

const ALIAS_SELECT_LEGACY = `
  alias,
  search_key,
  food_state_id,
  food_id,
  confidence,
  cuisine,
  food:master_foods(id, canonical_name, search_key, default_state_key, category, cuisine),
  food_state:master_food_states(id, state_key, state_name, is_default)
`;

const queryAliasRows = async ({ key, fuzzy = false }) => {
  const buildQuery = (selectColumns) => {
    let query = supabase
      .from('master_food_aliases')
      .select(selectColumns);

    query = fuzzy
      ? query.ilike('search_key', `%${key}%`)
      : query.eq('search_key', key);

    return query.limit(25);
  };

  let result = await buildQuery(ALIAS_SELECT_WITH_POLICY);
  if (result.error && /alias_status|lookup_mode|requires_context|risk_level/i.test(String(result.error.message || ''))) {
    result = await buildQuery(ALIAS_SELECT_LEGACY);
  }
  return result;
};

const masterServingSizesFor = async (foodId, foodStateId, searchKey) => {
  const cacheKey = `${foodId}:${foodStateId || 'none'}:${searchKey}`;
  if (masterServingCache.has(cacheKey)) return masterServingCache.get(cacheKey);

  try {
    let query = supabase
      .from('master_serving_sizes')
      .select('serving_key, serving_name, grams, ml, priority, confidence')
      .eq('food_id', foodId)
      .order('priority', { ascending: true });

    if (foodStateId) {
      query = query.or(`food_state_id.eq.${foodStateId},food_state_id.is.null`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const grams = {};
    const liquid = {};
    for (const row of data || []) {
      const unit = String(row.serving_key || '').toLowerCase();
      if (!unit) continue;
      if (row.grams !== null && row.grams !== undefined && grams[unit] === undefined) {
        grams[unit] = Number(row.grams);
      }
      if (row.ml !== null && row.ml !== undefined && liquid[unit] === undefined) {
        liquid[unit] = Number(row.ml);
      }
    }

    const result = { grams, liquid };
    masterServingCache.set(cacheKey, result);
    return result;
  } catch (error) {
    if (!String(error?.message || '').includes('master_serving_sizes')) {
      console.warn('Master serving size lookup skipped:', error?.message || error);
    }
    masterServingCache.set(cacheKey, {});
    return {};
  }
};

const withMasterServingSizes = async (profile, foodId, foodStateId, searchKey) => {
  const sizes = await masterServingSizesFor(foodId, foodStateId, searchKey);
  const grams = sizes?.grams || {};
  if (Object.keys(grams).length === 0) return profile;

  return {
    ...profile,
    grams: { ...(profile.grams || {}), ...grams },
    liquid: sizes.liquid && Object.keys(sizes.liquid).length > 0 ? sizes.liquid : profile.liquid,
  };
};

const masterResolutionProfileFor = async (foodId, foodStateKey, statePolicy = {}) => {
  const effectiveStateKey = statePolicy.effectiveStateKey || foodStateKey;
  const stateKeys = [...new Set(compatibleStateKeysFor(effectiveStateKey))];

  // DEV-ONLY LOGGING: Phase 1 audit
  if (import.meta.env.DEV) {
    console.log('[RESOLVER AUDIT] masterResolutionProfileFor called', {
      foodId,
      requestedStateKey: foodStateKey,
      effectiveStateKey,
      statePolicy,
      stateKeysToTry: stateKeys,
    });
  }

  const { data, error } = await supabase
    .from('master_food_resolution_view')
    .select('*')
    .eq('food_id', foodId)
    .limit(25);

  if (error) throw error;

  const rows = data || [];
  const compatibleRows = rows
    .map((row) => ({
      row,
      score: stateKeys.indexOf(row.state_key),
      kcalStatus: profileKcalStatus(profileFromMasterResolutionRow(row), {
        category: row.category,
        context: statePolicy.context,
        statePolicy,
      }),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => {
      const aFail = a.kcalStatus.status === 'fail' ? 1 : 0;
      const bFail = b.kcalStatus.status === 'fail' ? 1 : 0;
      const aWarn = a.kcalStatus.status === 'warn' ? 1 : 0;
      const bWarn = b.kcalStatus.status === 'warn' ? 1 : 0;
      return aFail - bFail || aWarn - bWarn || a.score - b.score;
    });

  if (compatibleRows[0]?.row) {
    const bestCompatible = compatibleRows[0];
    const row = bestCompatible.row;
    const profile = profileFromMasterResolutionRow(row);
      // DEV-ONLY LOGGING: Phase 1 audit
      if (import.meta.env.DEV) {
        console.log('[RESOLVER AUDIT] Profile found for state_key', {
          requestedStateKey: foodStateKey,
          effectiveStateKey,
          compatibleStateKeys: stateKeys,
          foundStateKey: row.state_key,
          profile: {
            calories: profile.calories,
            protein: profile.protein,
            carbs: profile.carbs,
            fats: profile.fats,
            foodStateKey: profile.foodStateKey,
            source: profile.source,
            sourceTable: profile.sourceTable,
          },
        });
      }
      if (bestCompatible.kcalStatus.status === 'fail') {
        return withNutritionAccuracyFlag(profile, statePolicy, bestCompatible.kcalStatus);
      }
      return profile;
  }

  const rawOnlyFallback = rows
    .filter((row) => isRawDryState(row.state_key))
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0];

  if (rawOnlyFallback && statePolicy.blockRawDry) {
    const profile = withStatePolicyFlag(
      profileFromMasterResolutionRow(rawOnlyFallback),
      statePolicy,
      'only_raw_dry_profile_available_for_prepared_context'
    );
    if (import.meta.env.DEV) {
      console.log('[RESOLVER AUDIT] Raw/dry fallback flagged low confidence', {
        foodId,
        requestedStateKey: foodStateKey,
        effectiveStateKey,
        fallbackStateKey: rawOnlyFallback.state_key,
        statePolicy,
      });
    }
    return profile;
  }

  // DEV-ONLY LOGGING: Phase 1 audit
  if (import.meta.env.DEV) {
    console.log('[RESOLVER AUDIT] No state-compatible profile found', {
      foodId,
      requestedStateKey: foodStateKey,
      effectiveStateKey,
      statePolicy,
      compatibleStateKeys: stateKeys,
      availableStateKeys: (data || []).map((row) => row.state_key),
    });
  }

  return null;
};

const masterAliasLookup = async (name, options = {}) => {
  const searchKey = normalizeSearchKey(name);
  const baseKey = compactBaseName(name);
  const keys = [...new Set([searchKey, baseKey].filter(Boolean))];
  const foodStateKey = options.foodStateKey || 'unknown';
  const basePolicy = options.statePolicy || resolveStatePolicy({
    input: name,
    requestedStateKey: foodStateKey,
    stateSource: options.stateSource,
    foodType: options.foodType,
    category: options.category,
    context: options.context,
  });
  const effectiveStateKey = basePolicy.effectiveStateKey || foodStateKey;

  // DEV-ONLY LOGGING: Phase 1 audit
  if (import.meta.env.DEV) {
    console.log('[RESOLVER AUDIT] masterAliasLookup called', {
      input: name,
      searchKey,
      baseKey,
      keysToTry: keys,
      foodStateKey,
      effectiveStateKey,
      statePolicy: basePolicy,
    });
  }

  for (const key of keys) {
    const { data, error } = await queryAliasRows({ key });

    if (error) throw error;

    const best = chooseBestAliasRow(data, key, effectiveStateKey, {
      ...options,
      category: options.category,
      foodType: options.foodType,
      context: options.context,
    }, 'exact');
    if (best?.food_id) {
      const resolvedStateKey = best.food_state?.state_key || effectiveStateKey;
      if (basePolicy.blockRawDry && isRawDryState(resolvedStateKey)) continue;
      const rowPolicy = resolveStatePolicy({
        input: name,
        requestedStateKey: resolvedStateKey,
        stateSource: options.stateSource,
        foodType: options.foodType,
        category: best.food?.category || options.category,
        context: options.context,
      });
      // DEV-ONLY LOGGING: Phase 1 audit
      if (import.meta.env.DEV) {
        console.log('[RESOLVER AUDIT] Alias match found', {
          matchedKey: key,
          alias: best.alias,
          foodId: best.food_id,
          foodCanonical: best.food?.canonical_name,
          aliasStateKey: best.food_state?.state_key,
          resolvedStateKey,
          statePolicy: rowPolicy,
          confidence: best.confidence,
        });
      }
      const profile = await masterResolutionProfileFor(best.food_id, rowPolicy.effectiveStateKey, rowPolicy);
      if (profile) {
        return withMasterServingSizes({
          ...profile,
          aliases: [best.food?.canonical_name, best.alias, ...(profile.aliases || [])].filter(Boolean),
          sourceTable: 'master_food_aliases',
        }, best.food_id, profile.masterFoodStateId, key);
      }
    }
  }

  if (options.allowFuzzy === false) return null;

  const fuzzyKey = baseKey || searchKey;
  if (!fuzzyKey) return null;

  // DEV-ONLY LOGGING: Phase 1 audit
  if (import.meta.env.DEV) {
    console.log('[RESOLVER AUDIT] Trying fuzzy alias lookup', { fuzzyKey });
  }

  const { data, error } = await queryAliasRows({ key: fuzzyKey, fuzzy: true });

  if (error) throw error;

  const best = chooseBestAliasRow(data, fuzzyKey, effectiveStateKey, {
    ...options,
    category: options.category,
    foodType: options.foodType,
    context: options.context,
  }, 'fuzzy');
  if (!best?.food_id) return null;

  const resolvedStateKey = best.food_state?.state_key || effectiveStateKey;
  if (basePolicy.blockRawDry && isRawDryState(resolvedStateKey)) return null;
  const rowPolicy = resolveStatePolicy({
    input: name,
    requestedStateKey: resolvedStateKey,
    stateSource: options.stateSource,
    foodType: options.foodType,
    category: best.food?.category || options.category,
    context: options.context,
  });
  // DEV-ONLY LOGGING: Phase 1 audit
  if (import.meta.env.DEV) {
    console.log('[RESOLVER AUDIT] Fuzzy alias match found', {
      fuzzyKey,
      alias: best.alias,
      foodId: best.food_id,
      foodCanonical: best.food?.canonical_name,
      aliasStateKey: best.food_state?.state_key,
      resolvedStateKey,
      statePolicy: rowPolicy,
    });
  }
  const profile = await masterResolutionProfileFor(best.food_id, rowPolicy.effectiveStateKey, rowPolicy);
  if (!profile) return null;

  return withMasterServingSizes({
    ...profile,
    aliases: [best.food?.canonical_name, best.alias, ...(profile.aliases || [])].filter(Boolean),
    sourceTable: 'master_food_aliases',
  }, best.food_id, profile.masterFoodStateId, fuzzyKey);
};

const chooseBestFoodRow = (rows, key, foodStateKey) =>
  (rows || [])
    .map((row) => {
      const rowKey = normalizeSearchKey(row.search_key || row.canonical_name || '');
      const defaultState = row.default_state_key || null;
      let score = 99;
      if (rowKey === key) score = 0;
      else if (singularize(rowKey) === singularize(key)) score = 1;
      else if (rowKey.includes(key) && key.split(' ').length >= 2) score = 10;
      else if (key.includes(rowKey) && rowKey.split(' ').length >= 2) score = 11;
      if (foodStateKey && foodStateKey !== 'unknown' && defaultState === foodStateKey) score -= 2;
      return { row, score };
    })
    .filter((entry) => entry.score < 99)
    .sort((a, b) => a.score - b.score || normalizeSearchKey(a.row.search_key).length - normalizeSearchKey(b.row.search_key).length)[0]?.row || null;

const masterFoodLookup = async (name, options = {}) => {
  const searchKey = normalizeSearchKey(name);
  const baseKey = compactBaseName(name);
  const keys = [...new Set([searchKey, baseKey].filter(Boolean))];
  const foodStateKey = options.foodStateKey || 'unknown';
  const basePolicy = options.statePolicy || resolveStatePolicy({
    input: name,
    requestedStateKey: foodStateKey,
    stateSource: options.stateSource,
    foodType: options.foodType,
    category: options.category,
    context: options.context,
  });
  const effectiveStateKey = basePolicy.effectiveStateKey || foodStateKey;

  // DEV-ONLY LOGGING: Phase 1 audit
  if (import.meta.env.DEV) {
    console.log('[RESOLVER AUDIT] masterFoodLookup called', {
      input: name,
      searchKey,
      baseKey,
      keysToTry: keys,
      foodStateKey,
      effectiveStateKey,
      statePolicy: basePolicy,
    });
  }

  for (const key of keys) {
    const { data, error } = await supabase
      .from('master_foods')
      .select('id, canonical_name, search_key, default_state_key, category, cuisine, confidence')
      .eq('active', true)
      .eq('search_key', key)
      .limit(10);

    if (error) throw error;

    const best = chooseBestFoodRow(data, key, effectiveStateKey);
    if (best?.id) {
      const rowPolicy = resolveStatePolicy({
        input: name,
        requestedStateKey: effectiveStateKey || best.default_state_key,
        stateSource: options.stateSource,
        foodType: options.foodType,
        category: best.category || options.category,
        context: options.context,
      });
      // DEV-ONLY LOGGING: Phase 1 audit
      if (import.meta.env.DEV) {
        console.log('[RESOLVER AUDIT] Food match found', {
          matchedKey: key,
          foodId: best.id,
          canonicalName: best.canonical_name,
          defaultStateKey: best.default_state_key,
          requestedStateKey: foodStateKey,
          resolvedStateKey: rowPolicy.effectiveStateKey || best.default_state_key,
          statePolicy: rowPolicy,
        });
      }
      const profile = await masterResolutionProfileFor(best.id, rowPolicy.effectiveStateKey || best.default_state_key, rowPolicy);
      if (profile) {
        return withMasterServingSizes({
          ...profile,
          aliases: [best.canonical_name, ...(profile.aliases || [])].filter(Boolean),
          category: best.category || profile.category,
          cuisine: best.cuisine || profile.cuisine,
          sourceTable: 'master_foods',
        }, best.id, profile.masterFoodStateId, key);
      }
    }
  }

  if (options.allowFuzzy === false) return null;

  const fuzzyKey = baseKey || searchKey;
  if (!fuzzyKey) return null;

  // DEV-ONLY LOGGING: Phase 1 audit
  if (import.meta.env.DEV) {
    console.log('[RESOLVER AUDIT] Trying fuzzy food lookup', { fuzzyKey });
  }

  const { data, error } = await supabase
    .from('master_foods')
    .select('id, canonical_name, search_key, default_state_key, category, cuisine, confidence')
    .eq('active', true)
    .ilike('search_key', `%${fuzzyKey}%`)
    .limit(10);

  if (error) throw error;

  const best = chooseBestFoodRow(data, fuzzyKey, effectiveStateKey);
  if (!best?.id) return null;

  const rowPolicy = resolveStatePolicy({
    input: name,
    requestedStateKey: effectiveStateKey || best.default_state_key,
    stateSource: options.stateSource,
    foodType: options.foodType,
    category: best.category || options.category,
    context: options.context,
  });

  // DEV-ONLY LOGGING: Phase 1 audit
  if (import.meta.env.DEV) {
    console.log('[RESOLVER AUDIT] Fuzzy food match found', {
      fuzzyKey,
      foodId: best.id,
      canonicalName: best.canonical_name,
      defaultStateKey: best.default_state_key,
      requestedStateKey: foodStateKey,
      resolvedStateKey: rowPolicy.effectiveStateKey || best.default_state_key,
      statePolicy: rowPolicy,
    });
  }

  const profile = await masterResolutionProfileFor(best.id, rowPolicy.effectiveStateKey || best.default_state_key, rowPolicy);
  if (!profile) return null;

  return withMasterServingSizes({
    ...profile,
    aliases: [best.canonical_name, ...(profile.aliases || [])].filter(Boolean),
    category: best.category || profile.category,
    cuisine: best.cuisine || profile.cuisine,
    sourceTable: 'master_foods',
  }, best.id, profile.masterFoodStateId, fuzzyKey);
};

export const masterBrandedProfileFor = async (name) => {
  const key = compactBaseName(name);
  if (!key || !USE_MASTER_DB) return null;
  if (masterBrandedCache.has(key)) return masterBrandedCache.get(key);

  try {
    const { data, error } = await supabase
      .from('master_branded_foods')
      .select('*')
      .or(`product_name.ilike.%${key}%,brand.ilike.%${key}%`)
      .limit(10);

    if (error) throw error;

    const best = (data || [])
      .map((row) => ({
        row,
        score: normalizeSearchKey(row.product_name).includes(key) ? 0 : 1,
      }))
      .sort((a, b) => a.score - b.score || normalizeSearchKey(a.row.product_name).length - normalizeSearchKey(b.row.product_name).length)[0]?.row;

    const profile = best ? profileFromBrandedRow(best) : null;
    masterBrandedCache.set(key, profile);
    return profile;
  } catch (error) {
    if (!String(error?.message || '').includes('master_branded_foods')) {
      console.warn('Master branded lookup skipped:', error?.message || error);
    }
    masterBrandedCache.set(key, null);
    return null;
  }
};

export const masterTinyGarnishProfileFor = async (name) => {
  const searchKey = normalizeSearchKey(name);
  const baseKey = compactBaseName(name);
  const keys = [...new Set([searchKey, baseKey].filter(Boolean))];
  const cacheKey = keys.join('|');
  if (!cacheKey || !USE_MASTER_DB) return null;
  if (masterTinyGarnishCache.has(cacheKey)) return masterTinyGarnishCache.get(cacheKey);

  try {
    for (const key of keys) {
      const { data, error } = await supabase
        .from('master_tiny_garnish_profiles')
        .select('*')
        .eq('search_key', key)
        .limit(1);

      if (error) throw error;
      if (data?.[0]) {
        const profile = profileFromTinyGarnishRow(data[0]);
        masterTinyGarnishCache.set(cacheKey, profile);
        return profile;
      }
    }

    for (const key of keys) {
      const { data, error } = await supabase
        .from('master_tiny_garnish_profiles')
        .select('*')
        .contains('aliases', [key])
        .limit(1);

      if (error) throw error;
      if (data?.[0]) {
        const profile = profileFromTinyGarnishRow(data[0]);
        masterTinyGarnishCache.set(cacheKey, profile);
        return profile;
      }
    }

    masterTinyGarnishCache.set(cacheKey, null);
    return null;
  } catch (error) {
    if (!String(error?.message || '').includes('master_tiny_garnish_profiles')) {
      console.warn('Master tiny garnish lookup skipped:', error?.message || error);
    }
    masterTinyGarnishCache.set(cacheKey, null);
    return null;
  }
};

/**
 * Resolve a food name against the master nutrition database.
 * @param {string} name
 * @param {FoodAnalysis | { foodStateKey?: FoodStateKey, foodType?: string, type?: string }} [analysis]
 * @param {{ allowFuzzy?: boolean }} [options]
 * @returns {Promise<ResolverProfile | null>}
 */
export const masterProfileFor = async (name, analysis = {}, options = {}) => {
  if (!USE_MASTER_DB) return null;

  const searchKey = normalizeSearchKey(name);
  const baseKey = compactBaseName(name);
  const foodStateKey = analysis.foodStateKey || 'unknown';
  const foodType = analysis.foodType || analysis.type || 'unknown';
  const statePolicy = resolveStatePolicy({
    input: name,
    requestedStateKey: foodStateKey,
    stateSource: analysis.stateSource,
    foodType,
    category: analysis.category,
    context: options.context || analysis.context || 'manual_meal_entry',
  });
  const effectiveStateKey = statePolicy.effectiveStateKey || foodStateKey;
  const cacheKey = `${searchKey}|${baseKey}|${effectiveStateKey}|${options.context || 'manual_meal_entry'}|${options.allowFuzzy === false ? 'exact' : 'fuzzy'}`;

  // DEV-ONLY LOGGING: Phase 1 audit - entry point
  if (import.meta.env.DEV) {
    console.log('[RESOLVER AUDIT] masterProfileFor ENTRY', {
      input: name,
      searchKey,
      baseKey,
      foodStateKey,
      effectiveStateKey,
      foodType,
      statePolicy,
      analysis,
      allowFuzzy: options.allowFuzzy !== false,
    });
  }

  if (masterProfileCache.has(cacheKey)) {
    const cached = masterProfileCache.get(cacheKey);
    if (import.meta.env.DEV) {
      console.log('[RESOLVER AUDIT] Cache hit', { cacheKey, cached });
    }
    return cached;
  }

  try {
    if (foodType === 'branded_packaged') {
      const branded = await masterBrandedProfileFor(name);
      if (branded) {
        masterProfileCache.set(cacheKey, branded);
        if (import.meta.env.DEV) {
          console.log('[RESOLVER AUDIT] Branded profile selected', {
            profile: {
              calories: branded.calories,
              protein: branded.protein,
              carbs: branded.carbs,
              fats: branded.fats,
              source: branded.source,
              sourceTable: branded.sourceTable,
            },
          });
        }
        return branded;
      }
    }

    const aliasProfile = await masterAliasLookup(name, {
      foodStateKey: effectiveStateKey,
      statePolicy,
      stateSource: analysis.stateSource,
      foodType,
      category: analysis.category,
      context: options.context || analysis.context || 'manual_meal_entry',
      allowFuzzy: options.allowFuzzy !== false,
    });
    if (aliasProfile) {
      masterProfileCache.set(cacheKey, aliasProfile);
      if (import.meta.env.DEV) {
        console.log('[RESOLVER AUDIT] Alias profile selected', {
          profile: {
            calories: aliasProfile.calories,
            protein: aliasProfile.protein,
            carbs: aliasProfile.carbs,
            fats: aliasProfile.fats,
            foodStateKey: aliasProfile.foodStateKey,
            source: aliasProfile.source,
            sourceTable: aliasProfile.sourceTable,
            masterFoodId: aliasProfile.masterFoodId,
            masterFoodStateId: aliasProfile.masterFoodStateId,
          },
        });
      }
      return aliasProfile;
    }

    const profile = await masterFoodLookup(name, {
      foodStateKey: effectiveStateKey,
      statePolicy,
      stateSource: analysis.stateSource,
      foodType,
      category: analysis.category,
      context: options.context || analysis.context || 'manual_meal_entry',
      allowFuzzy: options.allowFuzzy !== false,
    });
    masterProfileCache.set(cacheKey, profile);
    if (import.meta.env.DEV) {
      if (profile) {
        console.log('[RESOLVER AUDIT] Food profile selected', {
          profile: {
            calories: profile.calories,
            protein: profile.protein,
            carbs: profile.carbs,
            fats: profile.fats,
            foodStateKey: profile.foodStateKey,
            source: profile.source,
            sourceTable: profile.sourceTable,
            masterFoodId: profile.masterFoodId,
            masterFoodStateId: profile.masterFoodStateId,
          },
        });
      } else {
        console.log('[RESOLVER AUDIT] No profile found', { input: name });
      }
    }
    return profile;
  } catch (error) {
    if (!String(error?.message || '').includes('master_food')) {
      console.warn('Master nutrition lookup skipped:', error?.message || error);
    }
    masterProfileCache.set(cacheKey, null);
    return null;
  }
};

export const isMasterNutritionEnabled = () => USE_MASTER_DB;

export const clearMasterResolverCache = () => {
  masterProfileCache.clear();
  masterServingCache.clear();
  masterBrandedCache.clear();
  masterTinyGarnishCache.clear();
};
