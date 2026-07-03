import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './etl/lib/csv.mjs';
import { resolveFromDataRoot, toDataRelative } from './etl/lib/paths.mjs';

const INPUT_DIR = resolveFromDataRoot('processed_datasets');
const LOG_DIR = resolveFromDataRoot('import_logs');
const OUTPUT_DIR = resolveFromDataRoot('supabase', 'imports');

const escapeSql = (value) => String(value ?? '').replace(/'/g, "''");
const q = (value) => (value === null || value === undefined || value === '' ? 'null' : `'${escapeSql(value)}'`);
const n = (value) => (value === null || value === undefined || value === '' ? 'null' : Number(value));
const b = (value) => String(value).toLowerCase() === 'true';
const j = (value) => {
  if (!value) return `'{}'::jsonb`;
  try {
    return `'${escapeSql(JSON.stringify(JSON.parse(value)))}'::jsonb`;
  } catch {
    return `'${escapeSql(JSON.stringify({ raw: value }))}'::jsonb`;
  }
};
const arr = (value) => {
  if (!value) return "'{}'::text[]";
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return `array[${parsed.map((item) => q(item)).join(', ')}]::text[]`;
    }
  } catch {
    // Fall through to pipe/comma parsing.
  }
  const items = String(value).split(/[|,;]/).map((item) => item.trim()).filter(Boolean);
  return items.length ? `array[${items.map((item) => q(item)).join(', ')}]::text[]` : "'{}'::text[]";
};

const sourceId = (key) =>
  key ? `(select id from public.master_food_sources where source_key = '${escapeSql(key)}')` : 'null';

const readCsvRows = (fileName, dir = INPUT_DIR) => {
  const filePath = join(dir, fileName);
  if (!existsSync(filePath)) {
    console.warn(`Missing ${fileName}`);
    return [];
  }
  return parseCsv(readFileSync(filePath, 'utf8'));
};

const buildSourceInserts = (rowsByTable) => {
  const keys = new Set(['ifct', 'indb', 'usda_fdc', 'open_food_facts', 'recipe_derived', 'ai_internal']);
  for (const rows of rowsByTable) {
    for (const row of rows) {
      if (row.source_key) {
        for (const key of String(row.source_key).split('+')) keys.add(key);
      }
      if (row.nutrition_source_key) keys.add(row.nutrition_source_key);
    }
  }

  return [...keys].sort().map((key) => `
insert into public.master_food_sources (source_key, source_name, source_type, priority)
values (
  '${escapeSql(key)}',
  '${escapeSql(key.replace(/_/g, ' '))}',
  ${key.includes('recipe') ? "'recipe'" : key === 'open_food_facts' ? "'branded_food'" : "'nutrition'"},
  ${key === 'ifct' ? 10 : key === 'indb' ? 20 : key === 'usda_fdc' ? 30 : key === 'open_food_facts' ? 40 : key.includes('recipe') ? 50 : 100}
)
on conflict (source_key) do nothing;`).join('\n');
};

const buildFoodUpserts = (rows) => rows.map((row) => `
insert into public.master_foods (id, canonical_name, search_key, category, cuisine, default_state_key, confidence, active)
values (${q(row.id)}, ${q(row.canonical_name)}, ${q(row.search_key)}, ${q(row.category)}, ${q(row.cuisine)}, ${q(row.default_state_key || 'unknown')}, ${n(row.confidence || 0.75)}, true)
on conflict (id) do update set
  canonical_name = excluded.canonical_name,
  search_key = excluded.search_key,
  category = excluded.category,
  cuisine = excluded.cuisine,
  default_state_key = excluded.default_state_key,
  confidence = excluded.confidence,
  active = excluded.active,
  updated_at = now();`).join('\n');

const buildStateUpserts = (rows) => rows.map((row) => `
insert into public.master_food_states (id, food_id, state_key, state_name, is_default)
values (${q(row.id)}, ${q(row.food_id)}, ${q(row.state_key)}, ${q(row.state_name)}, ${b(row.is_default)})
on conflict (id) do update set
  food_id = excluded.food_id,
  state_key = excluded.state_key,
  state_name = excluded.state_name,
  is_default = excluded.is_default,
  updated_at = now();`).join('\n');

