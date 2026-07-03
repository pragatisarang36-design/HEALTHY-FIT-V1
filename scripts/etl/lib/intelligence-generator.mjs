import { searchKey, titleCase } from './normalize.mjs';

const FOOD_TYPES = new Set([
  'simple_ingredient',
  'tiny_garnish',
  'spice',
  'cooked_side',
  'mixed_recipe',
  'branded_packaged',
  'beverage',
  'dessert',
  'unknown',
]);

const STATE_WORDS = [
  ['boiled', /\b(boiled|simmered|pressure cooked)\b/],
  ['steamed', /\b(steamed|idli)\b/],
  ['fried', /\b(fried|fry|pakora|samosa|bhajiya)\b/],
  ['grilled', /\b(grilled|tandoori|bbq|barbeque|barbecue)\b/],
  ['roasted', /\b(roasted|roast)\b/],
  ['dry', /\b(dry|powder|spice|masala)\b/],
  ['canned', /\b(canned|tin|tinned)\b/],
  ['cooked', /\b(cooked|curry|sabzi|rice|dal|sambar|rasam|chole|rajma|pulao|biryani|upma|poha)\b/],
  ['raw', /\b(raw|fresh|salad|fruit|juice)\b/],
];

const TINY_GARNISH_RE = /\b(lime|lemon|chili|chilli|coriander|cilantro|mint|curry leaves?|ginger|garlic|parsley|basil|herb|herbs|spice|spices|masala|turmeric|cumin|mustard seed|fenugreek|cardamom|clove|bay leaf|pepper|hing|asafoetida)\b/i;
const BEVERAGE_RE = /\b(water|juice|tea|coffee|milk|smoothie|shake|lassi|buttermilk|chaas|soda|drink|beverage)\b/i;
const DESSERT_RE = /\b(cake|ice cream|kheer|payasam|halwa|jalebi|gulab jamun|rasgulla|laddu|ladoo|dessert|sweet|mithai|barfi|burfi|kulfi)\b/i;
const COOKED_SIDE_RE = /\b(rice|dal|chapati|roti|idli|dosa|paratha|naan|sabzi|bhindi|okra|salad|raita|curd rice|lemon rice|khichdi)\b/i;
const MIXED_RECIPE_RE = /\b(curry|biryani|pulao|pulav|fried rice|poha|upma|sambar|rasam|chole|rajma|pasta|sandwich|pizza|tadka|gravy|korma|smoothie)\b/i;

const macroAverage = (profiles) => {
  const valid = profiles.filter((row) => Number(row.calories_per_100g) > 0);
  if (!valid.length) {
    return { calories: 60, protein: 2, carbs: 12, fat: 1, fiber: 2 };
  }

  const avg = (field) => valid.reduce((sum, row) => sum + (Number(row[field]) || 0), 0) / valid.length;
  return {
    calories: Number(avg('calories_per_100g').toFixed(2)),
    protein: Number(avg('protein_per_100g').toFixed(2)),
    carbs: Number(avg('carbs_per_100g').toFixed(2)),
    fat: Number(avg('fat_per_100g').toFixed(2)),
    fiber: Number(avg('fiber_per_100g').toFixed(2)),
  };
};

export const inferStateFromText = (value, fallback = 'unknown') => {
  const text = String(value || '').toLowerCase();
  for (const [state, pattern] of STATE_WORDS) {
    if (pattern.test(text)) return state;
  }
  return fallback;
};

export const classifyFoodFromData = (row, source = 'food') => {
  const text = [
    row.canonical_name,
    row.search_key,
    row.category,
    row.cuisine,
    row.brand,
    row.product_name,
  ].filter(Boolean).join(' ');

  if (source === 'branded' || row.brand || row.barcode) return 'branded_packaged';
  if (source === 'recipe') return 'mixed_recipe';
  if (TINY_GARNISH_RE.test(text)) return /\b(spice|spices|masala|turmeric|cumin|mustard seed|fenugreek|cardamom|clove|bay leaf|pepper|hing|asafoetida)\b/i.test(text)
    ? 'spice'
    : 'tiny_garnish';
  if (BEVERAGE_RE.test(text)) return 'beverage';
  if (DESSERT_RE.test(text)) return 'dessert';
  if (MIXED_RECIPE_RE.test(text)) return 'mixed_recipe';
  if (COOKED_SIDE_RE.test(text)) return 'cooked_side';
  return 'simple_ingredient';
};

