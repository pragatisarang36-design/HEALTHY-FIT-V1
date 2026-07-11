import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { dataService } from '@/services/dataService';
import { useProfile } from '@/lib/useProfile';
import { useAuth } from '@/lib/AuthContext';
import { attachWorkoutResolutionState } from '@/services/workoutCalorieService';
import { format } from 'date-fns';
import { Flame, Dumbbell, Droplets, Weight, Target, TrendingDown, Utensils, Activity, Loader2 } from 'lucide-react';
import StatCard from '@/components/ui/StatCard';
import GlassCard from '@/components/ui/GlassCard';
import EmptyState from '@/components/ui/EmptyState';
import { Progress } from '@/components/ui/progress';

export default function Dashboard() {
  const { profile, isLoading: profileLoading, isProfileComplete } = useProfile();
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: meals = [] } = useQuery({
    queryKey: ['meals-today', today, user?.id],
    queryFn: () => dataService.entities.Meal.filter({ date: today, created_by: user?.email }),
    initialData: [],
    enabled: isProfileComplete && !!user?.email,
  });

  const { data: workouts = [] } = useQuery({
    queryKey: ['workouts-today', today, user?.id],
    queryFn: () => dataService.entities.Workout.filter({ date: today, created_by: user?.email }),
    initialData: [],
    enabled: isProfileComplete && !!user?.email,
  });

  const { data: unresolvedWorkoutMetLogs = [] } = useQuery({
    queryKey: ['dashboard-workout-met-unresolved', user?.id],
    queryFn: () => dataService.entities.WorkoutMetUnresolved.filter({ created_by: user?.email }, '-created_date', 100),
    initialData: [],
    enabled: isProfileComplete && !!user?.email,
  });

  const { data: waterEntries = [] } = useQuery({
    queryKey: ['water-today', today, user?.id],
    queryFn: () => dataService.entities.WaterIntake.filter({ date: today, created_by: user?.email }),
    initialData: [],
    enabled: isProfileComplete && !!user?.email,
  });

  const { data: weightLogs = [] } = useQuery({
    queryKey: ['weight-recent', user?.id],
    queryFn: () => dataService.entities.WeightLog.filter({ created_by: user?.email }, '-date', 5),
    initialData: [],
    enabled: isProfileComplete && !!user?.email,
  });

  const stats = useMemo(() => {
    const caloriesConsumed = meals.reduce((sum, m) => sum + (m.calories || 0), 0);
    const workoutsWithResolution = attachWorkoutResolutionState(workouts, unresolvedWorkoutMetLogs);
    const workoutsWithCalories = workoutsWithResolution.filter((w) => !w.calories_unresolved);
    const caloriesBurned = workoutsWithCalories.reduce((sum, w) => sum + (w.calories_burned || 0), 0);
    const netCalories = caloriesConsumed - caloriesBurned;
    const workoutMinutes = workoutsWithResolution.reduce((sum, w) => sum + (w.duration_minutes || 0), 0);
    const unresolvedWorkoutCalories = workoutsWithResolution.length - workoutsWithCalories.length;
    const waterGlasses = waterEntries.reduce((sum, w) => sum + (w.glasses || 0), 0);
    const waterGoalGlasses = Math.round((profile?.water_goal_litres || 2.5) * 5);
    const latestWeight = weightLogs[0]?.weight || profile?.weight || 0;
    const targetWeight = profile?.target_weight || 0;

    return { caloriesConsumed, caloriesBurned, netCalories, workoutMinutes, unresolvedWorkoutCalories, waterGlasses, waterGoalGlasses, latestWeight, targetWeight };
  }, [meals, workouts, unresolvedWorkoutMetLogs, waterEntries, weightLogs, profile]);

  if (profileLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  if (!isProfileComplete) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mb-4">
          <Dumbbell className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-heading font-bold">Welcome to Healthy Fit</h1>
        <p className="text-muted-foreground mt-2 max-w-md">Set up your profile to get started with personalized tracking.</p>
        <button
          onClick={() => navigate('/profile')}
          className="mt-6 px-6 py-3 rounded-xl gradient-primary text-white font-semibold shadow-lg hover:opacity-90 transition-opacity"
        >
          Set Up Profile
        </button>
      </div>
    );
  }

  const waterPercent = stats.waterGoalGlasses > 0 ? Math.min(100, Math.round((stats.waterGlasses / stats.waterGoalGlasses) * 100)) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">
          {profile?.name ? `Welcome, ${profile.name}` : 'Dashboard'}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Calories In" value={stats.caloriesConsumed} unit="kcal" icon={Flame} color="orange" />
        <StatCard title="Calories Burned" value={stats.caloriesBurned} unit="kcal" icon={Activity} color="red" />
        <StatCard title="Net Calories" value={stats.netCalories} unit="kcal" icon={Target} color="emerald" />
        <StatCard title="Workout" value={stats.workoutMinutes} unit="min" icon={Dumbbell} color="blue" />
      </div>
      {stats.unresolvedWorkoutCalories > 0 && (
        <p className="text-xs text-amber-500">
          {stats.unresolvedWorkoutCalories} workout{stats.unresolvedWorkoutCalories === 1 ? '' : 's'} excluded from calorie totals until MET mapping is available.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GlassCard>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Droplets className="w-4 h-4 text-blue-500" /> Hydration
            </h3>
            <Link to="/water" className="text-xs text-primary hover:underline">View</Link>
          </div>
          <div className="flex items-end gap-2 mb-2">
            <span className="text-3xl font-bold font-heading">{stats.waterGlasses}</span>
            <span className="text-muted-foreground text-sm mb-1">/ {stats.waterGoalGlasses} glasses</span>
          </div>
          <Progress value={waterPercent} className="h-2" />
          <p className="text-xs text-muted-foreground mt-1">{waterPercent}% of daily goal</p>
        </GlassCard>

        <GlassCard>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Weight className="w-4 h-4 text-purple-500" /> Weight Progress
            </h3>
            <Link to="/weight" className="text-xs text-primary hover:underline">View</Link>
          </div>
          <div className="flex items-end gap-2 mb-2">
            <span className="text-3xl font-bold font-heading">{stats.latestWeight}</span>
            <span className="text-muted-foreground text-sm mb-1">kg</span>
          </div>
          {stats.targetWeight > 0 && (
            <>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingDown className="w-4 h-4" />
                Target: {stats.targetWeight} kg
                <span className="ml-auto font-medium">
                  {Math.abs(stats.latestWeight - stats.targetWeight).toFixed(1)} kg to go
                </span>
              </div>
            </>
          )}
        </GlassCard>
      </div>

      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Utensils className="w-4 h-4 text-orange-500" /> Today's Meals
          </h3>
          <Link to="/meals" className="text-xs text-primary hover:underline">Track Meals</Link>
        </div>
        {meals.length === 0 ? (
          <EmptyState icon={Utensils} title="No meals logged" description="Start tracking your meals to see data here." />
        ) : (
          <div className="space-y-2">
            {meals.slice(0, 5).map(m => (
              <div key={m.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                <div>
                  <p className="font-medium text-sm">{m.food_name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{m.meal_type}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-sm">{m.calories} kcal</p>
                  <p className="text-xs text-muted-foreground">P:{m.protein || 0}g C:{m.carbs || 0}g F:{m.fats || 0}g</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
