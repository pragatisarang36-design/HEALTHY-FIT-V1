import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './etl/lib/csv.mjs';
import { resolveFromDataRoot, toDataRelative } from './etl/lib/paths.mjs';

const INPUT_DIR = resolveFromDataRoot('processed_datasets', 'recipe_generation');
const OUTPUT_DIR = resolveFromDataRoot('supabase', 'imports');

const escapeSql = (value) => String(value ?? '').replace(/'/g, "''");
const optionalFoodId = (value) =>
  value ? `(select id from public.master_foods where id = '${escapeSql(value)}')` : 'null';

const readCsvRows = (fileName) => {
  const filePath = join(INPUT_DIR, fileName);
  if (!existsSync(filePath)) {
    console.warn(`Missing ${fileName} — run npm run etl:recipes first`);
    return [];
  }
  return parseCsv(readFileSync(filePath, 'utf8'));
};

const buildSourceKeyInserts = (templates) => {
  const keys = [...new Set(templates.flatMap((row) => String(row.source_key || 'recipe_derived').split('+')))];
  return keys.map((sourceKey) => `
insert into public.master_food_sources (source_key, source_name, source_type, priority)
values ('${escapeSql(sourceKey)}', '${escapeSql(sourceKey.replace(/_/g, ' '))}', 'recipe', 50)
on conflict (source_key) do nothing;`).join('\n');
};

const buildTemplateUpserts = (templates) => templates.map((row) => `
insert into public.master_recipe_templates (
  id, canonical_food_id, canonical_name, search_key, cuisine, default_serving_grams, confidence, recipe_count, active
)
values (
  '${escapeSql(row.id)}',
  ${optionalFoodId(row.canonical_food_id)},
  '${escapeSql(row.canonical_name)}',
  '${escapeSql(row.search_key)}',
  ${row.cuisine ? `'${escapeSql(row.cuisine)}'` : 'null'},
  ${row.default_serving_grams || 'null'},
  ${row.confidence || 0.7},
  ${row.recipe_count || 1},
  ${row.active === 'false' || row.active === false ? 'false' : 'true'}
)
on conflict (search_key) do update set
  canonical_food_id = excluded.canonical_food_id,
  canonical_name = excluded.canonical_name,
  cuisine = excluded.cuisine,
  default_serving_grams = excluded.default_serving_grams,
  confidence = excluded.confidence,
  recipe_count = excluded.recipe_count,
  active = excluded.active,
  updated_at = now();`).join('\n');

const buildItemInserts = (items, templates) => {
  if (!items.length) return '-- No template items to insert';

  const templateSearchById = new Map(templates.map((template) => [template.id, template.search_key]));
  const templateSearchKeys = [...new Set(items
    .map((item) => templateSearchById.get(item.recipe_template_id))
    .filter(Boolean)
    .map((searchKey) => `'${escapeSql(searchKey)}'`))];
  const templateFilter = templateSearchKeys.length
    ? `select id from public.master_recipe_templates where search_key in (${templateSearchKeys.join(', ')})`
    : items.map((item) => `'${escapeSql(item.recipe_template_id)}'`).join(', ');

  return `
delete from public.master_recipe_template_items
where recipe_template_id in (${templateFilter});

${items.map((row) => {
  const recipeSearchKey = templateSearchById.get(row.recipe_template_id);
  const recipeTemplateId = recipeSearchKey
    ? `(select id from public.master_recipe_templates where search_key = '${escapeSql(recipeSearchKey)}')`
    : `'${escapeSql(row.recipe_template_id)}'`;

  return `
insert into public.master_recipe_template_items (
  id,
  recipe_template_id,
  ingredient_food_id,
  ingredient_name,
  ingredient_search_key,
  percentage,
  min_percentage,
  max_percentage,
  required,
  sort_order
)
values (
  '${escapeSql(row.id)}',
  ${recipeTemplateId},
  ${optionalFoodId(row.ingredient_food_id)},
  '${escapeSql(row.ingredient_name)}',
  '${escapeSql(row.ingredient_search_key)}',
  ${row.percentage},
  ${row.min_percentage ?? row.percentage},
  ${row.max_percentage ?? row.percentage},
  ${row.required === 'false' || row.required === false ? 'false' : 'true'},
  ${row.sort_order ?? 0}
)
on conflict (recipe_template_id, sort_order) do update set
  ingredient_food_id = excluded.ingredient_food_id,
  ingredient_name = excluded.ingredient_name,
  ingredient_search_key = excluded.ingredient_search_key,
  percentage = excluded.percentage,
  min_percentage = excluded.min_percentage,
  max_percentage = excluded.max_percentage,
  required = excluded.required;`;
}).join('\n')}`;
};

const buildImportBatch = (templateCount, itemCount) => `
insert into public.master_import_batches (
  source_id,
  dataset_name,
  raw_path,
  processed_path,
  status,
  rows_processed,
  recipe_templates_created,
  summary,
  started_at,
  finished_at
)
values (
  (select id from public.master_food_sources where source_key = 'recipe_derived'),
  'recipe_template_generation',
  'raw_datasets/recipes',
  'processed_datasets/recipe_generation',
  'completed',
  ${templateCount + itemCount},
  ${templateCount},
  '{"templates": ${templateCount}, "items": ${itemCount}}'::jsonb,
  now(),
  now()
);`;

const main = () => {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const templates = readCsvRows('master_recipe_templates.csv');
  const items = readCsvRows('master_recipe_template_items.csv');

  if (!templates.length) {
    console.error('No recipe templates found. Run: npm run etl:recipes');
    process.exit(1);
  }

  const sql = `-- Auto-generated by load-master-recipes.mjs
-- Apply in Supabase SQL Editor after master-nutrition-schema.sql
-- Source: processed_datasets/recipe_generation/

begin;

${buildSourceKeyInserts(templates)}

${buildTemplateUpserts(templates)}

${buildItemInserts(items, templates)}

${buildImportBatch(templates.length, items.length)}

commit;
`;

  const outputPath = join(OUTPUT_DIR, 'master_recipe_templates_load.sql');
  writeFileSync(outputPath, sql, 'utf8');

  console.log('Master recipe load SQL generated');
  console.log(`Templates: ${templates.length}`);
  console.log(`Items: ${items.length}`);
  console.log(`Output: ${toDataRelative(outputPath)}`);
  console.log('\nApply this file in Supabase SQL Editor to load templates into master_recipe_templates.');
};

main();
