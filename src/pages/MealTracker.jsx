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
import { calculateMealFromIdentifiedIngredients, estimateIngredientFromFreeSources, estimateNutritionFromFreeSources, lookupBarcodeNutrition } from '@/services/nutritionEngine';
import { normalizeSearchKey } from '@/services/foodIntelligence';
import { confidenceForReferenceType, densityKeyForFoodName, estimateGrams } from '@/services/portionEstimation';
import { compressImage } from '@/services/imageCompression';
import { supabase } from '@/lib/supabaseClient';
import { useEnterSubmit } from '@/hooks/useEnterSubmit';

const MEAL_TYPES = ['breakfast', 'brunch', 'lunch', 'dinner', 'snack'];
const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fats'];
const MEAL_PHOTO_BUCKET = 'meal-photos';
const MEAL_PHOTO_SIGNED_URL_EXPIRY_SECONDS = 60 * 60;
const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;

const today = () => format(new Date(), 'yyyy-MM-dd');

const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const readMacro = (nutrition, key) => {
  const macros = nutrition?.nutrition || nutrition?.macros || nutrition?.nutrients || {};
  return Number(firstValue(nutrition?.[key], macros?.[key]));
};

const hasReferencePortionInputs = (ingredient) =>
  Number.isFinite(Number(ingredient?.area_ratio_to_reference)) &&
  Boolean(ingredient?.thickness_bucket);

const applyReferencePortionEstimates = (visionResult, ingredients) => {
  if (visionResult?.reference_detected !== true) return ingredients;

  return ingredients.map((ingredient) => {
    if (!hasReferencePortionInputs(ingredient)) return ingredient;

    const grams = estimateGrams({
      areaRatioToReference: ingredient.area_ratio_to_reference,
      thicknessBucket: ingredient.thickness_bucket,
      densityKey: densityKeyForFoodName(ingredient.name),
      referenceType: visionResult.reference_type,
      referenceSubtype: visionResult.reference_subtype,
    });

    if (!grams) return ingredient;

    return {
      ...ingredient,
      estimated_grams: grams,
      quantity: `${grams}g`,
      source: 'vision_portion_estimate',
      confidence: confidenceForReferenceType(visionResult.reference_type),
    };
  });
};

