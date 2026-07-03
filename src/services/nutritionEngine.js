import { estimateNutrition, retryEstimateNutrition } from '@/services/aiFeatures';
import {
  analyzeFood,
  buildResolutionFormula,
  classifyFood as buildFoodClassification,
  compactBaseName,
  detectFoodState,
} from '@/services/foodIntelligence';
import { masterProfileFor, masterTinyGarnishProfileFor } from '@/services/masterFoodResolver';
import { masterRecipeTemplateFor } from '@/services/recipeTemplateService';
import { supabase } from '@/lib/supabaseClient';
import { inferStatePolicyCategory, isRawDryState, resolveStatePolicy } from '@/services/statePolicy';
import {
  applyTemplateModifierVariants,
  detectDietaryModifiers,
  filterTemplateItemsByModifiers,
  mergeTemplateItems,
  preparedCategoryFor,
  profileKcalStatus,
} from '@/services/nutritionAccuracyRules';

const NUTRITION_DEBUG =
  import.meta.env.DEV && String(import.meta.env.VITE_NUTRITION_DEBUG || '').toLowerCase() === 'true';

const numberWords = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const unitAliases = {
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tbsp: 'tbsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tsp: 'tsp',
  gram: 'g',
  grams: 'g',
  g: 'g',
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  l: 'l',
  litre: 'l',
  litres: 'l',
  liter: 'l',
  liters: 'l',
  cup: 'cup',
  cups: 'cup',
  slice: 'slice',
  slices: 'slice',
  piece: 'piece',
  pieces: 'piece',
  bar: 'bar',
  bars: 'bar',
  pack: 'pack',
  packs: 'pack',
  packet: 'pack',
  packets: 'pack',
  handful: 'handful',
  handfuls: 'handful',
  egg: 'piece',
  eggs: 'piece',
  bowl: 'bowl',
  bowls: 'bowl',
  plate: 'plate',
  plates: 'plate',
  serving: 'serving',
  servings: 'serving',
};

