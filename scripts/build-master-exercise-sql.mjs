import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveFromDataRoot, toDataRelative } from './etl/lib/paths.mjs';

const INPUT_PATH = resolveFromDataRoot('raw_datasets', 'workouts', 'free_exercise_db', 'exercises.json');
const OUTPUT_DIR = resolveFromDataRoot('supabase', 'imports');
const OUTPUT_PATH = join(OUTPUT_DIR, 'master_exercises_load.sql');

const escapeSql = (value) => String(value ?? '').replace(/'/g, "''");
const q = (value) => (value === null || value === undefined || value === '' ? 'null' : `'${escapeSql(value)}'`);
const n = (value) => (value === null || value === undefined || value === '' ? 'null' : Number(value));
const arr = (values = []) => {
  const items = Array.isArray(values) ? values : [values];
  const cleaned = [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
  return cleaned.length ? `array[${cleaned.map(q).join(', ')}]::text[]` : "'{}'::text[]";
};

const titleCase = (value) => String(value || '')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (char) => char.toUpperCase());

const searchKey = (value) => String(value || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const slug = (value) => searchKey(value).replace(/\s+/g, '-');

const normalizeEquipment = (value) => {
  const text = String(value || 'none').toLowerCase();
  if (!text || text === 'body only' || text === 'bodyweight') return ['none'];
  if (text.includes('dumbbell')) return ['dumbbells'];
  if (text.includes('barbell')) return ['barbell'];
  if (text.includes('band')) return ['band'];
  if (text.includes('bench')) return ['bench'];
  if (text.includes('bike') || text.includes('cycle')) return ['bike'];
  if (text.includes('cable')) return ['cable'];
  if (text.includes('machine')) return ['machine'];
  if (text.includes('kettlebell')) return ['kettlebell'];
  if (text.includes('medicine ball')) return ['medicine_ball'];
  return [slug(text) || 'none'];
};

const normalizeCategory = (category, muscles) => {
  const text = String(category || '').toLowerCase();
  const muscleText = muscles.join(' ');
  if (text.includes('cardio')) return 'cardio';
  if (text.includes('stretch')) return 'mobility';
  if (muscleText.includes('abdominal')) return 'core';
  if (text.includes('plyometric')) return 'power';
  if (text.includes('strongman')) return 'conditioning';
  return 'strength';
};

const normalizeLevel = (value) => {
  const level = String(value || 'beginner').toLowerCase();
  if (level === 'expert') return ['advanced'];
  if (level === 'intermediate') return ['intermediate', 'advanced'];
  if (level === 'advanced') return ['advanced'];
  return ['beginner', 'intermediate'];
};

const unsafeFor = (exercise) => {
  const name = String(exercise.name || '').toLowerCase();
  const category = String(exercise.category || '').toLowerCase();
  const equipment = String(exercise.equipment || '').toLowerCase();
  const muscles = [...(exercise.primaryMuscles || []), ...(exercise.secondaryMuscles || [])].join(' ').toLowerCase();
  const blocked = new Set();

  if (/(jump|lunge|squat|step-up|plyo|box jump)/.test(name) || category.includes('plyometric')) blocked.add('knee_pain');
  if (/(deadlift|good morning|clean|snatch|row|swing)/.test(name) || muscles.includes('lower back')) blocked.add('lower_back_pain');
  if (/(overhead|press|dip|handstand|jerk|snatch)/.test(name) || muscles.includes('shoulder')) blocked.add('shoulder_pain');
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

const normalizeExercise = (exercise) => {
  const primaryMuscles = [...new Set((exercise.primaryMuscles || []).map((value) => String(value || '').toLowerCase().trim()).filter(Boolean))];
  const secondaryMuscles = [...new Set((exercise.secondaryMuscles || []).map((value) => String(value || '').toLowerCase().trim()).filter(Boolean))];
  const category = normalizeCategory(exercise.category, [...primaryMuscles, ...secondaryMuscles]);
  const defaults = defaultsFor(category);

  return {
    external_id: exercise.id || slug(exercise.name),
    name: titleCase(exercise.name),
    search_key: searchKey(exercise.name),
    category,
    level: normalizeLevel(exercise.level),
    equipment: normalizeEquipment(exercise.equipment),
    primary_muscles: primaryMuscles,
    secondary_muscles: secondaryMuscles,
    mechanic: exercise.mechanic || '',
    force: exercise.force || '',
    instructions: Array.isArray(exercise.instructions) ? exercise.instructions.map((step) => String(step).trim()).filter(Boolean) : [],
    image_paths: (exercise.images || []).map((image) => `free_exercise_db/${image}`),
    unsafe_for: unsafeFor(exercise),
    goals: goalsFor(category),
    ...defaults,
    source_key: 'free_exercise_db',
    source_url: 'https://github.com/yuhonas/free-exercise-db',
    confidence: 0.82,
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
  console.error(`Missing ${toDataRelative(INPUT_PATH)}. Download Free Exercise DB first.`);
  process.exit(1);
}

const rows = JSON.parse(readFileSync(INPUT_PATH, 'utf8'))
  .map(normalizeExercise)
  .filter((row) => row.name && row.search_key)
  .sort((a, b) => a.name.localeCompare(b.name));

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(
  OUTPUT_PATH,
  `-- Auto-generated by scripts/build-master-exercise-sql.mjs\n` +
    `-- Run after supabase/master-exercises-schema.sql.\n\n` +
    `begin;\n\n` +
    rows.map(buildUpsert).join('\n') +
    `\n\ncommit;\n`,
  'utf8'
);

console.log('Master exercise import SQL generated');
console.log(`Input: ${toDataRelative(INPUT_PATH)}`);
console.log(`Exercises: ${rows.length}`);
console.log(`Output: ${toDataRelative(OUTPUT_PATH)}`);
