const normalizeText = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9.\s_-]/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const normalizeFoodText = normalizeText;

const has = (text, pattern) => pattern.test(text);

const NON_VEG_PATTERN = /\b(chicken|poultry|meat|mutton|lamb|beef|pork|fish|seafood|prawn|prawns|shrimp|shrimps|egg|eggs)\b/;
const MEAT_PATTERN = /\b(chicken|poultry|meat|mutton|lamb|beef|pork)\b/;
const FISH_PATTERN = /\b(fish|salmon|tuna|pomfret|cod|sardine|seafood|prawn|prawns|shrimp|shrimps|crab|lobster)\b/;
const DAIRY_PATTERN = /\b(dairy|milk|curd|yogurt|yoghurt|cheese|paneer|ghee|butter|cream)\b/;
const EGG_PATTERN = /\b(egg|eggs|omelette|omelet)\b/;

export const detectDietaryModifiers = (...values) => {
  const text = normalizeText(values.filter(Boolean).join(' '));
  const vegan = has(text, /\b(vegan)\b/);
  const vegetableDish = has(text, /\b(vegetable|vegetables|sabzi|subzi)\b/) && !has(text, NON_VEG_PATTERN);
  const vegetarian = vegan || vegetableDish || has(text, /\b(veg|vegetarian|pure veg|pure vegetarian)\b/);
  return {
    vegetarian,
    vegan,
    egg: has(text, EGG_PATTERN),
    chicken: has(text, /\b(chicken|poultry)\b/),
    fish: has(text, /\b(fish|salmon|tuna|pomfret|cod|sardine)\b/),
    seafood: has(text, /\b(seafood|prawn|prawns|shrimp|shrimps|crab|lobster)\b/),
    mutton: has(text, /\b(mutton|lamb|goat)\b/),
    beef: has(text, /\b(beef)\b/),
    pork: has(text, /\b(pork|bacon|ham)\b/),
    paneer: has(text, /\b(paneer)\b/),
    mushroom: has(text, /\b(mushroom|mushrooms)\b/),
  };
};

export const ingredientCategoryFor = (...values) => {
  const text = normalizeText(values.filter(Boolean).join(' '));
  if (!text) return 'unknown';
  if (has(text, EGG_PATTERN)) return 'egg';
  if (has(text, /\b(chicken|poultry)\b/)) return 'chicken';
  if (has(text, /\b(mutton|lamb|goat)\b/)) return 'mutton';
  if (has(text, /\b(beef)\b/)) return 'beef';
  if (has(text, /\b(pork|bacon|ham)\b/)) return 'pork';
  if (has(text, FISH_PATTERN)) return has(text, /\b(seafood|prawn|prawns|shrimp|shrimps|crab|lobster)\b/) ? 'seafood' : 'fish';
  if (has(text, /\b(paneer)\b/)) return 'paneer';
  if (has(text, DAIRY_PATTERN)) return 'dairy';
  if (has(text, /\b(mushroom|mushrooms)\b/)) return 'mushroom';
  if (has(text, /\b(oil|ghee|butter)\b/)) return 'oil';
  if (has(text, /\b(rice|chawal|bhaat|biryani|pulao|fried rice)\b/)) return 'rice_dish';
  if (has(text, /\b(noodle|noodles|pasta|macaroni|spaghetti|ramen|vermicelli)\b/)) return 'pasta_noodles';
  if (has(text, /\b(soup|soups|stew|stews|broth)\b/)) return 'soups_stews';
  if (has(text, /\b(curry|curries|gravy|gravies|masala|korma)\b/)) return 'curries_gravies';
  if (has(text, /\b(dal|dhal|daal|lentil|lentils|bean|beans|pulse|pulses|chana|chickpea|rajma)\b/)) return 'legumes';
  if (has(text, /\b(potato|potatoes|aloo|yam|sweet potato|cassava|tapioca|tuber|tubers)\b/)) return 'tubers';
  if (has(text, /\b(oat|oats|oatmeal|cereal|cereals|muesli|granola)\b/)) return 'cereals_oats';
  if (has(text, /\b(grain|grains|wheat|flour|atta|rava|sooji|suji|quinoa|couscous|barley|millet|roti|chapati|bread)\b/)) return 'grains';
  if (has(text, /\b(vegetable|vegetables|sabzi|subzi|veg|spinach|palak|broccoli|okra|bhindi|carrot|onion|tomato|capsicum|cabbage|cauliflower|eggplant|brinjal)\b/)) return 'vegetables_sabzi';
  if (has(text, /\b(recipe|dish|meal|mixed)\b/)) return 'mixed_recipes';
  return 'unknown';
};

