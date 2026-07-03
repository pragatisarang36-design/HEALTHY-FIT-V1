import React, { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Apple, Loader2 } from 'lucide-react';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/lib/AuthContext';
import { useProfile } from '@/lib/useProfile';
import { generateRuleBasedMealPlan } from '@/services/mealPlannerEngine';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import GlassCard from '@/components/ui/GlassCard';
import EmptyState from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/use-toast';

const FILTERS = [
  'high_protein', 'low_carb', 'vegetarian', 'vegan', 'keto', 'gluten_free',
  'dairy_free', 'jain', 'indian', 'budget', 'non_veg', 'high_fiber', 'low_fat', 'diabetic_friendly',
];

const FILTER_LABELS = {
  high_protein: 'High Protein',
  low_carb: 'Low Carb',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  keto: 'Keto',
  gluten_free: 'Gluten-Free',
  dairy_free: 'Dairy-Free',
  jain: 'Jain',
  indian: 'Indian',
  budget: 'Budget',
  non_veg: 'Non-Veg',
  high_fiber: 'High Fiber',
  low_fat: 'Low Fat',
  diabetic_friendly: 'Diabetic-Friendly',
};

export default function MealPlanner() {
  const { profile } = useProfile();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [planType, setPlanType] = useState('1_day');
  const [selectedFilters, setSelectedFilters] = useState([]);
  const [customPreference, setCustomPreference] = useState('');
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false);
  const [expandedMeal, setExpandedMeal] = useState(null);

  const { data: plans = [] } = useQuery({
    queryKey: ['meal-plans', user?.id],
    queryFn: () => dataService.entities.MealPlan.filter({ created_by: user?.email }, '-created_date', 5),
    initialData: [],
    enabled: !!user?.email,
  });

  const currentPlan = plans[0] || null;

  const toggleFilter = (filter) => {
    setSelectedFilters((prev) => prev.includes(filter) ? prev.filter((item) => item !== filter) : [...prev, filter]);
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
      const result = await generateRuleBasedMealPlan(profile, {
        planType,
        filters: selectedFilters,
        customPreference,
        recentPlans: plans,
        seed: `${user?.id || user?.email || 'user'}-${Date.now()}`,
      });

      await dataService.entities.MealPlan.create({
        plan_type: planType,
        filter: selectedFilters.join(','),
        plan_data: result,
        date_generated: format(new Date(), 'yyyy-MM-dd'),
      });

      await queryClient.invalidateQueries({ queryKey: ['meal-plans', user?.id] });
      toast({ title: 'Meal plan generated!' });
    } catch (error) {
      toast({
        title: 'Meal plan not generated',
        description: error.message || 'Try loosening one filter.',
        variant: 'destructive',
      });
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  const renderMeals = (meals = [], dayPrefix = '') => (
    <div className="space-y-3">
      {meals.map((meal, index) => {
        const key = `${dayPrefix}-${meal.id || index}`;
        const isExpanded = expandedMeal === key;

        return (
          <div key={key} className="overflow-hidden rounded-xl border border-border/50 bg-card/60 transition-all hover:border-primary/40 hover:shadow-lg">
            <button
              type="button"
              className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
              onClick={() => setExpandedMeal(isExpanded ? null : key)}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">{meal.name}</p>
                <p className="text-xs capitalize text-muted-foreground">{meal.type}</p>
              </div>
              <div className="shrink-0 text-right text-xs">
                <p className="font-semibold">{meal.calories} kcal</p>
                <p className="text-muted-foreground">P:{meal.protein} C:{meal.carbs} F:{meal.fats}</p>
              </div>
            </button>

            {isExpanded && (
              <div className="space-y-3 border-t border-border/40 px-4 pb-4 pt-3">
                <div>
                  <p className="text-xs font-semibold text-primary">Ingredients</p>
                  <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                    {(meal.ingredients || []).map((ingredient) => <li key={ingredient}>{ingredient}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold text-primary">Recipe</p>
                  <ol className="mt-1 list-inside list-decimal text-xs text-muted-foreground">
                    {(meal.recipe_steps || []).map((step) => <li key={step}>{step}</li>)}
                  </ol>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const planDays = currentPlan?.plan_data?.days || (currentPlan?.plan_data?.meals ? [{ day: 'Today', meals: currentPlan.plan_data.meals }] : []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Meal Planner</h1>
        <p className="text-sm text-muted-foreground">Rule-based plans with strict diet, allergy, and preference filtering.</p>
      </div>

      <GlassCard>
        <div className="space-y-4">
          <Select value={planType} onValueChange={setPlanType}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1_day">1-Day Plan</SelectItem>
              <SelectItem value="7_day">7-Day Plan</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex flex-wrap gap-2">
            {FILTERS.map((filter) => (
              <Badge
                key={filter}
                variant={selectedFilters.includes(filter) ? 'default' : 'outline'}
                onClick={() => toggleFilter(filter)}
                className="cursor-pointer"
              >
                {FILTER_LABELS[filter]}
              </Badge>
            ))}
          </div>

          <Textarea
            value={customPreference}
            onChange={(event) => setCustomPreference(event.target.value)}
            placeholder="Example: no onion garlic, high protein, South Indian meals, budget friendly"
            className="min-h-20"
          />

          <Button onClick={generatePlan} disabled={generating} className="gradient-primary text-white">
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Apple className="mr-2 h-4 w-4" />}
            {generating ? 'Generating...' : 'Generate Meal Plan'}
          </Button>
        </div>
      </GlassCard>

      {currentPlan ? (
        <GlassCard>
          <div className="mb-4 space-y-2">
            <h3 className="font-semibold">Your Meal Plan</h3>
            <div className="flex flex-wrap gap-2">
              {(currentPlan.plan_data?.filters_applied || []).map((filter) => (
                <Badge key={filter} variant="outline">{FILTER_LABELS[filter] || filter}</Badge>
              ))}
            </div>
          </div>

          <div className="space-y-5">
            {planDays.map((day) => (
              <section key={day.day}>
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-semibold text-primary">{day.day}</p>
                  {day.totals && <p className="text-xs text-muted-foreground">{Math.round(day.totals.calories)} kcal · {Math.round(day.totals.protein)}g protein</p>}
                </div>
                {renderMeals(day.meals, day.day)}
              </section>
            ))}
          </div>
        </GlassCard>
      ) : (
        <EmptyState icon={Apple} title="No meal plan yet" description="Generate your first rule-based plan." />
      )}

      <p className="text-center text-xs text-muted-foreground">Need help understanding your plan? Ask the chatbot below.</p>
    </div>
  );
}
