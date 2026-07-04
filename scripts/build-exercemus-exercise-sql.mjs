import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveFromDataRoot, toDataRelative } from './etl/lib/paths.mjs';

const INPUT_PATH = resolveFromDataRoot('raw_datasets', 'workouts', 'exercemus', 'minified-exercises.json');
const OUTPUT_DIR = resolveFromDataRoot('supabase', 'imports');
const OUTPUT_PATH = join(OUTPUT_DIR, 'master_exercises_exercemus_load.sql');
const SOURCE_KEY = 'exercemus';
const SOURCE_URL = 'https://github.com/exercemus/exercises';

const cleanText = (value) => String(value || '')
  .replace(/Â°/g, ' degrees')
  .replace(/â€“|â€”/g, '-')
  .replace(/â€™/g, "'")
  .replace(/â€œ|â€/g, '"')
  .replace(/\s+/g, ' ')
  .trim();

const escapeSql = (value) => cleanText(value).replace(/'/g, "''");
const q = (value) => {
  const text = cleanText(value);
  return text ? `'${escapeSql(text)}'` : 'null';
};
const n = (value) => (value === null || value === undefined || value === '' ? 'null' : Number(value));
const arr = (values = []) => {
  const items = Array.isArray(values) ? values : [values];
  const cleaned = [...new Set(items.map(cleanText).filter(Boolean))];
  return cleaned.length ? `array[${cleaned.map(q).join(', ')}]::text[]` : "'{}'::text[]";
};

const searchKey = (value) => cleanText(value)
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const normalizeEquipment = (values = []) => {
  const items = Array.isArray(values) ? values : [values];
  return items.map((value) => {
    const text = cleanText(value).toLowerCase();
    if (!text || text === 'body weight' || text === 'bodyweight') return 'none';
    if (text === 'bands') return 'band';
    if (text === 'dumbbell') return 'dumbbells';
    if (text === 'foam roll') return 'foam_roller';
    if (text === 'ez curl bar') return 'ez_bar';
    if (text === 'pull-up bar') return 'pull_up_bar';
    return searchKey(text).replace(/\s+/g, '_') || 'none';
  });
};

const normalizeMuscle = (value) => {
  const text = cleanText(value).toLowerCase();
  const map = {
    abs: 'abdominals',
    traps: 'traps',
    lats: 'lats',
    quads: 'quads',
    'middle back': 'back',
    'lower back': 'lower back',
  };
  return map[text] || text;
};

const normalizeCategory = (value) => {
  const text = cleanText(value).toLowerCase();
  if (text === 'stretching') return 'mobility';
  if (text === 'plyometrics' || text === 'olympic weightlifting' || text === 'crossfit') return 'power';
  if (text === 'strongman') return 'conditioning';
  if (text === 'calisthenics') return 'strength';
  return text || 'strength';
};

const unsafeFor = (row) => {
  const name = cleanText(row.name).toLowerCase();
  const category = cleanText(row.category).toLowerCase();
  const primary = (row.primary_muscles || []).map((item) => cleanText(item).toLowerCase()).join(' ');
  const equipment = (row.equipment || []).map((item) => cleanText(item).toLowerCase()).join(' ');
  const blocked = new Set();

  if (/(jump|lunge|squat|step-up|step up|plyo|leg press|bound)/.test(name) || category.includes('plyometric')) blocked.add('knee_pain');
  if (/(deadlift|good morning|row|swing|hyperextension|back extension)/.test(name) || primary.includes('lower back')) blocked.add('lower_back_pain');
  if (/(overhead|press|dip|handstand|snatch|raise)/.test(name) || primary.includes('shoulder')) blocked.add('shoulder_pain');
  if (/(push-up|pushup|plank|burpee|mountain climber|ab roller)/.test(name)) blocked.add('wrist_pain');
  if (equipment.includes('barbell') && /(squat|deadlift|press)/.test(name)) blocked.add('lower_back_pain');

  return [...blocked].sort();
};

const goalsFor = (category) => {
  if (category === 'cardio' || category === 'conditioning') return ['weight_loss', 'maintenance'];
  if (category === 'mobility') return ['maintenance'];
  return ['muscle_gain', 'maintenance', 'weight_loss'];
};

const defaultsFor = (category) => {
  if (category === 'cardio') return { default_sets: 1, default_reps: '20-35 minutes', duration_seconds: 0, intensity: 'moderate' };
  if (category === 'mobility') return { default_sets: 2, default_reps: '30 seconds each side', duration_seconds: 30, intensity: 'controlled' };
  if (category === 'power' || category === 'conditioning') return { default_sets: 3, default_reps: '8-12', duration_seconds: 0, intensity: 'moderate' };
  return { default_sets: 3, default_reps: '10-15', duration_seconds: 0, intensity: 'controlled' };
};

const normalizeExercise = (row) => {
  const category = normalizeCategory(row.category);
  const defaults = defaultsFor(category);
  const instructions = Array.isArray(row.instructions) && row.instructions.length
    ? row.instructions
    : [row.description].filter(Boolean);

  return {
    external_id: searchKey(row.name).replace(/\s+/g, '-'),
    name: cleanText(row.name),
    search_key: searchKey(row.name),
    category,
    level: category === 'power' ? ['intermediate', 'advanced'] : ['beginner', 'intermediate'],
    equipment: normalizeEquipment(row.equipment),
    primary_muscles: (row.primary_muscles || []).map(normalizeMuscle).filter(Boolean),
    secondary_muscles: (row.secondary_muscles || []).map(normalizeMuscle).filter(Boolean),
    mechanic: '',
    force: '',
    instructions,
    image_paths: row.video ? [row.video] : [],
    unsafe_for: unsafeFor(row),
    goals: goalsFor(category),
    ...defaults,
    source_key: SOURCE_KEY,
    source_url: SOURCE_URL,
    confidence: 0.78,
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
  console.error(`Missing ${toDataRelative(INPUT_PATH)}. Download Exercemus minified-exercises.json first.`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(INPUT_PATH, 'utf8'));
const rows = (data.exercises || [])
  .map(normalizeExercise)
  .filter((row) => row.name && row.search_key)
  .sort((a, b) => a.name.localeCompare(b.name));

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(
  OUTPUT_PATH,
  `-- Auto-generated by scripts/build-exercemus-exercise-sql.mjs\n` +
    `-- Run after supabase/master-exercises-schema.sql.\n\n` +
    `begin;\n\n` +
    rows.map(buildUpsert).join('\n') +
    `\n\ncommit;\n`,
  'utf8'
);

console.log('Exercemus exercise import SQL generated');
console.log(`Input: ${toDataRelative(INPUT_PATH)}`);
console.log(`Exercises: ${rows.length}`);
console.log(`Output: ${toDataRelative(OUTPUT_PATH)}`);
