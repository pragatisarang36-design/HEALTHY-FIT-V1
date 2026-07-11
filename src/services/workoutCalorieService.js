import { supabase } from '@/lib/supabaseClient';

const normalizeExerciseKey = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const intensityRank = {
  low: ['low', 'light', 'easy'],
  moderate: ['moderate', 'medium'],
  high: ['high', 'vigorous', 'hard'],
};

export const workoutResolutionKey = (workout = {}) => [
  workout.date || '',
  normalizeExerciseKey(workout.workout_type || workout.workoutType),
  Number(workout.duration_minutes ?? workout.durationMinutes ?? workout.duration) || 0,
].join('|');

export const unresolvedWorkoutLogData = ({ workoutType, intensity, durationMinutes, weightKg, reason, message, date }) => {
  const workout = {
    date,
    workout_type: workoutType,
    duration_minutes: durationMinutes,
  };

  return {
    resolution_key: workoutResolutionKey(workout),
    raw_label: workoutType,
    workout_type: workoutType,
    intensity,
    duration_minutes: Number(durationMinutes) || 0,
    weight_kg: Number(weightKg) || null,
    reason,
    message,
    date,
  };
};

export const attachWorkoutResolutionState = (workouts = [], unresolvedLogs = []) => {
  const unresolvedKeys = new Set(
    unresolvedLogs
      .map((log) => log.plan_data?.resolution_key || workoutResolutionKey(log.plan_data || log))
      .filter(Boolean)
  );

  return workouts.map((workout) => ({
    ...workout,
    calories_unresolved: workout.calories_unresolved === true || unresolvedKeys.has(workoutResolutionKey(workout)),
  }));
};

export function calculateCaloriesFromMet(metValue, durationMinutes, weightKg) {
  const met = Number(metValue);
  const minutes = Number(durationMinutes);
  const weight = Number(weightKg);
  if (!Number.isFinite(met) || met <= 0 || !Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(weight) || weight <= 0) {
    return null;
  }
  return Math.round(met * weight * (minutes / 60));
}

const chooseBestMap = (maps, intensity) => {
  const aliases = intensityRank[intensity] || [intensity].filter(Boolean);
  const normalizedAliases = aliases.map(normalizeExerciseKey);

  const score = (map) => {
    const variant = normalizeExerciseKey(map.intensity_variant);
    if (variant && normalizedAliases.includes(variant)) return 3;
    if (!variant) return 2;
    if (normalizedAliases.some((item) => variant.includes(item) || item.includes(variant))) return 1;
    return 0;
  };

  return [...maps]
    .map((map) => ({ map, score: score(map) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.map.match_confidence || 0) - Number(a.map.match_confidence || 0))[0]?.map || null;
};

export async function estimateWorkoutCalories({ workoutType, intensity, durationMinutes, weightKg }) {
  const nameKey = normalizeExerciseKey(workoutType);
  if (!nameKey) {
    return { resolved: false, calories: null, reason: 'missing_workout_type' };
  }

  let exercises;
  try {
    const { data, error } = await supabase
      .from('master_exercises')
      .select('id,name,search_key,name_key')
      .eq('active', true)
      .eq('name_key', nameKey)
      .limit(10);

    if (error) throw error;
    exercises = data || [];
  } catch (error) {
    return {
      resolved: false,
      calories: null,
      reason: 'exercise_lookup_failed',
      message: error?.message || 'Could not read master_exercises.',
    };
  }

  if (exercises.length === 0) {
    return { resolved: false, calories: null, reason: 'exercise_not_mapped' };
  }

  let maps;
  try {
    const { data, error } = await supabase
      .from('exercise_met_map')
      .select('exercise_id,activity_met_id,intensity_variant,match_confidence,match_method,active')
      .eq('active', true)
      .in('exercise_id', exercises.map((exercise) => exercise.id));

    if (error) throw error;
    maps = data || [];
  } catch (error) {
    return {
      resolved: false,
      calories: null,
      reason: 'met_map_lookup_failed',
      message: error?.message || 'Could not read exercise_met_map.',
    };
  }

  const bestMap = chooseBestMap(maps, intensity);
  if (!bestMap) {
    return { resolved: false, calories: null, reason: 'met_mapping_missing' };
  }

  let activity;
  try {
    const { data, error } = await supabase
      .from('master_activity_mets')
      .select('id,met_value,description,major_heading,activity_code,search_key,source_key')
      .eq('id', bestMap.activity_met_id)
      .eq('active', true)
      .single();

    if (error) throw error;
    activity = data;
  } catch (error) {
    return {
      resolved: false,
      calories: null,
      reason: 'activity_met_lookup_failed',
      message: error?.message || 'Could not read master_activity_mets.',
    };
  }

  const calories = calculateCaloriesFromMet(activity?.met_value, durationMinutes, weightKg);
  if (calories === null) {
    return { resolved: false, calories: null, reason: 'invalid_calorie_inputs' };
  }

  return {
    resolved: true,
    calories,
    met: Number(activity.met_value),
    source: 'master_activity_mets',
    matchConfidence: Number(bestMap.match_confidence || 0),
    matchMethod: bestMap.match_method,
    activity,
    exercise: exercises.find((exercise) => exercise.id === bestMap.exercise_id) || exercises[0],
  };
}
