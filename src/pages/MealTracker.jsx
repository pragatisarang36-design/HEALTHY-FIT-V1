import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/lib/AuthContext';
import { format } from 'date-fns';
import { ArrowLeft, Camera, Loader2, Pencil, Plus, ScanBarcode, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import GlassCard from '@/components/ui/GlassCard';
import EmptyState from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { analyzeFoodImage, estimateNutrition, retryEstimateNutrition } from '@/services/aiFeatures';
import { calculateMealFromIdentifiedIngredients, estimateIngredientFromFreeSources, estimateNutritionFromFreeSources } from '@/services/nutritionEngine';
import { normalizeSearchKey } from '@/services/foodIntelligence';
import { supabase } from '@/lib/supabaseClient';
import { useEnterSubmit } from '@/hooks/useEnterSubmit';

const MEAL_TYPES = ['breakfast', 'brunch', 'lunch', 'dinner', 'snack'];
const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fats'];

const today = () => format(new Date(), 'yyyy-MM-dd');

const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const readMacro = (nutrition, key) => {
  const macros = nutrition?.nutrition || nutrition?.macros || nutrition?.nutrients || {};
  return Number(firstValue(nutrition?.[key], macros?.[key]));
};

const normalizeNutrition = (nutrition, fallbackName, fallbackQuantity, options = {}) => {
  const ingredients = normalizeIngredients(nutrition?.ingredients);

  const normalized = {
    food_name: String((options.preserveName ? fallbackName : nutrition?.food_name) || fallbackName || 'Meal').trim(),
    quantity: String((options.preserveQuantity ? fallbackQuantity : nutrition?.quantity) || fallbackQuantity || '1 serving').trim(),
    calories: readMacro(nutrition, 'calories'),
    protein: readMacro(nutrition, 'protein'),
    carbs: readMacro(nutrition, 'carbs'),
    fats: readMacro(nutrition, 'fats'),
    ingredients,
  };

  const hasValidMacros =
    normalized.calories > 0 &&
    normalized.protein >= 0 &&
    normalized.carbs >= 0 &&
    normalized.fats >= 0;

  return hasValidMacros ? normalized : null;
};

const normalizeIngredients = (ingredients = []) =>
  Array.isArray(ingredients)
    ? ingredients
        .map((ingredient, index) => ({
          _rowId: ingredient?._rowId || `ingredient-${index}-${Math.random().toString(36).slice(2)}`,
          name: String(ingredient?.name || '').trim(),
          quantity: String(ingredient?.quantity || '').trim(),
          calories: Number(ingredient?.calories) || 0,
          protein: Number(ingredient?.protein) || 0,
          carbs: Number(ingredient?.carbs) || 0,
          fats: Number(ingredient?.fats) || 0,
          source: ingredient?.source || '',
          visible_share_percent: ingredient?.visible_share_percent,
          portion_confidence: ingredient?.portion_confidence || ingredient?.confidence || '',
          _needsCalculation: ingredient?._needsCalculation === true,
          _needsQuantity: ingredient?._needsQuantity === true,
          resolved: ingredient?.resolved !== false && ingredient?._needsCalculation !== true && ingredient?._needsQuantity !== true,
        }))
        .filter((ingredient) => ingredient.name || ingredient.quantity)
    : [];

const zeroNutrition = (foodName, quantity) => ({
  food_name: String(foodName || 'Meal').trim(),
  quantity: String(quantity || '1 serving').trim(),
  calories: 0,
  protein: 0,
  carbs: 0,
  fats: 0,
});

const hasManualMacros = (manualMacros) =>
  ['calories', 'protein', 'carbs', 'fats'].some((key) => manualMacros[key] !== '');

const hasIngredients = (meal) => normalizeIngredients(meal?.ingredients).length > 0;

const macroDisplay = (value, suffix = '') => {
  const number = Number(value);
  return Number.isFinite(number) ? `${suffix === ' kcal' ? Math.round(number) : number.toFixed(1)}${suffix}` : 'unknown';
};

const mealHasUnresolvedIngredients = (meal) =>
  normalizeIngredients(meal?.ingredients).some((ingredient) =>
    ingredient.resolved === false ||
    ingredient._needsCalculation ||
    ingredient._needsQuantity
  );

const hasCompleteTopLevelMacros = (meal) =>
  Number(meal?.calories) > 0 &&
  MACRO_KEYS.every((key) => {
    const value = Number(meal?.[key]);
    return Number.isFinite(value) && value >= 0;
  });

const hasManualResolvedTotals = (meal) =>
  meal?._manualMacroOverride === true &&
  meal?.resolved === true &&
  hasCompleteTopLevelMacros(meal);

const mealNeedsQuantity = (meal) =>
  meal?.source === 'needs_quantity' ||
  normalizeIngredients(meal?.ingredients).some((ingredient) => ingredient._needsQuantity);

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read image file'));
    reader.readAsDataURL(file);
  });

const normalizeFoodName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');

const normalizeQuantity = (value) =>
  String(value || '1 serving')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const quantityWords = /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|servings?|pieces?|slices?|cups?|tbsp|tablespoons?|tsp|teaspoons?|grams?|g|ml|litres?|liters?|bowls?|plates?)\b/i;