export const buildFoodIntelligenceRules = ({
  foods = [],
  foodStates = [],
  brandedFoods = [],
  recipeTemplates = [],
}) => {
  const stateByFoodId = new Map();
  for (const state of foodStates) {
    if (state.is_default === true || state.is_default === 'true' || !stateByFoodId.has(state.food_id)) {
      stateByFoodId.set(state.food_id, state.state_key || inferStateFromText(state.state_name));
    }
  }

  const rules = new Map();
  const put = (search_key, food_type, food_state_key, confidence, rulesJson = {}) => {
    const key = searchKey(search_key);
    if (!key || !FOOD_TYPES.has(food_type)) return;
    rules.set(key, {
      search_key: key,
      food_type,
      food_state_key: food_state_key || 'unknown',
      confidence,
      rules: JSON.stringify(rulesJson),
    });
  };

  for (const food of foods) {
    const type = classifyFoodFromData(food, 'food');
    put(food.search_key || food.canonical_name, type, stateByFoodId.get(food.id) || food.default_state_key || inferStateFromText(food.canonical_name), 0.78, {
      generated_from: 'nutrition_dataset',
      canonical: food.search_key || food.canonical_name,
    });
  }

  for (const branded of brandedFoods) {
    put(branded.product_name, 'branded_packaged', 'unknown', 0.82, {
      generated_from: 'branded_dataset',
      brand: branded.brand || '',
      lookup: 'branded',
    });
  }

  for (const template of recipeTemplates) {
    put(template.search_key || template.canonical_name, 'mixed_recipe', 'cooked', Number(template.confidence) || 0.75, {
      generated_from: 'recipe_dataset',
      canonical: template.search_key || template.canonical_name,
      route: 'recipe_template',
      recipe_count: Number(template.recipe_count) || 1,
    });
  }

  return [...rules.values()].sort((a, b) => a.search_key.localeCompare(b.search_key));
};

export const buildTinyGarnishProfiles = ({
  foods = [],
  profiles = [],
  aliases = [],
  recipeItems = [],
}) => {
  const profileByFoodId = new Map(profiles.map((row) => [row.food_id, row]));
  const rows = new Map();
  const garnishProfiles = [];

  for (const food of foods) {
    if (!TINY_GARNISH_RE.test(`${food.canonical_name} ${food.search_key} ${food.category}`)) continue;
    const profile = profileByFoodId.get(food.id);
    if (profile) garnishProfiles.push(profile);
    rows.set(food.search_key, {
      food_name: food.canonical_name,
      search_key: food.search_key,
      aliases: JSON.stringify(
        aliases
          .filter((alias) => alias.food_id === food.id)
          .map((alias) => alias.search_key)
          .filter(Boolean),
      ),
      default_grams: 3,
      calories_per_100g: Number(profile?.calories_per_100g) || 0,
      protein_per_100g: Number(profile?.protein_per_100g) || 0,
      carbs_per_100g: Number(profile?.carbs_per_100g) || 0,
      fat_per_100g: Number(profile?.fat_per_100g) || 0,
      fiber_per_100g: Number(profile?.fiber_per_100g) || 0,
      source_key: profile?.nutrition_source_key || 'dataset_generated',
      confidence: 0.82,
    });
  }

  const fallback = macroAverage(garnishProfiles);
  for (const item of recipeItems) {
    const key = searchKey(item.ingredient_search_key || item.ingredient_name);
    const percent = Number(item.percentage) || 0;
    if (!key || rows.has(key)) continue;
    if (!TINY_GARNISH_RE.test(`${item.ingredient_name} ${key}`) && percent > 5) continue;

    rows.set(key, {
      food_name: titleCase(key),
      search_key: key,
      aliases: JSON.stringify([key]),
      default_grams: percent <= 1 ? 1 : percent <= 5 ? 3 : 5,
      calories_per_100g: fallback.calories,
      protein_per_100g: fallback.protein,
      carbs_per_100g: fallback.carbs,
      fat_per_100g: fallback.fat,
      fiber_per_100g: fallback.fiber,
      source_key: 'recipe_derived',
      confidence: TINY_GARNISH_RE.test(`${item.ingredient_name} ${key}`) ? 0.78 : 0.58,
    });
  }

  return [...rows.values()].sort((a, b) => a.search_key.localeCompare(b.search_key));
};
