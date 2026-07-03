import { COLUMN_ALIASES, resolveSource } from '../constants.mjs';
import {
  canonicalKeyFor,
  getField,
  normalizeName,
  searchKey,
  splitAliases,
  stripBrandPrefix,
  titleCase,
} from '../normalize.mjs';
import { inferFoodState, mergeKey } from '../states.mjs';
import {
  confidenceForSource,
  getNutritionField,
  isValidNutrition,
  parseRecipeIngredients,
  toNumber,
} from '../nutrition.mjs';

export const buildRecordFromRow = (row, context) => {
  const { fileName, rowNumber, sourceOverride } = context;
  const sourceName = String(getField(row, 'sourceName', COLUMN_ALIASES) || sourceOverride?.sourceName || fileName).trim();
  const source = resolveSource(sourceName);
  const rawName = String(getField(row, 'foodName', COLUMN_ALIASES) || '').trim();
  if (!rawName) throw new Error('Missing food name');

  const brand = String(getField(row, 'brand', COLUMN_ALIASES) || '').split(',')[0]?.trim() || '';
  const barcode = String(getField(row, 'barcode', COLUMN_ALIASES) || getField(row, 'externalId', COLUMN_ALIASES) || '').trim();
  const servingGrams = toNumber(getField(row, 'servingGrams', COLUMN_ALIASES));
  const explicitState = String(getField(row, 'stateKey', COLUMN_ALIASES) || '').trim();
  const { stateKey, stateName, baseName } = inferFoodState(rawName, explicitState);

  const canonicalKey = canonicalKeyFor(baseName);
  const canonicalName = titleCase(canonicalKey);
  const isBranded = source.type === 'branded_food' && (
    Boolean(brand || barcode) ||
    /\b(cadbury|amul|nestle|britannia|coke|pepsi|britannia|haldiram|parle)\b/i.test(rawName)
  );

  const nutrition = {
    calories_per_100g: getNutritionField(row, 'calories', servingGrams, COLUMN_ALIASES),
    protein_per_100g: getNutritionField(row, 'protein', servingGrams, COLUMN_ALIASES),
    carbs_per_100g: getNutritionField(row, 'carbs', servingGrams, COLUMN_ALIASES),
    fat_per_100g: getNutritionField(row, 'fat', servingGrams, COLUMN_ALIASES),
    fiber_per_100g: getNutritionField(row, 'fiber', servingGrams, COLUMN_ALIASES),
    water_per_100g: getNutritionField(row, 'water', servingGrams, COLUMN_ALIASES),
  };

  const aliasTexts = [...new Set([rawName, ...splitAliases(getField(row, 'aliases', COLUMN_ALIASES))])].filter(Boolean);
  const aliases = aliasTexts.map((text) => ({
    text,
    searchKey: searchKey(text),
    language: String(getField(row, 'language', COLUMN_ALIASES) || 'unknown').trim() || 'unknown',
    region: String(getField(row, 'region', COLUMN_ALIASES) || '').trim(),
  }));

  const servingName = String(getField(row, 'servingName', COLUMN_ALIASES) || '').trim();
  const recipeItems = parseRecipeIngredients(getField(row, 'recipeIngredients', COLUMN_ALIASES), canonicalKeyFor, titleCase);
  const recipeTemplate = recipeItems.length > 0
    ? {
        canonical_name: canonicalName,
        cuisine: String(getField(row, 'cuisine', COLUMN_ALIASES) || 'indian').trim() || 'indian',
        default_serving_grams: servingGrams || 250,
        confidence: confidenceForSource(source.priority),
        source_key: source.sourceKey,
      }
    : null;

  const baseRecord = {
    sourceKey: source.sourceKey,
    sourceName: source.sourceName,
    sourcePriority: source.priority,
    externalId: String(getField(row, 'externalId', COLUMN_ALIASES) || barcode || '').trim(),
    rawName,
    canonicalName,
    canonicalKey,
    searchKey: searchKey(canonicalName),
    stateKey,
    stateName,
    mergeKey: mergeKey(canonicalKey, stateKey),
    category: String(getField(row, 'category', COLUMN_ALIASES) || '').trim(),
    cuisine: String(getField(row, 'cuisine', COLUMN_ALIASES) || '').trim(),
    confidence: confidenceForSource(source.priority),
    servingName,
    servingGrams,
    aliases,
    recipeTemplate,
    recipeItems,
    rawRecord: row,
    fileName,
    rowNumber,
    ...nutrition,
  };

  if (isBranded) {
    return {
      ...baseRecord,
      isBranded: true,
      brand,
      barcode,
      productName: rawName,
      genericName: stripBrandPrefix(rawName, brand),
    };
  }

  if (!isValidNutrition(baseRecord)) {
    throw new Error('Invalid or missing normalized nutrition values');
  }

  return { ...baseRecord, isBranded: false };
};

export const transformGenericRows = (rows, context) =>
  rows.map((row, index) => ({
    row,
    rowNumber: index + 2,
    record: buildRecordFromRow(row, { ...context, rowNumber: index + 2 }),
  }));
