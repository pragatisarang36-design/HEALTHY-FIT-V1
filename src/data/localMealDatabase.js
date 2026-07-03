export const MAJOR_ALLERGENS = [
  'milk',
  'eggs',
  'fish',
  'shellfish',
  'tree_nuts',
  'peanuts',
  'wheat',
  'soybeans',
  'sesame',
];

const createMeal = ({
  id,
  name,
  mealType,
  dietType,
  ingredients,
  recipeSteps,
  calories,
  protein,
  carbs,
  fats,
  tags = [],
  allergens = [],
  avoidTags = [],
}) => ({
  id,
  name,
  mealType,
  type: mealType,
  dietType,
  dietTags: tags,
  ingredients,
  recipeSteps,
  recipe_steps: recipeSteps,
  calories,
  protein,
  carbs,
  fats,
  tags,
  allergens,
  avoidTags,
});

const mealSeeds = [
  ['jain-besan-chilla', 'Jain Besan Chilla', 'breakfast', 'jain vegan', ['besan 70g', 'tomato 60g', 'cucumber 60g', 'mint 10g', 'oil 1 tsp'], ['Whisk besan with water and cumin.', 'Cook two thin chillas.', 'Serve with tomato cucumber mint salad.'], 340, 18, 42, 11, ['vegetarian', 'vegan', 'jain', 'gluten_free', 'dairy_free', 'budget', 'indian', 'high_fiber'], [], []],
  ['ragi-idli-sambar', 'Ragi Idli with Lentil Sambar', 'breakfast', 'vegetarian', ['ragi idli 3', 'toor dal 120g', 'tomato 60g', 'drumstick 60g', 'sambar powder 1 tsp'], ['Steam ragi idlis.', 'Cook dal with tomato and drumstick.', 'Serve hot with sambar.'], 410, 18, 72, 7, ['vegetarian', 'vegan', 'dairy_free', 'indian', 'high_fiber'], [], ['jain']],
  ['tofu-scramble', 'Tofu Vegetable Scramble', 'breakfast', 'vegan', ['firm tofu 180g', 'spinach 70g', 'bell pepper 80g', 'turmeric 1/2 tsp', 'olive oil 1 tsp'], ['Crumble tofu.', 'Saute vegetables.', 'Cook tofu with turmeric until warm.'], 310, 24, 16, 17, ['vegetarian', 'vegan', 'dairy_free', 'gluten_free', 'high_protein', 'low_carb'], ['soybeans'], []],
  ['moong-dal-dosa', 'Moong Dal Dosa', 'breakfast', 'vegan', ['moong dal 80g', 'ginger 5g', 'cumin 1/2 tsp', 'coconut chutney 30g'], ['Soak and blend moong dal.', 'Cook thin dosas.', 'Serve with coconut chutney.'], 380, 22, 54, 8, ['vegetarian', 'vegan', 'dairy_free', 'gluten_free', 'indian', 'high_protein'], [], []],
  ['oats-yogurt-bowl', 'Oats Yogurt Berry Bowl', 'breakfast', 'vegetarian', ['rolled oats 50g', 'Greek yogurt 150g', 'berries 80g', 'chia seeds 1 tbsp'], ['Soak oats with yogurt.', 'Chill for 2 hours.', 'Top with berries and chia.'], 420, 28, 55, 10, ['vegetarian', 'high_protein', 'high_fiber'], ['milk'], ['vegan', 'dairy_free', 'gluten_free']],
  ['poha-peanut', 'Vegetable Poha with Peanuts', 'breakfast', 'vegan', ['flattened rice 70g', 'peas 40g', 'onion 30g', 'peanuts 15g', 'turmeric 1/2 tsp'], ['Rinse poha.', 'Cook onion, peas, turmeric, and peanuts.', 'Fold in poha.'], 360, 10, 58, 10, ['vegetarian', 'vegan', 'budget', 'indian', 'low_fat'], ['peanuts'], ['jain']],
  ['egg-spinach-toast', 'Egg Spinach Toast', 'breakfast', 'eggetarian', ['eggs 2', 'spinach 60g', 'whole wheat toast 1 slice', 'pepper 1 pinch'], ['Scramble eggs with spinach.', 'Toast bread.', 'Serve together.'], 330, 22, 24, 16, ['eggetarian', 'high_protein'], ['eggs', 'wheat'], ['vegetarian', 'vegan', 'jain', 'gluten_free']],
  ['quinoa-upma', 'Quinoa Vegetable Upma', 'breakfast', 'vegan', ['quinoa 80g', 'beans 50g', 'peas 40g', 'mustard seeds 1/2 tsp', 'curry leaves 5'], ['Cook quinoa.', 'Temper spices and vegetables.', 'Mix and steam briefly.'], 390, 15, 62, 10, ['vegetarian', 'vegan', 'dairy_free', 'gluten_free', 'indian'], [], []],
  ['sprouts-chaat', 'Sprouts Chaat', 'snack', 'vegan', ['sprouts 120g', 'tomato 60g', 'cucumber 60g', 'lemon 1 tbsp', 'chaat masala 1/2 tsp'], ['Steam sprouts briefly.', 'Mix vegetables and lemon.', 'Season and serve.'], 220, 14, 35, 3, ['vegetarian', 'vegan', 'dairy_free', 'gluten_free', 'high_fiber', 'indian'], [], []],
  ['fruit-seed-bowl', 'Fruit Seed Bowl', 'snack', 'jain vegan', ['seasonal fruit 180g', 'pumpkin seeds 15g', 'lime 1 wedge'], ['Slice fruit.', 'Top with pumpkin seeds.', 'Finish with lime.'], 210, 6, 32, 7, ['vegetarian', 'vegan', 'jain', 'dairy_free', 'gluten_free'], [], []],
  ['roasted-chana', 'Roasted Chana and Fruit', 'snack', 'jain vegan', ['roasted chana 40g', 'seasonal fruit 120g'], ['Portion chana.', 'Slice fruit.', 'Serve together.'], 260, 13, 42, 4, ['vegetarian', 'vegan', 'jain', 'dairy_free', 'gluten_free', 'budget', 'indian'], [], []],
  ['curd-sprouts', 'Curd Sprouts Bowl', 'snack', 'vegetarian', ['curd 150g', 'sprouts 80g', 'cucumber 60g', 'roasted cumin 1/2 tsp'], ['Mix curd and cumin.', 'Fold in sprouts and cucumber.', 'Serve chilled.'], 240, 17, 24, 8, ['vegetarian', 'high_protein', 'gluten_free', 'indian'], ['milk'], ['vegan', 'dairy_free']],
  ['dal-rice-bowl', 'Dal Rice Power Bowl', 'lunch', 'vegan', ['cooked rice 150g', 'moong dal 180g', 'mixed vegetables 120g', 'onion 30g', 'garlic 1 clove'], ['Cook dal until soft.', 'Saute aromatics and vegetables.', 'Serve dal over rice.'], 560, 23, 92, 11, ['vegetarian', 'vegan', 'indian', 'budget', 'high_fiber'], [], ['jain']],
  ['jain-quinoa-dal', 'Jain Quinoa Dal Bowl', 'lunch', 'jain vegan', ['quinoa 150g cooked', 'moong dal 180g', 'bottle gourd 120g', 'tomato 60g', 'cumin 1/2 tsp'], ['Cook dal with bottle gourd.', 'Season with cumin.', 'Serve over quinoa.'], 520, 26, 76, 12, ['vegetarian', 'vegan', 'jain', 'gluten_free', 'dairy_free', 'high_protein', 'indian'], [], []],
  ['paneer-millet-bowl', 'Paneer Millet Protein Bowl', 'lunch', 'vegetarian', ['paneer 120g', 'cooked millet 150g', 'capsicum 80g', 'curd 50g', 'spice mix 1 tsp'], ['Marinate paneer.', 'Saute capsicum and paneer.', 'Serve with millet.'], 610, 34, 52, 29, ['vegetarian', 'high_protein', 'gluten_free', 'indian'], ['milk'], ['vegan', 'dairy_free', 'jain']],
  ['chicken-rice-bowl', 'Lean Chicken Rice Bowl', 'lunch', 'non_veg', ['chicken breast 150g', 'cooked rice 160g', 'beans 100g', 'olive oil 1 tsp'], ['Grill chicken.', 'Steam beans.', 'Serve over rice.'], 590, 46, 65, 13, ['non_veg', 'high_protein', 'low_fat'], [], ['vegetarian', 'vegan', 'jain']],
  ['fish-salad', 'Grilled Fish Salad', 'lunch', 'non_veg pescatarian', ['grilled fish 150g', 'lettuce 80g', 'cucumber 80g', 'baby potatoes 160g'], ['Grill fish.', 'Boil potatoes.', 'Serve with salad.'], 520, 38, 45, 18, ['non_veg', 'pescatarian', 'high_protein', 'gluten_free'], ['fish'], ['vegetarian', 'vegan', 'jain']],
  ['rajma-rice', 'Rajma Rice Bowl', 'lunch', 'vegan', ['kidney beans curry 200g', 'cooked rice 150g', 'tomato 70g', 'onion 30g'], ['Cook rajma until soft.', 'Simmer with masala.', 'Serve with rice.'], 620, 24, 102, 12, ['vegetarian', 'vegan', 'dairy_free', 'indian', 'high_fiber'], [], ['jain']],
  ['chole-quinoa', 'Chole Quinoa Bowl', 'lunch', 'vegan', ['chickpea curry 180g', 'cooked quinoa 150g', 'cucumber 80g'], ['Cook chickpeas with spices.', 'Prepare quinoa.', 'Serve with cucumber.'], 570, 25, 84, 14, ['vegetarian', 'vegan', 'dairy_free', 'gluten_free', 'high_fiber', 'indian'], [], ['jain']],
  ['tempeh-bowl', 'Tempeh Rice Bowl', 'lunch', 'vegan', ['tempeh 120g', 'rice 150g', 'broccoli 100g', 'sesame oil 1 tsp'], ['Sear tempeh.', 'Steam broccoli.', 'Serve with rice.'], 610, 35, 70, 21, ['vegetarian', 'vegan', 'dairy_free', 'high_protein'], ['soybeans', 'sesame'], ['jain', 'gluten_free']],
  ['chickpea-salad', 'Chickpea Cucumber Salad', 'dinner', 'vegan', ['chickpeas 180g', 'cucumber 100g', 'tomato 80g', 'tahini 1 tbsp'], ['Combine chickpeas and vegetables.', 'Whisk tahini dressing.', 'Toss and serve.'], 450, 20, 58, 15, ['vegetarian', 'vegan', 'dairy_free', 'gluten_free', 'budget'], ['sesame'], ['jain']],
  ['jain-chickpea-salad', 'Jain Chickpea Herb Salad', 'dinner', 'jain vegan', ['chickpeas 180g', 'cucumber 100g', 'tomato 80g', 'lettuce 80g', 'pumpkin seeds 1 tbsp'], ['Combine chickpeas and vegetables.', 'Add pumpkin seeds.', 'Dress with lemon.'], 430, 19, 55, 14, ['vegetarian', 'vegan', 'jain', 'dairy_free', 'gluten_free'], [], []],
  ['egg-omelette', 'Egg White Vegetable Omelette', 'dinner', 'eggetarian', ['egg whites 5', 'whole egg 1', 'spinach 70g', 'mushrooms 80g'], ['Whisk eggs.', 'Saute vegetables.', 'Cook omelette until set.'], 330, 34, 12, 15, ['eggetarian', 'high_protein', 'low_carb', 'gluten_free'], ['eggs'], ['vegetarian', 'vegan', 'jain']],
  ['tofu-stir-fry', 'Tofu Stir Fry with Rice', 'dinner', 'vegan', ['tofu 180g', 'rice 140g', 'broccoli 100g', 'soy sauce 1 tbsp'], ['Sear tofu.', 'Stir fry broccoli.', 'Serve with rice.'], 560, 30, 64, 20, ['vegetarian', 'vegan', 'dairy_free', 'high_protein'], ['soybeans'], ['jain', 'gluten_free']],
  ['lentil-soup', 'Lentil Vegetable Soup', 'dinner', 'vegan', ['lentils 180g', 'tomato 80g', 'spinach 60g', 'herbs 1 tsp'], ['Simmer lentils.', 'Add vegetables.', 'Cook until thick.'], 390, 23, 58, 7, ['vegetarian', 'vegan', 'dairy_free', 'gluten_free', 'low_fat'], [], []],
  ['paneer-tikka-salad', 'Paneer Tikka Salad', 'dinner', 'vegetarian', ['paneer 120g', 'lettuce 80g', 'capsicum 70g', 'curd marinade 50g'], ['Marinate paneer.', 'Grill paneer.', 'Serve over salad.'], 480, 30, 22, 30, ['vegetarian', 'high_protein', 'low_carb', 'gluten_free'], ['milk'], ['vegan', 'dairy_free', 'jain']],
  ['chicken-soup', 'Chicken Vegetable Soup', 'dinner', 'non_veg', ['chicken 140g', 'beans 80g', 'spinach 60g', 'herbs 1 tsp'], ['Boil chicken.', 'Add vegetables.', 'Simmer and season.'], 360, 38, 18, 12, ['non_veg', 'high_protein', 'low_carb', 'low_fat'], [], ['vegetarian', 'vegan', 'jain']],
  ['salmon-rice', 'Salmon Rice Plate', 'dinner', 'non_veg pescatarian', ['salmon 140g', 'rice 120g', 'zucchini 100g', 'lemon 1 tbsp'], ['Pan sear salmon.', 'Cook rice.', 'Serve with zucchini.'], 610, 36, 52, 28, ['non_veg', 'pescatarian', 'high_protein', 'gluten_free'], ['fish'], ['vegetarian', 'vegan', 'jain']],
];

