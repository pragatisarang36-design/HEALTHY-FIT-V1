import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/lib/AuthContext';
import { useProfile } from '@/lib/useProfile';
import { format } from 'date-fns';
import { Droplets, Plus, Minus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import GlassCard from '@/components/ui/GlassCard';
import { Progress } from '@/components/ui/progress';
import { motion } from 'framer-motion';

export default function WaterTracker() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const queryClient = useQueryClient();
  const { profile } = useProfile();
  const { user } = useAuth();

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['water-today', today, user?.id],
    queryFn: () => dataService.entities.WaterIntake.filter({ date: today, created_by: user?.email }),
    initialData: [],
    enabled: !!user?.email,
  });

  const totalGlasses = entries.reduce((sum, e) => sum + (e.glasses || 0), 0);
  const goalGlasses = Math.round((profile?.water_goal_litres || 2.5) * 5);
  const percent = Math.min(100, Math.round((totalGlasses / goalGlasses) * 100));

  const addMutation = useMutation({
    mutationFn: () => dataService.entities.WaterIntake.create({ glasses: 1, date: today }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['water-today'] }),
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      if (entries.length > 0) {
        const last = entries[entries.length - 1];
        if (last.glasses > 1) {
          await dataService.entities.WaterIntake.update(last.id, { glasses: last.glasses - 1 });
        } else {
          await dataService.entities.WaterIntake.delete(last.id);
        }
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['water-today'] }),
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <div>
        <h1 className="text-2xl font-heading font-bold">Water Tracker</h1>
        <p className="text-muted-foreground text-sm">{format(new Date(), 'EEEE, MMMM d')}</p>
      </div>

      <GlassCard className="text-center">
        <Droplets className="w-10 h-10 text-blue-500 mx-auto mb-3" />
        <p className="text-5xl font-bold font-heading">{totalGlasses}</p>
        <p className="text-muted-foreground mt-1">of {goalGlasses} glasses</p>
        <Progress value={percent} className="h-3 mt-4" />
        <p className="text-sm text-muted-foreground mt-2">{percent}% — {(totalGlasses * 200 / 1000).toFixed(1)}L of {profile?.water_goal_litres || 2.5}L</p>
      </GlassCard>

      <div className="flex justify-center gap-4">
        <Button
          variant="outline"
          size="lg"
          onClick={() => removeMutation.mutate()}
          disabled={totalGlasses === 0 || removeMutation.isPending}
          className="rounded-full w-14 h-14"
        >
          <Minus className="w-5 h-5" />
        </Button>
        <Button
          size="lg"
          onClick={() => addMutation.mutate()}
          disabled={addMutation.isPending}
          className="rounded-full w-14 h-14 gradient-primary text-white"
        >
          <Plus className="w-5 h-5" />
        </Button>
      </div>

      <GlassCard>
        <p className="text-sm font-semibold mb-3">Today's Glasses</p>
        <div className="flex flex-wrap gap-2 justify-center">
          {Array.from({ length: goalGlasses }).map((_, i) => (
            <motion.div
              key={i}
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className={`w-10 h-12 rounded-lg flex items-center justify-center text-lg transition-colors ${
                i < totalGlasses
                  ? 'bg-blue-500/20 text-blue-500'
                  : 'bg-muted text-muted-foreground/30'
              }`}
            >
              🥛
            </motion.div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
