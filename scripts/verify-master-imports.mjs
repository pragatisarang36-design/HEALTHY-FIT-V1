import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCsv, writeCsv } from './etl/lib/csv.mjs';
import { searchKey } from './etl/lib/normalize.mjs';
import { resolveFromDataRoot, toDataRelative } from './etl/lib/paths.mjs';

const PROCESSED_DIR = resolveFromDataRoot('processed_datasets');
const RECIPE_DIR = join(PROCESSED_DIR, 'recipe_generation');
const LOG_DIR = resolveFromDataRoot('import_logs');
const OUTPUT_PATH = join(LOG_DIR, 'master_import_verification.csv');
const LIMIT = Number(process.env.VERIFY_LIMIT || 500);
const SAMPLE_RAW_FILES = new Set([
  'README.md',
  'sample_master_foods.csv',
  'sample_recipes.json',
  'recipe_ingredients_sample.csv',
]);

const readRows = (fileName, dir = PROCESSED_DIR) => {
  const filePath = join(dir, fileName);
  if (!existsSync(filePath)) return [];
  return parseCsv(readFileSync(filePath, 'utf8'));
};

const asBool = (value) => value === true || String(value).toLowerCase() === 'true';

const indexBy = (rows, keyFn) => {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (key && !map.has(key)) map.set(key, row);
  }
  return map;
};

const parseRules = (value) => {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
};

const uniqueBy = (rows, key) => {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const value = row[key];
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(row);
  }
  return output;
};

const listRawFiles = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => !SAMPLE_RAW_FILES.has(fileName));
};

