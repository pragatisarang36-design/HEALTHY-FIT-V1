import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { resolveSource } from '../constants.mjs';
import { parseXlsxDataset } from '../csv.mjs';
import { canonicalKeyFor, searchKey, titleCase } from '../normalize.mjs';
import { confidenceForSource, isValidNutrition, toNumber } from '../nutrition.mjs';
import { inferFoodState, mergeKey } from '../states.mjs';

const REQUIRED_FILES = {
  foods: /Foods and Beverages\.xlsx$/i,
  portions: /Portions and Weights\.xlsx$/i,
  foodIngredients: /FNDDS Ingredients\.xlsx$/i,
  ingredientNutrients: /Ingredient Nutrient Values\.xlsx$/i,
  foodNutrients: /FNDDS Nutrient Values\.xlsx$/i,
};

const normalizeHeader = (value) =>
  String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tableValue = (row, aliases) => {
  const normalized = new Map(
    Object.keys(row).map((key) => [normalizeHeader(key).toLowerCase(), key]),
  );

  for (const alias of aliases) {
    const key = normalized.get(normalizeHeader(alias).toLowerCase());
    if (key) return row[key];
  }

  return '';
};

const firstMatchingValue = (row, patterns) => {
  for (const [key, value] of Object.entries(row)) {
    const header = normalizeHeader(key).toLowerCase();
    if (patterns.some((pattern) => pattern.test(header))) return value;
  }
  return '';
};

const promoteFirstRowToHeaders = (rows) => {
  const headerRow = rows[0];
  if (!headerRow) return [];

  const originalKeys = Object.keys(headerRow);
  const headers = originalKeys.map((key, index) => normalizeHeader(headerRow[key]) || `column_${index}`);

  return rows
    .slice(1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[originalKeys[index]] ?? ''])))
    .filter((row) => Object.values(row).some((value) => String(value || '').trim()));
};

const readFnddsTable = (folderPath, pattern) => {
  const fileName = readdirSync(folderPath).find((name) => pattern.test(name));
  if (!fileName) throw new Error(`Missing FNDDS file matching ${pattern}`);

  const rawRows = parseXlsxDataset(readFileSync(join(folderPath, fileName)));
  return {
    fileName,
    rows: promoteFirstRowToHeaders(rawRows),
  };
};

const buildFoodRecord = ({ code, name, category, servingName, servingGrams, nutrition, source, rawRecord }) => {
  if (!code || !name || !isValidNutrition(nutrition)) return null;

  const { stateKey, stateName, baseName } = inferFoodState(name);
  const canonicalKey = canonicalKeyFor(baseName);
  const canonicalName = titleCase(canonicalKey);

  return {
    sourceKey: source.sourceKey,
    sourceName: source.sourceName,
    sourcePriority: source.priority,
    externalId: String(code).trim(),
    rawName: String(name).trim(),
    canonicalName,
    canonicalKey,
    searchKey: searchKey(canonicalName),
    stateKey,
    stateName,
    mergeKey: mergeKey(canonicalKey, stateKey),
    category: String(category || 'fndds').trim() || 'fndds',
    cuisine: '',
    confidence: confidenceForSource(source.priority),
    servingName: servingName || '100 g',
    servingGrams: servingGrams || 100,
    aliases: [{ text: String(name).trim(), searchKey: searchKey(name), language: 'en', region: 'us' }],
    recipeTemplate: null,
    recipeItems: [],
    rawRecord,
    isBranded: false,
    ...nutrition,
  };
};

const buildFoodMetadata = (rows) => {
  const metadata = new Map();
  for (const row of rows) {
    const code = String(tableValue(row, ['Food code']) || '').trim();
    if (!code) continue;
    metadata.set(code, {
      name: String(tableValue(row, ['Main food description']) || '').trim(),
      category: String(tableValue(row, ['WWEIA Category description']) || '').trim(),
    });
  }
  return metadata;
};

const buildPortions = (rows) => {
  const portions = new Map();
  for (const row of rows) {
    const code = String(tableValue(row, ['Food code']) || '').trim();
    if (!code || portions.has(code)) continue;

    const grams = toNumber(tableValue(row, ['Portion weight (g)', 'Portion weight (g)']));
    const name = String(tableValue(row, ['Portion description']) || '').trim();
    if (grams && name) portions.set(code, { servingName: name, servingGrams: grams });
  }
  return portions;
};

const buildFoodIngredients = (rows) => {
  const ingredients = new Map();
  for (const row of rows) {
    const code = String(tableValue(row, ['Food code']) || '').trim();
    const ingredient = String(tableValue(row, ['Ingredient description']) || '').trim();
    if (!code || !ingredient) continue;
    if (!ingredients.has(code)) ingredients.set(code, []);
    ingredients.get(code).push({
      code: String(tableValue(row, ['Ingredient code']) || '').trim(),
      name: ingredient,
      grams: toNumber(tableValue(row, ['Ingredient weight (g)'])),
    });
  }
  return ingredients;
};

