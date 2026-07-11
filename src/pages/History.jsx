import React, { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, History as HistoryIcon, Loader2 } from 'lucide-react';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/lib/AuthContext';
import { attachWorkoutResolutionState } from '@/services/workoutCalorieService';
import { Badge } from '@/components/ui/badge';
import GlassCard from '@/components/ui/GlassCard';
import EmptyState from '@/components/ui/EmptyState';

const FILTERS = ['all', 'meals', 'workouts', 'water', 'weight'];

const dateOf = (item) => item.date || item.date_generated || item.created_date || item.created_at || new Date().toISOString();
const isoDay = (item) => {
  try {
    return format(new Date(dateOf(item)), 'yyyy-MM-dd');
  } catch {
    return 'unknown';
  }
};
const displayDay = (date) => {
  if (date === 'unknown') return 'Unknown date';
  return format(new Date(date), 'dd-MM-yyyy');
};

const litresFromWater = (entry) => {
  if (entry.litres !== undefined) return Number(entry.litres) || 0;
  if (entry.amount !== undefined) return ((Number(entry.amount) || 0) * 200) / 1000;
  return ((Number(entry.glasses) || 0) * 200) / 1000;
};

function MealHistoryItem({ item }) {
  const [open, setOpen] = useState(false);
  const ingredients = item.ingredients || item.plan_data?.ingredients || [];
  const recipeSteps = item.recipe_steps || item.recipeSteps || item.plan_data?.recipe_steps || item.plan_data?.recipeSteps || [];
  const hasRecipeDetails = ingredients.length > 0 || recipeSteps.length > 0;

  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <button type="button" onClick={() => setOpen((prev) => !prev)} className="flex w-full items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium capitalize">{item.title}</p>
          <p className="text-xs text-muted-foreground">{item.detail}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline">meals</Badge>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="mt-3 border-t border-border/40 pt-3 text-xs text-muted-foreground">
          {hasRecipeDetails ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="mb-1 font-semibold text-primary">Ingredients</p>
                {ingredients.length > 0 ? (
                  <ul className="list-inside list-disc space-y-0.5">
                    {ingredients.map((ingredient) => <li key={ingredient}>{ingredient}</li>)}
                  </ul>
                ) : <p>Ingredients not available.</p>}
              </div>
              <div>
                <p className="mb-1 font-semibold text-primary">Recipe Steps</p>
                {recipeSteps.length > 0 ? (
                  <ol className="list-inside list-decimal space-y-0.5">
                    {recipeSteps.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                ) : <p>Recipe steps not available.</p>}
              </div>
            </div>
          ) : (
            <p>Recipe details not available for this entry.</p>
          )}

          <div className="mt-3 grid grid-cols-4 gap-2">
            <div className="rounded-md bg-background/40 p-2"><p>Calories</p><p className="font-semibold text-foreground">{item.calories || 0}</p></div>
            <div className="rounded-md bg-background/40 p-2"><p>Protein</p><p className="font-semibold text-foreground">{item.protein || 0}g</p></div>
            <div className="rounded-md bg-background/40 p-2"><p>Carbs</p><p className="font-semibold text-foreground">{item.carbs || 0}g</p></div>
            <div className="rounded-md bg-background/40 p-2"><p>Fats</p><p className="font-semibold text-foreground">{item.fats || 0}g</p></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function History() {
  const { user } = useAuth();
  const [filter, setFilter] = useState('all');

  const queries = useQueries({
    queries: [
      { queryKey: ['history-meals', user?.id], queryFn: () => dataService.entities.Meal.filter({ created_by: user?.email }, '-created_date', 100), enabled: !!user?.email },
      { queryKey: ['history-workouts', user?.id], queryFn: () => dataService.entities.Workout.filter({ created_by: user?.email }, '-created_date', 100), enabled: !!user?.email },
      { queryKey: ['history-workout-met-unresolved', user?.id], queryFn: () => dataService.entities.WorkoutMetUnresolved.filter({ created_by: user?.email }, '-created_date', 100), enabled: !!user?.email },
      { queryKey: ['history-water', user?.id], queryFn: () => dataService.entities.WaterIntake.filter({ created_by: user?.email }, '-created_date', 300), enabled: !!user?.email },
      { queryKey: ['history-weight', user?.id], queryFn: () => dataService.entities.WeightLog.filter({ created_by: user?.email }, '-created_date', 100), enabled: !!user?.email },
    ],
  });

  const isLoading = queries.some((query) => query.isLoading);
  const items = useMemo(() => {
    const [meals, workouts, unresolvedWorkoutMetLogs, water, weight] = queries.map((query) => query.data || []);
    const workoutsWithResolution = attachWorkoutResolutionState(workouts, unresolvedWorkoutMetLogs);
    const waterByDate = water.reduce((acc, entry) => {
      const key = isoDay(entry);
      acc[key] = (acc[key] || 0) + litresFromWater(entry);
      return acc;
    }, {});

    return [
      ...meals.map((item) => ({
        ...item,
        kind: 'meals',
        title: item.food_name,
        detail: `${item.quantity || '1 serving'} - ${item.calories || 0} kcal`,
      })),
      ...workoutsWithResolution.map((item) => ({
        ...item,
        kind: 'workouts',
        title: item.workout_type,
        detail: item.calories_unresolved
          ? `${item.duration_minutes || item.duration || 0} min - MET mapping needed`
          : `${item.duration_minutes || item.duration || 0} min - ${item.calories_burned || 0} kcal`,
      })),
      ...Object.entries(waterByDate).map(([date, litres]) => ({
        id: `water-${date}`,
        kind: 'water',
        title: 'Water intake',
        detail: `${litres.toFixed(1)} L`,
        date,
      })),
      ...weight.map((item) => ({
        ...item,
        kind: 'weight',
        title: 'Weight logged',
        detail: `${item.weight || 0} kg`,
      })),
    ]
      .filter((item) => filter === 'all' || item.kind === filter)
      .sort((a, b) => new Date(dateOf(b)) - new Date(dateOf(a)));
  }, [queries, filter]);

  const grouped = items.reduce((acc, item) => {
    const key = item.kind === 'water' ? item.date : isoDay(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-heading font-bold"><HistoryIcon className="h-6 w-6 text-primary" /> History</h1>
        <p className="mt-1 text-sm text-muted-foreground">Previous logs, newest first.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <Badge key={item} variant={filter === item ? 'default' : 'outline'} className="cursor-pointer capitalize" onClick={() => setFilter(item)}>
            {item}
          </Badge>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="No history yet" description="Your logs will appear here." />
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([date, dayItems]) => (
            <GlassCard key={date}>
              <h2 className="mb-3 font-semibold">{displayDay(date)}</h2>
              <div className="space-y-2">
                {dayItems.map((item) => (
                  item.kind === 'meals' ? (
                    <MealHistoryItem key={`${item.kind}-${item.id}`} item={item} />
                  ) : (
                    <div key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium capitalize">{item.title}</p>
                        <p className="text-xs text-muted-foreground">{item.detail}</p>
                      </div>
                      <Badge variant="outline" className="capitalize">{item.kind}</Badge>
                    </div>
                  )
                ))}
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}
