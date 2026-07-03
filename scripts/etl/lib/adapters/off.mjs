import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { resolveSource } from '../constants.mjs';
import { searchKey } from '../normalize.mjs';
import { confidenceForSource, isValidNutrition, toNumber } from '../nutrition.mjs';

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

const firstValue = (row, names) => {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
};

const nonHumanFoodPattern = /\b(goat|cattle|cow|buffalo|horse|pig|poultry|chicken|fish|dog|cat|pet|animal)\s+(feed|food|treat|supplement)|\b(feed|fodder|pet food|dog food|cat food|bird food|aquarium)\b/i;

export async function loadOffRecords(inputPath, options = {}) {
  const { maxFoods = 50000, countryFilter = '' } = options;
  if (!inputPath || !existsSync(inputPath)) {
    throw new Error(`Open Food Facts export not found: ${inputPath}`);
  }

  const source = resolveSource('open_food_facts');
  const stream = inputPath.endsWith('.gz')
    ? createReadStream(inputPath).pipe(createGunzip())
    : createReadStream(inputPath);

  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const records = [];
  const seenBarcodes = new Set();
  let headers = null;
  let delimiter = '\t';

  const hasCountry = (row) => {
    if (!countryFilter) return true;
    const text = `${row.countries || ''} ${row.countries_tags || ''} ${row.countries_en || ''}`.toLowerCase();
    return text.includes(countryFilter.toLowerCase());
  };

  const isHumanFood = (row, name) => {
    const text = [name, row.generic_name, row.generic_name_en, row.categories, row.categories_en, row.labels, row.labels_en].join(' ');
    return !nonHumanFoodPattern.test(text);
  };

  for await (const line of rl) {
    if (!headers) {
      delimiter = line.includes('\t') ? '\t' : ',';
      headers = parseDelimitedLine(line, delimiter);
      continue;
    }
    if (!line.trim() || records.length >= maxFoods) continue;

    const fields = parseDelimitedLine(line, delimiter);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = fields[index] ?? '';
    });

    if (!hasCountry(row)) continue;
    const name = String(firstValue(row, ['product_name_en', 'product_name', 'generic_name_en', 'generic_name']) || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name || name.length < 3 || name.length > 120) continue;
    if (!isHumanFood(row, name)) continue;

    const nutrition = {
      calories_per_100g: toNumber(firstValue(row, ['energy-kcal_100g', 'energy-kcal_value'])) ?? 0,
      protein_per_100g: toNumber(firstValue(row, ['proteins_100g', 'proteins_value'])) ?? 0,
      carbs_per_100g: toNumber(firstValue(row, ['carbohydrates_100g', 'carbohydrates_value'])) ?? 0,
      fat_per_100g: toNumber(firstValue(row, ['fat_100g', 'fat_value'])) ?? 0,
      fiber_per_100g: toNumber(firstValue(row, ['fiber_100g', 'fiber_value'])),
    };

    if (!isValidNutrition(nutrition)) continue;

    const barcode = String(row.code || row._id || '').trim();
    if (!barcode || seenBarcodes.has(barcode)) continue;
    seenBarcodes.add(barcode);

    const brand = String(firstValue(row, ['brands', 'brand_owner']) || '').split(',')[0]?.trim() || 'Unknown';
    const category = String(firstValue(row, ['categories_en', 'categories']) || 'branded').split(',')[0]?.trim() || 'branded';
    const aliasTexts = new Set([name, brand ? `${brand} ${name}` : ''].filter(Boolean));

    records.push({
      isBranded: true,
      sourceKey: source.sourceKey,
      sourceName: source.sourceName,
      sourcePriority: source.priority,
      externalId: barcode,
      barcode,
      brand,
      productName: name,
      canonicalName: name,
      canonicalKey: searchKey(name),
      searchKey: searchKey(name),
      stateKey: 'unknown',
      stateName: 'Unknown',
      mergeKey: `branded:${barcode}`,
      category,
      cuisine: 'global',
      confidence: confidenceForSource(source.priority),
      servingName: String(firstValue(row, ['serving_size']) || '').trim(),
      servingGrams: toNumber(firstValue(row, ['serving_quantity', 'product_quantity'])),
      aliases: [...aliasTexts].map((text) => ({
        text,
        searchKey: searchKey(text),
        language: 'multi',
        region: '',
      })),
      recipeTemplate: null,
      recipeItems: [],
      rawRecord: row,
      rawName: name,
      ...nutrition,
    });
  }

  return records;
}