export const ingredientAllowedByModifiers = (ingredientName, modifiers = {}) => {
  const category = ingredientCategoryFor(ingredientName);
  const isEgg = category === 'egg';
  const isMeat = ['chicken', 'mutton', 'beef', 'pork'].includes(category) || has(normalizeText(ingredientName), MEAT_PATTERN);
  const isFishOrSeafood = ['fish', 'seafood'].includes(category) || has(normalizeText(ingredientName), FISH_PATTERN);
  const isDairy = ['dairy', 'paneer'].includes(category);

  if (modifiers.vegan && (isEgg || isMeat || isFishOrSeafood || isDairy)) return false;
  if (modifiers.vegetarian && (isEgg || isMeat || isFishOrSeafood)) return false;
  return true;
};

export const normalizeIngredientName = (name) => {
  let text = normalizeText(name)
    .replace(/\b(finely|roughly|coarsely|thinly|fresh|dried|dry|raw|cooked|boiled|chopped|sliced|diced|minced|crushed|powdered|ground|optional|to taste)\b/g, ' ')
    .replace(/\b\d+(\.\d+)?\b/g, ' ')
    .replace(/\b(tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|cup|cups|gram|grams|g|kg|ml|l)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/\b(oil|cooking oil|vegetable oil|sunflower oil|canola oil)\b/.test(text)) text = 'oil';
  if (/\b(salt|table salt)\b/.test(text)) text = 'salt';
  return text;
};

const toPercentageOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const mergeTemplateItems = (items = []) => {
  const groups = new Map();
  for (const [index, item] of (items || []).entries()) {
    const displayName = String(item?.ingredient_name || item?.name || '').trim();
    const key = normalizeIngredientName(item?.ingredient_search_key || displayName);
    if (!key) continue;

    const existing = groups.get(key);
    const percentage = toPercentageOrNull(item?.percentage);
    const minPercentage = toPercentageOrNull(item?.min_percentage);
    const maxPercentage = toPercentageOrNull(item?.max_percentage);
    if (!existing) {
      groups.set(key, {
        ...item,
        ingredient_name: displayName || key,
        ingredient_search_key: item?.ingredient_search_key || key,
        percentage,
        min_percentage: minPercentage,
        max_percentage: maxPercentage,
        required: item?.required !== false,
        sort_order: Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : index,
      });
      continue;
    }

    existing.percentage = existing.percentage !== null && percentage !== null
      ? existing.percentage + percentage
      : existing.percentage ?? percentage;
    existing.min_percentage = existing.min_percentage !== null && minPercentage !== null
      ? existing.min_percentage + minPercentage
      : existing.min_percentage ?? minPercentage;
    existing.max_percentage = existing.max_percentage !== null && maxPercentage !== null
      ? existing.max_percentage + maxPercentage
      : existing.max_percentage ?? maxPercentage;
    existing.required = existing.required || item?.required === true;
  }

  return [...groups.values()].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
};