const safeBreakfastAddOns = [
  ['amaranth-porridge', 'Amaranth Banana Porridge', ['amaranth 70g', 'banana 80g', 'almond milk 150ml'], 390, 11, 68, 9, ['vegetarian', 'vegan', 'dairy_free', 'gluten_free']],
  ['millet-pongal', 'Little Millet Pongal', ['little millet 70g', 'moong dal 40g', 'pepper 1/2 tsp'], 430, 16, 72, 10, ['vegetarian', 'vegan', 'dairy_free', 'gluten_free', 'indian']],
  ['smoothie-soy', 'Soy Protein Smoothie', ['soy milk 250ml', 'banana 80g', 'pea protein 25g'], 360, 31, 42, 8, ['vegetarian', 'vegan', 'dairy_free', 'high_protein']],
  ['idiyappam-stew', 'Idiyappam Coconut Stew', ['rice idiyappam 3', 'coconut milk 120ml', 'beans 60g'], 430, 9, 76, 11, ['vegetarian', 'vegan', 'dairy_free', 'gluten_free', 'indian']],
];

const safeLunchDinnerAddOns = [
  ['black-bean-bowl', 'Black Bean Quinoa Bowl', 'lunch', ['black beans 180g', 'quinoa 150g', 'corn 50g'], 560, 26, 86, 13, ['vegetarian', 'vegan', 'dairy_free', 'gluten_free']],
  ['sattu-paratha-gf', 'Sattu Stuffed Gluten-Free Wrap', 'lunch', ['gluten-free wrap 1', 'sattu 60g', 'cucumber 80g'], 470, 22, 65, 13, ['vegetarian', 'vegan', 'dairy_free', 'gluten_free', 'indian']],
  ['mushroom-millet', 'Mushroom Millet Pilaf', 'lunch', ['millet 150g cooked', 'mushroom 100g', 'peas 50g'], 460, 15, 72, 12, ['vegetarian', 'vegan', 'dairy_free', 'gluten_free']],
  ['thai-tofu-curry', 'Thai Tofu Curry Rice', 'dinner', ['tofu 150g', 'coconut milk 100ml', 'rice 130g'], 590, 26, 62, 26, ['vegetarian', 'vegan', 'dairy_free', 'high_protein']],
  ['masoor-khichdi', 'Masoor Dal Khichdi', 'dinner', ['masoor dal 80g', 'rice 100g', 'spinach 60g'], 520, 24, 82, 10, ['vegetarian', 'vegan', 'dairy_free', 'indian']],
  ['jain-millet-kadhi', 'Jain Millet Kadhi Bowl', 'dinner', ['millet 150g', 'besan 40g', 'coconut yogurt 100g'], 490, 18, 68, 16, ['vegetarian', 'vegan', 'jain', 'dairy_free', 'gluten_free']],
  ['turkey-lettuce-bowl', 'Turkey Lettuce Bowl', 'lunch', ['turkey mince 150g', 'lettuce 100g', 'rice 100g'], 520, 42, 44, 18, ['non_veg', 'high_protein', 'gluten_free']],
  ['chicken-millet-salad', 'Chicken Millet Salad', 'dinner', ['chicken 150g', 'millet 130g', 'lettuce 90g'], 540, 44, 48, 16, ['non_veg', 'high_protein', 'gluten_free']],
  ['prawn-rice-bowl', 'Prawn Rice Bowl', 'lunch', ['prawns 150g', 'rice 150g', 'beans 80g'], 510, 36, 62, 12, ['non_veg', 'high_protein', 'low_fat'], ['shellfish']],
  ['egg-rice-bowl', 'Egg Rice Bowl', 'lunch', ['eggs 2', 'rice 140g', 'spinach 70g'], 500, 24, 58, 18, ['eggetarian', 'high_protein', 'gluten_free'], ['eggs']],
];

