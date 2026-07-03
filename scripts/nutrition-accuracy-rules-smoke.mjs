import fs from 'node:fs';
import path from 'node:path';
import { resolveStatePolicy } from '../src/services/statePolicy.js';
import {
  detectDietaryModifiers,
  ingredientAllowedByModifiers,
  mergeTemplateItems,
  profileKcalStatus,
  scoreTemplateCandidate,
} from '../src/services/nutritionAccuracyRules.js';

const assertions = [];

const check = (name, pass, details = {}) => {
  assertions.push({ name, pass: Boolean(pass), details });
  if (!pass) {
    throw new Error(`${name}: ${JSON.stringify(details)}`);
  }
};

const preparedCategories = [
  'grains',
  'rice dishes',
  'pasta/noodles',
  'legumes',
  'soups/stews',
  'curries/gravies',
  'vegetables/sabzi',
  'tubers',
  'meat/seafood',
  'eggs',
  'cereals/oats',
  'mixed recipes',
];

for (const category of preparedCategories) {
  const policy = resolveStatePolicy({
    input: category,
    requestedStateKey: 'unknown',
    category,
    context: 'plated meal',
  });
  check(`prepared context prefers cooked for ${category}`, policy.effectiveStateKey === 'cooked', policy);
}

const explicitRawPolicy = resolveStatePolicy({
  input: 'dry rice powder',
  requestedStateKey: 'dry',
  category: 'grains',
  context: 'plated meal',
});
check('explicit raw/dry/powder terms keep raw profile eligible', explicitRawPolicy.explicitRaw && explicitRawPolicy.effectiveStateKey === 'dry', explicitRawPolicy);

check(
  'prepared rice rejects dry density',
  profileKcalStatus({ aliases: ['rice'], category: 'rice', calories: 365 }, {
    category: 'rice',
    context: 'plated meal',
    statePolicy: { preparedContext: true, explicitRaw: false, policyCategory: 'rice_dish' },
  }).status === 'fail'
);

check(
  'prepared rice accepts cooked density',
  profileKcalStatus({ aliases: ['rice'], category: 'rice', calories: 130 }, {
    category: 'rice',
    context: 'plated meal',
    statePolicy: { preparedContext: true, explicitRaw: false, policyCategory: 'rice_dish' },
  }).status !== 'fail'
);

const merged = mergeTemplateItems([
  { ingredient_name: 'oil', percentage: 3, sort_order: 2, required: true },
  { ingredient_name: 'cooking oil', percentage: 2, sort_order: 3, required: true },
  { ingredient_name: 'onion chopped', percentage: 10, sort_order: 1, required: true },
]);
check('duplicate normalized template ingredients merge', merged.length === 2 && merged.find((item) => item.ingredient_search_key === 'oil')?.percentage === 5, merged);

const veg = detectDietaryModifiers('vegetable noodles');
const vegan = detectDietaryModifiers('vegan fried rice');
check('vegetarian excludes chicken and egg', !ingredientAllowedByModifiers('chicken', veg) && !ingredientAllowedByModifiers('egg', veg), veg);
check('vegan excludes paneer and dairy', !ingredientAllowedByModifiers('paneer', vegan) && !ingredientAllowedByModifiers('milk', vegan), vegan);

const genericNoodles = {
  canonical_name: 'noodles',
  search_key: 'noodles',
  confidence: 0.8,
  recipe_count: 1000,
  items: [{ ingredient_name: 'noodles' }, { ingredient_name: 'chicken' }],
};
const vegetableNoodles = {
  canonical_name: 'vegetable noodles',
  search_key: 'vegetable noodles',
  confidence: 0.8,
  recipe_count: 500,
  items: [{ ingredient_name: 'noodles' }, { ingredient_name: 'mixed vegetables' }],
};
check(
  'specific vegetarian template outranks incompatible generic template',
  scoreTemplateCandidate(vegetableNoodles, 'vegetable noodles').score > scoreTemplateCandidate(genericNoodles, 'vegetable noodles').score
);

const genericCurry = {
  canonical_name: 'curry',
  search_key: 'curry',
  confidence: 0.8,
  recipe_count: 1000,
  items: [{ ingredient_name: 'onion' }, { ingredient_name: 'tomato' }],
};
const chickenCurry = {
  canonical_name: 'chicken curry',
  search_key: 'chicken curry',
  confidence: 0.8,
  recipe_count: 500,
  items: [{ ingredient_name: 'chicken' }, { ingredient_name: 'onion' }],
};
check(
  'modifier-specific template outranks generic template',
  scoreTemplateCandidate(chickenCurry, 'chicken curry').score > scoreTemplateCandidate(genericCurry, 'chicken curry').score
);

const report = {
  generated_at: new Date().toISOString(),
  assertions,
  passed: assertions.filter((entry) => entry.pass).length,
  failed: assertions.filter((entry) => !entry.pass).length,
};

const reportDir = path.resolve('reports', 'production_readiness');
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(
  path.join(reportDir, 'nutrition_accuracy_rules_smoke.json'),
  `${JSON.stringify(report, null, 2)}\n`
);

console.log(`nutrition accuracy smoke checks passed: ${report.passed}`);