const buildProfileUpserts = (rows) => rows.map((row) => `
insert into public.master_food_profiles (
  id, food_id, food_state_id, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
  fiber_per_100g, water_per_100g, nutrition_source_id, confidence, selected
)
values (
  ${q(row.id)}, ${q(row.food_id)}, ${q(row.food_state_id)}, ${n(row.calories_per_100g)}, ${n(row.protein_per_100g)},
  ${n(row.carbs_per_100g)}, ${n(row.fat_per_100g)}, ${n(row.fiber_per_100g)}, ${n(row.water_per_100g)},
  ${sourceId(row.nutrition_source_key)}, ${n(row.confidence || 0.75)}, ${b(row.selected)}
)
on conflict (id) do update set
  calories_per_100g = excluded.calories_per_100g,
  protein_per_100g = excluded.protein_per_100g,
  carbs_per_100g = excluded.carbs_per_100g,
  fat_per_100g = excluded.fat_per_100g,
  fiber_per_100g = excluded.fiber_per_100g,
  water_per_100g = excluded.water_per_100g,
  nutrition_source_id = excluded.nutrition_source_id,
  confidence = excluded.confidence,
  selected = excluded.selected,
  updated_at = now();`).join('\n');

const buildAliasMetadataMigration = () => `
alter table public.master_food_aliases
add column if not exists alias_status text not null default 'active';

alter table public.master_food_aliases
add column if not exists lookup_mode text not null default 'direct';

alter table public.master_food_aliases
add column if not exists requires_context boolean not null default false;

alter table public.master_food_aliases
add column if not exists risk_level text not null default 'safe';

create index if not exists master_food_aliases_lookup_mode_idx
on public.master_food_aliases (alias_status, lookup_mode, requires_context, risk_level);`;

const buildAliasUpserts = (rows) => rows.map((row) => `
insert into public.master_food_aliases (
  id, food_id, food_state_id, alias, search_key, language, region, cuisine, source_id, confidence,
  alias_status, lookup_mode, requires_context, risk_level
)
values (
  ${q(row.id)}, ${q(row.food_id)}, ${q(row.food_state_id)}, ${q(row.alias)}, ${q(row.search_key)},
  ${q(row.language)}, ${q(row.region)}, ${q(row.cuisine)}, ${sourceId(row.source_key)}, ${n(row.confidence || 0.8)},
  ${q(row.alias_status || 'active')}, ${q(row.lookup_mode || 'direct')}, ${b(row.requires_context)}, ${q(row.risk_level || 'safe')}
)
on conflict (id) do update set
  alias = excluded.alias,
  search_key = excluded.search_key,
  language = excluded.language,
  region = excluded.region,
  cuisine = excluded.cuisine,
  source_id = excluded.source_id,
  confidence = excluded.confidence,
  alias_status = excluded.alias_status,
  lookup_mode = excluded.lookup_mode,
  requires_context = excluded.requires_context,
  risk_level = excluded.risk_level;`).join('\n');

const buildServingUpserts = (rows) => rows.map((row) => `
insert into public.master_serving_sizes (id, food_id, food_state_id, serving_name, serving_key, grams, source_id, priority, confidence)
values (
  ${q(row.id)}, ${q(row.food_id)}, ${q(row.food_state_id)}, ${q(row.serving_name)}, ${q(row.serving_key)},
  ${n(row.grams)}, ${sourceId(row.source_key)}, ${n(row.priority || 50)}, ${n(row.confidence || 0.8)}
)
on conflict (id) do update set
  serving_name = excluded.serving_name,
  serving_key = excluded.serving_key,
  grams = excluded.grams,
  source_id = excluded.source_id,
  priority = excluded.priority,
  confidence = excluded.confidence,
  updated_at = now();`).join('\n');

const buildBrandedUpserts = (rows) => rows.map((row) => `
insert into public.master_branded_foods (
  id, brand, product_name, barcode, serving_size, calories_per_100g, protein_per_100g, carbs_per_100g,
  fat_per_100g, fiber_per_100g, source_id, external_id, confidence
)
values (
  ${q(row.id)}, ${q(row.brand || 'Unknown')}, ${q(row.product_name)}, ${q(row.barcode)}, ${q(row.serving_size)},
  ${n(row.calories_per_100g)}, ${n(row.protein_per_100g)}, ${n(row.carbs_per_100g)}, ${n(row.fat_per_100g)},
  ${n(row.fiber_per_100g)}, ${sourceId(row.source_key)}, ${q(row.external_id)}, ${n(row.confidence || 0.75)}
)
on conflict (barcode) where barcode is not null do update set
  brand = excluded.brand,
  product_name = excluded.product_name,
  serving_size = excluded.serving_size,
  calories_per_100g = excluded.calories_per_100g,
  protein_per_100g = excluded.protein_per_100g,
  carbs_per_100g = excluded.carbs_per_100g,
  fat_per_100g = excluded.fat_per_100g,
  fiber_per_100g = excluded.fiber_per_100g,
  source_id = excluded.source_id,
  external_id = excluded.external_id,
  confidence = excluded.confidence,
  updated_at = now();`).join('\n');