const snackAddOns = [
  ['peanut-banana', 'Peanut Banana Bites', ['banana 100g', 'peanut butter 1 tbsp'], 260, 8, 32, 12, ['vegetarian', 'vegan', 'dairy_free'], ['peanuts']],
  ['soy-yogurt-berries', 'Soy Yogurt Berries', ['soy yogurt 150g', 'berries 80g'], 180, 9, 24, 5, ['vegetarian', 'vegan', 'dairy_free'], ['soybeans']],
  ['makhana', 'Roasted Makhana', ['makhana 40g', 'oil 1 tsp', 'pepper 1 pinch'], 210, 7, 30, 7, ['vegetarian', 'vegan', 'jain', 'dairy_free', 'gluten_free', 'indian']],
  ['coconut-chia', 'Coconut Chia Cup', ['coconut milk 120ml', 'chia seeds 20g', 'berries 60g'], 280, 7, 20, 18, ['vegetarian', 'vegan', 'dairy_free', 'gluten_free']],
];

const addOnMeals = [
  ...safeBreakfastAddOns.map(([id, name, ingredients, calories, protein, carbs, fats, tags, allergens = []]) =>
    createMeal({ id, name, mealType: 'breakfast', dietType: tags.includes('jain') ? 'jain vegan' : 'vegan', ingredients, recipeSteps: ['Prepare ingredients.', 'Cook or mix until ready.', 'Serve fresh.'], calories, protein, carbs, fats, tags, allergens, avoidTags: [] })),
  ...safeLunchDinnerAddOns.map(([id, name, mealType, ingredients, calories, protein, carbs, fats, tags, allergens = []]) =>
    createMeal({ id, name, mealType, dietType: tags.includes('non_veg') ? 'non_veg' : tags.includes('eggetarian') ? 'eggetarian' : tags.includes('jain') ? 'jain vegan' : 'vegan', ingredients, recipeSteps: ['Prep ingredients.', 'Cook with spices until done.', 'Serve warm.'], calories, protein, carbs, fats, tags, allergens, avoidTags: tags.includes('non_veg') || tags.includes('eggetarian') ? ['vegetarian', 'vegan', 'jain'] : [] })),
  ...snackAddOns.map(([id, name, ingredients, calories, protein, carbs, fats, tags, allergens = []]) =>
    createMeal({ id, name, mealType: 'snack', dietType: tags.includes('jain') ? 'jain vegan' : 'vegan', ingredients, recipeSteps: ['Portion ingredients.', 'Mix or roast as needed.', 'Serve.'], calories, protein, carbs, fats, tags, allergens, avoidTags: [] })),
];

const variantMeals = mealSeeds.slice(0, 18).flatMap(([id, name, mealType, dietType, ingredients, recipeSteps, calories, protein, carbs, fats, tags, allergens = [], avoidTags = []]) => ([
  createMeal({ id, name, mealType, dietType, ingredients, recipeSteps, calories, protein, carbs, fats, tags, allergens, avoidTags }),
  createMeal({
    id: `${id}-lite`,
    name: `${name} Lite`,
    mealType,
    dietType,
    ingredients: ingredients.map((item) => item.replace(/(\d+)g/, (_, n) => `${Math.max(20, Math.round(Number(n) * 0.8))}g`)),
    recipeSteps,
    calories: Math.round(calories * 0.82),
    protein: Math.round(protein * 0.9),
    carbs: Math.round(carbs * 0.8),
    fats: Math.round(fats * 0.75),
    tags: [...new Set([...tags, 'low_fat'])],
    allergens,
    avoidTags,
  }),
]));

export const localMealDatabase = [...variantMeals, ...addOnMeals];
