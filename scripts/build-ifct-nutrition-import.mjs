import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveFromDataRoot, toDataRelative } from './etl/lib/paths.mjs';

const outputDir = resolveFromDataRoot(process.argv[2] || 'supabase/imports');
const sourceUrl = process.argv[3] || 'https://raw.githubusercontent.com/nodef/ifct2017/main/compositions/index.csv';

mkdirSync(outputDir, { recursive: true });

const csvEscape = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const csvLine = (values) => `${values.map(csvEscape).join(',')}\n`;

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      if (row.some((field) => field !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const kcalFromIfctEnergy = (value) => {
  const energy = number(value);
  if (energy <= 0) return 0;
  return energy / 4.184;
};

const languageAliases = (lang) =>
  String(lang || '')
    .split(';')
    .map((part) => part.trim().replace(/^[A-Za-z]{1,8}\.\s*/, '').trim())
    .filter((part) => part.length >= 3 && part.length <= 80);

console.log(`Downloading IFCT data from ${sourceUrl} ...`);
const response = await fetch(sourceUrl);
if (!response.ok) {
  console.error(`Failed to download IFCT CSV: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const rows = parseCsv(await response.text());
const headers = rows.shift();
const headerIndex = new Map(headers.map((header, index) => [header.trim(), index]));

const valueOf = (row, key) => row[headerIndex.get(key)] ?? '';

const foodsFile = 'nutrition_foods_ifct.csv';
const aliasesFile = 'nutrition_food_aliases_ifct.csv';
let foodsOut = csvLine([
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
]);
let aliasesOut = csvLine(['food_id', 'alias', 'search_key']);
const writtenAliases = new Set();

let written = 0;
for (const row of rows) {
  const code = valueOf(row, 'code').replace(/^"|"$/g, '').trim();
  const name = valueOf(row, 'name').trim();
  if (!code || !name) continue;

  const calories = kcalFromIfctEnergy(valueOf(row, 'enerc'));
  const protein = number(valueOf(row, 'protcnt'));
  const carbs = number(valueOf(row, 'choavldf')) || number(valueOf(row, 'cho'));
  const fats = number(valueOf(row, 'fatce'));

  if (calories <= 0 || calories > 950 || protein < 0 || carbs < 0 || fats < 0) continue;
  if (protein > 100 || carbs > 100 || fats > 105 || protein + carbs + fats > 115) continue;

  const id = stableUuid(`ifct:${code}`);
  foodsOut += csvLine([
    id,
    name,
    '',
    valueOf(row, 'grup') || 'ifct',
    Number(calories.toFixed(1)),
    Number(protein.toFixed(2)),
    Number(carbs.toFixed(2)),
    Number(fats.toFixed(2)),
    'ifct',
    code,
    true,
  ]);

  const aliases = new Set([name, valueOf(row, 'scie'), ...languageAliases(valueOf(row, 'lang'))]);
  for (const alias of aliases) {
    const key = searchKey(alias);
    const aliasKey = `${id}:${key}`;
    if (key.length >= 3 && !writtenAliases.has(aliasKey)) {
      aliasesOut += csvLine([id, alias, key]);
      writtenAliases.add(aliasKey);
    }
  }

  written += 1;
}

writeFileSync(join(outputDir, foodsFile), foodsOut);
writeFileSync(join(outputDir, aliasesFile), aliasesOut);

console.log(`Done. Wrote ${written} IFCT foods.`);
console.log('Import these files into Supabase tables:');
console.log(`- ${toDataRelative(join(outputDir, foodsFile))} -> public.nutrition_foods`);
console.log(`- ${toDataRelative(join(outputDir, aliasesFile))} -> public.nutrition_food_aliases`);
