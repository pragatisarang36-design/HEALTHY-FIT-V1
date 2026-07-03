import { basename, extname } from 'node:path';
import { COLUMN_ALIASES } from './constants.mjs';
import { canonicalKeyFor, findColumn, getField, normalizeName, searchKey, titleCase } from './normalize.mjs';
import { parseRecipeIngredients, toNumber } from './nutrition.mjs';
import { IngredientResolver } from './ingredient-resolver.mjs';
import { parseCsv, parseJsonDataset, parseXlsxDataset } from './csv.mjs';

const RECIPE_NAME_ALIASES = [
  'recipe_name', 'name', 'title', 'dish_name', 'food_name', 'canonical_name', 'recipe_title',
  'recipename', 'translatedrecipename',
];
const INGREDIENT_NAME_ALIASES = [
  'ingredient_name', 'ingredient', 'item', 'food', 'name',
];
const INGREDIENT_AMOUNT_ALIASES = [
  'amount', 'quantity', 'qty', 'weight', 'grams', 'serving_grams',
];
const INGREDIENT_UNIT_ALIASES = [
  'unit', 'measure', 'uom', 'serving_unit',
];
const CUISINE_ALIASES = ['cuisine', 'region_cuisine', 'region'];
const SERVINGS_ALIASES = ['servings', 'yield', 'serves', 'portions'];
const SERVING_GRAMS_ALIASES = ['default_serving_grams', 'serving_grams', 'portion_grams', 'total_grams'];

export const detectRecipeFormat = (row, fileName) => {
  if (findColumn(row, ['recipeingredientparts']) || findColumn(row, ['recipeingredientquantities'])) return 'food_com_csv';
  if (findColumn(row, ['cleaned-ingredients', 'translatedingredients']) && findColumn(row, ['translatedrecipename', 'recipename'])) return 'indian_recipe_csv';
  if (Array.isArray(row.ingredients) || Array.isArray(row.Ingredients)) return 'json_structured';
  if (Array.isArray(row.NER) || Array.isArray(row.ner)) return 'recipenlg';
  if (getField(row, 'recipeIngredients', COLUMN_ALIASES)) return 'inline_percentages';
  if (findColumn(row, INGREDIENT_NAME_ALIASES) && findColumn(row, RECIPE_NAME_ALIASES)) return 'csv_long';
  if (findColumn(row, RECIPE_NAME_ALIASES)) return 'csv_recipe_only';
  return 'unknown';
};

export const parseRecipeFile = (content, filePath, resolver) => {
  const extension = extname(filePath).toLowerCase();
  const sourceFile = basename(filePath);
  const defaultSource = basename(filePath, extension);

  if (extension === '.json') {
    return parseJsonRecipes(parseJsonDataset(content), sourceFile, defaultSource, resolver);
  }

  if (extension === '.xlsx') {
    return parseCsvRecipes(parseXlsxDataset(content), sourceFile, defaultSource, resolver);
  }

  if (extension === '.csv') {
    return parseCsvRecipes(parseCsv(String(content)), sourceFile, defaultSource, resolver);
  }

  return [];
};

const parseJsonRecipes = (rows, sourceFile, defaultSource, resolver) => {
  const recipes = [];

  for (const row of rows) {
    const format = detectRecipeFormat(row, sourceFile);
    if (format === 'json_structured') {
      recipes.push(...parseStructuredJsonRecipe(row, sourceFile, defaultSource, resolver));
    } else if (format === 'recipenlg') {
      recipes.push(parseRecipeNlgRow(row, sourceFile, defaultSource, resolver));
    } else if (format === 'inline_percentages') {
      recipes.push(parseInlinePercentageRow(row, sourceFile, defaultSource, resolver));
    }
  }

  return recipes.filter(Boolean);
};