const foodProfiles = [
  { aliases: ['oil', 'cooking oil', 'vegetable oil', 'olive oil', 'sunflower oil', 'groundnut oil', 'mustard oil', 'oil or ghee', 'oil and ghee'], category: 'oil', per: { unit: 'tbsp', amount: 1 }, calories: 120, protein: 0, carbs: 0, fats: 14, liquid: { gramsPerTbsp: 13.5, mlPerTbsp: 15 } },
  { aliases: ['ghee'], category: 'oil', per: { unit: 'tbsp', amount: 1 }, calories: 112, protein: 0, carbs: 0, fats: 12.7, liquid: { gramsPerTbsp: 13, mlPerTbsp: 15 } },
  { aliases: ['butter'], category: 'oil', per: { unit: 'tbsp', amount: 1 }, calories: 102, protein: 0.1, carbs: 0, fats: 11.5, liquid: { gramsPerTbsp: 14, mlPerTbsp: 15 } },
  { aliases: ['lime', 'lime wedge', 'lemon', 'lemon wedge'], category: 'tiny_garnish', per: { unit: 'g', amount: 100 }, calories: 30, protein: 0.7, carbs: 10.5, fats: 0.2, grams: { piece: 6, serving: 6 } },
  { aliases: ['green chili', 'green chilli', 'chili', 'chilli'], category: 'tiny_garnish', per: { unit: 'g', amount: 100 }, calories: 40, protein: 2, carbs: 9.5, fats: 0.2, grams: { piece: 3, serving: 3 } },
  { aliases: ['coriander', 'coriander leaves', 'cilantro', 'mint', 'mint leaves', 'curry leaves'], category: 'tiny_garnish', per: { unit: 'g', amount: 100 }, calories: 30, protein: 2.2, carbs: 5.5, fats: 0.6, grams: { serving: 2 } },
  { aliases: ['ginger', 'garlic', 'ginger garlic', 'ginger garlic paste', 'spices', 'herbs', 'masala'], category: 'tiny_garnish', per: { unit: 'g', amount: 100 }, calories: 80, protein: 2.5, carbs: 17, fats: 0.7, grams: { tsp: 5, serving: 3 } },
  { aliases: ['raw egg', 'raw eggs', 'uncooked egg', 'uncooked eggs'], category: 'meat', per: { unit: 'g', amount: 100 }, calories: 143, protein: 12.6, carbs: 0.7, fats: 9.5, grams: { piece: 50, serving: 50 }, foodStateKey: 'raw', source: 'local_raw_profile:usda', sourceTable: 'local_resolver_cache' },
  { aliases: ['fried egg', 'fried eggs'], category: 'meat', per: { unit: 'g', amount: 100 }, calories: 196, protein: 13.6, carbs: 0.8, fats: 15.3, grams: { piece: 46, serving: 50 }, foodStateKey: 'fried' },
  { aliases: ['egg', 'eggs', 'boiled egg', 'soft boiled egg', 'soft-boiled egg', 'hard boiled egg', 'hard-boiled egg'], category: 'meat', per: { unit: 'g', amount: 100 }, calories: 143, protein: 12.6, carbs: 0.7, fats: 9.5, grams: { piece: 50, serving: 50 }, foodStateKey: 'boiled' },
  { aliases: ['omelette', 'omelet', 'omellete'], per: { unit: 'serving', amount: 1 }, calories: 144, protein: 12.6, carbs: 0.8, fats: 9.6 },
  { aliases: ['toast', 'toasted bread', 'bread toast'], per: { unit: 'g', amount: 100 }, calories: 313, protein: 11.3, carbs: 57.5, fats: 4.2, grams: { slice: 24, serving: 48 } },
  { aliases: ['bread', 'white bread'], per: { unit: 'g', amount: 100 }, calories: 265, protein: 9, carbs: 49, fats: 3.2, grams: { slice: 28, serving: 56 } },
  { aliases: ['whole grain bread', 'whole wheat bread', 'brown bread'], per: { unit: 'g', amount: 100 }, calories: 247, protein: 13, carbs: 41, fats: 4.2, grams: { slice: 32, serving: 64 } },
  { aliases: ['pizza dough', 'pizza base dough', 'pizza crust dough'], per: { unit: 'g', amount: 100 }, calories: 267, protein: 7.8, carbs: 49, fats: 3.3, grams: { serving: 100 } },
  { aliases: ['pasta', 'cooked pasta'], per: { unit: 'g', amount: 100 }, calories: 158, protein: 5.8, carbs: 30.9, fats: 0.9, grams: { cup: 140, serving: 180 } },
  { aliases: ['oats', 'dry oats', 'rolled oats'], per: { unit: 'g', amount: 100 }, calories: 389, protein: 16.9, carbs: 66.3, fats: 6.9, grams: { cup: 80, serving: 40 }, foodStateKey: 'dry' },
  { aliases: ['oatmeal', 'oat meal', 'oat meals', 'cooked oatmeal', 'cooked oat meal', 'prepared oatmeal', 'prepared oat meal', 'porridge', 'oats porridge'], per: { unit: 'g', amount: 100 }, calories: 68, protein: 2.4, carbs: 12, fats: 1.4, grams: { cup: 240, serving: 220 }, foodStateKey: 'cooked' },
  { aliases: ['banana', 'bananas'], per: { unit: 'piece', amount: 1 }, calories: 105, protein: 1.3, carbs: 27, fats: 0.4, grams: { piece: 118, serving: 118 } },
  { aliases: ['orange', 'orange slices'], per: { unit: 'g', amount: 100 }, calories: 47, protein: 0.9, carbs: 11.8, fats: 0.1, grams: { piece: 131, serving: 100 } },
  { aliases: ['strawberry', 'strawberries'], per: { unit: 'g', amount: 100 }, calories: 32, protein: 0.7, carbs: 7.7, fats: 0.3 },
  { aliases: ['blueberry', 'blueberries'], per: { unit: 'g', amount: 100 }, calories: 57, protein: 0.7, carbs: 14.5, fats: 0.3 },
  { aliases: ['berries', 'mixed berries'], per: { unit: 'g', amount: 100 }, calories: 50, protein: 0.9, carbs: 12, fats: 0.4 },
  { aliases: ['raspberry', 'raspberries'], per: { unit: 'g', amount: 100 }, calories: 52, protein: 1.2, carbs: 11.9, fats: 0.7 },
  { aliases: ['blackberry', 'blackberries'], per: { unit: 'g', amount: 100 }, calories: 43, protein: 1.4, carbs: 9.6, fats: 0.5 },
  { aliases: ['grape', 'grapes'], per: { unit: 'g', amount: 100 }, calories: 69, protein: 0.7, carbs: 18.1, fats: 0.2 },
  { aliases: ['mango', 'mango slices'], per: { unit: 'g', amount: 100 }, calories: 60, protein: 0.8, carbs: 15, fats: 0.4 },
  { aliases: ['kiwi', 'kiwifruit', 'kiwi slices'], per: { unit: 'g', amount: 100 }, calories: 61, protein: 1.1, carbs: 14.7, fats: 0.5 },
  { aliases: ['apple', 'apple slices'], per: { unit: 'g', amount: 100 }, calories: 52, protein: 0.3, carbs: 13.8, fats: 0.2 },
  { aliases: ['apricot', 'apricot slices'], per: { unit: 'g', amount: 100 }, calories: 48, protein: 1.4, carbs: 11.1, fats: 0.4 },
  { aliases: ['avocado'], per: { unit: 'g', amount: 100 }, calories: 160, protein: 2, carbs: 8.5, fats: 14.7 },
  { aliases: ['milk'], per: { unit: 'g', amount: 100 }, calories: 61, protein: 3.2, carbs: 4.8, fats: 3.3, grams: { ml: 1, cup: 244, serving: 100 } },
  { aliases: ['yogurt', 'greek yogurt', 'curd'], per: { unit: 'g', amount: 100 }, calories: 61, protein: 10.3, carbs: 3.6, fats: 0.4, grams: { cup: 245, serving: 100 } },
  { aliases: ['raw rice', 'dry rice', 'uncooked rice', 'raw white rice', 'dry white rice'], category: 'grain', per: { unit: 'g', amount: 100 }, calories: 356, protein: 7.9, carbs: 78.2, fats: 0.5, grams: { cup: 185, serving: 100 }, foodStateKey: 'dry', source: 'local_raw_profile:ifct', sourceTable: 'local_resolver_cache' },
  { aliases: ['rice', 'cooked rice', 'white rice', 'steamed rice', 'plain rice', 'basmati rice', 'cooked basmati rice'], category: 'grain', per: { unit: 'g', amount: 100 }, calories: 130, protein: 2.7, carbs: 28.2, fats: 0.3, grams: { cup: 158, serving: 150 } },
  { aliases: ['brown rice', 'cooked brown rice'], per: { unit: 'g', amount: 100 }, calories: 112, protein: 2.3, carbs: 23.5, fats: 0.8, grams: { cup: 195, serving: 150 } },
  { aliases: ['chapati', 'roti'], per: { unit: 'piece', amount: 1 }, calories: 110, protein: 3.5, carbs: 18, fats: 3, grams: { piece: 45, serving: 45 } },
  { aliases: ['dosa', 'plain dosa'], per: { unit: 'piece', amount: 1 }, calories: 165, protein: 3.9, carbs: 29, fats: 3.7, grams: { piece: 100, serving: 100 } },
  { aliases: ['masala dosa'], per: { unit: 'piece', amount: 1 }, calories: 250, protein: 6, carbs: 38, fats: 8, grams: { piece: 180, serving: 180 } },
  { aliases: ['idli'], per: { unit: 'piece', amount: 1 }, calories: 58, protein: 2, carbs: 12, fats: 0.4, grams: { piece: 39, serving: 39 } },
  { aliases: ['poha', 'pohe', 'aval upma', 'flattened rice'], per: { unit: 'g', amount: 100 }, calories: 180, protein: 3.5, carbs: 28, fats: 6, grams: { cup: 160, serving: 180 } },
  { aliases: ['upma', 'rava upma', 'sooji upma', 'suji upma'], per: { unit: 'g', amount: 100 }, calories: 155, protein: 4, carbs: 25, fats: 5, grams: { cup: 160, serving: 180 } },
  { aliases: ['pongal', 'ven pongal', 'khara pongal'], per: { unit: 'g', amount: 100 }, calories: 135, protein: 4, carbs: 22, fats: 4, grams: { cup: 180, serving: 220 } },
  { aliases: ['paneer'], per: { unit: 'g', amount: 100 }, calories: 265, protein: 18, carbs: 1.2, fats: 20.8, grams: { cup: 120, serving: 100 } },
  { aliases: ['shrimp', 'prawn', 'prawns', 'cooked shrimp', 'cooked prawns'], category: 'meat', per: { unit: 'g', amount: 100 }, calories: 99, protein: 24, carbs: 0.2, fats: 0.3, grams: { serving: 100 } },
  { aliases: ['onion tomato gravy', 'tomato onion gravy', 'curry gravy', 'indian gravy'], category: 'cooked_side', per: { unit: 'g', amount: 100 }, calories: 75, protein: 1.8, carbs: 8, fats: 4, grams: { cup: 180, serving: 100 } },
  { aliases: ['coconut curry base', 'coconut milk base', 'curd base', 'yogurt curry base', 'water coconut curd base'], category: 'cooked_side', per: { unit: 'g', amount: 100 }, calories: 80, protein: 2.2, carbs: 4.5, fats: 6, grams: { serving: 100 } },
  { aliases: ['dal', 'dhal', 'daal', 'lentils', 'cooked lentils', 'boiled lentils', 'dal soup', 'lentil soup', 'lentil dal', 'toor dal', 'moong dal', 'yellow dal', 'dal tadka'], per: { unit: 'g', amount: 100 }, calories: 110, protein: 6, carbs: 16, fats: 2.5, grams: { cup: 200, serving: 150 } },
  { aliases: ['sambar', 'sambhar', 'sambaar'], per: { unit: 'g', amount: 100 }, calories: 76, protein: 3.4, carbs: 10, fats: 2.4, grams: { cup: 240, serving: 150 } },
  { aliases: ['rasam', 'charu', 'saaru'], per: { unit: 'g', amount: 100 }, calories: 35, protein: 1.2, carbs: 5.5, fats: 1, grams: { cup: 240, serving: 150 } },
  { aliases: ['rajma', 'rajma curry', 'kidney bean curry'], per: { unit: 'g', amount: 100 }, calories: 125, protein: 6.5, carbs: 18, fats: 3, grams: { cup: 180, serving: 150 } },
  { aliases: ['raw chickpeas', 'dry chickpeas', 'dried chickpeas', 'uncooked chickpeas', 'raw chana', 'dry chana', 'dried chana', 'raw kabuli chana'], category: 'legumes', per: { unit: 'g', amount: 100 }, calories: 378, protein: 20.5, carbs: 63, fats: 6, grams: { cup: 200, serving: 100 }, foodStateKey: 'raw', source: 'local_raw_profile', sourceTable: 'local_resolver_cache' },
  { aliases: ['chickpeas', 'boiled chickpeas', 'cooked chickpeas', 'chana', 'boiled chana', 'cooked chana', 'kabuli chana'], category: 'legumes', per: { unit: 'g', amount: 100 }, calories: 164, protein: 8.9, carbs: 27.4, fats: 2.6, grams: { cup: 164, serving: 100 } },
  { aliases: ['chole', 'chana masala', 'chickpea curry', 'channa masala'], per: { unit: 'g', amount: 100 }, calories: 164, protein: 7.5, carbs: 22, fats: 5, grams: { cup: 180, serving: 150 } },
  { aliases: ['paneer curry', 'paneer sabzi', 'paneer gravy'], per: { unit: 'g', amount: 100 }, calories: 190, protein: 9, carbs: 7, fats: 14, grams: { cup: 180, serving: 150 } },
  { aliases: ['paneer butter masala', 'paneer makhani'], per: { unit: 'g', amount: 100 }, calories: 210, protein: 8, carbs: 8, fats: 16, grams: { cup: 180, serving: 150 } },
  { aliases: ['chicken curry', 'chicken gravy'], per: { unit: 'g', amount: 100 }, calories: 170, protein: 16, carbs: 5, fats: 10, grams: { cup: 180, serving: 150 } },
  { aliases: ['egg curry', 'anda curry'], per: { unit: 'g', amount: 100 }, calories: 155, protein: 10, carbs: 5, fats: 11, grams: { cup: 180, serving: 150 } },
  { aliases: ['raw chicken', 'uncooked chicken', 'raw chicken breast', 'uncooked chicken breast'], category: 'meat', per: { unit: 'g', amount: 100 }, calories: 120, protein: 22.5, carbs: 0, fats: 2.6, grams: { serving: 100 }, foodStateKey: 'raw', source: 'local_raw_profile:usda', sourceTable: 'local_resolver_cache' },
  { aliases: ['chicken', 'chicken breast', 'boiled chicken', 'shredded chicken', 'boiled shredded chicken', 'boiled chicken breast', 'shredded chicken breast'], per: { unit: 'g', amount: 100 }, calories: 165, protein: 31, carbs: 0, fats: 3.6, grams: { cup: 140, serving: 100 } },
  { aliases: ['salmon', 'grilled salmon', 'cooked salmon'], per: { unit: 'g', amount: 100 }, calories: 208, protein: 22.1, carbs: 0, fats: 12.4, grams: { fillet: 170, serving: 120 } },
  { aliases: ['quinoa', 'cooked quinoa'], per: { unit: 'g', amount: 100 }, calories: 120, protein: 4.4, carbs: 21.3, fats: 1.9, grams: { cup: 185, serving: 100 } },
  { aliases: ['couscous', 'cooked couscous'], per: { unit: 'g', amount: 100 }, calories: 112, protein: 3.8, carbs: 23.2, fats: 0.2, grams: { cup: 157, serving: 100 } },
  { aliases: ['corn', 'corn kernels'], per: { unit: 'g', amount: 100 }, calories: 96, protein: 3.4, carbs: 21, fats: 1.5, grams: { cup: 164, serving: 80 } },
  { aliases: ['broccoli', 'broccoli florets', 'cooked broccoli'], per: { unit: 'g', amount: 100 }, calories: 35, protein: 2.4, carbs: 7.2, fats: 0.4, grams: { cup: 156, serving: 85 } },
  { aliases: ['cucumber', 'cucumber slices'], per: { unit: 'g', amount: 100 }, calories: 15, protein: 0.7, carbs: 3.6, fats: 0.1, grams: { slice: 7, cup: 104, serving: 50 } },
  { aliases: ['red bell pepper', 'bell pepper', 'red pepper', 'yellow bell pepper', 'yellow pepper', 'green bell pepper', 'green pepper', 'sweet pepper'], per: { unit: 'g', amount: 100 }, calories: 31, protein: 1, carbs: 6, fats: 0.3, grams: { slice: 10, cup: 92, serving: 50 } },
  { aliases: ['okra', 'fried okra', 'okra fry', 'okra stir fry', 'bhindi', 'bhindi fry', 'bhindi stir fry', 'lady finger', 'ladies finger'], per: { unit: 'g', amount: 100 }, calories: 95, protein: 2, carbs: 10, fats: 5, grams: { cup: 100, serving: 100 } },
  { aliases: ['fried eggplant', 'eggplant fry', 'brinjal fry', 'fried brinjal'], category: 'cooked_side', per: { unit: 'g', amount: 100 }, calories: 160, protein: 1.4, carbs: 10, fats: 13, grams: { serving: 100 } },
  { aliases: ['fried potato', 'fried potatoes', 'french fries', 'potato fries', 'fries'], category: 'cooked_side', per: { unit: 'g', amount: 100 }, calories: 312, protein: 3.4, carbs: 41.4, fats: 14.7, grams: { serving: 100 }, foodStateKey: 'fried', source: 'local_fried_profile:usda', sourceTable: 'local_resolver_cache' },
  { aliases: ['potato', 'potatoes', 'boiled potato', 'boiled potatoes', 'cooked potato', 'cooked potatoes', 'plain potato'], category: 'cooked_side', per: { unit: 'g', amount: 100 }, calories: 86, protein: 1.7, carbs: 20, fats: 0.1, grams: { serving: 100 }, foodStateKey: 'boiled', source: 'local_cooked_profile:usda', sourceTable: 'local_resolver_cache' },
  { aliases: ['aloo sabzi', 'aloo curry', 'potato sabzi', 'potato curry'], per: { unit: 'g', amount: 100 }, calories: 120, protein: 2.2, carbs: 18, fats: 4.5, grams: { cup: 150, serving: 120 } },
  { aliases: ['mixed veg', 'mixed veg sabzi', 'mixed vegetable sabzi', 'vegetable curry', 'mixed vegetables'], per: { unit: 'g', amount: 100 }, calories: 85, protein: 2.5, carbs: 12, fats: 3.5, grams: { cup: 150, serving: 120 } },
  { aliases: ['spinach', 'baby spinach'], per: { unit: 'g', amount: 100 }, calories: 23, protein: 2.9, carbs: 3.6, fats: 0.4, grams: { cup: 30, serving: 30 } },
  { aliases: ['arugula', 'rocket', 'rocket leaves'], per: { unit: 'g', amount: 100 }, calories: 25, protein: 2.6, carbs: 3.7, fats: 0.7, grams: { cup: 20, serving: 20 } },
  { aliases: ['basil', 'basil leaves', 'basil leaf'], per: { unit: 'g', amount: 100 }, calories: 23, protein: 3.2, carbs: 2.7, fats: 0.6, grams: { serving: 5 } },
  { aliases: ['lettuce'], per: { unit: 'g', amount: 100 }, calories: 15, protein: 1.4, carbs: 2.9, fats: 0.2, grams: { handful: 20, cup: 35, serving: 30 } },
  { aliases: ['onion', 'red onion', 'white onion', 'yellow onion'], per: { unit: 'g', amount: 100 }, calories: 40, protein: 1.1, carbs: 9.3, fats: 0.1, grams: { slice: 14, serving: 50 } },
  { aliases: ['tomato sauce', 'pizza sauce', 'marinara sauce'], per: { unit: 'g', amount: 100 }, calories: 29, protein: 1.4, carbs: 6, fats: 0.2, grams: { tbsp: 16, serving: 50 } },
  { aliases: ['tomato', 'tomatoes', 'cherry tomato', 'cherry tomatoes'], per: { unit: 'g', amount: 100 }, calories: 18, protein: 0.9, carbs: 3.9, fats: 0.2, grams: { piece: 17, serving: 80 } },
  { aliases: ['carrot', 'carrots', 'carrot sticks'], per: { unit: 'g', amount: 100 }, calories: 41, protein: 0.9, carbs: 9.6, fats: 0.2, grams: { piece: 61, serving: 80 } },
  { aliases: ['mozzarella', 'mozzarella cheese', 'fresh mozzarella'], per: { unit: 'g', amount: 100 }, calories: 280, protein: 28, carbs: 3.1, fats: 17, grams: { slice: 28, serving: 30 } },
  { aliases: ['cheese', 'cheddar cheese', 'cheese slice'], per: { unit: 'g', amount: 100 }, calories: 402, protein: 25, carbs: 1.3, fats: 33.1, grams: { slice: 20, serving: 30 } },
  { aliases: ['chocolate cake', 'cake', 'cake slice', 'chocolate cake slice'], per: { unit: 'g', amount: 100 }, calories: 370, protein: 4.5, carbs: 52, fats: 16, grams: { slice: 100, serving: 100 } },
  { aliases: ['oat muffin', 'oat muffins', 'oatmeal muffin', 'oatmeal muffins'], per: { unit: 'g', amount: 100 }, calories: 310, protein: 6.5, carbs: 45, fats: 11, grams: { piece: 60, serving: 80 } },
  { aliases: ['muffin', 'muffins'], per: { unit: 'g', amount: 100 }, calories: 340, protein: 5.5, carbs: 52, fats: 12, grams: { piece: 70, serving: 80 } },
  { aliases: ['almond', 'almonds'], per: { unit: 'g', amount: 100 }, calories: 579, protein: 21.2, carbs: 21.6, fats: 49.9, grams: { piece: 1.2, serving: 28 } },
  { aliases: ['cashew', 'cashews'], per: { unit: 'g', amount: 100 }, calories: 553, protein: 18.2, carbs: 30.2, fats: 43.9, grams: { piece: 1.6, serving: 28 } },
  { aliases: ['walnut', 'walnuts'], per: { unit: 'g', amount: 100 }, calories: 654, protein: 15.2, carbs: 13.7, fats: 65.2, grams: { piece: 2, serving: 28 } },
  { aliases: ['pistachio', 'pistachios'], per: { unit: 'g', amount: 100 }, calories: 560, protein: 20.2, carbs: 27.2, fats: 45.3, grams: { piece: 0.7, serving: 28 } },
  { aliases: ['peanut', 'peanuts', 'nuts', 'mixed nuts', 'chopped nuts'], per: { unit: 'g', amount: 100 }, calories: 567, protein: 25.8, carbs: 16.1, fats: 49.2, grams: { piece: 1, serving: 28 } },
  { aliases: ['biryani', 'chicken biryani', 'veg biryani', 'vegetable biryani', 'dum biryani'], per: { unit: 'g', amount: 100 }, calories: 170, protein: 7, carbs: 24, fats: 5, grams: { cup: 200, serving: 350 } },
  { aliases: ['pulao', 'pulav', 'veg pulao', 'vegetable pulao'], per: { unit: 'g', amount: 100 }, calories: 150, protein: 3.5, carbs: 26, fats: 4, grams: { cup: 180, serving: 300 } },
  { aliases: ['fried rice', 'veg fried rice', 'vegetable fried rice', 'chicken fried rice', 'egg fried rice'], per: { unit: 'g', amount: 100 }, calories: 160, protein: 4.5, carbs: 25, fats: 5, grams: { cup: 180, serving: 300 } },
  { aliases: ['curd rice', 'yogurt rice', 'thayir sadam', 'dahi chawal'], per: { unit: 'g', amount: 100 }, calories: 118, protein: 3.5, carbs: 18, fats: 3.5, grams: { cup: 200, serving: 250 } },
  { aliases: ['lemon rice', 'chitranna', 'nimbu rice'], per: { unit: 'g', amount: 100 }, calories: 165, protein: 3, carbs: 28, fats: 5, grams: { cup: 180, serving: 250 } },
  { aliases: ['samosa', 'samosas'], per: { unit: 'g', amount: 100 }, calories: 310, protein: 6, carbs: 34, fats: 17, grams: { piece: 65, serving: 65 } },
  { aliases: ['pakora', 'pakoda', 'bhajiya', 'fritters'], per: { unit: 'g', amount: 100 }, calories: 320, protein: 8, carbs: 30, fats: 18, grams: { piece: 25, serving: 100 } },
  { aliases: ['gulab jamun'], per: { unit: 'g', amount: 100 }, calories: 320, protein: 5, carbs: 52, fats: 10, grams: { piece: 50, serving: 50 } },
  { aliases: ['cracker', 'crackers', 'simple mills crackers', 'almond flour crackers'], per: { unit: 'g', amount: 100 }, calories: 500, protein: 10, carbs: 57, fats: 27 },
  { aliases: ['peanut butter', 'natural peanut butter', 'pb'], per: { unit: 'tbsp', amount: 1 }, calories: 94, protein: 3.5, carbs: 3.2, fats: 8, spread: { gramsPerTbsp: 16 } },
  { aliases: ['sugar'], per: { unit: 'tsp', amount: 1 }, calories: 16, protein: 0, carbs: 4.2, fats: 0 },
];

