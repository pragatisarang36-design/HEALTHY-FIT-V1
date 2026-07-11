import { supabase } from '@/lib/supabaseClient';

const PAGE_SIZE = 1000;
const MAX_ROWS = 12000;

let exerciseCache = null;

const normalize = (value) => String(value || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const unique = (values = []) => [...new Set(
  values
    .flat()
    .map((value) => String(value || '').trim())
    .filter(Boolean)
)];

const sourceWeight = {
  free_exercise_db: 8,
  exercemus: 8,
  kaggle_fitness_exercises: 7,
  kaggle_megagym: 6,
  kaggle_gym_exercises_dataset: 6,
};

const categoryGoals = (category) => {
  if (category === 'cardio' || category === 'conditioning') return ['weight_loss', 'maintenance'];
  if (category === 'mobility') return ['maintenance'];
  return ['muscle_gain', 'maintenance', 'weight_loss'];
};

const rowQualityScore = (row) => {
  let score = sourceWeight[row.source_key] || 4;
  score += Number(row.confidence || 0) * 4;
  score += Math.min((row.instructions || []).length, 5) * 0.4;
  score += Math.min((row.primary_muscles || []).length, 3) * 0.3;
  if ((row.image_paths || []).length) score += 0.5;
  return score;
};

// Free-exercise-db-style equipment tags that can appear in an exercise name even when the
// row's equipment array is empty (e.g. a scrape gap). Checked in order; first match wins.
const NAME_EQUIPMENT_HINTS = [
  [/barbell/, 'barbell'],
  [/dumbbell/, 'dumbbell'],
  [/kettlebell/, 'kettlebell'],
  [/\bcable\b/, 'cable'],
  [/\bmachine\b/, 'machine'],
  [/\bband(s)?\b/, 'band'],
  [/\bbench\b/, 'bench'],
  [/medicine ball/, 'medicine_ball'],
  [/(exercise|stability|swiss) ball/, 'exercise_ball'],
  [/\b(bodyweight|body-weight|push[- ]?up|pull[- ]?up|plank|sit[- ]?up|squat jump|burpee)\b/, 'none'],
];

const inferEquipmentFromName = (name) => {
  const lower = String(name || '').toLowerCase();
  const hit = NAME_EQUIPMENT_HINTS.find(([pattern]) => pattern.test(lower));
  return hit ? hit[1] : null;
};

const FALLBACK_INSTRUCTIONS_BY_CATEGORY = {
  cardio: ['No detailed instructions were imported for this exercise. Maintain a steady, controlled pace and stop if you feel sharp pain or dizziness.'],
  mobility: ['No detailed instructions were imported for this exercise. Move slowly through the full range of motion and never stretch into sharp pain.'],
  default: ['No detailed instructions were imported for this exercise yet. Use slow, controlled form, and check a trainer or a reputable demonstration video if you are unfamiliar with this movement.'],
};

const instructionsFor = (row, category) => {
  if (row.instructions?.length) return row.instructions;
  return FALLBACK_INSTRUCTIONS_BY_CATEGORY[category] || FALLBACK_INSTRUCTIONS_BY_CATEGORY.default;
};

const toPlannerExercise = (row) => {
  const category = row.category || 'strength';
  const primary = row.primary_muscles || [];
  const secondary = row.secondary_muscles || [];
  let equipment = row.equipment?.length ? row.equipment : null;
  let equipmentUnverified = false;

  if (!equipment) {
    const inferred = inferEquipmentFromName(row.name);
    if (inferred) {
      equipment = [inferred];
    } else {
      // Don't silently assume bodyweight -- that's exactly the "safe-ish but not always
      // accurate" risk flagged in the audit. Flag it instead so the planner can decide
      // whether it's safe to show (see workoutPlannerEngine.js's equipment filter).
      equipment = ['unknown'];
      equipmentUnverified = true;
    }
  }

  return {
    id: `${row.source_key || 'master'}-${row.id || row.search_key}`,
    name: row.name,
    category,
    level: row.level?.length ? row.level : ['beginner', 'intermediate'],
    equipment,
    muscles: unique([...primary, ...secondary]),
    sets: row.default_sets || (category === 'cardio' ? 1 : 3),
    reps: row.default_reps || (category === 'cardio' ? '20-35 minutes' : '10-15'),
    duration_seconds: row.duration_seconds || 0,
    intensity: row.intensity || (category === 'cardio' ? 'moderate' : 'controlled'),
    unsafeFor: row.unsafe_for || [],
    goals: row.goals?.length ? row.goals : categoryGoals(category),
    instructions: instructionsFor(row, category),
    instructionsGenerated: !row.instructions?.length,
    source: row.source_key || 'master_exercises',
    confidence: Number(row.confidence || 0.75),
    qualityScore: rowQualityScore(row),
    equipmentUnverified,
  };
};

const mergeExercises = (current, candidate) => {
  if (!current) return candidate;

  const best = candidate.qualityScore > current.qualityScore ? candidate : current;
  const equipmentUnverified = current.equipmentUnverified && candidate.equipmentUnverified;
  const mergedEquipment = unique([...current.equipment, ...candidate.equipment]);

  const realInstructions = !current.instructionsGenerated ? current : !candidate.instructionsGenerated ? candidate : best;

  return {
    ...best,
    id: best.id,
    equipment: equipmentUnverified ? mergedEquipment : mergedEquipment.filter((item) => item !== 'unknown'),
    muscles: unique([...current.muscles, ...candidate.muscles]),
    unsafeFor: unique([...(current.unsafeFor || []), ...(candidate.unsafeFor || [])]),
    goals: unique([...(current.goals || []), ...(candidate.goals || [])]),
    level: unique([...(current.level || []), ...(candidate.level || [])]),
    instructions: realInstructions.instructions,
    instructionsGenerated: realInstructions.instructionsGenerated,
    source: unique([current.source, candidate.source]).join(', '),
    qualityScore: Math.max(current.qualityScore || 0, candidate.qualityScore || 0),
    equipmentUnverified,
  };
};

const dedupeExercises = (rows) => {
  const grouped = new Map();

  rows
    .map(toPlannerExercise)
    .filter((exercise) => exercise.name && normalize(exercise.name))
    .forEach((exercise) => {
      const equipmentKey = unique(exercise.equipment || ['none'])
        .map(normalize)
        .sort()
        .join(',');
      const key = `${normalize(exercise.name)}::${equipmentKey}`;
      grouped.set(key, mergeExercises(grouped.get(key), exercise));
    });

  return [...grouped.values()].sort((a, b) => b.qualityScore - a.qualityScore || a.name.localeCompare(b.name));
};

async function fetchMasterExerciseRows() {
  const rows = [];

  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('master_exercises')
      .select('id,name,search_key,category,level,equipment,primary_muscles,secondary_muscles,instructions,image_paths,unsafe_for,goals,default_sets,default_reps,duration_seconds,intensity,source_key,confidence,active')
      .eq('active', true)
      .order('source_key', { ascending: true })
      .order('name', { ascending: true })
      .range(from, to);

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}

// Resolved-view row shape already matches what toPlannerExercise expects for the fields it
// reads directly (equipment/instructions/instructions_generated are already merged server-side),
// so it reuses the same mapper rather than duplicating field-by-field logic.
const toPlannerExerciseFromResolvedRow = (row) => ({
  ...toPlannerExercise({
    ...row,
    equipment: row.equipment,
    instructions: row.instructions_generated ? [] : row.instructions,
  }),
  qualityScore: Number(row.quality_score || 0),
  equipmentUnverified: row.had_missing_equipment_row && row.equipment?.every((item) => item === 'none'),
  source: row.contributing_sources?.join(', ') || 'master_exercises_resolved_view',
});

async function fetchResolvedExerciseRows() {
  const rows = [];

  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('master_exercises_resolved_view')
      .select('id,name,search_key,equipment_signature,category,mechanic,force,equipment,level,primary_muscles,secondary_muscles,unsafe_for,instructions,instructions_generated,default_sets,default_reps,duration_seconds,intensity,confidence,quality_score,duplicate_row_count,contributing_sources,had_missing_equipment_row,had_missing_instructions_row')
      .order('name', { ascending: true })
      .range(from, to);

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}

export async function getWorkoutExerciseDatabase() {
  if (exerciseCache) return exerciseCache;

  // Prefer the server-side resolved view (Phase 4: supabase/master-exercises-resolved-view.sql)
  // so dedupe happens once in the DB for every consumer, not just this client at runtime.
  try {
    const resolvedRows = await fetchResolvedExerciseRows();
    if (resolvedRows.length >= 50) {
      exerciseCache = {
        exercises: resolvedRows.map(toPlannerExerciseFromResolvedRow).sort((a, b) => b.qualityScore - a.qualityScore || a.name.localeCompare(b.name)),
        sourceLabel: `Supabase master_exercises_resolved_view (${resolvedRows.length} resolved exercises)`,
        usedFallback: false,
      };
      return exerciseCache;
    }
  } catch (error) {
    console.warn('Resolved exercise view unavailable, falling back to raw table + client dedupe:', error);
  }

  try {
    const rows = await fetchMasterExerciseRows();
    const deduped = dedupeExercises(rows);

    if (deduped.length >= 50) {
      exerciseCache = {
        exercises: deduped,
        sourceLabel: `Supabase master_exercises (${rows.length} rows, ${deduped.length} deduped)`,
        usedFallback: false,
      };
      return exerciseCache;
    }
  } catch (error) {
    console.warn('Falling back to local workout exercises:', error);
  }

  const { exerciseDatabase: localExerciseDatabase } = await import('@/data/localExerciseDatabase');

  exerciseCache = {
    exercises: localExerciseDatabase,
    sourceLabel: 'local generated exercise database fallback',
    usedFallback: true,
  };
  return exerciseCache;
}

export async function searchWorkoutExercises(query, limit = 20) {
  const term = String(query || '').trim();
  if (term.length < 2) return [];

  const normalizedTerm = normalize(term);
  const select = 'id,name,name_key,search_key,category,equipment,primary_muscles,confidence,source_key,active';
  const [nameResult, keyResult] = await Promise.all([
    supabase
      .from('master_exercises')
      .select(select)
      .eq('active', true)
      .ilike('name', `%${term}%`)
      .order('confidence', { ascending: false })
      .limit(limit),
    supabase
      .from('master_exercises')
      .select(select)
      .eq('active', true)
      .ilike('search_key', `%${normalizedTerm}%`)
      .order('confidence', { ascending: false })
      .limit(limit),
  ]);

  if (nameResult.error) throw nameResult.error;
  if (keyResult.error) throw keyResult.error;

  const rows = new Map();
  for (const row of [...(nameResult.data || []), ...(keyResult.data || [])]) {
    rows.set(row.id, row);
  }

  return [...rows.values()]
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function clearWorkoutExerciseCache() {
  exerciseCache = null;
}
