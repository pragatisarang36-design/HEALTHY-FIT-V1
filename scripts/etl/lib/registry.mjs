import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const loadDatasetRegistry = (registryPath) => {
  const path = registryPath || join(__dirname, '..', 'dataset-registry.json');
  return JSON.parse(readFileSync(path, 'utf8'));
};

export const resolveDatasetConfig = (registry, datasetKey) => {
  const config = registry.datasets[datasetKey];
  if (!config) throw new Error(`Unknown dataset key: ${datasetKey}`);
  return config;
};

export const listEnabledDatasets = (registry) =>
  Object.entries(registry.datasets)
    .filter(([, config]) => config.enabled !== false)
    .map(([key, config]) => ({ key, ...config }));
