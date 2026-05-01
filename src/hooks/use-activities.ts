import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api/activities';
import { supabase } from '@/lib/supabase';
import type { Activity } from '@/types/crm';

export function useActivities(leadId?: string) {
  const queryClient = useQueryClient();

  const { data: activities = [], isLoading, error } = useQuery({
    queryKey: leadId ? ['activities', leadId] : ['activities'],
    queryFn: () => leadId ? api.getActivitiesByLead(leadId) : api.getActivities(),
  });

  useEffect(() => {
    const channel = supabase
      .channel('activities-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, () => {
        queryClient.invalidateQueries({ queryKey: ['activities'] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const addActivityMutation = useMutation({
    mutationFn: (activity: Omit<Activity, 'id'>) =>
      api.createActivity(activity),
    onSuccess: () => {
      // Invalidate all activity queries (both global and per-lead)
      queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });

  return {
    activities,
    isLoading,
    error,
    addActivity: (activity: Omit<Activity, 'id'>) =>
      addActivityMutation.mutate(activity),
  };
}
