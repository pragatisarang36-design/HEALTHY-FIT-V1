import { localExerciseDatabase } from '@/data/localExerciseDatabase';
import { isExerciseSafe, parseInjuries, safetyNotesFor } from '@/services/injuryValidation';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DEFAULT_WARMUP = ['5 minutes easy walk or cycle', '10 arm circles each direction', '10 hip hinges', '10 bodyweight good-morning motions without load'];
const DEFAULT_COOLDOWN = ['3 minutes slow breathing', 'Hamstring stretch 30 seconds each side', 'Chest doorway stretch 30 seconds', 'Calf stretch 30 seconds each side'];

const normalize = (value) => String(value || '').toLowerCase().replace(/[\s-]+/g, '_').trim();
const hash = (value) => {
  let h = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
};
const seededShuffle = (items, seed) => [...items]
  .map((item, index) => ({ item, score: hash(`${seed}:${item.id}:${index}`) }))
  .sort((a, b) => a.score - b.score)
  .map(({ item }) => item);

async function fetchWgerExercises() {
  try {
    const response = await fetch('https://wger.de/api/v2/exercise/?language=2&limit=20', { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.results || [])
      .filter((item) => item.name)
      .map((item) => ({
        id: `wger-${item.id}`,
        name: item.name.replace(/<[^>]+>/g, ''),
        category: 'strength',
        level: ['beginner', 'intermediate', 'advanced'],
        equipment: ['none'],
        goals: ['maintenance', 'muscle_gain', 'weight_loss'],
        muscles: ['full body'],
        sets: 3,
        reps: '10-12',
        duration_seconds: 0,
        intensity: 'moderate',
        unsafeFor: [],
        source: 'wger',
      }));
  } catch {
    return [];
  }
}

const exerciseScore = (exercise, options) => {
  let score = 0;
  const goal = normalize(options.goal);
  const level = normalize(options.level || 'beginner');
  const equipment = new Set((options.equipment || ['none']).map(normalize));

  if ((exercise.goals || []).map(normalize).includes(goal)) score += 4;
  if ((exercise.level || []).map(normalize).includes(level)) score += 3;
  if ((exercise.equipment || []).some((item) => equipment.has(normalize(item)))) score += 3;
  if (exercise.category === 'cardio' && goal === 'weight_loss') score += 2;
  if (exercise.category === 'strength' && goal === 'muscle_gain') score += 2;
  return score;
};

const buildDay = ({ day, focus, exercises, index, isRest = false, injuries }) => ({
  day,
  focus,
  is_rest: isRest,
  warm_up: isRest ? [] : DEFAULT_WARMUP,
  cool_down: isRest ? [] : DEFAULT_COOLDOWN,
  exercises: isRest ? [] : exercises.map((exercise) => ({
    name: exercise.name,
    sets: exercise.sets,
    reps: exercise.reps,
    duration_seconds: exercise.duration_seconds,
    intensity: exercise.intensity,
    category: exercise.category,
    equipment: exercise.equipment?.join(', ') || 'none',
    source: exercise.source || 'curated',
  })),
  safety_notes: safetyNotesFor(injuries),
  sequence: index + 1,
});

export async function generateRuleBasedWorkoutPlan(profile, options = {}) {
  const {
    level = profile?.fitness_level || 'beginner',
    workoutDays = 5,
    equipment = ['none'],
    injuryNote = '',
    customPreference = '',
    useWger = false,
    recentPlans = [],
    seed = '',
  } = options;

  const injuries = parseInjuries(injuryNote, customPreference);
  const wgerExercises = useWger ? await fetchWgerExercises() : [];
  const planSeed = seed || `${profile?.id || profile?.name || 'user'}:${new Date().toISOString().slice(0, 10)}:${recentPlans.length}:${Math.random()}`;
  const recentExerciseNames = new Set(
    recentPlans
      .flatMap((plan) => plan?.plan_data?.days || [])
      .flatMap((day) => day.exercises || [])
      .map((exercise) => String(exercise.name || '').toLowerCase())
      .filter(Boolean)
  );
  const allExercises = [...localExerciseDatabase, ...wgerExercises];
  const usable = allExercises
    .filter((exercise) => isExerciseSafe(exercise, injuries))
    .filter((exercise) => (exercise.equipment || ['none']).some((item) => equipment.map(normalize).includes(normalize(item)) || normalize(item) === 'none'))
    .sort((a, b) => exerciseScore(b, { goal: profile?.fitness_goal, level, equipment }) - exerciseScore(a, { goal: profile?.fitness_goal, level, equipment }));

  if (usable.length < 4) {
    throw new Error('Not enough safe exercises match these settings. Remove one restriction or add bodyweight equipment.');
  }

  const trainingDays = Math.min(Math.max(Number(workoutDays) || 5, 2), 6);
  const restSlots = new Set();
  while (restSlots.size < 7 - trainingDays) {
    restSlots.add(restSlots.size === 0 ? 2 : 6 - restSlots.size);
  }

  const used = new Set();
  const days = DAY_NAMES.map((day, index) => {
    if (restSlots.has(index)) {
      return buildDay({ day, focus: 'Recovery and mobility', exercises: [], index, isRest: true, injuries });
    }

    let pool = usable.filter((exercise) => !used.has(exercise.id) && !recentExerciseNames.has(String(exercise.name).toLowerCase()));
    if (pool.length < 3) {
      pool = usable.filter((exercise) => !used.has(exercise.id));
    }
    if (pool.length < 3) {
      used.clear();
      pool = usable;
    }

    const chosen = seededShuffle(pool, `${planSeed}:${day}:${index}`).slice(0, 4);
    chosen.forEach((exercise) => used.add(exercise.id));
    const focus = chosen.some((exercise) => exercise.category === 'cardio')
      ? 'Conditioning and strength'
      : chosen.some((exercise) => exercise.category === 'core')
        ? 'Strength and core'
        : 'Strength training';

    return buildDay({ day, focus, exercises: chosen, index, injuries });
  });

  return {
    generated_by: 'rule_based_engine',
    generated_at: new Date().toISOString(),
    rotation_seed: planSeed,
    filters_applied: {
      goal: profile?.fitness_goal,
      level,
      workout_days: trainingDays,
      equipment,
      injuries,
      custom_preference: customPreference.trim(),
    },
    avoided_recent_exercises: [...recentExerciseNames],
    data_sources: ['curated local exercise database', ...(wgerExercises.length ? ['wger'] : [])],
    safety_notes: safetyNotesFor(injuries),
    days,
  };
}
