import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { DATA_ROOT, resolveFromDataRoot } from './etl/lib/paths.mjs';

const ROOT = DATA_ROOT;
const REGISTRY_PATH = resolveFromDataRoot('import_logs', 'dataset_import_registry.json');
const REPORT_PATH = resolveFromDataRoot('import_logs', 'dataset_import_audit.json');
const RAW_ROOTS = [
  { dir: resolveFromDataRoot('raw_datasets'), kind: 'nutrition' },
  { dir: resolveFromDataRoot('raw_datasets', 'recipes'), kind: 'recipe' },
];
const DATASET_EXTENSIONS = new Set(['.csv', '.json', '.xlsx', '.gz', '.tsv']);

const normalizePath = (filePath) => relative(ROOT, filePath).replace(/\\/g, '/');

const sha256 = (filePath) => createHash('sha256').update(readFileSync(filePath)).digest('hex');

const listFiles = (dir, kind) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(dir, entry.name);
    const stats = statSync(filePath);
    if (stats.isDirectory()) {
      if (kind === 'nutrition' && entry.name === 'recipes') return [];
      return listFiles(filePath, kind);
    }
    if (!stats.isFile()) return [];
    const extension = extname(entry.name).toLowerCase();
    if (!DATASET_EXTENSIONS.has(extension)) return [];
    return [{
      dataset_name: entry.name.replace(extension, ''),
      file_path: normalizePath(filePath),
      file_type: extension.replace('.', ''),
      kind,
      size_bytes: stats.size,
      modified_at: stats.mtime.toISOString(),
      content_hash: sha256(filePath),
    }];
  });
};

const readJson = (filePath, fallback) => {
  try {
    return existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
};

const previouslySeenFromLogs = () => {
  const seen = new Set();
  const nutritionSummary = readJson(resolveFromDataRoot('import_logs', 'summary.json'), {});
  for (const dataset of nutritionSummary.datasets || []) {
    if (dataset.file) seen.add(`raw_datasets/${dataset.file}`);
  }

  const recipeSummary = readJson(resolveFromDataRoot('import_logs', 'recipes', 'summary.json'), {});
  if (Number(recipeSummary.input_files || 0) > 0 && existsSync(resolveFromDataRoot('raw_datasets', 'recipes'))) {
    for (const entry of readdirSync(resolveFromDataRoot('raw_datasets', 'recipes'))) {
      if (DATASET_EXTENSIONS.has(extname(entry).toLowerCase())) {
        seen.add(`raw_datasets/recipes/${entry}`);
      }
    }
  }

  return seen;
};

const previousRegistry = readJson(REGISTRY_PATH, { datasets: {} });
const previousDatasets = previousRegistry.datasets || {};
const logSeen = previouslySeenFromLogs();
const found = RAW_ROOTS.flatMap((root) => listFiles(root.dir, root.kind))
  .filter((dataset, index, datasets) => datasets.findIndex((entry) => entry.file_path === dataset.file_path) === index)
  .sort((a, b) => a.file_path.localeCompare(b.file_path));

const audited = found.map((dataset) => {
  const previous = previousDatasets[dataset.file_path];
  const importedByExistingLog = logSeen.has(dataset.file_path);
  let status = 'new';
  if (previous?.content_hash === dataset.content_hash) {
    status = 'skipped_unchanged';
  } else if (previous) {
    status = 'updated_changed';
  } else if (importedByExistingLog) {
    status = 'skipped_unchanged';
  }

  return {
    ...dataset,
    previous_hash: previous?.content_hash || null,
    status,
    import_decision: status === 'new' || status === 'updated_changed' ? 'import' : 'skip',
  };
});

const now = new Date().toISOString();
const nextRegistry = {
  version: 1,
  generated_at: now,
  datasets: Object.fromEntries(audited.map((dataset) => [
    dataset.file_path,
    {
      dataset_name: dataset.dataset_name,
      file_path: dataset.file_path,
      file_type: dataset.file_type,
      kind: dataset.kind,
      size_bytes: dataset.size_bytes,
      modified_at: dataset.modified_at,
      content_hash: dataset.content_hash,
      last_seen_at: now,
      last_status: dataset.status,
    },
  ])),
};

const summary = {
  generated_at: now,
  totals: {
    found: audited.length,
    imported: audited.filter((dataset) => dataset.import_decision === 'import').length,
    skipped_unchanged: audited.filter((dataset) => dataset.status === 'skipped_unchanged').length,
    updated_changed: audited.filter((dataset) => dataset.status === 'updated_changed').length,
    failed: 0,
  },
  datasets: audited,
};

mkdirSync(resolveFromDataRoot('import_logs'), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
writeFileSync(REGISTRY_PATH, `${JSON.stringify(nextRegistry, null, 2)}\n`, 'utf8');

console.log('Raw dataset audit');
console.log(`Found: ${summary.totals.found}`);
console.log(`Import: ${summary.totals.imported}`);
console.log(`Skipped unchanged: ${summary.totals.skipped_unchanged}`);
console.log(`Updated changed: ${summary.totals.updated_changed}`);
console.log(`Failed: ${summary.totals.failed}`);
console.table(audited.map((dataset) => ({
  dataset: dataset.dataset_name,
  path: dataset.file_path,
  type: dataset.file_type,
  size: dataset.size_bytes,
  modified: dataset.modified_at,
  hash: dataset.content_hash.slice(0, 12),
  status: dataset.status,
})));
