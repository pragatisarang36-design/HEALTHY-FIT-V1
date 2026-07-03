import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWN_CANONICAL_ALIASES } from './constants.mjs';
import { canonicalKeyFor, normalizeName, searchKey, titleCase } from './normalize.mjs';
import { inferFoodState } from './states.mjs';

const SPICE_KEYWORDS = new Set([
  'salt', 'pepper', 'turmeric', 'cumin', 'coriander', 'garam masala', 'chili powder',
  'red chili', 'mustard seed', 'curry leaves', 'hing', 'asafoetida', 'cardamom',
  'cinnamon', 'clove', 'cloves', 'bay leaf', 'fenugreek', 'ajwain', 'kasuri methi',
]);

const GARNISH_KEYWORDS = new Set([
  'cilantro', 'coriander leaves', 'mint', 'lemon juice', 'lime juice', 'parsley',
]);

export const UNIT_TO_GRAMS = new Map([
  ['g', 1],
  ['gram', 1],
  ['grams', 1],
  ['kg', 1000],
  ['ml', 1],
  ['l', 1000],
  ['cup', 240],
  ['cups', 240],
  ['tbsp', 15],
  ['tablespoon', 15],
  ['tablespoons', 15],
  ['tsp', 5],
  ['teaspoon', 5],
  ['teaspoons', 5],
  ['oz', 28.35],
  ['ounce', 28.35],
  ['ounces', 28.35],
  ['lb', 453.6],
  ['pound', 453.6],
  ['pounds', 453.6],
  ['piece', 50],
  ['pieces', 50],
  ['slice', 30],
  ['slices', 30],
  ['clove', 3],
  ['cloves', 3],
  ['pinch', 0.5],
  ['handful', 30],
  ['bowl', 200],
  ['katori', 150],
  ['plate', 350],
]);

export class IngredientResolver {
  constructor(options = {}) {
    this.foodCatalog = new Map();
    this.unresolved = new Map();
    if (options.foodsCsvPath && existsSync(options.foodsCsvPath)) {
      this.loadFoodCatalog(options.foodsCsvPath);
    }
  }

  loadFoodCatalog(filePath) {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const headers = lines.shift()?.split(',').map((h) => h.trim()) || [];
    for (const line of lines) {
      const values = line.split(',');
      const row = Object.fromEntries(headers.map((header, index) => [header, values[index]?.replace(/^"|"$/g, '') ?? '']));
      const name = row.canonical_name || row.food_name || row.name;
      if (!name) continue;
      const key = searchKey(name);
      this.foodCatalog.set(key, { canonicalName: name, searchKey: key });
    }
  }

  resolve(rawName) {
    const trimmed = String(rawName || '').trim();
    if (!trimmed) return null;

    const { stateKey, baseName } = inferFoodState(trimmed);
    const canonicalKey = canonicalKeyFor(baseName);
    const canonicalName = titleCase(canonicalKey);
    const ingredientSearchKey = searchKey(canonicalName);

    const catalogMatch = this.foodCatalog.get(ingredientSearchKey)
      || this.foodCatalog.get(searchKey(baseName))
      || this.foodCatalog.get(canonicalKey);

    const isSpice = SPICE_KEYWORDS.has(normalizeName(baseName));
    const isGarnish = GARNISH_KEYWORDS.has(normalizeName(baseName));

    const resolved = {
      rawName: trimmed,
      ingredientName: canonicalName,
      ingredientSearchKey,
      ingredientStateKey: stateKey,
      canonicalFoodId: catalogMatch ? catalogMatch.searchKey : null,
      resolved: Boolean(catalogMatch || KNOWN_CANONICAL_ALIASES.has(normalizeName(baseName))),
      isSpice,
      isGarnish,
      weight: isSpice ? 0.5 : isGarnish ? 1 : 1,
    };

    if (!resolved.resolved) {
      const count = this.unresolved.get(ingredientSearchKey) || 0;
      this.unresolved.set(ingredientSearchKey, count + 1);
    }

    return resolved;
  }

  parseAmountToGrams(amount, unit) {
    const numericAmount = Number(String(amount || '').replace(/,/g, '').trim());
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return null;
    const unitKey = String(unit || 'g').toLowerCase().trim();
    const multiplier = UNIT_TO_GRAMS.get(unitKey) ?? 50;
    return numericAmount * multiplier;
  }

  parseTextIngredient(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;

    const match = trimmed.match(/^([\d./\s]+)?\s*(cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|g|gram|grams|kg|oz|ounce|ounces|lb|pound|pounds|ml|l|piece|pieces|slice|slices|clove|cloves|pinch|handful|bowl|katori|plate)?\s*(.+)$/i);
    if (!match) {
      return { name: trimmed, grams: null };
    }

    const [, amountRaw, unitRaw, nameRaw] = match;
    const grams = amountRaw
      ? this.parseAmountToGrams(amountRaw.trim(), unitRaw || 'piece')
      : null;

    return { name: nameRaw?.trim() || trimmed, grams };
  }

  getUnresolvedStats() {
    return [...this.unresolved.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([searchKey, count]) => ({ searchKey, count }));
  }
}
