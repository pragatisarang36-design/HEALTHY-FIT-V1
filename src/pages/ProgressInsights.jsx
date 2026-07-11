import React, { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/lib/AuthContext';
import { useProfile } from '@/lib/useProfile';
import { TrendingUp, Loader2, RefreshCw, Flame, Droplets, Dumbbell, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import GlassCard from '@/components/ui/GlassCard';
import EmptyState from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/use-toast';
import { format, subDays } from 'date-fns';
import { generateInsights } from '@/services/aiFeatures';
import { attachWorkoutResolutionState } from '@/services/workoutCalorieService';

const ICON_MAP = {
  calorie: Flame,
  protein: Target,
  hydration: Droplets,
  workout: Dumbbell,
  general: TrendingUp,
};

const COLOR_MAP = {
  calorie: 'from-orange-500 to-amber-600',
  protein: 'from-blue-500 to-cyan-600',
  hydration: 'from-blue-400 to-sky-500',
  workout: 'from-purple-500 to-violet-600',
  general: 'from-emerald-500 to-teal-600',
};

export default function ProgressInsights() {
  const { profile } = useProfile();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false);

  const { data: insights = [] } = useQuery({
    queryKey: ['insights', user?.id],
    queryFn: () => dataService.entities.ProgressInsight.filter({ created_by: user?.email }, '-created_date', 1),
    initialData: [],
    enabled: !!user?.email,
  });

  const currentInsight = insights[0] || null;

  const generateInsightCards = async () => {
    if (generating || generatingRef.current) return;
    if (!profile) {
      toast({ title: 'Set up your profile first', variant: 'destructive' });
      return;
    }

    generatingRef.current = true;
    setGenerating(true);

    try {
      await queryClient.invalidateQueries({ queryKey: ['insights', user?.id] });
      const last7Days = Array.from({ length: 7 }, (_, i) => format(subDays(new Date(), i), 'yyyy-MM-dd'));

      const [meals, workouts, unresolvedWorkoutMetLogs, waterEntries, weightLogs] = await Promise.all([
        dataService.entities.Meal.filter({ created_by: user?.email }, '-date', 100),
        dataService.entities.Workout.filter({ created_by: user?.email }, '-date', 50),
        dataService.entities.WorkoutMetUnresolved.filter({ created_by: user?.email }, '-created_date', 100),
        dataService.entities.WaterIntake.filter({ created_by: user?.email }, '-date', 50),
        dataService.entities.WeightLog.filter({ created_by: user?.email }, '-date', 10),
      ]);

      const recentMeals = meals.filter((m) => last7Days.includes(m.date));
      const workoutsWithResolution = attachWorkoutResolutionState(workouts, unresolvedWorkoutMetLogs);
      const recentWorkouts = workoutsWithResolution.filter((w) => last7Days.includes(w.date));
      const recentWorkoutsWithCalories = recentWorkouts.filter((w) => !w.calories_unresolved);
      const recentWater = waterEntries.filter((w) => last7Days.includes(w.date));

      const totalCalories = recentMeals.reduce((s, m) => s + (Number(m.calories) || 0), 0);
      const totalProtein = recentMeals.reduce((s, m) => s + (Number(m.protein) || 0), 0);
      const totalBurned = recentWorkoutsWithCalories.reduce((s, w) => s + (Number(w.calories_burned) || 0), 0);
      const totalWaterGlasses = recentWater.reduce((s, w) => s + (Number(w.glasses) || 0), 0);
      const workoutDays = new Set(recentWorkouts.map((w) => w.date)).size;

      const result = await generateInsights({
        name: profile.name,
        goal: profile.fitness_goal?.replace('_', ' '),
        weight: profile.weight,
        targetWeight: profile.target_weight,
        totalCalories,
        totalProtein,
        totalBurned,
        totalWaterGlasses,
        waterGoalGlasses: Math.round((profile.water_goal_litres || 2.5) * 5),
        workoutDays,
        latestWeight: weightLogs[0]?.weight || profile.weight,
      });

      if (!result?.insights?.length) {
        toast({ title: 'Could not generate insights', variant: 'destructive' });
        return;
      }

      const latestInsights = await dataService.entities.ProgressInsight.filter({ created_by: user?.email });
      for (const ins of latestInsights) await dataService.entities.ProgressInsight.delete(ins.id);

      await dataService.entities.ProgressInsight.create({
        insights: result.insights,
        date_generated: format(new Date(), 'yyyy-MM-dd'),
      });

      queryClient.invalidateQueries({ queryKey: ['insights', user?.id] });
      toast({ title: 'Insights updated!' });
    } catch (error) {
      toast({ title: error.message || 'Failed to update insights', variant: 'destructive' });
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">Progress Insights</h1>
          <p className="text-muted-foreground text-sm">AI-powered analysis of your fitness journey</p>
        </div>
        <Button onClick={generateInsightCards} disabled={generating} className="gradient-primary text-white">
          {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          {generating ? 'Analyzing...' : 'Generate Insights'}
        </Button>
      </div>

      {currentInsight?.insights?.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {currentInsight.insights.map((insight, i) => {
            const IconComp = ICON_MAP[insight.type] || TrendingUp;
            const gradient = COLOR_MAP[insight.type] || COLOR_MAP.general;
            return (
              <GlassCard key={i} className="relative overflow-hidden">
                <div className={`absolute top-0 right-0 w-24 h-24 rounded-full bg-gradient-to-br ${gradient} opacity-10 -translate-y-8 translate-x-8`} />
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg bg-gradient-to-br ${gradient} text-white shrink-0`}>
                    <IconComp className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{insight.title}</p>
                    <p className="text-2xl font-bold font-heading my-1">{insight.metric_value}</p>
                    <p className="text-sm text-muted-foreground">{insight.message}</p>
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={TrendingUp} title="No insights yet" description="Generate insights to see your progress analysis." />
      )}
    </div>
  );
}