const nutritionFromWideRow = (row) => ({
  calories_per_100g: toNumber(tableValue(row, ['Energy (kcal)'])),
  protein_per_100g: toNumber(tableValue(row, ['Protein (g)'])),
  carbs_per_100g: toNumber(tableValue(row, ['Carbohydrate (g)'])),
  fat_per_100g: toNumber(tableValue(row, ['Total Fat (g)'])),
  fiber_per_100g: toNumber(tableValue(row, ['Fiber, total dietary (g)'])),
  water_per_100g: toNumber(firstMatchingValue(row, [/^water \(g\)$/])),
});

const buildIngredientNutrients = (rows) => {
  const grouped = new Map();

  for (const row of rows) {
    const code = String(tableValue(row, ['Ingredient code']) || '').trim();
    if (!code) continue;

    if (!grouped.has(code)) {
      grouped.set(code, {
        code,
        name: String(tableValue(row, ['Ingredient description']) || '').trim(),
        nutrition: {},
        rawRows: [],
      });
    }

    const entry = grouped.get(code);
    const nutrient = String(tableValue(row, ['Nutrient description']) || '').toLowerCase();
    const value = toNumber(tableValue(row, ['Nutrient value']));
    entry.rawRows.push(row);

    if (value === null) continue;
    if (nutrient === 'energy') entry.nutrition.calories_per_100g = value;
    if (nutrient === 'protein') entry.nutrition.protein_per_100g = value;
    if (nutrient === 'carbohydrate, by difference') entry.nutrition.carbs_per_100g = value;
    if (nutrient === 'total lipid (fat)') entry.nutrition.fat_per_100g = value;
    if (nutrient === 'fiber, total dietary') entry.nutrition.fiber_per_100g = value;
    if (nutrient === 'water') entry.nutrition.water_per_100g = value;
  }

  return [...grouped.values()];
};

export const loadFnddsRecords = (folderPath, options = {}) => {
  if (!existsSync(folderPath)) throw new Error(`FNDDS folder not found: ${folderPath}`);

  const source = resolveSource('fndds');
  const foods = readFnddsTable(folderPath, REQUIRED_FILES.foods);
  const portions = readFnddsTable(folderPath, REQUIRED_FILES.portions);
  const foodIngredients = readFnddsTable(folderPath, REQUIRED_FILES.foodIngredients);
  const ingredientNutrients = readFnddsTable(folderPath, REQUIRED_FILES.ingredientNutrients);
  const foodNutrients = readFnddsTable(folderPath, REQUIRED_FILES.foodNutrients);

  const foodMetadata = buildFoodMetadata(foods.rows);
  const portionByFood = buildPortions(portions.rows);
  const ingredientsByFood = buildFoodIngredients(foodIngredients.rows);
  const records = [];

  for (const row of foodNutrients.rows) {
    const code = String(tableValue(row, ['Food code']) || '').trim();
    const metadata = foodMetadata.get(code) || {};
    const portion = portionByFood.get(code) || {};
    const record = buildFoodRecord({
      code,
      name: tableValue(row, ['Main food description']) || metadata.name,
      category: tableValue(row, ['WWEIA Category description']) || metadata.category,
      servingName: portion.servingName,
      servingGrams: portion.servingGrams,
      nutrition: nutritionFromWideRow(row),
      source,
      rawRecord: {
        file: basename(foodNutrients.fileName),
        food: row,
        ingredients: ingredientsByFood.get(code) || [],
      },
    });
    if (record) records.push(record);
    if (options.maxFoods && records.length >= options.maxFoods) break;
  }

  const maxIngredientFoods = options.maxIngredientFoods ?? 0;
  if (maxIngredientFoods > 0) {
    let ingredientCount = 0;
    for (const ingredient of buildIngredientNutrients(ingredientNutrients.rows)) {
      const record = buildFoodRecord({
        code: ingredient.code,
        name: ingredient.name,
        category: 'fndds ingredient',
        servingName: '100 g',
        servingGrams: 100,
        nutrition: ingredient.nutrition,
        source,
        rawRecord: {
          file: basename(ingredientNutrients.fileName),
          nutrients: ingredient.rawRows,
        },
      });
      if (!record) continue;
      records.push(record);
      ingredientCount += 1;
      if (ingredientCount >= maxIngredientFoods) break;
    }
  }

  return records;
};

export const verifyFnddsTables = (folderPath) =>
  Object.fromEntries(
    Object.entries(REQUIRED_FILES).map(([key, pattern]) => {
      const fileName = readdirSync(folderPath).find((name) => pattern.test(name));
      return [key, Boolean(fileName)];
    }),
  );
