export const state_policy = Object.freeze({
  dry_raw_sensitive_categories: Object.freeze([
    'grains',
    'grain',
    'rice',
    'rice_dish',
    'rice_dishes',
    'pasta',
    'pasta_noodles',
    'noodles',
    'legumes',
    'beans',
    'lentils',
    'pulses',
    'soup',
    'soups',
    'soups_stews',
    'stew',
    'stews',
    'curry',
    'curries',
    'curries_gravies',
    'gravy',
    'gravies',
    'vegetables',
    'vegetable',
    'vegetables_sabzi',
    'sabzi',
    'tubers',
    'tuber',
    'potatoes',
    'meat',
    'chicken',
    'fish',
    'seafood',
    'eggs',
    'egg',
    'dairy',
    'paneer',
    'oats',
    'oat',
    'cereals',
    'cereals_oats',
    'mixed_recipes',
    'mixed_recipe',
  ]),
  prepared_contexts: Object.freeze([
    'image',
    'plated_meal',
    'photo_ingredient_resolver',
    'recipe_template',
    'recipe_template_item',
    'mixed_recipe',
    'restaurant',
    'restaurant_meal',
    'cooked_dish',
    'manual_meal_entry',
    'normal_meal_logging',
    'meal_component_resolver',
    'nutrition_resolver',
  ]),
  explicit_raw_terms: Object.freeze(['raw', 'dry', 'dried', 'uncooked', 'powder', 'powdered', 'mix', 'dehydrated']),
  explicit_cooked_terms: Object.freeze([
    'cooked',
    'boiled',
    'steamed',
    'fried',
    'deep fried',
    'shallow fried',
    'pan fried',
    'stir fried',
    'grilled',
    'roasted',
    'baked',
    'prepared',
  ]),
});

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const termPattern = (terms) => new RegExp(`\\b(${terms.map((term) => term.replace(/\s+/g, '\\s+')).join('|')})\\b`, 'i');

const RAW_PATTERN = termPattern(state_policy.explicit_raw_terms);
const COOKED_PATTERN = termPattern(state_policy.explicit_cooked_terms);

const CATEGORY_PATTERNS = Object.freeze([
  { category: 'mixed_recipe', pattern: /\b(mixed[_\s-]?recipes?|recipes?|dish|meal|sandwich|smoothie|pizza|restaurant)\b/ },
  { category: 'soups_stews', pattern: /\b(soup|soups|stew|stews|broth)\b/ },
  { category: 'curries_gravies', pattern: /\b(curry|curries|gravy|gravies|masala|korma)\b/ },
  { category: 'rice_dish', pattern: /\b(rice|chawal|bhaat|basmati|fried rice|rice dish)\b/ },
  { category: 'pasta', pattern: /\b(pasta|macaroni|spaghetti)\b/ },
  { category: 'noodles', pattern: /\b(noodle|noodles|ramen|vermicelli|sevai)\b/ },
  { category: 'legumes', pattern: /\b(legume|legumes|pulse|pulses|bean|beans|lentil|lentils|dal|dhal|daal|chana|chickpea|chickpeas|rajma)\b/ },
  { category: 'tubers', pattern: /\b(tuber|tubers|potato|potatoes|aloo|yam|sweet potato|cassava|tapioca)\b/ },
  { category: 'meat', pattern: /\b(meat|chicken|poultry|mutton|lamb|beef|pork)\b/ },
  { category: 'seafood', pattern: /\b(seafood|fish|salmon|tuna|prawn|prawns|shrimp|shrimps)\b/ },
  { category: 'eggs', pattern: /\b(egg|eggs)\b/ },
  { category: 'dairy', pattern: /\b(dairy|milk|paneer|cheese|curd|yogurt|yoghurt)\b/ },
  { category: 'cereals_oats', pattern: /\b(oat|oats|oatmeal|cereal|cereals|muesli|granola)\b/ },
  { category: 'vegetables_sabzi', pattern: /\b(vegetable|vegetables|sabzi|subzi|veg|produce|greens|leafy|spinach|palak|broccoli|okra|bhindi|carrot|onion|tomato|pepper|capsicum|cabbage|cauliflower|eggplant|brinjal)\b/ },
  { category: 'grains', pattern: /\b(grain|grains|cereal|cereals|wheat|flour|atta|rava|sooji|suji|quinoa|couscous|barley|millet)\b/ },
]);

const RAW_STATES = new Set(['raw', 'dry', 'uncooked']);
const PREPARED_STATES = new Set(['cooked', 'boiled', 'steamed', 'fried', 'deep_fried', 'shallow_fried', 'grilled', 'roasted', 'baked', 'canned']);

export const hasExplicitRawState = (value) => RAW_PATTERN.test(normalize(value));
export const hasExplicitCookedState = (value) => COOKED_PATTERN.test(normalize(value));

export const hasExplicitState = (value) => hasExplicitRawState(value) || hasExplicitCookedState(value);

export const isRawDryState = (stateKey) => RAW_STATES.has(String(stateKey || '').toLowerCase());

export const isPreparedState = (stateKey) => PREPARED_STATES.has(String(stateKey || '').toLowerCase());

export const isPreparedContext = (context = 'manual_meal_entry') => {
  const key = normalize(context).replace(/\s+/g, '_');
  return state_policy.prepared_contexts.includes(key);
};

export const inferStatePolicyCategory = (...values) => {
  const text = normalize(values.filter(Boolean).join(' '));
  if (!text) return 'unknown';
  const direct = text.replace(/[\s-]+/g, '_');
  if (state_policy.dry_raw_sensitive_categories.includes(direct)) return direct;
  return CATEGORY_PATTERNS.find((entry) => entry.pattern.test(text))?.category || 'unknown';
};

export const isDryRawSensitiveCategory = (category) =>
  state_policy.dry_raw_sensitive_categories.includes(String(category || '').toLowerCase().replace(/[\s-]+/g, '_'));

export const resolveStatePolicy = ({
  input,
  requestedStateKey = 'unknown',
  stateSource = '',
  foodType = 'unknown',
  category = '',
  context = 'manual_meal_entry',
} = {}) => {
  const policyCategory = inferStatePolicyCategory(category, foodType, input);
  const explicit = stateSource === 'name_pattern' || hasExplicitState(input);
  const explicitRaw = hasExplicitRawState(input) || (explicit && isRawDryState(requestedStateKey));
  const explicitCooked = hasExplicitCookedState(input) || (explicit && isPreparedState(requestedStateKey));
  const preparedContext = isPreparedContext(context) || foodType === 'mixed_recipe';
  const rawSensitive = isDryRawSensitiveCategory(policyCategory);

  let effectiveStateKey = requestedStateKey || 'unknown';
  let policyApplied = false;

  if (!explicit && preparedContext && rawSensitive && (effectiveStateKey === 'unknown' || isRawDryState(effectiveStateKey))) {
    effectiveStateKey = 'cooked';
    policyApplied = true;
  }

  return {
    policyCategory,
    explicit,
    explicitRaw,
    explicitCooked,
    preparedContext,
    rawSensitive,
    requestedStateKey: requestedStateKey || 'unknown',
    effectiveStateKey,
    context,
    blockRawDry: preparedContext && rawSensitive && !explicitRaw,
    policyApplied,
  };
};