const leadingQuantity = /^\s*(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;

const safeCorrectedLabel = (userLabel, aiLabel) => {
  const userText = String(userLabel || '').trim();
  const aiText = String(aiLabel || '').trim();
  if (!aiText) return userText;

  const aiAddedQuantity =
    leadingQuantity.test(aiText) ||
    (quantityWords.test(aiText) && !quantityWords.test(userText));
  if (aiAddedQuantity) return userText;

  return aiText;
};

const sourceLabelFor = (source) => {
  if (source === 'recipe_template') return 'Recipe template estimate';
  if (source === 'photo_recipe_template') return 'Photo + recipe template estimate';
  if (source === 'photo_proportion_estimate') return 'Photo proportion estimate';
  if (source === 'photo_identification' || source === 'ai_photo') return 'AI photo estimate';
  if (source === 'local_db' || source === 'local_db_ai_fallback') return 'Nutrition database estimate';
  if (source === 'needs_quantity') return 'Needs quantity';
  if (source === 'saved_estimate') return 'Saved estimate';
  return 'AI estimate';
};

const explicitFatMacros = {
  oil: { caloriesPerTbsp: 120, fatPerTbsp: 14 },
  ghee: { caloriesPerTbsp: 112, fatPerTbsp: 12.7 },
  butter: { caloriesPerTbsp: 102, fatPerTbsp: 11.5 },
};

const extractExplicitFatIngredients = (text) => {
  const source = String(text || '').toLowerCase();
  const matches = [...source.matchAll(/(\d+(?:\.\d+)?)\s*(tbsp|tablespoons?|tsp|teaspoons?)\s*(?:of\s+)?(oil|ghee|butter)\b/g)];

  return matches.map((match) => {
    const amount = Number(match[1]) || 0;
    const unit = match[2].startsWith('tsp') || match[2].startsWith('tea') ? 'tsp' : 'tbsp';
    const ingredient = match[3];
    const tbspAmount = unit === 'tsp' ? amount / 3 : amount;
    const macros = explicitFatMacros[ingredient];

    return {
      _rowId: crypto.randomUUID(),
      name: ingredient,
      quantity: `${amount} ${unit}`,
      calories: Math.round(macros.caloriesPerTbsp * tbspAmount),
      protein: 0,
      carbs: 0,
      fats: Number((macros.fatPerTbsp * tbspAmount).toFixed(1)),
      _needsCalculation: false,
    };
  });
};

const mergeExplicitIngredients = (ingredients, explicitIngredients) => {
  const merged = [...normalizeIngredients(ingredients)];

  for (const explicitIngredient of explicitIngredients) {
    const key = `${explicitIngredient.name}:${explicitIngredient.quantity}`.toLowerCase();
    const exists = merged.some((ingredient) =>
      `${ingredient.name}:${ingredient.quantity}`.toLowerCase() === key ||
      (ingredient.name.toLowerCase().includes(explicitIngredient.name) && ingredient.quantity.toLowerCase() === explicitIngredient.quantity)
    );

    if (!exists) merged.push(explicitIngredient);
  }

  return merged;
};

const enforceExplicitUserComponents = (nutrition, userText) => {
  const explicitIngredients = extractExplicitFatIngredients(userText);
  if (explicitIngredients.length === 0) return nutrition;

  const ingredients = mergeExplicitIngredients(nutrition?.ingredients, explicitIngredients);
  return withIngredientTotals({ ...nutrition }, ingredients);
};

const editableMacroValue = (value, key) => {
  if (value === '' || value === null || value === undefined) return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return key === 'calories' ? String(Math.round(number)) : String(number);
};

const editableMeal = (meal) => ({
  ...meal,
  food_name: meal.food_name || 'Meal',
  quantity: meal.quantity || '1 serving',
  calories: editableMacroValue(meal.calories, 'calories'),
  protein: editableMacroValue(meal.protein, 'protein'),
  carbs: editableMacroValue(meal.carbs, 'carbs'),
  fats: editableMacroValue(meal.fats, 'fats'),
  ingredients: Array.isArray(meal.ingredients) ? meal.ingredients : [],
  source: meal.source || 'manual',
  sourceLabel: meal.sourceLabel || 'Manual',
  confidence: meal.confidence,
  assumptionSource: meal.assumptionSource || '',
  resolved: meal.resolved !== false && !mealHasUnresolvedIngredients(meal),
});

const ingredientTotals = (ingredients = []) =>
  normalizeIngredients(ingredients).reduce(
    (totals, ingredient) => ({
      calories: totals.calories + Number(ingredient.calories || 0),
      protein: totals.protein + Number(ingredient.protein || 0),
      carbs: totals.carbs + Number(ingredient.carbs || 0),
      fats: totals.fats + Number(ingredient.fats || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );

const withIngredientTotals = (meal, ingredients) => {
  const totals = ingredientTotals(ingredients);
  const resolved = ingredients.every((ingredient) =>
    ingredient?.resolved !== false &&
    ingredient?._needsCalculation !== true &&
    ingredient?._needsQuantity !== true
  );
  return {
    ...meal,
    ingredients,
    calories: String(Math.round(totals.calories)),
    protein: String(Number(totals.protein.toFixed(1))),
    carbs: String(Number(totals.carbs.toFixed(1))),
    fats: String(Number(totals.fats.toFixed(1))),
    resolved,
  };
};

const toNumberMacros = (meal) => ({
  ...meal,
  calories: Number(meal.calories) || 0,
  protein: Number(meal.protein) || 0,
  carbs: Number(meal.carbs) || 0,
  fats: Number(meal.fats) || 0,
  ingredients: normalizeIngredients(meal.ingredients),
  resolved: meal.resolved === true || !mealHasUnresolvedIngredients(meal),
});

const parseGrams = (quantityText, fallback = 100) => {
  const match = String(quantityText || '').match(/(\d+(?:\.\d+)?)\s*(g|gram|grams|ml|milliliter|milliliters)/i);
  return match ? Number(match[1]) : fallback;
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
};

const per100FromServing = (value, servingQuantity) => {
  const number = Number(value);
  const grams = Number(servingQuantity);
  if (!Number.isFinite(number) || !Number.isFinite(grams) || grams <= 0) return null;
  return (number * 100) / grams;
};

const energyKcalPer100g = (nutriments, servingQuantity) => {
  const kcal = firstFiniteNumber(
    nutriments['energy-kcal_100g'],
    nutriments['energy_kcal_100g'],
    nutriments['energy-kcal'],
    nutriments['energy_kcal'],
    per100FromServing(nutriments['energy-kcal_serving'], servingQuantity),
    per100FromServing(nutriments['energy_kcal_serving'], servingQuantity)
  );
  if (kcal > 0) return kcal;

  const kj = firstFiniteNumber(
    nutriments.energy_100g,
    nutriments['energy-kj_100g'],
    nutriments['energy_kj_100g'],
    nutriments.energy,
    nutriments['energy-kj'],
    nutriments['energy_kj'],
    per100FromServing(nutriments.energy_serving, servingQuantity),
    per100FromServing(nutriments['energy-kj_serving'], servingQuantity),
    per100FromServing(nutriments['energy_kj_serving'], servingQuantity)
  );
  return kj > 0 ? kj / 4.184 : 0;
};

const scalePer100g = (product, quantityText) => {
  const grams = parseGrams(quantityText, Number(product.serving_quantity) || 100);
  const multiplier = grams / 100;
  return {
    calories: Math.round((Number(product.calories_per_100g) || 0) * multiplier),
    protein: Number(((Number(product.protein_per_100g) || 0) * multiplier).toFixed(1)),
    carbs: Number(((Number(product.carbs_per_100g) || 0) * multiplier).toFixed(1)),
    fats: Number(((Number(product.fats_per_100g) || 0) * multiplier).toFixed(1)),
  };
};

const macrosToPer100g = (meal) => {
  const grams = parseGrams(meal.quantity, 100);
  const multiplier = grams > 0 ? 100 / grams : 1;
  return {
    calories_per_100g: Math.round((Number(meal.calories) || 0) * multiplier),
    protein_per_100g: Number(((Number(meal.protein) || 0) * multiplier).toFixed(1)),
    carbs_per_100g: Number(((Number(meal.carbs) || 0) * multiplier).toFixed(1)),
    fats_per_100g: Number(((Number(meal.fats) || 0) * multiplier).toFixed(1)),
  };
};

const hasUsablePer100gNutrition = (product) =>
  Number(product?.calories_per_100g) > 0 &&
  (
    Number(product?.protein_per_100g) > 0 ||
    Number(product?.carbs_per_100g) > 0 ||
    Number(product?.fats_per_100g) > 0
  );

const productFromMasterBrandedRow = (row, source = 'master_branded_foods') => row && ({
  barcode: row.barcode || '',
  product_name: row.product_name || 'Product',
  brand: row.brand || '',
  serving_size: row.serving_size || '100g',
  serving_quantity: 100,
  calories_per_100g: Number(row.calories_per_100g) || 0,
  protein_per_100g: Number(row.protein_per_100g) || 0,
  carbs_per_100g: Number(row.carbs_per_100g) || 0,
  fats_per_100g: Number(row.fat_per_100g) || 0,
  source,
  confidence: Number(row.confidence) || 0.75,
});

const lookupMasterBrandedByBarcode = async (barcodeValue) => {
  try {
    const { data, error } = await supabase
      .from('master_branded_foods')
      .select('*')
      .eq('barcode', barcodeValue)
      .limit(1);
    if (error) throw error;

    console.info('[BARCODE FALLBACK] exact barcode lookup', { barcodeValue, rowsFound: data?.length || 0 });

    const product = productFromMasterBrandedRow(data?.[0], 'master_branded_barcode');
    return hasUsablePer100gNutrition(product) ? product : null;
  } catch (error) {
    console.error('[BARCODE FALLBACK] exact barcode lookup FAILED', { barcodeValue, error: error?.message || error, code: error?.code, details: error?.details, hint: error?.hint });
    return null;
  }
};

const barcodeFallbackTokens = (product) =>
  [...new Set(
    normalizeSearchKey(`${product?.brand || ''} ${product?.product_name || ''}`)
      .split(' ')
      .filter((token) => token.length >= 3)
      .filter((token) => !['the', 'and', 'with', 'pack', 'product'].includes(token))
  )];

const brandedFallbackScore = (row, product, tokens) => {
  const text = normalizeSearchKey(`${row.brand || ''} ${row.product_name || ''}`);
  const productName = normalizeSearchKey(product?.product_name || '');
  const brand = normalizeSearchKey(product?.brand || '');
  const overlap = tokens.filter((token) => text.includes(token)).length;
  if (overlap === 0) return null;

  let score = overlap * 10;
  if (productName && text.includes(productName)) score += 30;
  if (brand && normalizeSearchKey(row.brand || '').includes(brand)) score += 15;
  if (Number(row.calories_per_100g) <= 0) score -= 100;
  score -= Math.max(0, normalizeSearchKey(row.product_name || '').length - productName.length) / 20;
  return score;
};

const lookupMasterBrandedByProductText = async (product) => {
  const tokens = barcodeFallbackTokens(product);
  console.info('[BARCODE FALLBACK] fuzzy tokens', { product: product?.product_name, brand: product?.brand, tokens });
  if (tokens.length === 0) return null;

  try {
    const tokenQueries = tokens.slice(0, 8);
    const rowsById = new Map();
    const queryResults = [];

    for (const token of tokenQueries) {
      const productQuery = await supabase
        .from('master_branded_foods')
        .select('*')
        .ilike('product_name', `%${token}%`)
        .limit(25);
      if (productQuery.error) throw productQuery.error;
      for (const row of productQuery.data || []) rowsById.set(row.id || `${row.barcode}:${row.product_name}`, row);
      queryResults.push({ token, field: 'product_name', rows: productQuery.data?.length || 0 });

      const brandQuery = await supabase
        .from('master_branded_foods')
        .select('*')
        .ilike('brand', `%${token}%`)
        .limit(25);
      if (brandQuery.error) throw brandQuery.error;
      for (const row of brandQuery.data || []) rowsById.set(row.id || `${row.barcode}:${row.product_name}`, row);
      queryResults.push({ token, field: 'brand', rows: brandQuery.data?.length || 0 });
    }

    const data = [...rowsById.values()];

    const scored = (data || [])
      .map((row) => ({ row, score: brandedFallbackScore(row, product, tokens) }))
      .filter((entry) => entry.score !== null)
      .sort((a, b) => b.score - a.score);

    console.info('[BARCODE FALLBACK] fuzzy candidates', {
      queryResults,
      candidatesReturned: data?.length || 0,
      topScored: scored.slice(0, 5).map((entry) => ({ name: entry.row.product_name, brand: entry.row.brand, score: entry.score })),
    });

    const best = scored[0];
    if (!best) {
      console.warn('[BARCODE FALLBACK] no candidate had any token overlap');
      return null;
    }
    if (best.score < 18) {
      console.warn('[BARCODE FALLBACK] best candidate scored below threshold', { name: best.row.product_name, score: best.score });
      return null;
    }
    const fallback = productFromMasterBrandedRow(best.row, 'master_branded_fuzzy');
    if (!hasUsablePer100gNutrition(fallback)) {
      console.warn('[BARCODE FALLBACK] best candidate had no usable macros', { name: best.row.product_name });
      return null;
    }
    return { ...fallback, confidence: Math.min(Number(fallback.confidence) || 0.75, 0.62) };
  } catch (error) {
    console.error('[BARCODE FALLBACK] fuzzy lookup FAILED', { error: error?.message || error, code: error?.code, details: error?.details, hint: error?.hint });
    return null;
  }
};

const lookupGenericNutritionProduct = async (product) => {
  const name = [product?.brand, product?.product_name].filter(Boolean).join(' ') || product?.product_name;
  if (!name) return null;

  try {
    const nutrition = await estimateNutritionFromFreeSources(name, '100g');
    console.info('[BARCODE FALLBACK] generic resolver result', { name, nutrition: nutrition ? { calories: nutrition.calories, source: nutrition.source } : null });
    if (!nutrition || Number(nutrition.calories) <= 0) return null;

    return {
      barcode: product?.barcode || '',
      product_name: product?.product_name || nutrition.food_name || 'Product',
      brand: product?.brand || '',
      serving_size: product?.serving_size || '100g',
      serving_quantity: 100,
      calories_per_100g: Number(nutrition.calories) || 0,
      protein_per_100g: Number(nutrition.protein) || 0,
      carbs_per_100g: Number(nutrition.carbs) || 0,
      fats_per_100g: Number(nutrition.fats) || 0,
      source: nutrition.source ? `generic_fallback:${nutrition.source}` : 'generic_nutrition_fallback',
      confidence: Math.min(Number(nutrition.confidence) || 0.6, 0.58),
    };
  } catch (error) {
    console.error('[BARCODE FALLBACK] generic resolver FAILED', { name, error: error?.message || error });
    return null;
  }
};

const resolveBarcodeNutritionFallback = async (product, barcodeValue) => {
  const exactMaster = await lookupMasterBrandedByBarcode(barcodeValue);
  if (exactMaster) return { product: exactMaster, label: 'Master nutrition barcode match' };

  const brandedFallback = await lookupMasterBrandedByProductText(product);
  if (brandedFallback) return { product: brandedFallback, label: 'Master branded fallback' };

  const genericFallback = await lookupGenericNutritionProduct(product);
  if (genericFallback) return { product: genericFallback, label: 'Nutrition database fallback' };

  console.warn('[BARCODE FALLBACK] all dataset fallbacks exhausted, no macros found', { product: product?.product_name, barcodeValue });
  return null;
};

const openFoodFactsProduct = async (barcode) => {
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`, {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Barcode lookup failed. Please try again.');
  const data = await response.json();
  if (data.status !== 1 || !data.product) return null;

  const nutriments = data.product.nutriments || {};
  const servingQuantity = Number(data.product.serving_quantity) || 100;
  return {
    barcode,
    product_name: data.product.product_name || data.product.generic_name || 'Product',
    brand: data.product.brands || '',
    serving_size: data.product.serving_size || '100g',
    serving_quantity: servingQuantity,
    calories_per_100g: Math.round(energyKcalPer100g(nutriments, servingQuantity)),
    protein_per_100g: firstFiniteNumber(
      nutriments.proteins_100g,
      nutriments.protein_100g,
      per100FromServing(nutriments.proteins_serving, servingQuantity),
      per100FromServing(nutriments.protein_serving, servingQuantity)
    ),
    carbs_per_100g: firstFiniteNumber(
      nutriments.carbohydrates_100g,
      nutriments.carbs_100g,
      per100FromServing(nutriments.carbohydrates_serving, servingQuantity),
      per100FromServing(nutriments.carbs_serving, servingQuantity)
    ),
    fats_per_100g: firstFiniteNumber(
      nutriments.fat_100g,
      nutriments.fats_100g,
      per100FromServing(nutriments.fat_serving, servingQuantity),
      per100FromServing(nutriments.fats_serving, servingQuantity)
    ),
    source: 'open_food_facts',
  };
};

export default function MealTracker() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [showAdd, setShowAdd] = useState(false);
  const [addTab, setAddTab] = useState('text');
  const [mealType, setMealType] = useState('breakfast');
  const [customMealType, setCustomMealType] = useState('');

  const [foodName, setFoodName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [mealNotes, setMealNotes] = useState('');
  const [manualMacros, setManualMacros] = useState({ calories: '', protein: '', carbs: '', fats: '' });
  const [estimateNotice, setEstimateNotice] = useState(null);
  const [processing, setProcessing] = useState(false);

  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [imageProcessing, setImageProcessing] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [barcodeQuantity, setBarcodeQuantity] = useState('');
  const [barcodeProcessing, setBarcodeProcessing] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerStatus, setScannerStatus] = useState('');
  const [pendingMeal, setPendingMeal] = useState(null);
  const [editingIngredients, setEditingIngredients] = useState({});
  const [calculatingIngredients, setCalculatingIngredients] = useState({});
  const [pendingMealDirty, setPendingMealDirty] = useState(false);
  const [reviewChangedLog, setReviewChangedLog] = useState(false);
  const [savingPending, setSavingPending] = useState(false);
  const [fullscreenPhoto, setFullscreenPhoto] = useState('');
  const scannerVideoRef = useRef(null);
  const scannerControlsRef = useRef(null);
  const scannerLockedRef = useRef(false);

  const queryKey = ['meals', user?.id, today()];

  // FETCH FROM SUPABASE
  const { data: meals = [] } = useQuery({
    queryKey,
    queryFn: () => dataService.entities.Meal.filter({ date: today(), created_by: user?.email }, '-created_date'),
    enabled: !!user?.email,
  });

  useEffect(() => {
    if (!showScanner) {
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
      setScannerActive(false);
      setScannerStatus('');
      scannerLockedRef.current = false;
      return undefined;
    }

    let cancelled = false;

    const startScanner = async () => {
      try {
        const constraints = {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        };

        if ('BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia) {
          setScannerActive(true);
          setScannerStatus('Point the camera at the barcode. Native scanner is active.');
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (cancelled) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }

          const video = scannerVideoRef.current;
          video.srcObject = stream;
          await video.play();

          const detector = new window.BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
          });
          const scanInterval = window.setInterval(async () => {
            if (scannerLockedRef.current || !video.videoWidth) return;
            try {
              const codes = await detector.detect(video);
              const scannedValue = codes?.[0]?.rawValue?.replace(/\D/g, '');
              if (!scannedValue) return;
              scannerLockedRef.current = true;
              setBarcode(scannedValue);
              setShowScanner(false);
              toast({ title: 'Barcode scanned', description: scannedValue });
              handleBarcodeLookup(scannedValue);
            } catch {
              // Keep scanning frames until the user cancels or a code is found.
            }
          }, 250);

          scannerControlsRef.current = {
            stop: () => {
              window.clearInterval(scanInterval);
              stream.getTracks().forEach((track) => track.stop());
              if (video) video.srcObject = null;
            },
          };
          return;
        }

        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled) return;
        const { BarcodeFormat, DecodeHintType } = await import('@zxing/library');
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
        setScannerActive(true);
        setScannerStatus('Point the camera at the barcode. ZXing scanner is active.');
        scannerControlsRef.current = await reader.decodeFromConstraints(
          constraints,
          scannerVideoRef.current,
          (result) => {
            const scannedValue = result?.getText?.()?.replace(/\D/g, '');
            if (!scannedValue || scannerLockedRef.current) return;
            scannerLockedRef.current = true;
            setBarcode(scannedValue);
            setShowScanner(false);
            toast({ title: 'Barcode scanned', description: scannedValue });
            handleBarcodeLookup(scannedValue);
          }
        );
      } catch (error) {
        if (!cancelled) {
          setShowScanner(false);
          setScannerActive(false);
          setScannerStatus('');
          toast({
            title: 'Camera scanner unavailable',
            description: 'Enter the barcode number manually.',
            variant: 'destructive',
          });
        }
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
      scannerLockedRef.current = false;
      setScannerActive(false);
      setScannerStatus('');
    };
  }, [showScanner]);

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl('');
      setImageDataUrl('');
      return undefined;
    }

    let cancelled = false;
    const previewUrl = URL.createObjectURL(imageFile);
    setImagePreviewUrl(previewUrl);
    fileToDataUrl(imageFile)
      .then((dataUrl) => {
        if (!cancelled) setImageDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setImageDataUrl('');
      });
    return () => {
      cancelled = true;
      URL.revokeObjectURL(previewUrl);
    };
  }, [imageFile]);

  const saveMeal = async (meal) => {
    return dataService.entities.Meal.create({
      ...meal,
      date: today(),
    });
  };

  const lookupFoodEstimate = async (name, quantityText) => {
    try {
      const normalizedName = normalizeFoodName(name);
      const normalizedQty = normalizeQuantity(quantityText);
      const estimates = await dataService.entities.FoodEstimate.filter({ normalized_name: normalizedName }, '-updated_date', 25);
      return estimates.find((estimate) => normalizeQuantity(estimate.quantity) === normalizedQty) || null;
    } catch (error) {
      console.warn('Food estimate lookup skipped:', error?.message || error);
      return null;
    }
  };

  const saveFoodEstimate = async (meal, source = 'manual') => {
    try {
      const normalizedName = normalizeFoodName(meal.food_name);
      const normalizedQty = normalizeQuantity(meal.quantity);
      const existing = await lookupFoodEstimate(meal.food_name, meal.quantity);
      const payload = {
        ...toNumberMacros(meal),
        normalized_name: normalizedName,
        quantity: meal.quantity || normalizedQty,
        source,
        verified_by_user: true,
        times_used: Number(existing?.times_used || 0) + 1,
      };

      if (existing?.id) {
        await dataService.entities.FoodEstimate.update(existing.id, payload);
      } else {
        await dataService.entities.FoodEstimate.create(payload);
      }
    } catch (error) {
      console.warn('Could not save reusable food estimate:', error?.message || error);
    }
  };

  const enrichMissingIngredients = async (meal) => {
    if (hasIngredients(meal)) return meal;

    const datasetResult = await estimateNutritionFromFreeSources(meal.food_name, meal.quantity);
    let ingredients = normalizeIngredients(datasetResult?.ingredients);

    if (ingredients.length === 0) {
      let result = await estimateNutrition(meal.food_name, meal.quantity);
      if (!result) result = await retryEstimateNutrition(meal.food_name, meal.quantity);
      ingredients = normalizeIngredients(result?.ingredients);
    }

    if (ingredients.length === 0) return meal;

    const enrichedMeal = { ...meal, ingredients };
    await saveFoodEstimate(enrichedMeal, meal.source || 'saved_estimate');
    return enrichedMeal;
  };

  const lookupCustomProduct = async (barcodeValue) => {
    try {
      const rows = await dataService.entities.CustomProduct.filter({ barcode: barcodeValue }, '-updated_date', 1);
      return rows[0] || null;
    } catch (error) {
      console.warn('Custom product lookup skipped:', error?.message || error);
      return null;
    }
  };

  const saveCustomProduct = async (product) => {
    try {
      const existing = await lookupCustomProduct(product.barcode);
      if (existing?.id) {
        await dataService.entities.CustomProduct.update(existing.id, product);
      } else {
        await dataService.entities.CustomProduct.create(product);
      }
    } catch (error) {
      console.warn('Could not save custom product:', error?.message || error);
    }
  };

  const stageMealForConfirmation = (meal, sourceLabel, options = {}) => {
    setPendingMeal(editableMeal({ ...meal, sourceLabel, photoPreviewUrl: options.photoPreviewUrl || meal.photoPreviewUrl || '' }));
    setEditingIngredients({});
    setPendingMealDirty(false);
    setReviewChangedLog(false);
    setEstimateNotice(null);
    setShowAdd(false);
  };

  const returnToLogMeal = () => {
    setPendingMeal(null);
    setReviewChangedLog(false);
    setPendingMealDirty(false);
    setShowAdd(true);
  };

  const updatePendingField = (field, value) => {
    setPendingMeal((meal) => ({
      ...meal,
      [field]: value,
      ...(MACRO_KEYS.includes(field) ? { resolved: true, _manualMacroOverride: true } : {}),
    }));
    setPendingMealDirty(true);
    setReviewChangedLog(false);
  };

  const updatePendingIngredient = (index, key, value) => {
    setPendingMeal((meal) => {
      const ingredients = [...(meal?.ingredients || [])];
      ingredients[index] = {
        ...ingredients[index],
        [key]: value,
        ...(key === 'name' || key === 'quantity' ? { _needsCalculation: true, _needsQuantity: false, resolved: false } : {}),
        ...(MACRO_KEYS.includes(key) ? { _needsCalculation: false, _needsQuantity: false, resolved: true } : {}),
      };
      return MACRO_KEYS.includes(key) ? withIngredientTotals(meal, ingredients) : { ...meal, ingredients };
    });
    setPendingMealDirty(true);
    setReviewChangedLog(false);
  };

  const addPendingIngredient = () => {
    const nextIndex = pendingMeal?.ingredients?.length || 0;
    setEditingIngredients((rows) => ({ ...rows, [nextIndex]: true }));
    setPendingMeal((meal) => ({
      ...meal,
      ingredients: [
        ...(meal?.ingredients || []),
        { _rowId: crypto.randomUUID(), name: '', quantity: '', calories: 0, protein: 0, carbs: 0, fats: 0, _needsCalculation: true, _needsQuantity: false, resolved: false },
      ],
      resolved: false,
    }));
    setPendingMealDirty(true);
    setReviewChangedLog(false);
  };

  const deletePendingIngredient = (index) => {
    setPendingMeal((meal) => {
      const ingredients = (meal?.ingredients || []).filter((_, ingredientIndex) => ingredientIndex !== index);
      return withIngredientTotals(meal, ingredients);
    });
    setEditingIngredients((rows) => {
      const nextRows = {};
      Object.entries(rows).forEach(([rowIndex, value]) => {
        const numericIndex = Number(rowIndex);
        if (numericIndex < index) nextRows[numericIndex] = value;
        if (numericIndex > index) nextRows[numericIndex - 1] = value;
      });
      return nextRows;
    });
    setPendingMealDirty(true);
    setReviewChangedLog(false);
  };

  const calculatePendingIngredient = async (index, options = {}) => {
    const ingredient = pendingMeal?.ingredients?.[index];
    if (!ingredient?.name?.trim()) {
      if (!options.silent) toast({ title: 'Enter ingredient name first', variant: 'destructive' });
      return false;
    }

    const quantityText = ingredient.quantity?.trim() || '1 serving';
    setCalculatingIngredients((rows) => ({ ...rows, [index]: true }));

    try {
      const nutrition = await estimateIngredientFromFreeSources(ingredient.name, quantityText);

      if (!nutrition) {
        if (!options.silent) toast({ title: 'Could not calculate this ingredient', variant: 'destructive' });
        return false;
      }

      if (nutrition._needsQuantity) {
        setPendingMeal((meal) => {
          const ingredients = [...(meal?.ingredients || [])];
          ingredients[index] = {
            ...ingredients[index],
            name: safeCorrectedLabel(ingredients[index].name, nutrition.food_name || nutrition.name),
            quantity: nutrition.quantity || quantityText,
            calories: 0,
            protein: 0,
            carbs: 0,
            fats: 0,
            _needsCalculation: true,
            _needsQuantity: true,
            resolved: false,
          };
          return withIngredientTotals(meal, ingredients);
        });
        if (!options.silent) {
          toast({
            title: 'Enter grams or package size',
            description: 'This branded product only has per-100g nutrition data.',
            variant: 'destructive',
          });
        }
        return false;
      }

      setPendingMeal((meal) => {
        const ingredients = [...(meal?.ingredients || [])];
        ingredients[index] = {
          ...ingredients[index],
          name: safeCorrectedLabel(ingredients[index].name, nutrition.food_name),
          quantity: nutrition.quantity || quantityText,
          calories: nutrition.calories,
          protein: nutrition.protein,
          carbs: nutrition.carbs,
          fats: nutrition.fats,
          _needsCalculation: false,
          _needsQuantity: false,
          resolved: true,
        };
        return withIngredientTotals(meal, ingredients);
      });
      setPendingMealDirty(true);
      setReviewChangedLog(false);
      return true;
    } finally {
      setCalculatingIngredients((rows) => ({ ...rows, [index]: false }));
    }
  };

  useEffect(() => {
    if (!pendingMeal || reviewChangedLog) return undefined;
    const editableRows = pendingMeal.ingredients || [];
    const pendingRows = editableRows
      .map((ingredient, index) => ({ ingredient, index }))
      .filter(({ ingredient, index }) =>
        editingIngredients[index] &&
        ingredient?._needsCalculation &&
        !ingredient?._needsQuantity &&
        ingredient?.name?.trim() &&
        ingredient?.quantity?.trim() &&
        !calculatingIngredients[index]
      );

    if (pendingRows.length === 0) return undefined;

    const timeout = window.setTimeout(() => {
      pendingRows.forEach(({ index }) => {
        calculatePendingIngredient(index, { silent: true });
      });
    }, 2000);

    return () => window.clearTimeout(timeout);
  }, [
    pendingMeal?.ingredients?.map((ingredient) => `${ingredient._rowId}:${ingredient.name}:${ingredient.quantity}:${ingredient._needsCalculation}:${ingredient._needsQuantity}`).join('|'),
    editingIngredients,
    calculatingIngredients,
    reviewChangedLog,
  ]);

  const calculateNeededIngredients = async () => {
    const ingredients = pendingMeal?.ingredients || [];
    for (let index = 0; index < ingredients.length; index += 1) {
      const ingredient = ingredients[index];
      const hasMacroValues = Number(ingredient.calories) > 0 || Number(ingredient.protein) > 0 || Number(ingredient.carbs) > 0 || Number(ingredient.fats) > 0;
      if (ingredient._needsQuantity) return false;
      if (ingredient.name?.trim() && (ingredient._needsCalculation || !hasMacroValues)) {
        const ok = await calculatePendingIngredient(index, { silent: true });
        if (!ok) return false;
      }
    }
    return true;
  };

  const selectedMealType = () => {
    const custom = customMealType.trim();
    return mealType === 'custom' ? custom || 'custom' : mealType;
  };

  const canSubmitText = Boolean(foodName.trim() && (mealType !== 'custom' || customMealType.trim()) && !processing);
  const canSubmitImage = Boolean(imageFile && (mealType !== 'custom' || customMealType.trim()) && !imageProcessing);
  const canSubmitBarcode = Boolean(barcode.trim() && (mealType !== 'custom' || customMealType.trim()) && !barcodeProcessing);
  const ingredientCalculationRunning = Object.values(calculatingIngredients).some(Boolean);

  const deleteMeal = async (id) => {
    try {
      await dataService.entities.Meal.delete(id);
      queryClient.invalidateQueries({ queryKey });
      toast({ title: 'Meal deleted' });
    } catch (error) {
      toast({ title: error.message || 'Failed to delete meal', variant: 'destructive' });
    }
  };

  // TEXT ENTRY
  const handleTextSubmit = async () => {
    if (processing) return;
    if (!foodName.trim()) {
      toast({ title: 'Enter a food name', variant: 'destructive' });
      return;
    }
    if (mealType === 'custom' && !customMealType.trim()) {
      toast({ title: 'Enter custom meal type', variant: 'destructive' });
      return;
    }

    setEstimateNotice(null);
    setProcessing(true);

    try {
      const quantityText = quantity.trim() || '1 serving';
      const savedEstimate = await lookupFoodEstimate(foodName, quantityText);

      if (savedEstimate) {
        const enrichedEstimate = await enrichMissingIngredients(savedEstimate);
        stageMealForConfirmation(
          {
            ...enrichedEstimate,
            food_name: foodName.trim(),
            quantity: quantityText,
            meal_type: selectedMealType(),
            notes: mealNotes.trim() || null,
            source: 'saved_estimate',
          },
          'Saved estimate'
        );
        return;
      }

      const estimatedNutrition = await estimateNutritionFromFreeSources(foodName.trim(), quantityText);

      if (estimatedNutrition && mealNeedsQuantity(estimatedNutrition) && !hasManualMacros(manualMacros)) {
        setEstimateNotice({
          title: 'Enter the package weight',
          description: 'This branded product only has per-100g nutrition. Change Qty to the amount eaten, like 40g, 80g, or 100g, then estimate again.',
        });
        return;
      }

      if (!estimatedNutrition && !hasManualMacros(manualMacros)) {
        throw new Error('AI could not estimate this meal. Please try again or enter macros manually.');
      }

      const nutrition = {
        ...(estimatedNutrition || zeroNutrition(foodName, quantityText)),
        food_name: safeCorrectedLabel(foodName, estimatedNutrition?.food_name),
        quantity: quantityText,
        calories: manualMacros.calories !== '' ? Number(manualMacros.calories) || 0 : estimatedNutrition?.calories || 0,
        protein: manualMacros.protein !== '' ? Number(manualMacros.protein) || 0 : estimatedNutrition?.protein || 0,
        carbs: manualMacros.carbs !== '' ? Number(manualMacros.carbs) || 0 : estimatedNutrition?.carbs || 0,
        fats: manualMacros.fats !== '' ? Number(manualMacros.fats) || 0 : estimatedNutrition?.fats || 0,
      };

      stageMealForConfirmation({
        ...nutrition,
        meal_type: selectedMealType(),
        notes: mealNotes.trim() || null,
        source: estimatedNutrition?.source || (estimatedNutrition ? 'ai' : 'manual'),
      }, estimatedNutrition ? sourceLabelFor(estimatedNutrition.source) : 'Manual macros');
    } catch (error) {
      toast({ title: error.message || 'Failed to save meal', variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  // IMAGE ENTRY
  const handleImageSubmit = async () => {
    if (imageProcessing) return;
    if (!imageFile) {
      toast({ title: 'Choose an image first', variant: 'destructive' });
      return;
    }
    if (!imageFile.type.startsWith('image/')) {
      toast({ title: 'Choose a valid image file', variant: 'destructive' });
      return;
    }
    if (imageFile.size > MAX_IMAGE_BYTES) {
      toast({ title: 'Image is too large', description: 'Please upload an image under 3 MB.', variant: 'destructive' });
      return;
    }
    if (mealType === 'custom' && !customMealType.trim()) {
      toast({ title: 'Enter custom meal type', variant: 'destructive' });
      return;
    }

    setImageProcessing(true);

    try {
      const fileNameFallback = imageFile.name.replace(/\.[^/.]+$/, '').trim();
      const result = await analyzeFoodImage(imageFile);
      const identifiedIngredients = Array.isArray(result?.ingredients)
        ? result.ingredients.filter((ingredient) => String(ingredient?.name || '').trim())
        : [];

      if (result?.is_food === false || Number(result?.confidence ?? 1) < 0.35 || identifiedIngredients.length === 0) {
        throw new Error(result?.reason || 'This does not look like a clear food photo. Please upload a meal photo or use manual entry.');
      }

      const foodNameFromImage = String(result?.food_name || fileNameFallback || 'Meal').trim();
      const quantityFromImage = String(result?.quantity || '1 serving').trim();
      const nutrition = await calculateMealFromIdentifiedIngredients({
        foodName: foodNameFromImage,
        quantity: quantityFromImage,
        ingredients: identifiedIngredients,
        mealSizeEstimateGrams: result?.meal_size_estimate_g,
      });

      if (!nutrition || !Array.isArray(nutrition.ingredients) || nutrition.ingredients.length === 0) {
        throw new Error('AI could not estimate this photo. Please try a clearer image or use manual entry.');
      }

      stageMealForConfirmation({
        ...nutrition,
        meal_type: selectedMealType(),
        notes: mealNotes.trim() || null,
        photo_url: imageDataUrl || imagePreviewUrl || '',
        source: nutrition.source || 'ai_photo',
      }, sourceLabelFor(nutrition.source || 'ai_photo'), { photoPreviewUrl: imageDataUrl || imagePreviewUrl });
    } catch (error) {
      toast({ title: error.message || 'Failed to estimate and save meal', variant: 'destructive' });
    } finally {
      setImageProcessing(false);
    }
  };

  const handleBarcodeLookup = async (rawBarcode = barcode) => {
    if (barcodeProcessing) return;
    const barcodeValue = String(rawBarcode || '').trim().replace(/\D/g, '');
    if (barcodeValue.length < 6) {
      toast({ title: 'Enter a valid barcode', variant: 'destructive' });
      return;
    }
    if (mealType === 'custom' && !customMealType.trim()) {
      toast({ title: 'Enter custom meal type', variant: 'destructive' });
      return;
    }

    setBarcodeProcessing(true);
    setBarcode(barcodeValue);

    try {
      let product = await lookupCustomProduct(barcodeValue);
      let sourceLabel = 'Saved product';
      let onlineProduct = null;

      if (!product) {
        product = await lookupMasterBrandedByBarcode(barcodeValue);
        sourceLabel = 'Master nutrition barcode match';
      }

      if (!product) {
        onlineProduct = await openFoodFactsProduct(barcodeValue);
        const datasetFallback = onlineProduct
          ? await resolveBarcodeNutritionFallback(onlineProduct, barcodeValue)
          : null;

        if (datasetFallback?.product) {
          product = {
            ...datasetFallback.product,
            barcode: datasetFallback.product.barcode || barcodeValue,
            product_name: onlineProduct.product_name || datasetFallback.product.product_name,
            brand: onlineProduct.brand || datasetFallback.product.brand,
            serving_size: onlineProduct.serving_size || datasetFallback.product.serving_size || '100g',
          };
          sourceLabel = datasetFallback.label;
        } else if (onlineProduct) {
          product = onlineProduct;
          sourceLabel = 'Open Food Facts fallback';
        }
      }

      if (!product) {
        toast({
          title: 'Product not found',
          description: 'Enter the label macros once and this barcode will be saved for next time.',
          variant: 'destructive',
        });
        stageMealForConfirmation({
          food_name: 'Unknown product',
          quantity: barcodeQuantity.trim() || '100g',
          calories: '',
          protein: '',
          carbs: '',
          fats: '',
          meal_type: selectedMealType(),
          notes: mealNotes.trim() || null,
          source: 'manual_barcode',
          barcode: barcodeValue,
          resolved: false,
        }, 'New barcode product');
        return;
      }

      const quantityText = barcodeQuantity.trim() || product.serving_size || '100g';
      let macros = scalePer100g(product, quantityText);
      if (macros.calories <= 0) {
        const fallback = await resolveBarcodeNutritionFallback(product, barcodeValue);
        if (fallback?.product) {
          product = {
            ...fallback.product,
            barcode: fallback.product.barcode || barcodeValue,
            product_name: product.product_name || fallback.product.product_name,
            brand: product.brand || fallback.product.brand,
            serving_size: product.serving_size || fallback.product.serving_size || '100g',
          };
          sourceLabel = fallback.label;
          macros = scalePer100g(product, quantityText);
        }
      }

      if (macros.calories <= 0) {
        toast({
          title: 'Add label macros',
          description: 'No trusted nutrition source had macros for this barcode yet. Enter them once and this barcode will be saved.',
        });
        stageMealForConfirmation({
          food_name: [product.brand, product.product_name].filter(Boolean).join(' ') || product.product_name || 'Unknown product',
          quantity: quantityText,
          calories: '',
          protein: '',
          carbs: '',
          fats: '',
          meal_type: selectedMealType(),
          notes: mealNotes.trim() || null,
          source: 'manual_barcode',
          barcode: barcodeValue,
          resolved: false,
        }, `${sourceLabel} product`);
        return;
      }

      stageMealForConfirmation({
        food_name: [product.brand, product.product_name].filter(Boolean).join(' ') || product.product_name,
        quantity: quantityText,
        ...macros,
        ingredients: [{
          name: product.product_name || 'Product',
          quantity: quantityText,
          ...macros,
        }],
        meal_type: selectedMealType(),
        notes: mealNotes.trim() || null,
        source: product.source || 'barcode',
        barcode: barcodeValue,
        product,
      }, sourceLabel);
    } catch (error) {
      toast({ title: error.message || 'Barcode lookup failed', variant: 'destructive' });
    } finally {
      setBarcodeProcessing(false);
    }
  };

  const handleBarcodeSubmit = async () => {
    handleBarcodeLookup(barcode);
  };

  const handleBarcodeImageUpload = async (file) => {
    if (!file) return;
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      const imageUrl = URL.createObjectURL(file);
      try {
        const result = await reader.decodeFromImageUrl(imageUrl);
        const scannedValue = result?.getText?.()?.replace(/\D/g, '');
        if (!scannedValue) throw new Error('No barcode found in image');
        setBarcode(scannedValue);
        toast({ title: 'Barcode read from image', description: scannedValue });
        handleBarcodeLookup(scannedValue);
      } finally {
        URL.revokeObjectURL(imageUrl);
      }
    } catch (error) {
      toast({
        title: 'Could not read barcode',
        description: 'Try a clearer barcode photo or enter the number manually.',
        variant: 'destructive',
      });
    }
  };

  const resetMealForm = () => {
    setFoodName('');
    setQuantity('');
    setMealNotes('');
    setManualMacros({ calories: '', protein: '', carbs: '', fats: '' });
    setImageFile(null);
    setBarcode('');
    setBarcodeQuantity('');
    setCustomMealType('');
    setMealType('breakfast');
  };

  const handleConfirmMeal = async () => {
    if (!pendingMeal || savingPending) return;
    const meal = toNumberMacros(pendingMeal);
    if (!meal.food_name.trim()) {
      toast({ title: 'Enter a food name', variant: 'destructive' });
      return;
    }
    if (meal.calories <= 0) {
      toast({ title: 'Calories must be greater than 0', variant: 'destructive' });
      return;
    }

    setSavingPending(true);
    try {
      const savedMeal = await saveMeal({
        ...meal,
        meal_type: meal.meal_type || selectedMealType(),
        notes: meal.notes || mealNotes.trim() || null,
        photo_url: meal.photo_url || meal.photoPreviewUrl || null,
      });

      queryClient.setQueryData(queryKey, (rows = []) => [savedMeal, ...rows.filter((row) => row.id !== savedMeal.id)]);
      toast({ title: 'Meal logged!' });
      setPendingMeal(null);
      setEditingIngredients({});
      setPendingMealDirty(false);
      setReviewChangedLog(false);
      resetMealForm();

      Promise.allSettled([
        saveFoodEstimate(meal, meal.source || 'manual'),
        meal.product
          ? saveCustomProduct(meal.product)
          : meal.barcode
            ? saveCustomProduct({
              barcode: meal.barcode,
              product_name: meal.food_name,
              brand: '',
              serving_size: meal.quantity || '100g',
              ...macrosToPer100g(meal),
              source: 'manual_barcode',
            })
            : Promise.resolve(),
      ]).finally(() => {
        queryClient.invalidateQueries({ queryKey });
      });
    } catch (error) {
      toast({ title: error.message || 'Failed to save meal', variant: 'destructive' });
    } finally {
      setSavingPending(false);
    }
  };

  const handleSaveMealClick = async () => {
    if (pendingMeal?.ingredients?.some((ingredient) => ingredient?._needsQuantity) && !hasManualResolvedTotals(pendingMeal)) {
      toast({
        title: 'Enter grams or package size',
        description: 'For branded products, change 1 to something like 40g, 80g, or the pack weight.',
        variant: 'destructive',
      });
      return;
    }

    const calculated = await calculateNeededIngredients();
    if (!calculated) {
      if (mealHasUnresolvedIngredients(pendingMeal) && hasManualResolvedTotals(pendingMeal)) {
        setPendingMeal((meal) => ({ ...meal, resolved: true }));
      } else if (mealHasUnresolvedIngredients(pendingMeal) || pendingMeal?.resolved === false) {
        toast({
          title: 'Some ingredients could not be calculated',
          description: 'Please fill in the missing ingredient macros or enter the total macros manually.',
          variant: 'destructive',
        });
        return;
      } else {
        toast({ title: 'Could not calculate all ingredients', description: 'Check ingredient names and quantities.', variant: 'destructive' });
        return;
      }
    }

    if ((pendingMeal?.resolved === false || mealHasUnresolvedIngredients(pendingMeal)) && !hasManualResolvedTotals(pendingMeal)) {
      toast({
        title: 'Some ingredients could not be calculated',
        description: 'Please fill in the missing ingredient macros or enter the total macros manually.',
        variant: 'destructive',
      });
      return;
    }

    if (pendingMealDirty && !reviewChangedLog) {
      setEditingIngredients({});
      setReviewChangedLog(true);
      return;
    }

    handleConfirmMeal();
  };

  const submitCurrentTab = (event) => {
    event?.preventDefault?.();
    if (addTab === 'text') {
      handleTextSubmit();
    } else if (addTab === 'image') {
      handleImageSubmit();
    } else {
      handleBarcodeSubmit();
    }
  };

  const handleEnterSubmit = useEnterSubmit(
    submitCurrentTab,
    addTab === 'text' ? canSubmitText : addTab === 'image' ? canSubmitImage : canSubmitBarcode
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <h1 className="text-2xl font-bold">Meal Tracker</h1>
        <Button onClick={() => { setEstimateNotice(null); setShowAdd(true); }}>
          <Plus className="w-4 h-4 mr-2" /> Log Meal
        </Button>
      </div>

      <GlassCard className="p-4">
        {meals.length === 0 ? (
          <EmptyState title="No meals yet" />
        ) : (
          meals.map(m => (
            <div key={m.id} className="flex items-start justify-between gap-3 border-b border-border/60 py-3 last:border-0">
              {m.photo_url && (
                <button
                  type="button"
                  onClick={() => setFullscreenPhoto(m.photo_url)}
                  className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted"
                  aria-label={`Open photo for ${m.food_name}`}
                >
                  <img src={m.photo_url} alt={m.food_name} className="h-full w-full object-cover" />
                </button>
              )}
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="text-sm font-semibold">{m.food_name}</p>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{m.meal_type}</p>
                  {m.resolved === false && (
                    <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                      Estimated/Incomplete
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{m.quantity}</span>
                  {m.notes && <span className="truncate">Note: {m.notes}</span>}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  <div className="rounded-md bg-muted/60 px-2 py-1.5">
                    <p className="text-[10px] text-muted-foreground">Calories</p>
                    <p className="text-xs font-semibold">{m.resolved === false ? 'unknown' : macroDisplay(m.calories, ' kcal')}</p>
                  </div>
                  <div className="rounded-md bg-muted/60 px-2 py-1.5">
                    <p className="text-[10px] text-muted-foreground">Protein</p>
                    <p className="text-xs font-semibold">{m.resolved === false ? 'unknown' : macroDisplay(m.protein, 'g')}</p>
                  </div>
                  <div className="rounded-md bg-muted/60 px-2 py-1.5">
                    <p className="text-[10px] text-muted-foreground">Carbs</p>
                    <p className="text-xs font-semibold">{m.resolved === false ? 'unknown' : macroDisplay(m.carbs, 'g')}</p>
                  </div>
                  <div className="rounded-md bg-muted/60 px-2 py-1.5">
                    <p className="text-[10px] text-muted-foreground">Fats</p>
                    <p className="text-xs font-semibold">{m.resolved === false ? 'unknown' : macroDisplay(m.fats, 'g')}</p>
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => deleteMeal(m.id)} aria-label={`Delete ${m.food_name}`}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))
        )}
      </GlassCard>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log Meal</DialogTitle>
          </DialogHeader>

          <Tabs value={addTab} onValueChange={setAddTab}>
            <TabsList>
              <TabsTrigger value="text">Manual</TabsTrigger>
              <TabsTrigger value="image">Photo</TabsTrigger>
              <TabsTrigger value="barcode">Barcode</TabsTrigger>
            </TabsList>

            <TabsContent value="text" onKeyDown={handleEnterSubmit}>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {MEAL_TYPES.map((type) => (
                  <Button
                    key={type}
                    type="button"
                    variant={mealType === type ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMealType(type)}
                    className="capitalize"
                  >
                    {type}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant={mealType === 'custom' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMealType('custom')}
                >
                  Custom
                </Button>
              </div>
              {mealType === 'custom' && (
                <Input
                  id="custom-meal-type"
                  name="customMealType"
                  value={customMealType}
                  onChange={e => setCustomMealType(e.target.value)}
                  placeholder="Meal type, e.g. pre-workout"
                  className="mb-2"
                />
              )}
              <Input
                id="meal-food-name"
                name="foodName"
                value={foodName}
                onChange={e => {
                  setFoodName(e.target.value);
                  setEstimateNotice(null);
                }}
                placeholder="Food"
              />
              <Input
                id="meal-quantity"
                name="quantity"
                value={quantity}
                onChange={e => {
                  setQuantity(e.target.value);
                  setEstimateNotice(null);
                }}
                placeholder="Qty"
              />
              {estimateNotice && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs">
                  <p className="font-semibold text-destructive">{estimateNotice.title}</p>
                  <p className="mt-1 text-muted-foreground">{estimateNotice.description}</p>
                </div>
              )}
              <Textarea
                id="meal-notes"
                name="mealNotes"
                value={mealNotes}
                onChange={e => setMealNotes(e.target.value)}
                placeholder="Optional note or description"
                className="mt-2"
              />
              <div className="mt-2 grid grid-cols-4 gap-2">
                <Input type="number" value={manualMacros.calories} onChange={e => setManualMacros(p => ({ ...p, calories: e.target.value }))} placeholder="kcal" />
                <Input type="number" value={manualMacros.protein} onChange={e => setManualMacros(p => ({ ...p, protein: e.target.value }))} placeholder="P" />
                <Input type="number" value={manualMacros.carbs} onChange={e => setManualMacros(p => ({ ...p, carbs: e.target.value }))} placeholder="C" />
                <Input type="number" value={manualMacros.fats} onChange={e => setManualMacros(p => ({ ...p, fats: e.target.value }))} placeholder="F" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Optional macros. AI results are editable before saving.</p>
              <Button onClick={handleTextSubmit} disabled={!canSubmitText}>
                {processing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {processing ? 'Estimating...' : 'Estimate'}
              </Button>
            </TabsContent>

            <TabsContent value="image" onKeyDown={handleEnterSubmit}>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {MEAL_TYPES.map((type) => (
                  <Button
                    key={type}
                    type="button"
                    variant={mealType === type ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMealType(type)}
                    className="capitalize"
                  >
                    {type}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant={mealType === 'custom' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMealType('custom')}
                >
                  Custom
                </Button>
              </div>
              {mealType === 'custom' && (
                <Input
                  id="custom-photo-meal-type"
                  name="customPhotoMealType"
                  value={customMealType}
                  onChange={e => setCustomMealType(e.target.value)}
                  placeholder="Meal type, e.g. post-workout"
                  className="mb-2"
                />
              )}
              <div className="mb-3 flex items-start gap-2 rounded-md border border-primary/40 bg-primary/10 p-3 text-xs text-foreground">
                <Camera className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p>
                  For best photo estimates, spread the foods out on the plate, keep each ingredient visible, and avoid stacking items over each other.
                </p>
              </div>
              <Input id="meal-photo" name="mealPhoto" type="file" accept="image/*" onChange={e => setImageFile(e.target.files?.[0])} />
              <Textarea
                id="photo-meal-notes"
                name="photoMealNotes"
                value={mealNotes}
                onChange={e => setMealNotes(e.target.value)}
                placeholder="Optional note or description"
                className="mt-2"
              />
              <Button onClick={handleImageSubmit} disabled={!canSubmitImage}>
                {imageProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {imageProcessing ? 'Estimating...' : 'Estimate'}
              </Button>
            </TabsContent>

            <TabsContent value="barcode" onKeyDown={handleEnterSubmit}>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {MEAL_TYPES.map((type) => (
                  <Button
                    key={type}
                    type="button"
                    variant={mealType === type ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMealType(type)}
                    className="capitalize"
                  >
                    {type}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant={mealType === 'custom' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMealType('custom')}
                >
                  Custom
                </Button>
              </div>
              {mealType === 'custom' && (
                <Input
                  id="custom-barcode-meal-type"
                  name="customBarcodeMealType"
                  value={customMealType}
                  onChange={e => setCustomMealType(e.target.value)}
                  placeholder="Meal type, e.g. snack"
                  className="mb-2"
                />
              )}
              <div className="flex gap-2">
                <Input
                  id="meal-barcode"
                  name="barcode"
                  inputMode="numeric"
                  value={barcode}
                  onChange={e => setBarcode(e.target.value)}
                  placeholder="Barcode number"
                />
                <Button type="button" variant="outline" size="icon" onClick={() => setShowScanner(true)} aria-label="Scan barcode">
                  <ScanBarcode className="h-4 w-4" />
                </Button>
              </div>
              <Input
                id="meal-barcode-quantity"
                name="barcodeQuantity"
                value={barcodeQuantity}
                onChange={e => setBarcodeQuantity(e.target.value)}
                placeholder="Amount eaten, e.g. 50g"
                className="mt-2"
              />
              <Input
                id="meal-barcode-image"
                name="barcodeImage"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={e => handleBarcodeImageUpload(e.target.files?.[0])}
                className="mt-2"
              />
              <Textarea
                id="barcode-meal-notes"
                name="barcodeMealNotes"
                value={mealNotes}
                onChange={e => setMealNotes(e.target.value)}
                placeholder="Optional note or description"
                className="mt-2"
              />
              <Button onClick={handleBarcodeSubmit} disabled={!canSubmitBarcode}>
                {barcodeProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanBarcode className="mr-2 h-4 w-4" />}
                {barcodeProcessing ? 'Looking up...' : 'Lookup'}
              </Button>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingMeal} onOpenChange={(open) => !open && setPendingMeal(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="icon" onClick={returnToLogMeal} aria-label="Back to log meal">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <DialogTitle>Confirm Meal</DialogTitle>
            </div>
          </DialogHeader>
          {pendingMeal && (
            <div className="space-y-3">
              <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">{pendingMeal.sourceLabel}</p>
                {pendingMeal.resolved === false && (
                  <p className="font-medium text-amber-700">Estimated/Incomplete</p>
                )}
                {pendingMeal.assumptionSource && <p>Assumptions: {pendingMeal.assumptionSource}</p>}
                {pendingMeal.confidence !== undefined && pendingMeal.confidence !== null && (
                  <p>Confidence: {Math.round(Number(pendingMeal.confidence) * 100)}%</p>
                )}
              </div>
              {pendingMeal.photoPreviewUrl && (
                <div className="overflow-hidden rounded-md border border-border/70 bg-muted/30">
                  <img
                    src={pendingMeal.photoPreviewUrl}
                    alt="Uploaded meal"
                    className="max-h-56 w-full object-cover"
                  />
                </div>
              )}
              {reviewChangedLog && (
                <div className="space-y-2 rounded-md border border-primary/50 bg-primary/5 p-3">
                  <p className="text-xs font-semibold uppercase text-primary">Review changed log</p>
                  <div className="text-sm">
                    <p className="font-semibold">{pendingMeal.food_name}</p>
                    <p className="text-muted-foreground">{pendingMeal.quantity}</p>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div><p className="text-muted-foreground">Calories</p><p className="font-semibold">{pendingMeal.calories}</p></div>
                    <div><p className="text-muted-foreground">Protein</p><p className="font-semibold">{pendingMeal.protein}g</p></div>
                    <div><p className="text-muted-foreground">Carbs</p><p className="font-semibold">{pendingMeal.carbs}g</p></div>
                    <div><p className="text-muted-foreground">Fat</p><p className="font-semibold">{pendingMeal.fats}g</p></div>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  value={pendingMeal.food_name}
                  onChange={e => updatePendingField('food_name', e.target.value)}
                  placeholder="Food"
                />
              </div>
              <div className="flex gap-2">
                <Input
                  value={pendingMeal.quantity}
                  onChange={e => updatePendingField('quantity', e.target.value)}
                  placeholder="Quantity"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {MACRO_KEYS.map((key) => (
                  <div key={key} className="space-y-1">
                    <label className="text-xs font-medium capitalize text-muted-foreground" htmlFor={`confirm-${key}`}>
                      {key === 'fats' ? 'Fat' : key}
                    </label>
                    <div className="flex gap-1">
                      <Input
                        id={`confirm-${key}`}
                        type="number"
                        value={pendingMeal[key]}
                        onChange={e => updatePendingField(key, e.target.value)}
                        placeholder={key === 'calories' ? 'kcal' : 'g'}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-2 rounded-md border border-border/70 p-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Assumed ingredients</p>
                {pendingMeal.ingredients?.length > 0 ? (
                  <div className="space-y-2">
                    {pendingMeal.ingredients.map((ingredient, index) => (
                      <div key={ingredient._rowId || `ingredient-${index}`} className="space-y-2 rounded-md bg-muted/40 p-2">
                        <div className="flex items-start justify-between gap-2">
                          {editingIngredients[index] && !reviewChangedLog ? (
                            <div className="grid flex-1 grid-cols-2 gap-2">
                              <Input value={ingredient.name} onChange={e => updatePendingIngredient(index, 'name', e.target.value)} placeholder="Ingredient" />
                              <Input value={ingredient.quantity} onChange={e => updatePendingIngredient(index, 'quantity', e.target.value)} placeholder="Qty" />
                            </div>
                          ) : (
                            <div className="flex-1 text-xs">
                              <p className="font-semibold">{ingredient.name || 'Ingredient'}</p>
                              <p className="text-muted-foreground">{ingredient.quantity || 'Quantity not specified'}</p>
                            </div>
                          )}
                          {!reviewChangedLog && (
                            <>
                              <Button type="button" variant="outline" size="icon" onClick={() => setEditingIngredients((rows) => ({ ...rows, [index]: !rows[index] }))} aria-label="Edit ingredient">
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button type="button" variant="ghost" size="icon" onClick={() => deletePendingIngredient(index)} aria-label="Delete ingredient">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {ingredient._needsQuantity ? 'Needs grams or package size - ' : ingredient._needsCalculation || ingredient.resolved === false ? 'Needs calculation - ' : ''}
                          {ingredient.resolved === false || ingredient._needsCalculation || ingredient._needsQuantity
                            ? 'unknown macros'
                            : `${macroDisplay(ingredient.calories, ' kcal')} - P:${macroDisplay(ingredient.protein, 'g')} C:${macroDisplay(ingredient.carbs, 'g')} F:${macroDisplay(ingredient.fats, 'g')}`}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No ingredient assumptions returned. Add them manually if needed.</p>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            {reviewChangedLog ? (
              <Button
                variant="outline"
                onClick={() => setReviewChangedLog(false)}
                disabled={savingPending}
              >
                Edit
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={addPendingIngredient}
                disabled={savingPending}
              >
                Add More
              </Button>
            )}
            <Button onClick={handleSaveMealClick} disabled={savingPending || ingredientCalculationRunning || !pendingMeal}>
              {(savingPending || ingredientCalculationRunning) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {reviewChangedLog ? 'Confirm Save' : 'Save Meal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!fullscreenPhoto} onOpenChange={(open) => !open && setFullscreenPhoto('')}>
        <DialogContent className="max-w-5xl border-0 bg-black/95 p-0">
          <img src={fullscreenPhoto} alt="Meal" className="max-h-[90vh] w-full object-contain" />
        </DialogContent>
      </Dialog>

      <Dialog open={showScanner} onOpenChange={setShowScanner}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scan Barcode</DialogTitle>
          </DialogHeader>
          <div className="overflow-hidden rounded-md border bg-black">
            <video ref={scannerVideoRef} className="aspect-video w-full object-cover" muted playsInline />
          </div>
          <p className="text-xs text-muted-foreground">
            {scannerStatus || 'Allow camera access, then center the barcode in the frame.'}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowScanner(false)}>
              Cancel
            </Button>
            <Button disabled>
              {scannerActive && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Scanning
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
