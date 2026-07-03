import { canonicalKeyFor, normalizeName, titleCase } from './normalize.mjs';

export const STATE_PATTERNS = [
  { key: 'raw', name: 'Raw', pattern: /\b(raw|uncooked|fresh)\b/i, strip: true },
  { key: 'cooked', name: 'Cooked', pattern: /\b(cooked|prepared)\b/i, strip: true },
  { key: 'boiled', name: 'Boiled', pattern: /\b(boiled|simmered|poached)\b/i, strip: true },
  { key: 'grilled', name: 'Grilled', pattern: /\b(grilled|barbecue|bbq)\b/i, strip: true },
  { key: 'roasted', name: 'Roasted', pattern: /\b(roasted|roast)\b/i, strip: true },
  { key: 'fried', name: 'Fried', pattern: /\b(fried|deep fried|pan fried|sauteed|sautéed)\b/i, strip: true },
  { key: 'steamed', name: 'Steamed', pattern: /\b(steamed|steam)\b/i, strip: true },
  { key: 'smoked', name: 'Smoked', pattern: /\b(smoked|smoke)\b/i, strip: true },
  { key: 'canned', name: 'Canned', pattern: /\b(canned|tinned|can)\b/i, strip: true },
  { key: 'frozen', name: 'Frozen', pattern: /\b(frozen|freeze)\b/i, strip: true },
  { key: 'dry', name: 'Dry', pattern: /\b(dry|dried|dehydrated)\b/i, strip: true },
  { key: 'soaked', name: 'Soaked', pattern: /\b(soaked|soak)\b/i, strip: true },
  { key: 'mashed', name: 'Mashed', pattern: /\b(mashed|pureed|purée)\b/i, strip: true },
  { key: 'baked', name: 'Baked', pattern: /\b(baked|bake)\b/i, strip: true },
];

export const DEFAULT_STATE_BY_FOOD = new Map([
  ['white rice', 'cooked'],
  ['chapati', 'cooked'],
  ['idli', 'steamed'],
  ['dosa', 'fried'],
  ['dal rice', 'cooked'],
  ['sambar', 'boiled'],
  ['poha', 'cooked'],
  ['chicken curry', 'cooked'],
  ['bhindi sabzi', 'fried'],
]);

export const inferFoodState = (rawName, explicitStateKey = '') => {
  const explicit = String(explicitStateKey || '').trim().toLowerCase();
  if (explicit && explicit !== 'unknown') {
    const match = STATE_PATTERNS.find((state) => state.key === explicit);
    return {
      stateKey: explicit,
      stateName: match?.name || titleCase(explicit),
      baseName: rawName,
    };
  }

  let baseName = String(rawName || '').trim();
  let detected = null;

  for (const state of STATE_PATTERNS) {
    if (state.pattern.test(baseName)) {
      detected = state;
      if (state.strip) {
        baseName = baseName.replace(state.pattern, ' ').replace(/\s+/g, ' ').trim();
      }
      break;
    }
  }

  if (detected) {
    return {
      stateKey: detected.key,
      stateName: detected.name,
      baseName: baseName || rawName,
    };
  }

  const normalizedBase = canonicalKeyFor(baseName);
  const defaultState = DEFAULT_STATE_BY_FOOD.get(normalizedBase);
  if (defaultState) {
    const match = STATE_PATTERNS.find((state) => state.key === defaultState);
    return {
      stateKey: defaultState,
      stateName: match?.name || titleCase(defaultState),
      baseName,
    };
  }

  return {
    stateKey: 'unknown',
    stateName: 'Unknown',
    baseName,
  };
};

export const mergeKey = (canonicalKey, stateKey) => `${canonicalKey}|${stateKey || 'unknown'}`;
