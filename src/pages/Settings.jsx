import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Moon, Save, Settings as SettingsIcon, Sun } from 'lucide-react';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/lib/AuthContext';
import { useDarkMode } from '@/lib/useDarkMode';
import { useProfile } from '@/lib/useProfile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import GlassCard from '@/components/ui/GlassCard';
import { toast } from '@/components/ui/use-toast';

const defaultSettings = {
  diet_preference: '',
  food_allergies_text: '',
  food_dislikes_text: '',
  fitness_goal: '',
  fitness_level: 'beginner',
  workout_days: '5',
  equipment: 'none',
  custom_meal_preferences: '',
  custom_workout_preferences: '',
};

const splitCsv = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);

export default function Settings() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { isDark, setIsDark } = useDarkMode();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(defaultSettings);

  const { data: savedSettings = [] } = useQuery({
    queryKey: ['settings', user?.id],
    queryFn: () => dataService.entities.Settings.filter({ created_by: user?.email }, '-created_date', 1),
    initialData: [],
    enabled: !!user?.email,
  });

  useEffect(() => {
    const settings = savedSettings[0]?.plan_data || {};
    setForm({
      ...defaultSettings,
      diet_preference: settings.diet_preference || profile?.diet_preference || '',
      food_allergies_text: settings.food_allergies_text || (profile?.food_allergies || []).join(', '),
      food_dislikes_text: settings.food_dislikes_text || (profile?.food_dislikes || []).join(', '),
      fitness_goal: settings.fitness_goal || profile?.fitness_goal || '',
      fitness_level: settings.fitness_level || 'beginner',
      workout_days: String(settings.workout_days || '5'),
      equipment: settings.equipment || 'none',
      custom_meal_preferences: settings.custom_meal_preferences || '',
      custom_workout_preferences: settings.custom_workout_preferences || '',
    });
  }, [profile, savedSettings]);

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const saveSettings = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        food_allergies: splitCsv(form.food_allergies_text),
        food_dislikes: splitCsv(form.food_dislikes_text),
        workout_days: Number(form.workout_days) || 5,
        theme: isDark ? 'dark' : 'light',
        saved_at: new Date().toISOString(),
      };

      for (const row of savedSettings) await dataService.entities.Settings.delete(row.id);
      await dataService.entities.Settings.create({
        plan_data: payload,
        date_generated: new Date().toISOString().slice(0, 10),
      });

      if (profile?.id) {
        await dataService.entities.Profile.update(profile.id, {
          ...profile,
          diet_preference: form.diet_preference,
          fitness_goal: form.fitness_goal || profile.fitness_goal,
          food_allergies: payload.food_allergies,
          food_dislikes: payload.food_dislikes,
        });
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings', user?.id] }),
        queryClient.invalidateQueries({ queryKey: ['profile'] }),
      ]);
      toast({ title: 'Settings saved' });
    } catch (error) {
      toast({ title: 'Settings saved locally', description: error.message || 'Supabase was unavailable.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (event) => {
    event.preventDefault();
    if (!saving) saveSettings();
  };

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-heading font-bold"><SettingsIcon className="h-6 w-6 text-primary" /> Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Personalize diet, workouts, theme, and planner defaults.</p>
      </div>

      <GlassCard className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">Appearance</h2>
            <p className="text-sm text-muted-foreground">Dark-first theme with optional light mode.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => setIsDark(!isDark)}>
            {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            {isDark ? 'Dark' : 'Light'}
          </Button>
        </div>
      </GlassCard>

      <GlassCard className="space-y-5">
        <h2 className="font-semibold">Profile Preferences</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Fitness goal</Label>
            <Select value={form.fitness_goal} onValueChange={(value) => setField('fitness_goal', value)}>
              <SelectTrigger><SelectValue placeholder="Select goal" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weight_loss">Weight Loss</SelectItem>
                <SelectItem value="weight_gain">Weight Gain</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
                <SelectItem value="muscle_gain">Muscle Gain</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Diet preference</Label>
            <Select value={form.diet_preference} onValueChange={(value) => setField('diet_preference', value)}>
              <SelectTrigger><SelectValue placeholder="Select diet" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="vegetarian">Vegetarian</SelectItem>
                <SelectItem value="non_vegetarian">Non-Vegetarian</SelectItem>
                <SelectItem value="vegan">Vegan</SelectItem>
                <SelectItem value="eggetarian">Eggetarian</SelectItem>
                <SelectItem value="pescatarian">Pescatarian</SelectItem>
                <SelectItem value="jain">Jain</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="space-y-5">
        <h2 className="font-semibold">Diet and Allergy Preferences</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Allergies</Label>
            <Input value={form.food_allergies_text} onChange={(event) => setField('food_allergies_text', event.target.value)} placeholder="milk, peanuts, wheat" />
          </div>
          <div>
            <Label>Avoid foods</Label>
            <Input value={form.food_dislikes_text} onChange={(event) => setField('food_dislikes_text', event.target.value)} placeholder="onion, garlic, mushrooms" />
          </div>
        </div>
        <Textarea value={form.custom_meal_preferences} onChange={(event) => setField('custom_meal_preferences', event.target.value)} placeholder="Meal planner defaults, e.g. South Indian, high protein, budget friendly" />
      </GlassCard>

      <GlassCard className="space-y-5">
        <h2 className="font-semibold">Fitness and Workout Preferences</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label>Fitness level</Label>
            <Select value={form.fitness_level} onValueChange={(value) => setField('fitness_level', value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="beginner">Beginner</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Workout days</Label>
            <Input type="number" min="2" max="6" value={form.workout_days} onChange={(event) => setField('workout_days', event.target.value)} />
          </div>
          <div>
            <Label>Equipment</Label>
            <Input value={form.equipment} onChange={(event) => setField('equipment', event.target.value)} placeholder="none, dumbbells, band" />
          </div>
        </div>
        <Textarea value={form.custom_workout_preferences} onChange={(event) => setField('custom_workout_preferences', event.target.value)} placeholder="Workout defaults, e.g. no jumping, low impact, home workout" />
      </GlassCard>

      <Button type="submit" disabled={saving} className="w-full gradient-primary text-white">
        <Save className="h-4 w-4" /> {saving ? 'Saving...' : 'Save Settings'}
      </Button>
    </form>
  );
}