const CATEGORY_ALIASES = Object.freeze({
  rice: 'rice_dish',
  rice_dishes: 'rice_dish',
  pasta: 'pasta_noodles',
  noodles: 'pasta_noodles',
  soup: 'soups_stews',
  soups: 'soups_stews',
  stew: 'soups_stews',
  stews: 'soups_stews',
  curry: 'curries_gravies',
  curries: 'curries_gravies',
  gravy: 'curries_gravies',
  gravies: 'curries_gravies',
  vegetables: 'vegetables_sabzi',
  vegetable: 'vegetables_sabzi',
  sabzi: 'vegetables_sabzi',
  cereals: 'cereals_oats',
  oats: 'cereals_oats',
  meat: 'meat_seafood',
  chicken: 'meat_seafood',
  fish: 'meat_seafood',
  seafood: 'meat_seafood',
  egg: 'eggs',
  mixed_recipe: 'mixed_recipes',
});

export const preparedCategoryFor = (...values) => {
  const direct = normalizeText(values.filter(Boolean).join(' ')).replace(/\s+/g, '_');
  if (CATEGORY_ALIASES[direct]) return CATEGORY_ALIASES[direct];
  const inferred = ingredientCategoryFor(...values);
  return CATEGORY_ALIASES[inferred] || inferred;
};

export const PREPARED_KCAL_RANGES = Object.freeze({
  grains: { min: 40, max: 280 },
  rice_dish: { min: 50, max: 330 },
  pasta_noodles: { min: 50, max: 340 },
  legumes: { min: 45, max: 240 },
  soups_stews: { min: 10, max: 220 },
  curries_gravies: { min: 45, max: 360 },
  vegetables_sabzi: { min: 10, max: 260 },
  tubers: { min: 45, max: 380 },
  meat_seafood: { min: 50, max: 380 },
  eggs: { min: 80, max: 260 },
  cereals_oats: { min: 40, max: 260 },
  mixed_recipes: { min: 35, max: 380 },
});

export const profileKcalStatus = (profile, { category = '', context = '', statePolicy = {} } = {}) => {
  const calories = Number(profile?.calories ?? profile?.calories_per_100g);
  if (!Number.isFinite(calories) || calories <= 0) return { status: 'fail', reason: 'missing_calories' };
  const prepared = statePolicy.preparedContext !== false && !statePolicy.explicitRaw;
  if (!prepared) return { status: 'pass', reason: 'not_prepared_context' };
  const resolvedCategory = preparedCategoryFor(category, statePolicy.policyCategory, profile?.category, profile?.aliases?.join(' '), context);
  const range = PREPARED_KCAL_RANGES[resolvedCategory];
  if (!range) return { status: 'pass', reason: 'no_category_range', category: resolvedCategory };
  if (calories < range.min || calories > range.max) {
    return { status: 'fail', reason: `kcal_out_of_range_${resolvedCategory}`, category: resolvedCategory, range };
  }
  const edge = (range.max - range.min) * 0.12;
  if (calories > range.max - edge || calories < range.min + edge) {
    return { status: 'warn', reason: `kcal_near_range_edge_${resolvedCategory}`, category: resolvedCategory, range };
  }
  return { status: 'pass', reason: 'kcal_in_range', category: resolvedCategory, range };
};

const templateText = (template) =>
  normalizeText([
    template?.canonical_name,
    template?.name,
    template?.search_key,
    template?.cuisine,
    template?.category,
    ...(template?.items || []).map((item) => item.ingredient_name || item.ingredient_search_key),
  ].filter(Boolean).join(' '));

