import { AI_FALLBACK_MESSAGE, groqVisionModel, requestAIJson, requestAIText } from '@/services/aiClient';

const FITNESS_SYSTEM_PROMPT =
  'You are Healthy Fit AI, a careful fitness, nutrition, and wellness assistant. Be practical, concise, and safe. Return only valid JSON when JSON is requested.';

const withJsonInstruction = (prompt, schema) =>
  `${prompt}\n\nReturn only valid JSON matching this schema:\n${JSON.stringify(schema)}`;

const requestContext = () => {
  const now = new Date();
  return [
    `Current date: ${now.toLocaleDateString('en-CA')}`,
    `Request timestamp: ${now.toISOString()}`,
    `Random variation seed: ${Math.random().toString(36).slice(2)}`,
    'Never repeat previous outputs. Do not reuse the same meals, workouts, insight titles, wording, structure, or ordering from an earlier request.',
    'This request must be treated as uncached and newly generated.',
  ].join('\n');
};

const withVariation = (prompt) => `${requestContext()}\n\n${prompt}`;

const requireAIJson = (result, featureName) => {
  if (result.ok && result.data) return result.data;
  throw new Error(`${featureName} could not be generated right now. Please try again.`);
};

export async function generateAIResponse(prompt) {
  const result = await requestAIText({
    messages: [
      { role: 'system', content: FITNESS_SYSTEM_PROMPT },
      { role: 'user', content: withVariation(prompt) },
    ],
  });

  return result.ok && result.text ? result.text : AI_FALLBACK_MESSAGE;
}

export async function generateInsights(data) {
  const schema = {
    type: 'object',
    properties: {
      insights: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            message: { type: 'string' },
            metric_value: { type: 'string' },
            type: { type: 'string' },
          },
        },
      },
    },
  };

  const prompt = `Generate 4-5 personalized fitness insight cards for this user. Use SECOND PERSON ("you") ONLY. Be motivating and specific. No textbook paragraphs - short, punchy insights.

User: ${data.name}, Goal: ${data.goal}, Weight: ${data.weight}kg, Target: ${data.targetWeight || 'not set'}kg

Last 7 days data:
- Total calories consumed: ${data.totalCalories} kcal
- Total protein: ${data.totalProtein}g
- Calories burned: ${data.totalBurned} kcal
- Water: ${data.totalWaterGlasses} glasses (goal: ${data.waterGoalGlasses} glasses/day)
- Workout days: ${data.workoutDays}/7
- Latest weight: ${data.latestWeight}kg

Rules:
- Never repeat previous outputs
- Vary the insight angle, title, metric choice, and wording on every request
- Each insight should have: title (short), message (2-3 sentences max, use "you"), metric_value (key number), type (calorie/protein/hydration/workout/general).`;

  try {
    const result = await requestAIJson({
      messages: [
        { role: 'system', content: FITNESS_SYSTEM_PROMPT },
        { role: 'user', content: withVariation(withJsonInstruction(prompt, schema)) },
      ],
    });

    return requireAIJson(result, 'Insights');
  } catch (error) {
    console.error('Insights generation failed:', error);
    throw error;
  }
}

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read image file'));
    reader.readAsDataURL(file);
  });

