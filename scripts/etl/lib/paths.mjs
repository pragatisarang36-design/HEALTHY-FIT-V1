import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
export const DATA_ROOT = resolve(process.env.DATA_ROOT || PROJECT_ROOT);

export const resolveFromDataRoot = (...segments) => {
  const [first, ...rest] = segments;
  if (first && isAbsolute(first)) {
    return resolve(first, ...rest);
  }
  return resolve(DATA_ROOT, first || '.', ...rest);
};

export const resolveFromProjectRoot = (...segments) => {
  const [first, ...rest] = segments;
  if (first && isAbsolute(first)) {
    return resolve(first, ...rest);
  }
  return resolve(PROJECT_ROOT, first || '.', ...rest);
};

export const displayPath = (filePath) => {
  const absolute = resolve(filePath);
  const root = existsSync(DATA_ROOT) ? realpathSync(DATA_ROOT) : DATA_ROOT;
  const relativePath = relative(root, absolute);
  if (!relativePath || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    return relativePath.replace(/\\/g, '/') || '.';
  }
  return absolute;
};

export const toDataRelative = (filePath) => displayPath(filePath);
