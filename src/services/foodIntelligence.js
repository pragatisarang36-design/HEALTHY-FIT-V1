import { supabase } from '@/lib/supabaseClient';

/** @typedef {import('@/types/nutrition').FoodType} FoodType */
/** @typedef {import('@/types/nutrition').FoodStateKey} FoodStateKey */
/** @typedef {import('@/types/nutrition').FoodAnalysis} FoodAnalysis */
/** @typedef {import('@/types/nutrition').FoodClassificationResult} FoodClassificationResult */

export const FOOD_TYPES = Object.freeze([
  'simple_ingredient',
  'tiny_garnish',
  'spice',
  'cooked_side',
  'mixed_recipe',
  'branded_packaged',
  'beverage',
  'dessert',
  'unknown',
]);

export const FOOD_STATE_KEYS = Object.freeze([
  'raw',
  'uncooked',
  'cooked',
  'boiled',
  'grilled',
  'fried',
  'deep_fried',
  'shallow_fried',
  'roasted',
  'steamed',
  'smoked',
  'canned',
  'frozen',
  'soaked',
  'sprouted',
  'dry',
  'mashed',
  'baked',
  'unknown',
]);

export const FOOD_STATE_LABELS = Object.freeze({
  raw: 'Raw',
  uncooked: 'Uncooked',
  cooked: 'Cooked',
  boiled: 'Boiled',
  grilled: 'Grilled',
  fried: 'Fried',
  deep_fried: 'Deep Fried',
  shallow_fried: 'Shallow Fried',
  roasted: 'Roasted',
  steamed: 'Steamed',
  smoked: 'Smoked',
  canned: 'Canned',
  frozen: 'Frozen',
  soaked: 'Soaked',
  sprouted: 'Sprouted',
  dry: 'Dry',
  mashed: 'Mashed',
  baked: 'Baked',
  unknown: 'Unknown',
});

const STOP_WORDS = /\b(soft|hard|of|with|and|in|on|the|a|an|shredded|sliced|diced|chopped|pieces?|kernels?|freshly|homemade|style)\b/g;

const PREPARATION_STATE_PATTERNS = [
  { key: 'uncooked', pattern: /\b(uncooked)\b/ },
  { key: 'raw', pattern: /\b(raw)\b/ },
  { key: 'dry', pattern: /\b(dry|dried|dehydrated)\b/ },
  { key: 'soaked', pattern: /\b(soaked|soak)\b/ },
  { key: 'sprouted', pattern: /\b(sprouted|sprout)\b/ },
  { key: 'canned', pattern: /\b(canned|tinned|tin can)\b/ },
  { key: 'frozen', pattern: /\b(frozen|freeze[- ]dried)\b/ },
  { key: 'smoked', pattern: /\b(smoked|smoke[- ]cured)\b/ },
  { key: 'mashed', pattern: /\b(mashed|pureed|puree|mash)\b/ },
  { key: 'baked', pattern: /\b(baked|bake)\b/ },
  { key: 'grilled', pattern: /\b(grilled|barbecue|bbq|barbeque|tandoori|char[- ]grilled)\b/ },
  { key: 'deep_fried', pattern: /\b(deep[- ]fried)\b/ },
  { key: 'shallow_fried', pattern: /\b(shallow[- ]fried|pan[- ]fried|stir[- ]fried|stir fry|saute|sauteed|saut.ed)\b/ },
  { key: 'fried', pattern: /\b(fried|deep[- ]fried|pan[- ]fried|stir[- ]fried|stir fry|saute|sauteed|sautéed|fry)\b/ },
  { key: 'roasted', pattern: /\b(roasted|roast)\b/ },
  { key: 'steamed', pattern: /\b(steamed|steam)\b/ },
  { key: 'boiled', pattern: /\b(boiled|boile|poached|simmered|pressure cooked)\b/ },
  { key: 'cooked', pattern: /\b(cooked|prepared)\b/ },
];

const STATE_STRIP_WORDS = /\b(raw|uncooked|dry|dried|dehydrated|soaked|soak|sprouted|sprout|canned|tinned|frozen|smoked|mashed|pureed|puree|baked|bake|grilled|barbecue|bbq|barbeque|tandoori|fried|deep fried|shallow fried|pan fried|stir fried|stir fry|saute|sauteed|roasted|roast|steamed|steam|boiled|boile|poached|simmered|cooked|prepared|shredded|sliced|diced|chopped|pieces?|kernels?)\b/g;

