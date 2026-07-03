import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { resolveFromDataRoot, toDataRelative } from './etl/lib/paths.mjs';

const inputPath = resolveFromDataRoot(process.argv[2] || '');
const outputDir = resolveFromDataRoot(process.argv[3] || 'supabase/imports');
const maxFoods = Number(process.argv[4] || 50000);
const countryFilter = String(process.argv[5] || '').toLowerCase();

if (!inputPath || !existsSync(inputPath)) {
  console.error('Usage: npm run nutrition:off -- <openfoodfacts-products.csv-or-tsv-or-gz> [output-folder] [max-foods] [country-filter]');
  console.error('Example: npm run nutrition:off -- raw_datasets/openfoodfacts.csv.gz supabase/imports 50000 india');
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });

const csvEscape = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const csvLine = (values) => `${values.map(csvEscape).join(',')}\n`;

const parseDelimitedLine = (line, delimiter) => {
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
    } else if (char === delimiter && !quoted) {
      fields.push(value);
      value = '';
    } else {
      value += char;
    }
  }

  fields.push(value);
  return fields;
};

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

const number = (value) => {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

const firstValue = (row, names) => {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
};

const hasCountry = (row) => {
  if (!countryFilter) return true;
  const text = `${row.countries || ''} ${row.countries_tags || ''} ${row.countries_en || ''}`.toLowerCase();
  return text.includes(countryFilter);
};

const safeName = (row) =>
  String(firstValue(row, ['product_name_en', 'product_name', 'generic_name_en', 'generic_name']) || '')
    .replace(/\s+/g, ' ')
    .trim();

const stream = inputPath.endsWith('.gz')
  ? createReadStream(inputPath).pipe(createGunzip())
  : createReadStream(inputPath);

const rl = createInterface({ input: stream, crlfDelay: Infinity });
const foodsFile = `nutrition_foods_openfoodfacts${countryFilter ? `_${countryFilter.replace(/[^a-z0-9]+/g, '_')}` : ''}.csv`;
const aliasesFile = `nutrition_food_aliases_openfoodfacts${countryFilter ? `_${countryFilter.replace(/[^a-z0-9]+/g, '_')}` : ''}.csv`;
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

let headers = null;
let delimiter = '\t';
let written = 0;
const seenSourceIds = new Set();
const seenAliasKeys = new Set();

const nonHumanFoodPattern = /\b(goat|cattle|cow|buffalo|horse|pig|poultry|chicken|fish|dog|cat|pet|animal)\s+(feed|food|treat|supplement)|\b(feed|fodder|pet food|dog food|cat food|bird food|aquarium)\b/i;

const isHumanFood = (row, name) => {
  const text = [
    name,
    row.generic_name,
    row.generic_name_en,
    row.categories,
    row.categories_en,
    row.labels,
    row.labels_en,
  ].join(' ');

  return !nonHumanFoodPattern.test(text);
};

console.log(`Reading Open Food Facts export ${basename(inputPath)} ...`);

for await (const line of rl) {
  if (!headers) {
    delimiter = line.includes('\t') ? '\t' : ',';
    headers = parseDelimitedLine(line, delimiter);
    continue;
  }
  if (!line.trim() || written >= maxFoods) continue;

  const fields = parseDelimitedLine(line, delimiter);
  const row = {};
  headers.forEach((header, index) => {
    row[header] = fields[index] ?? '';
  });

  if (!hasCountry(row)) continue;
  const name = safeName(row);
  if (!name || name.length < 3 || name.length > 120) continue;
  if (!isHumanFood(row, name)) continue;

  const calories = number(firstValue(row, ['energy-kcal_100g', 'energy-kcal_value']));
  const protein = number(firstValue(row, ['proteins_100g', 'proteins_value']));
  const carbs = number(firstValue(row, ['carbohydrates_100g', 'carbohydrates_value']));
  const fats = number(firstValue(row, ['fat_100g', 'fat_value']));

  if (calories <= 0 || calories > 950 || protein < 0 || carbs < 0 || fats < 0) continue;
  if (protein > 100 || carbs > 100 || fats > 105 || protein + carbs + fats > 115) continue;

  const barcode = String(row.code || row._id || '').trim();
  if (!barcode || seenSourceIds.has(barcode)) continue;
  seenSourceIds.add(barcode);

  const id = stableUuid(`openfoodfacts:${barcode}`);
  const brand = String(firstValue(row, ['brands', 'brand_owner']) || '').split(',')[0]?.trim() || '';
  const category = String(firstValue(row, ['categories_en', 'categories']) || 'branded').split(',')[0]?.trim() || 'branded';

  foodsOut.write(csvLine([
    id,
    name,
    brand,
    category,
    Number(calories.toFixed(1)),
    Number(protein.toFixed(2)),
    Number(carbs.toFixed(2)),
    Number(fats.toFixed(2)),
    'open_food_facts',
    barcode,
    false,
  ]));

  const aliases = new Set([name, brand ? `${brand} ${name}` : '']);
  for (const alias of aliases) {
    const key = searchKey(alias);
    const aliasKey = `${id}:${key}`;
    if (key.length >= 3 && !seenAliasKeys.has(aliasKey)) {
      aliasesOut.write(csvLine([id, alias, key]));
      seenAliasKeys.add(aliasKey);
    }
  }

  written += 1;
}

foodsOut.end();
aliasesOut.end();

console.log(`Done. Wrote ${written} Open Food Facts products.`);
console.log('Import these files into Supabase tables:');
console.log(`- ${toDataRelative(join(outputDir, foodsFile))} -> public.nutrition_foods`);
console.log(`- ${toDataRelative(join(outputDir, aliasesFile))} -> public.nutrition_food_aliases`);
