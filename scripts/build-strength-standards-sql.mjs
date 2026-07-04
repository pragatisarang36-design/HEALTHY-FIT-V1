import { createReadStream, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { resolveFromDataRoot, toDataRelative } from './etl/lib/paths.mjs';

const INPUT_ROOT = resolveFromDataRoot('raw_datasets', 'workouts', 'openpowerlifting');
const OUTPUT_DIR = resolveFromDataRoot('supabase', 'imports');
const OUTPUT_PATH = join(OUTPUT_DIR, 'master_strength_standards_load.sql');
const SOURCE_KEY = 'openpowerlifting';
const SOURCE_URL = 'https://openpowerlifting.org/data';
const MIN_SAMPLE_SIZE = Number(process.env.STRENGTH_MIN_SAMPLE_SIZE || 20);
const BODYWEIGHT_BUCKET_KG = Number(process.env.STRENGTH_BODYWEIGHT_BUCKET_KG || 5);

const findCsv = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findCsv(fullPath);
      if (nested) return nested;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) return fullPath;
  }
  return null;
};

const q = (value) => `'${String(value ?? '').replace(/'/g, "''")}'`;
const n = (value) => Number(Number(value).toFixed(2));
const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const normalizeEquipment = (value) => String(value || 'Unknown').trim() || 'Unknown';
const bucketBodyweight = (value) => Math.round(value / BODYWEIGHT_BUCKET_KG) * BODYWEIGHT_BUCKET_KG;
const percentile = (values, p) => {
  if (!values.length) return 0;
  const index = (values.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return values[lower];
  const weight = index - lower;
  return values[lower] * (1 - weight) + values[upper] * weight;
};

const groupValues = new Map();
const addValue = ({ lift, sex, equipment, bodyweightBucket, ageClass, value }) => {
  if (!value || value <= 0 || value > 600) return;
  const normalizedAgeClass = ageClass || 'all';
  const key = [lift, sex, equipment, bodyweightBucket, normalizedAgeClass].join('|');
  if (!groupValues.has(key)) groupValues.set(key, []);
  groupValues.get(key).push(value);
};

const buildUpsert = (row) => `
insert into public.master_strength_standards (
  lift, sex, equipment, bodyweight_bucket_kg, age_class, p50_kg, p75_kg, p90_kg, sample_size, source_key, source_url
)
values (
  ${q(row.lift)},
  ${q(row.sex)},
  ${q(row.equipment)},
  ${n(row.bodyweight_bucket_kg)},
  ${q(row.age_class)},
  ${n(row.p50_kg)},
  ${n(row.p75_kg)},
  ${n(row.p90_kg)},
  ${row.sample_size},
  ${q(SOURCE_KEY)},
  ${q(SOURCE_URL)}
)
on conflict (lift, sex, equipment, bodyweight_bucket_kg, age_class, source_key) do update set
  p50_kg = excluded.p50_kg,
  p75_kg = excluded.p75_kg,
  p90_kg = excluded.p90_kg,
  sample_size = excluded.sample_size,
  source_url = excluded.source_url,
  generated_at = now(),
  updated_at = now();`;

const inputPath = findCsv(INPUT_ROOT);
if (!inputPath || !existsSync(inputPath)) {
  console.error(`Missing OpenPowerlifting CSV under ${toDataRelative(INPUT_ROOT)}`);
  process.exit(1);
}

console.log(`Reading ${toDataRelative(inputPath)}`);

const stream = createReadStream(inputPath, { encoding: 'utf8' });
const rl = createInterface({ input: stream, crlfDelay: Infinity });

let headers = null;
let count = 0;
let usedRows = 0;
for await (const line of rl) {
  if (!headers) {
    headers = line.split(',');
    continue;
  }

  count += 1;
  const cells = line.split(',');
  const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  const sex = String(row.Sex || '').trim();
  if (!['M', 'F'].includes(sex)) continue;
  if (row.Sanctioned && row.Sanctioned !== 'Yes') continue;

  const bodyweight = asNumber(row.BodyweightKg);
  if (!bodyweight || bodyweight < 25 || bodyweight > 250) continue;

  const equipment = normalizeEquipment(row.Equipment);
  const bodyweightBucket = bucketBodyweight(bodyweight);
  const ageClass = String(row.AgeClass || '').trim();
  const lifts = [
    ['squat', asNumber(row.Best3SquatKg)],
    ['bench', asNumber(row.Best3BenchKg)],
    ['deadlift', asNumber(row.Best3DeadliftKg)],
    ['total', asNumber(row.TotalKg)],
  ];

  let added = false;
  for (const [lift, value] of lifts) {
    if (!value || value <= 0) continue;
    addValue({ lift, sex, equipment, bodyweightBucket, ageClass: 'all', value });
    if (ageClass) addValue({ lift, sex, equipment, bodyweightBucket, ageClass, value });
    added = true;
  }
  if (added) usedRows += 1;

  if (count % 500000 === 0) {
    console.log(`Processed ${count.toLocaleString()} rows, usable ${usedRows.toLocaleString()}`);
  }
}

const standards = [];
for (const [key, values] of groupValues.entries()) {
  if (values.length < MIN_SAMPLE_SIZE) continue;
  values.sort((a, b) => a - b);
  const [lift, sex, equipment, bodyweightBucket, ageClass] = key.split('|');
  standards.push({
    lift,
    sex,
    equipment,
    bodyweight_bucket_kg: Number(bodyweightBucket),
    age_class: ageClass,
    p50_kg: percentile(values, 0.5),
    p75_kg: percentile(values, 0.75),
    p90_kg: percentile(values, 0.9),
    sample_size: values.length,
  });
}

standards.sort((a, b) =>
  a.lift.localeCompare(b.lift) ||
  a.sex.localeCompare(b.sex) ||
  a.equipment.localeCompare(b.equipment) ||
  a.age_class.localeCompare(b.age_class) ||
  a.bodyweight_bucket_kg - b.bodyweight_bucket_kg
);

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(
  OUTPUT_PATH,
  `-- Auto-generated by scripts/build-strength-standards-sql.mjs\n` +
    `-- Derived from ${toDataRelative(inputPath)}.\n` +
    `-- Raw OpenPowerlifting rows are intentionally not imported.\n\n` +
    `begin;\n\n` +
    standards.map(buildUpsert).join('\n') +
    `\n\ncommit;\n`,
  'utf8'
);

console.log('Strength standards import SQL generated');
console.log(`Rows processed: ${count.toLocaleString()}`);
console.log(`Usable competition rows: ${usedRows.toLocaleString()}`);
console.log(`Standard rows: ${standards.length.toLocaleString()}`);
console.log(`Minimum sample size: ${MIN_SAMPLE_SIZE}`);
console.log(`Bodyweight bucket kg: ${BODYWEIGHT_BUCKET_KG}`);
console.log(`Output: ${toDataRelative(OUTPUT_PATH)}`);