const parseCsvRecipes = (rows, sourceFile, defaultSource, resolver) => {
  const format = rows.length > 0 ? detectRecipeFormat(rows[0], sourceFile) : 'unknown';

  if (format === 'csv_long') {
    return groupLongFormatRows(rows, sourceFile, defaultSource, resolver);
  }

  return rows
    .map((row) => {
      const rowFormat = detectRecipeFormat(row, sourceFile);
      if (rowFormat === 'food_com_csv') return parseFoodComCsvRow(row, sourceFile, defaultSource, resolver);
      if (rowFormat === 'indian_recipe_csv') return parseIndianRecipeCsvRow(row, sourceFile, defaultSource, resolver);
      if (rowFormat === 'inline_percentages') return parseInlinePercentageRow(row, sourceFile, defaultSource, resolver);
      if (rowFormat === 'json_structured') return parseStructuredJsonRecipe(row, sourceFile, defaultSource, resolver)[0];
      return null;
    })
    .filter(Boolean);
};

const parseListValue = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);

  const text = String(value || '').trim();
  if (!text || text.toUpperCase() === 'NA') return [];

  const vectorMatch = text.match(/^c\(([\s\S]*)\)$/);
  const listText = vectorMatch ? vectorMatch[1] : text;
  const values = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < listText.length; index += 1) {
    const char = listText[index];
    const next = listText[index + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(field.trim().replace(/^"|"$/g, ''));
      field = '';
    } else {
      field += char;
    }
  }

  if (field.trim()) values.push(field.trim().replace(/^"|"$/g, ''));
  return values.filter((item) => item && item.toUpperCase() !== 'NA');
};

const parseFoodComCsvRow = (row, sourceFile, defaultSource, resolver) => {
  const recipeName = String(findColumn(row, ['name', 'recipename', 'recipe_name']) || '').trim();
  if (!recipeName) return null;

  const ingredientParts = parseListValue(findColumn(row, ['recipeingredientparts']));
  const quantities = parseListValue(findColumn(row, ['recipeingredientquantities']));
  const rawIngredients = ingredientParts
    .map((name, index) => {
      const quantity = quantities[index];
      const text = quantity ? `${quantity} ${name}` : name;
      return resolver.parseTextIngredient(text);
    })
    .filter((item) => item?.name);

  return finalizeRecipe({
    recipeName,
    recipeKey: canonicalKeyFor(recipeName),
    cuisine: String(findColumn(row, ['recipecategory', ...CUISINE_ALIASES]) || 'global').trim() || 'global',
    defaultServingGrams: 250,
    sourceFile,
    sourceKey: 'food_com',
    externalId: String(findColumn(row, ['recipeid', 'barcode', 'id', 'external_id']) || '').trim(),
    rawIngredients,
    instructions: parseListValue(findColumn(row, ['recipeinstructions'])),
    category: String(findColumn(row, ['recipecategory']) || '').trim(),
  }, resolver);
};

const parseIndianRecipeCsvRow = (row, sourceFile, defaultSource, resolver) => {
  const recipeName = String(findColumn(row, [
    'translatedrecipename', 'recipename', 'recipe_name', 'name', 'title',
  ]) || '').trim();
  if (!recipeName) return null;

  const ingredientText = findColumn(row, [
    'cleaned-ingredients', 'translatedingredients', 'ingredients', 'recipeingredients',
  ]);
  const rawIngredients = parseListValue(ingredientText)
    .map((text) => resolver.parseTextIngredient(text))
    .filter((item) => item?.name);

  return finalizeRecipe({
    recipeName,
    recipeKey: canonicalKeyFor(recipeName),
    cuisine: String(findColumn(row, CUISINE_ALIASES) || 'indian').trim() || 'indian',
    defaultServingGrams: 250,
    sourceFile,
    sourceKey: /cleaned/i.test(sourceFile) ? 'indian_recipes_cleaned' : 'indian_recipes_6000',
    externalId: String(findColumn(row, ['srno', 'url', 'id', 'external_id']) || '').trim(),
    rawIngredients,
    instructions: String(findColumn(row, ['translatedinstructions', 'instructions']) || '').trim(),
  }, resolver);
};