const main = async () => {
  mkdirSync(LOG_DIR, { recursive: true });

  const foods = readRows('master_foods.csv');
  const states = readRows('master_food_states.csv');
  const profiles = readRows('master_food_profiles.csv');
  const aliases = readRows('master_food_aliases.csv');
  const brandedFoods = readRows('master_branded_foods.csv');
  const classifications = readRows('food_intelligence_rules.csv');
  const topLevelRecipes = readRows('recipe_templates.csv');
  const topLevelRecipeItems = readRows('recipe_template_items.csv');
  const generatedRecipes = readRows('master_recipe_templates.csv', RECIPE_DIR);
  const generatedRecipeItems = readRows('master_recipe_template_items.csv', RECIPE_DIR);

  const recipes = uniqueBy([...topLevelRecipes, ...generatedRecipes], 'search_key');
  const recipeItems = [...topLevelRecipeItems, ...generatedRecipeItems];

  const foodBySearch = indexBy(foods, (row) => searchKey(row.search_key || row.canonical_name));
  const foodById = indexBy(foods, (row) => row.id);
  const brandedBySearch = indexBy(brandedFoods, (row) => searchKey(row.product_name));
  const stateByFoodId = new Map();
  for (const state of states) {
    if (asBool(state.is_default) || !stateByFoodId.has(state.food_id)) {
      stateByFoodId.set(state.food_id, state);
    }
  }
  const profileByFoodStateId = indexBy(profiles, (row) => row.food_state_id);
  const aliasBySearch = indexBy(aliases, (row) => searchKey(row.search_key || row.alias));
  const ruleBySearch = indexBy(classifications, (row) => searchKey(row.search_key));
  const recipeBySearch = indexBy(recipes, (row) => searchKey(row.search_key || row.canonical_name));
  const recipeItemCounts = recipeItems.reduce((counts, item) => {
    counts.set(item.recipe_template_id, (counts.get(item.recipe_template_id) || 0) + 1);
    return counts;
  }, new Map());

  const realDatasetFiles = [
    ...listRawFiles(resolveFromDataRoot('raw_datasets')).map((fileName) => `raw_datasets/${fileName}`),
    ...listRawFiles(resolveFromDataRoot('raw_datasets', 'recipes')).map((fileName) => `raw_datasets/recipes/${fileName}`),
  ];
  const realDatasetsDetected = realDatasetFiles.length > 0;
  const verificationLimit = realDatasetsDetected ? Math.max(LIMIT, 500) : LIMIT;

  const candidateInputs = [
    ...foods.map((row) => row.search_key || row.canonical_name),
    ...aliases.map((row) => row.search_key || row.alias),
    ...recipes.map((row) => row.search_key || row.canonical_name),
    ...classifications.map((row) => row.search_key),
  ]
    .map(searchKey)
    .filter(Boolean);

  const inputs = [...new Set(candidateInputs)].slice(0, verificationLimit);

  const results = inputs.map((inputName) => {
    const inputKey = searchKey(inputName);
    const exactFood = foodBySearch.get(inputKey);
    const alias = aliasBySearch.get(inputKey);
    const aliasFood = alias ? foodById.get(alias.food_id) : null;
    const food = exactFood || aliasFood || null;
    const state = food ? stateByFoodId.get(food.id) : null;
    const profile = state ? profileByFoodStateId.get(state.id) : null;
    const rule = ruleBySearch.get(inputKey);
    const ruleData = parseRules(rule?.rules);
    const recipe = recipeBySearch.get(inputKey) || (ruleData.canonical ? recipeBySearch.get(searchKey(ruleData.canonical)) : null);
    const branded = brandedBySearch.get(inputKey) || brandedFoods.find((row) => {
      const productKey = searchKey(row.product_name);
      return productKey && inputKey && (productKey.includes(inputKey) || inputKey.includes(productKey));
    });
    const macroResolved = Boolean(profile) || Boolean(branded) || Boolean(recipe && recipeItemCounts.get(recipe.id));
    const canonicalName = food?.canonical_name || branded?.product_name || recipe?.canonical_name || ruleData.canonical || inputName;

    return {
      input_name: inputName,
      canonical_resolved_name: canonicalName,
      food_type: rule?.food_type || (branded ? 'branded_packaged' : recipe ? 'mixed_recipe' : food ? 'simple_ingredient' : 'unknown'),
      food_state: state?.state_key || rule?.food_state_key || (recipe ? 'cooked' : 'unknown'),
      source: profile?.nutrition_source_key || branded?.source_key || recipe?.source_key || ruleData.generated_from || 'unknown',
      template_used: recipe?.canonical_name || '',
      macros_resolved: macroResolved ? 'yes' : 'no',
      unresolved: macroResolved || rule || food || branded || recipe ? 'no' : 'yes',
    };
  });

  writeCsv(OUTPUT_PATH, results, [
    'input_name',
    'canonical_resolved_name',
    'food_type',
    'food_state',
    'source',
    'template_used',
    'macros_resolved',
    'unresolved',
  ]);

  const unresolvedCount = results.filter((row) => row.unresolved === 'yes').length;
  const macroCount = results.filter((row) => row.macros_resolved === 'yes').length;
  const summary = {
    checked: results.length,
    target_limit: verificationLimit,
    real_datasets_detected: realDatasetsDetected,
    real_dataset_files: realDatasetFiles,
    coverage_warning: realDatasetsDetected && results.length < 500
      ? `Real datasets detected, but only ${results.length} unique generated foods/templates were available to verify.`
      : '',
    macros_resolved: macroCount,
    unresolved: unresolvedCount,
    output: toDataRelative(OUTPUT_PATH),
  };

  await writeFile(join(LOG_DIR, 'master_import_verification_summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log('Master import verification');
  console.log(`Checked: ${summary.checked}`);
  console.log(`Target limit: ${summary.target_limit}`);
  console.log(`Real datasets detected: ${summary.real_datasets_detected ? 'yes' : 'no'}`);
  if (summary.coverage_warning) console.warn(summary.coverage_warning);
  console.log(`Macros resolved: ${summary.macros_resolved}`);
  console.log(`Unresolved: ${summary.unresolved}`);
  console.log(`Output: ${summary.output}`);
  console.table(results.slice(0, 25));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
