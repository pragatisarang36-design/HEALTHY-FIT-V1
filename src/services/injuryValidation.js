const norm = (value) => String(value || '').toLowerCase().replace(/[\s-]+/g, '_').trim();

const injuryAliases = {
  knee_pain: ['knee', 'patella', 'acl'],
  lower_back_pain: ['lower back', 'back pain', 'lumbar', 'spine'],
  shoulder_pain: ['shoulder', 'rotator'],
  wrist_pain: ['wrist', 'hand pain'],
};

export const hardBlockedExerciseNames = {
  knee_pain: ['jump squat', 'burpee', 'jumping lunge', 'box jump'],
  lower_back_pain: ['deadlift', 'good morning', 'heavy squat'],
  shoulder_pain: ['overhead press', 'dip', 'handstand'],
  wrist_pain: ['pushup', 'plank', 'mountain climber'],
};

export const parseInjuries = (injuryNote = '', customPreference = '') => {
  const raw = `${injuryNote} ${customPreference}`.toLowerCase();
  return Object.entries(injuryAliases)
    .filter(([key, aliases]) => raw.includes(key.replace('_', ' ')) || aliases.some((alias) => raw.includes(alias)))
    .map(([key]) => key);
};

export const isExerciseSafe = (exercise, injuries = []) => {
  const name = String(exercise.name || '').toLowerCase();
  const unsafe = new Set((exercise.unsafeFor || []).map(norm));

  for (const injury of injuries) {
    if (unsafe.has(injury)) return false;
    if ((hardBlockedExerciseNames[injury] || []).some((blocked) => name.includes(blocked))) return false;
  }

  return true;
};

export const safetyNotesFor = (injuries = []) => {
  if (!injuries.length) return ['No injuries selected. Keep every movement pain-free and controlled.'];

  return injuries.map((injury) => {
    if (injury === 'knee_pain') return 'Knee pain considered: jumping and deep knee-dominant movements were removed.';
    if (injury === 'lower_back_pain') return 'Lower back pain considered: heavy hinge and loaded squat patterns were removed.';
    if (injury === 'shoulder_pain') return 'Shoulder pain considered: overhead pressing, dips, and handstand work were removed.';
    if (injury === 'wrist_pain') return 'Wrist pain considered: pushup, plank, and mountain climber patterns were removed.';
    return `${injury.replace(/_/g, ' ')} considered: plan keeps intensity conservative.`;
  });
};