const groupLongFormatRows = (rows, sourceFile, defaultSource, resolver) => {
  const grouped = new Map();

  for (const row of rows) {
    const recipeName = String(findColumn(row, RECIPE_NAME_ALIASES) || '').trim();
    if (!recipeName) continue;

    const recipeKey = canonicalKeyFor(recipeName);
    if (!grouped.has(recipeKey)) {
      grouped.set(recipeKey, {
        recipeName,
        recipeKey,
        cuisine: String(findColumn(row, CUISINE_ALIASES) || 'indian').trim() || 'indian',
        defaultServingGrams: toNumber(findColumn(row, SERVING_GRAMS_ALIASES)) || 250,
        sourceFile,
        sourceKey: defaultSource,
        externalId: String(row.external_id || row.id || '').trim(),
        rawIngredients: [],
      });
    }

    const ingredientName = String(findColumn(row, INGREDIENT_NAME_ALIASES) || '').trim();
    if (!ingredientName) continue;

    const amount = findColumn(row, INGREDIENT_AMOUNT_ALIASES);
    const unit = findColumn(row, INGREDIENT_UNIT_ALIASES);
    const grams = resolver.parseAmountToGrams(amount, unit || 'g');

    grouped.get(recipeKey).rawIngredients.push({ name: ingredientName, grams });
  }

  return [...grouped.values()].map((recipe) => finalizeRecipe(recipe, resolver));
};

const parseStructuredJsonRecipe = (row, sourceFile, defaultSource, resolver) => {
  const recipeName = String(row.name || row.title || row.recipe_name || row.dish_name || '').trim();
  if (!recipeName) return [];

  const ingredients = row.ingredients || row.Ingredients || [];
  const rawIngredients = ingredients.map((item) => {
    if (typeof item === 'string') return resolver.parseTextIngredient(item);
    const name = item.name || item.ingredient || item.food || item.text || '';
    const grams = item.grams
      ?? resolver.parseAmountToGrams(item.amount ?? item.quantity ?? item.qty, item.unit);
    return { name: String(name).trim(), grams };
  }).filter((item) => item?.name);

  const recipe = {
    recipeName,
    recipeKey: canonicalKeyFor(recipeName),
    cuisine: String(row.cuisine || row.region || 'indian').trim() || 'indian',
    defaultServingGrams: toNumber(row.default_serving_grams ?? row.serving_grams ?? row.total_grams) || 250,
    sourceFile,
    sourceKey: row.source || row.source_key || defaultSource,
    externalId: String(row.id || row.external_id || '').trim(),
    rawIngredients,
  };

  return [finalizeRecipe(recipe, resolver)];
};

const parseRecipeNlgRow = (row, sourceFile, defaultSource, resolver) => {
  const recipeName = String(row.title || row.name || row.recipe_name || '').trim();
  if (!recipeName) return null;

  const ingredientTexts = row.ingredients || row.Ingredients || row.NER || row.ner || [];
  const rawIngredients = (Array.isArray(ingredientTexts) ? ingredientTexts : [ingredientTexts])
    .map((text) => resolver.parseTextIngredient(String(text)))
    .filter((item) => item?.name);

  return finalizeRecipe({
    recipeName,
    recipeKey: canonicalKeyFor(recipeName),
    cuisine: String(row.cuisine || 'indian').trim() || 'indian',
    defaultServingGrams: 250,
    sourceFile,
    sourceKey: row.source || defaultSource,
    externalId: String(row.id || '').trim(),
    rawIngredients,
  }, resolver);
};

