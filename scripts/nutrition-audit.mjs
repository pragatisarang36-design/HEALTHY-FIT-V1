import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv, writeCsv } from './etl/lib/csv.mjs';
import { searchKey } from './etl/lib/normalize.mjs';
import { resolveFromDataRoot, toDataRelative } from './etl/lib/paths.mjs';

const PROCESSED_DIR = resolveFromDataRoot('processed_datasets');
const RECIPE_DIR = join(PROCESSED_DIR, 'recipe_generation');
const REPORTS_DIR = resolveFromDataRoot('reports');
const LOG_DIR = resolveFromDataRoot('import_logs');

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

const groupBy = (rows, keyFn) => {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
};

const uniqueBy = (rows, keyFn) => {
  const seen = new Set();
  return rows.filter((row) => {
    const key = keyFn(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const main = async () => {
  mkdirSync(REPORTS_DIR, { recursive: true });

  console.log('Running Master Nutrition Database Audit...\n');

  // Load all master data
  const foods = readRows('master_foods.csv');
  const states = readRows('master_food_states.csv');
  const profiles = readRows('master_food_profiles.csv');
  const aliases = readRows('master_food_aliases.csv');
  const servings = readRows('master_serving_sizes.csv');
  const brandedFoods = readRows('master_branded_foods.csv');
  const classifications = readRows('food_intelligence_rules.csv');
  const topLevelRecipes = readRows('recipe_templates.csv');
  const topLevelRecipeItems = readRows('recipe_template_items.csv');
  const generatedRecipes = readRows('master_recipe_templates.csv', RECIPE_DIR);
  const generatedRecipeItems = readRows('master_recipe_template_items.csv', RECIPE_DIR);
  const tinyGarnishProfiles = readRows('tiny_garnish_profiles.csv');
  const foodSources = readRows('food_sources.csv');
  const unresolvedFoods = readRows('unresolved_foods.csv');
  const conflicts = readRows('import_conflicts.csv');

  const recipes = uniqueBy([...topLevelRecipes, ...generatedRecipes], (row) => row.id || row.search_key);
  const recipeItems = uniqueBy([...topLevelRecipeItems, ...generatedRecipeItems], (row) =>
    row.id || `${row.recipe_template_id}|${row.ingredient_search_key}|${row.sort_order}`
  );

  // Database Overview Report
  const overviewReport = [
    {
      metric: 'Total Foods',
      count: foods.length,
      category: 'Foods',
    },
    {
      metric: 'Canonical Foods',
      count: foods.length,
      category: 'Foods',
    },
    {
      metric: 'Food States',
      count: states.length,
      category: 'Foods',
    },
    {
      metric: 'Food Profiles',
      count: profiles.length,
      category: 'Foods',
    },
    {
      metric: 'Aliases',
      count: aliases.length,
      category: 'Foods',
    },
    {
      metric: 'Serving Sizes',
      count: servings.length,
      category: 'Foods',
    },
    {
      metric: 'Branded Foods',
      count: brandedFoods.length,
      category: 'Foods',
    },
    {
      metric: 'Recipe Templates',
      count: recipes.length,
      category: 'Recipes',
    },
    {
      metric: 'Recipe Template Items',
      count: recipeItems.length,
      category: 'Recipes',
    },
    {
      metric: 'Tiny Garnish Profiles',
      count: tinyGarnishProfiles.length,
      category: 'Foods',
    },
    {
      metric: 'Food Sources',
      count: foodSources.length,
      category: 'Sources',
    },
    {
      metric: 'Unresolved Foods',
      count: unresolvedFoods.length,
      category: 'Issues',
    },
    {
      metric: 'Import Conflicts',
      count: conflicts.length,
      category: 'Issues',
    },
    {
      metric: 'Classification Rules',
      count: classifications.length,
      category: 'Intelligence',
    },
  ];

  writeCsv(join(REPORTS_DIR, 'database_overview.csv'), overviewReport, [
    'metric', 'count', 'category',
  ], writeFileSync);

  // Missing Data Report
  const missingData = [];
  
  // Foods without search keys
  const foodsWithoutSearchKey = foods.filter(f => !f.search_key || f.search_key.trim() === '');
  foodsWithoutSearchKey.forEach(f => {
    missingData.push({
      type: 'missing_search_key',
      table: 'master_foods',
      id: f.id,
      name: f.canonical_name,
      details: 'Food has no search key',
    });
  });

  // Foods without category
  const foodsWithoutCategory = foods.filter(f => !f.category || f.category.trim() === '');
  foodsWithoutCategory.forEach(f => {
    missingData.push({
      type: 'missing_category',
      table: 'master_foods',
      id: f.id,
      name: f.canonical_name,
      details: 'Food has no category',
    });
  });

  // Profiles without macros
  const profilesWithoutMacros = profiles.filter(p => 
    !p.calories_per_100g || 
    !p.protein_per_100g || 
    !p.carbs_per_100g || 
    !p.fat_per_100g
  );
  profilesWithoutMacros.forEach(p => {
    const food = foods.find(f => f.id === p.food_id);
    missingData.push({
      type: 'missing_macros',
      table: 'master_food_profiles',
      id: p.id,
      name: food?.canonical_name || 'Unknown',
      details: 'Profile missing one or more macros',
    });
  });

  // States without profiles
  const stateIdsWithProfiles = new Set(profiles.map(p => p.food_state_id));
  const statesWithoutProfiles = states.filter(s => !stateIdsWithProfiles.has(s.id));
  statesWithoutProfiles.forEach(s => {
    const food = foods.find(f => f.id === s.food_id);
    missingData.push({
      type: 'missing_profile',
      table: 'master_food_states',
      id: s.id,
      name: food?.canonical_name || 'Unknown',
      details: 'State has no nutrition profile',
    });
  });

  // Foods without default state
  const foodsWithoutDefaultState = foods.filter(f => !f.default_state_key || f.default_state_key.trim() === '');
  foodsWithoutDefaultState.forEach(f => {
    missingData.push({
      type: 'missing_default_state',
      table: 'master_foods',
      id: f.id,
      name: f.canonical_name,
      details: 'Food has no default state',
    });
  });

  // Recipe templates without items
  const recipeIdsWithItems = new Set(recipeItems.map(i => i.recipe_template_id));
  const recipesWithoutItems = recipes.filter(r => !recipeIdsWithItems.has(r.id));
  recipesWithoutItems.forEach(r => {
    missingData.push({
      type: 'missing_recipe_items',
      table: 'master_recipe_templates',
      id: r.id,
      name: r.canonical_name,
      details: 'Recipe template has no items',
    });
  });

  writeCsv(join(REPORTS_DIR, 'missing_data.csv'), missingData, [
    'type', 'table', 'id', 'name', 'details',
  ], writeFileSync);

  // Duplicate Foods Report
  const foodsBySearchKey = groupBy(foods, f => searchKey(f.search_key || f.canonical_name));
  const duplicateFoods = [];
  for (const [key, items] of foodsBySearchKey) {
    if (items.length > 1) {
      items.forEach(f => {
        duplicateFoods.push({
          search_key: key,
          food_id: f.id,
          canonical_name: f.canonical_name,
          duplicate_count: items.length,
        });
      });
    }
  }
  writeCsv(join(REPORTS_DIR, 'duplicate_foods.csv'), duplicateFoods, [
    'search_key', 'food_id', 'canonical_name', 'duplicate_count',
  ], writeFileSync);

  // Duplicate Aliases Report
  const aliasesBySearch = groupBy(aliases, a => searchKey(a.search_key || a.alias));
  const duplicateAliases = [];
  for (const [key, items] of aliasesBySearch) {
    if (items.length > 1) {
      items.forEach(a => {
        duplicateAliases.push({
          search_key: key,
          alias_id: a.id,
          alias: a.alias,
          food_id: a.food_id,
          duplicate_count: items.length,
        });
      });
    }
  }
  writeCsv(join(REPORTS_DIR, 'duplicate_aliases.csv'), duplicateAliases, [
    'search_key', 'alias_id', 'alias', 'food_id', 'duplicate_count',
  ], writeFileSync);

  // Recipe Template Validation Report
  const recipeValidation = [];
  recipes.forEach(r => {
    const items = recipeItems.filter(i => i.recipe_template_id === r.id);
    const issues = [];
    
    if (items.length === 0) {
      issues.push('No items');
    }
    
    if (!r.canonical_name || r.canonical_name.trim() === '') {
      issues.push('Missing canonical name');
    }
    
    if (!r.search_key || r.search_key.trim() === '') {
      issues.push('Missing search key');
    }
    
    if (!r.cuisine || r.cuisine.trim() === '') {
      issues.push('Missing cuisine');
    }
    
    if (!r.default_serving_grams || r.default_serving_grams <= 0) {
      issues.push('Invalid serving grams');
    }

    const totalPercentage = items.reduce((sum, i) => sum + (Number(i.percentage) || 0), 0);
    if (Math.abs(totalPercentage - 100) > 5) {
      issues.push(`Percentage sum: ${totalPercentage.toFixed(1)}%`);
    }

    if (issues.length > 0) {
      recipeValidation.push({
        recipe_id: r.id,
        canonical_name: r.canonical_name,
        search_key: r.search_key,
        cuisine: r.cuisine,
        item_count: items.length,
        confidence: r.confidence,
        issues: issues.join('; '),
      });
    }
  });
  writeCsv(join(REPORTS_DIR, 'recipe_template_validation.csv'), recipeValidation, [
    'recipe_id', 'canonical_name', 'search_key', 'cuisine', 'item_count', 'confidence', 'issues',
  ], writeFileSync);

  // Unresolved Foods Summary
  const unresolvedSummary = unresolvedFoods.map(u => ({
    file: u.file,
    row: u.row,
    reason: u.reason,
    raw_name: u.raw || '',
  }));
  writeCsv(join(REPORTS_DIR, 'unresolved_foods_summary.csv'), unresolvedSummary, [
    'file', 'row', 'reason', 'raw_name',
  ], writeFileSync);

  // Import Health Summary
  let importSummary = [];
  try {
    const summaryPath = join(LOG_DIR, 'summary.json');
    if (existsSync(summaryPath)) {
      const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
      importSummary = [
        {
          metric: 'Rows Processed',
          value: summary.rows_processed || 0,
          category: 'Import',
        },
        {
          metric: 'Generic Records',
          value: summary.generic_records || 0,
          category: 'Import',
        },
        {
          metric: 'Branded Records',
          value: summary.branded_records || 0,
          category: 'Import',
        },
        {
          metric: 'Failed Rows',
          value: summary.failed_rows || 0,
          category: 'Import',
        },
        {
          metric: 'Conflicts',
          value: summary.conflicts || 0,
          category: 'Import',
        },
        {
          metric: 'Unique Foods',
          value: summary.unique_foods || 0,
          category: 'Import',
        },
        {
          metric: 'Unique Aliases',
          value: summary.unique_aliases || 0,
          category: 'Import',
        },
        {
          metric: 'Recipe Templates',
          value: summary.recipe_templates || 0,
          category: 'Import',
        },
      ];
    }
  } catch (error) {
    importSummary = [
      {
        metric: 'Import Summary',
        value: 'Not available',
        category: 'Import',
      },
    ];
  }
  writeCsv(join(REPORTS_DIR, 'import_health_summary.csv'), importSummary, [
    'metric', 'value', 'category',
  ], writeFileSync);

  // Print Health Summary
  console.log('=== MASTER NUTRITION DATABASE HEALTH SUMMARY ===\n');
  
  console.log('Database Overview:');
  console.log(`  Total Foods: ${foods.length}`);
  console.log(`  Food States: ${states.length}`);
  console.log(`  Food Profiles: ${profiles.length}`);
  console.log(`  Aliases: ${aliases.length}`);
  console.log(`  Serving Sizes: ${servings.length}`);
  console.log(`  Branded Foods: ${brandedFoods.length}`);
  console.log(`  Recipe Templates: ${recipes.length}`);
  console.log(`  Recipe Items: ${recipeItems.length}`);
  console.log(`  Tiny Garnish Profiles: ${tinyGarnishProfiles.length}`);
  console.log(`  Food Sources: ${foodSources.length}`);
  console.log();

  console.log('Issues:');
  console.log(`  Missing Data: ${missingData.length}`);
  console.log(`  Duplicate Foods: ${duplicateFoods.length}`);
  console.log(`  Duplicate Aliases: ${duplicateAliases.length}`);
  console.log(`  Recipe Validation Issues: ${recipeValidation.length}`);
  console.log(`  Unresolved Foods: ${unresolvedFoods.length}`);
  console.log(`  Import Conflicts: ${conflicts.length}`);
  console.log();

  // Major Issues
  const majorIssues = [];
  if (unresolvedFoods.length > 100) {
    majorIssues.push(`High number of unresolved foods: ${unresolvedFoods.length}`);
  }
  if (missingData.length > 50) {
    majorIssues.push(`Significant missing data: ${missingData.length} items`);
  }
  if (duplicateFoods.length > 20) {
    majorIssues.push(`Duplicate foods detected: ${duplicateFoods.length} occurrences`);
  }
  if (recipeValidation.length > recipes.length * 0.1) {
    majorIssues.push(`Many recipe templates have validation issues: ${recipeValidation.length}`);
  }

  if (majorIssues.length > 0) {
    console.log('=== MAJOR ISSUES ===');
    majorIssues.forEach(issue => console.log(`  ⚠️  ${issue}`));
    console.log();
  }

  // Warnings
  const warnings = [];
  if (foodsWithoutSearchKey.length > 0) {
    warnings.push(`${foodsWithoutSearchKey.length} foods without search keys`);
  }
  if (foodsWithoutCategory.length > 0) {
    warnings.push(`${foodsWithoutCategory.length} foods without categories`);
  }
  if (statesWithoutProfiles.length > 0) {
    warnings.push(`${statesWithoutProfiles.length} states without nutrition profiles`);
  }
  if (recipesWithoutItems.length > 0) {
    warnings.push(`${recipesWithoutItems.length} recipe templates without items`);
  }

  if (warnings.length > 0) {
    console.log('=== WARNINGS ===');
    warnings.forEach(warning => console.log(`  ⚡ ${warning}`));
    console.log();
  }

  // Recommendations
  const recommendations = [];
  if (unresolvedFoods.length > 0) {
    recommendations.push('Review unresolved foods and add appropriate aliases or create new food entries');
  }
  if (duplicateFoods.length > 0) {
    recommendations.push('Merge duplicate foods and consolidate aliases');
  }
  if (missingData.length > 0) {
    recommendations.push('Fill in missing categories, search keys, and default states');
  }
  if (recipeValidation.length > 0) {
    recommendations.push('Fix recipe templates with validation issues (missing items, invalid percentages)');
  }
  if (statesWithoutProfiles.length > 0) {
    recommendations.push('Add nutrition profiles for states without data');
  }

  if (recommendations.length > 0) {
    console.log('=== RECOMMENDATIONS ===');
    recommendations.forEach((rec, i) => console.log(`  ${i + 1}. ${rec}`));
    console.log();
  }

  console.log('=== REPORTS GENERATED ===');
  console.log(`  ${toDataRelative(join(REPORTS_DIR, 'database_overview.csv'))}`);
  console.log(`  ${toDataRelative(join(REPORTS_DIR, 'missing_data.csv'))}`);
  console.log(`  ${toDataRelative(join(REPORTS_DIR, 'duplicate_foods.csv'))}`);
  console.log(`  ${toDataRelative(join(REPORTS_DIR, 'duplicate_aliases.csv'))}`);
  console.log(`  ${toDataRelative(join(REPORTS_DIR, 'recipe_template_validation.csv'))}`);
  console.log(`  ${toDataRelative(join(REPORTS_DIR, 'unresolved_foods_summary.csv'))}`);
  console.log(`  ${toDataRelative(join(REPORTS_DIR, 'import_health_summary.csv'))}`);
  console.log();

  const healthScore = calculateHealthScore({
    foods,
    states,
    profiles,
    aliases,
    servings,
    recipes,
    recipeItems,
    missingData,
    duplicateFoods,
    duplicateAliases,
    recipeValidation,
    unresolvedFoods,
    conflicts,
  });

  console.log(`Overall Health Score: ${healthScore}/100`);
  console.log();
};

const calculateHealthScore = (data) => {
  let score = 100;
  
  // Missing data penalty
  const missingDataRatio = data.missingData.length / Math.max(data.foods.length, 1);
  score -= missingDataRatio * 20;
  
  // Duplicate penalty
  const duplicateRatio = data.duplicateFoods.length / Math.max(data.foods.length, 1);
  score -= duplicateRatio * 15;
  
  // Unresolved penalty
  const unresolvedRatio = data.unresolvedFoods.length / Math.max(data.foods.length, 1);
  score -= unresolvedRatio * 15;
  
  // Recipe validation penalty
  const recipeIssueRatio = data.recipeValidation.length / Math.max(data.recipes.length, 1);
  score -= recipeIssueRatio * 10;
  
  // Conflict penalty
  const conflictRatio = data.conflicts.length / Math.max(data.foods.length, 1);
  score -= conflictRatio * 10;
  
  return Math.max(0, Math.min(100, Math.round(score)));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