const localRecipeTemplates = [
  { name: 'Shrimp Curry', search_key: 'shrimp curry', aliases: ['shrimp curry', 'prawn curry', 'prawns curry'], cuisine: 'indian', default_serving_grams: 250, confidence: 0.72, items: [
    { ingredient_name: 'shrimp', percentage: 45, min_percentage: 35, max_percentage: 55 },
    { ingredient_name: 'onion tomato gravy', percentage: 30, min_percentage: 22, max_percentage: 38 },
    { ingredient_name: 'oil', percentage: 8, min_percentage: 4, max_percentage: 10 },
    { ingredient_name: 'spices', percentage: 5, min_percentage: 2, max_percentage: 7 },
    { ingredient_name: 'coconut curry base', percentage: 12, min_percentage: 5, max_percentage: 18 },
  ] },
  { name: 'Chicken Curry', search_key: 'chicken curry', aliases: ['chicken curry', 'chicken gravy'], cuisine: 'indian', default_serving_grams: 250, confidence: 0.72, items: [
    { ingredient_name: 'chicken breast', percentage: 48, min_percentage: 38, max_percentage: 58 },
    { ingredient_name: 'onion tomato gravy', percentage: 34, min_percentage: 25, max_percentage: 42 },
    { ingredient_name: 'oil', percentage: 6, min_percentage: 3, max_percentage: 9 },
    { ingredient_name: 'spices', percentage: 4, min_percentage: 2, max_percentage: 6 },
    { ingredient_name: 'curd base', percentage: 8, min_percentage: 0, max_percentage: 14 },
  ] },
  { name: 'Egg Curry', search_key: 'egg curry', aliases: ['egg curry', 'anda curry'], cuisine: 'indian', default_serving_grams: 220, confidence: 0.72, items: [
    { ingredient_name: 'egg', percentage: 45, min_percentage: 35, max_percentage: 52 },
    { ingredient_name: 'onion tomato gravy', percentage: 40, min_percentage: 30, max_percentage: 48 },
    { ingredient_name: 'oil', percentage: 7, min_percentage: 3, max_percentage: 10 },
    { ingredient_name: 'spices', percentage: 4, min_percentage: 2, max_percentage: 6 },
    { ingredient_name: 'coconut curry base', percentage: 4, min_percentage: 0, max_percentage: 10 },
  ] },
  { name: 'Paneer Butter Masala', search_key: 'paneer butter masala', aliases: ['paneer butter masala', 'paneer makhani'], cuisine: 'indian', default_serving_grams: 300, confidence: 0.74, items: [
    { ingredient_name: 'paneer', percentage: 38, min_percentage: 30, max_percentage: 48 },
    { ingredient_name: 'onion tomato gravy', percentage: 38, min_percentage: 30, max_percentage: 45 },
    { ingredient_name: 'butter', percentage: 7, min_percentage: 4, max_percentage: 10 },
    { ingredient_name: 'milk', percentage: 13, min_percentage: 5, max_percentage: 18 },
    { ingredient_name: 'spices', percentage: 4, min_percentage: 2, max_percentage: 6 },
  ] },
  { name: 'Dal Tadka', search_key: 'dal tadka', aliases: ['dal tadka', 'yellow dal tadka'], cuisine: 'indian', default_serving_grams: 180, confidence: 0.72, items: [
    { ingredient_name: 'dal', percentage: 82, min_percentage: 75, max_percentage: 88 },
    { ingredient_name: 'oil', percentage: 5, min_percentage: 2, max_percentage: 8 },
    { ingredient_name: 'onion tomato gravy', percentage: 9, min_percentage: 4, max_percentage: 14 },
    { ingredient_name: 'spices', percentage: 4, min_percentage: 2, max_percentage: 6 },
  ] },
  { name: 'Vegetable Biryani', search_key: 'veg biryani', aliases: ['veg biryani', 'vegetable biryani'], cuisine: 'indian', default_serving_grams: 350, confidence: 0.72, items: [
    { ingredient_name: 'cooked rice', percentage: 62, min_percentage: 55, max_percentage: 70 },
    { ingredient_name: 'mixed vegetables', percentage: 22, min_percentage: 15, max_percentage: 30 },
    { ingredient_name: 'oil', percentage: 5, min_percentage: 3, max_percentage: 8 },
    { ingredient_name: 'curd', percentage: 7, min_percentage: 0, max_percentage: 12 },
    { ingredient_name: 'spices', percentage: 4, min_percentage: 2, max_percentage: 6 },
  ] },
  { name: 'Chicken Biryani', search_key: 'chicken biryani', aliases: ['chicken biryani', 'dum biryani'], cuisine: 'indian', default_serving_grams: 380, confidence: 0.72, items: [
    { ingredient_name: 'cooked rice', percentage: 55, min_percentage: 48, max_percentage: 62 },
    { ingredient_name: 'chicken breast', percentage: 27, min_percentage: 20, max_percentage: 35 },
    { ingredient_name: 'oil', percentage: 5, min_percentage: 3, max_percentage: 8 },
    { ingredient_name: 'curd', percentage: 8, min_percentage: 3, max_percentage: 12 },
    { ingredient_name: 'spices', percentage: 5, min_percentage: 2, max_percentage: 7 },
  ] },
  { name: 'Fried Rice', search_key: 'fried rice', aliases: ['fried rice', 'veg fried rice', 'vegetable fried rice', 'egg fried rice', 'chicken fried rice'], cuisine: 'asian', default_serving_grams: 300, confidence: 0.7, items: [
    { ingredient_name: 'cooked rice', percentage: 72, min_percentage: 65, max_percentage: 80 },
    { ingredient_name: 'mixed vegetables', percentage: 15, min_percentage: 8, max_percentage: 22 },
    { ingredient_name: 'oil', percentage: 5, min_percentage: 3, max_percentage: 8 },
    { ingredient_name: 'egg', percentage: 8, min_percentage: 0, max_percentage: 16 },
  ] },
  { name: 'Pulao', search_key: 'pulao', aliases: ['pulao', 'pulav', 'veg pulao', 'vegetable pulao'], cuisine: 'indian', default_serving_grams: 300, confidence: 0.7, items: [
    { ingredient_name: 'cooked rice', percentage: 72, min_percentage: 65, max_percentage: 80 },
    { ingredient_name: 'mixed vegetables', percentage: 17, min_percentage: 10, max_percentage: 24 },
    { ingredient_name: 'oil', percentage: 5, min_percentage: 3, max_percentage: 8 },
    { ingredient_name: 'spices', percentage: 3, min_percentage: 1, max_percentage: 5 },
    { ingredient_name: 'onion', percentage: 3, min_percentage: 0, max_percentage: 8 },
  ] },
  { name: 'Poha', search_key: 'poha', aliases: ['poha', 'pohe', 'aval upma'], cuisine: 'indian', default_serving_grams: 180, confidence: 0.7, items: [
    { ingredient_name: 'poha', percentage: 82, min_percentage: 75, max_percentage: 88 },
    { ingredient_name: 'oil', percentage: 5, min_percentage: 3, max_percentage: 8 },
    { ingredient_name: 'peanuts', percentage: 6, min_percentage: 2, max_percentage: 10 },
    { ingredient_name: 'onion', percentage: 5, min_percentage: 0, max_percentage: 10 },
    { ingredient_name: 'spices', percentage: 2, min_percentage: 1, max_percentage: 4 },
  ] },
  { name: 'Upma', search_key: 'upma', aliases: ['upma', 'rava upma', 'sooji upma', 'suji upma'], cuisine: 'indian', default_serving_grams: 180, confidence: 0.7, items: [
    { ingredient_name: 'upma', percentage: 84, min_percentage: 76, max_percentage: 90 },
    { ingredient_name: 'mixed vegetables', percentage: 9, min_percentage: 4, max_percentage: 14 },
    { ingredient_name: 'oil', percentage: 5, min_percentage: 3, max_percentage: 8 },
    { ingredient_name: 'spices', percentage: 2, min_percentage: 1, max_percentage: 4 },
  ] },
  { name: 'Sambar', search_key: 'sambar', aliases: ['sambar', 'sambhar'], cuisine: 'indian', default_serving_grams: 180, confidence: 0.72, items: [
    { ingredient_name: 'sambar', percentage: 88, min_percentage: 80, max_percentage: 94 },
    { ingredient_name: 'mixed vegetables', percentage: 7, min_percentage: 2, max_percentage: 12 },
    { ingredient_name: 'oil', percentage: 3, min_percentage: 1, max_percentage: 5 },
    { ingredient_name: 'spices', percentage: 2, min_percentage: 1, max_percentage: 4 },
  ] },
  { name: 'Rasam', search_key: 'rasam', aliases: ['rasam', 'charu', 'saaru'], cuisine: 'indian', default_serving_grams: 150, confidence: 0.72, items: [
    { ingredient_name: 'rasam', percentage: 92, min_percentage: 86, max_percentage: 96 },
    { ingredient_name: 'tomato', percentage: 4, min_percentage: 1, max_percentage: 8 },
    { ingredient_name: 'oil', percentage: 2, min_percentage: 0, max_percentage: 4 },
    { ingredient_name: 'spices', percentage: 2, min_percentage: 1, max_percentage: 4 },
  ] },
  { name: 'Chole', search_key: 'chole', aliases: ['chole', 'chana masala'], cuisine: 'indian', default_serving_grams: 180, confidence: 0.72, items: [
    { ingredient_name: 'chole', percentage: 82, min_percentage: 75, max_percentage: 90 },
    { ingredient_name: 'onion tomato gravy', percentage: 12, min_percentage: 6, max_percentage: 18 },
    { ingredient_name: 'oil', percentage: 4, min_percentage: 2, max_percentage: 7 },
    { ingredient_name: 'spices', percentage: 2, min_percentage: 1, max_percentage: 4 },
  ] },
  { name: 'Rajma', search_key: 'rajma', aliases: ['rajma', 'rajma curry'], cuisine: 'indian', default_serving_grams: 180, confidence: 0.72, items: [
    { ingredient_name: 'rajma', percentage: 82, min_percentage: 75, max_percentage: 90 },
    { ingredient_name: 'onion tomato gravy', percentage: 12, min_percentage: 6, max_percentage: 18 },
    { ingredient_name: 'oil', percentage: 4, min_percentage: 2, max_percentage: 7 },
    { ingredient_name: 'spices', percentage: 2, min_percentage: 1, max_percentage: 4 },
  ] },
  { name: 'Aloo Gobi', search_key: 'aloo gobi', aliases: ['aloo gobi', 'aloo gobhi'], cuisine: 'indian', default_serving_grams: 150, confidence: 0.7, items: [
    { ingredient_name: 'aloo sabzi', percentage: 45, min_percentage: 35, max_percentage: 55 },
    { ingredient_name: 'mixed vegetables', percentage: 42, min_percentage: 32, max_percentage: 52 },
    { ingredient_name: 'oil', percentage: 7, min_percentage: 3, max_percentage: 10 },
    { ingredient_name: 'spices', percentage: 6, min_percentage: 2, max_percentage: 8 },
  ] },
  { name: 'Palak Paneer', search_key: 'palak paneer', aliases: ['palak paneer', 'saag paneer'], cuisine: 'indian', default_serving_grams: 250, confidence: 0.72, items: [
    { ingredient_name: 'paneer', percentage: 36, min_percentage: 28, max_percentage: 45 },
    { ingredient_name: 'spinach', percentage: 42, min_percentage: 34, max_percentage: 52 },
    { ingredient_name: 'onion tomato gravy', percentage: 12, min_percentage: 6, max_percentage: 18 },
    { ingredient_name: 'oil', percentage: 6, min_percentage: 3, max_percentage: 9 },
    { ingredient_name: 'spices', percentage: 4, min_percentage: 2, max_percentage: 6 },
  ] },
  { name: 'Mixed Vegetable Curry', search_key: 'mixed vegetable curry', aliases: ['mixed vegetable curry', 'vegetable curry', 'mixed veg curry'], cuisine: 'indian', default_serving_grams: 180, confidence: 0.7, items: [
    { ingredient_name: 'mixed vegetables', percentage: 78, min_percentage: 68, max_percentage: 86 },
    { ingredient_name: 'onion tomato gravy', percentage: 14, min_percentage: 8, max_percentage: 20 },
    { ingredient_name: 'oil', percentage: 5, min_percentage: 2, max_percentage: 8 },
    { ingredient_name: 'spices', percentage: 3, min_percentage: 1, max_percentage: 5 },
  ] },
  { name: 'Pasta', search_key: 'pasta', aliases: ['pasta', 'red sauce pasta', 'white sauce pasta'], cuisine: 'global', default_serving_grams: 300, confidence: 0.68, items: [
    { ingredient_name: 'pasta', percentage: 70, min_percentage: 62, max_percentage: 78 },
    { ingredient_name: 'tomato sauce', percentage: 18, min_percentage: 10, max_percentage: 28 },
    { ingredient_name: 'cheese', percentage: 7, min_percentage: 0, max_percentage: 12 },
    { ingredient_name: 'oil', percentage: 5, min_percentage: 2, max_percentage: 8 },
  ] },
  { name: 'Sandwich', search_key: 'sandwich', aliases: ['sandwich', 'veg sandwich', 'chicken sandwich'], cuisine: 'global', default_serving_grams: 180, confidence: 0.7, items: [
    { ingredient_name: 'bread', percentage: 55, min_percentage: 45, max_percentage: 65 },
    { ingredient_name: 'cheese', percentage: 12, min_percentage: 0, max_percentage: 18 },
    { ingredient_name: 'tomato', percentage: 10, min_percentage: 4, max_percentage: 16 },
    { ingredient_name: 'cucumber', percentage: 10, min_percentage: 4, max_percentage: 16 },
    { ingredient_name: 'butter', percentage: 3, min_percentage: 0, max_percentage: 6 },
  ] },
  { name: 'Smoothie', search_key: 'smoothie', aliases: ['smoothie', 'fruit smoothie', 'protein smoothie'], cuisine: 'global', default_serving_grams: 300, confidence: 0.68, items: [
    { ingredient_name: 'milk', percentage: 55, min_percentage: 45, max_percentage: 65 },
    { ingredient_name: 'banana', percentage: 20, min_percentage: 10, max_percentage: 30 },
    { ingredient_name: 'yogurt', percentage: 20, min_percentage: 10, max_percentage: 30 },
    { ingredient_name: 'berries', percentage: 5, min_percentage: 0, max_percentage: 12 },
  ] },
  { name: 'Pizza', search_key: 'pizza', aliases: ['pizza', 'pizza slice'], cuisine: 'global', default_serving_grams: 250, confidence: 0.68, items: [
    { ingredient_name: 'pizza dough', percentage: 55, min_percentage: 45, max_percentage: 65 },
    { ingredient_name: 'mozzarella cheese', percentage: 18, min_percentage: 12, max_percentage: 26 },
    { ingredient_name: 'tomato sauce', percentage: 15, min_percentage: 8, max_percentage: 22 },
    { ingredient_name: 'oil', percentage: 4, min_percentage: 2, max_percentage: 7 },
    { ingredient_name: 'mixed vegetables', percentage: 8, min_percentage: 0, max_percentage: 15 },
  ] },
  { name: 'Breakfast Grain Bowl', search_key: 'grain breakfast bowl', aliases: ['oat bowl', 'oats bowl', 'oatmeal bowl', 'porridge bowl', 'breakfast bowl'], cuisine: 'global', default_serving_grams: 500, confidence: 0.68, items: [
    { ingredient_name: 'cooked oatmeal', percentage: 55, min_percentage: 45, max_percentage: 70 },
    { ingredient_name: 'milk', percentage: 18, min_percentage: 0, max_percentage: 25 },
    { ingredient_name: 'berries', percentage: 12, min_percentage: 5, max_percentage: 20 },
    { ingredient_name: 'apple slices', percentage: 8, min_percentage: 0, max_percentage: 15 },
    { ingredient_name: 'peanut butter', percentage: 4, min_percentage: 0, max_percentage: 8 },
    { ingredient_name: 'chopped nuts', percentage: 3, min_percentage: 0, max_percentage: 6 },
  ] },
  { name: 'Composite Indian Thali', search_key: 'indian thali', aliases: ['thali', 'indian thali', 'south indian thali', 'meal plate', 'combo meal', 'platter'], cuisine: 'indian', default_serving_grams: 500, confidence: 0.66, items: [
    { ingredient_name: 'cooked rice', percentage: 32, min_percentage: 22, max_percentage: 42 },
    { ingredient_name: 'sambar', percentage: 22, min_percentage: 14, max_percentage: 30 },
    { ingredient_name: 'rasam', percentage: 12, min_percentage: 6, max_percentage: 18 },
    { ingredient_name: 'mixed vegetable curry', percentage: 16, min_percentage: 8, max_percentage: 24 },
    { ingredient_name: 'curd', percentage: 10, min_percentage: 0, max_percentage: 16 },
    { ingredient_name: 'chapati', percentage: 8, min_percentage: 0, max_percentage: 16 },
  ] },
];

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const parseAmount = (value) => {
  if (!value) return 1;
  const raw = String(value).trim().toLowerCase();
  const fraction = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const range = raw.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (range) return (Number(range[1]) + Number(range[2])) / 2;
  if (raw === 'half') return 0.5;
  if (raw === 'a' || raw === 'an') return 1;
  const normalized = normalize(value);
  if (numberWords[normalized]) return numberWords[normalized];
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
};

