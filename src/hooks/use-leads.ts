import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api/leads';
import { supabase } from '@/lib/supabase';
import type { Lead } from '@/types/crm';

export function useLeads() {
  const queryClient = useQueryClient();

  const { data: leads = [], isLoading, error } = useQuery({
    queryKey: ['leads'],
    queryFn: api.getLeads,
  });

  useEffect(() => {
    const channel = supabase
      .channel('leads-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
        queryClient.invalidateQueries({ queryKey: ['leads'] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const updateLeadMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Lead> }) =>
      api.updateLead(id, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  });

  const addLeadsMutation = useMutation({
    mutationFn: async (newLeads: Omit<Lead, 'id' | 'createdAt'>[]) => {
      await api.mergePhoneReveals(newLeads)
      return api.createLeads(newLeads)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  });

  const deleteLeadMutation = useMutation({
    mutationFn: (id: string) => api.deleteLead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  });

  return {
    leads,
    isLoading,
    error,
    updateLead: (id: string, updates: Partial<Lead>) =>
      updateLeadMutation.mutate({ id, updates }),
    updateLeadAsync: (id: string, updates: Partial<Lead>) =>
      updateLeadMutation.mutateAsync({ id, updates }),
    addLeads: (newLeads: Omit<Lead, 'id' | 'createdAt'>[]) =>
      addLeadsMutation.mutate(newLeads),
    deleteLead: (id: string) => deleteLeadMutation.mutate(id),
  };
}
