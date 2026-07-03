import { MAJOR_ALLERGENS } from '@/data/localMealDatabase';

const norm = (value) => String(value || '').toLowerCase().replace(/[\s-]+/g, '_').trim();

const textIncludes = (meal, terms) => {
  const haystack = [
    meal.name,
    meal.cuisine,
    ...(meal.ingredients || []),
    ...(meal.dietTags || []),
    ...(meal.allergens || []),
  ].join(' ').toLowerCase();
  return terms.some((term) => haystack.includes(String(term || '').toLowerCase()));
};

export const parseDietPreferences = ({ profile = {}, filters = [], customPreference = '' }) => {
  const raw = [
    profile.diet_preference,
    ...(profile.food_allergies || []),
    ...(profile.food_dislikes || []),
    ...filters,
    customPreference,
  ].filter(Boolean).join(' ').toLowerCase();

  const strict = new Set(filters.map(norm));
  const addIf = (condition, tag) => condition && strict.add(tag);

  const asksNonVeg = /non[_\s-]?veg|non[_\s-]?vegetarian|chicken|fish|meat/.test(raw);
  addIf(/vegetarian|veg\b/.test(raw) && !asksNonVeg, 'vegetarian');
  addIf(asksNonVeg, 'non_veg');
  addIf(/vegan/.test(raw), 'vegan');
  addIf(/dairy[_\s-]?free|no dairy|milk allergy|lactose/.test(raw), 'dairy_free');
  addIf(/gluten[_\s-]?free|no gluten|wheat allergy|celiac/.test(raw), 'gluten_free');
  addIf(/jain|no onion garlic|no onion|no garlic|root vegetable/.test(raw), 'jain');
  addIf(/high protein|protein/.test(raw), 'high_protein');
  addIf(/low carb|keto/.test(raw), 'low_carb');
  addIf(/budget|cheap|affordable/.test(raw), 'budget');
  addIf(/south indian|indian/.test(raw), 'indian');

  if (strict.has('vegan')) {
    strict.add('vegetarian');
    strict.add('dairy_free');
  }

  const allergies = new Set((profile.food_allergies || []).map(norm));
  for (const allergen of MAJOR_ALLERGENS) {
    if (raw.includes(allergen.replace('_', ' ')) || raw.includes(allergen)) allergies.add(allergen);
  }
  if (strict.has('dairy_free')) allergies.add('milk');
  if (strict.has('gluten_free')) allergies.add('wheat');

  const avoidFoods = new Set((profile.food_dislikes || []).map((item) => String(item).toLowerCase().trim()).filter(Boolean));
  for (const term of customPreference.split(',')) {
    const clean = term.trim().toLowerCase();
    if (clean.startsWith('no ')) avoidFoods.add(clean.replace(/^no\s+/, ''));
  }
  if (strict.has('jain')) {
    ['onion', 'garlic', 'potato', 'carrot', 'beetroot', 'radish', 'root vegetable'].forEach((item) => avoidFoods.add(item));
  }

  return { strict: [...strict], allergies: [...allergies], avoidFoods: [...avoidFoods] };
};

export const validateMealAgainstDiet = (meal, rules) => {
  const tags = new Set((meal.dietTags || []).map(norm));
  const avoidTags = new Set((meal.avoidTags || []).map(norm));
  const allergens = new Set((meal.allergens || []).map(norm));

  if (rules.strict.includes('vegetarian') && (tags.has('non_veg') || avoidTags.has('vegetarian'))) return false;
  if (rules.strict.includes('vegan') && (!tags.has('vegan') || avoidTags.has('vegan'))) return false;
  if (rules.strict.includes('dairy_free') && (allergens.has('milk') || avoidTags.has('dairy_free'))) return false;
  if (rules.strict.includes('gluten_free') && (allergens.has('wheat') || avoidTags.has('gluten_free'))) return false;
  if (rules.strict.includes('jain') && (!tags.has('jain') || avoidTags.has('jain'))) return false;

  for (const allergen of rules.allergies) {
    if (allergens.has(norm(allergen))) return false;
  }

  if (textIncludes(meal, rules.avoidFoods)) return false;

  const preferenceTags = rules.strict.filter((tag) =>
    ['high_protein', 'low_carb', 'keto', 'budget', 'indian', 'high_fiber', 'low_fat', 'diabetic_friendly'].includes(tag)
  );
  if (preferenceTags.length > 0 && !preferenceTags.some((tag) => tags.has(tag))) {
    if (preferenceTags.includes('diabetic_friendly') && (tags.has('low_carb') || tags.has('high_fiber') || tags.has('low_fat'))) return true;
    return false;
  }

  return true;
};

export const describeDietRules = (rules) => [
  ...rules.strict,
  ...rules.allergies.map((allergen) => `allergy:${allergen}`),
  ...rules.avoidFoods.map((food) => `avoid:${food}`),
];