export async function analyzeFoodImage(file) {
  if (!file) return null;

  const schema = foodIdentificationSchema();
  const dataUrl = await fileToDataUrl(file);
  const prompt = `Decide whether this image contains real visible food intended for eating.
If the image is not food, mostly not food, too blurry, a person/object/screenshot/document/packaging-only image, or you are unsure, return is_food false, confidence below 0.5, an empty ingredients array, and do not invent food.
If it is food, identify the visible food and return food identity plus explicit portion reasoning.
Do not estimate calories, protein, carbs, or fat.
food_name should be a clean descriptive meal name.
quantity should describe the whole visible portion, for example "1 plate" or "2 pieces".
meal_size_estimate_g should estimate the total visible edible food weight, not plate/container weight.
Use conservative meal_size_estimate_g ranges: small snack 100-250g, light plate 250-450g, normal plate 450-700g, large plate 700-1000g.
container_type should be a short label like "plate", "bowl", "box", "cup", or "unknown".
ingredients should list visible or likely components separately with rough quantities only.
Include oils, butter, sauces, toppings, sides, drinks, and condiments only if visible or strongly implied.
For each ingredient, estimate visible_share_percent as its share of the visible edible meal by weight, not pure 2D area.
visible_share_percent values should usually add up to about 100 across visible ingredients.
For each ingredient, set estimated_grams = meal_size_estimate_g * visible_share_percent / 100, adjusted for food density and known units.
Return ingredient quantities in grams only, for example "50g", "100g", "150g", matching estimated_grams.
For liquid or fat ingredients such as oil, ghee, butter, milk, sauce, or dressing, use tbsp/tsp/ml/l instead of grams.
For thick spreads such as peanut butter, almond butter, nut butter, jam, or honey, use tbsp/tsp instead of grams, and default to 1-2 tbsp (about 16-32g) unless the image clearly shows a much larger amount.
Do not use cups, handfuls, slices, plates, bowls, or pieces for ingredient quantities.
Estimate only the visible edible portion on the plate, not the weight of the whole fruit, whole packet, or whole ingredient.
If an item appears sliced, chopped, used as garnish, or only partly visible, use the sliced visible amount.
For boiled eggs cut into halves, count halves as fractions of whole eggs: 2 visible halves = 1 egg, about 50g; 4 visible halves = 2 eggs, about 100g. Do not count each half as a full egg.
If an egg is cut in half, name it "boiled egg" and set quantity by the whole eggs represented by the halves.
For mixed plates with many small items, prefer small conservative estimates like "20g", "30g", "50g", "70g", or "90g".
Do not assign 150g+ to a single fruit or vegetable unless it visibly occupies a large part of the plate.
If quantity is uncertain, choose the lower reasonable visible estimate.
Use confidence "high", "medium", or "low" for each ingredient portion.

Optional reference-object detection for future portion estimation:
Also check whether the photo contains a supported scale reference object near the food. This is optional metadata only and must not change food identification.
Supported reference objects, in priority order:
1. Standard card: any card with the standard card outline/shape, including debit, credit, ID, loyalty, gym membership, or similar cards. Use only the outline/shape, never read or report printed card details.
2. Coin: current Indian 1, 2, 5, or 10 rupee coin.
3. A4 or Letter paper sheet.
If a supported reference is clearly visible, set reference_detected true, reference_type to "card", "coin", or "paper", and reference_subtype as follows:
- card: reference_subtype null.
- coin: "1_rupee", "2_rupee", "5_rupee", "10_rupee", or "unknown".
- paper: "a4", "letter", or "unknown".
If no supported reference object is clearly visible, set reference_detected false and reference_type/reference_subtype null.
Only when reference_detected is true, include area_ratio_to_reference and thickness_bucket for each ingredient:
- area_ratio_to_reference: estimated visible 2D area of that ingredient divided by the visible 2D area of the reference object.
- thickness_bucket: "thin", "medium", or "thick".
If reference_detected is false, these ingredient reference fields may be null or absent.`;

  try {
    const result = await requestAIJson({
      model: groqVisionModel(),
      messages: [
        { role: 'system', content: FITNESS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: withVariation(withJsonInstruction(prompt, schema)) },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    if (!result.ok) {
      throw new Error(result.message || AI_FALLBACK_MESSAGE);
    }

    return result.data;
  } catch (error) {
    console.error('Food image analysis failed:', error);
    throw error;
  }
}

export async function estimateNutrition(foodName, quantity) {
  const schema = nutritionSchema();
  const prompt = `Estimate the nutritional values for the following food item accurately.
Food: "${foodName}"
Quantity: "${quantity}"
Return realistic values. calories must be > 0. protein, carbs, fats must be >= 0.
food_name should be a clean descriptive name of the food.
Also return ingredients: the main ingredients you assumed while estimating macros, each with quantity and macro contribution.
Parse the user's natural language exactly. If they write "toast with 1 tbsp oil", count toast and 1 tbsp oil separately. Do the same for butter, ghee, sauces, toppings, spreads, sugar, milk, sides, and quantities embedded in the text.
You may correct obvious spelling mistakes, but do not change the ingredient identity, serving count, portion size, or quantity from what the user wrote. Do not add quantities to the user's food label.
The top-level calories/protein/carbs/fats must equal the sum of the returned ingredient macro contributions.
If oil, ghee, butter, or another fat is mentioned, include it as its own ingredient and add its calories/fat to the total. The version with added fat must never be lower calorie than the same food without it.
Never repeat previous outputs.`;

  try {
    const result = await requestAIJson({
      messages: [
        { role: 'system', content: FITNESS_SYSTEM_PROMPT },
        { role: 'user', content: withVariation(withJsonInstruction(prompt, schema)) },
      ],
    });

    return result.ok ? result.data : null;
  } catch (error) {
    console.error('Nutrition estimate failed:', error);
    return null;
  }
}

export async function retryEstimateNutrition(foodName, quantity) {
  const schema = nutritionSchema();
  const prompt = `Give nutritional info for: "${quantity} of ${foodName}". Parse every natural-language component separately, including oils, butter, ghee, sauces, toppings, spreads, sugar, milk, sides, and quantities embedded in the text. You may correct obvious spelling mistakes, but do not change the ingredient identity, serving count, portion size, or quantity from what the user wrote. Do not add quantities to the user's food label. If oil, ghee, butter, or another fat is mentioned, include it as its own ingredient and add its calories/fat to the total. The version with added fat must never be lower calorie than the same food without it. All values must be realistic positive numbers. calories > 0 is mandatory. Include ingredients with quantities and macro contribution. The top-level macros must equal the sum of ingredient macro contributions. Never repeat previous outputs.`;

  try {
    const result = await requestAIJson({
      messages: [
        { role: 'system', content: FITNESS_SYSTEM_PROMPT },
        { role: 'user', content: withVariation(withJsonInstruction(prompt, schema)) },
      ],
    });

    return result.ok ? result.data : null;
  } catch (error) {
    console.error('Nutrition retry failed:', error);
    return null;
  }
}

const nutritionSchema = () => ({
  type: 'object',
  properties: {
    food_name: { type: 'string' },
    calories: { type: 'number' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fats: { type: 'number' },
    quantity: { type: 'string' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'string' },
          calories: { type: 'number' },
          protein: { type: 'number' },
          carbs: { type: 'number' },
          fats: { type: 'number' },
        },
      },
    },
  },
});

const foodIdentificationSchema = () => ({
  type: 'object',
  properties: {
    is_food: { type: 'boolean' },
    confidence: { type: 'number' },
    reason: { type: 'string' },
    food_name: { type: 'string' },
    quantity: { type: 'string' },
    meal_size_estimate_g: { type: 'number' },
    container_type: { type: 'string' },
    reference_detected: { type: 'boolean' },
    reference_type: { type: ['string', 'null'], enum: ['card', 'coin', 'paper', null] },
    reference_subtype: {
      type: ['string', 'null'],
      enum: ['1_rupee', '2_rupee', '5_rupee', '10_rupee', 'unknown', 'a4', 'letter', null],
    },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'string' },
          visible_share_percent: { type: 'number' },
          estimated_grams: { type: 'number' },
          confidence: { type: 'string' },
          area_ratio_to_reference: { type: ['number', 'null'] },
          thickness_bucket: { type: ['string', 'null'], enum: ['thin', 'medium', 'thick', null] },
        },
      },
    },
  },
});
