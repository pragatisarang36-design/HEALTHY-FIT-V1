import { supabase } from '@/lib/supabaseClient';
import {
  clearMasterResolverCache,
  configureMasterFoodResolver,
  isMasterNutritionEnabled,
  masterBrandedProfileFor as sharedMasterBrandedProfileFor,
  masterProfileFor as sharedMasterProfileFor,
  masterTinyGarnishProfileFor as sharedMasterTinyGarnishProfileFor,
} from '@healthyfit/food-resolver/masterFoodResolver';

configureMasterFoodResolver({
  useMasterNutritionDb: String(import.meta.env.VITE_USE_MASTER_NUTRITION_DB || 'true').toLowerCase() !== 'false',
  isDev: import.meta.env.DEV,
  logger: console,
});

export const masterBrandedProfileFor = (name) =>
  sharedMasterBrandedProfileFor(supabase, name);

export const masterTinyGarnishProfileFor = (name) =>
  sharedMasterTinyGarnishProfileFor(supabase, name);

export const masterProfileFor = (name, analysis = {}, options = {}) =>
  sharedMasterProfileFor(supabase, name, analysis, options);

export {
  clearMasterResolverCache,
  isMasterNutritionEnabled,
};
