import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { dataService } from '@/services/dataService';
import { useProfile } from '@/lib/useProfile';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { X, Save, Loader2 } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import { toast } from '@/components/ui/use-toast';
import { useEnterSubmit } from '@/hooks/useEnterSubmit';

const GOALS = [
  { value: 'weight_loss', label: 'Weight Loss' },
  { value: 'weight_gain', label: 'Weight Gain' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'muscle_gain', label: 'Muscle Gain' },
];

const DIETS = [
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'non_vegetarian', label: 'Non-Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'eggetarian', label: 'Eggetarian' },
  { value: 'pescatarian', label: 'Pescatarian' },
];

const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

export default function Profile() {
  const { profile, isLoading, isError, error } = useProfile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '', age: '', gender: '', height: '', weight: '',
    target_weight: '', fitness_goal: '', diet_preference: '',
    food_allergies: [], food_dislikes: [], water_goal_litres: '',
  });

  const [allergyInput, setAllergyInput] = useState('');
  const [dislikeInput, setDislikeInput] = useState('');

  useEffect(() => {
    if (profile) {
      setForm({
        name: profile.name || '',
        age: profile.age || '',
        gender: profile.gender || '',
        height: profile.height || '',
        weight: profile.weight || '',
        target_weight: profile.target_weight || '',
        fitness_goal: profile.fitness_goal || '',
        diet_preference: profile.diet_preference || '',
        food_allergies: profile.food_allergies || [],
        food_dislikes: profile.food_dislikes || [],
        water_goal_litres: profile.water_goal_litres || '',
      });
    }
  }, [profile]);

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const addTag = (field, inputField, setInputField) => {
    const val = inputField.trim();
    if (val && !form[field].includes(val)) {
      setForm(prev => ({ ...prev, [field]: [...prev[field], val] }));
      setInputField('');
    }
  };

  const removeTag = (field, value) => {
    setForm(prev => ({ ...prev, [field]: prev[field].filter(v => v !== value) }));
  };

  const handleSave = async () => {
    if (!form.name || !form.age || !form.gender || !form.height || !form.weight || !form.fitness_goal) {
      toast({ title: 'Missing fields', description: 'Please fill all required fields.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    const withPendingTag = (items = [], pending = '') => {
      const value = pending.trim();
      return value && !items.includes(value) ? [...items, value] : items;
    };
    const foodAllergies = withPendingTag(form.food_allergies, allergyInput);
    const foodDislikes = withPendingTag(form.food_dislikes, dislikeInput);
    const data = {
      ...form,
      food_allergies: foodAllergies,
      food_dislikes: foodDislikes,
      age: Number(form.age),
      height: Number(form.height),
      weight: Number(form.weight),
      target_weight: form.target_weight ? Number(form.target_weight) : null,
      water_goal_litres: form.water_goal_litres ? Number(form.water_goal_litres) : 2.5,
      is_profile_complete: true,
    };

    try {
      if (profile) {
        await dataService.entities.Profile.update(profile.id, data);
      } else {
        await dataService.entities.Profile.create(data);
      }

      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      setAllergyInput('');
      setDislikeInput('');
      toast({ title: 'Profile saved!', description: 'Your profile has been updated.' });
      navigate('/');
    } catch (error) {
      console.error('Profile save failed:', error);
      toast({
        title: 'Could not save profile',
        description: error?.message || 'Please check your details and try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const canSave = Boolean(form.name && form.age && form.gender && form.height && form.weight && form.fitness_goal && !saving);
  const handleSaveKeyDown = useEnterSubmit(handleSave, canSave);

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">{profile ? 'Edit Profile' : 'Set Up Your Profile'}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {profile ? 'Update your details below.' : 'Let\'s get started! Fill in your details.'}
        </p>
      </div>

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Could not load your profile. {error?.message || 'Please refresh and try again.'}
        </div>
      )}

      <GlassCard className="space-y-5" onKeyDown={handleSaveKeyDown}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Name *</Label>
            <Input value={form.name} onChange={e => handleChange('name', e.target.value)} placeholder="Your name" />
          </div>
          <div>
            <Label>Age *</Label>
            <Input type="number" value={form.age} onChange={e => handleChange('age', e.target.value)} placeholder="25" />
          </div>
          <div>
            <Label>Gender *</Label>
            <Select value={form.gender} onValueChange={v => handleChange('gender', v)}>
              <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
              <SelectContent>
                {GENDERS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Height (cm) *</Label>
            <Input type="number" value={form.height} onChange={e => handleChange('height', e.target.value)} placeholder="170" />
          </div>
          <div>
            <Label>Current Weight (kg) *</Label>
            <Input type="number" value={form.weight} onChange={e => handleChange('weight', e.target.value)} placeholder="70" />
          </div>
          <div>
            <Label>Target Weight (kg)</Label>
            <Input type="number" value={form.target_weight} onChange={e => handleChange('target_weight', e.target.value)} placeholder="65" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Fitness Goal *</Label>
            <Select value={form.fitness_goal} onValueChange={v => handleChange('fitness_goal', v)}>
              <SelectTrigger><SelectValue placeholder="Select goal" /></SelectTrigger>
              <SelectContent>
                {GOALS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Diet Preference</Label>
            <Select value={form.diet_preference} onValueChange={v => handleChange('diet_preference', v)}>
              <SelectTrigger><SelectValue placeholder="Select diet" /></SelectTrigger>
              <SelectContent>
                {DIETS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label>Water Goal (litres/day)</Label>
          <Input type="number" step="0.5" value={form.water_goal_litres} onChange={e => handleChange('water_goal_litres', e.target.value)} placeholder="2.5" />
          <p className="text-xs text-muted-foreground mt-1">
            {form.water_goal_litres ? `That's about ${Math.round(Number(form.water_goal_litres) * 5)} glasses` : 'Default: 2.5L (~12 glasses)'}
          </p>
        </div>

        <div>
          <Label>Food Allergies</Label>
          <div className="flex gap-2 mt-1">
            <Input
              value={allergyInput}
              onChange={e => setAllergyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag('food_allergies', allergyInput, setAllergyInput))}
              placeholder="Type and press Enter"
            />
            <Button type="button" variant="outline" onClick={() => addTag('food_allergies', allergyInput, setAllergyInput)}>Add</Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {form.food_allergies.map(a => (
              <Badge key={a} variant="secondary" className="gap-1">
                {a} <X className="w-3 h-3 cursor-pointer" onClick={() => removeTag('food_allergies', a)} />
              </Badge>
            ))}
          </div>
        </div>

        <div>
          <Label>Food Dislikes</Label>
          <div className="flex gap-2 mt-1">
            <Input
              value={dislikeInput}
              onChange={e => setDislikeInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag('food_dislikes', dislikeInput, setDislikeInput))}
              placeholder="Type and press Enter"
            />
            <Button type="button" variant="outline" onClick={() => addTag('food_dislikes', dislikeInput, setDislikeInput)}>Add</Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {form.food_dislikes.map(d => (
              <Badge key={d} variant="secondary" className="gap-1">
                {d} <X className="w-3 h-3 cursor-pointer" onClick={() => removeTag('food_dislikes', d)} />
              </Badge>
            ))}
          </div>
        </div>

        <Button onClick={handleSave} disabled={!canSave} className="w-full gradient-primary text-white">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          {profile ? 'Update Profile' : 'Create Profile'}
        </Button>
      </GlassCard>
    </div>
  );
}
