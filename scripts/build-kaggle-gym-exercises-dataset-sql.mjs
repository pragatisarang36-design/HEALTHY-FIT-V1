import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './etl/lib/csv.mjs';
import { resolveFromDataRoot, toDataRelative } from './etl/lib/paths.mjs';

const INPUT_DIR = resolveFromDataRoot('raw_datasets', 'workouts', 'kaggle_gym_exercises_dataset', 'archive (2)');
const GYM_PATH = join(INPUT_DIR, 'gym_exercise_dataset.csv');
const STRETCH_PATH = join(INPUT_DIR, 'stretch_exercise_dataset.csv');
const OUTPUT_DIR = resolveFromDataRoot('supabase', 'imports');
const OUTPUT_PATH = join(OUTPUT_DIR, 'master_exercises_kaggle_gym_exercises_load.sql');
const SOURCE_KEY = 'kaggle_gym_exercises_dataset';
const SOURCE_URL = 'https://www.kaggle.com/datasets/rishitmurarka/gym-exercises-dataset';

const cleanText = (value) => String(value || '')
  .replace(/â€‹/g, '')
  .replace(/Â°/g, ' degrees')
  .replace(/\u00B0/g, ' degrees')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/â€“|â€”/g, '-')
  .replace(/â€™/g, "'")
  .replace(/â€œ|â€/g, '"')
  .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const escapeSql = (value) => cleanText(value).replace(/'/g, "''");
const q = (value) => {
  const text = cleanText(value);
  return text ? `'${escapeSql(text)}'` : 'null';
};
const n = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 'null';
};
const arr = (values = []) => {
  const items = Array.isArray(values) ? values : [values];
  const cleaned = [...new Set(items.flatMap(splitList).map(cleanText).filter(Boolean))];
  return cleaned.length ? `array[${cleaned.map(q).join(', ')}]::text[]` : "'{}'::text[]";
};

function splitList(value) {
  return cleanText(value)
    .split(',')
    .map((item) => cleanMuscle(item))
    .filter(Boolean);
}

const titleCase = (value) => cleanText(value)
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (char) => char.toUpperCase());

const searchKey = (value) => cleanText(value)
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

function cleanMuscle(value) {
  const text = cleanText(value)
    .replace(/\(.*?\)/g, '')
    .replace(/\bpart\s+\d+\b/gi, '')
    .replace(/\bnone\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!text) return '';

  const map = new Map([
    ['rectus abdominis', 'abdominals'],
    ['obliques', 'obliques'],
    ['latissimus dorsi', 'lats'],
    ['deltoid', 'shoulders'],
    ['deltoid anterior', 'shoulders'],
    ['deltoid posterior', 'shoulders'],
    ['trapezius upper', 'traps'],
    ['trapezius middle', 'traps'],
    ['trapezius lower', 'traps'],
    ['pectoralis major sternal', 'chest'],
    ['pectoralis major clavicular', 'chest'],
    ['pectoralis minor', 'chest'],
    ['triceps brachii', 'triceps'],
    ['biceps brachii', 'biceps'],
    ['quadriceps', 'quads'],
    ['gluteus maximus', 'glutes'],
    ['erector spinae', 'lower back'],
    ['levator scapulae', 'neck'],
    ['sternocleidomastoid', 'neck'],
  ]);

  return map.get(text) || text;
}

const normalizeEquipment = (value) => {
  const text = cleanText(value).toLowerCase();
  if (!text || text === 'body weight' || text === 'bodyweight') return ['none'];
  if (text === 'stretch') return ['none'];
  if (text.includes('cable')) return ['cable'];
  if (text.includes('dumbbell')) return ['dumbbells'];
  if (text.includes('barbell')) return ['barbell'];
  if (text.includes('lever')) return ['machine'];
  if (text.includes('smith')) return ['smith_machine'];
  if (text.includes('sled')) return ['sled'];
  if (text.includes('band')) return ['band'];
  if (text.includes('kettlebell')) return ['kettlebell'];
  if (text.includes('medicine')) return ['medicine_ball'];
  if (text.includes('stability')) return ['stability_ball'];
  if (text.includes('weighted')) return ['weighted'];
  return [searchKey(text).replace(/\s+/g, '_') || 'none'];
};

