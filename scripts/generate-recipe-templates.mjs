import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { parseCsv, writeCsv } from './etl/lib/csv.mjs';
import { IngredientResolver } from './etl/lib/ingredient-resolver.mjs';
import { parseRecipeFile } from './etl/lib/recipe-formats.mjs';
import { RecipeTemplateGenerator } from './etl/lib/recipe-generator.mjs';
import { searchKey } from './etl/lib/normalize.mjs';
import { resolveFromDataRoot, toDataRelative } from './etl/lib/paths.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, 'etl', 'recipe-registry.json');

const loadRegistry = () => JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));

const loadFoodCatalog = (filePath) => {
  const catalog = new Map();
  if (!existsSync(filePath)) return catalog;

  for (const row of parseCsv(readFileSync(filePath, 'utf8'))) {
    const key = row.search_key || searchKey(row.canonical_name);
    catalog.set(key, { id: row.id, canonicalName: row.canonical_name, searchKey: key });
  }
  return catalog;
};

const matchesPattern = (fileName, pattern) => {
  const regex = new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`, 'i');
  return regex.test(fileName);
};

const isExcluded = (fileName, excludePatterns = []) =>
  excludePatterns.some((pattern) => matchesPattern(fileName, pattern));

const collectRecipeFiles = (dir) => {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRecipeFiles(entryPath));
    } else if (['.csv', '.json', '.xlsx'].includes(extname(entry.name).toLowerCase())) {
      files.push({ fileName: entry.name, filePath: entryPath });
    }
  }
  return files;
};

const mergeCsvRows = (filePath, newRows, keyField) => {
  const rows = new Map();
  if (existsSync(filePath)) {
    for (const row of parseCsv(readFileSync(filePath, 'utf8'))) {
      if (row[keyField]) rows.set(row[keyField], row);
    }
  }
  for (const row of newRows) {
    if (row[keyField]) rows.set(row[keyField], row);
  }
  return [...rows.values()].sort((a, b) => String(a[keyField]).localeCompare(String(b[keyField])));
};

const buildRecipeIntelligenceRules = (templates) =>
  templates.map((template) => ({
    search_key: template.search_key,
    food_type: 'mixed_recipe',
    food_state_key: 'cooked',
    confidence: template.confidence || 0.7,
    rules: JSON.stringify({
      generated_from: 'recipe_dataset',
      canonical: template.search_key,
      route: 'recipe_template',
      recipe_count: Number(template.recipe_count) || 1,
    }),
  }));

const buildRecipeSourceRows = (registry, templates) => {
  const keys = new Set(templates.map((template) => template.source_key || 'recipe_derived'));
  keys.add('recipe_derived');

  return [...keys].sort().map((sourceKey) => {
    const source = registry.sourceKeys?.[sourceKey] || {};
    return {
      source_key: sourceKey,
      source_name: source.sourceName || sourceKey.replace(/_/g, ' '),
      source_type: 'recipe',
      priority: source.priority || 50,
    };
  });
};

const resolveInputFiles = (registry) => {
  const rawDir = resolveFromDataRoot(registry.defaults.rawDir);
  mkdirSync(rawDir, { recursive: true });

  const allFiles = collectRecipeFiles(rawDir);

  const matched = new Map();

  for (const [datasetKey, config] of Object.entries(registry.datasets)) {
    if (config.enabled === false) continue;

    for (const { fileName, filePath } of allFiles) {
      if (config.excludePatterns && isExcluded(fileName, config.excludePatterns)) continue;
      if (!matchesPattern(fileName, config.inputPattern)) continue;

      if (!matched.has(filePath)) {
        matched.set(filePath, { datasetKey, sourceKey: config.sourceKey, fileName, filePath });
      }
    }
  }

  return [...matched.values()];
};

const main = () => {
  const registry = loadRegistry();
  const processedDir = resolveFromDataRoot(registry.defaults.processedDir);
  const outputDir = join(processedDir, 'recipe_generation');
  const logDir = resolveFromDataRoot(registry.defaults.logDir);
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  const masterFoodsPath = resolveFromDataRoot('processed_datasets', 'master_foods.csv');
  const legacyFoodsPath = resolveFromDataRoot(registry.defaults.foodsCatalog);
  const foodCatalog = loadFoodCatalog(existsSync(masterFoodsPath) ? masterFoodsPath : legacyFoodsPath);

  const resolver = new IngredientResolver({
    foodsCsvPath: existsSync(legacyFoodsPath) ? legacyFoodsPath : null,
  });

  const generator = new RecipeTemplateGenerator();
  const inputFiles = resolveInputFiles(registry);

  if (inputFiles.length === 0) {
    console.warn(`No recipe input files found in ${registry.defaults.rawDir}`);
  }

  for (const input of inputFiles) {
    try {
      const content = readFileSync(input.filePath);
      const recipes = parseRecipeFile(content, input.filePath, resolver);

      for (const recipe of recipes) {
        recipe.sourceKey = input.sourceKey || recipe.sourceKey;
        generator.addRecipe(recipe);
      }

      console.log(`  ${input.fileName}: ${recipes.length} recipes parsed (${input.datasetKey})`);
    } catch (error) {
      generator.addFailure(input.fileName, error.message, input.filePath);
      console.error(`  ${input.fileName}: FAILED - ${error.message}`);
    }
  }

  const { templates, templateItems, sourceLinks } = generator.generateTemplates(foodCatalog);
  const unresolved = resolver.getUnresolvedStats();

  writeCsv(join(outputDir, 'master_recipe_templates.csv'), templates, [
    'id',
    'canonical_food_id',
    'canonical_name',
    'search_key',
    'cuisine',
    'default_serving_grams',
    'source_key',
    'confidence',
    'recipe_count',
    'active',
  ]);

  writeCsv(join(outputDir, 'master_recipe_template_items.csv'), templateItems, [
    'id',
    'recipe_template_id',
    'ingredient_food_id',
    'ingredient_name',
    'ingredient_search_key',
    'ingredient_state_key',
    'percentage',
    'min_percentage',
    'max_percentage',
    'required',
    'sort_order',
    'source_key',
    'resolved',
  ]);

  writeCsv(join(outputDir, 'master_recipe_source_links.csv'), sourceLinks, [
    'target_type',
    'canonical_name',
    'search_key',
    'source_key',
    'external_id',
    'recipe_count',
  ]);

  writeCsv(join(outputDir, 'recipe_templates.csv'), templates, [
    'id',
    'canonical_food_id',
    'canonical_name',
    'search_key',
    'cuisine',
    'default_serving_grams',
    'source_key',
    'confidence',
    'recipe_count',
    'active',
  ]);

  writeCsv(join(outputDir, 'recipe_template_items.csv'), templateItems, [
    'id',
    'recipe_template_id',
    'ingredient_food_id',
    'ingredient_name',
    'ingredient_search_key',
    'ingredient_state_key',
    'percentage',
    'min_percentage',
    'max_percentage',
    'required',
    'sort_order',
    'source_key',
    'resolved',
  ]);

  const recipeIntelligenceRules = buildRecipeIntelligenceRules(templates);
  writeCsv(join(outputDir, 'food_intelligence_rules.csv'), recipeIntelligenceRules, [
    'search_key',
    'food_type',
    'food_state_key',
    'confidence',
    'rules',
  ]);

  writeCsv(join(outputDir, 'food_sources.csv'), buildRecipeSourceRows(registry, templates), [
    'source_key',
    'source_name',
    'source_type',
    'priority',
  ]);

  writeCsv(join(processedDir, 'recipe_templates.csv'), templates, [
    'id',
    'canonical_food_id',
    'canonical_name',
    'search_key',
    'cuisine',
    'default_serving_grams',
    'source_key',
    'confidence',
    'recipe_count',
    'active',
  ]);

  writeCsv(join(processedDir, 'recipe_template_items.csv'), templateItems, [
    'id',
    'recipe_template_id',
    'ingredient_food_id',
    'ingredient_name',
    'ingredient_search_key',
    'ingredient_state_key',
    'percentage',
    'min_percentage',
    'max_percentage',
    'required',
    'sort_order',
    'source_key',
    'resolved',
  ]);

  writeCsv(
    join(processedDir, 'food_intelligence_rules.csv'),
    mergeCsvRows(join(processedDir, 'food_intelligence_rules.csv'), recipeIntelligenceRules, 'search_key'),
    [
      'search_key',
      'food_type',
      'food_state_key',
      'confidence',
      'rules',
    ],
  );

  writeCsv(join(logDir, 'failed_recipes.csv'), generator.failedRows, [
    'recipe',
    'reason',
    'source_file',
  ]);

  writeCsv(join(logDir, 'unresolved_ingredients.csv'), unresolved, [
    'search_key',
    'count',
  ]);

  const summary = {
    ...generator.stats,
    input_files: inputFiles.length,
    templates_active: templates.filter((item) => item.active).length,
    templates_inactive: templates.filter((item) => !item.active).length,
    unresolved_ingredient_types: unresolved.length,
    output_dir: toDataRelative(outputDir),
    generated_at: new Date().toISOString(),
  };

  writeFileSync(join(logDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log('\nRecipe Template Generator summary');
  console.log(`Raw recipes read: ${summary.raw_recipes_read}`);
  console.log(`Raw recipes discarded (merged into templates): ${summary.raw_recipes_discarded}`);
  console.log(`Canonical templates created: ${summary.canonical_templates_created}`);
  console.log(`  Active: ${summary.templates_active}`);
  console.log(`  Low confidence (inactive): ${summary.templates_inactive}`);
  console.log(`Ingredient rows: ${summary.ingredient_rows_created}`);
  console.log(`Unresolved ingredient types: ${summary.unresolved_ingredient_types}`);
  console.log(`Output: ${toDataRelative(outputDir)}`);
  console.log(`Logs: ${toDataRelative(logDir)}`);
};

main();
