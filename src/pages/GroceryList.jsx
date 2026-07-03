import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/lib/AuthContext';
import { ShoppingCart, Loader2, RefreshCw, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import GlassCard from '@/components/ui/GlassCard';
import EmptyState from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/use-toast';
import { format } from 'date-fns';

const CATEGORY_ORDER = [
  'fruits_vegetables',
  'grains_cereals',
  'pulses_legumes',
  'dairy_alternatives',
  'protein_sources',
  'oils_fats',
  'spices_seasonings',
  'sweeteners_baking',
  'beverages',
  'other',
];

const CATEGORY_LABELS = {
  fruits_vegetables: '🥦 Fruits & Vegetables',
  grains_cereals: '🍚 Grains & Cereals',
  pulses_legumes: '🫘 Pulses & Legumes',
  dairy_alternatives: '🥛 Dairy & Alternatives',
  protein_sources: '🍗 Protein Sources',
  oils_fats: '🛢️ Oils & Fats',
  spices_seasonings: '🌶️ Spices & Seasonings',
  sweeteners_baking: '🍯 Sweeteners & Baking Items',
  beverages: '🥤 Beverages',
  other: 'Other Items',
};

const dedupeItems = (items = []) => {
  const byName = new Map();
  const combineQuantity = (a, b) => {
    const left = String(a || '').trim();
    const right = String(b || '').trim();
    const leftMatch = left.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/);
    const rightMatch = right.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/);
    if (leftMatch && rightMatch && leftMatch[2].toLowerCase() === rightMatch[2].toLowerCase()) {
      const total = Number(leftMatch[1]) + Number(rightMatch[1]);
      return `${Number.isInteger(total) ? total : total.toFixed(1)}${leftMatch[2]}`;
    }
    return [left, right].filter(Boolean).join(' + ');
  };

  for (const item of items) {
    const name = String(item?.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const quantity = String(item?.quantity || '').trim();
    const category = String(item?.category || 'other').toLowerCase();

    if (byName.has(key)) {
      const current = byName.get(key);
      byName.set(key, {
        ...current,
        quantity: combineQuantity(current.quantity, quantity),
      });
    } else {
      byName.set(key, { name, category, quantity, checked: false });
    }
  }

  return [...byName.values()];
};

const ingredientToItem = (ingredient) => {
  const text = String(ingredient || '').trim();
  if (!text) return null;
  const categoryRules = [
    ['fruits_vegetables', /fruit|banana|apple|berry|berries|cucumber|tomato|spinach|pepper|capsicum|beans|carrot|lettuce|broccoli|lemon|lime|mint|vegetable|gourd|peas|mushroom|zucchini|coconut|drumstick|curry leaves/i],
    ['grains_cereals', /rice|oats|quinoa|millet|poha|ragi|amaranth|idli|idiyappam|wrap|bread|flour|toast/i],
    ['pulses_legumes', /dal|lentil|chickpea|chole|rajma|kidney bean|sprout|chana|black bean|sattu|besan|moong|toor|masoor/i],
    ['dairy_alternatives', /milk|curd|yogurt|paneer|cheese|butter|ghee|soy milk|coconut milk|coconut yogurt/i],
    ['protein_sources', /chicken|fish|egg|tofu|tempeh|salmon|prawn|turkey|protein/i],
    ['oils_fats', /oil|olive oil|sesame oil|peanut butter|tahini|seeds|peanuts|almond/i],
    ['spices_seasonings', /turmeric|cumin|cinnamon|spice|salt|pepper|masala|mustard|herbs|ginger|soy sauce/i],
    ['sweeteners_baking', /honey|jaggery|sugar|baking|cocoa|vanilla|dates/i],
    ['beverages', /water|juice|tea|coffee|smoothie|buttermilk/i],
  ];
  const category = categoryRules.find(([, pattern]) => pattern.test(text))?.[0] || 'other';
  const match = text.match(/^(.+?)\s+(\d+.*)$/);
  return {
    name: match ? match[1].trim() : text,
    quantity: match ? match[2].trim() : 'as needed',
    category,
    checked: false,
  };
};

const groceryItemsFromMealPlan = (planData) => {
  const days = planData?.days || (planData?.meals ? [{ meals: planData.meals }] : []);
  const ingredients = days.flatMap((day) => day.meals || []).flatMap((meal) => meal.ingredients || []);
  return dedupeItems(ingredients.map(ingredientToItem).filter(Boolean));
};

