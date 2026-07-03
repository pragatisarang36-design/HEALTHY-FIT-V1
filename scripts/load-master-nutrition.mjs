import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { parseCsv } from './etl/lib/csv.mjs';
import { resolveFromDataRoot, toDataRelative } from './etl/lib/paths.mjs';

const PROCESSED_DIR = resolveFromDataRoot(process.argv[2] || 'processed_datasets');
const LOG_DIR = resolveFromDataRoot(process.argv[3] || 'import_logs');
const BATCH_FILE = join(PROCESSED_DIR, 'import_batch.json');

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY environment variables.');
  console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run etl:load');
  process.exit(1);
}

if (!existsSync(BATCH_FILE)) {
  console.error(`No processed batch found at ${BATCH_FILE}. Run npm run etl:foods first.`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const readCsvFile = (fileName) => {
  const path = join(PROCESSED_DIR, fileName);
  if (!existsSync(path)) return [];
  return parseCsv(readFileSync(path, 'utf8'));
};

const readLogCsvFile = (fileName) => {
  const path = join(LOG_DIR, fileName);
  if (!existsSync(path)) return [];
  return parseCsv(readFileSync(path, 'utf8'));
};

const chunk = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const upsertBatched = async (table, rows, onConflict) => {
  if (!rows.length) return 0;
  let written = 0;
  for (const batch of chunk(rows, 500)) {
    const query = supabase.from(table).upsert(batch, onConflict ? { onConflict } : undefined);
    const { error } = await query;
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    written += batch.length;
  }
  return written;
};

const sourceKeyToId = async () => {
  const { data, error } = await supabase.from('master_food_sources').select('id, source_key');
  if (error) throw new Error(`Failed to load sources: ${error.message}`);
  return new Map(data.map((row) => [row.source_key, row.id]));
};

const batchMeta = JSON.parse(readFileSync(BATCH_FILE, 'utf8'));
const sourceIds = await sourceKeyToId();

const { data: batchRow, error: batchError } = await supabase
  .from('master_import_batches')
  .insert({
    id: batchMeta.id,
    dataset_name: 'master_etl',
    dataset_version: '1.0.0',
    processed_path: toDataRelative(PROCESSED_DIR),
    status: 'running',
    started_at: batchMeta.started_at,
    summary: batchMeta,
  })
  .select('id')
  .single();

if (batchError) {
  console.error(`Failed to create import batch: ${batchError.message}`);
  process.exit(1);
}

const batchId = batchRow.id;

try {
  const foods = readCsvFile('master_foods.csv').map((row) => ({
    id: row.id,
    canonical_name: row.canonical_name,
    search_key: row.search_key,
    category: row.category || null,
    cuisine: row.cuisine || null,
    default_state_key: row.default_state_key || 'unknown',
    confidence: Number(row.confidence || 0.75),
    active: true,
  }));

  const states = readCsvFile('master_food_states.csv').map((row) => ({
    id: row.id,
    food_id: row.food_id,
    state_key: row.state_key,
    state_name: row.state_name,
    is_default: String(row.is_default).toLowerCase() === 'true',
  }));

  const profiles = readCsvFile('master_food_profiles.csv').map((row) => ({
    id: row.id,
    food_id: row.food_id,
    food_state_id: row.food_state_id,
    calories_per_100g: Number(row.calories_per_100g),
    protein_per_100g: Number(row.protein_per_100g),
    carbs_per_100g: Number(row.carbs_per_100g),
    fat_per_100g: Number(row.fat_per_100g),
    fiber_per_100g: row.fiber_per_100g ? Number(row.fiber_per_100g) : null,
    water_per_100g: row.water_per_100g ? Number(row.water_per_100g) : null,
    nutrition_source_id: sourceIds.get(row.nutrition_source_key) || null,
    confidence: Number(row.confidence || 0.75),
    selected: String(row.selected).toLowerCase() !== 'false',
  }));

  const aliases = readCsvFile('master_food_aliases.csv').map((row) => ({
    id: row.id,
    food_id: row.food_id,
    food_state_id: row.food_state_id || null,
    alias: row.alias,
    search_key: row.search_key,
    language: row.language || null,
    region: row.region || null,
    cuisine: row.cuisine || null,
    source_id: sourceIds.get(row.source_key) || null,
    confidence: Number(row.confidence || 0.8),
    alias_status: row.alias_status || 'active',
    lookup_mode: row.lookup_mode || 'direct',
    requires_context: String(row.requires_context).toLowerCase() === 'true',
    risk_level: row.risk_level || 'safe',
  }));

  const servings = readCsvFile('master_serving_sizes.csv').map((row) => ({
    id: row.id,
    food_id: row.food_id,
    food_state_id: row.food_state_id || null,
    serving_name: row.serving_name,
    serving_key: row.serving_key,
    grams: row.grams ? Number(row.grams) : null,
    source_id: sourceIds.get(row.source_key) || null,
    priority: Number(row.priority || 50),
    confidence: Number(row.confidence || 0.8),
  }));

  const branded = readCsvFile('master_branded_foods.csv').map((row) => ({
    id: row.id,
    brand: row.brand,
    product_name: row.product_name,
    barcode: row.barcode || null,
    serving_size: row.serving_size || null,
    calories_per_100g: Number(row.calories_per_100g),
    protein_per_100g: Number(row.protein_per_100g),
    carbs_per_100g: Number(row.carbs_per_100g),
    fat_per_100g: Number(row.fat_per_100g),
    fiber_per_100g: row.fiber_per_100g ? Number(row.fiber_per_100g) : null,
    source_id: sourceIds.get(row.source_key) || null,
    external_id: row.external_id || null,
    confidence: Number(row.confidence || 0.75),
  }));

  const recipes = readCsvFile('master_recipe_templates.csv').map((row) => ({
    id: row.id,
    canonical_food_id: row.canonical_food_id || null,
    canonical_name: row.canonical_name,
    search_key: row.search_key,
    cuisine: row.cuisine || null,
    default_serving_grams: row.default_serving_grams ? Number(row.default_serving_grams) : null,
    source_id: sourceIds.get(row.source_key) || null,
    confidence: Number(row.confidence || 0.7),
    recipe_count: Number(row.recipe_count || 1),
    active: true,
  }));

  const recipeItems = readCsvFile('master_recipe_template_items.csv').map((row) => ({
    id: row.id,
    recipe_template_id: row.recipe_template_id,
    ingredient_name: row.ingredient_name,
    ingredient_search_key: row.ingredient_search_key,
    percentage: Number(row.percentage),
    min_percentage: row.min_percentage ? Number(row.min_percentage) : null,
    max_percentage: row.max_percentage ? Number(row.max_percentage) : null,
    sort_order: Number(row.sort_order || 0),
    source_id: sourceIds.get(row.source_key) || null,
  }));

  const sourceLinks = readCsvFile('master_food_source_links.csv').map((row) => ({
    id: row.id,
    food_id: row.food_id || null,
    food_state_id: row.food_state_id || null,
    recipe_template_id: row.recipe_template_id || null,
    branded_food_id: row.branded_food_id || null,
    source_id: sourceIds.get(row.source_key),
    external_id: row.external_id || null,
    external_name: row.external_name || null,
    raw_record: JSON.parse(row.raw_record || '{}'),
  })).filter((row) => row.source_id);

  const importFailures = readLogCsvFile('failed_rows.csv').map((row) => ({
    batch_id: batchId,
    row_number: Number(row.row) || null,
    raw_record: JSON.parse(row.raw || '{}'),
    error_code: 'ETL_TRANSFORM',
    error_message: row.reason || 'Unknown error',
  }));

  const nutritionConflicts = readLogCsvFile('conflicts.csv').map((row) => ({
    batch_id: batchId,
    nutrient: 'macros',
    source_a_id: sourceIds.get(row.source_a_key) || null,
    source_b_id: sourceIds.get(row.source_b_key) || null,
    reason: row.reason || null,
    resolved: true,
  }));

  const counts = {
    foods: await upsertBatched('master_foods', foods, 'id'),
    states: await upsertBatched('master_food_states', states, 'id'),
    profiles: await upsertBatched('master_food_profiles', profiles, 'id'),
    aliases: await upsertBatched('master_food_aliases', aliases, 'id'),
    servings: await upsertBatched('master_serving_sizes', servings, 'id'),
    branded: await upsertBatched('master_branded_foods', branded, 'id'),
    recipes: await upsertBatched('master_recipe_templates', recipes, 'id'),
    recipeItems: await upsertBatched('master_recipe_template_items', recipeItems, 'id'),
    sourceLinks: await upsertBatched('master_food_source_links', sourceLinks, 'id'),
    failures: await upsertBatched('master_import_failures', importFailures),
    conflicts: await upsertBatched('master_nutrition_conflicts', nutritionConflicts),
  };
  await supabase
    .from('master_import_batches')
    .update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      rows_processed: batchMeta.rows_processed || 0,
      foods_imported: counts.foods,
      foods_merged: batchMeta.foods_merged || 0,
      aliases_created: counts.aliases,
      serving_sizes_created: counts.servings,
      recipe_templates_created: counts.recipes,
      conflicts: batchMeta.conflicts || 0,
      failed_rows: batchMeta.failed_rows || 0,
      summary: { ...batchMeta, load_counts: counts },
    })
    .eq('id', batchId);

  console.log('Master nutrition load complete');
  console.log(JSON.stringify(counts, null, 2));
} catch (error) {
  await supabase
    .from('master_import_batches')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      summary: { error: error.message, batchMeta },
    })
    .eq('id', batchId);

  console.error(error.message);
  process.exit(1);
}
