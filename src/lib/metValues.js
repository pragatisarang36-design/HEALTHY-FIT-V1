// MET values for calorie calculation: Calories = MET × weight(kg) × duration(hours)
const MET_VALUES = {
    walking: { low: 2.5, moderate: 3.5, high: 5.0 },
    running: { low: 6.0, moderate: 8.5, high: 11.0 },
    cycling: { low: 4.0, moderate: 6.8, high: 10.0 },
    gym: { low: 3.5, moderate: 5.0, high: 8.0 },
    yoga: { low: 2.5, moderate: 3.0, high: 4.0 },
    skipping: { low: 8.0, moderate: 10.0, high: 12.0 },
    dancing: { low: 3.5, moderate: 5.5, high: 7.5 },
    football: { low: 5.0, moderate: 7.0, high: 10.0 },
    cricket: { low: 3.0, moderate: 5.0, high: 7.0 },
    basketball: { low: 4.5, moderate: 6.5, high: 8.0 },
    swimming: { low: 4.5, moderate: 7.0, high: 10.0 },
    hiking: { low: 4.0, moderate: 6.0, high: 8.0 },
    pilates: { low: 3.0, moderate: 4.0, high: 5.5 },
    boxing: { low: 5.0, moderate: 7.5, high: 10.0 },
    martial_arts: { low: 5.0, moderate: 7.5, high: 10.5 },
    tennis: { low: 4.0, moderate: 6.0, high: 8.0 },
    badminton: { low: 4.0, moderate: 5.5, high: 7.0 },
    other_sport: { low: 4.0, moderate: 6.0, high: 8.0 },
  };
  
  export function calculateCaloriesBurned(workoutType, intensity, durationMinutes, weightKg) {
    const met = MET_VALUES[workoutType]?.[intensity] || 5.0;
    const durationHours = durationMinutes / 60;
    return Math.round(met * weightKg * durationHours);
  }
  
  export function getWorkoutLabel(type) {
    const labels = {
      walking: 'Walking', running: 'Running', cycling: 'Cycling', gym: 'Gym / Weights',
      yoga: 'Yoga', skipping: 'Skipping', dancing: 'Dancing', football: 'Football',
      cricket: 'Cricket', basketball: 'Basketball', swimming: 'Swimming', hiking: 'Hiking',
      pilates: 'Pilates', boxing: 'Boxing', martial_arts: 'Martial Arts', tennis: 'Tennis',
      badminton: 'Badminton', other_sport: 'Other Sport',
    };
    return labels[type] || type;
  }
  
  export const WORKOUT_TYPES = Object.keys(MET_VALUES);