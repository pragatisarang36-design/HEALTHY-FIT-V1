import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { AlertCircle, CheckSquare, ClipboardList, Loader2, Pause, Play, RotateCcw, Square, Timer } from 'lucide-react';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/lib/AuthContext';
import { useProfile } from '@/lib/useProfile';
import { generateRuleBasedWorkoutPlan } from '@/services/workoutPlannerEngine';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import GlassCard from '@/components/ui/GlassCard';
import EmptyState from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/use-toast';

const INJURY_OPTIONS = ['None', 'Knee pain', 'Lower back pain', 'Shoulder pain', 'Wrist pain', 'Other'];
const EQUIPMENT_OPTIONS = ['none', 'band', 'dumbbells', 'bench', 'bike'];

export default function WorkoutPlanner() {
  const { profile } = useProfile();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false);
  const [selectedInjury, setSelectedInjury] = useState('None');
  const [customInjury, setCustomInjury] = useState('');
  const [customPreference, setCustomPreference] = useState('');
  const [level, setLevel] = useState('beginner');
  const [workoutDays, setWorkoutDays] = useState('5');
  const [equipment, setEquipment] = useState(['none']);
  const [checked, setChecked] = useState({});
  const [timerOpen, setTimerOpen] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerTarget, setTimerTarget] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [currentExercise, setCurrentExercise] = useState('');
  const intervalRef = useRef(null);

  const { data: plans = [] } = useQuery({
    queryKey: ['workout-plans', user?.id],
    queryFn: () => dataService.entities.WorkoutPlan.filter({ created_by: user?.email }, '-created_date', 1),
    initialData: [],
    enabled: !!user?.email,
  });

  const currentPlan = plans[0] || null;

  useEffect(() => {
    setChecked({});
  }, [currentPlan?.id]);

  useEffect(() => {
    if (timerRunning && timerSeconds < timerTarget) {
      intervalRef.current = setInterval(() => {
        setTimerSeconds((prev) => {
          if (prev + 1 >= timerTarget) {
            setTimerRunning(false);
            clearInterval(intervalRef.current);
            return timerTarget;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [timerRunning, timerSeconds, timerTarget]);

  const injuryNote = selectedInjury === 'Other' ? customInjury.trim() : selectedInjury === 'None' ? '' : selectedInjury;

  const toggleEquipment = (item) => {
    setEquipment((prev) => {
      if (item === 'none') return ['none'];
      const withoutNone = prev.filter((value) => value !== 'none');
      return withoutNone.includes(item) ? withoutNone.filter((value) => value !== item) : [...withoutNone, item];
    });
  };

  const generatePlan = async () => {
    if (generating || generatingRef.current) return;
    if (!profile) {
      toast({ title: 'Set up your profile first', variant: 'destructive' });
      return;
    }

    generatingRef.current = true;
    setGenerating(true);

    try {
      const result = await generateRuleBasedWorkoutPlan(profile, {
        level,
        workoutDays: Number(workoutDays),
        equipment: equipment.length ? equipment : ['none'],
        injuryNote,
        customPreference,
        recentPlans: plans,
        seed: `${user?.id || user?.email || 'user'}-${Date.now()}`,
      });

      for (const plan of plans) await dataService.entities.WorkoutPlan.delete(plan.id);
      await dataService.entities.WorkoutPlan.create({
        plan_data: result,
        date_generated: format(new Date(), 'yyyy-MM-dd'),
      });

      await queryClient.invalidateQueries({ queryKey: ['workout-plans', user?.id] });
      setChecked({});
      toast({ title: 'Workout plan generated!' });
    } catch (error) {
      toast({ title: 'Workout plan not generated', description: error.message || 'Try loosening one setting.', variant: 'destructive' });
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  const toggleCheck = (key) => setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  const getDayProgress = (dayIndex, exercises) => {
    if (!exercises?.length) return null;
    const done = exercises.filter((_, index) => checked[`${dayIndex}-${index}`]).length;
    return { done, total: exercises.length };
  };
  const startTimer = (exercise, seconds) => {
    setCurrentExercise(exercise);
    setTimerTarget(seconds || 60);
    setTimerSeconds(0);
    setTimerRunning(true);
    setTimerOpen(true);
  };
  const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold">Workout Planner</h1>
          <p className="text-sm text-muted-foreground">Rule-based weekly plans with injury-aware exercise filtering.</p>
        </div>
        <Button onClick={generatePlan} disabled={generating} className="gradient-primary text-white">
          {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardList className="mr-2 h-4 w-4" />}
          {generating ? 'Generating...' : 'Generate Plan'}
        </Button>
      </div>

      <GlassCard animate={false}>
        <div className="grid gap-4 lg:grid-cols-4">
          <div>
            <p className="mb-2 text-sm font-medium">Level</p>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="beginner">Beginner</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Workout days</p>
            <Select value={workoutDays} onValueChange={setWorkoutDays}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3 days</SelectItem>
                <SelectItem value="4">4 days</SelectItem>
                <SelectItem value="5">5 days</SelectItem>
                <SelectItem value="6">6 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="lg:col-span-2">
            <p className="mb-2 text-sm font-medium">Equipment</p>
            <div className="flex flex-wrap gap-2">
              {EQUIPMENT_OPTIONS.map((item) => (
                <Badge key={item} variant={equipment.includes(item) ? 'default' : 'outline'} onClick={() => toggleEquipment(item)} className="cursor-pointer capitalize">
                  {item}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p className="text-sm font-medium">Any pain or injury we should consider? <span className="font-normal text-muted-foreground">(optional)</span></p>
            </div>
            <Select value={selectedInjury} onValueChange={setSelectedInjury}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INJURY_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
              </SelectContent>
            </Select>
            {selectedInjury === 'Other' && (
              <Input className="mt-2" placeholder="Describe pain or injury" value={customInjury} onChange={(event) => setCustomInjury(event.target.value)} />
            )}
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Custom preferences</p>
            <Input value={customPreference} onChange={(event) => setCustomPreference(event.target.value)} placeholder="Example: no jumping, home workout, low impact" />
          </div>
        </div>
      </GlassCard>

      {currentPlan?.plan_data?.days ? (
        <div className="space-y-4">
          {currentPlan.plan_data.safety_notes?.length > 0 && (
            <GlassCard animate={false} className="border-amber-500/30 bg-amber-500/10">
              <div className="space-y-1 text-sm text-amber-100">
                {currentPlan.plan_data.safety_notes.map((note) => <p key={note}>{note}</p>)}
              </div>
            </GlassCard>
          )}

          {currentPlan.plan_data.days.map((day, dayIndex) => {
            const progress = getDayProgress(dayIndex, day.exercises);
            const allDone = progress && progress.done === progress.total;

            return (
              <GlassCard key={day.day}>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{day.day}</h3>
                    <p className="text-xs text-muted-foreground">{day.is_rest ? 'Rest Day' : day.focus}</p>
                  </div>
                  {progress && (
                    <Badge variant="outline" className={allDone ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-primary/30 bg-primary/10 text-primary'}>
                      {progress.done}/{progress.total} done
                    </Badge>
                  )}
                </div>

                {!day.is_rest && (
                  <div className="mb-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg bg-muted/40 p-3">
                      <p className="text-xs font-semibold text-primary">Warm-up</p>
                      <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                        {day.warm_up?.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3">
                      <p className="text-xs font-semibold text-primary">Cool-down</p>
                      <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                        {day.cool_down?.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                  </div>
                )}

                {!day.is_rest && day.exercises?.length > 0 && (
                  <div className="space-y-2">
                    {day.exercises.map((exercise, exerciseIndex) => {
                      const key = `${dayIndex}-${exerciseIndex}`;
                      const isDone = !!checked[key];
                      return (
                        <div
                          key={`${exercise.name}-${exerciseIndex}`}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-all ${isDone ? 'border border-emerald-500/20 bg-emerald-500/10' : 'bg-muted/50 hover:bg-muted/80'}`}
                          onClick={() => toggleCheck(key)}
                        >
                          <button type="button" className="shrink-0 text-primary" onClick={(event) => { event.stopPropagation(); toggleCheck(key); }}>
                            {isDone ? <CheckSquare className="h-5 w-5 text-emerald-500" /> : <Square className="h-5 w-5 text-muted-foreground" />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm font-medium ${isDone ? 'text-muted-foreground line-through' : ''}`}>{exercise.name}</p>
                            <p className="text-xs text-muted-foreground">{exercise.sets ? `${exercise.sets} sets x ${exercise.reps}` : exercise.reps} · {exercise.intensity}</p>
                          </div>
                          {exercise.duration_seconds > 0 && (
                            <Button size="sm" variant="ghost" onClick={(event) => { event.stopPropagation(); startTimer(exercise.name, exercise.duration_seconds); }} className="shrink-0 text-primary">
                              <Timer className="mr-1 h-4 w-4" /> {formatTime(exercise.duration_seconds)}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={ClipboardList} title="No workout plan yet" description="Generate a personalized weekly workout plan above." />
      )}

      <Dialog open={timerOpen} onOpenChange={setTimerOpen}>
        <DialogContent className="max-w-xs text-center">
          <DialogHeader><DialogTitle>{currentExercise}</DialogTitle></DialogHeader>
          <div className="py-6">
            <p className="font-heading text-5xl font-bold">{formatTime(timerSeconds)}</p>
            <p className="mt-2 text-sm text-muted-foreground">of {formatTime(timerTarget)}</p>
            <div className="mt-4 h-2 w-full rounded-full bg-muted">
              <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${timerTarget > 0 ? (timerSeconds / timerTarget) * 100 : 0}%` }} />
            </div>
          </div>
          <div className="flex justify-center gap-3">
            <Button size="icon" variant="outline" onClick={() => { setTimerSeconds(0); setTimerRunning(false); }}><RotateCcw className="h-4 w-4" /></Button>
            <Button size="icon" onClick={() => setTimerRunning((prev) => !prev)} className="gradient-primary text-white">
              {timerRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
