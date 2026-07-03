/** Food Intelligence Layer and Master Nutrition Database types. */

export type FoodType =
  | 'simple_ingredient'
  | 'tiny_garnish'
  | 'spice'
  | 'cooked_side'
  | 'mixed_recipe'
  | 'branded_packaged'
  | 'beverage'
  | 'dessert'
  | 'unknown';

export type FoodStateKey =
  | 'raw'
  | 'uncooked'
  | 'cooked'
  | 'boiled'
  | 'grilled'
  | 'fried'
  | 'deep_fried'
  | 'shallow_fried'
  | 'roasted'
  | 'steamed'
  | 'smoked'
  | 'canned'
  | 'frozen'
  | 'soaked'
  | 'sprouted'
  | 'dry'
  | 'mashed'
  | 'baked'
  | 'unknown';

export interface FoodAnalysis {
  detectedName: string;
  searchKey: string;
  baseSearchKey: string;
  foodType: FoodType;
  foodStateKey: FoodStateKey;
  foodStateName: string;
  stateConfidence: number;
  stateSource: 'name_pattern' | 'db_rule' | 'category_default' | 'fallback';
  canonicalName: string;
  classificationSource: 'db' | 'heuristic' | 'fallback';
  classificationConfidence: number;
}

export interface FoodClassificationResult extends FoodAnalysis {
  type: FoodType;
  template?: Record<string, unknown> | null;
}

export interface MasterFoodProfile {
  foodId: string;
  foodStateId: string;
  canonicalName: string;
  searchKey: string;
  stateKey: FoodStateKey;
  stateName: string;
  category?: string;
  cuisine?: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber?: number;
  water?: number;
  nutritionSource: string;
  confidence: number;
}

export interface ResolverProfile {
  aliases: string[];
  category?: string;
  per: { unit: string; amount: number };
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  grams?: Record<string, number>;
  liquid?: Record<string, number>;
  spread?: Record<string, number>;
  source?: string;
  sourceTable?: string;
  foodStateKey?: FoodStateKey;
  masterFoodId?: string;
  masterFoodStateId?: string;
  confidence?: number;
  statePolicyWarning?: string;
  statePolicy?: Record<string, unknown>;
}

export interface MasterRecipeTemplateItem {
  ingredient_name: string;
  ingredient_search_key: string;
  ingredient_food_id?: string;
  percentage: number;
  min_percentage?: number;
  max_percentage?: number;
  required?: boolean;
  sort_order?: number;
}

export interface MasterRecipeTemplate {
  id?: string;
  name: string;
  search_key: string;
  cuisine?: string;
  default_serving_grams?: number;
  confidence: number;
  recipe_count: number;
  source?: string;
  items: MasterRecipeTemplateItem[];
}

export interface FoodResolutionDebug {
  detectedName: string;
  foodType: FoodType;
  foodState: FoodStateKey;
  canonicalFood: string;
  nutritionSource: string;
  recipeTemplateUsed: string;
  servingUsed: string | null;
  formula: string;
  finalGrams: number | null;
  finalMacros: Record<string, number> | null;
  sanityResult: boolean;
}