const TINY_GARNISH_PATTERN = /\b(lime|lemon|chili|chilli|coriander|cilantro|mint|curry leaves?|ginger|garlic|garnish|wedge)\b/;
const SPICE_PATTERN = /\b(spice|spices|masala powder|garam masala|turmeric|cumin|coriander powder|chilli powder|red chili powder|mustard seeds|fenugreek|cardamom|clove|cloves|bay leaf|peppercorn|hing|asafoetida|herbs?)\b/;
const BEVERAGE_PATTERN = /\b(water|juice|tea|coffee|milk|soda|drink|beverage|smoothie|lassi|shake|buttermilk|chaas|nimbu pani|sharbat|sherbet)\b/;
const DESSERT_PATTERN = /\b(cake|ice cream|kheer|payasam|halwa|jalebi|gulab jamun|rasgulla|laddu|ladoo|dessert|sweet|mithai|barfi|burfi|kulfi|rabri|sheera|kaju katli)\b/;
const BRANDED_PATTERN = /\b(brand|branded|cadbury|nestle|daawat|amul|britannia|haldiram|mtr|pepsi|coke|coca cola|maggi|kellogg|quaker|simple mills|pack|packet|barcode|bar code|bottle|can)\b/;
const RESTAURANT_PATTERN = /\b(restaurant|takeaway|take away|delivery|zomato|swiggy|ubereats|uber eats|dining out|hotel food|cloud kitchen)\b/;
const MIXED_RECIPE_PATTERN = /\b(curry|biryani|pulao|pulav|fried rice|jeera rice|lemon rice|curd rice|tomato rice|coconut rice|tamarind rice|poha|upma|khichdi|sambar|rasam|chole|rajma|pasta|noodles?|lasagna|mac (and )?cheese|sandwich|wrap|shawarma|burger|toast|bread butter|smoothie bowl|pizza|tadka|masala|gravy|sabzi|korma|tikka masala|handi|handi curry|thali|combo meal|meal platter|breakfast platter|combo|platter|soup|stew|broth|butter chicken|palak paneer|shahi paneer|dal fry|pav bhaji|vada pav|samosa|kachori|momos|pani puri|bhel puri)\b/;
const COOKED_SIDE_PATTERN = /\b(dal|rice|bhindi|okra|sabzi|salad|eggplant|brinjal|raita|curd rice|lemon rice|chapati|roti|idli|dosa|paratha|naan|puri|bhatura|khichdi|samosa|pakora|bhajiya)\b/;
const FRUIT_PATTERN = /\b(banana|orange|apple|mango|grape|berries|strawberr|blueberr|raspberr|blackberr|kiwi|apricot|peach|pear|plum|pineapple|papaya|pomegranate|watermelon|melon|lychee|guava|cherry|fruit)\b/;
const VEGETABLE_PATTERN = /\b(spinach|broccoli|cucumber|carrot|tomato|onion|potato|aloo|bhindi|okra|lady finger|cauliflower|gobi|cabbage|beans|peas|pepper|capsicum|zucchini|eggplant|brinjal|beetroot|radish|turnip|lettuce|arugula|rocket|vegetable|veggie|veggies)\b/;

const DEFAULT_STATE_BY_FOOD_TYPE = Object.freeze({
  beverage: 'cooked',
  tiny_garnish: 'raw',
  spice: 'dry',
  simple_ingredient: 'cooked',
  cooked_side: 'cooked',
  mixed_recipe: 'cooked',
  dessert: 'cooked',
  branded_packaged: 'unknown',
  unknown: 'unknown',
});

const DEFAULT_STATE_BY_BASE_FOOD = Object.freeze([
  { pattern: /\b(rice|chawal|basmati|pasta|noodle|quinoa|couscous|oats|oatmeal|poha|flattened rice)\b/, state: 'cooked' },
  { pattern: /\b(chicken|mutton|lamb|fish|salmon|shrimp|shrimps|prawn|prawns|paneer|tofu|egg|eggs|meat|beef|pork)\b/, state: 'cooked' },
  { pattern: /\b(chickpea|chickpeas|chana|rajma|kidney bean|kidney beans|lentil|lentils|dal|moong|toor|urad|legume|legumes|bean|beans)\b/, state: 'cooked' },
  { pattern: /\b(potato|aloo|sweet potato)\b/, state: 'boiled' },
  { pattern: /\b(bread|toast|chapati|roti|naan|dosa|idli)\b/, state: 'cooked' },
  { pattern: /\b(fruit|banana|apple|orange|mango|berry|grape)\b/, state: 'raw' },
  { pattern: /\b(spinach|salad|cucumber|tomato|onion|carrot|lettuce|vegetable)\b/, state: 'raw' },
]);

