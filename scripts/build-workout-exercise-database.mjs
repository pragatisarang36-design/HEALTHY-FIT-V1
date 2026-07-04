import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveFromDataRoot, toDataRelative } from './etl/lib/paths.mjs';

const INPUT_PATH = resolveFromDataRoot('raw_datasets', 'workouts', 'free_exercise_db', 'exercises.json');
const OUTPUT_PATH = resolveFromDataRoot('src', 'data', 'generatedExerciseDatabase.js');

const titleCase = (value) => String(value || '')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (char) => char.toUpperCase());

const slug = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

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
  const muscles = [...(exercise.primaryMuscles || []), ...(exercise.secondaryMuscles || [])]
    .join(' ')
    .toLowerCase();
  const blocked = new Set();

  if (/(jump|lunge|squat|step-up|plyo|box jump)/.test(name) || category.includes('plyometric')) {
    blocked.add('knee_pain');
  }
  if (/(deadlift|good morning|clean|snatch|row|swing)/.test(name) || muscles.includes('lower back')) {
    blocked.add('lower_back_pain');
  }
  if (/(overhead|press|dip|handstand|jerk|snatch)/.test(name) || muscles.includes('shoulder')) {
    blocked.add('shoulder_pain');
  }
  if (/(push-up|pushup|plank|burpee|mountain climber)/.test(name)) {
    blocked.add('wrist_pain');
  }
  if (equipment.includes('barbell') && /(squat|deadlift|press)/.test(name)) {
    blocked.add('lower_back_pain');
  }

  return [...blocked].sort();
};

const goalsFor = (category) => {
  if (category === 'cardio' || category === 'conditioning') return ['weight_loss', 'maintenance'];
  if (category === 'mobility') return ['maintenance'];
  return ['muscle_gain', 'maintenance', 'weight_loss'];
};

const defaultsFor = (category) => {
  if (category === 'cardio') return { sets: 1, reps: '20-35 minutes', duration_seconds: 0, intensity: 'moderate' };
  if (category === 'mobility') return { sets: 2, reps: '30 seconds each side', duration_seconds: 30, intensity: 'controlled' };
  if (category === 'power' || category === 'conditioning') return { sets: 3, reps: '8-12', duration_seconds: 0, intensity: 'moderate' };
  return { sets: 3, reps: '10-15', duration_seconds: 0, intensity: 'controlled' };
};

const normalizeExercise = (exercise) => {
  const muscles = [...new Set([...(exercise.primaryMuscles || []), ...(exercise.secondaryMuscles || [])]
    .map((value) => String(value || '').toLowerCase().trim())
    .filter(Boolean))];
  const category = normalizeCategory(exercise.category, muscles);
  const defaults = defaultsFor(category);

  return {
    id: slug(exercise.id || exercise.name),
    name: titleCase(exercise.name),
    category,
    level: normalizeLevel(exercise.level),
    equipment: normalizeEquipment(exercise.equipment),
    muscles,
    ...defaults,
    unsafeFor: unsafeFor(exercise),
    goals: goalsFor(category),
    instructions: Array.isArray(exercise.instructions) && exercise.instructions.length
      ? exercise.instructions.map((step) => String(step).trim()).filter(Boolean)
      : ['Keep posture tall and breathing steady.', 'Move through a pain-free range.', 'Stop if sharp pain appears.'],
    images: (exercise.images || []).map((image) => `free_exercise_db/${image}`),
    source: 'free_exercise_db',
  };
};

if (!existsSync(INPUT_PATH)) {
  console.error(`Missing ${toDataRelative(INPUT_PATH)}. Download Free Exercise DB first.`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(INPUT_PATH, 'utf8'));
const exercises = raw
  .map(normalizeExercise)
  .filter((exercise) => exercise.id && exercise.name)
  .sort((a, b) => a.name.localeCompare(b.name));

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(
  OUTPUT_PATH,
  `// Auto-generated by scripts/build-workout-exercise-database.mjs from Free Exercise DB.\n` +
    `// Do not edit by hand; run npm run workouts:build after updating raw_datasets/workouts/free_exercise_db/exercises.json.\n\n` +
    `export const generatedExerciseDatabase = ${JSON.stringify(exercises, null, 2)};\n`,
  'utf8'
);

console.log('Workout exercise database generated');
console.log(`Input: ${toDataRelative(INPUT_PATH)}`);
console.log(`Exercises: ${exercises.length}`);
console.log(`Output: ${toDataRelative(OUTPUT_PATH)}`);