const applyReferenceMetadataToNutrition = (nutrition, ingredientsForCalculation) => {
  if (!nutrition || !Array.isArray(nutrition.ingredients)) return nutrition;

  const referenceByName = new Map(
    ingredientsForCalculation
      .filter((ingredient) => ingredient?.source === 'vision_portion_estimate')
      .map((ingredient) => [normalizeSearchKey(ingredient.name), ingredient])
  );

  if (referenceByName.size === 0) return nutrition;

  return {
    ...nutrition,
    ingredients: nutrition.ingredients.map((ingredient) => {
      const referenceIngredient = referenceByName.get(normalizeSearchKey(ingredient.name));
      if (!referenceIngredient) return ingredient;
      return {
        ...ingredient,
        estimated_grams: referenceIngredient.estimated_grams,
        source: 'vision_portion_estimate',
        confidence: referenceIngredient.confidence,
      };
    }),
  };
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

const isDirectPhotoUrl = (value) => /^(data:image\/|blob:|https?:\/\/)/i.test(String(value || ''));

const mealPhotoStoragePath = (value) => {
  const photoUrl = String(value || '').trim();
  const prefix = `${MEAL_PHOTO_BUCKET}/`;
  if (!photoUrl.startsWith(prefix)) return '';
  return photoUrl.slice(prefix.length);
};

const mealPhotoDisplayUrl = (value, signedPhotoUrls = {}) => {
  if (!value) return '';
  if (isDirectPhotoUrl(value)) return value;
  return signedPhotoUrls[value] || '';
};

const buildMealPhotoPath = (userId) => {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
  const random = window.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${userId}/${timestamp}-${random}.jpg`;
};

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
  const [imageProcessing, setImageProcessing] = useState(false);
  const [signedPhotoUrls, setSignedPhotoUrls] = useState({});
  const [barcode, setBarcode] = useState('');
  const [barcodeQuantity, setBarcodeQuantity] = useState('');
  const [barcodeProcessing, setBarcodeProcessing] = useState(false);
  const [barcodeMacroChoice, setBarcodeMacroChoice] = useState(null);
  const [barcodeMacroChoiceProcessing, setBarcodeMacroChoiceProcessing] = useState(false);
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
    const storagePhotoUrls = [...new Set(
      meals
        .map((meal) => meal?.photo_url)
        .filter((photoUrl) => mealPhotoStoragePath(photoUrl) && !signedPhotoUrls[photoUrl])
    )];

    if (storagePhotoUrls.length === 0) return undefined;

    let cancelled = false;

    Promise.all(
      storagePhotoUrls.map(async (photoUrl) => {
        const path = mealPhotoStoragePath(photoUrl);
        const { data, error } = await supabase.storage
          .from(MEAL_PHOTO_BUCKET)
          .createSignedUrl(path, MEAL_PHOTO_SIGNED_URL_EXPIRY_SECONDS);

        if (error || !data?.signedUrl) {
          console.warn('Could not create meal photo signed URL:', error?.message || error);
          return null;
        }

        return [photoUrl, data.signedUrl];
      })
    ).then((entries) => {
      if (cancelled) return;
      const resolvedEntries = entries.filter(Boolean);
      if (resolvedEntries.length === 0) return;
      setSignedPhotoUrls((current) => ({
        ...current,
        ...Object.fromEntries(resolvedEntries),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [meals, signedPhotoUrls]);

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
      return undefined;
    }

    const previewUrl = URL.createObjectURL(imageFile);
    setImagePreviewUrl(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [imageFile]);

  const saveMeal = async (meal) => {
    return dataService.entities.Meal.create({
      ...meal,
      date: today(),
    });
  };

  const uploadMealPhoto = async (file) => {
    if (!file) return '';
    if (!user?.id) throw new Error('You must be logged in to upload meal photos.');

    const path = buildMealPhotoPath(user.id);
    const { error } = await supabase.storage
      .from(MEAL_PHOTO_BUCKET)
      .upload(path, file, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      });

    if (error) throw new Error(error.message || 'Could not upload meal photo.');
    return `${MEAL_PHOTO_BUCKET}/${path}`;
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

  const productLabel = (product = {}) =>
    [product.brand, product.product_name].filter(Boolean).join(' ') ||
    product.product_name ||
    product.name ||
    '';

  const openBarcodeMacroChoice = ({ barcodeValue, product = {}, sourceLabel = 'Barcode product', quantityText }) => {
    setShowAdd(false);
    setBarcodeMacroChoice({
      barcode: barcodeValue,
      product: {
        barcode: product.barcode || barcodeValue,
        product_name: product.product_name || '',
        brand: product.brand || '',
        serving_size: product.serving_size || quantityText || '100g',
        serving_quantity: product.serving_quantity || parseGrams(quantityText || product.serving_size, 100),
        source: product.source || 'barcode_product_identity',
      },
      sourceLabel,
      quantity: quantityText || product.serving_size || barcodeQuantity.trim() || '100g',
      productName: productLabel(product),
    });
  };

  const stageManualBarcodeMacros = (choice = barcodeMacroChoice) => {
    if (!choice) return;
    const productName = String(choice.productName || '').trim();
    const product = {
      ...choice.product,
      product_name: productName || choice.product?.product_name || 'Unknown product',
    };

    setBarcodeMacroChoice(null);
    stageMealForConfirmation({
      food_name: productLabel(product) || productName || 'Unknown product',
      quantity: choice.quantity || '100g',
      calories: '',
      protein: '',
      carbs: '',
      fats: '',
      meal_type: selectedMealType(),
      notes: mealNotes.trim() || null,
      source: 'manual_barcode',
      barcode: choice.barcode,
      resolved: false,
    }, productName ? `${choice.sourceLabel} product` : 'New barcode product');
  };

  const stageAiBarcodeEstimate = async () => {
    if (!barcodeMacroChoice || barcodeMacroChoiceProcessing) return;
    const productName = String(barcodeMacroChoice.productName || '').trim();
    if (!productName) {
      toast({ title: 'Enter a product name first', variant: 'destructive' });
      return;
    }

    setBarcodeMacroChoiceProcessing(true);
    try {
      const quantityText = barcodeMacroChoice.quantity || '100g';
      const nutrition = await estimateNutritionFromFreeSources(productName, quantityText);
      const normalized = normalizeNutrition(nutrition, productName, quantityText, { preserveName: true, preserveQuantity: true });
      if (!normalized) throw new Error('AI could not estimate this barcode product.');

      const product = {
        ...barcodeMacroChoice.product,
        product_name: productName,
        serving_size: quantityText,
        ...macrosToPer100g({ ...normalized, quantity: quantityText }),
        source: 'barcode_ai_estimate',
      };

      setBarcodeMacroChoice(null);
      stageMealForConfirmation({
        ...normalized,
        ingredients: hasIngredients(normalized)
          ? normalized.ingredients
          : [{
            name: productName,
            quantity: quantityText,
            calories: normalized.calories,
            protein: normalized.protein,
            carbs: normalized.carbs,
            fats: normalized.fats,
          }],
        meal_type: selectedMealType(),
        notes: mealNotes.trim() || null,
        source: 'barcode_ai_estimate',
        barcode: barcodeMacroChoice.barcode,
        product,
        confidence: 0.45,
        resolved: false,
      }, 'Rough AI barcode estimate');
    } catch (error) {
      toast({ title: error.message || 'Could not estimate barcode product', variant: 'destructive' });
    } finally {
      setBarcodeMacroChoiceProcessing(false);
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
    if (imageFile.size > MAX_SOURCE_IMAGE_BYTES) {
      toast({ title: 'Image is too large', description: 'Please upload an image under 20 MB.', variant: 'destructive' });
      return;
    }
    if (mealType === 'custom' && !customMealType.trim()) {
      toast({ title: 'Enter custom meal type', variant: 'destructive' });
      return;
    }

    setImageProcessing(true);

    try {
      const fileNameFallback = imageFile.name.replace(/\.[^/.]+$/, '').trim();
      const compressedPhoto = await compressImage(imageFile);
      const result = await analyzeFoodImage(compressedPhoto);
      const identifiedIngredients = Array.isArray(result?.ingredients)
        ? result.ingredients.filter((ingredient) => String(ingredient?.name || '').trim())
        : [];

      if (result?.is_food === false || Number(result?.confidence ?? 1) < 0.35 || identifiedIngredients.length === 0) {
        throw new Error(result?.reason || 'This does not look like a clear food photo. Please upload a meal photo or use manual entry.');
      }

      const foodNameFromImage = String(result?.food_name || fileNameFallback || 'Meal').trim();
      const quantityFromImage = String(result?.quantity || '1 serving').trim();
      const ingredientsForCalculation = applyReferencePortionEstimates(result, identifiedIngredients);
      const nutritionResult = await calculateMealFromIdentifiedIngredients({
        foodName: foodNameFromImage,
        quantity: quantityFromImage,
        ingredients: ingredientsForCalculation,
        mealSizeEstimateGrams: result?.meal_size_estimate_g,
      });
      const nutrition = applyReferenceMetadataToNutrition(nutritionResult, ingredientsForCalculation);

      if (!nutrition || !Array.isArray(nutrition.ingredients) || nutrition.ingredients.length === 0) {
        throw new Error('AI could not estimate this photo. Please try a clearer image or use manual entry.');
      }

      stageMealForConfirmation({
        ...nutrition,
        meal_type: selectedMealType(),
        notes: mealNotes.trim() || null,
        photo_url: '',
        _photoFile: compressedPhoto,
        source: nutrition.source || 'ai_photo',
      }, sourceLabelFor(nutrition.source || 'ai_photo'), { photoPreviewUrl: imagePreviewUrl });
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

      if (!product) {
        const barcodeResult = await lookupBarcodeNutrition(barcodeValue);
        if (barcodeResult?.product) {
          product = {
            ...barcodeResult.product,
            barcode: barcodeResult.product.barcode || barcodeValue,
          };
          sourceLabel = barcodeResult.label || 'Barcode nutrition fallback';
        }
      }

      if (!product) {
        toast({
          title: 'Product not found',
          description: 'Enter the product name, then choose label macros or a rough AI estimate.',
        });
        openBarcodeMacroChoice({
          barcodeValue,
          product: {},
          sourceLabel: 'New barcode product',
          quantityText: barcodeQuantity.trim() || '100g',
        });
        return;
      }

      const quantityText = barcodeQuantity.trim() || product.serving_size || '100g';
      let macros = scalePer100g(product, quantityText);

      if (macros.calories <= 0) {
        toast({
          title: 'Nutrition label not found',
          description: 'Choose label macros for accuracy or a rough AI estimate for convenience.',
        });
        openBarcodeMacroChoice({
          barcodeValue,
          product,
          sourceLabel,
          quantityText,
        });
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
      const uploadedPhotoUrl = meal._photoFile
        ? await uploadMealPhoto(meal._photoFile)
        : meal.photo_url || meal.photoPreviewUrl || null;

      const mealToSave = { ...meal };
      delete mealToSave._photoFile;
      delete mealToSave.photoPreviewUrl;
      delete mealToSave.sourceLabel;

      const savedMeal = await saveMeal({
        ...mealToSave,
        meal_type: meal.meal_type || selectedMealType(),
        notes: meal.notes || mealNotes.trim() || null,
        photo_url: uploadedPhotoUrl,
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
              source: meal.source || 'manual_barcode',
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
          meals.map((m) => {
            const photoSrc = mealPhotoDisplayUrl(m.photo_url, signedPhotoUrls);
            return (
            <div key={m.id} className="flex items-start justify-between gap-3 border-b border-border/60 py-3 last:border-0">
              {photoSrc && (
                <button
                  type="button"
                  onClick={() => setFullscreenPhoto(photoSrc)}
                  className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted"
                  aria-label={`Open photo for ${m.food_name}`}
                >
                  <img src={photoSrc} alt={m.food_name} className="h-full w-full object-cover" />
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
            );
          })
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

      <Dialog open={!!barcodeMacroChoice} onOpenChange={(open) => !open && setBarcodeMacroChoice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nutrition label not found</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">{barcodeMacroChoice?.sourceLabel || 'Barcode product'}</p>
              <p>Barcode: {barcodeMacroChoice?.barcode}</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="barcode-choice-product-name">
                Product name
              </label>
              <Input
                id="barcode-choice-product-name"
                value={barcodeMacroChoice?.productName || ''}
                onChange={(event) => setBarcodeMacroChoice((choice) => choice ? { ...choice, productName: event.target.value } : choice)}
                placeholder="Enter product name from the package"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="barcode-choice-quantity">
                Quantity
              </label>
              <Input
                id="barcode-choice-quantity"
                value={barcodeMacroChoice?.quantity || ''}
                onChange={(event) => setBarcodeMacroChoice((choice) => choice ? { ...choice, quantity: event.target.value } : choice)}
                placeholder="50g"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Label macros are most accurate. A rough AI estimate is editable, saved as low-confidence, and should be corrected when the package label is available.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => stageManualBarcodeMacros()} disabled={barcodeMacroChoiceProcessing}>
              Enter Label Macros
            </Button>
            <Button onClick={stageAiBarcodeEstimate} disabled={barcodeMacroChoiceProcessing}>
              {barcodeMacroChoiceProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {barcodeMacroChoiceProcessing ? 'Estimating...' : 'Use Rough AI Estimate'}
            </Button>
          </DialogFooter>
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
