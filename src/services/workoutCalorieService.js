import { supabase } from '@/lib/supabaseClient';

const normalizeExerciseKey = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const intensityRank = {
  low: ['low', 'light', 'easy'],
  moderate: ['moderate', 'medium'],
  high: ['high', 'vigorous', 'hard'],
};

const singularizeLastWord = (value) => {
  const words = normalizeExerciseKey(value).split(' ').filter(Boolean);
  const last = words[words.length - 1] || '';
  if (!last) return normalizeExerciseKey(value);
  let singular = last;
  if (last.endsWith('ies') && last.length > 3) singular = `${last.slice(0, -3)}y`;
  else if (last.endsWith('es') && last.length > 3) singular = last.slice(0, -2);
  else if (last.endsWith('s') && last.length > 3) singular = last.slice(0, -1);
  return [...words.slice(0, -1), singular].join(' ');
};

const searchTermsFor = (value) => [...new Set([
  normalizeExerciseKey(value),
  singularizeLastWord(value),
].filter((item) => item.length >= 3))];

const fallbackActivityResolvers = [
  {
    pattern: /\b(squat|lunge|push up|pull up|plank|sit up|crunch|burpee)\b/,
    method: 'canonical_bodyweight_strength_resolver',
    confidence: 0.68,
    activityByIntensity: {
      low: 'body weight resistance exercises e g squat lunge push up crunch general',
      moderate: 'body weight resistance exercises e g squat lunge push up crunch general',
      high: 'body weight resistance exercises e g squat lunge push up crunch high intensity',
    },
  },
  {
    pattern: /\b(bench press|deadlift|barbell|dumbbell|kettlebell|curl|row|shoulder press|leg press|lat pulldown|weight training|weight lifting)\b/,
    method: 'canonical_weight_training_resolver',
    confidence: 0.66,
    activityByIntensity: {
      low: 'resistance weight training multiple exercises 8 15 reps at varied resistance',
      moderate: 'resistance weight training multiple exercises 8 15 reps at varied resistance',
      high: 'resistance weight lifting free weight nautilus or universal type power lifting or body building vigorous effort taylor code 210',
    },
  },
];

export const workoutResolutionKey = (workout = {}) => [
  workout.date || '',
  normalizeExerciseKey(workout.workout_type || workout.workoutType),
  Number(workout.duration_minutes ?? workout.durationMinutes ?? workout.duration) || 0,
].join('|');

