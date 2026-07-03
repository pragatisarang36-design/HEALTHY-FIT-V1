import { resolveSource } from '../constants.mjs';
import { canonicalKeyFor, normalizeName, searchKey, splitAliases, titleCase } from '../normalize.mjs';
import { inferFoodState, mergeKey } from '../states.mjs';
import { confidenceForSource, isValidNutrition, kcalFromIfctEnergy, toNumber } from '../nutrition.mjs';

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      if (row.some((field) => field !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
};

const languageAliases = (lang) =>
  String(lang || '')
    .split(';')
    .map((part) => part.trim().replace(/^[A-Za-z]{1,8}\.\s*/, '').trim())
    .filter((part) => part.length >= 3 && part.length <= 80);

export async function loadIfctRecords(sourceUrl) {
  const source = resolveSource('ifct');
  const url = sourceUrl || 'https://raw.githubusercontent.com/nodef/ifct2017/main/compositions/index.csv';

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download IFCT CSV: ${response.status} ${response.statusText}`);
  }

  const rows = parseCsv(await response.text());
  const headers = rows.shift();
  const headerIndex = new Map(headers.map((header, index) => [header.trim(), index]));
  const valueOf = (row, key) => row[headerIndex.get(key)] ?? '';

  const records = [];
  for (const row of rows) {
    const code = valueOf(row, 'code').replace(/^"|"$/g, '').trim();
    const name = valueOf(row, 'name').trim();
    if (!code || !name) continue;

    const nutrition = {
      calories_per_100g: kcalFromIfctEnergy(valueOf(row, 'enerc')),
      protein_per_100g: toNumber(valueOf(row, 'protcnt')) ?? 0,
      carbs_per_100g: toNumber(valueOf(row, 'choavldf')) ?? 0,
      fat_per_100g: toNumber(valueOf(row, 'fatce')) ?? 0,
      fiber_per_100g: toNumber(valueOf(row, 'fibtg')),
      water_per_100g: toNumber(valueOf(row, 'water')),
    };

    if (!isValidNutrition(nutrition)) continue;

    const { stateKey, stateName, baseName } = inferFoodState(name);
    const canonicalKey = canonicalKeyFor(baseName);
    const canonicalName = titleCase(canonicalKey);
    const aliasTexts = [name, ...languageAliases(valueOf(row, 'lang'))];
    const aliases = [...new Set(aliasTexts)].map((text) => ({
      text,
      searchKey: searchKey(text),
      language: 'multi',
      region: 'india',
    }));

    records.push({
      sourceKey: source.sourceKey,
      sourceName: source.sourceName,
      sourcePriority: source.priority,
      externalId: code,
      rawName: name,
      canonicalName,
      canonicalKey,
      searchKey: searchKey(canonicalName),
      stateKey,
      stateName,
      mergeKey: mergeKey(canonicalKey, stateKey),
      category: valueOf(row, 'grup') || 'ifct',
      cuisine: 'indian',
      confidence: confidenceForSource(source.priority),
      servingName: 'serving',
      servingGrams: 100,
      aliases,
      recipeTemplate: null,
      recipeItems: [],
      rawRecord: Object.fromEntries(headers.map((header) => [header, valueOf(row, header)])),
      isBranded: false,
      ...nutrition,
    });
  }

  return records;
}

export function loadIfctFromCsvContent(content) {
  const source = resolveSource('ifct');
  const rows = parseCsv(content);
  const headers = rows.shift();
  const headerIndex = new Map(headers.map((header, index) => [header.trim(), index]));
  const valueOf = (row, key) => row[headerIndex.get(key)] ?? '';

  const records = [];
  for (const row of rows) {
    const code = valueOf(row, 'code').replace(/^"|"$/g, '').trim();
    const name = valueOf(row, 'name').trim();
    if (!code || !name) continue;

    const nutrition = {
      calories_per_100g: kcalFromIfctEnergy(valueOf(row, 'enerc')),
      protein_per_100g: toNumber(valueOf(row, 'protcnt')) ?? 0,
      carbs_per_100g: toNumber(valueOf(row, 'choavldf')) ?? 0,
      fat_per_100g: toNumber(valueOf(row, 'fatce')) ?? 0,
      fiber_per_100g: toNumber(valueOf(row, 'fibtg')),
      water_per_100g: toNumber(valueOf(row, 'water')),
    };

    if (!isValidNutrition(nutrition)) continue;

    const { stateKey, stateName, baseName } = inferFoodState(name);
    const canonicalKey = canonicalKeyFor(baseName);
    const canonicalName = titleCase(canonicalKey);

    records.push({
      sourceKey: source.sourceKey,
      sourceName: source.sourceName,
      sourcePriority: source.priority,
      externalId: code,
      rawName: name,
      canonicalName,
      canonicalKey,
      searchKey: searchKey(canonicalName),
      stateKey,
      stateName,
      mergeKey: mergeKey(canonicalKey, stateKey),
      category: valueOf(row, 'grup') || 'ifct',
      cuisine: 'indian',
      confidence: confidenceForSource(source.priority),
      servingName: 'serving',
      servingGrams: 100,
      aliases: [{ text: name, searchKey: searchKey(name), language: 'multi', region: 'india' }],
      recipeTemplate: null,
      recipeItems: [],
      rawRecord: Object.fromEntries(headers.map((header) => [header, valueOf(row, header)])),
      isBranded: false,
      ...nutrition,
    });
  }

  return records;
}
