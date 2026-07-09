import { supabase } from '@/lib/supabaseClient';
import {
  FOOD_STATE_KEYS,
  FOOD_STATE_LABELS,
  FOOD_TYPES,
  analyzeFood as analyzeFoodWithClient,
  analyzeFoodSync,
  buildResolutionFormula,
  classifyFood,
  compactBaseName,
  detectFoodState,
  lookupDbClassification as lookupDbClassificationWithClient,
  normalizeSearchKey,
  parseFoodStateInput,
} from '@healthyfit/food-resolver/foodIntelligence';

export {
  FOOD_STATE_KEYS,
  FOOD_STATE_LABELS,
  FOOD_TYPES,
  analyzeFoodSync,
  buildResolutionFormula,
  classifyFood,
  compactBaseName,
  detectFoodState,
  normalizeSearchKey,
  parseFoodStateInput,
};

export const lookupDbClassification = (name) =>
  lookupDbClassificationWithClient(supabase, name);

export const analyzeFood = (name) =>
  analyzeFoodWithClient(supabase, name);