const parseInlinePercentageRow = (row, sourceFile, defaultSource, resolver) => {
  const recipeName = String(getField(row, 'foodName', COLUMN_ALIASES) || findColumn(row, RECIPE_NAME_ALIASES) || '').trim();
  if (!recipeName) return null;

  const parsed = parseRecipeIngredients(getField(row, 'recipeIngredients', COLUMN_ALIASES), canonicalKeyFor, titleCase);
  const rawIngredients = parsed.map((item) => ({
    name: item.ingredient_food,
    grams: null,
    percentage: item.percentage,
    minPercentage: item.min_percentage,
    maxPercentage: item.max_percentage,
  }));

  return finalizeRecipe({
    recipeName,
    recipeKey: canonicalKeyFor(recipeName),
    cuisine: String(getField(row, 'cuisine', COLUMN_ALIASES) || 'indian').trim() || 'indian',
    defaultServingGrams: toNumber(getField(row, 'servingGrams', COLUMN_ALIASES)) || 250,
    sourceFile,
    sourceKey: getField(row, 'sourceName', COLUMN_ALIASES) || defaultSource,
    externalId: String(getField(row, 'externalId', COLUMN_ALIASES) || '').trim(),
    rawIngredients,
    hasExplicitPercentages: true,
  }, resolver);
};

const finalizeRecipe = (recipe, resolver) => {
  const ingredients = [];
  let totalGrams = 0;

  for (const raw of recipe.rawIngredients) {
    const resolved = resolver.resolve(raw.name);
    if (!resolved) continue;

    const grams = raw.grams ?? null;
    if (grams) totalGrams += grams * resolved.weight;

    ingredients.push({
      ...resolved,
      grams,
      explicitPercentage: raw.percentage ?? null,
      explicitMin: raw.minPercentage ?? null,
      explicitMax: raw.maxPercentage ?? null,
    });
  }

  if (recipe.hasExplicitPercentages) {
    for (const ingredient of ingredients) {
      if (ingredient.explicitPercentage !== null) {
        ingredient.percentage = ingredient.explicitPercentage;
        ingredient.minPercentage = ingredient.explicitMin ?? ingredient.explicitPercentage;
        ingredient.maxPercentage = ingredient.explicitMax ?? ingredient.explicitPercentage;
      }
    }
  } else {
    assignPercentagesFromGrams(ingredients, totalGrams);
  }

  return {
    recipeName: titleCase(recipe.recipeKey),
    recipeKey: recipe.recipeKey,
    searchKey: searchKey(recipe.recipeKey),
    cuisine: recipe.cuisine,
    defaultServingGrams: recipe.defaultServingGrams,
    sourceFile: recipe.sourceFile,
    sourceKey: normalizeName(recipe.sourceKey).replace(/\s+/g, '_') || 'recipe_derived',
    externalId: recipe.externalId,
    ingredients: ingredients.filter((item) => item.percentage > 0),
    ingredientCount: ingredients.length,
  };
};

const assignPercentagesFromGrams = (ingredients, totalGrams) => {
  if (totalGrams > 0) {
    for (const ingredient of ingredients) {
      const grams = (ingredient.grams || 0) * ingredient.weight;
      ingredient.percentage = Number(((grams / totalGrams) * 100).toFixed(2));
      ingredient.minPercentage = ingredient.percentage;
      ingredient.maxPercentage = ingredient.percentage;
    }
    return;
  }

  const countable = ingredients.filter((item) => !item.isSpice);
  const weightSum = countable.reduce((sum, item) => sum + item.weight, 0) || countable.length || 1;
  for (const ingredient of ingredients) {
    const share = ingredient.isSpice ? 0.5 : ingredient.weight;
    const base = ingredient.isSpice ? 0.5 : (share / weightSum) * 100;
    ingredient.percentage = Number(base.toFixed(2));
    ingredient.minPercentage = ingredient.percentage;
    ingredient.maxPercentage = ingredient.percentage;
  }

  normalizePercentagesTo100(ingredients);
};

const normalizePercentagesTo100 = (ingredients) => {
  const total = ingredients.reduce((sum, item) => sum + item.percentage, 0);
  if (total <= 0) return;
  const factor = 100 / total;
  for (const ingredient of ingredients) {
    ingredient.percentage = Number((ingredient.percentage * factor).toFixed(2));
    ingredient.minPercentage = Number(((ingredient.minPercentage ?? ingredient.percentage) * factor).toFixed(2));
    ingredient.maxPercentage = Number(((ingredient.maxPercentage ?? ingredient.percentage) * factor).toFixed(2));
  }
};
