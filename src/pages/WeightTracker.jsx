import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/lib/AuthContext';
import { useProfile } from '@/lib/useProfile';
import { format } from 'date-fns';
import { Weight, Plus, Loader2, Trash2, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import GlassCard from '@/components/ui/GlassCard';
import EmptyState from '@/components/ui/EmptyState';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useEnterSubmit } from '@/hooks/useEnterSubmit';

export default function WeightTracker() {
  const queryClient = useQueryClient();
  const { profile } = useProfile();
  const { user } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [weightInput, setWeightInput] = useState('');

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['weight-logs', user?.id],
    queryFn: () => dataService.entities.WeightLog.filter({ created_by: user?.email }, '-date', 50),
    initialData: [],
    enabled: !!user?.email,
  });

  const createMutation = useMutation({
    mutationFn: (data) => dataService.entities.WeightLog.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weight-logs'] });
      setShowAdd(false);
      setWeightInput('');
      toast({ title: 'Weight logged!' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => dataService.entities.WeightLog.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['weight-logs'] }),
  });

  const handleAdd = () => {
    if (!weightInput) return;
    createMutation.mutate({ weight: Number(weightInput), date: format(new Date(), 'yyyy-MM-dd') });
  };
  const handleAddKeyDown = useEnterSubmit(handleAdd, Boolean(weightInput) && !createMutation.isPending);

  const chartData = [...logs].reverse().map(l => ({
    date: format(new Date(l.date), 'MMM d'),
    weight: l.weight,
  }));

  const latestWeight = logs[0]?.weight || profile?.weight || 0;
  const targetWeight = profile?.target_weight || 0;
  const diff = targetWeight > 0 ? Math.abs(latestWeight - targetWeight).toFixed(1) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">Weight Tracker</h1>
          <p className="text-muted-foreground text-sm">Track your weekly progress</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="gradient-primary text-white">
          <Plus className="w-4 h-4 mr-2" /> Log Weight
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <GlassCard className="text-center">
          <Weight className="w-6 h-6 text-purple-500 mx-auto mb-1" />
          <p className="text-2xl font-bold font-heading">{latestWeight}</p>
          <p className="text-xs text-muted-foreground">Current (kg)</p>
        </GlassCard>
        <GlassCard className="text-center">
          <Target className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
          <p className="text-2xl font-bold font-heading">{targetWeight || '—'}</p>
          <p className="text-xs text-muted-foreground">Target (kg)</p>
        </GlassCard>
        {diff && (
          <GlassCard className="text-center col-span-2 md:col-span-1">
            <p className="text-2xl font-bold font-heading text-primary">{diff}</p>
            <p className="text-xs text-muted-foreground">kg to go</p>
          </GlassCard>
        )}
      </div>

      {chartData.length > 1 && (
        <GlassCard>
          <h3 className="font-semibold mb-3">Weight Trend</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis domain={['auto', 'auto']} tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
              <Line type="monotone" dataKey="weight" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: 'hsl(var(--primary))' }} />
              {targetWeight > 0 && (
                <ReferenceLine y={targetWeight} stroke="hsl(var(--destructive))" strokeDasharray="5 5" label={{ value: 'Target', fontSize: 11 }} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </GlassCard>
      )}

      <GlassCard>
        <h3 className="font-semibold mb-3">Log History</h3>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : logs.length === 0 ? (
          <EmptyState icon={Weight} title="No weight logs" description="Start logging your weight weekly." />
        ) : (
          <div className="space-y-2">
            {logs.map(l => (
              <div key={l.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                <div>
                  <p className="font-semibold text-sm">{l.weight} kg</p>
                  <p className="text-xs text-muted-foreground">{format(new Date(l.date), 'MMM d, yyyy')}</p>
                </div>
                <button onClick={() => deleteMutation.mutate(l.id)} className="p-1 text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Log Weight</DialogTitle>
          </DialogHeader>
          <div className="space-y-4" onKeyDown={handleAddKeyDown}>
            <div>
              <Label htmlFor="weight-kg">Weight (kg)</Label>
              <Input
                id="weight-kg"
                name="weightKg"
                type="number"
                step="0.1"
                value={weightInput}
                onChange={e => setWeightInput(e.target.value)}
                placeholder="70.5"
              />
            </div>
            <Button onClick={handleAdd} disabled={createMutation.isPending || !weightInput} className="w-full">
              {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
