import { createHash } from 'node:crypto';
import { searchKey, titleCase } from './normalize.mjs';

const round2 = (value) => Number(Number(value).toFixed(2));
const clampPercentage = (value) => round2(Math.max(0, Math.min(100, Number(value) || 0)));

const normalizeItemBounds = (item) => {
  item.percentage = clampPercentage(item.percentage);
  item.minPercentage = clampPercentage(item.minPercentage ?? item.percentage);
  item.maxPercentage = clampPercentage(item.maxPercentage ?? item.percentage);

  if (item.minPercentage > item.percentage) item.minPercentage = item.percentage;
  if (item.maxPercentage < item.percentage) item.maxPercentage = item.percentage;

  return item;
};

export const deterministicUuid = (seed) => {
  const hash = createHash('sha256').update(`healthy-fit-recipe:${seed}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
};

const mean = (values) => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const stdDev = (values) => {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

export class RecipeTemplateGenerator {
  constructor() {
    this.recipesByKey = new Map();
    this.failedRows = [];
    this.stats = {
      raw_recipes_read: 0,
      raw_recipes_discarded: 0,
      canonical_templates_created: 0,
      ingredient_rows_created: 0,
      unresolved_ingredients: 0,
      low_confidence_templates: 0,
    };
  }

  addRecipe(recipe) {
    this.stats.raw_recipes_read += 1;

    if (!recipe?.recipeKey || !recipe.ingredients?.length) {
      this.stats.raw_recipes_discarded += 1;
      this.failedRows.push({
        recipe: recipe?.recipeName || 'unknown',
        reason: 'Missing recipe key or ingredients',
        source_file: recipe?.sourceFile || '',
      });
      return;
    }

    const key = recipe.recipeKey;
    if (!this.recipesByKey.has(key)) {
      this.recipesByKey.set(key, {
        recipeKey: key,
        recipeName: recipe.recipeName,
        searchKey: recipe.searchKey || searchKey(key),
        cuisine: recipe.cuisine || 'indian',
        defaultServingGrams: [],
        sourceKeys: new Set(),
        sourceFiles: new Set(),
        externalIds: [],
        recipes: [],
      });
    }

    const group = this.recipesByKey.get(key);
    group.recipes.push(recipe);
    group.sourceKeys.add(recipe.sourceKey);
    group.sourceFiles.add(recipe.sourceFile);
    if (recipe.externalId) group.externalIds.push(recipe.externalId);
    if (recipe.defaultServingGrams) group.defaultServingGrams.push(recipe.defaultServingGrams);

    if (group.recipes.length === 1) {
      group.cuisine = recipe.cuisine || group.cuisine;
    }
  }

  addFailure(recipeName, reason, sourceFile) {
    this.stats.raw_recipes_discarded += 1;
    this.failedRows.push({ recipe: recipeName, reason, source_file: sourceFile });
  }

  generateTemplates(foodCatalog = new Map()) {
    const templates = [];
    const templateItems = [];
    const sourceLinks = [];

    for (const group of this.recipesByKey.values()) {
      const recipeCount = group.recipes.length;
      const aggregated = aggregateIngredients(group.recipes);
      const confidence = computeTemplateConfidence(recipeCount, aggregated);
      const defaultServing = round2(mean(group.defaultServingGrams) || 250);
      const templateId = deterministicUuid(`template:${group.searchKey}`);

      if (confidence < 0.35) {
        this.stats.low_confidence_templates += 1;
      }

      const canonicalFood = foodCatalog.get(group.searchKey);

      const template = {
        id: templateId,
        canonical_food_id: canonicalFood?.id || '',
        canonical_name: titleCase(group.recipeKey),
        search_key: group.searchKey,
        cuisine: group.cuisine,
        default_serving_grams: defaultServing,
        source_key: [...group.sourceKeys].sort().join('+') || 'recipe_derived',
        confidence,
        recipe_count: recipeCount,
        active: confidence >= 0.35,
      };

      templates.push(template);

      aggregated.forEach((item, index) => {
        templateItems.push({
          id: deterministicUuid(`item:${templateId}:${item.ingredientSearchKey}:${index}`),
          recipe_template_id: templateId,
          recipe_template: template.canonical_name,
          recipe_search_key: template.search_key,
          ingredient_food_id: foodCatalog.get(item.ingredientSearchKey)?.id || '',
          ingredient_name: item.ingredientName,
          ingredient_search_key: item.ingredientSearchKey,
          ingredient_state_key: item.ingredientStateKey,
          percentage: item.percentage,
          min_percentage: item.minPercentage,
          max_percentage: item.maxPercentage,
          required: item.required,
          sort_order: index,
          source_key: template.source_key,
          resolved: item.resolved,
        });

        if (!item.resolved) {
          this.stats.unresolved_ingredients += 1;
        }
      });

      for (const externalId of group.externalIds.slice(0, 5)) {
        sourceLinks.push({
          target_type: 'recipe',
          canonical_name: template.canonical_name,
          search_key: template.search_key,
          source_key: template.source_key,
          external_id: externalId,
          recipe_count: recipeCount,
        });
      }

      this.stats.raw_recipes_discarded += Math.max(0, recipeCount - 1);
    }

    this.stats.canonical_templates_created = templates.length;
    this.stats.ingredient_rows_created = templateItems.length;

    return { templates, templateItems, sourceLinks };
  }
}

const aggregateIngredients = (recipes) => {
  const ingredientMap = new Map();

  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      if (!ingredient.ingredientName || !ingredient.ingredientSearchKey) continue;

      const key = `${ingredient.ingredientSearchKey}|${ingredient.ingredientStateKey || 'unknown'}`;
      if (!ingredientMap.has(key)) {
        ingredientMap.set(key, {
          ingredientName: ingredient.ingredientName,
          ingredientSearchKey: ingredient.ingredientSearchKey,
          ingredientStateKey: ingredient.ingredientStateKey || 'unknown',
          resolved: ingredient.resolved,
          percentages: [],
          minValues: [],
          maxValues: [],
          appearances: 0,
        });
      }

      const bucket = ingredientMap.get(key);
      bucket.percentages.push(ingredient.percentage);
      bucket.minValues.push(ingredient.minPercentage ?? ingredient.percentage);
      bucket.maxValues.push(ingredient.maxPercentage ?? ingredient.percentage);
      bucket.appearances += 1;
      bucket.resolved = bucket.resolved || ingredient.resolved;
    }
  }

  const totalRecipes = recipes.length;
  const aggregated = [...ingredientMap.values()]
    .map((bucket) => {
      const appearanceRate = bucket.appearances / totalRecipes;
      return {
        ingredientName: bucket.ingredientName,
        ingredientSearchKey: bucket.ingredientSearchKey,
        ingredientStateKey: bucket.ingredientStateKey,
        resolved: bucket.resolved,
        percentage: round2(mean(bucket.percentages)),
        minPercentage: round2(Math.min(...bucket.minValues)),
        maxPercentage: round2(Math.max(...bucket.maxValues)),
        required: appearanceRate >= 0.5,
        appearanceRate,
        variance: round2(stdDev(bucket.percentages)),
      };
    })
    .filter((item) => item.percentage > 0)
    .sort((a, b) => b.percentage - a.percentage);

  normalizeAggregatedPercentages(aggregated);
  return aggregated;
};

const normalizeAggregatedPercentages = (items) => {
  const total = items.reduce((sum, item) => sum + item.percentage, 0);
  if (total <= 0) return;
  if (Math.abs(total - 100) < 0.5) {
    items.forEach(normalizeItemBounds);
    return;
  }

  const factor = 100 / total;
  for (const item of items) {
    item.percentage = round2(item.percentage * factor);
    item.minPercentage = round2(item.minPercentage * factor);
    item.maxPercentage = round2(item.maxPercentage * factor);
    normalizeItemBounds(item);
  }
};

const computeTemplateConfidence = (recipeCount, ingredients) => {
  if (!ingredients.length) return 0.2;

  const countFactor = Math.min(1, recipeCount / 10);
  const resolvedRate = ingredients.filter((item) => item.resolved).length / ingredients.length;
  const avgVariance = mean(ingredients.map((item) => item.variance || 0));
  const variancePenalty = Math.min(0.3, avgVariance / 30);
  const requiredRate = ingredients.filter((item) => item.required).length / ingredients.length;

  const confidence = (0.35 * countFactor)
    + (0.35 * resolvedRate)
    + (0.2 * requiredRate)
    + 0.1
    - variancePenalty;

  return round2(Math.max(0.2, Math.min(0.95, confidence)));
};
