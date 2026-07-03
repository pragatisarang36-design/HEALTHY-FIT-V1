import { findColumnKey } from './normalize.mjs';

export const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizePer100g = (value, servingGrams) => {
  const number = toNumber(value);
  if (number === null || number < 0) return null;
  const grams = toNumber(servingGrams);
  if (grams && grams > 0 && grams !== 100 && number <= 1000) return number * (100 / grams);
  return number;
};

export const getNutritionField = (row, fieldName, servingGrams, columnAliases) => {
  const aliases = columnAliases[fieldName] || [fieldName];
  const columnKey = findColumnKey(row, aliases);
  const value = columnKey ? row[columnKey] : '';
  if (/_100g$|per_100g|100g/i.test(columnKey)) return toNumber(value);
  return normalizePer100g(value, servingGrams);
};

export const isValidNutrition = (food) => {
  const calories = food.calories_per_100g;
  const protein = food.protein_per_100g;
  const carbs = food.carbs_per_100g;
  const fat = food.fat_per_100g;
  if (![calories, protein, carbs, fat].every((value) => value !== null && Number.isFinite(value))) return false;
  if (calories <= 0 || calories > 950) return false;
  if (protein < 0 || carbs < 0 || fat < 0) return false;
  if (protein > 100 || carbs > 100 || fat > 105) return false;
  if (protein + carbs + fat > 115) return false;
  return true;
};

export const diffNutrition = (left, right) => {
  const keys = ['calories_per_100g', 'protein_per_100g', 'carbs_per_100g', 'fat_per_100g'];
  return Object.fromEntries(keys.map((key) => [key, Number(Math.abs((left[key] || 0) - (right[key] || 0)).toFixed(2))]));
};

export const confidenceForSource = (priority) => {
  if (priority <= 10) return 0.9;
  if (priority <= 30) return 0.85;
  if (priority <= 40) return 0.75;
  if (priority <= 50) return 0.7;
  return 0.65;
};

export const parseRecipeIngredients = (value, canonicalKeyFor, titleCase) =>
  String(value || '')
    .split(/[|;]/)
    .map((part) => {
      const [name, range] = part.split(':').map((item) => item?.trim());
      if (!name || !range) return null;
      const [minRaw, maxRaw] = range.split('-').map((item) => toNumber(item));
      const min = minRaw ?? maxRaw;
      const max = maxRaw ?? minRaw;
      if (min === null || max === null) return null;
      return {
        ingredient_food: titleCase(canonicalKeyFor(name)),
        min_percentage: Math.min(min, max),
        max_percentage: Math.max(min, max),
        percentage: Number(((min + max) / 2).toFixed(2)),
      };
    })
    .filter(Boolean);

export const kcalFromIfctEnergy = (value) => {
  const energy = toNumber(value) ?? 0;
  if (energy <= 0) return 0;
  return energy / 4.184;
};