const quantityParts = (quantity) => {
  const text = String(quantity || '').toLowerCase();
  const match = text.match(/\b(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?|\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half|a|an)\s*(tbsp|tablespoons?|tsp|teaspoons?|grams?|g|ml|litres?|liters?|l|cups?|slices?|pieces?|bars?|packs?|packets?|eggs?|handfuls?|bowls?|plates?|servings?)?\b/);
  if (!match) {
    if (/\bhandfuls?\b/.test(text)) return { amount: 1, unit: 'handful' };
    return null;
  }
  return {
    amount: parseAmount(match[1]),
    unit: unitAliases[match[2]] || null,
  };
};

const quantityNeedsPackageSize = (quantity, profile) => {
  if (profile?.source !== 'open_food_facts' || profile?.per?.unit !== 'g') return false;
  const parts = quantityParts(quantity);
  if (!parts) return true;
  if (['g', 'ml', 'l'].includes(parts.unit)) return false;
  if (parts.unit && profile.grams?.[parts.unit]) return false;
  return true;
};

const needsPackageSizeIngredient = ({ name, quantity }) => ({
  _rowId: crypto.randomUUID(),
  name,
  quantity: String(quantity || '1').trim(),
  calories: 0,
  protein: 0,
  carbs: 0,
  fats: 0,
  _needsCalculation: true,
  _needsQuantity: true,
  source: 'needs_quantity',
});

const dbServingSizeCache = new Map();

const dbServingSizesFor = async (name) => {
  const key = compactName(name);
  if (!key) return {};
  if (dbServingSizeCache.has(key)) return dbServingSizeCache.get(key);

  try {
    const { data, error } = await supabase
      .from('serving_sizes')
      .select('unit, grams, ml, priority, confidence')
      .eq('search_key', key)
      .order('priority', { ascending: true });

    if (error) throw error;

    const grams = {};
    const liquid = {};
    for (const row of data || []) {
      const unit = unitAliases[String(row.unit || '').toLowerCase()] || row.unit;
      if (!unit) continue;
      if (row.grams !== null && row.grams !== undefined && grams[unit] === undefined) grams[unit] = Number(row.grams);
      if (row.ml !== null && row.ml !== undefined && liquid[unit] === undefined) liquid[unit] = Number(row.ml);
    }

    const result = { grams, liquid };
    dbServingSizeCache.set(key, result);
    return result;
  } catch (error) {
    console.warn('Serving size lookup skipped:', error?.message || error);
    dbServingSizeCache.set(key, {});
    return {};
  }
};

const gramQuantityFor = (quantity, profile) => {
  if (profile.per.unit !== 'g') return quantity;
  const parts = quantityParts(quantity);
  if (!parts) return `${profile.grams?.serving || profile.per.amount}g`;
  if (parts.unit === 'g') return `${Math.round(parts.amount)}g`;
  if (parts.unit && profile.grams?.[parts.unit]) return `${Math.round(parts.amount * profile.grams[parts.unit])}g`;
  if (parts.unit === 'serving' && profile.grams?.serving) return `${Math.round(parts.amount * profile.grams.serving)}g`;
  if (!parts.unit && profile.grams?.piece) return `${Number((parts.amount * profile.grams.piece).toFixed(1))}g`;
  return `${Math.round(parts.amount * (profile.grams?.serving || profile.per.amount))}g`;
};

const formatTbsp = (value) => {
  if (value < 1) return `${Number((value * 3).toFixed(1))} tsp`;
  return `${Number(value.toFixed(1))} tbsp`;
};

const liquidQuantityFor = (quantity, profile) => {
  if (!profile.liquid) return quantity;
  const parts = quantityParts(quantity);
  if (!parts) return quantity;
  if (parts.unit === 'tbsp') return `${Number(parts.amount.toFixed(1))} tbsp`;
  if (parts.unit === 'tsp') return `${Number(parts.amount.toFixed(1))} tsp`;
  if (parts.unit === 'ml') return `${Math.round(parts.amount)}ml`;
  if (parts.unit === 'l') return `${Number(parts.amount.toFixed(2))}l`;
  if (parts.unit === 'g') return formatTbsp(parts.amount / profile.liquid.gramsPerTbsp);
  return quantity;
};

const spreadQuantityFor = (quantity, profile) => {
  if (!profile.spread) return quantity;
  const parts = quantityParts(quantity);
  if (!parts) return quantity;
  if (parts.unit === 'tbsp') return `${Number(parts.amount.toFixed(1))} tbsp`;
  if (parts.unit === 'tsp') return `${Number(parts.amount.toFixed(1))} tsp`;
  if (parts.unit === 'g') return `${Math.round(parts.amount)}g`;
  return `${Number(parts.amount.toFixed(1))} tbsp`;
};

const displayQuantityFor = (quantity, profile) =>
  profile.liquid ? liquidQuantityFor(quantity, profile) : profile.spread ? spreadQuantityFor(quantity, profile) : gramQuantityFor(quantity, profile);

const compactName = compactBaseName;

const stateSpecificProfiles = [
  { state: 'punjab', region: 'north_india', aliases: ['punjabi dal tadka', 'punjabi dal', 'north indian dal tadka'], canonical: 'Dal Tadka', calories: 120, protein: 6.2, carbs: 16, fats: 3.5, grams: { cup: 200, serving: 180 } },
  { state: 'gujarat', region: 'west_india', aliases: ['gujarati dal'], canonical: 'Gujarati Dal', calories: 95, protein: 4.8, carbs: 15.8, fats: 1.8, grams: { cup: 200, serving: 180 } },
  { state: 'andhra_pradesh', region: 'south_india', aliases: ['andhra dal', 'andhra pappu', 'pappu'], canonical: 'Andhra Pappu', calories: 116, protein: 6.4, carbs: 16.8, fats: 2.8, grams: { cup: 200, serving: 180 } },
  { state: 'tamil_nadu', region: 'south_india', aliases: ['tamil sambar', 'tamil nadu sambar'], canonical: 'Tamil Sambar', calories: 78, protein: 3.6, carbs: 10.5, fats: 2.3, grams: { cup: 240, serving: 150 } },
  { state: 'karnataka', region: 'south_india', aliases: ['karnataka sambar', 'udupi sambar'], canonical: 'Karnataka Sambar', calories: 84, protein: 3.7, carbs: 12, fats: 2.6, grams: { cup: 240, serving: 150 } },
  { state: 'tamil_nadu', region: 'south_india', aliases: ['tamil rasam', 'milagu rasam'], canonical: 'Tamil Rasam', calories: 35, protein: 1.2, carbs: 5.5, fats: 1, grams: { cup: 240, serving: 150 } },
  { state: 'kerala', region: 'south_india', aliases: ['kerala fish curry', 'meen curry'], canonical: 'Kerala Fish Curry', calories: 150, protein: 13, carbs: 4, fats: 9, grams: { cup: 180, serving: 150 } },
  { state: 'west_bengal', region: 'east_india', aliases: ['bengali fish curry', 'macher jhol'], canonical: 'Bengali Fish Curry', calories: 118, protein: 14, carbs: 5, fats: 5, grams: { cup: 180, serving: 150 } },
  { state: 'punjab', region: 'north_india', aliases: ['punjabi chole', 'punjabi chana masala'], canonical: 'Punjabi Chole', calories: 175, protein: 7.6, carbs: 23, fats: 6, grams: { cup: 180, serving: 150 } },
  { state: 'punjab', region: 'north_india', aliases: ['punjabi rajma', 'rajma chawal rajma'], canonical: 'Punjabi Rajma', calories: 135, protein: 6.8, carbs: 19, fats: 3.8, grams: { cup: 180, serving: 150 } },
  { state: 'maharashtra', region: 'west_india', aliases: ['maharashtrian poha', 'kanda poha'], canonical: 'Maharashtrian Poha', calories: 185, protein: 3.8, carbs: 29, fats: 6.2, grams: { cup: 160, serving: 180 } },
  { state: 'gujarat', region: 'west_india', aliases: ['gujarati khichdi'], canonical: 'Gujarati Khichdi', calories: 112, protein: 4.2, carbs: 18.5, fats: 2.5, grams: { cup: 180, serving: 220 } },
  { state: 'punjab', region: 'north_india', aliases: ['punjabi kadhi', 'kadhi pakora'], canonical: 'Punjabi Kadhi', calories: 118, protein: 4.5, carbs: 12, fats: 5.8, grams: { cup: 220, serving: 180 } },
  { state: 'tamil_nadu', region: 'south_india', aliases: ['tamil curd rice', 'thayir sadam'], canonical: 'Thayir Sadam', calories: 118, protein: 3.5, carbs: 18, fats: 3.5, grams: { cup: 200, serving: 250 } },
  { state: 'karnataka', region: 'south_india', aliases: ['karnataka lemon rice', 'chitranna'], canonical: 'Chitranna', calories: 168, protein: 3.2, carbs: 28, fats: 5.2, grams: { cup: 180, serving: 250 } },
  { state: 'punjab', region: 'north_india', aliases: ['punjabi roti', 'punjabi chapati', 'phulka', 'fulka'], canonical: 'Phulka', calories: 230, protein: 7.5, carbs: 42, fats: 3.8, grams: { piece: 40, serving: 40 } },
].map((profile) => ({
  ...profile,
  aliases: [profile.canonical, ...(profile.aliases || [])],
  category: 'state_specific',
  per: { unit: 'g', amount: 100 },
  source: `state_profile:${profile.state}`,
}));

const stateSpecificProfileFor = (name) => {
  const key = compactName(name);
  if (!key) return null;
  const singularKey = singularize(key);

  return stateSpecificProfiles.find((profile) =>
    profile.aliases.some((alias) => {
      const aliasKey = compactName(alias);
      const singularAlias = singularize(aliasKey);
      return key === aliasKey ||
        singularKey === singularAlias ||
        (key.includes(aliasKey) && aliasKey.split(' ').length >= 2) ||
        (aliasKey.includes(key) && key.split(' ').length >= 2);
    })
  ) || null;
};

const localRecipeTemplateFor = (foodName) => {
  const key = compactName(foodName);
  if (!key) return null;
  const singularKey = singularize(key);
  return localRecipeTemplates.find((template) =>
    [template.search_key, template.name, ...(template.aliases || [])].some((alias) => {
      const aliasKey = compactName(alias);
      const singularAlias = singularize(aliasKey);
      return key === aliasKey ||
        singularKey === singularAlias ||
        (key.includes(aliasKey) && aliasKey.split(' ').length >= 2) ||
        (aliasKey.includes(key) && key.split(' ').length >= 2);
    })
  ) || null;
};

