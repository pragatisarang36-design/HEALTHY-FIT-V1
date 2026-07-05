import { localMealDatabase } from '@/data/localMealDatabase';
import { describeDietRules, parseDietPreferences, validateMealAgainstDiet } from '@/services/dietValidation';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

const hash = (value) => {
  let h = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
};

const seededShuffle = (items, seed) => [...items]
  .map((item, index) => ({ item, score: hash(`${seed}:${item.id}:${index}`) }))
  .sort((a, b) => a.score - b.score)
  .map(({ item }) => item);

const goalScore = (meal, goal) => {
  const normalizedGoal = String(goal || '').toLowerCase();
  const fiber = Number(meal.fiber || 0);
  if (normalizedGoal.includes('muscle') || normalizedGoal.includes('gain')) return meal.protein * 3 + meal.calories / 20;
  if (normalizedGoal.includes('loss')) return meal.protein * 3 + fiber * 2 - meal.calories / 30;
  return meal.protein * 2 + meal.carbs / 20;
};

const mealTotals = (meals) => meals.reduce(
  (sum, meal) => ({
    calories: sum.calories + Number(meal.calories || 0),
    protein: sum.protein + Number(meal.protein || 0),
    carbs: sum.carbs + Number(meal.carbs || 0),
    fats: sum.fats + Number(meal.fats || 0),
  }),
  { calories: 0, protein: 0, carbs: 0, fats: 0 }
);

const normalizeMeal = (meal) => ({
  ...meal,
  ingredients: meal.ingredients || [],
  recipe_steps: meal.recipe_steps || [],
  calories: Math.round(Number(meal.calories) || 0),
  protein: Math.round(Number(meal.protein) || 0),
  carbs: Math.round(Number(meal.carbs) || 0),
  fats: Math.round(Number(meal.fats) || 0),
  source: 'curated',
});

const recentMealIds = (recentPlans = []) => new Set(
  recentPlans
    .flatMap((plan) => plan?.plan_data?.days || [])
    .flatMap((day) => day.meals || [])
    .map((meal) => meal.id)
    .filter(Boolean)
);

const chooseMealsForDay = ({ candidatesByType, usedIds, profile, dayIndex, seed, recentIds }) => {
  const meals = [];

  for (const type of MEAL_TYPES) {
    const pool = candidatesByType[type] || [];
    const fresh = pool.filter((meal) => !usedIds.has(meal.id) && !recentIds.has(meal.id));
    const unused = fresh.length > 0 ? fresh : pool.filter((meal) => !usedIds.has(meal.id));
    const usable = unused.length > 0 ? unused : pool;
    const selected = seededShuffle(usable, `${seed}:${dayIndex}:${type}`)
      .sort((a, b) => goalScore(b, profile.fitness_goal) - goalScore(a, profile.fitness_goal))[hash(`${seed}:${type}:${dayIndex}`) % Math.max(usable.length, 1)];

    if (!selected) {
      throw new Error(`No ${type} meals match your filters. Loosen one filter or update preferences.`);
    }

    usedIds.add(selected.id);
    meals.push(normalizeMeal(selected));
  }

  return meals;
};

export async function generateRuleBasedMealPlan(profile, options = {}) {
  const { planType = '1_day', filters = [], customPreference = '', recentPlans = [], seed = '' } = options;
  const rules = parseDietPreferences({ profile, filters, customPreference });
  const daysCount = planType === '7_day' ? 7 : 1;
  const planSeed = seed || `${profile?.id || profile?.name || 'user'}:${new Date().toISOString().slice(0, 10)}:${recentPlans.length}:${Math.random()}`;
  const recentIds = recentMealIds(recentPlans);
  const filteredMeals = localMealDatabase.filter((meal) => validateMealAgainstDiet(meal, rules));

  const candidatesByType = MEAL_TYPES.reduce((acc, type) => {
    acc[type] = filteredMeals.filter((meal) => meal.type === type);
    return acc;
  }, {});

  for (const type of MEAL_TYPES) {
    if (!candidatesByType[type]?.length) {
      throw new Error(`No ${type} meals match the selected filters. Try removing one strict filter.`);
    }
  }

  const usedIds = new Set();
  const days = Array.from({ length: daysCount }, (_, index) => {
    const meals = chooseMealsForDay({ candidatesByType, usedIds, profile, dayIndex: index, seed: planSeed, recentIds });
    return {
      day: DAY_NAMES[index] || `Day ${index + 1}`,
      meals,
      totals: mealTotals(meals),
    };
  });

  return {
    plan_type: planType,
    generated_by: 'rule_based_engine',
    generated_at: new Date().toISOString(),
    filters_applied: describeDietRules(rules),
    custom_preference: customPreference.trim(),
    rotation_seed: planSeed,
    avoided_recent_meal_ids: [...recentIds],
    data_sources: ['curated local meal database'],
    days,
    meals: daysCount === 1 ? days[0].meals : undefined,
    totals: mealTotals(days.flatMap((day) => day.meals)),
  };
}