const normalizeCategory = (row, isStretch) => {
  if (isStretch) return 'mobility';
  const main = cleanText(row.Main_muscle).toLowerCase();
  if (main === 'cardio') return 'cardio';
  if (main === 'waist' || main === 'abdominal' || main === 'core') return 'core';
  if (main === 'neck') return 'mobility';
  return 'strength';
};

const normalizeLevel = (value, isStretch) => {
  if (isStretch) return ['beginner', 'intermediate'];
  const difficulty = Number(value);
  if (!Number.isFinite(difficulty)) return ['beginner', 'intermediate'];
  if (difficulty <= 2) return ['beginner', 'intermediate'];
  if (difficulty === 3) return ['intermediate'];
  return ['advanced'];
};

const normalizeMechanic = (value) => {
  const text = cleanText(value).toLowerCase();
  if (text.includes('compound')) return 'compound';
  if (text.includes('isolated') || text.includes('isolation')) return 'isolation';
  return '';
};

const normalizeForce = (value) => {
  const text = cleanText(value).toLowerCase();
  if (text.includes('push')) return 'push';
  if (text.includes('pull')) return 'pull';
  if (text.includes('static')) return 'static';
  return '';
};

const unsafeFor = (row, isStretch) => {
  const name = cleanText(row['Exercise Name']).toLowerCase();
  const main = cleanText(row.Main_muscle).toLowerCase();
  const equipment = cleanText(row.Equipment).toLowerCase();
  const blocked = new Set();

  if (!isStretch && (/(jump|lunge|squat|step-up|step up|plyo|leg press)/.test(name) || main.includes('thigh'))) blocked.add('knee_pain');
  if (/(deadlift|good morning|row|hyperextension|back extension)/.test(name) || main.includes('back')) blocked.add('lower_back_pain');
  if (/(overhead|press|dip|raise|upright row)/.test(name) || main.includes('shoulder')) blocked.add('shoulder_pain');
  if (/(push-up|pushup|plank|burpee|mountain climber)/.test(name)) blocked.add('wrist_pain');
  if (equipment.includes('barbell') && /(squat|deadlift|press)/.test(name)) blocked.add('lower_back_pain');

  return [...blocked].sort();
};

const goalsFor = (category) => {
  if (category === 'cardio') return ['weight_loss', 'maintenance'];
  if (category === 'mobility') return ['maintenance'];
  return ['muscle_gain', 'maintenance', 'weight_loss'];
};

const defaultsFor = (category) => {
  if (category === 'cardio') return { default_sets: 1, default_reps: '20-35 minutes', duration_seconds: 0, intensity: 'moderate' };
  if (category === 'mobility') return { default_sets: 2, default_reps: '30 seconds each side', duration_seconds: 30, intensity: 'controlled' };
  return { default_sets: 3, default_reps: '10-15', duration_seconds: 0, intensity: 'controlled' };
};

