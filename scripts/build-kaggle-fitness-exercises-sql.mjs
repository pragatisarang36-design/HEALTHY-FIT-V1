import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './etl/lib/csv.mjs';
import { resolveFromDataRoot, toDataRelative } from './etl/lib/paths.mjs';

const INPUT_PATH = resolveFromDataRoot(
  'raw_datasets',
  'workouts',
  'kaggle_fitness_exercises',
  'archive (1)',
  'exercises.csv'
);
const OUTPUT_DIR = resolveFromDataRoot('supabase', 'imports');
const OUTPUT_PATH = join(OUTPUT_DIR, 'master_exercises_kaggle_fitness_load.sql');
const SOURCE_KEY = 'kaggle_fitness_exercises';
const SOURCE_URL = 'https://www.kaggle.com/datasets/omarxadel/fitness-exercises-dataset';

const escapeSql = (value) => String(value ?? '').replace(/'/g, "''");
const q = (value) => (value === null || value === undefined || value === '' ? 'null' : `'${escapeSql(value)}'`);
const n = (value) => (value === null || value === undefined || value === '' ? 'null' : Number(value));
const arr = (values = []) => {
  const items = Array.isArray(values) ? values : [values];
  const cleaned = [...new Set(items.map((item) => cleanText(item)).filter(Boolean))];
  return cleaned.length ? `array[${cleaned.map(q).join(', ')}]::text[]` : "'{}'::text[]";
};

const cleanText = (value) => String(value || '')
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

const titleCase = (value) => cleanText(value)
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (char) => char.toUpperCase());

const searchKey = (value) => cleanText(value)
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const normalizeEquipment = (value) => {
  const text = cleanText(value).toLowerCase();
  if (!text || text === 'body weight' || text === 'bodyweight' || text === 'body only') return ['none'];
  if (text.includes('assisted')) return ['assisted_machine'];
  if (text.includes('band')) return ['band'];
  if (text.includes('barbell')) return ['barbell'];
  if (text.includes('bosu')) return ['bosu_ball'];
  if (text.includes('cable')) return ['cable'];
  if (text.includes('dumbbell')) return ['dumbbells'];
  if (text.includes('elliptical')) return ['elliptical'];
  if (text.includes('ez bar')) return ['ez_bar'];
  if (text.includes('hammer')) return ['machine'];
  if (text.includes('kettlebell')) return ['kettlebell'];
  if (text.includes('leverage')) return ['machine'];
  if (text.includes('medicine')) return ['medicine_ball'];
  if (text.includes('olympic')) return ['barbell'];
  if (text.includes('resistance')) return ['band'];
  if (text.includes('roller')) return ['foam_roller'];
  if (text.includes('rope')) return ['rope'];
  if (text.includes('sled')) return ['sled'];
  if (text.includes('smith')) return ['smith_machine'];
  if (text.includes('stability')) return ['stability_ball'];
  if (text.includes('stationary bike')) return ['stationary_bike'];
  if (text.includes('trap bar')) return ['trap_bar'];
  if (text.includes('wheel roller')) return ['ab_wheel'];
  return [searchKey(text).replace(/\s+/g, '_') || 'none'];
};

const normalizeMuscle = (value) => {
  const text = cleanText(value).toLowerCase();
  const map = {
    abs: 'abdominals',
    adductors: 'adductors',
    biceps: 'biceps',
    calves: 'calves',
    'cardiovascular system': 'cardio',
    delts: 'shoulders',
    forearms: 'forearms',
    glutes: 'glutes',
    hamstrings: 'hamstrings',
    lats: 'lats',
    'levator scapulae': 'neck',
    pectorals: 'chest',
    quads: 'quads',
    'serratus anterior': 'chest',
    spine: 'lower back',
    traps: 'traps',
    triceps: 'triceps',
    'upper back': 'upper back',
  };
  return map[text] || text;
};

const normalizeCategory = (bodyPart, target) => {
  const text = `${bodyPart || ''} ${target || ''}`.toLowerCase();
  if (text.includes('cardio') || text.includes('cardiovascular')) return 'cardio';
  if (text.includes('waist') || text.includes('abs')) return 'core';
  if (text.includes('neck')) return 'mobility';
  return 'strength';
};

const unsafeFor = (row) => {
  const name = cleanText(row.name).toLowerCase();
  const bodyPart = cleanText(row.bodyPart).toLowerCase();
  const equipment = cleanText(row.equipment).toLowerCase();
  const blocked = new Set();

  if (/(jump|lunge|squat|step-up|step up|plyo|burpee)/.test(name) || bodyPart.includes('upper legs')) blocked.add('knee_pain');
  if (/(deadlift|good morning|row|swing|hyperextension)/.test(name) || bodyPart.includes('back')) blocked.add('lower_back_pain');
  if (/(overhead|press|dip|handstand|snatch|raise)/.test(name) || bodyPart.includes('shoulders')) blocked.add('shoulder_pain');
  if (/(push-up|pushup|plank|burpee|mountain climber|wheel roller)/.test(name)) blocked.add('wrist_pain');
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

const collectByPrefix = (row, prefix) => Object.entries(row)
  .filter(([key, value]) => key.startsWith(`${prefix}/`) && cleanText(value))
  .sort(([a], [b]) => Number(a.split('/')[1]) - Number(b.split('/')[1]))
  .map(([, value]) => cleanText(value));

const normalizeExercise = (row) => {
  const name = titleCase(row.name);
  const category = normalizeCategory(row.bodyPart, row.target);
  const defaults = defaultsFor(category);
  const secondaryMuscles = collectByPrefix(row, 'secondaryMuscles').map(normalizeMuscle).filter(Boolean);
  const instructions = collectByPrefix(row, 'instructions');

  return {
    external_id: cleanText(row.id) || searchKey(name).replace(/\s+/g, '-'),
    name,
    search_key: searchKey(name),
    category,
    level: ['beginner', 'intermediate'],
    equipment: normalizeEquipment(row.equipment),
    primary_muscles: [normalizeMuscle(row.target)].filter(Boolean),
    secondary_muscles: secondaryMuscles,
    mechanic: '',
    force: '',
    instructions,
    image_paths: cleanText(row.gifUrl) ? [cleanText(row.gifUrl)] : [],
    unsafe_for: unsafeFor(row),
    goals: goalsFor(category),
    ...defaults,
    source_key: SOURCE_KEY,
    source_url: SOURCE_URL,
    confidence: 0.74,
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

if (!existsSync(INPUT_PATH)) {
  console.error(`Missing ${toDataRelative(INPUT_PATH)}. Download the Kaggle Fitness Exercises CSV first.`);
  process.exit(1);
}

const rows = parseCsv(readFileSync(INPUT_PATH, 'utf8'))
  .map(normalizeExercise)
  .filter((row) => row.name && row.search_key)
  .sort((a, b) => a.name.localeCompare(b.name));

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(
  OUTPUT_PATH,
  `-- Auto-generated by scripts/build-kaggle-fitness-exercises-sql.mjs\n` +
    `-- Run after supabase/master-exercises-schema.sql.\n\n` +
    `begin;\n\n` +
    rows.map(buildUpsert).join('\n') +
    `\n\ncommit;\n`,
  'utf8'
);

console.log('Kaggle Fitness Exercises import SQL generated');
console.log(`Input: ${toDataRelative(INPUT_PATH)}`);
console.log(`Exercises: ${rows.length}`);
console.log(`Output: ${toDataRelative(OUTPUT_PATH)}`);