const LOCAL_CLASSIFICATION_RULES = Object.freeze([
  { searchKey: 'chicken biryani', foodType: 'mixed_recipe', foodStateKey: 'cooked' },
  { searchKey: 'veg biryani', foodType: 'mixed_recipe', foodStateKey: 'cooked' },
  { searchKey: 'chicken curry', foodType: 'mixed_recipe', foodStateKey: 'cooked' },
  { searchKey: 'paneer butter masala', foodType: 'mixed_recipe', foodStateKey: 'cooked' },
  { searchKey: 'dal tadka', foodType: 'mixed_recipe', foodStateKey: 'cooked' },
  { searchKey: 'bhindi sabzi', foodType: 'cooked_side', foodStateKey: 'fried' },
  { searchKey: 'okra fry', foodType: 'cooked_side', foodStateKey: 'fried' },
  { searchKey: 'boiled egg', foodType: 'simple_ingredient', foodStateKey: 'boiled' },
  { searchKey: 'fried egg', foodType: 'simple_ingredient', foodStateKey: 'fried' },
  { searchKey: 'grilled chicken', foodType: 'simple_ingredient', foodStateKey: 'grilled' },
  { searchKey: 'roasted chicken', foodType: 'simple_ingredient', foodStateKey: 'roasted' },
  { searchKey: 'steamed rice', foodType: 'cooked_side', foodStateKey: 'steamed' },
  { searchKey: 'raw rice', foodType: 'simple_ingredient', foodStateKey: 'dry' },
  { searchKey: 'cooked rice', foodType: 'cooked_side', foodStateKey: 'cooked' },
  { searchKey: 'masala', foodType: 'spice', foodStateKey: 'dry' },
  { searchKey: 'ghee', foodType: 'simple_ingredient', foodStateKey: 'cooked' },
  { searchKey: 'oil', foodType: 'simple_ingredient', foodStateKey: 'raw' },
]);

const classificationCache = new Map();

const mixedRecipeRuleMatches = (searchKey, baseKey, ruleKey) =>
  searchKey === ruleKey ||
  baseKey === ruleKey ||
  (searchKey.includes(ruleKey) && ruleKey.split(' ').length >= 2);

