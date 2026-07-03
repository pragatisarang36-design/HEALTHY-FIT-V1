import React, { useState } from 'react';
import { Sun, Moon, Bell, Trash2, LogOut } from 'lucide-react';
import { useDarkMode } from '@/lib/useDarkMode';
import { useProfile } from '@/lib/useProfile';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { dataService } from '@/services/dataService';
import { format } from 'date-fns';
import { toast } from '@/components/ui/use-toast';
import {
  Popover, PopoverContent, PopoverTrigger
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function TopBar() {
  const { isDark, toggle } = useDarkMode();
  const { profile } = useProfile();
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: () => dataService.entities.Notification.filter({ created_by: user?.email }, '-created_date', 20),
    initialData: [],
    enabled: !!user?.email,
  });

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const markReadMutation = useMutation({
    mutationFn: (id) => dataService.entities.Notification.update(id, { is_read: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => dataService.entities.Notification.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const handleOpen = (isOpen) => {
    setOpen(isOpen);
    if (isOpen) {
      notifications.filter(n => !n.is_read).forEach(n => {
        markReadMutation.mutate(n.id);
      });
    }
  };

  return (
    <div className="sticky top-0 z-30 h-16 flex items-center justify-between px-4 md:px-8 glass border-b border-border/50">
      <div className="md:hidden w-10" />
      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <Popover open={open} onOpenChange={handleOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-destructive text-[10px] text-white flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end">
            <div className="p-3 border-b border-border">
              <h4 className="font-semibold text-sm">Notifications</h4>
            </div>
            <ScrollArea className="max-h-72">
              {notifications.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground text-center">No notifications yet</p>
              ) : (
                notifications.map(n => (
                  <div key={n.id} className="flex items-start gap-2 p-3 border-b border-border/50 hover:bg-muted/50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{n.message}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {n.created_date ? format(new Date(n.created_date), 'MMM d, h:mm a') : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteMutation.mutate(n.id)}
                      className="p-1 text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </ScrollArea>
          </PopoverContent>
        </Popover>

        <Button variant="ghost" size="icon" onClick={toggle}>
          {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </Button>

        {profile && (
          <div className="hidden md:flex items-center gap-2 pl-2 border-l border-border">
            <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-white text-sm font-semibold">
              {profile.name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <span className="text-sm font-medium">{profile.name || 'User'}</span>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={async () => {
            try {
              queryClient.clear();
              const { error } = await signOut();
              if (error) throw error;
              navigate('/login', { replace: true });
            } catch (error) {
              toast({ title: error.message || 'Failed to log out', variant: 'destructive' });
            }
          }}
          title="Log out"
        >
          <LogOut className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}