const buildRecipeUpserts = (rows) => rows.map((row) => `
insert into public.master_recipe_templates (
  id, canonical_food_id, canonical_name, search_key, cuisine, default_serving_grams, source_id, confidence, recipe_count, active
)
values (
  ${q(row.id)}, ${q(row.canonical_food_id)}, ${q(row.canonical_name)}, ${q(row.search_key)}, ${q(row.cuisine)},
  ${n(row.default_serving_grams)}, ${sourceId(row.source_key)}, ${n(row.confidence || 0.7)}, ${n(row.recipe_count || 1)}, true
)
on conflict (search_key) do update set
  canonical_food_id = excluded.canonical_food_id,
  canonical_name = excluded.canonical_name,
  cuisine = excluded.cuisine,
  default_serving_grams = excluded.default_serving_grams,
  source_id = excluded.source_id,
  confidence = excluded.confidence,
  recipe_count = excluded.recipe_count,
  active = excluded.active,
  updated_at = now();`).join('\n');

const buildRecipeItemUpserts = (rows, recipes) => {
  const recipeSearchById = new Map(recipes.map((recipe) => [recipe.id, recipe.search_key]));
  return rows.map((row) => {
    const recipeSearchKey = recipeSearchById.get(row.recipe_template_id);
    const recipeTemplateId = recipeSearchKey
      ? `(select id from public.master_recipe_templates where search_key = '${escapeSql(recipeSearchKey)}')`
      : q(row.recipe_template_id);

    return `
insert into public.master_recipe_template_items (
  id, recipe_template_id, ingredient_name, ingredient_search_key, percentage, min_percentage, max_percentage, sort_order, source_id
)
values (
  ${q(row.id)}, ${recipeTemplateId}, ${q(row.ingredient_name)}, ${q(row.ingredient_search_key)},
  ${n(row.percentage)}, ${n(row.min_percentage)}, ${n(row.max_percentage)}, ${n(row.sort_order || 0)}, ${sourceId(row.source_key)}
)
on conflict (recipe_template_id, sort_order) do update set
  ingredient_name = excluded.ingredient_name,
  ingredient_search_key = excluded.ingredient_search_key,
  percentage = excluded.percentage,
  min_percentage = excluded.min_percentage,
  max_percentage = excluded.max_percentage,
  source_id = excluded.source_id;`;
  }).join('\n');
};

const buildSourceLinkUpserts = (rows, recipes) => {
  const recipeSearchById = new Map(recipes.map((recipe) => [recipe.id, recipe.search_key]));
  return rows.map((row) => {
    const recipeSearchKey = recipeSearchById.get(row.recipe_template_id);
    const recipeTemplateId = recipeSearchKey
      ? `(select id from public.master_recipe_templates where search_key = '${escapeSql(recipeSearchKey)}')`
      : q(row.recipe_template_id);

    return `
insert into public.master_food_source_links (
  id, food_id, food_state_id, recipe_template_id, branded_food_id, source_id, external_id, external_name, raw_record
)
values (
  ${q(row.id)}, ${q(row.food_id)}, ${q(row.food_state_id)}, ${recipeTemplateId}, ${q(row.branded_food_id)},
  ${sourceId(row.source_key)}, ${q(row.external_id)}, ${q(row.external_name)}, ${j(row.raw_record)}
)
on conflict (source_id, external_id) where external_id is not null do update set
  recipe_template_id = excluded.recipe_template_id,
  branded_food_id = excluded.branded_food_id,
  food_id = excluded.food_id,
  food_state_id = excluded.food_state_id,
  raw_record = excluded.raw_record,
  external_name = excluded.external_name;`;
  }).join('\n');
};

const buildClassificationUpserts = (rows) => rows.map((row) => `
insert into public.master_food_classifications (search_key, food_type, food_state_key, confidence, rules)
values (
  ${q(row.search_key)}, ${q(row.food_type || 'unknown')}, ${q(row.food_state_key || 'unknown')},
  ${n(row.confidence || 0.75)}, ${j(row.rules)}
)
on conflict (search_key) do update set
  food_type = excluded.food_type,
  food_state_key = excluded.food_state_key,
  confidence = excluded.confidence,
  rules = excluded.rules,
  updated_at = now();`).join('\n');

