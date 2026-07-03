import { runMasterEtl } from './pipeline.mjs';
import { loadDatasetRegistry } from './lib/registry.mjs';
import { resolveFromDataRoot } from './lib/paths.mjs';

const adapter = process.argv[2];
const registry = loadDatasetRegistry();

if (adapter === 'usda') {
  registry.datasets.usda_fdc.enabled = true;
  registry.datasets.usda_fdc.inputPath = resolveFromDataRoot(process.argv[3] || 'raw_datasets/usda');
  registry.datasets.usda_fdc.options = {
    maxFoods: Number(process.argv[4] || 50000),
    mode: process.argv[5] || 'common',
  };
} else if (adapter === 'ifct') {
  registry.datasets.ifct_2017.enabled = true;
  if (process.argv[3]) registry.datasets.ifct_2017.sourceUrl = process.argv[3];
} else if (adapter === 'off') {
  registry.datasets.open_food_facts.enabled = true;
  registry.datasets.open_food_facts.inputPath = resolveFromDataRoot(process.argv[3] || 'raw_datasets/openfoodfacts.csv.gz');
  registry.datasets.open_food_facts.options = {
    maxFoods: Number(process.argv[4] || 50000),
    countryFilter: process.argv[5] || 'india',
  };
} else if (adapter === 'fndds') {
  registry.datasets.fndds.enabled = true;
  registry.datasets.fndds.inputPath = resolveFromDataRoot(process.argv[3] || 'raw_datasets/fndds');
  registry.datasets.fndds.options = {
    maxFoods: Number(process.argv[4] || 50000),
    maxIngredientFoods: Number(process.argv[5] || 0),
  };
} else {
  console.error('Usage:');
  console.error('  npm run etl:usda -- <usda-csv-folder> [max-foods] [mode]');
  console.error('  npm run etl:ifct -- [source-url]');
  console.error('  npm run etl:off -- <off-export.csv.gz> [max-foods] [country-filter]');
  console.error('  node scripts/etl/run-adapter.mjs fndds <fndds-folder> [max-foods] [max-ingredient-foods]');
  process.exit(1);
}

Object.entries(registry.datasets).forEach(([key, config]) => {
  if (config.adapter === 'generic') config.enabled = false;
});

const summary = await runMasterEtl({ registry });

console.log(JSON.stringify(summary, null, 2));
