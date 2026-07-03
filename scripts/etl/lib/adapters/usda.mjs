import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { resolveSource } from '../constants.mjs';
import { canonicalKeyFor, normalizeName, searchKey, titleCase } from '../normalize.mjs';
import { inferFoodState, mergeKey } from '../states.mjs';
import { confidenceForSource, isValidNutrition, toNumber } from '../nutrition.mjs';

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

const simplifyName = (description) =>
  String(description || '')
    .replace(/,\s*(raw|cooked|boiled|roasted|grilled|baked)$/i, ' $1')
    .replace(/\s+/g, ' ')
    .trim();

export async function loadUsdaRecords(inputDir, options = {}) {
  const { maxFoods = 50000, mode = 'all' } = options;
  const source = resolveSource('usda_fdc');
  const foodPath = join(inputDir, 'food.csv');
  const nutrientPath = join(inputDir, 'nutrient.csv');
  const foodNutrientPath = join(inputDir, 'food_nutrient.csv');

  for (const path of [foodPath, nutrientPath, foodNutrientPath]) {
    if (!existsSync(path)) {
      throw new Error(`Missing required USDA CSV file: ${path}`);
    }
  }

  const wantedNutrients = new Map([
    ['1008', 'calories_per_100g'],
    ['208', 'calories_per_100g'],
    ['1003', 'protein_per_100g'],
    ['203', 'protein_per_100g'],
    ['1005', 'carbs_per_100g'],
    ['205', 'carbs_per_100g'],
    ['1004', 'fat_per_100g'],
    ['204', 'fat_per_100g'],
  ]);

  const commonDataTypes = new Set(['foundation_food', 'sr_legacy_food', 'survey_fndds_food']);
  const foundationDataTypes = new Set(['foundation_food']);

  const nutrientIdsById = new Map();
  const foods = new Map();
  const macrosByFood = new Map();
  const macroKeysByFood = new Map();

  await readCsv(nutrientPath, (row) => {
    const nutrientNumber = row.number || row.nutrient_nbr;
    if (wantedNutrients.has(nutrientNumber)) {
      nutrientIdsById.set(row.id, wantedNutrients.get(nutrientNumber));
    }
  });

  await readCsv(foodPath, (row) => {
    if (foods.size >= maxFoods) return false;
    const dataType = String(row.data_type || '').trim();
    if (mode === 'common' && !commonDataTypes.has(dataType)) return;
    if (mode === 'foundation' && !foundationDataTypes.has(dataType)) return;
    if (mode === 'all' && dataType === 'experimental_food') return;
    const description = simplifyName(row.description);
    if (!description || description.length > 120) return;
    foods.set(row.fdc_id, {
      fdc_id: row.fdc_id,
      name: description,
      category: row.food_category_id ? 'usda' : row.data_type || 'usda',
      data_type: dataType,
    });
  });

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
      fat_per_100g: 0,
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
      macroKeys.has('fat_per_100g')
    ) {
      completeFoodIds.add(row.fdc_id);
      if (completeFoodIds.size >= maxFoods) return false;
    }
  });

  const records = [];
  for (const [fdcId, food] of foods) {
    const macros = macrosByFood.get(fdcId);
    if (!macros || !isValidNutrition(macros)) continue;

    const { stateKey, stateName, baseName } = inferFoodState(food.name);
    const canonicalKey = canonicalKeyFor(baseName);
    const canonicalName = titleCase(canonicalKey);

    records.push({
      sourceKey: source.sourceKey,
      sourceName: source.sourceName,
      sourcePriority: source.priority,
      externalId: String(fdcId),
      rawName: food.name,
      canonicalName,
      canonicalKey,
      searchKey: searchKey(canonicalName),
      stateKey,
      stateName,
      mergeKey: mergeKey(canonicalKey, stateKey),
      category: food.category,
      cuisine: 'global',
      confidence: confidenceForSource(source.priority),
      servingName: '',
      servingGrams: null,
      aliases: [
        { text: food.name, searchKey: searchKey(food.name), language: 'en', region: '' },
        ...(food.name.includes(',')
          ? [{ text: food.name.split(',')[0].trim(), searchKey: searchKey(food.name.split(',')[0]), language: 'en', region: '' }]
          : []),
      ],
      recipeTemplate: null,
      recipeItems: [],
      rawRecord: { fdc_id: fdcId, description: food.name, data_type: food.data_type },
      isBranded: false,
      ...macros,
    });
  }

  return records;
}