const buildTinyGarnishUpserts = (rows) => rows.map((row) => `
insert into public.master_tiny_garnish_profiles (
  food_name, search_key, aliases, default_grams, calories_per_100g, protein_per_100g,
  carbs_per_100g, fat_per_100g, fiber_per_100g, source_id, confidence
)
values (
  ${q(row.food_name)}, ${q(row.search_key)}, ${arr(row.aliases)}, ${n(row.default_grams || 3)},
  ${n(row.calories_per_100g)}, ${n(row.protein_per_100g)}, ${n(row.carbs_per_100g)},
  ${n(row.fat_per_100g)}, ${n(row.fiber_per_100g)}, ${sourceId(row.source_key)}, ${n(row.confidence || 0.75)}
)
on conflict (search_key) do update set
  food_name = excluded.food_name,
  aliases = excluded.aliases,
  default_grams = excluded.default_grams,
  calories_per_100g = excluded.calories_per_100g,
  protein_per_100g = excluded.protein_per_100g,
  carbs_per_100g = excluded.carbs_per_100g,
  fat_per_100g = excluded.fat_per_100g,
  fiber_per_100g = excluded.fiber_per_100g,
  source_id = excluded.source_id,
  confidence = excluded.confidence,
  updated_at = now();`).join('\n');

const buildImportBatch = (summary) => `
insert into public.master_import_batches (
  source_id, dataset_name, raw_path, processed_path, status, rows_processed, foods_imported, foods_merged,
  aliases_created, serving_sizes_created, recipe_templates_created, conflicts, failed_rows, summary, started_at, finished_at
)
values (
  ${sourceId('ifct')},
  'sample_master_foods',
  'raw_datasets/sample_master_foods.csv',
  'processed_datasets',
  'completed',
  ${n(summary.rows_processed || 0)},
  ${n(summary.foods_imported || 0)},
  ${n(summary.foods_merged || 0)},
  ${n(summary.aliases_created || 0)},
  ${n(summary.serving_sizes_created || 0)},
  ${n(summary.recipe_templates_created || 0)},
  ${n(summary.conflicts || 0)},
  ${n(summary.failed_rows || 0)},
  '${escapeSql(JSON.stringify(summary))}'::jsonb,
  ${q(summary.finished_at || new Date().toISOString())},
  ${q(summary.finished_at || new Date().toISOString())}
);`;

const main = () => {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const foods = readCsvRows('master_foods.csv');
  const states = readCsvRows('master_food_states.csv');
  const profiles = readCsvRows('master_food_profiles.csv');
  const aliases = readCsvRows('master_food_aliases.csv');
  const servings = readCsvRows('master_serving_sizes.csv');
  const branded = readCsvRows('master_branded_foods.csv');
  const recipes = readCsvRows('master_recipe_templates.csv');
  const recipeItems = readCsvRows('master_recipe_template_items.csv');
  const sourceLinks = readCsvRows('master_food_source_links.csv');
  const classifications = readCsvRows('food_intelligence_rules.csv');
  const tinyGarnishes = readCsvRows('tiny_garnish_profiles.csv');
  const summaryPath = join(LOG_DIR, 'summary.json');
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : {};

  const sql = `-- Auto-generated by generate-master-nutrition-sql.mjs
-- Apply in Supabase SQL Editor after master-nutrition-schema.sql.
-- Source: processed_datasets/master_*.csv

begin;

${buildSourceInserts([profiles, aliases, servings, branded, recipes, recipeItems, sourceLinks, tinyGarnishes])}

${buildFoodUpserts(foods)}

${buildStateUpserts(states)}

${buildProfileUpserts(profiles)}

${buildAliasMetadataMigration()}

${buildAliasUpserts(aliases)}

${buildServingUpserts(servings)}

${buildBrandedUpserts(branded)}

${buildRecipeUpserts(recipes)}

${buildRecipeItemUpserts(recipeItems, recipes)}

${buildSourceLinkUpserts(sourceLinks, recipes)}

${buildClassificationUpserts(classifications)}

${buildTinyGarnishUpserts(tinyGarnishes)}

${buildImportBatch(summary)}

commit;
`;

  const outputPath = join(OUTPUT_DIR, 'master_nutrition_sample_load.sql');
  writeFileSync(outputPath, sql, 'utf8');

  console.log('Master nutrition SQL generated');
  console.log(`Foods: ${foods.length}`);
  console.log(`States: ${states.length}`);
  console.log(`Profiles: ${profiles.length}`);
  console.log(`Aliases: ${aliases.length}`);
  console.log(`Servings: ${servings.length}`);
  console.log(`Branded: ${branded.length}`);
  console.log(`Recipes: ${recipes.length}`);
  console.log(`Recipe items: ${recipeItems.length}`);
  console.log(`Source links: ${sourceLinks.length}`);
  console.log(`Food intelligence rules: ${classifications.length}`);
  console.log(`Tiny garnish profiles: ${tinyGarnishes.length}`);
  console.log(`Output: ${toDataRelative(outputPath)}`);
};

main();