export const normalizeSearchKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const compactBaseName = (name) =>
  normalizeSearchKey(name)
    .replace(STATE_STRIP_WORDS, ' ')
    .replace(STOP_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const parseFoodStateInput = (name, foodType = 'unknown') => {
  const input = String(name || '').trim();
  const searchKey = normalizeSearchKey(input);
  const baseFood = compactBaseName(input);
  const state = detectFoodState(input, foodType);

  return {
    input,
    searchKey,
    baseFood,
    state,
  };
};

export const detectFoodState = (name, foodType = 'unknown') => {
  const text = normalizeSearchKey(name);
  if (!text) {
    // DEV-ONLY LOGGING: Phase 1 audit
    if (import.meta.env.DEV) {
      console.log('[RESOLVER AUDIT] detectFoodState - empty input', { name, foodType });
    }
    return {
      foodStateKey: 'unknown',
      foodStateName: FOOD_STATE_LABELS.unknown,
      stateConfidence: 0,
      stateSource: 'fallback',
    };
  }

  for (const entry of PREPARATION_STATE_PATTERNS) {
    if (entry.pattern.test(text)) {
      const result = {
        foodStateKey: entry.key,
        foodStateName: FOOD_STATE_LABELS[entry.key] || entry.key,
        stateConfidence: 0.92,
        stateSource: 'name_pattern',
      };
      // DEV-ONLY LOGGING: Phase 1 audit
      if (import.meta.env.DEV) {
        console.log('[RESOLVER AUDIT] detectFoodState - pattern match', {
          input: name,
          text,
          matchedPattern: entry.key,
          result,
        });
      }
      return result;
    }
  }

  const baseKey = compactBaseName(name);
  for (const entry of DEFAULT_STATE_BY_BASE_FOOD) {
    if (entry.pattern.test(baseKey) || entry.pattern.test(text)) {
      const result = {
        foodStateKey: entry.state,
        foodStateName: FOOD_STATE_LABELS[entry.state] || entry.state,
        stateConfidence: 0.72,
        stateSource: 'category_default',
      };
      // DEV-ONLY LOGGING: Phase 1 audit
      if (import.meta.env.DEV) {
        console.log('[RESOLVER AUDIT] detectFoodState - base food default', {
          input: name,
          baseKey,
          matchedPattern: entry.state,
          result,
        });
      }
      return result;
    }
  }

  const fallbackState = DEFAULT_STATE_BY_FOOD_TYPE[foodType] || 'unknown';
  const result = {
    foodStateKey: fallbackState,
    foodStateName: FOOD_STATE_LABELS[fallbackState] || fallbackState,
    stateConfidence: fallbackState === 'unknown' ? 0.35 : 0.55,
    stateSource: fallbackState === 'unknown' ? 'fallback' : 'category_default',
  };
  // DEV-ONLY LOGGING: Phase 1 audit
  if (import.meta.env.DEV) {
    console.log('[RESOLVER AUDIT] detectFoodState - fallback', {
      input: name,
      foodType,
      fallbackState,
      result,
    });
  }
  return result;
};

const classifyFoodTypeHeuristic = (name) => {
  const text = normalizeSearchKey(name);
  if (!text) return { foodType: 'unknown', canonicalName: '', confidence: 0 };

  if (RESTAURANT_PATTERN.test(text)) return { foodType: 'unknown', canonicalName: text, confidence: 0.82 };
  if (BRANDED_PATTERN.test(text)) return { foodType: 'branded_packaged', canonicalName: text, confidence: 0.84 };
  if (TINY_GARNISH_PATTERN.test(text)) return { foodType: 'tiny_garnish', canonicalName: text, confidence: 0.88 };
  if (SPICE_PATTERN.test(text)) return { foodType: 'spice', canonicalName: text, confidence: 0.86 };
  if (BEVERAGE_PATTERN.test(text)) return { foodType: 'beverage', canonicalName: text, confidence: 0.84 };
  if (DESSERT_PATTERN.test(text)) return { foodType: 'dessert', canonicalName: text, confidence: 0.84 };
  if (MIXED_RECIPE_PATTERN.test(text)) return { foodType: 'mixed_recipe', canonicalName: text, confidence: 0.8 };
  if (FRUIT_PATTERN.test(text)) return { foodType: 'simple_ingredient', canonicalName: text, confidence: 0.82 };
  if (VEGETABLE_PATTERN.test(text)) return { foodType: 'simple_ingredient', canonicalName: text, confidence: 0.8 };
  if (COOKED_SIDE_PATTERN.test(text)) return { foodType: 'cooked_side', canonicalName: text, confidence: 0.78 };

  return { foodType: 'simple_ingredient', canonicalName: text, confidence: 0.6 };
};

const localClassificationRuleFor = (name) => {
  const searchKey = normalizeSearchKey(name);
  const baseKey = compactBaseName(name);
  return LOCAL_CLASSIFICATION_RULES.find((rule) =>
    rule.foodType === 'mixed_recipe'
      ? mixedRecipeRuleMatches(searchKey, baseKey, rule.searchKey)
      : searchKey === rule.searchKey || baseKey === rule.searchKey
  ) || null;
};

export const lookupDbClassification = async (name) => {
  const searchKey = normalizeSearchKey(name);
  const baseKey = compactBaseName(name);
  const cacheKey = `${searchKey}|${baseKey}`;
  if (classificationCache.has(cacheKey)) return classificationCache.get(cacheKey);

  const keys = [...new Set([searchKey, baseKey].filter(Boolean))];
  let row = null;

  try {
    for (const key of keys) {
      const { data, error } = await supabase
        .from('master_food_classifications')
        .select('search_key, food_type, food_state_key, canonical_food_id, confidence, rules')
        .eq('search_key', key)
        .limit(1);

      if (error) throw error;
      if (data?.[0]) {
        row = data[0];
        break;
      }
    }

    if (!row) {
      const fuzzyKey = baseKey || searchKey;
      if (fuzzyKey && fuzzyKey.split(' ').length >= 2) {
        const { data, error } = await supabase
          .from('master_food_classifications')
          .select('search_key, food_type, food_state_key, canonical_food_id, confidence, rules')
          .ilike('search_key', `%${fuzzyKey}%`)
          .limit(5);

        if (error) throw error;
        row = (data || []).sort((a, b) => a.search_key.length - b.search_key.length)[0] || null;
      }
    }
  } catch (error) {
    if (!String(error?.message || '').includes('master_food_classifications')) {
      console.warn('Classification DB lookup skipped:', error?.message || error);
    }
    classificationCache.set(cacheKey, null);
    return null;
  }

  classificationCache.set(cacheKey, row);
  return row;
};

/**
 * Synchronous food analysis using heuristics and local rules.
 * @param {string} name
 * @returns {FoodAnalysis}
 */
export const analyzeFoodSync = (name) => {
  const detectedName = String(name || '').trim();
  const searchKey = normalizeSearchKey(detectedName);
  const baseSearchKey = compactBaseName(detectedName);

  const localRule = localClassificationRuleFor(detectedName);
  const heuristic = classifyFoodTypeHeuristic(detectedName);

  const foodType = localRule?.foodType || heuristic.foodType;
  const state = localRule?.foodStateKey
    ? {
        foodStateKey: localRule.foodStateKey,
        foodStateName: FOOD_STATE_LABELS[localRule.foodStateKey] || localRule.foodStateKey,
        stateConfidence: 0.9,
        stateSource: 'db_rule',
      }
    : detectFoodState(detectedName, foodType);

  return {
    detectedName,
    searchKey,
    baseSearchKey,
    foodType,
    foodStateKey: state.foodStateKey,
    foodStateName: state.foodStateName,
    stateConfidence: state.stateConfidence,
    stateSource: state.stateSource,
    canonicalName: baseSearchKey || searchKey,
    classificationSource: localRule ? 'db_rule' : 'heuristic',
    classificationConfidence: localRule ? 0.9 : heuristic.confidence,
  };
};

/**
 * Full food analysis with optional DB-backed classification rules.
 * @param {string} name
 * @returns {Promise<FoodAnalysis>}
 */
export const analyzeFood = async (name) => {
  const syncAnalysis = analyzeFoodSync(name);
  const dbRule = await lookupDbClassification(name);

  if (!dbRule) return syncAnalysis;

  const hasExplicitState = syncAnalysis.stateSource === 'name_pattern';
  const stateKey = hasExplicitState ? syncAnalysis.foodStateKey : dbRule.food_state_key || syncAnalysis.foodStateKey;
  const canonicalName = normalizeSearchKey(
    dbRule.rules?.canonical ||
    dbRule.rules?.template ||
    dbRule.rules?.tiny_profile ||
    syncAnalysis.canonicalName
  );

  return {
    ...syncAnalysis,
    foodType: dbRule.food_type || syncAnalysis.foodType,
    foodStateKey: stateKey,
    foodStateName: FOOD_STATE_LABELS[stateKey] || stateKey,
    canonicalName,
    stateConfidence: Math.max(syncAnalysis.stateConfidence, Number(dbRule.confidence) || 0.75),
    stateSource: hasExplicitState ? syncAnalysis.stateSource : dbRule.food_state_key ? 'db_rule' : syncAnalysis.stateSource,
    classificationSource: 'db',
    classificationConfidence: Number(dbRule.confidence) || 0.75,
  };
};

/**
 * Backward-compatible classifier used by the nutrition engine.
 * @param {string} name
 * @param {{ template?: Record<string, unknown> | null }} [options]
 * @returns {FoodClassificationResult}
 */
export const classifyFood = (name, options = {}) => {
  const analysis = analyzeFoodSync(name);
  const template = options.template || null;

  if (template) {
    return {
      ...analysis,
      type: 'mixed_recipe',
      canonicalName: template.name || template.canonical_name || analysis.canonicalName,
      template,
    };
  }

  if (analysis.foodType === 'mixed_recipe') {
    return {
      ...analysis,
      type: 'mixed_recipe',
      canonicalName: analysis.canonicalName,
      template: null,
    };
  }

  return {
    ...analysis,
    type: analysis.foodType,
    template: null,
  };
};

export const buildResolutionFormula = (profile, grams) => {
  if (profile?.per?.unit === 'g' && profile?.per?.amount === 100 && grams) {
    return 'per100g * grams / 100';
  }
  if (grams) {
    return `per100g * ${grams}g / 100`;
  }
  return `profile ${profile?.per?.amount || 1} ${profile?.per?.unit || 'serving'} * quantityFactor`;
};
