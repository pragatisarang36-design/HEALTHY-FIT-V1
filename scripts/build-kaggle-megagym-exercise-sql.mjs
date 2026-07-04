import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './etl/lib/csv.mjs';
import { resolveFromDataRoot, toDataRelative } from './etl/lib/paths.mjs';

const INPUT_PATH = resolveFromDataRoot('raw_datasets', 'workouts', 'kaggle_gym_exercise_data', 'mega_gym_dataset.csv');
const OUTPUT_DIR = resolveFromDataRoot('supabase', 'imports');
const OUTPUT_PATH = join(OUTPUT_DIR, 'master_exercises_kaggle_megagym_load.sql');
const SOURCE_KEY = 'kaggle_megagym';
const SOURCE_URL = 'https://www.kaggle.com/datasets/niharika41298/gym-exercise-data';

const cleanText = (value) => String(value ?? '')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\u00B0/g, ' degrees')
  .replace(/\u2122/g, '')
  .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const escapeSql = (value) => cleanText(value).replace(/'/g, "''");
const q = (value) => (value === null || value === undefined || value === '' ? 'null' : `'${escapeSql(value)}'`);
const n = (value) => (value === null || value === undefined || value === '' ? 'null' : Number(value));
const arr = (values = []) => {
  const items = Array.isArray(values) ? values : [values];
  const cleaned = [...new Set(items.map((item) => cleanText(item)).filter(Boolean))];
  return cleaned.length ? `array[${cleaned.map(q).join(', ')}]::text[]` : "'{}'::text[]";
};

const titleCase = (value) => cleanText(value)
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (char) => char.toUpperCase());

const searchKey = (value) => cleanText(value)
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const normalizeEquipment = (value) => {
  const text = String(value || 'none').toLowerCase();
  if (!text || text === 'body only' || text === 'bodyweight' || text === 'body only') return ['none'];
  if (text.includes('dumbbell')) return ['dumbbells'];
  if (text.includes('barbell')) return ['barbell'];
  if (text.includes('band')) return ['band'];
  if (text.includes('bench')) return ['bench'];
  if (text.includes('cable')) return ['cable'];
  if (text.includes('machine')) return ['machine'];
  if (text.includes('kettlebell')) return ['kettlebell'];
  if (text.includes('medicine')) return ['medicine_ball'];
  if (text.includes('e-z curl')) return ['ez_bar'];
  if (text.includes('exercise ball')) return ['exercise_ball'];
  return [searchKey(text).replace(/\s+/g, '_') || 'none'];
};

const normalizeMuscle = (value) => {
  const text = String(value || '').toLowerCase().trim();
  if (!text) return '';
  if (text === 'abdominals') return 'abdominals';
  if (text === 'middle back') return 'back';
  if (text === 'lower back') return 'lower back';
  if (text === 'quadriceps') return 'quads';
  if (text === 'forearms') return 'forearms';
  if (text === 'neck') return 'neck';
  return text;
};

const normalizeCategory = (type, bodyPart) => {
  const text = `${type || ''} ${bodyPart || ''}`.toLowerCase();
  if (text.includes('cardio')) return 'cardio';
  if (text.includes('stretch')) return 'mobility';
  if (text.includes('abdominal')) return 'core';
  if (text.includes('plyometric')) return 'power';
  if (text.includes('olympic')) return 'power';
  if (text.includes('strongman')) return 'conditioning';
  return 'strength';
};

const normalizeLevel = (value) => {
  const level = String(value || 'beginner').toLowerCase();
  if (level.includes('expert')) return ['advanced'];
  if (level.includes('intermediate')) return ['intermediate', 'advanced'];
  if (level.includes('advanced')) return ['advanced'];
  return ['beginner', 'intermediate'];
};

const unsafeFor = (row) => {
  const name = String(row.Title || '').toLowerCase();
  const type = String(row.Type || '').toLowerCase();
  const bodyPart = String(row.BodyPart || '').toLowerCase();
  const equipment = String(row.Equipment || '').toLowerCase();
  const blocked = new Set();

  if (/(jump|lunge|squat|step-up|plyo|box jump)/.test(name) || type.includes('plyometric')) blocked.add('knee_pain');
  if (/(deadlift|good morning|clean|snatch|row|swing)/.test(name) || bodyPart.includes('lower back')) blocked.add('lower_back_pain');
  if (/(overhead|press|dip|handstand|jerk|snatch)/.test(name) || bodyPart.includes('shoulders')) blocked.add('shoulder_pain');
  if (/(push-up|pushup|plank|burpee|mountain climber)/.test(name)) blocked.add('wrist_pain');
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

const confidenceFor = (row) => {
  const rating = Number(row.Rating);
  if (!Number.isFinite(rating) || rating <= 0) return 0.68;
  return Math.max(0.68, Math.min(0.86, 0.68 + (rating / 100)));
};

const normalizeExercise = (row) => {
  const name = titleCase(row.Title);
  const primaryMuscle = normalizeMuscle(row.BodyPart);
  const category = normalizeCategory(row.Type, row.BodyPart);
  const defaults = defaultsFor(category);

  return {
    external_id: row[''] || searchKey(name).replace(/\s+/g, '-'),
    name,
    search_key: searchKey(name),
    category,
    level: normalizeLevel(row.Level),
    equipment: normalizeEquipment(row.Equipment),
    primary_muscles: primaryMuscle ? [primaryMuscle] : [],
    secondary_muscles: [],
    mechanic: '',
    force: '',
    instructions: row.Desc ? [cleanText(row.Desc)] : [],
    image_paths: [],
    unsafe_for: unsafeFor(row),
    goals: goalsFor(category),
    ...defaults,
    source_key: SOURCE_KEY,
    source_url: SOURCE_URL,
    confidence: confidenceFor(row),
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
  console.error(`Missing ${toDataRelative(INPUT_PATH)}. Download the Kaggle Gym Exercise Data CSV first.`);
  process.exit(1);
}

const rows = parseCsv(readFileSync(INPUT_PATH, 'utf8'))
  .map(normalizeExercise)
  .filter((row) => row.name && row.search_key)
  .sort((a, b) => a.name.localeCompare(b.name));

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(
  OUTPUT_PATH,
  `-- Auto-generated by scripts/build-kaggle-megagym-exercise-sql.mjs\n` +
    `-- Run after supabase/master-exercises-schema.sql.\n\n` +
    `begin;\n\n` +
    rows.map(buildUpsert).join('\n') +
    `\n\ncommit;\n`,
  'utf8'
);

console.log('Kaggle MegaGym exercise import SQL generated');
console.log(`Input: ${toDataRelative(INPUT_PATH)}`);
console.log(`Exercises: ${rows.length}`);
console.log(`Output: ${toDataRelative(OUTPUT_PATH)}`);