const normalizeExercise = (row, sourceType) => {
  const isStretch = sourceType === 'stretch';
  const name = titleCase(row['Exercise Name']);
  const category = normalizeCategory(row, isStretch);
  const defaults = defaultsFor(category);
  const instructions = [row.Preparation, row.Execution].map(cleanText).filter(Boolean);
  const secondary = [
    row.Synergist_Muscles,
    row.Stabilizer_Muscles,
    row['Secondary Muscles'],
    row.Dynamic_Stabilizer_Muscles,
  ];

  return {
    external_id: `${sourceType}-${searchKey(name).replace(/\s+/g, '-')}-${searchKey(row.Equipment).replace(/\s+/g, '-')}`,
    name,
    search_key: `${searchKey(name)} ${searchKey(row.Equipment)}`.trim(),
    category,
    level: normalizeLevel(row['Difficulty (1-5)'], isStretch),
    equipment: normalizeEquipment(row.Equipment),
    primary_muscles: splitList(row.Target_Muscles || row.Main_muscle),
    secondary_muscles: secondary.flatMap(splitList),
    mechanic: normalizeMechanic(row.Mechanics),
    force: normalizeForce(row.Force),
    instructions,
    image_paths: [],
    unsafe_for: unsafeFor(row, isStretch),
    goals: goalsFor(category),
    ...defaults,
    source_key: SOURCE_KEY,
    source_url: SOURCE_URL,
    confidence: isStretch ? 0.72 : 0.76,
  };
};

const buildUpsert = (row) => `
insert into public.master_exercises (
  external_id, name, search_key, category, level, equipment, primary_muscles, secondary_muscles,
  mechanic, force, instructions, image_paths, unsafe_for, goals, default_sets, default_reps,
  duration_seconds, intensity, source_key, source_url, confidence, active
)
values (
  ${q(row.external_id)}, ${q(row.name)}, ${q(row.search_key)}, ${q(row.category)}, ${arr(row.level)}, ${arr(row.equipment)},
  ${arr(row.primary_muscles)}, ${arr(row.secondary_muscles)}, ${q(row.mechanic)}, ${q(row.force)}, ${arr(row.instructions)},
  ${arr(row.image_paths)}, ${arr(row.unsafe_for)}, ${arr(row.goals)}, ${n(row.default_sets)}, ${q(row.default_reps)},
  ${n(row.duration_seconds)}, ${q(row.intensity)}, ${q(row.source_key)}, ${q(row.source_url)}, ${n(row.confidence)}, true
)
on conflict (source_key, search_key) do update set
  external_id = excluded.external_id,
  name = excluded.name,
  category = excluded.category,
  level = excluded.level,
  equipment = excluded.equipment,
  primary_muscles = excluded.primary_muscles,
  secondary_muscles = excluded.secondary_muscles,
  mechanic = excluded.mechanic,
  force = excluded.force,
  instructions = excluded.instructions,
  image_paths = excluded.image_paths,
  unsafe_for = excluded.unsafe_for,
  goals = excluded.goals,
  default_sets = excluded.default_sets,
  default_reps = excluded.default_reps,
  duration_seconds = excluded.duration_seconds,
  intensity = excluded.intensity,
  source_url = excluded.source_url,
  confidence = excluded.confidence,
  active = excluded.active,
  updated_at = now();`;

for (const file of [GYM_PATH, STRETCH_PATH]) {
  if (!existsSync(file)) {
    console.error(`Missing ${toDataRelative(file)}.`);
    process.exit(1);
  }
}

const rows = [
  ...parseCsv(readFileSync(GYM_PATH, 'utf8')).map((row) => normalizeExercise(row, 'gym')),
  ...parseCsv(readFileSync(STRETCH_PATH, 'utf8')).map((row) => normalizeExercise(row, 'stretch')),
]
  .filter((row) => row.name && row.search_key)
  .sort((a, b) => a.name.localeCompare(b.name));

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(
  OUTPUT_PATH,
  `-- Auto-generated by scripts/build-kaggle-gym-exercises-dataset-sql.mjs\n` +
    `-- Run after supabase/master-exercises-schema.sql.\n\n` +
    `begin;\n\n` +
    rows.map(buildUpsert).join('\n') +
    `\n\ncommit;\n`,
  'utf8'
);

console.log('Kaggle Gym Exercises Dataset import SQL generated');
console.log(`Inputs: ${toDataRelative(GYM_PATH)}, ${toDataRelative(STRETCH_PATH)}`);
console.log(`Exercises: ${rows.length}`);
console.log(`Output: ${toDataRelative(OUTPUT_PATH)}`);