const compoundNameAlternatives = (name) => {
  const text = normalize(name);
  if (!text) return [];
  return [...new Set(
    text
      .split(/\b(?:or|and|with|plus)\b|&|,|\//)
      .map((part) => normalize(part))
      .filter((part) => part && part !== text)
  )];
};

const classifyFood = (name) => {
  const localTemplate = localRecipeTemplateFor(name);
  const classification = buildFoodClassification(name, { template: localTemplate });
  if (classification.type === 'tiny_garnish') {
    return {
      ...classification,
      canonicalName: profileFor(name, { analysis: classification })?.aliases?.[0] || classification.canonicalName,
    };
  }
  if (classification.type === 'cooked_side' || classification.type === 'simple_ingredient') {
    return {
      ...classification,
      canonicalName: profileFor(name, { analysis: classification })?.aliases?.[0] || classification.canonicalName,
    };
  }
  return classification;
};

const debugFoodResolution = ({
  detectedName,
  classification,
  analysis,
  canonicalName,
  source,
  template,
  profile,
  quantity,
  grams,
  macros,
  sanity,
}) => {
  if (!NUTRITION_DEBUG) return;
  const foodType = classification?.type || analysis?.foodType || 'unknown';
  const foodState = classification?.foodStateKey || analysis?.foodStateKey || 'unknown';
  const canonicalResolvedName = canonicalName || classification?.canonicalName || analysis?.canonicalName || detectedName;
  const sourceTable = profile?.sourceTable || template?.sourceTable || source || 'local_resolver_cache';
  const templateUsed = template?.name || template?.canonical_name || '';
  console.debug('[food-intelligence]', {
    detectedInput: detectedName,
    canonicalResolvedName,
    foodState,
    sourceTable,
    templateUsed,
    finalMacros: macros || null,
    detectedFood: detectedName,
    foodType,
    canonicalFood: canonicalResolvedName,
    nutritionSource: source,
    recipeTemplateUsed: templateUsed,
    servingUsed: quantity || null,
    formula: buildResolutionFormula(profile, grams),
    finalGrams: grams || null,
    sanityResult: sanity,
  });
};

const unresolvedLogCache = new Set();

const logUnresolvedFood = async (foodName, quantity = '', context = 'nutrition_resolver', metadata = {}) => {
  const normalizedName = compactName(foodName);
  if (!normalizedName) return;

  const quantityText = String(quantity || '').trim();
  const logKey = `${context}:${normalizedName}:${quantityText}`;
  if (unresolvedLogCache.has(logKey)) return;
  unresolvedLogCache.add(logKey);

  try {
    const { data: existing, error: findError } = await supabase
      .from('unresolved_foods')
      .select('id, times_seen')
      .eq('normalized_name', normalizedName)
      .eq('quantity', quantityText)
      .eq('context', context)
      .eq('resolved', false)
      .limit(1);

    if (findError) throw findError;

    const current = existing?.[0];
    if (current?.id) {
      await supabase
        .from('unresolved_foods')
        .update({
          food_name: String(foodName || '').trim(),
          times_seen: (Number(current.times_seen) || 1) + 1,
          metadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', current.id);
      return;
    }

    await supabase
      .from('unresolved_foods')
      .insert({
        food_name: String(foodName || '').trim(),
        normalized_name: normalizedName,
        quantity: quantityText,
        context,
        metadata,
      });
  } catch (error) {
    console.warn('Unresolved food log skipped:', error?.message || error);
  }
};

const singularize = (value) => {
  const text = compactName(value);
  if (text.endsWith('ies')) return `${text.slice(0, -3)}y`;
  if (text.endsWith('es')) return text.slice(0, -2);
  if (text.endsWith('s')) return text.slice(0, -1);
  return text;
};

const parseLeadingServing = (name) => {
  const match = normalize(name).match(/^(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(.+)$/);
  if (!match) return null;
  return {
    amount: parseAmount(match[1]),
    name: compactName(match[2]),
  };
};

const RAW_STATE_KEYS = new Set(['raw', 'dry', 'uncooked']);
const COOKED_STATE_KEYS = new Set(['cooked', 'boiled', 'steamed']);
const FRIED_STATE_KEYS = new Set(['fried', 'deep_fried', 'shallow_fried']);
const DRY_HEAT_STATE_KEYS = new Set(['grilled', 'roasted', 'baked']);

const localProfileStateFor = (profile) => {
  if (profile?.foodStateKey) return profile.foodStateKey;
  const text = normalize(profile?.aliases?.join(' ') || '');
  const detected = detectFoodState(text, profile?.category || 'unknown');
  if (detected.foodStateKey !== 'unknown') return detected.foodStateKey;
  return 'cooked';
};

const stateKeysCompatible = (requestedStateKey, candidateStateKey) => {
  if (!requestedStateKey || requestedStateKey === 'unknown' || !candidateStateKey) return true;
  if (requestedStateKey === candidateStateKey) return true;
  if (RAW_STATE_KEYS.has(requestedStateKey)) return RAW_STATE_KEYS.has(candidateStateKey);
  if (COOKED_STATE_KEYS.has(requestedStateKey)) return COOKED_STATE_KEYS.has(candidateStateKey);
  if (FRIED_STATE_KEYS.has(requestedStateKey)) return FRIED_STATE_KEYS.has(candidateStateKey);
  if (DRY_HEAT_STATE_KEYS.has(requestedStateKey)) return DRY_HEAT_STATE_KEYS.has(candidateStateKey) || COOKED_STATE_KEYS.has(candidateStateKey);
  if (requestedStateKey === 'canned') return candidateStateKey === 'canned' || COOKED_STATE_KEYS.has(candidateStateKey);
  if (requestedStateKey === 'soaked') return candidateStateKey === 'soaked' || RAW_STATE_KEYS.has(candidateStateKey);
  if (requestedStateKey === 'sprouted') return candidateStateKey === 'sprouted' || RAW_STATE_KEYS.has(candidateStateKey);
  return false;
};

const localStatePenalty = (requestedStateKey, profile) => {
  if (!requestedStateKey || requestedStateKey === 'unknown') return 0;
  const profileStateKey = localProfileStateFor(profile);
  if (profileStateKey === requestedStateKey) return -4;
  if (stateKeysCompatible(requestedStateKey, profileStateKey)) return -2;
  return 6;
};

const localProfilePolicyFor = (name, profile, analysis = {}, context = 'manual_meal_entry') =>
  resolveStatePolicy({
    input: name,
    requestedStateKey: analysis.foodStateKey || detectFoodState(name, analysis.foodType || analysis.type || profile?.category || 'unknown').foodStateKey,
    stateSource: analysis.stateSource,
    foodType: analysis.foodType || analysis.type || profile?.category || 'unknown',
    category: inferStatePolicyCategory(profile?.category, profile?.aliases?.join(' '), analysis.canonicalName),
    context,
  });

const preparedCategoryFallbackProfileFor = (policy) => {
  if (!policy?.preparedContext) return null;
  if (policy.explicitRaw && policy.policyCategory === 'soups_stews') {
    return {
      aliases: ['soup powder', 'dry soup mix', 'dehydrated soup mix'],
      category: 'soups_stews',
      per: { unit: 'g', amount: 100 },
      calories: 380,
      protein: 9,
      carbs: 72,
      fats: 5,
      grams: { serving: 20 },
      foodStateKey: 'dry',
      source: 'dry_category_fallback:soups_stews',
      sourceTable: 'local_resolver_cache',
      confidence: 0.56,
    };
  }
  if (policy.explicitRaw) return null;
  const fallbackProfiles = {
    soups_stews: {
      aliases: ['prepared soup', 'prepared stew'],
      category: 'soups_stews',
      per: { unit: 'g', amount: 100 },
      calories: 65,
      protein: 3.2,
      carbs: 8.8,
      fats: 2,
      grams: { bowl: 250, serving: 250 },
      foodStateKey: 'cooked',
      source: 'prepared_category_fallback:soups_stews',
      sourceTable: 'local_resolver_cache',
      confidence: 0.58,
    },
  };
  return fallbackProfiles[policy.policyCategory] || null;
};

const profileFor = (name, options = {}) => {
  const analysis = options.analysis || {};
  const context = options.context || 'manual_meal_entry';
  const rawName = normalize(name);
  const detectedState = analysis.foodStateKey
    ? {
        foodStateKey: analysis.foodStateKey,
        stateSource: analysis.stateSource,
      }
    : detectFoodState(name, analysis.foodType || analysis.type || 'unknown');
  const basePolicy = resolveStatePolicy({
    input: name,
    requestedStateKey: detectedState.foodStateKey,
    stateSource: detectedState.stateSource,
    foodType: analysis.foodType || analysis.type || 'unknown',
    category: analysis.category || analysis.canonicalName,
    context,
  });
  const effectiveStateKey = basePolicy.effectiveStateKey || detectedState.foodStateKey;
  const wantsRawProfile = ['raw', 'dry', 'uncooked'].includes(effectiveStateKey);
  const wantsCookedProfile = ['boiled', 'cooked', 'steamed'].includes(effectiveStateKey);
  const key = compactName(name);
  if (!key) {
    if (/\b(egg|eggs|boil|boile|soft|hard)\b/.test(rawName)) {
      return foodProfiles.find((profile) => profile.aliases.includes('egg')) || null;
    }
    return null;
  }
  const stateProfile = stateSpecificProfileFor(key);
  if (stateProfile) return stateProfile;

  const singularKey = singularize(key);
  const keyWords = key.split(' ').length;
  const candidates = [];
  const rawBlockedCandidates = [];

  foodProfiles.forEach((profile, profileIndex) => {
    profile.aliases.forEach((alias) => {
      const aliasKey = compactName(alias);
      if (!aliasKey) return;
      const singularAlias = singularize(aliasKey);
      const aliasWords = aliasKey.split(' ').length;
      let score = 99;

      if (key === aliasKey) score = 0;
      else if (singularKey === singularAlias) score = 1;
      else if (key.includes(aliasKey) && aliasWords >= 2) score = 10;
      else if (singularKey.includes(singularAlias) && aliasWords >= 2) score = 11;
      else if (aliasKey.includes(key) && keyWords >= 2) score = 20;
      else if (singularAlias.includes(singularKey) && keyWords >= 2) score = 21;

      if (score < 99) {
        const profileStateKey = localProfileStateFor(profile);
        const profilePolicy = localProfilePolicyFor(name, profile, analysis, context);
        if (profilePolicy.blockRawDry && isRawDryState(profileStateKey)) {
          rawBlockedCandidates.push({ profile, score: score + 50, aliasLength: aliasKey.length, profileIndex, profilePolicy });
          return;
        }
        if (effectiveStateKey !== 'unknown' && !stateKeysCompatible(effectiveStateKey, profileStateKey)) {
          return;
        }

        score += localStatePenalty(effectiveStateKey, profile);

        if (wantsRawProfile) {
          score += isRawDryState(profileStateKey) ? -2 : 2;
        } else if (wantsCookedProfile && profile.foodStateKey === 'raw') {
          score += 5;
        }

        candidates.push({
          profile,
          score,
          aliasLength: aliasKey.length,
          profileIndex,
        });
      }
    });
  });

  return candidates
    .sort((a, b) => a.score - b.score || b.aliasLength - a.aliasLength || a.profileIndex - b.profileIndex)[0]?.profile ||
    rawBlockedCandidates
      .sort((a, b) => a.score - b.score || b.aliasLength - a.aliasLength || a.profileIndex - b.profileIndex)
      .map((entry) => ({
        ...entry.profile,
        confidence: Number((Number(entry.profile.confidence || 0.75) * 0.45).toFixed(3)),
        statePolicyWarning: 'only_raw_dry_profile_available_for_prepared_context',
        statePolicy: entry.profilePolicy,
      }))[0] ||
    preparedCategoryFallbackProfileFor(basePolicy) ||
    null;
};

const quantityFactor = (quantity, profile) => {
  const gramQuantity = gramQuantityFor(quantity, profile);
  if (profile.per.unit === 'g') {
    const grams = Number(String(gramQuantity).match(/(\d+(?:\.\d+)?)\s*g/i)?.[1]);
    return Number.isFinite(grams) && grams >= 0 ? grams / profile.per.amount : 1;
  }

  const text = normalize(quantity);
  const match = text.match(/\b(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?|\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half|a|an)\s*(tbsp|tablespoons?|tsp|teaspoons?|grams?|g|ml|litres?|liters?|l|cups?|slices?|pieces?|bars?|packs?|packets?|eggs?|handfuls?|bowls?|plates?|servings?)?\b/);
  const amount = parseAmount(match?.[1]);
  const explicitUnit = unitAliases[match?.[2]] || null;
  const unit = explicitUnit || profile.per.unit;
  const gramsPerTbsp = profile.liquid?.gramsPerTbsp || profile.spread?.gramsPerTbsp;

  if (unit === profile.per.unit) return amount / profile.per.amount;
  if (unit === 'tsp' && profile.per.unit === 'tbsp') return amount / 3 / profile.per.amount;
  if (unit === 'tbsp' && profile.per.unit === 'tsp') return (amount * 3) / profile.per.amount;
  if (unit === 'g' && profile.per.unit === 'tbsp' && gramsPerTbsp) return amount / gramsPerTbsp / profile.per.amount;
  if (unit === 'g' && profile.grams?.[profile.per.unit]) return amount / profile.grams[profile.per.unit] / profile.per.amount;
  if (unit === 'g' && profile.grams?.serving && profile.per.unit === 'serving') return amount / profile.grams.serving / profile.per.amount;
  if (unit === 'ml' && profile.per.unit === 'tbsp' && profile.liquid?.mlPerTbsp) return amount / profile.liquid.mlPerTbsp / profile.per.amount;
  if (unit === 'l' && profile.per.unit === 'tbsp' && profile.liquid?.mlPerTbsp) return (amount * 1000) / profile.liquid.mlPerTbsp / profile.per.amount;
  if (unit === 'cup' && profile.per.unit === 'ml') return (amount * 240) / profile.per.amount;
  if (unit === 'ml' && profile.per.unit === 'cup') return amount / 240 / profile.per.amount;
  if (unit === 'serving' && ['piece', 'slice', 'bowl', 'plate'].includes(profile.per.unit)) return amount;
  if (['piece', 'slice', 'bowl', 'plate'].includes(unit) && profile.per.unit === 'serving') return amount;

  return amount;
};

const scaleProfile = ({ name, quantity, profile }) => {
  if (quantityNeedsPackageSize(quantity, profile)) {
    return needsPackageSizeIngredient({ name, quantity });
  }

  const displayQuantity = displayQuantityFor(quantity, profile);
  const factor = quantityFactor(quantity, profile);
  const grams = gramsFromQuantity(displayQuantity);
  const scaled = {
    _rowId: crypto.randomUUID(),
    name,
    quantity: displayQuantity,
    calories: Math.round(profile.calories * factor),
    protein: Number((profile.protein * factor).toFixed(1)),
    carbs: Number((profile.carbs * factor).toFixed(1)),
    fats: Number((profile.fats * factor).toFixed(1)),
    _needsCalculation: false,
    _needsQuantity: false,
    source: profile.source || 'local_db',
    sourceTable: profile.sourceTable || profile.source || 'local_resolver_cache',
    confidence: profile.confidence,
    foodStateKey: profile.foodStateKey,
    statePolicyWarning: profile.statePolicyWarning,
    statePolicy: profile.statePolicy,
  };

  if (NUTRITION_DEBUG) {
    console.debug('[nutrition]', {
      detectedFood: name,
      canonicalFood: profile.aliases?.[0] || name,
      source: profile.source || 'local_db',
      sourceTable: profile.sourceTable || profile.source || 'local_resolver_cache',
      per100g: {
        calories: profile.per?.unit === 'g' && profile.per?.amount === 100 ? profile.calories : grams ? Number((profile.calories * (100 / grams) * factor).toFixed(1)) : null,
        protein: profile.per?.unit === 'g' && profile.per?.amount === 100 ? profile.protein : grams ? Number((profile.protein * (100 / grams) * factor).toFixed(1)) : null,
        carbs: profile.per?.unit === 'g' && profile.per?.amount === 100 ? profile.carbs : grams ? Number((profile.carbs * (100 / grams) * factor).toFixed(1)) : null,
        fats: profile.per?.unit === 'g' && profile.per?.amount === 100 ? profile.fats : grams ? Number((profile.fats * (100 / grams) * factor).toFixed(1)) : null,
      },
      estimatedGrams: grams,
      formula: grams ? 'per100g * grams / 100' : `profile ${profile.per?.amount || 1} ${profile.per?.unit || 'serving'} * factor`,
      factor,
      finalMacros: {
        calories: scaled.calories,
        protein: scaled.protein,
        carbs: scaled.carbs,
        fats: scaled.fats,
      },
      sanityCheck: plausibleIngredient(scaled),
    });
  }

  return scaled;
};

const photoPortionCaps = [
  { aliases: ['orange', 'orange slices'], maxGrams: 120 },
  { aliases: ['strawberry', 'strawberries'], maxGrams: 90 },
  { aliases: ['cucumber', 'cucumber slices'], maxGrams: 80 },
  { aliases: ['avocado'], maxGrams: 120 },
  { aliases: ['mango', 'mango slices'], maxGrams: 100 },
  { aliases: ['raspberry', 'raspberries'], maxGrams: 80 },
  { aliases: ['blackberry', 'blackberries'], maxGrams: 80 },
  { aliases: ['kiwi', 'kiwi slices'], maxGrams: 70 },
  { aliases: ['apple', 'apple slices'], maxGrams: 80 },
  { aliases: ['apricot', 'apricot slices'], maxGrams: 70 },
  { aliases: ['carrot', 'carrots', 'carrot sticks'], maxGrams: 80 },
  { aliases: ['tomato', 'tomatoes', 'cherry tomato', 'cherry tomatoes'], maxGrams: 80 },
  { aliases: ['bell pepper', 'red bell pepper', 'yellow bell pepper', 'green bell pepper'], maxGrams: 80 },
];

const gramsFromQuantity = (quantity) => {
  const match = String(quantity || '').match(/(\d+(?:\.\d+)?)\s*g\b/i);
  const grams = Number(match?.[1]);
  return Number.isFinite(grams) && grams > 0 ? grams : null;
};

const boundedNumber = (value, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
};

const portionGramsFromIngredient = (ingredient, mealSizeEstimateGrams) => {
  const directGrams = boundedNumber(ingredient?.estimated_grams, 1, 1500);
  if (directGrams) return directGrams;

  const totalGrams = boundedNumber(mealSizeEstimateGrams, 50, 2000);
  const sharePercent = boundedNumber(ingredient?.visible_share_percent, 0, 100);
  if (!totalGrams || !sharePercent) return null;

  return totalGrams * (sharePercent / 100);
};

const photoQuantityFromPortion = (ingredient, mealSizeEstimateGrams) => {
  const grams = portionGramsFromIngredient(ingredient, mealSizeEstimateGrams);
  if (!grams) return String(ingredient?.quantity || '1 serving').trim();
  if (grams < 10) return `${Number(grams.toFixed(1))}g`;
  return `${Math.round(grams)}g`;
};

const macroCalories = ({ protein = 0, carbs = 0, fats = 0 }) =>
  (Number(protein) || 0) * 4 + (Number(carbs) || 0) * 4 + (Number(fats) || 0) * 9;

const caloriesMatchMacros = ({ calories = 0, protein = 0, carbs = 0, fats = 0 }) => {
  const kcal = Number(calories) || 0;
  const expected = macroCalories({ protein, carbs, fats });
  if (kcal === 0 && expected === 0) return true;
  const tolerance = Math.max(10, kcal * 0.1);
  return Math.abs(kcal - expected) <= tolerance;
};

const profileNameText = (profile) =>
  normalize(`${profile?.aliases?.join(' ') || ''} ${profile?.category || ''} ${profile?.source || ''}`);

const inferFoodCategory = (profileOrIngredient) => {
  const text = profileNameText(profileOrIngredient);
  if (/\b(oil|ghee|butter)\b/.test(text)) return 'oil';
  if (/\b(almond|cashew|walnut|pistachio|peanut|nuts?)\b/.test(text)) return 'nuts';
  if (/\b(chicken|salmon|fish|meat|beef|pork|egg|eggs|paneer)\b/.test(text)) return 'meat';
  if (/\b(rice|bread|toast|oats|oatmeal|quinoa|couscous|corn|dosa|idli|chapati|roti|pasta|noodle|grain)\b/.test(text)) return 'grain';
  if (/\b(banana|orange|strawberr|blueberr|raspberr|blackberr|grape|mango|kiwi|apple|apricot|avocado|fruit)\b/.test(text)) return 'fruit';
  if (/\b(cucumber|pepper|spinach|arugula|lettuce|onion|tomato|carrot|broccoli|basil|vegetable)\b/.test(text)) return 'vegetable';
  return null;
};

const categoryMacrosValid = (profile) => {
  const category = inferFoodCategory(profile);
  const text = profileNameText(profile);
  const calories = Number(profile?.calories) || 0;
  const protein = Number(profile?.protein) || 0;
  const carbs = Number(profile?.carbs) || 0;
  const fats = Number(profile?.fats) || 0;

  if (category === 'oil') return protein <= 2 && carbs <= 2 && fats >= 70 && calories >= 600;
  if (category === 'fruit') return protein <= 5 && fats <= 18 && calories <= 250;
  if (category === 'vegetable') return protein <= 10 && fats <= 25 && calories <= 260;
  if (category === 'meat') return carbs <= 8 && protein >= 8;
  if (category === 'grain') {
    if (/\brice\b/.test(text) && !/\b(raw|dry|uncooked|flour|bran oil|cake|cakes|cracker|crackers|chip|chips|puffed)\b/.test(text)) {
      return calories <= 330 && carbs >= 10 && fats <= 25;
    }
    return carbs >= 10 && fats <= 25;
  }
  if (category === 'nuts') return fats >= 25 && calories >= 350 && calories <= 750;
  const preparedStatus = profileKcalStatus(profile, {
    category: preparedCategoryFor(category, profile?.category, text),
    context: 'manual_meal_entry',
    statePolicy: {
      preparedContext: true,
      explicitRaw: /\b(raw|dry|uncooked|powder|powdered|mix|dehydrated)\b/.test(text),
      policyCategory: preparedCategoryFor(category, profile?.category, text),
    },
  });
  if (preparedStatus.status === 'fail') return false;
  return true;
};

const profilePassesSanityChecks = (profile) => {
  const calories = Number(profile?.calories) || 0;
  const protein = Number(profile?.protein) || 0;
  const carbs = Number(profile?.carbs) || 0;
  const fats = Number(profile?.fats) || 0;

  if (calories < 0 || protein < 0 || carbs < 0 || fats < 0) return false;
  if (calories > 950 || protein > 100 || carbs > 100 || fats > 105) return false;
  if (protein + carbs + fats > 110) return false;
  if (!caloriesMatchMacros({ calories, protein, carbs, fats })) return false;
  if (!categoryMacrosValid(profile)) return false;
  return calories > 0 && (protein > 0 || carbs > 0 || fats > 0);
};

const looksLikeBoiledEgg = (name) =>
  /\b(egg|eggs|boil|boile|soft|hard)\b/i.test(String(name || ''));

const calibrateEggPhotoQuantity = (name, quantity, ingredientCount) => {
  const grams = gramsFromQuantity(quantity);
  if (!grams || ingredientCount < 3 || !looksLikeBoiledEgg(name)) return quantity;

  const text = normalize(`${name} ${quantity}`);
  const explicitWholeEggCount = /\b(2|two|3|three|4|four|5|five|6|six)\s*(whole\s*)?eggs?\b/.test(text);
  const explicitHalves = /\b(halves|half|cut|sliced)\b/.test(text);

  if (explicitHalves && grams > 60 && grams <= 120) return '50g';
  if (!explicitWholeEggCount && grams > 60 && grams <= 120) return '50g';
  return quantity;
};

const photoCapFor = (name) => {
  const key = compactName(name);
  const singularKey = singularize(key);
  return photoPortionCaps.find((cap) =>
    cap.aliases.some((alias) => {
      const aliasKey = compactName(alias);
      const singularAlias = singularize(aliasKey);
      return key === aliasKey ||
        singularKey === singularAlias ||
        key.includes(aliasKey) ||
        singularKey.includes(singularAlias);
    })
  );
};

const calibratePhotoQuantity = (name, quantity, ingredientCount) => {
  const eggQuantity = calibrateEggPhotoQuantity(name, quantity, ingredientCount);
  if (eggQuantity !== quantity) return eggQuantity;

  const grams = gramsFromQuantity(quantity);
  if (!grams || ingredientCount < 4) return quantity;
  const cap = photoCapFor(name);
  if (!cap || grams <= cap.maxGrams) return quantity;
  return `${cap.maxGrams}g`;
};

const dbProfileCache = new Map();
const stateProfileCache = new Map();

const profileFromDbRow = (row) => ({
  aliases: [row.name],
  category: row.category || '',
  per: { unit: 'g', amount: 100 },
  calories: Number(row.calories_per_100g) || 0,
  protein: Number(row.protein_per_100g) || 0,
  carbs: Number(row.carbs_per_100g) || 0,
  fats: Number(row.fats_per_100g) || 0,
  source: row.source || 'nutrition_foods',
});

const profileFromStateRow = (row) => ({
  aliases: [row.canonical_food_name, ...(row.aliases || [])].filter(Boolean),
  category: 'state_specific',
  state: row.state || '',
  region: row.region || '',
  per: { unit: 'g', amount: 100 },
  calories: Number(row.calories_per_100g) || 0,
  protein: Number(row.protein_per_100g) || 0,
  carbs: Number(row.carbs_per_100g) || 0,
  fats: Number(row.fats_per_100g) || 0,
  grams: row.default_serving_grams ? { serving: Number(row.default_serving_grams) } : undefined,
  source: `state_profile:${row.state || row.source || 'db'}`,
});

const stateDbProfileFor = async (name) => {
  const key = compactName(name);
  if (!key) return null;
  if (stateProfileCache.has(key)) return stateProfileCache.get(key);

  try {
    const { data, error } = await supabase
      .from('food_state_profiles')
      .select('*')
      .eq('search_key', key)
      .limit(5);

    if (error) throw error;

    const profile = (data || [])
      .map(profileFromStateRow)
      .find(profilePassesSanityChecks) || null;
    stateProfileCache.set(key, profile);
    return profile;
  } catch (error) {
    if (!String(error?.message || '').includes('food_state_profiles')) {
      console.warn('State profile lookup skipped:', error?.message || error);
    }
    stateProfileCache.set(key, null);
    return null;
  }
};

const withDbServingSizes = async (profile, ...names) => {
  const mergedGrams = {};
  const mergedLiquid = {};

  for (const name of names.filter(Boolean)) {
    const sizes = await dbServingSizesFor(name);
    Object.assign(mergedGrams, sizes?.grams || {});
    Object.assign(mergedLiquid, sizes?.liquid || {});
  }

  const grams = Object.keys(mergedGrams).length > 0 ? mergedGrams : null;
  if (!grams) return profile;

  const nextProfile = { ...profile, grams: { ...(profile.grams || {}), ...grams } };
  if (mergedLiquid?.tbsp && !nextProfile.liquid) {
    nextProfile.liquid = { gramsPerTbsp: grams.tbsp, mlPerTbsp: mergedLiquid.tbsp };
  }
  return nextProfile;
};

const profileHasUsableMacros = (profile) =>
  profilePassesSanityChecks(profile);

const dbPenaltyText = (row) =>
  normalize(`${row?.alias || ''} ${row?.search_key || ''} ${row?.food?.name || ''}`);

const dbMatchScore = (row, key) => {
  const search = compactName(row?.search_key || row?.alias || '');
  if (!search) return 99;
  if (search === key) return 0;
  if (singularize(search) === singularize(key)) return 1;
  if (search.startsWith(`${key} `)) return 2;
  if (search.includes(` ${key} `) || search.endsWith(` ${key}`)) return 3;
  return 99;
};

const dbQualityPenalty = (row, key) => {
  const text = dbPenaltyText(row);
  const search = compactName(row?.search_key || row?.alias || '');
  const tokenCount = search ? search.split(' ').length : 99;
  let penalty = 0;
  const source = String(row?.food?.source || '').toLowerCase();

  if (row?.food?.brand) penalty += 10;
  if (source === 'open_food_facts') penalty += 8;
  if (source === 'usda') penalty += 2;
  if (source === 'ifct') penalty -= 1;
  if (source === 'seed' || source === 'local') penalty -= 2;
  if (row?.food?.verified === true) penalty -= 1;
  if (/\b(from other sources|ns as to|not specified|restaurant|fast food|commercial|prepared from recipe|dry mix|frozen meal|babyfood)\b/.test(text)) penalty += 8;
  if (/\b(with|and|plus|sauce|seasoning|topping|filling|coated|breaded|stuffed)\b/.test(text) && search !== key) penalty += 4;
  if (tokenCount > 5) penalty += tokenCount - 5;
  if (search.startsWith(key) && search !== key) penalty += 1;
  return penalty;
};

const chooseBestDbRow = (rows, key) =>
  (rows || [])
    .map((row) => ({
      ...row,
      score: dbMatchScore(row, key),
      penalty: dbQualityPenalty(row, key),
      profile: row.food ? profileFromDbRow(row.food) : null,
    }))
    .filter((row) => row.food && row.score < 99 && profileHasUsableMacros(row.profile))
    .sort((a, b) =>
      a.score - b.score ||
      a.penalty - b.penalty ||
      compactName(a.search_key || a.alias || '').length - compactName(b.search_key || b.alias || '').length
    )[0];

const nutritionDbProfileFor = async (name, options = {}) => {
  const key = compactName(name);
  if (!key) return null;
  const cacheKey = `${key}:${options.allowFuzzy === false ? 'exact' : 'fuzzy'}`;
  if (dbProfileCache.has(cacheKey)) return dbProfileCache.get(cacheKey);

  try {
    const { data: exactRows, error: exactError } = await supabase
      .from('nutrition_food_aliases')
      .select('alias, search_key, food:nutrition_foods(*)')
      .eq('search_key', key)
      .limit(20);

    if (exactError) throw exactError;
    const exactMatch = chooseBestDbRow(exactRows, key);
    if (exactMatch?.profile) {
      const profile = await withDbServingSizes(exactMatch.profile, key, exactMatch.food?.name);
      dbProfileCache.set(cacheKey, profile);
      return profile;
    }

    if (options.allowFuzzy === false) {
      dbProfileCache.set(cacheKey, null);
      return null;
    }

    const { data: fuzzyRows, error: fuzzyError } = await supabase
      .from('nutrition_food_aliases')
      .select('alias, search_key, food:nutrition_foods(*)')
      .ilike('search_key', `%${key}%`)
      .limit(25);

    if (fuzzyError) throw fuzzyError;
    const fuzzyMatch = chooseBestDbRow(fuzzyRows, key);

    const profile = fuzzyMatch?.profile
      ? await withDbServingSizes(fuzzyMatch.profile, key, fuzzyMatch.food?.name)
      : null;
    dbProfileCache.set(cacheKey, profile);
    return profile;
  } catch (error) {
    console.warn('Nutrition DB lookup skipped:', error?.message || error);
    dbProfileCache.set(cacheKey, null);
    return null;
  }
};

const splitFoodText = (foodName, quantity = '1 serving') => {
  const raw = String(foodName || '').trim();
  const normalized = normalize(raw);
  if (localRecipeTemplateFor(normalized)) {
    return [{ name: normalized, quantity }];
  }
  const trailingQuantityMatch = normalized.match(/^([a-z][a-z\s]*?)\s+(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?|\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half|a|an)\s*(tbsp|tablespoons?|tsp|teaspoons?|grams?|g|ml|litres?|liters?|l|cups?|slices?|pieces?|bars?|packs?|packets?|eggs?|handfuls?|bowls?|plates?|servings?)$/i);
  if (trailingQuantityMatch) {
    return [{
      name: normalize(trailingQuantityMatch[1]),
      quantity: `${trailingQuantityMatch[2]} ${unitAliases[trailingQuantityMatch[3]] || trailingQuantityMatch[3]}`,
    }];
  }

  const explicit = [...String(foodName || '').toLowerCase().matchAll(/\b(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?|\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half|a|an)\s*(tbsp|tablespoons?|tsp|teaspoons?|grams?|g|ml|litres?|liters?|l|cups?|slices?|pieces?|bars?|packs?|packets?|eggs?|handfuls?|bowls?|plates?|servings?)\s+(?:of\s+)?([a-z][a-z\s]*?)(?=\s+(?:and|with|plus)\s+|$)/g)]
    .map((match) => ({
      name: normalize(match[3]),
      quantity: `${match[1]} ${unitAliases[match[2]] || match[2]}`,
    }));

  let remainder = normalized;
  for (const part of explicit) {
    remainder = remainder.replace(new RegExp(`\\b\\d+(?:\\.\\d+)?\\s*\\w+\\s+(?:of\\s+)?${part.name}\\b`, 'i'), ' ');
  }

  const connectors = remainder
    .split(/\b(?:and|with|plus|,)\b/)
    .map((part) => normalize(part))
    .filter(Boolean)
    .filter((part) => !explicit.some((item) => item.name === part || part.includes(item.name)));

  return [
    ...connectors.map((name, index) => {
      const leadingServing = parseLeadingServing(name);
      if (leadingServing) {
        return { name: leadingServing.name, quantity: `${leadingServing.amount} serving` };
      }
      return { name, quantity: index === 0 ? quantity : '1 serving' };
    }),
    ...explicit,
  ].filter((item) => item.name);
};

const sumIngredients = (ingredients) =>
  ingredients.reduce(
    (sum, ingredient) => ({
      calories: sum.calories + Number(ingredient.calories || 0),
      protein: sum.protein + Number(ingredient.protein || 0),
      carbs: sum.carbs + Number(ingredient.carbs || 0),
      fats: sum.fats + Number(ingredient.fats || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );

const plausibleIngredient = (ingredient) => {
  const calories = Number(ingredient?.calories) || 0;
  const protein = Number(ingredient?.protein) || 0;
  const carbs = Number(ingredient?.carbs) || 0;
  const fats = Number(ingredient?.fats) || 0;

  if (!(calories >= 0 && calories <= 1800 && protein >= 0 && carbs >= 0 && fats >= 0 && protein <= 180 && carbs <= 300 && fats <= 180)) return false;
  if (calories > 0 && !caloriesMatchMacros({ calories, protein, carbs, fats })) return false;

  const quantity = normalize(ingredient?.quantity);
  const gramMatch = quantity.match(/(\d+(?:\.\d+)?)\s*g\b/);
  if (gramMatch) {
    const grams = Number(gramMatch[1]);
    if (grams === 0) return calories === 0 && protein === 0 && carbs === 0 && fats === 0;
    if (grams > 0) {
      const per100Calories = calories * (100 / grams);
      const per100Protein = protein * (100 / grams);
      const per100Carbs = carbs * (100 / grams);
      const per100Fat = fats * (100 / grams);
      const per100Profile = {
        aliases: [ingredient.name],
        category: ingredient.category || '',
        calories: per100Calories,
        protein: per100Protein,
        carbs: per100Carbs,
        fats: per100Fat,
      };
      return profilePassesSanityChecks(per100Profile);
    }
  }

  return true;
};

const buildMeal = ({ foodName, quantity, ingredients, source }) => {
  const totals = sumIngredients(ingredients);
  const needsQuantity = ingredients.some((ingredient) => ingredient?._needsQuantity);
  return {
    food_name: foodName,
    quantity,
    calories: Math.round(totals.calories),
    protein: Number(totals.protein.toFixed(1)),
    carbs: Number(totals.carbs.toFixed(1)),
    fats: Number(totals.fats.toFixed(1)),
    ingredients,
    source: needsQuantity ? 'needs_quantity' : source,
  };
};

const recipeTemplateCache = new Map();

const SIMPLE_FOOD_TEMPLATE_BLOCKLIST = new Set([
  'rice',
  'white rice',
  'chickpeas',
  'chickpea',
  'boiled chickpeas',
  'cooked chickpeas',
  'egg',
  'eggs',
  'boiled egg',
  'banana',
  'milk',
  'paneer',
  'chicken breast',
  'potato',
  'apple',
  'dal',
  'dhal',
  'daal',
]);

const templateBlockedSimpleFood = (foodName) => {
  const key = compactName(foodName);
  const searchKey = normalize(foodName);
  return SIMPLE_FOOD_TEMPLATE_BLOCKLIST.has(key) || SIMPLE_FOOD_TEMPLATE_BLOCKLIST.has(searchKey);
};

const shouldUseRecipeTemplate = (foodName, analysis = {}, classification = {}) =>
  !templateBlockedSimpleFood(foodName) &&
  (analysis.foodType === 'mixed_recipe' || classification.type === 'mixed_recipe');

const recipeQuantityFactor = (quantity, template) => {
  const parts = quantityParts(quantity);
  if (!parts) return 1;
  if (parts.unit === 'g' && Number(template?.default_serving_grams) > 0) {
    return parts.amount / Number(template.default_serving_grams);
  }
  if (['serving', 'piece', 'plate', 'bowl'].includes(parts.unit || 'serving')) return parts.amount;
  return 1;
};

const formatScaledAmount = (amount) => {
  if (amount === 0) return '0';
  if (amount < 1) return Number(amount.toFixed(2)).toString();
  if (amount < 10) return Number(amount.toFixed(1)).toString();
  return Math.round(amount).toString();
};

const scaleTemplateQuantity = (quantity, factor) => {
  const text = String(quantity || '1 serving').trim();
  const parts = quantityParts(text);
  if (!parts || !Number.isFinite(factor) || factor === 1) return text;

  const unitMatch = text.match(/\b(tbsp|tablespoons?|tsp|teaspoons?|grams?|g|ml|litres?|liters?|l|cups?|slices?|pieces?|bars?|packs?|packets?|eggs?|handfuls?|bowls?|plates?|servings?)\b/i);
  const unit = unitAliases[unitMatch?.[1]?.toLowerCase()] || parts.unit || 'serving';
  const suffix = unit === 'g' || unit === 'ml' || unit === 'l' ? unit : ` ${unit}`;
  return `${formatScaledAmount(parts.amount * factor)}${suffix}`;
};

const templateForModifiers = (template, modifiers) => {
  if (!template) return null;
  const compatibleItems = filterTemplateItemsByModifiers(template.items || [], modifiers);
  const variantItems = applyTemplateModifierVariants(compatibleItems, modifiers);
  const items = mergeTemplateItems(variantItems);
  return {
    ...template,
    items,
  };
};

const recipeTemplateFor = async (foodName, context = {}) => {
  const key = compactName(foodName);
  if (!key) return null;
  if (templateBlockedSimpleFood(foodName)) {
    recipeTemplateCache.set(key, null);
    return null;
  }
  const modifiers = detectDietaryModifiers(foodName, context?.category, context?.cuisine, context?.canonicalName);
  const cacheKey = `${key}|${compactName(context?.category || '')}|${compactName(context?.cuisine || '')}|${JSON.stringify(modifiers)}`;
  if (recipeTemplateCache.has(cacheKey)) return recipeTemplateCache.get(cacheKey);

  const masterTemplate = await masterRecipeTemplateFor(foodName, {
    ...context,
    modifiers,
    modifiersText: foodName,
  });
  if (masterTemplate) {
    const contextualTemplate = templateForModifiers(masterTemplate, modifiers);
    recipeTemplateCache.set(cacheKey, contextualTemplate);
    return contextualTemplate;
  }

  const select = '*, items:recipe_template_items(*)';

  try {
    const { data: exactRows, error: exactError } = await supabase
      .from('recipe_templates')
      .select(select)
      .eq('search_key', key)
      .limit(1);

    if (exactError) throw exactError;
    let template = exactRows?.[0] || null;

    if (!template) {
      const { data: aliasRows, error: aliasError } = await supabase
        .from('recipe_templates')
        .select(select)
        .contains('aliases', [key])
        .limit(1);

      if (aliasError) throw aliasError;
      template = aliasRows?.[0] || null;
    }

    if (!template) {
      const { data: fuzzyRows, error: fuzzyError } = await supabase
        .from('recipe_templates')
        .select(select)
        .ilike('search_key', `%${key}%`)
        .limit(20);

      if (fuzzyError) throw fuzzyError;
      const keyTokens = key.split(' ').filter(Boolean);
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const scoreTemplateRow = (row) => {
        const rowKey = compactName(row.search_key);
        if (rowKey === key) return 100;
        if (rowKey.startsWith(`${key} `) || rowKey.startsWith(key)) return 60;
        const hasWordBoundary = new RegExp(`\\b${escapedKey}\\b`).test(rowKey);
        const tokenHits = keyTokens.filter((token) => rowKey.includes(token)).length;
        return (hasWordBoundary ? 40 : 0) + tokenHits * 5 - rowKey.length * 0.05;
      };
      template = fuzzyRows?.sort((a, b) => scoreTemplateRow(b) - scoreTemplateRow(a))?.[0] || null;
    }

    if (template) {
      const contextualTemplate = templateForModifiers(template, modifiers);
      recipeTemplateCache.set(cacheKey, contextualTemplate);
      return contextualTemplate;
    }
  } catch (error) {
    console.warn('Recipe template lookup skipped:', error?.message || error);
  }

  const localTemplate = localRecipeTemplateFor(foodName);
  const contextualLocalTemplate = templateForModifiers(localTemplate, modifiers);
  recipeTemplateCache.set(cacheKey, contextualLocalTemplate);
  return contextualLocalTemplate;
};

const recipeTemplateForAnalysis = async (foodName, analysis = {}) => {
  const canonicalName = analysis?.canonicalName;
  if (canonicalName && compactName(canonicalName) !== compactName(foodName)) {
    const canonicalTemplate = await recipeTemplateFor(canonicalName, analysis);
    if (canonicalTemplate) return canonicalTemplate;
  }

  return recipeTemplateFor(foodName, analysis);
};

const fillMissingPercentages = (items) => {
  const known = items.filter((item) => item.percentage !== null && Number.isFinite(Number(item.percentage)));
  const unknown = items.filter((item) => item.percentage === null || !Number.isFinite(Number(item.percentage)));
  if (unknown.length === 0) return items;

  if (known.length === 0) {
    const evenShare = 100 / items.length;
    return items.map((item) => ({ ...item, percentage: evenShare }));
  }

  const knownTotal = known.reduce((sum, item) => sum + Number(item.percentage), 0);
  const evenShare = Math.max(0, 100 - knownTotal) / unknown.length;
  return items.map((item) =>
    item.percentage === null || !Number.isFinite(Number(item.percentage))
      ? { ...item, percentage: evenShare }
      : item
  );
};

const buildRecipeTemplateMeal = async (foodName, quantity, template) => {
  const mergedItems = Array.isArray(template?.items)
    ? mergeTemplateItems(template.items).sort((a, b) => a.sort_order - b.sort_order)
    : [];
  const items = fillMissingPercentages(mergedItems);
  if (items.length === 0) return null;

  const factor = recipeQuantityFactor(quantity, template);
  const calculated = [];

  for (const item of items) {
    const name = String(item.ingredient_name || '').trim();
    if (!name) continue;
    const hasPercentage = item.percentage !== null && item.percentage !== undefined && item.percentage !== '' && Number.isFinite(Number(item.percentage));
    const itemQuantity = hasPercentage
      ? `${formatScaledAmount((Number(template.default_serving_grams) || 100) * factor * (Number(item.percentage) / 100))}g`
      : scaleTemplateQuantity(item.quantity, factor);
    const result = await estimateIngredientFromFreeSources(name, itemQuantity, {
      allowAiFallback: false,
      allowRecipeTemplate: false,
      context: 'recipe_template_item',
    });
    if (!result) {
      await logUnresolvedFood(name, itemQuantity, 'recipe_template_item', {
        template: template.name,
        requested_food: foodName,
      });
    }
    calculated.push(result || {
      _rowId: crypto.randomUUID(),
      name,
      quantity: itemQuantity,
      calories: 0,
      protein: 0,
      carbs: 0,
      fats: 0,
      _needsCalculation: true,
      source: 'recipe_template_needs_review',
    });
  }

  if (calculated.length === 0) return null;
  const unresolved = calculated.filter((ingredient) =>
    ingredient?._needsCalculation ||
    (Number(ingredient?.calories) || 0) <= 0 ||
    (gramsFromQuantity(ingredient?.quantity) !== null && gramsFromQuantity(ingredient.quantity) <= 0)
  );
  if (unresolved.length > 0) {
    await Promise.all(unresolved.map((ingredient) => logUnresolvedFood(ingredient.name, ingredient.quantity, 'recipe_template_validation', {
      template: template.name,
      requested_food: foodName,
      reason: 'template_ingredient_unresolved_or_zero',
    })));
    return null;
  }

  const requestedGrams = gramsFromQuantity(quantity);
  const totalIngredientGrams = calculated.reduce((sum, ingredient) => sum + (gramsFromQuantity(ingredient.quantity) || 0), 0);
  if (requestedGrams && totalIngredientGrams && Math.abs(totalIngredientGrams - requestedGrams) > Math.max(25, requestedGrams * 0.2)) {
    await logUnresolvedFood(foodName, quantity, 'recipe_template_validation', {
      template: template.name,
      reason: `template_weight_mismatch_${totalIngredientGrams}_vs_${requestedGrams}`,
    });
    return null;
  }

  return {
    ...buildMeal({ foodName, quantity, ingredients: calculated, source: 'recipe_template' }),
    confidence: Number(template.confidence) || 0.7,
    assumptionSource: `${template.name} recipe template`,
  };
};

export async function estimateNutritionFromFreeSources(foodName, quantity = '1 serving') {
  const components = splitFoodText(foodName, quantity);

  if (components.length === 1) {
    const single = components[0];
    const analysis = await analyzeFood(single.name);
    const classification = classifyFood(single.name);
    const shouldUseSingleTemplate = shouldUseRecipeTemplate(single.name, analysis, classification);
    const template = shouldUseSingleTemplate ? await recipeTemplateForAnalysis(single.name, analysis) : null;
    const templateMeal = template ? await buildRecipeTemplateMeal(foodName, single.quantity, template) : null;
    if (templateMeal) return templateMeal;
  }

  const localIngredients = [];
  const unresolved = [];

  for (const component of components) {
    const ingredient = await estimateIngredientFromFreeSources(component.name, component.quantity, {
      allowAiFallback: false,
      context: 'meal_component_resolver',
    });
    if (ingredient) {
      localIngredients.push(ingredient);
    } else {
      unresolved.push(component);
    }
  }

  if (localIngredients.length > 0 && unresolved.length === 0) {
    return buildMeal({ foodName, quantity, ingredients: localIngredients, source: 'local_db' });
  }

  const aiIngredients = [];
  for (const component of unresolved) {
    let result = await estimateNutrition(component.name, component.quantity);
    if (!result) result = await retryEstimateNutrition(component.name, component.quantity);
    const ingredient = result && {
      _rowId: crypto.randomUUID(),
      name: component.name,
      quantity: component.quantity,
      calories: Number(result.calories) || 0,
      protein: Number(result.protein) || 0,
      carbs: Number(result.carbs) || 0,
      fats: Number(result.fats) || 0,
      _needsCalculation: false,
      source: 'ai_fallback',
    };
    if (plausibleIngredient(ingredient)) {
      aiIngredients.push(ingredient);
    } else {
      await logUnresolvedFood(component.name, component.quantity, 'nutrition_resolver', {
        requested_food: foodName,
        reason: result ? 'implausible_ai_fallback' : 'no_match',
      });
    }
  }

  const ingredients = [...localIngredients, ...aiIngredients];
  if (ingredients.length > 0) {
    return buildMeal({ foodName, quantity, ingredients, source: unresolved.length > 0 ? 'local_db_ai_fallback' : 'local_db' });
  }

  await logUnresolvedFood(foodName, quantity, 'nutrition_resolver', { reason: 'no_ingredients_resolved' });
  return null;
}

export async function estimateIngredientFromFreeSources(name, quantity = '1 serving', options = {}) {
  const analysis = await analyzeFood(name);
  const classification = classifyFood(name);
  const debugContext = {
    detectedName: name,
    classification,
    analysis,
    quantity,
  };

  if (options.allowRecipeTemplate !== false && shouldUseRecipeTemplate(name, analysis, classification)) {
    const template = await recipeTemplateForAnalysis(name, analysis) || classification.template;
    const templateMeal = template ? await buildRecipeTemplateMeal(name, quantity, template) : null;
    if (templateMeal) {
      const ingredient = {
        _rowId: crypto.randomUUID(),
        name,
        quantity,
        calories: templateMeal.calories,
        protein: templateMeal.protein,
        carbs: templateMeal.carbs,
        fats: templateMeal.fats,
        _needsCalculation: false,
        source: template.sourceTable || 'recipe_template',
        sourceTable: template.sourceTable || 'recipe_template',
      };
      debugFoodResolution({
        ...debugContext,
        canonicalName: template.name,
        source: ingredient.source,
        template,
        profile: null,
        grams: gramsFromQuantity(quantity),
        macros: ingredient,
        sanity: plausibleIngredient(ingredient),
      });
      return ingredient;
    }
  }

  if (analysis.foodType === 'tiny_garnish' || classification.type === 'tiny_garnish') {
    const masterTinyProfile = await masterTinyGarnishProfileFor(analysis.canonicalName || classification.canonicalName || name) ||
      await masterTinyGarnishProfileFor(name);
    const policyContext = options.context || 'manual_meal_entry';
    const tinyProfile = masterTinyProfile ||
      profileFor(classification.canonicalName, { analysis, context: policyContext }) ||
      profileFor(name, { analysis, context: policyContext });
    if (tinyProfile) {
      const ingredient = scaleProfile({ name, quantity, profile: tinyProfile });
      debugFoodResolution({
        ...debugContext,
        canonicalName: tinyProfile.aliases?.[0] || classification.canonicalName,
        source: ingredient.source,
        profile: tinyProfile,
        grams: gramsFromQuantity(ingredient.quantity),
        macros: ingredient,
        sanity: plausibleIngredient(ingredient),
      });
      return ingredient;
    }
  }

  let profile = profileFor(name, { analysis, context: options.context || 'manual_meal_entry' });
  if (!profile) {
    for (const alternative of compoundNameAlternatives(name)) {
      const alternativeAnalysis = await analyzeFood(alternative);
      profile = profileFor(alternative, { analysis: alternativeAnalysis, context: options.context || 'manual_meal_entry' });
      if (profile) break;
    }
  }
  if (profile) {
    const ingredient = scaleProfile({ name, quantity, profile });
    debugFoodResolution({
      ...debugContext,
      canonicalName: profile.aliases?.[0] || name,
      source: ingredient.source,
      profile,
      grams: gramsFromQuantity(ingredient.quantity),
      macros: ingredient,
      sanity: plausibleIngredient(ingredient),
    });
    return ingredient;
  }

  const masterContext = options.context || 'manual_meal_entry';
  const masterExactProfile = await masterProfileFor(name, analysis, { allowFuzzy: false, context: masterContext });
  if (masterExactProfile && profileHasUsableMacros(masterExactProfile)) {
    const ingredient = scaleProfile({ name, quantity, profile: masterExactProfile });
    debugFoodResolution({
      ...debugContext,
      canonicalName: masterExactProfile.aliases?.[0] || analysis.canonicalName,
      source: ingredient.source,
      profile: masterExactProfile,
      grams: gramsFromQuantity(ingredient.quantity),
      macros: ingredient,
      sanity: plausibleIngredient(ingredient),
    });
    return ingredient;
  }

  const stateDbProfile = await stateDbProfileFor(name);
  if (stateDbProfile) {
    const ingredient = scaleProfile({ name, quantity, profile: stateDbProfile });
    debugFoodResolution({
      ...debugContext,
      canonicalName: stateDbProfile.aliases?.[0] || name,
      source: ingredient.source,
      profile: stateDbProfile,
      grams: gramsFromQuantity(ingredient.quantity),
      macros: ingredient,
      sanity: plausibleIngredient(ingredient),
    });
    return ingredient;
  }

  const exactDbProfile = await nutritionDbProfileFor(name, { allowFuzzy: false });
  if (exactDbProfile) {
    const ingredient = scaleProfile({ name, quantity, profile: exactDbProfile });
    debugFoodResolution({
      ...debugContext,
      canonicalName: exactDbProfile.aliases?.[0] || name,
      source: ingredient.source,
      profile: exactDbProfile,
      grams: gramsFromQuantity(ingredient.quantity),
      macros: ingredient,
      sanity: plausibleIngredient(ingredient),
    });
    return ingredient;
  }

  const masterFuzzyProfile = await masterProfileFor(name, analysis, { context: masterContext });
  if (masterFuzzyProfile && profileHasUsableMacros(masterFuzzyProfile)) {
    const ingredient = scaleProfile({ name, quantity, profile: masterFuzzyProfile });
    debugFoodResolution({
      ...debugContext,
      canonicalName: masterFuzzyProfile.aliases?.[0] || analysis.canonicalName,
      source: ingredient.source,
      profile: masterFuzzyProfile,
      grams: gramsFromQuantity(ingredient.quantity),
      macros: ingredient,
      sanity: plausibleIngredient(ingredient),
    });
    return ingredient;
  }

  const fuzzyDbProfile = await nutritionDbProfileFor(name);
  if (fuzzyDbProfile) {
    const ingredient = scaleProfile({ name, quantity, profile: fuzzyDbProfile });
    debugFoodResolution({
      ...debugContext,
      canonicalName: fuzzyDbProfile.aliases?.[0] || name,
      source: ingredient.source,
      profile: fuzzyDbProfile,
      grams: gramsFromQuantity(ingredient.quantity),
      macros: ingredient,
      sanity: plausibleIngredient(ingredient),
    });
    return ingredient;
  }

  if (options.allowAiFallback === false) {
    if (options.logUnresolved !== false) {
      await logUnresolvedFood(name, quantity, options.context || 'ingredient_resolver', {
        reason: 'food_intelligence_unresolved',
        classified_type: classification.type,
        food_state: analysis.foodStateKey,
        canonical_name: classification.canonicalName,
      });
    }
    debugFoodResolution({
      ...debugContext,
      canonicalName: classification.canonicalName,
      source: 'unresolved_foods',
      profile: null,
      grams: gramsFromQuantity(quantity),
      macros: null,
      sanity: false,
    });
    return null;
  }

  let result = await estimateNutrition(name, quantity);
  if (!result) result = await retryEstimateNutrition(name, quantity);
  if (!result) {
    await logUnresolvedFood(name, quantity, options.context || 'ingredient_resolver', { reason: 'ai_no_result' });
    return null;
  }

  const ingredient = {
    _rowId: crypto.randomUUID(),
    name,
    quantity,
    calories: Number(result.calories) || 0,
    protein: Number(result.protein) || 0,
    carbs: Number(result.carbs) || 0,
    fats: Number(result.fats) || 0,
    _needsCalculation: false,
    source: 'ai_fallback',
  };
  if (plausibleIngredient(ingredient)) return ingredient;

  await logUnresolvedFood(name, quantity, options.context || 'ingredient_resolver', { reason: 'implausible_ai_result' });
  return null;
}

export async function calculateMealFromIdentifiedIngredients({ foodName, quantity = '1 serving', ingredients = [], mealSizeEstimateGrams = null }) {
  const hasPortionReasoning = Number.isFinite(Number(mealSizeEstimateGrams)) ||
    (ingredients || []).some((ingredient) =>
      Number.isFinite(Number(ingredient?.estimated_grams)) ||
      Number.isFinite(Number(ingredient?.visible_share_percent))
    );

  const calculated = (await Promise.all((ingredients || []).map(async (ingredient) => {
    const name = String(ingredient?.name || '').trim();
    if (!name) return null;
    const rawQuantityText = photoQuantityFromPortion(ingredient, mealSizeEstimateGrams);
    const quantityText = calibratePhotoQuantity(name, rawQuantityText, ingredients.length);
    const result = await estimateIngredientFromFreeSources(name, quantityText, {
      allowAiFallback: false,
      context: 'photo_ingredient_resolver',
    });
    if (result) {
      return {
        ...result,
        visible_share_percent: Number.isFinite(Number(ingredient?.visible_share_percent))
          ? Number(ingredient.visible_share_percent)
          : undefined,
        portion_confidence: ingredient?.confidence || '',
      };
    }

    return {
      _rowId: crypto.randomUUID(),
      name,
      quantity: quantityText,
      calories: 0,
      protein: 0,
      carbs: 0,
      fats: 0,
      _needsCalculation: true,
      source: hasPortionReasoning ? 'portion_needs_review' : 'needs_review',
      visible_share_percent: Number.isFinite(Number(ingredient?.visible_share_percent))
        ? Number(ingredient.visible_share_percent)
        : undefined,
      portion_confidence: ingredient?.confidence || '',
    };
  }))).filter(Boolean);

  if (calculated.length === 0 && foodName) {
    const fallback = await estimateNutritionFromFreeSources(foodName, quantity);
    return fallback ? { ...fallback, source: 'photo_identification_fallback' } : null;
  }

  if (calculated.length === 1 && calculated[0]._needsCalculation) {
    const template = await recipeTemplateFor(foodName) || await recipeTemplateFor(calculated[0].name);
    const templateMeal = template ? await buildRecipeTemplateMeal(foodName || calculated[0].name, quantity, template) : null;
    if (templateMeal) return { ...templateMeal, source: 'photo_recipe_template' };
  }

  if (calculated.length === 0) return null;

  const meal = buildMeal({
    foodName,
    quantity,
    ingredients: calculated,
    source: hasPortionReasoning ? 'photo_proportion_estimate' : 'photo_identification',
  });

  return hasPortionReasoning
    ? {
        ...meal,
        confidence: 0.76,
        assumptionSource: 'AI meal-size and visible proportion estimate + nutrition database',
        meal_size_estimate_g: Number.isFinite(Number(mealSizeEstimateGrams)) ? Number(mealSizeEstimateGrams) : undefined,
      }
    : meal;
}
