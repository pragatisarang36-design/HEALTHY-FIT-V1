const createExercise = (id, name, category, muscles, blockedForInjuries = [], equipment = ['none'], level = ['beginner', 'intermediate']) => ({
  id,
  name,
  category,
  level,
  equipment,
  muscles,
  sets: category === 'cardio' ? 1 : 3,
  reps: category === 'cardio' ? '20-35 minutes' : '10-15',
  duration: category === 'mobility' ? '30 seconds each side' : '',
  duration_seconds: category === 'mobility' ? 30 : 0,
  intensity: category === 'cardio' ? 'moderate' : 'controlled',
  blockedForInjuries,
  unsafeFor: blockedForInjuries,
  goals: category === 'cardio' ? ['weight_loss', 'maintenance'] : ['muscle_gain', 'maintenance', 'weight_loss'],
  instructions: [
    'Keep posture tall and breathing steady.',
    'Move through a pain-free range.',
    'Stop if sharp pain appears.',
  ],
});

const baseExercises = [
  ['brisk-walk', 'Brisk Walk', 'cardio', ['legs', 'heart']],
  ['stationary-cycle', 'Stationary Cycling', 'cardio', ['legs', 'heart'], [], ['bike']],
  ['march-in-place', 'March in Place', 'cardio', ['legs', 'heart']],
  ['bodyweight-squat', 'Bodyweight Squat', 'strength', ['quads', 'glutes'], ['knee_pain']],
  ['glute-bridge', 'Glute Bridge', 'strength', ['glutes', 'hamstrings']],
  ['seated-knee-extension', 'Seated Knee Extension', 'strength', ['quads']],
  ['calf-raise', 'Calf Raise', 'strength', ['calves']],
  ['wall-sit', 'Wall Sit', 'strength', ['quads'], ['knee_pain']],
  ['step-up-low', 'Low Step-Up', 'strength', ['quads', 'glutes'], ['knee_pain'], ['bench']],
  ['incline-pushup', 'Incline Pushup', 'strength', ['chest', 'triceps'], ['wrist_pain', 'shoulder_pain'], ['bench']],
  ['pushup', 'Pushup', 'strength', ['chest', 'triceps'], ['wrist_pain', 'shoulder_pain']],
  ['band-row', 'Resistance Band Row', 'strength', ['back', 'biceps'], [], ['band']],
  ['dumbbell-row', 'Dumbbell Row', 'strength', ['back', 'biceps'], ['lower_back_pain'], ['dumbbells']],
  ['dead-bug', 'Dead Bug', 'core', ['core']],
  ['bird-dog', 'Bird Dog', 'core', ['core', 'back'], ['wrist_pain']],
  ['side-plank', 'Side Plank', 'core', ['core'], ['wrist_pain', 'shoulder_pain']],
  ['wall-angels', 'Wall Angels', 'mobility', ['upper back', 'shoulders'], ['shoulder_pain']],
  ['cat-cow', 'Cat Cow', 'mobility', ['spine'], ['wrist_pain']],
  ['jump-squat', 'Jump Squat', 'power', ['legs'], ['knee_pain', 'lower_back_pain'], ['none'], ['advanced']],
  ['burpee', 'Burpee', 'conditioning', ['full body'], ['knee_pain', 'wrist_pain', 'shoulder_pain', 'lower_back_pain'], ['none'], ['advanced']],
  ['overhead-press', 'Overhead Press', 'strength', ['shoulders', 'triceps'], ['shoulder_pain', 'lower_back_pain'], ['dumbbells'], ['intermediate', 'advanced']],
  ['deadlift', 'Deadlift', 'strength', ['back', 'glutes', 'hamstrings'], ['lower_back_pain'], ['barbell'], ['advanced']],
];

const variants = ['tempo', 'pause', 'slow', 'controlled'];

export const localExerciseDatabase = baseExercises.flatMap(([id, name, category, muscles, blocked = [], equipment, level]) => [
  createExercise(id, name, category, muscles, blocked, equipment, level),
  ...variants.map((variant) =>
    createExercise(`${id}-${variant}`, `${variant[0].toUpperCase()}${variant.slice(1)} ${name}`, category, muscles, blocked, equipment, level)
  ),
]);
