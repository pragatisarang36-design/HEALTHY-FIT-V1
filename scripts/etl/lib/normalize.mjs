import { KNOWN_CANONICAL_ALIASES } from './constants.mjs';

export const titleCase = (value) =>
  String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export const normalizeName = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const searchKey = (value) => normalizeName(value);

export const canonicalKeyFor = (name) => {
  const normalized = normalizeName(name);
  return KNOWN_CANONICAL_ALIASES.get(normalized) || normalized;
};

export const splitAliases = (value) =>
  String(value || '')
    .split(/[|;,]/)
    .map((item) => item.trim())
    .filter(Boolean);

export const findColumn = (row, aliases) => {
  const lowerKeys = new Map(Object.keys(row).map((key) => [key.toLowerCase().trim(), key]));
  for (const alias of aliases) {
    const key = lowerKeys.get(alias);
    if (key) return row[key];
  }
  return '';
};

export const findColumnKey = (row, aliases) => {
  const lowerKeys = new Map(Object.keys(row).map((key) => [key.toLowerCase().trim(), key]));
  for (const alias of aliases) {
    const key = lowerKeys.get(alias);
    if (key) return key;
  }
  return '';
};

export const getField = (row, fieldName, columnAliases) => {
  const aliases = columnAliases[fieldName] || [fieldName];
  return findColumn(row, aliases);
};

export const stripBrandPrefix = (name, brand) => {
  if (!brand) return name;
  const pattern = new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i');
  return String(name || '').replace(pattern, '').trim() || name;
};
