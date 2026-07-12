import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/lib/AuthContext';
import { useProfile } from '@/lib/useProfile';
import { getWorkoutLabel, WORKOUT_TYPES } from '@/lib/metValues';
import { attachWorkoutResolutionState, estimateWorkoutCalories, unresolvedWorkoutLogData } from '@/services/workoutCalorieService';
import { searchWorkoutExercises } from '@/services/workoutExerciseService';
import { format } from 'date-fns';
import { Check, Dumbbell, Plus, Loader2, Search, Trash2, Flame, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import GlassCard from '@/components/ui/GlassCard';
import EmptyState from '@/components/ui/EmptyState';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { useEnterSubmit } from '@/hooks/useEnterSubmit';

const initialForm = {
  workout_type: '',
  selected_exercise_id: '',
  selected_exercise_name: '',
  duration_minutes: '',
  intensity: '',
};

const formatTag = (value) => String(value || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const workoutDisplayName = (workoutType) => getWorkoutLabel(workoutType) || workoutType;

export default function WorkoutTracker() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const queryClient = useQueryClient();
  const { profile } = useProfile();
  const { user } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [isResolvingCalories, setIsResolvingCalories] = useState(false);

  const { data: weightLogs = [] } = useQuery({
    queryKey: ['workout-tracker-weight-recent', user?.id],
    queryFn: () => dataService.entities.WeightLog.filter({ created_by: user?.email }, '-date', 1),
    initialData: [],
    enabled: !!user?.email,
  });

  const { data: workouts = [], isLoading } = useQuery({
    queryKey: ['workouts-today', today, user?.id],
    queryFn: () => dataService.entities.Workout.filter({ date: today, created_by: user?.email }),
    initialData: [],
    enabled: !!user?.email,
  });

  const createMutation = useMutation({
    mutationFn: (data) => dataService.entities.Workout.create(data),
    onMutate: async (newWorkout) => {
      await queryClient.cancelQueries({ queryKey: ['workouts-today', today, user?.id] });
      const prev = queryClient.getQueryData(['workouts-today', today, user?.id]);
      queryClient.setQueryData(['workouts-today', today, user?.id], old => [...(old || []), { ...newWorkout, id: `temp-${Date.now()}` }]);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(['workouts-today', today, user?.id], ctx.prev);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workouts-today'] });
      setShowAdd(false);
      setForm(initialForm);
      setExerciseSearch('');
      toast({ title: 'Workout logged!' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => dataService.entities.Workout.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['workouts-today', today, user?.id] });
      const prev = queryClient.getQueryData(['workouts-today', today, user?.id]);
      queryClient.setQueryData(['workouts-today', today, user?.id], old => (old || []).filter(w => w.id !== id));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(['workouts-today', today, user?.id], ctx.prev);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workouts-today'] }),
  });

  const { data: unresolvedWorkoutMetLogs = [] } = useQuery({
    queryKey: ['workout-met-unresolved', user?.id],
    queryFn: () => dataService.entities.WorkoutMetUnresolved.filter({ created_by: user?.email }, '-created_date', 100),
    initialData: [],
    enabled: !!user?.email,
  });

  const latestWeight = Number(weightLogs[0]?.weight || profile?.weight || 0);
  const canEstimate = Boolean(form.workout_type && form.duration_minutes && form.intensity && latestWeight > 0);
  const { data: exerciseResults = [], isFetching: isSearchingExercises } = useQuery({
    queryKey: ['workout-exercise-search', exerciseSearch],
    queryFn: () => searchWorkoutExercises(exerciseSearch, 18),
    initialData: [],
    enabled: showAdd && exerciseSearch.trim().length >= 2,
    staleTime: 60_000,
  });
  const calorieEstimateQuery = useQuery({
    queryKey: ['workout-calorie-estimate', form.workout_type, form.selected_exercise_id, form.intensity, form.duration_minutes, latestWeight],
    queryFn: () => estimateWorkoutCalories({
      workoutType: form.workout_type,
      exerciseId: form.selected_exercise_id,
      intensity: form.intensity,
      durationMinutes: Number(form.duration_minutes),
      weightKg: latestWeight,
    }),
    enabled: canEstimate,
    staleTime: 60_000,
  });

  const handleAdd = async () => {
    if (createMutation.isPending || isResolvingCalories) return;
    if (!form.workout_type || !form.duration_minutes || !form.intensity) {
      toast({ title: 'Please fill all fields', variant: 'destructive' });
      return;
    }
    if (!latestWeight) {
      toast({ title: 'Add your current weight first', variant: 'destructive' });
      return;
    }

    setIsResolvingCalories(true);
    let estimate;
    try {
      estimate = await estimateWorkoutCalories({
        workoutType: form.workout_type,
        exerciseId: form.selected_exercise_id,
        intensity: form.intensity,
        durationMinutes: Number(form.duration_minutes),
        weightKg: latestWeight,
      });
    } catch (error) {
      estimate = {
        resolved: false,
        calories: null,
        reason: 'met_lookup_failed',
        message: error?.message,
      };
    } finally {
      setIsResolvingCalories(false);
    }

    if (!estimate.resolved) {
      dataService.entities.WorkoutMetUnresolved.create({
        plan_data: unresolvedWorkoutLogData({
          workoutType: form.workout_type,
          exerciseId: form.selected_exercise_id,
          intensity: form.intensity,
          durationMinutes: Number(form.duration_minutes),
          weightKg: latestWeight,
          reason: estimate.reason,
          message: estimate.message,
          date: today,
        }),
        date: today,
      })
        .then(() => queryClient.invalidateQueries({ queryKey: ['workout-met-unresolved', user?.id] }))
        .catch((error) => {
          console.warn('Failed to log unresolved workout MET lookup:', error?.message || error);
        });

      toast({
        title: 'MET mapping needed',
        description: 'Workout saved without a calorie estimate. No fallback MET was used.',
      });
    }

    createMutation.mutate({
      ...form,
      duration_minutes: Number(form.duration_minutes),
      calories_burned: estimate.calories ?? 0,
      calories_unresolved: !estimate.resolved,
      date: today,
    });
  };

  const selectCommonWorkout = (type) => {
    setForm((prev) => ({
      ...prev,
      workout_type: type,
      selected_exercise_id: '',
      selected_exercise_name: '',
    }));
    setExerciseSearch('');
  };

  const selectExercise = (exercise) => {
    setForm((prev) => ({
      ...prev,
      workout_type: exercise.name,
      selected_exercise_id: exercise.id,
      selected_exercise_name: exercise.name,
    }));
    setExerciseSearch(exercise.name);
  };

  const canLogWorkout = Boolean(form.workout_type && form.duration_minutes && form.intensity && !createMutation.isPending && !isResolvingCalories);
  const handleAddKeyDown = useEnterSubmit(handleAdd, canLogWorkout);

  const workoutsWithResolution = attachWorkoutResolutionState(workouts, unresolvedWorkoutMetLogs);
  const unresolvedCalorieCount = workoutsWithResolution.filter((w) => w.calories_unresolved).length;
  const totalBurned = workoutsWithResolution
    .filter((w) => !w.calories_unresolved)
    .reduce((sum, w) => sum + (w.calories_burned || 0), 0);
  const totalMinutes = workoutsWithResolution.reduce((sum, w) => sum + (w.duration_minutes || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">Workout Tracker</h1>
          <p className="text-muted-foreground text-sm">{format(new Date(), 'EEEE, MMMM d')}</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="gradient-primary text-white">
          <Plus className="w-4 h-4 mr-2" /> Log Workout
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <GlassCard className="text-center">
          <Flame className="w-6 h-6 text-red-500 mx-auto mb-1" />
          <p className="text-2xl font-bold font-heading">{totalBurned}</p>
          <p className="text-xs text-muted-foreground">kcal burned</p>
        </GlassCard>
        <GlassCard className="text-center">
          <Clock className="w-6 h-6 text-blue-500 mx-auto mb-1" />
          <p className="text-2xl font-bold font-heading">{totalMinutes}</p>
          <p className="text-xs text-muted-foreground">minutes active</p>
        </GlassCard>
      </div>

      <GlassCard>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : workoutsWithResolution.length === 0 ? (
          <EmptyState icon={Dumbbell} title="No workouts today" description="Start logging your workouts." />
        ) : (
          <div className="space-y-2">
            {workoutsWithResolution.map(w => (
              <div key={w.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-muted/50">
                <div>
                  <p className="font-medium text-sm">{workoutDisplayName(w.workout_type)}</p>
                  <p className="text-xs text-muted-foreground capitalize">{w.duration_minutes} min · {w.intensity}</p>
                </div>
                <div className="flex items-center gap-3">
                  <p className={`font-semibold text-sm ${w.calories_unresolved ? 'text-amber-500' : 'text-red-500'}`}>
                    {w.calories_unresolved ? 'MET needed' : `${w.calories_burned} kcal`}
                  </p>
                  <button onClick={() => deleteMutation.mutate(w.id)} className="p-1 text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
      {unresolvedCalorieCount > 0 && (
        <p className="text-xs text-amber-500">
          {unresolvedCalorieCount} workout{unresolvedCalorieCount === 1 ? '' : 's'} need MET mapping before calories can be counted.
        </p>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Log Workout</DialogTitle>
          </DialogHeader>
          <div className="space-y-4" onKeyDown={handleAddKeyDown}>
            <div>
              <Label>Workout</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={exerciseSearch}
                  onChange={(event) => {
                    setExerciseSearch(event.target.value);
                    setForm((prev) => ({
                      ...prev,
                      workout_type: event.target.value,
                      selected_exercise_id: '',
                      selected_exercise_name: '',
                    }));
                  }}
                  placeholder="Search exercise"
                  className="pl-9"
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {WORKOUT_TYPES.filter((type) => type !== 'other_sport').map((type) => (
                  <Badge
                    key={type}
                    variant={form.workout_type === type ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => selectCommonWorkout(type)}
                  >
                    {getWorkoutLabel(type)}
                  </Badge>
                ))}
              </div>
              {form.selected_exercise_id && (
                <div className="mt-2 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{form.selected_exercise_name}</span>
                    <span className="block text-xs text-muted-foreground">Exact exercise selected</span>
                  </span>
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                </div>
              )}
              {exerciseSearch.trim().length >= 2 && !form.selected_exercise_id && (
                <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border bg-background">
                  {isSearchingExercises ? (
                    <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Searching...
                    </div>
                  ) : exerciseResults.length > 0 ? (
                    <div className="p-1">
                      {exerciseResults.map((exercise) => {
                        const selected = form.selected_exercise_id === exercise.id;
                        const detail = [
                          formatTag(exercise.category),
                          (exercise.equipment || []).map(formatTag).join(', '),
                        ].filter(Boolean).join(' - ');

                        return (
                          <button
                            key={exercise.id}
                            type="button"
                            onClick={() => selectExercise(exercise)}
                            className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted ${selected ? 'bg-muted' : ''}`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{exercise.name}</span>
                              <span className="block truncate text-xs text-muted-foreground">{detail}</span>
                            </span>
                            {selected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="px-3 py-3 text-sm text-muted-foreground">No matching exercises found.</p>
                  )}
                </div>
              )}
            </div>
            <div>
              <Label>Duration (minutes)</Label>
              <Input type="number" value={form.duration_minutes} onChange={e => setForm(p => ({ ...p, duration_minutes: e.target.value }))} placeholder="30" />
            </div>
            <div>
              <Label>Intensity</Label>
              <Select value={form.intensity} onValueChange={v => setForm(p => ({ ...p, intensity: v }))}>
                <SelectTrigger><SelectValue placeholder="Select intensity" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="moderate">Moderate</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.workout_type && form.duration_minutes && form.intensity && (
              !latestWeight ? (
                <p className="text-sm text-amber-500">Add your current weight first to calculate calories.</p>
              ) : calorieEstimateQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Checking MET estimate...</p>
              ) : calorieEstimateQuery.data?.resolved ? (
                <p className="text-sm text-muted-foreground">
                  Estimated burn: <strong className="text-red-500">{calorieEstimateQuery.data.calories} kcal</strong>
                  <span className="ml-1">({calorieEstimateQuery.data.met} MET)</span>
                </p>
              ) : (
                <p className="text-sm text-amber-500">
                  MET mapping needed. This workout will save without a calorie estimate.
                </p>
              )
            )}
            <Button onClick={handleAdd} disabled={!canLogWorkout} className="w-full">
              {createMutation.isPending || isResolvingCalories ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Log Workout
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