export default function GroceryList() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState('');
  const generatingRef = useRef(false);

  const { data: lists = [] } = useQuery({
    queryKey: ['grocery-lists', user?.id],
    queryFn: () => dataService.entities.GroceryList.filter({ created_by: user?.email }, '-created_date', 1),
    initialData: [],
    enabled: !!user?.email,
  });

  const { data: mealPlans = [], isLoading: mealPlansLoading } = useQuery({
    queryKey: ['meal-plans', user?.id],
    queryFn: () => dataService.entities.MealPlan.filter({ created_by: user?.email }, '-created_date', 1),
    initialData: [],
    enabled: !!user?.email,
  });

  const currentList = lists[0] || null;
  const latestMealPlan = mealPlans[0] || null;
  const canGenerate = !!latestMealPlan && !mealPlansLoading;

  const friendlyError = (error) => {
    const message = String(error?.message || '');
    if (message.includes('meal_plans') || message.includes('plan_json')) {
      return 'Database setup is incomplete. Run the Supabase SQL setup, then try again.';
    }
    return message || 'Could not generate grocery list. Please try again.';
  };

  const generateList = async () => {
    if (generating || generatingRef.current) return;
    setNotice('');

    if (!canGenerate) {
      setNotice('Create a meal plan first. Grocery lists are generated from your latest meal plan.');
      toast({ title: 'Meal plan needed', description: 'Create a meal plan first, then generate groceries.' });
      return;
    }

    generatingRef.current = true;
    setGenerating(true);

    try {
      const itemsWithChecked = groceryItemsFromMealPlan(latestMealPlan.plan_data);
      if (!itemsWithChecked.length) {
        toast({ title: 'No ingredients found', description: 'Generate a meal plan with ingredients first.', variant: 'destructive' });
        return;
      }

      const latestLists = await dataService.entities.GroceryList.filter({ created_by: user?.email });
      for (const l of latestLists) await dataService.entities.GroceryList.delete(l.id);

      await dataService.entities.GroceryList.create({
        items: itemsWithChecked,
        plan_data: {
          source_plan_id: latestMealPlan.id,
          source_plan_updated_date: latestMealPlan.updated_date || latestMealPlan.created_date,
          items: itemsWithChecked,
        },
        date_generated: format(new Date(), 'yyyy-MM-dd'),
      });

      queryClient.invalidateQueries({ queryKey: ['grocery-lists', user?.id] });
      setNotice('');
      toast({ title: 'Grocery list generated!' });
    } catch (error) {
      const message = friendlyError(error);
      setNotice(message);
      toast({ title: 'Grocery list not generated', description: message, variant: 'destructive' });
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  const toggleItem = async (index) => {
    if (!currentList) return;
    const updatedItems = [...currentList.items];
    updatedItems[index] = { ...updatedItems[index], checked: !updatedItems[index].checked };
    await dataService.entities.GroceryList.update(currentList.id, { items: updatedItems });
    queryClient.invalidateQueries({ queryKey: ['grocery-lists', user?.id] });
  };

  const groupedItems = currentList?.items?.reduce((acc, item, index) => {
    const cat = item.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push({ ...item, _index: index });
    return acc;
  }, {}) || {};
  const orderedGroups = CATEGORY_ORDER
    .filter((category) => groupedItems[category]?.length)
    .map((category) => [category, groupedItems[category]]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">Grocery List</h1>
          <p className="text-muted-foreground text-sm">Generated from your meal plan</p>
        </div>
        <Button onClick={generateList} disabled={generating} className="gradient-primary text-white">
          {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          {generating ? 'Generating...' : currentList ? 'Regenerate' : 'Generate'}
        </Button>
      </div>

      {notice && (
        <GlassCard animate={false} className="border-amber-500/30 bg-amber-500/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-amber-100">{notice}</p>
            {!latestMealPlan && (
              <Button asChild size="sm" variant="outline" className="shrink-0">
                <Link to="/meal-planner">
                  Meal Planner <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
            )}
          </div>
        </GlassCard>
      )}

      {currentList ? (
        <div className="space-y-4">
          {orderedGroups.map(([category, items]) => (
            <GlassCard key={category}>
              <h3 className="font-semibold mb-3">{CATEGORY_LABELS[category] || 'Other Items'}</h3>
              <div className="space-y-2">
                {items.map(item => (
                  <div
                    key={item._index}
                    className="flex items-center gap-3 py-1.5"
                  >
                    <Checkbox
                      checked={item.checked}
                      onCheckedChange={() => toggleItem(item._index)}
                    />
                    <span className={`text-sm flex-1 ${item.checked ? 'line-through text-muted-foreground' : ''}`}>
                      {item.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{item.quantity}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <EmptyState
            icon={ShoppingCart}
            title="No grocery list yet"
            description={latestMealPlan ? 'Generate one from your latest meal plan.' : 'Create a meal plan first, then generate groceries from it.'}
          />
          {!latestMealPlan && (
            <div className="flex justify-center">
              <Button asChild variant="outline">
                <Link to="/meal-planner">
                  Open Meal Planner <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