export const scoreTemplateCandidate = (template, requestedName, context = {}) => {
  const key = normalizeText(requestedName);
  const candidateKey = normalizeText(template?.search_key || template?.canonical_name || template?.name);
  const text = templateText(template);
  const modifiers = {
    ...detectDietaryModifiers(key, context?.modifiersText, context?.category, context?.cuisine),
    ...(context?.modifiers || {}),
  };
  let score = 0;
  if (candidateKey === key) score += 100;
  else if (candidateKey && key.includes(candidateKey)) score += 55;
  else if (candidateKey && candidateKey.includes(key)) score += 45;

  const requestedTokens = key.split(' ').filter((token) => token.length > 2);
  score += requestedTokens.filter((token) => text.includes(token)).length * 8;

  for (const [modifier, present] of Object.entries(modifiers)) {
    if (!present) continue;
    if (text.includes(modifier)) score += 24;
  }

  if (context?.cuisine && text.includes(normalizeText(context.cuisine))) score += 10;
  if (context?.category && text.includes(normalizeText(context.category))) score += 10;

  const items = template?.items || [];
  const incompatible = items.filter((item) => !ingredientAllowedByModifiers(item.ingredient_name || item.ingredient_search_key, modifiers));
  score -= incompatible.length * 90;
  score += Number(template?.confidence || 0) * 10;
  score += Math.min(10, Number(template?.recipe_count || 0) / 1000);

  return { score, modifiers, incompatibleCount: incompatible.length };
};

export const filterTemplateItemsByModifiers = (items = [], modifiers = {}) =>
  (items || []).filter((item) => ingredientAllowedByModifiers(item.ingredient_name || item.ingredient_search_key, modifiers));

const REQUESTED_VARIANT_INGREDIENTS = Object.freeze([
  { modifier: 'chicken', ingredient_name: 'chicken breast', percentage: 15 },
  { modifier: 'fish', ingredient_name: 'fish', percentage: 15 },
  { modifier: 'seafood', ingredient_name: 'seafood', percentage: 15 },
  { modifier: 'mutton', ingredient_name: 'mutton', percentage: 15 },
  { modifier: 'beef', ingredient_name: 'beef', percentage: 15 },
  { modifier: 'pork', ingredient_name: 'pork', percentage: 15 },
  { modifier: 'egg', ingredient_name: 'egg', percentage: 8 },
  { modifier: 'paneer', ingredient_name: 'paneer', percentage: 15 },
  { modifier: 'mushroom', ingredient_name: 'mushroom', percentage: 12 },
]);

const PROTEIN_VARIANT_CATEGORIES = new Set([
  'egg',
  'chicken',
  'fish',
  'seafood',
  'mutton',
  'beef',
  'pork',
  'paneer',
  'mushroom',
]);

export const applyTemplateModifierVariants = (items = [], modifiers = {}) => {
  let next = [...(items || [])];
  for (const variant of REQUESTED_VARIANT_INGREDIENTS) {
    if (!modifiers[variant.modifier]) continue;
    const alreadyPresent = next.some((item) => ingredientCategoryFor(item.ingredient_name || item.ingredient_search_key) === variant.modifier);
    if (alreadyPresent) continue;

    const replaceIndex = next.findIndex((item) => {
      const category = ingredientCategoryFor(item.ingredient_name || item.ingredient_search_key);
      return PROTEIN_VARIANT_CATEGORIES.has(category) && !modifiers[category];
    });
    const replaced = replaceIndex >= 0 ? next[replaceIndex] : null;
    const replacement = {
      ingredient_name: variant.ingredient_name,
      ingredient_search_key: normalizeIngredientName(variant.ingredient_name),
      percentage: Number.isFinite(Number(replaced?.percentage)) ? Number(replaced.percentage) : variant.percentage,
      min_percentage: Number.isFinite(Number(replaced?.min_percentage)) ? Number(replaced.min_percentage) : 0,
      max_percentage: Number.isFinite(Number(replaced?.max_percentage)) ? Number(replaced.max_percentage) : variant.percentage * 2,
      required: replaced?.required ?? true,
      sort_order: Number.isFinite(Number(replaced?.sort_order)) ? Number(replaced.sort_order) : next.length + 1,
    };
    if (replaceIndex >= 0) {
      next = [...next.slice(0, replaceIndex), replacement, ...next.slice(replaceIndex + 1)];
    } else {
      next = [...next, replacement];
    }
  }
  return next;
};
