/**
 * Backend service for Master Nutrition Database recipe templates.
 * Queries master_recipe_templates — does NOT modify photo/manual meal flow.
 * Wire into nutritionEngine when master DB migration is complete.
 */

import { supabase } from '../lib/supabaseClient';
import {
  detectDietaryModifiers,
  filterTemplateItemsByModifiers,
  mergeTemplateItems,
  scoreTemplateCandidate,
} from './nutritionAccuracyRules';

const templateCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

const normalizeKey = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const mapTemplateRow = (row, items, requestedName = '', context = {}) => {
  const modifiers = {
    ...detectDietaryModifiers(requestedName, row?.canonical_name, row?.search_key, context?.category, context?.cuisine),
    ...(context?.modifiers || {}),
  };
  const mappedItems = (items || []).map((item) => ({
    ingredient_name: item.ingredient_name,
    ingredient_search_key: item.ingredient_search_key,
    ingredient_state_key: item.ingredient_state_id ? undefined : undefined,
    ingredient_food_id: item.ingredient_food_id,
    percentage: item.percentage != null && item.percentage !== '' ? Number(item.percentage) : null,
    min_percentage: item.min_percentage != null ? Number(item.min_percentage) : undefined,
    max_percentage: item.max_percentage != null ? Number(item.max_percentage) : undefined,
    required: item.required,
    sort_order: item.sort_order,
  }));
  const compatibleItems = filterTemplateItemsByModifiers(mappedItems, modifiers);
  return {
    id: row.id,
    name: row.canonical_name,
    search_key: row.search_key,
    cuisine: row.cuisine,
    default_serving_grams: row.default_serving_grams,
    confidence: row.confidence,
    recipe_count: row.recipe_count,
    modifiers,
    source: 'recipe_derived',
    sourceTable: 'master_recipe_templates',
    items: mergeTemplateItems(compatibleItems),
  };
};

const classificationCanonicalFor = async (key) => {
  if (!key) return null;

  try {
    const { data, error } = await supabase
      .from('master_food_classifications')
      .select('rules')
      .eq('search_key', key)
      .limit(1);

    if (error) throw error;
    return normalizeKey(data?.[0]?.rules?.canonical || data?.[0]?.rules?.template || '');
  } catch {
    return null;
  }
};

const templateRowsForKey = async (key) => {
  const { data, error } = await supabase
    .from('master_recipe_templates')
    .select('id, canonical_name, search_key, cuisine, default_serving_grams, confidence, recipe_count')
    .eq('active', true)
    .eq('search_key', key)
    .limit(5);

  if (error) throw error;
  return data || [];
};

const rowsWithItems = async (rows, requestedName, context) => {
  const ids = [...new Set((rows || []).map((row) => row.id).filter(Boolean))];
  if (ids.length === 0) return [];

  const { data: items } = await supabase
    .from('master_recipe_template_items')
    .select(`
      recipe_template_id,
      ingredient_name,
      ingredient_search_key,
      ingredient_food_id,
      ingredient_state_id,
      percentage,
      min_percentage,
      max_percentage,
      required,
      sort_order
    `)
    .in('recipe_template_id', ids)
    .order('sort_order');

  const byTemplateId = new Map();
  for (const item of items || []) {
    const list = byTemplateId.get(item.recipe_template_id) || [];
    list.push(item);
    byTemplateId.set(item.recipe_template_id, list);
  }

  return rows.map((row) => mapTemplateRow(row, byTemplateId.get(row.id) || [], requestedName, context));
};

const chooseBestTemplate = (templates, requestedName, context = {}) =>
  (templates || [])
    .map((template) => ({ template, rank: scoreTemplateCandidate(template, requestedName, context) }))
    .sort((a, b) => b.rank.score - a.rank.score || normalizeKey(b.template.search_key).length - normalizeKey(a.template.search_key).length)[0]?.template || null;

/**
 * Look up a canonical recipe template from master_recipe_templates.
 * Falls back to null if master tables are unavailable.
 */
export const masterRecipeTemplateFor = async (foodName, context = {}) => {
  const key = normalizeKey(foodName);
  if (!key) return null;

  const contextKey = normalizeKey([context?.category, context?.cuisine, context?.modifiersText, JSON.stringify(context?.modifiers || {})].filter(Boolean).join(' '));
  const cacheKey = `${key}|${contextKey}`;
  const cached = templateCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.template;
  }

  try {
    let candidateRows = await templateRowsForKey(key);

    if (candidateRows.length === 0) {
      const canonicalKey = await classificationCanonicalFor(key);
      if (canonicalKey && canonicalKey !== key) {
        candidateRows = await templateRowsForKey(canonicalKey);
      }
    }

    if (candidateRows.length === 0) {
      const { data: fuzzyMatch } = await supabase
        .from('master_recipe_templates')
        .select('id, canonical_name, search_key, cuisine, default_serving_grams, confidence, recipe_count')
        .eq('active', true)
        .or(`canonical_name.ilike.%${key}%,search_key.ilike.%${key}%`)
        .limit(10);

      candidateRows = fuzzyMatch || [];
    }

    if (candidateRows.length === 0) {
      templateCache.set(cacheKey, { template: null, timestamp: Date.now() });
      return null;
    }

    const templates = await rowsWithItems(candidateRows, foodName, context);
    const mapped = chooseBestTemplate(templates, foodName, context);
    templateCache.set(cacheKey, { template: mapped, timestamp: Date.now() });
    return mapped;
  } catch {
    return null;
  }
};

/**
 * Expand a master recipe template into ingredient-level nutrition estimates.
 * Uses canonical food profiles — never duplicates nutrition in templates.
 */
export const expandMasterRecipeTemplate = (template, totalGrams, profileResolver) => {
  if (!template?.items?.length || !totalGrams) return [];

  return template.items
    .filter((item) => item.required !== false)
    .map((item) => {
      const ingredientGrams = (totalGrams * item.percentage) / 100;
      const profile = profileResolver?.(item.ingredient_search_key || item.ingredient_name);
      return {
        name: item.ingredient_name,
        search_key: item.ingredient_search_key,
        grams: Math.round(ingredientGrams),
        percentage: item.percentage,
        profile,
        source: 'master_recipe_template',
      };
    });
};

export const clearMasterRecipeTemplateCache = () => templateCache.clear();
