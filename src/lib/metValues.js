const WORKOUT_LABELS = {
  walking: 'Walking',
  running: 'Running',
  cycling: 'Cycling',
  gym: 'Gym / Weights',
  yoga: 'Yoga',
  skipping: 'Skipping',
  dancing: 'Dancing',
  football: 'Football',
  cricket: 'Cricket',
  basketball: 'Basketball',
  swimming: 'Swimming',
  hiking: 'Hiking',
  pilates: 'Pilates',
  boxing: 'Boxing',
  martial_arts: 'Martial Arts',
  tennis: 'Tennis',
  badminton: 'Badminton',
  other_sport: 'Other Sport',
};

export function getWorkoutLabel(type) {
  return WORKOUT_LABELS[type] || type;
}

export const WORKOUT_TYPES = Object.keys(WORKOUT_LABELS);
