import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parseCsv, parseJsonDataset, parseXlsxDataset, writeCsv } from './lib/csv.mjs';
import { MergeStore } from './lib/merge.mjs';
import { buildRecordFromRow } from './lib/adapters/generic.mjs';
import { loadUsdaRecords } from './lib/adapters/usda.mjs';
import { loadIfctFromCsvContent, loadIfctRecords } from './lib/adapters/ifct.mjs';
import { loadOffRecords } from './lib/adapters/off.mjs';
import { loadFnddsRecords } from './lib/adapters/fndds.mjs';
import { loadDatasetRegistry, listEnabledDatasets } from './lib/registry.mjs';
import { buildFoodIntelligenceRules, buildTinyGarnishProfiles } from './lib/intelligence-generator.mjs';
import { resolveFromDataRoot, toDataRelative } from './lib/paths.mjs';

const stableId = (prefix, value) => {
  const hex = createHash('md5').update(`${prefix}:${value}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const matchesPattern = (fileName, pattern) => {
  const escaped = String(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(fileName);
};

const isExcluded = (fileName, excludePatterns = []) =>
  excludePatterns.some((pattern) => matchesPattern(fileName, pattern));

const loadAliasCleanupPlan = () => {
  const planPath = resolveFromDataRoot('reports', 'production_readiness', 'ambiguous_alias_cleanup_plan.csv');
  if (!existsSync(planPath)) return new Map();

  return new Map(parseCsv(readFileSync(planPath, 'utf8')).map((row) => [row.alias_search_key, row]));
};

const aliasMetadataFor = (searchKey, cleanupPlan) => {
  const plan = cleanupPlan.get(searchKey);
  if (!plan) {
    return {
      alias_status: 'active',
      lookup_mode: 'direct',
      requires_context: false,
      risk_level: 'safe',
    };
  }

  if (plan.suggested_action === 'remove from direct alias lookup') {
    return {
      alias_status: 'inactive',
      lookup_mode: 'disabled',
      requires_context: true,
      risk_level: plan.risk || 'dangerous',
    };
  }

  if (plan.suggested_action === 'convert to fuzzy-only') {
    return {
      alias_status: 'active',
      lookup_mode: 'fuzzy_only',
      requires_context: false,
      risk_level: plan.risk || 'medium',
    };
  }

  if (plan.suggested_action === 'require category/state context' || plan.suggested_action === 'map only when paired with cuisine/category') {
    return {
      alias_status: 'active',
      lookup_mode: 'context_required',
      requires_context: true,
      risk_level: plan.risk || 'medium',
    };
  }

  return {
    alias_status: 'active',
    lookup_mode: 'direct',
    requires_context: false,
    risk_level: plan.risk || 'safe',
  };
};

const collectGenericFiles = (rawDir, registry) => {
  const files = new Map();
  const enabled = listEnabledDatasets(registry);

  for (const config of enabled) {
    if (config.adapter !== 'generic') continue;
    const pattern = config.inputPattern;
    if (!pattern) continue;

    for (const file of readdirSync(rawDir)) {
      if (!['.csv', '.json', '.xlsx'].includes(extname(file).toLowerCase())) continue;
      if (isExcluded(file, config.excludePatterns)) continue;
      if (!matchesPattern(file, pattern)) continue;
      if (!files.has(file)) {
        files.set(file, config);
      }
    }
  }

  return files;
};

const ingestGenericFile = (filePath, config, store) => {
  const fileName = basename(filePath);
  const extension = extname(filePath).toLowerCase();
  const content = readFileSync(filePath);
  const rows = extension === '.json'
    ? parseJsonDataset(content)
    : extension === '.xlsx'
      ? parseXlsxDataset(content)
      : parseCsv(content.toString('utf8'));
  const sourceOverride = config.sourceKey
    ? { sourceKey: config.sourceKey, sourceName: config.sourceName }
    : null;

  rows.forEach((row, index) => {
    store.stats.rows_processed += 1;
    try {
      const record = buildRecordFromRow(row, {
        fileName,
        rowNumber: index + 2,
        sourceOverride,
      });
      if (record.isBranded) {
        store.addBrandedRecord(record);
      } else {
        store.addGenericRecord(record);
      }
    } catch (error) {
      store.addFailure(fileName, index + 2, error.message, row);
    }
  });
};

const ingestAdapterDataset = async (config, store) => {
  if (config.adapter === 'usda') {
    const records = await loadUsdaRecords(config.inputPath, config.options || {});
    records.forEach((record) => {
      store.stats.rows_processed += 1;
      store.addGenericRecord(record);
    });
    return records.length;
  }

  if (config.adapter === 'ifct') {
    const records = config.inputPath && existsSync(config.inputPath)
      ? loadIfctFromCsvContent(readFileSync(config.inputPath, 'utf8'))
      : await loadIfctRecords(config.sourceUrl);
    records.forEach((record) => {
      store.stats.rows_processed += 1;
      store.addGenericRecord(record);
    });
    return records.length;
  }

  if (config.adapter === 'off') {
    const records = await loadOffRecords(config.inputPath, config.options || {});
    records.forEach((record) => {
      store.stats.rows_processed += 1;
      store.addBrandedRecord(record);
    });
    return records.length;
  }

  if (config.adapter === 'fndds') {
    const records = loadFnddsRecords(config.inputPath, config.options || {});
    records.forEach((record) => {
      store.stats.rows_processed += 1;
      store.addGenericRecord(record);
    });
    return records.length;
  }

  return 0;
};

const buildMasterOutputs = (store) => {
  const foods = [...store.foodsByKey.values()].sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
  const foodIdByMergeKey = new Map();
  const stateIdByMergeKey = new Map();
  const aliasCleanupPlan = loadAliasCleanupPlan();

  const masterFoods = [];
  const masterFoodStates = [];
  const masterFoodProfiles = [];
  const defaultStateByFood = new Map();

  foods.forEach((food, index) => {
    const foodId = stableId('food', food.canonicalKey);
    foodIdByMergeKey.set(food.mergeKey, foodId);

    if (!defaultStateByFood.has(food.canonicalKey)) {
      defaultStateByFood.set(food.canonicalKey, food.stateKey);
    }

    const existingFood = masterFoods.find((item) => item.id === foodId);
    if (!existingFood) {
      masterFoods.push({
        id: foodId,
        canonical_name: food.canonicalName,
        search_key: food.searchKey,
        category: food.category,
        cuisine: food.cuisine,
        default_state_key: food.stateKey,
        confidence: food.confidence,
      });
    }

    const stateId = stableId('state', food.mergeKey);
    stateIdByMergeKey.set(food.mergeKey, stateId);
    masterFoodStates.push({
      id: stateId,
      food_id: foodId,
      state_key: food.stateKey,
      state_name: food.stateName,
      is_default: food.stateKey === defaultStateByFood.get(food.canonicalKey),
    });

    masterFoodProfiles.push({
      id: stableId('profile', food.mergeKey),
      food_id: foodId,
      food_state_id: stateId,
      calories_per_100g: Number(food.calories_per_100g.toFixed(2)),
      protein_per_100g: Number(food.protein_per_100g.toFixed(2)),
      carbs_per_100g: Number(food.carbs_per_100g.toFixed(2)),
      fat_per_100g: Number(food.fat_per_100g.toFixed(2)),
      fiber_per_100g: food.fiber_per_100g === null || food.fiber_per_100g === undefined ? '' : Number(food.fiber_per_100g.toFixed(2)),
      water_per_100g: food.water_per_100g === null || food.water_per_100g === undefined ? '' : Number(food.water_per_100g.toFixed(2)),
      nutrition_source_key: food.sourceKey,
      confidence: food.confidence,
      selected: true,
    });
  });

  masterFoods.forEach((food) => {
    food.default_state_key = defaultStateByFood.get(food.search_key) || food.default_state_key;
  });

  const masterAliases = store.aliases.map((alias) => {
    const mergeKeyValue = `${alias.canonical_name.toLowerCase()}|${alias.state_key}`;
    const foodRecord = foods.find(
      (food) => food.canonicalName === alias.canonical_name && food.stateKey === alias.state_key,
    );
    if (!foodRecord) return null;
    const foodId = foodIdByMergeKey.get(foodRecord.mergeKey);
    const stateId = foodRecord ? stateIdByMergeKey.get(foodRecord.mergeKey) : '';
    const aliasMetadata = aliasMetadataFor(alias.search_key, aliasCleanupPlan);
    return {
      id: stableId('alias', `${foodId}|${alias.search_key}|${alias.state_key}`),
      food_id: foodId,
      food_state_id: stateId,
      alias: alias.alias,
      search_key: alias.search_key,
      language: alias.language,
      region: alias.region,
      cuisine: alias.cuisine,
      source_key: alias.source_key,
      confidence: 0.8,
      ...aliasMetadata,
    };
  }).filter(Boolean);

  const masterServings = store.servingSizes.map((serving) => {
    const foodRecord = foods.find(
      (food) => food.canonicalName === serving.canonical_name && food.stateKey === serving.state_key,
    );
    if (!foodRecord) return null;
    const foodId = foodIdByMergeKey.get(foodRecord.mergeKey);
    const stateId = foodRecord ? stateIdByMergeKey.get(foodRecord.mergeKey) : '';
    return {
      id: stableId('serving', `${foodId}|${serving.state_key}|${serving.serving_key}`),
      food_id: foodId,
      food_state_id: stateId,
      serving_name: serving.serving_name,
      serving_key: serving.serving_key,
      grams: serving.grams,
      source_key: serving.source_key,
      priority: 50,
      confidence: 0.8,
    };
  }).filter(Boolean);

  const masterBrandedFoods = [...store.brandedByKey.values()].map((record) => ({
    id: stableId('branded', record.barcode || record.externalId),
    brand: record.brand,
    product_name: record.productName,
    barcode: record.barcode,
    serving_size: record.servingName || '',
    calories_per_100g: Number(record.calories_per_100g.toFixed(2)),
    protein_per_100g: Number(record.protein_per_100g.toFixed(2)),
    carbs_per_100g: Number(record.carbs_per_100g.toFixed(2)),
    fat_per_100g: Number(record.fat_per_100g.toFixed(2)),
    fiber_per_100g: record.fiber_per_100g === null || record.fiber_per_100g === undefined ? '' : Number(record.fiber_per_100g.toFixed(2)),
    source_key: record.sourceKey,
    external_id: record.externalId,
    confidence: record.confidence,
  }));

  const masterRecipeTemplates = store.recipeTemplates.map((template) => ({
    id: stableId('recipe', template.canonical_name.toLowerCase()),
    canonical_food_id: stableId('food', template.canonical_name.toLowerCase()),
    canonical_name: template.canonical_name,
    search_key: template.canonical_name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
    cuisine: template.cuisine,
    default_serving_grams: template.default_serving_grams,
    source_key: template.source_key,
    confidence: template.confidence,
    recipe_count: 1,
  }));

  const masterRecipeItems = store.recipeTemplateItems.map((item) => ({
    id: stableId('recipe-item', `${item.recipe_template}|${item.sort_order}|${item.ingredient_food}`),
    recipe_template_id: stableId('recipe', item.recipe_template.toLowerCase()),
    ingredient_name: item.ingredient_food,
    ingredient_search_key: item.ingredient_food.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
    percentage: item.percentage,
    min_percentage: item.min_percentage,
    max_percentage: item.max_percentage,
    sort_order: item.sort_order,
    source_key: 'recipe_derived',
  }));

  const masterSourceLinks = store.sourceLinks.map((link) => {
    let food_id = '';
    let food_state_id = '';
    let recipe_template_id = '';
    let branded_food_id = '';

    if (link.target_type === 'branded') {
      branded_food_id = stableId('branded', link.external_id);
    } else if (link.target_type === 'recipe') {
      recipe_template_id = stableId('recipe', link.canonical_name.toLowerCase());
    } else {
      const foodRecord = foods.find(
        (food) => food.canonicalName === link.canonical_name && food.stateKey === link.state_key,
      );
      food_id = foodRecord
        ? foodIdByMergeKey.get(foodRecord.mergeKey)
        : stableId('food', link.canonical_name.toLowerCase());
      food_state_id = foodRecord ? stateIdByMergeKey.get(foodRecord.mergeKey) : '';
    }

    return {
      id: stableId('source-link', `${link.target_type}|${link.source_key}|${link.external_id}`),
      target_type: link.target_type,
      food_id,
      food_state_id,
      recipe_template_id,
      branded_food_id,
      source_key: link.source_key,
      external_id: link.external_id,
      external_name: link.external_name,
      raw_record: link.raw_record,
    };
  });

  const foodIntelligenceRules = buildFoodIntelligenceRules({
    foods: masterFoods,
    foodStates: masterFoodStates,
    brandedFoods: masterBrandedFoods,
    recipeTemplates: masterRecipeTemplates,
  });

  const tinyGarnishProfiles = buildTinyGarnishProfiles({
    foods: masterFoods,
    profiles: masterFoodProfiles,
    aliases: masterAliases,
    recipeItems: masterRecipeItems,
  });

  return {
    masterFoods,
    masterFoodStates,
    masterFoodProfiles,
    masterAliases,
    masterServings,
    masterBrandedFoods,
    masterRecipeTemplates,
    masterRecipeItems,
    masterSourceLinks,
    foodIntelligenceRules,
    tinyGarnishProfiles,
  };
};

export const runMasterEtl = async (options = {}) => {
  const registry = options.registry || loadDatasetRegistry(options.registryPath);
  const rawDir = resolveFromDataRoot(options.rawDir || registry.defaults.rawDir);
  const processedDir = resolveFromDataRoot(options.processedDir || registry.defaults.processedDir);
  const logDir = resolveFromDataRoot(options.logDir || registry.defaults.logDir);

  mkdirSync(rawDir, { recursive: true });
  mkdirSync(processedDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  const store = new MergeStore();
  const batchMeta = {
    id: stableId('batch', new Date().toISOString()),
    started_at: new Date().toISOString(),
    datasets: [],
  };

  const genericFiles = collectGenericFiles(rawDir, registry);
  for (const [fileName, config] of genericFiles) {
    ingestGenericFile(join(rawDir, fileName), config, store);
    batchMeta.datasets.push({ key: config.key || fileName, adapter: 'generic', file: fileName });
  }

  for (const config of listEnabledDatasets(registry)) {
    if (config.adapter === 'generic') continue;
    if (config.inputPath) config.inputPath = resolveFromDataRoot(config.inputPath);
    if (config.inputPath && !existsSync(config.inputPath)) continue;
    const count = await ingestAdapterDataset(config, store);
    if (count > 0) {
      batchMeta.datasets.push({ key: config.key, adapter: config.adapter, rows: count });
    }
  }

  store.finalizeStats();
  const outputs = buildMasterOutputs(store);

  writeCsv(join(processedDir, 'master_foods.csv'), outputs.masterFoods, [
    'id', 'canonical_name', 'search_key', 'category', 'cuisine', 'default_state_key', 'confidence',
  ], writeFileSync);
  writeCsv(join(processedDir, 'master_food_states.csv'), outputs.masterFoodStates, [
    'id', 'food_id', 'state_key', 'state_name', 'is_default',
  ], writeFileSync);
  writeCsv(join(processedDir, 'master_food_profiles.csv'), outputs.masterFoodProfiles, [
    'id', 'food_id', 'food_state_id', 'calories_per_100g', 'protein_per_100g', 'carbs_per_100g',
    'fat_per_100g', 'fiber_per_100g', 'water_per_100g', 'nutrition_source_key', 'confidence', 'selected',
  ], writeFileSync);
  writeCsv(join(processedDir, 'master_food_aliases.csv'), outputs.masterAliases, [
    'id', 'food_id', 'food_state_id', 'alias', 'search_key', 'language', 'region', 'cuisine', 'source_key', 'confidence',
    'alias_status', 'lookup_mode', 'requires_context', 'risk_level',
  ], writeFileSync);
  writeCsv(join(processedDir, 'master_serving_sizes.csv'), outputs.masterServings, [
    'id', 'food_id', 'food_state_id', 'serving_name', 'serving_key', 'grams', 'source_key', 'priority', 'confidence',
  ], writeFileSync);
  writeCsv(join(processedDir, 'master_branded_foods.csv'), outputs.masterBrandedFoods, [
    'id', 'brand', 'product_name', 'barcode', 'serving_size', 'calories_per_100g', 'protein_per_100g',
    'carbs_per_100g', 'fat_per_100g', 'fiber_per_100g', 'source_key', 'external_id', 'confidence',
  ], writeFileSync);
  writeCsv(join(processedDir, 'master_recipe_templates.csv'), outputs.masterRecipeTemplates, [
    'id', 'canonical_food_id', 'canonical_name', 'search_key', 'cuisine', 'default_serving_grams', 'source_key', 'confidence', 'recipe_count',
  ], writeFileSync);
  writeCsv(join(processedDir, 'master_recipe_template_items.csv'), outputs.masterRecipeItems, [
    'id', 'recipe_template_id', 'ingredient_name', 'ingredient_search_key', 'percentage', 'min_percentage', 'max_percentage', 'sort_order', 'source_key',
  ], writeFileSync);
  writeCsv(join(processedDir, 'master_food_source_links.csv'), outputs.masterSourceLinks, [
    'id', 'target_type', 'food_id', 'food_state_id', 'recipe_template_id', 'branded_food_id',
    'source_key', 'external_id', 'external_name', 'raw_record',
  ], writeFileSync);
  writeCsv(join(processedDir, 'food_intelligence_rules.csv'), outputs.foodIntelligenceRules, [
    'search_key', 'food_type', 'food_state_key', 'confidence', 'rules',
  ], writeFileSync);
  writeCsv(join(processedDir, 'tiny_garnish_profiles.csv'), outputs.tinyGarnishProfiles, [
    'food_name', 'search_key', 'aliases', 'default_grams', 'calories_per_100g', 'protein_per_100g',
    'carbs_per_100g', 'fat_per_100g', 'fiber_per_100g', 'source_key', 'confidence',
  ], writeFileSync);
  writeCleanTableOutputs(processedDir, outputs, store, writeFileSync);

  writeCsv(join(logDir, 'conflicts.csv'), store.conflicts, [
    'canonical_name', 'state_key', 'source_a', 'source_b', 'source_a_key', 'source_b_key', 'difference', 'selected_source', 'reason',
  ], writeFileSync);
  writeCsv(join(logDir, 'failed_rows.csv'), store.failedRows, ['file', 'row', 'reason', 'raw'], writeFileSync);

  const summary = {
    ...store.stats,
    batch_id: batchMeta.id,
    finished_at: new Date().toISOString(),
    datasets: batchMeta.datasets,
    output_dir: toDataRelative(processedDir),
    log_dir: toDataRelative(logDir),
  };

  writeFileSync(join(logDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeFileSync(join(processedDir, 'import_batch.json'), `${JSON.stringify({ ...batchMeta, ...store.stats, finished_at: summary.finished_at }, null, 2)}\n`, 'utf8');

  return summary;
};

const sourceRowsFromStore = (store) => {
  const rows = new Map();
  const add = (sourceKey, sourceName, sourceType = 'nutrition', priority = 100) => {
    if (!sourceKey || rows.has(sourceKey)) return;
    rows.set(sourceKey, {
      source_key: sourceKey,
      source_name: sourceName || sourceKey,
      source_type: sourceType,
      priority,
    });
  };

  for (const food of store.foodsByKey.values()) {
    add(food.sourceKey, food.sourceName, 'nutrition', 100);
  }
  for (const branded of store.brandedByKey.values()) {
    add(branded.sourceKey, branded.sourceName, 'branded_food', 100);
  }
  for (const template of store.recipeTemplates) {
    add(template.source_key, template.source_key, 'recipe', 100);
  }

  return [...rows.values()].sort((a, b) => a.source_key.localeCompare(b.source_key));
};

const writeCleanTableOutputs = (processedDir, outputs, store, writeFileSync) => {
  writeCsv(join(processedDir, 'food_sources.csv'), sourceRowsFromStore(store), [
    'source_key', 'source_name', 'source_type', 'priority',
  ], writeFileSync);
  writeCsv(join(processedDir, 'foods.csv'), outputs.masterFoods, [
    'id', 'canonical_name', 'search_key', 'category', 'cuisine', 'default_state_key', 'confidence',
  ], writeFileSync);
  writeCsv(join(processedDir, 'food_states.csv'), outputs.masterFoodStates, [
    'id', 'food_id', 'state_key', 'state_name', 'is_default',
  ], writeFileSync);
  writeCsv(join(processedDir, 'food_profiles.csv'), outputs.masterFoodProfiles, [
    'id', 'food_id', 'food_state_id', 'calories_per_100g', 'protein_per_100g', 'carbs_per_100g',
    'fat_per_100g', 'fiber_per_100g', 'water_per_100g', 'nutrition_source_key', 'confidence', 'selected',
  ], writeFileSync);
  writeCsv(join(processedDir, 'food_aliases.csv'), outputs.masterAliases, [
    'id', 'food_id', 'food_state_id', 'alias', 'search_key', 'language', 'region', 'cuisine', 'source_key', 'confidence',
    'alias_status', 'lookup_mode', 'requires_context', 'risk_level',
  ], writeFileSync);
  writeCsv(join(processedDir, 'serving_sizes.csv'), outputs.masterServings, [
    'id', 'food_id', 'food_state_id', 'serving_name', 'serving_key', 'grams', 'source_key', 'priority', 'confidence',
  ], writeFileSync);
  writeCsv(join(processedDir, 'recipe_templates.csv'), outputs.masterRecipeTemplates, [
    'id', 'canonical_food_id', 'canonical_name', 'search_key', 'cuisine', 'default_serving_grams', 'source_key', 'confidence', 'recipe_count',
  ], writeFileSync);
  writeCsv(join(processedDir, 'recipe_template_items.csv'), outputs.masterRecipeItems, [
    'id', 'recipe_template_id', 'ingredient_name', 'ingredient_search_key', 'percentage', 'min_percentage', 'max_percentage', 'sort_order', 'source_key',
  ], writeFileSync);
  writeCsv(join(processedDir, 'import_conflicts.csv'), store.conflicts, [
    'canonical_name', 'state_key', 'source_a', 'source_b', 'source_a_key', 'source_b_key', 'difference', 'selected_source', 'reason',
  ], writeFileSync);
  writeCsv(join(processedDir, 'unresolved_foods.csv'), store.failedRows, [
    'file', 'row', 'reason', 'raw',
  ], writeFileSync);
};