export const unresolvedWorkoutLogData = ({ workoutType, exerciseId, intensity, durationMinutes, weightKg, reason, message, date }) => {
  const workout = {
    date,
    workout_type: workoutType,
    duration_minutes: durationMinutes,
  };

  return {
    resolution_key: workoutResolutionKey(workout),
    raw_label: workoutType,
    workout_type: workoutType,
    exercise_id: exerciseId || null,
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

const intensityKey = (intensity) => {
  const key = normalizeExerciseKey(intensity);
  if (intensityRank.high.includes(key)) return 'high';
  if (intensityRank.low.includes(key)) return 'low';
  return 'moderate';
};

const activityScore = (activity, terms, intensity) => {
  const searchKey = normalizeExerciseKey(activity.search_key);
  const description = normalizeExerciseKey(activity.description);
  const majorHeading = normalizeExerciseKey(activity.major_heading);
  const words = new Set(terms.flatMap((term) => term.split(' ').filter((word) => word.length >= 3)));
  let score = 0;

  for (const term of terms) {
    if (searchKey === term) score += 10;
    else if (searchKey.startsWith(term)) score += 7;
    else if (searchKey.includes(term)) score += 5;
    else if (description.includes(term)) score += 3;
  }

  for (const word of words) {
    if (searchKey.split(' ').includes(word)) score += 1;
  }

  const intensityAliases = intensityRank[intensityKey(intensity)] || [];
  if (intensityAliases.some((alias) => searchKey.includes(alias) || description.includes(alias))) score += 1.5;
  if (majorHeading && terms.some((term) => majorHeading.includes(term))) score += 1;
  return score;
};

async function findActivityBySearchKey(searchKey) {
  const { data, error } = await supabase
    .from('master_activity_mets')
    .select('id,met_value,description,major_heading,activity_code,search_key,source_key')
    .eq('active', true)
    .eq('source_key', 'adult_compendium_2024')
    .eq('search_key', searchKey)
    .single();

  if (error) throw error;
  return data;
}

async function findRuleResolvedActivity(exercise, intensity) {
  const haystack = normalizeExerciseKey([
    exercise?.name,
    exercise?.search_key,
    exercise?.name_key,
    exercise?.category,
    ...(exercise?.equipment || []),
  ].filter(Boolean).join(' '));
  const resolver = fallbackActivityResolvers.find((item) => item.pattern.test(haystack));
  if (!resolver) return null;

  const key = intensityKey(intensity);
  const searchKey = resolver.activityByIntensity[key] || resolver.activityByIntensity.moderate;
  const activity = await findActivityBySearchKey(searchKey);
  return {
    activity,
    matchConfidence: resolver.confidence,
    matchMethod: resolver.method,
  };
}

async function findTextMatchedActivity(exercise, workoutType, intensity) {
  const terms = searchTermsFor(exercise?.name || workoutType);
  if (!terms.length) return null;

  const results = await Promise.all(
    terms.map((term) => supabase
      .from('master_activity_mets')
      .select('id,met_value,description,major_heading,activity_code,search_key,source_key')
      .eq('active', true)
      .eq('source_key', 'adult_compendium_2024')
      .ilike('search_key', `%${term}%`)
      .limit(12))
  );

  const error = results.find((result) => result.error)?.error;
  if (error) throw error;

  const activities = new Map();
  for (const result of results) {
    for (const activity of result.data || []) {
      activities.set(activity.id, activity);
    }
  }

  const best = [...activities.values()]
    .map((activity) => ({ activity, score: activityScore(activity, terms, intensity) }))
    .filter((item) => item.score >= 7)
    .sort((a, b) => b.score - a.score || Number(a.activity.met_value || 0) - Number(b.activity.met_value || 0))[0];

  if (!best) return null;
  return {
    activity: best.activity,
    matchConfidence: Math.min(0.74, 0.52 + best.score / 40),
    matchMethod: 'master_activity_mets_text_match',
  };
}

async function loadActivityForMap(bestMap) {
  const { data, error } = await supabase
    .from('master_activity_mets')
    .select('id,met_value,description,major_heading,activity_code,search_key,source_key')
    .eq('id', bestMap.activity_met_id)
    .eq('active', true)
    .single();

  if (error) throw error;
  return data;
}

const resolvedEstimate = ({ activity, exercise, durationMinutes, weightKg, matchConfidence, matchMethod }) => {
  const calories = calculateCaloriesFromMet(activity?.met_value, durationMinutes, weightKg);
  if (calories === null) {
    return { resolved: false, calories: null, reason: 'invalid_calorie_inputs' };
  }

  return {
    resolved: true,
    calories,
    met: Number(activity.met_value),
    source: 'master_activity_mets',
    matchConfidence: Number(matchConfidence || 0),
    matchMethod,
    activity,
    exercise,
  };
};

export async function estimateWorkoutCalories({ workoutType, exerciseId, intensity, durationMinutes, weightKg }) {
  const nameKey = normalizeExerciseKey(workoutType);
  if (!exerciseId && !nameKey) {
    return { resolved: false, calories: null, reason: 'missing_workout_type' };
  }

  let exercises;
  try {
    let query = supabase
      .from('master_exercises')
      .select('id,name,search_key,name_key,category,equipment')
      .eq('active', true);

    query = exerciseId ? query.eq('id', exerciseId) : query.eq('name_key', nameKey);

    const { data, error } = await query
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
  const primaryExercise = exercises.find((exercise) => exercise.id === bestMap?.exercise_id) || exercises[0];

  if (bestMap) {
    try {
      const activity = await loadActivityForMap(bestMap);
      return resolvedEstimate({
        activity,
        exercise: primaryExercise,
        durationMinutes,
        weightKg,
        matchConfidence: Number(bestMap.match_confidence || 0),
        matchMethod: bestMap.match_method,
      });
    } catch (error) {
      return {
        resolved: false,
        calories: null,
        reason: 'activity_met_lookup_failed',
        message: error?.message || 'Could not read master_activity_mets.',
      };
    }
  }

  try {
    const ruleResolved = await findRuleResolvedActivity(primaryExercise, intensity);
    if (ruleResolved) {
      return resolvedEstimate({
        ...ruleResolved,
        exercise: primaryExercise,
        durationMinutes,
        weightKg,
      });
    }
  } catch (error) {
    return {
      resolved: false,
      calories: null,
      reason: 'activity_met_lookup_failed',
      message: error?.message || 'Could not read rule-resolved master_activity_mets row.',
    };
  }

  try {
    const textMatched = await findTextMatchedActivity(primaryExercise, workoutType, intensity);
    if (textMatched) {
      return resolvedEstimate({
        ...textMatched,
        exercise: primaryExercise,
        durationMinutes,
        weightKg,
      });
    }
  } catch (error) {
    return {
      resolved: false,
      calories: null,
      reason: 'activity_met_lookup_failed',
      message: error?.message || 'Could not search master_activity_mets.',
    };
  }

  return { resolved: false, calories: null, reason: 'met_mapping_missing' };
}
