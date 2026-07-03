import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { resolveFromDataRoot, toDataRelative } from './etl/lib/paths.mjs';

const inputDir = resolveFromDataRoot(process.argv[2] || '');
const outputDir = resolveFromDataRoot(process.argv[3] || 'supabase/imports');
const maxFoods = Number(process.argv[4] || 50000);
const mode = process.argv[5] || 'all';
const commonDataTypes = new Set(['foundation_food', 'sr_legacy_food', 'survey_fndds_food']);
const foundationDataTypes = new Set(['foundation_food']);

if (!inputDir || !existsSync(inputDir)) {
  console.error('Usage: npm run nutrition:usda -- <extracted-fooddata-central-csv-folder> [output-folder] [max-foods] [all|common|foundation]');
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });

const foodPath = join(inputDir, 'food.csv');
const nutrientPath = join(inputDir, 'nutrient.csv');
const foodNutrientPath = join(inputDir, 'food_nutrient.csv');

for (const path of [foodPath, nutrientPath, foodNutrientPath]) {
  if (!existsSync(path)) {
    console.error(`Missing required USDA CSV file: ${path}`);
    process.exit(1);
  }
}

const wantedNutrients = new Map([
  ['1008', 'calories_per_100g'],
  ['208', 'calories_per_100g'],
  ['1003', 'protein_per_100g'],
  ['203', 'protein_per_100g'],
  ['1005', 'carbs_per_100g'],
  ['205', 'carbs_per_100g'],
  ['1004', 'fats_per_100g'],
  ['204', 'fats_per_100g'],
]);

const csvEscape = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const csvLine = (values) => `${values.map(csvEscape).join(',')}\n`;

const parseCsvLine = (line) => {
  const fields = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      fields.push(value);
      value = '';
    } else {
      value += char;
    }
  }

  fields.push(value);
  return fields;
};

async function readCsv(path, onRow) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let headers;
  for await (const line of rl) {
    if (!headers) {
      headers = parseCsvLine(line);
      continue;
    }
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = fields[index] ?? '';
    });
    const shouldStop = await onRow(row);
    if (shouldStop === false) {
      rl.close();
      break;
    }
  }
}

const stableUuid = (value) => {
  const hex = createHash('md5').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const searchKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const simplifyName = (description) =>
  String(description || '')
    .replace(/,\s*(raw|cooked|boiled|roasted|grilled|baked)$/i, ' $1')
    .replace(/\s+/g, ' ')
    .trim();

const nutrientIdsById = new Map();
const foods = new Map();
const macrosByFood = new Map();
const macroKeysByFood = new Map();

console.log('Reading USDA nutrient definitions...');
await readCsv(nutrientPath, (row) => {
  const nutrientNumber = row.number || row.nutrient_nbr;
  if (wantedNutrients.has(nutrientNumber)) {
    nutrientIdsById.set(row.id, wantedNutrients.get(nutrientNumber));
  }
});

console.log('Reading USDA foods...');
await readCsv(foodPath, (row) => {
  if (foods.size >= maxFoods) return false;
  const dataType = String(row.data_type || '').trim();
  if (mode === 'common' && !commonDataTypes.has(dataType)) return;
  if (mode === 'foundation' && !foundationDataTypes.has(dataType)) return;
  if (mode === 'all' && dataType === 'experimental_food') return;
  const description = simplifyName(row.description);
  if (!description || description.length > 120) return;
  foods.set(row.fdc_id, {
    id: stableUuid(`usda:${row.fdc_id}`),
    source_id: row.fdc_id,
    name: description,
    category: row.food_category_id ? 'usda' : row.data_type || 'usda',
  });
});

console.log('Reading USDA macro values...');
const completeFoodIds = new Set();
await readCsv(foodNutrientPath, (row) => {
  if (!foods.has(row.fdc_id)) return;
  if (completeFoodIds.has(row.fdc_id)) return;
  const macroKey = nutrientIdsById.get(row.nutrient_id);
  if (!macroKey) return;
  const value = Number(row.amount);
  if (!Number.isFinite(value)) return;
  const macros = macrosByFood.get(row.fdc_id) || {
    calories_per_100g: 0,
    protein_per_100g: 0,
    carbs_per_100g: 0,
    fats_per_100g: 0,
  };
  const macroKeys = macroKeysByFood.get(row.fdc_id) || new Set();
  macros[macroKey] = value;
  macroKeys.add(macroKey);
  macrosByFood.set(row.fdc_id, macros);
  macroKeysByFood.set(row.fdc_id, macroKeys);

  if (
    macros.calories_per_100g > 0 &&
    macroKeys.has('protein_per_100g') &&
    macroKeys.has('carbs_per_100g') &&
    macroKeys.has('fats_per_100g') &&
    Object.values(macros).every((macro) => Number.isFinite(macro))
  ) {
    completeFoodIds.add(row.fdc_id);
    if (completeFoodIds.size >= maxFoods) return false;
  }
});

const suffix = mode === 'foundation' ? 'foundation_usda' : mode === 'common' ? 'common_usda' : 'usda';
const foodsFile = `nutrition_foods_${suffix}.csv`;
const aliasesFile = `nutrition_food_aliases_${suffix}.csv`;
const foodsOut = createWriteStream(join(outputDir, foodsFile));
const aliasesOut = createWriteStream(join(outputDir, aliasesFile));

foodsOut.write(csvLine([
  'id',
  'name',
  'brand',
  'category',
  'calories_per_100g',
  'protein_per_100g',
  'carbs_per_100g',
  'fats_per_100g',
  'source',
  'source_id',
  'verified',
]));
aliasesOut.write(csvLine(['food_id', 'alias', 'search_key']));

let written = 0;
for (const [fdcId, food] of foods) {
  const macros = macrosByFood.get(fdcId);
  if (!macros || macros.calories_per_100g <= 0) continue;
  if (macros.calories_per_100g > 950 || macros.protein_per_100g > 100 || macros.carbs_per_100g > 100 || macros.fats_per_100g > 105) continue;

  foodsOut.write(csvLine([
    food.id,
    food.name,
    '',
    food.category,
    macros.calories_per_100g,
    macros.protein_per_100g,
    macros.carbs_per_100g,
    macros.fats_per_100g,
    'usda',
    food.source_id,
    true,
  ]));

  aliasesOut.write(csvLine([food.id, food.name, searchKey(food.name)]));
  const simpleAlias = food.name.split(',')[0]?.trim();
  if (simpleAlias && simpleAlias.length >= 3 && simpleAlias !== food.name) {
    aliasesOut.write(csvLine([food.id, simpleAlias, searchKey(simpleAlias)]));
  }
  written += 1;
}

foodsOut.end();
aliasesOut.end();

console.log(`Done. Wrote ${written} foods.`);
console.log(`Import these files into Supabase tables:`);
console.log(`- ${toDataRelative(join(outputDir, foodsFile))} -> public.nutrition_foods`);
console.log(`- ${toDataRelative(join(outputDir, aliasesFile))} -> public.nutrition_food_aliases`);
