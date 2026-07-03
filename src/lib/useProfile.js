import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { dataService } from '@/services/dataService';

export function useProfile() {
  const { user } = useAuth();

  const {
    data: profiles = [],
    isLoading,
    error,
    isError,
  } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: () => dataService.entities.Profile.filter(),
    enabled: !!user?.id,
    retry: (failureCount, error) => {
      if (error?.status >= 400 && error?.status < 500) return false;
      return failureCount < 1;
    },
  });

  const profile = profiles[0] || null;
  const isProfileComplete = profile?.is_profile_complete === true;

  return {
    profile,
    isLoading,
    error,
    isError,
    isProfileComplete,
  };
}
