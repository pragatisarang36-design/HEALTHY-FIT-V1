import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/lib/AuthContext';
import { useProfile } from '@/lib/useProfile';
import { calculateCaloriesBurned, getWorkoutLabel, WORKOUT_TYPES } from '@/lib/metValues';
import { format } from 'date-fns';
import { Dumbbell, Plus, Loader2, Trash2, Flame, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import GlassCard from '@/components/ui/GlassCard';
import EmptyState from '@/components/ui/EmptyState';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { useEnterSubmit } from '@/hooks/useEnterSubmit';

export default function WorkoutTracker() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const queryClient = useQueryClient();
  const { profile } = useProfile();
  const { user } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ workout_type: '', duration_minutes: '', intensity: '' });

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
      setForm({ workout_type: '', duration_minutes: '', intensity: '' });
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

  const handleAdd = () => {
    if (createMutation.isPending) return;
    if (!form.workout_type || !form.duration_minutes || !form.intensity) {
      toast({ title: 'Please fill all fields', variant: 'destructive' });
      return;
    }
    const weight = profile?.weight || 70;
    const caloriesBurned = calculateCaloriesBurned(form.workout_type, form.intensity, Number(form.duration_minutes), weight);

    createMutation.mutate({
      ...form,
      duration_minutes: Number(form.duration_minutes),
      calories_burned: caloriesBurned,
      date: today,
    });
  };

  const canLogWorkout = Boolean(form.workout_type && form.duration_minutes && form.intensity && !createMutation.isPending);
  const handleAddKeyDown = useEnterSubmit(handleAdd, canLogWorkout);

  const totalBurned = workouts.reduce((sum, w) => sum + (w.calories_burned || 0), 0);
  const totalMinutes = workouts.reduce((sum, w) => sum + (w.duration_minutes || 0), 0);

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
        ) : workouts.length === 0 ? (
          <EmptyState icon={Dumbbell} title="No workouts today" description="Start logging your workouts." />
        ) : (
          <div className="space-y-2">
            {workouts.map(w => (
              <div key={w.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-muted/50">
                <div>
                  <p className="font-medium text-sm">{getWorkoutLabel(w.workout_type)}</p>
                  <p className="text-xs text-muted-foreground capitalize">{w.duration_minutes} min · {w.intensity}</p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-semibold text-sm text-red-500">{w.calories_burned} kcal</p>
                  <button onClick={() => deleteMutation.mutate(w.id)} className="p-1 text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Log Workout</DialogTitle>
          </DialogHeader>
          <div className="space-y-4" onKeyDown={handleAddKeyDown}>
            <div>
              <Label>Workout Type</Label>
              <Select value={form.workout_type} onValueChange={v => setForm(p => ({ ...p, workout_type: v }))}>
                <SelectTrigger><SelectValue placeholder="Select workout" /></SelectTrigger>
                <SelectContent>
                  {WORKOUT_TYPES.map(t => <SelectItem key={t} value={t}>{getWorkoutLabel(t)}</SelectItem>)}
                </SelectContent>
              </Select>
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
            {form.workout_type && form.duration_minutes && form.intensity && profile?.weight && (
              <p className="text-sm text-muted-foreground">
                Estimated burn: <strong className="text-red-500">{calculateCaloriesBurned(form.workout_type, form.intensity, Number(form.duration_minutes), profile.weight)} kcal</strong>
              </p>
            )}
            <Button onClick={handleAdd} disabled={!canLogWorkout} className="w-full">
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Log Workout
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
