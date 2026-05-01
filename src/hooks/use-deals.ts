import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api/deals';
import { supabase } from '@/lib/supabase';
import type { Deal } from '@/types/crm';

export function useDeals() {
  const queryClient = useQueryClient();

  const { data: deals = [], isLoading, error } = useQuery({
    queryKey: ['deals'],
    queryFn: api.getDeals,
  });

  useEffect(() => {
    const channel = supabase
      .channel('deals-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, () => {
        queryClient.invalidateQueries({ queryKey: ['deals'] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const updateDealMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Deal> }) =>
      api.updateDeal(id, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deals'] }),
  });

  const createDealMutation = useMutation({
    mutationFn: (deal: Omit<Deal, 'id' | 'createdAt' | 'updatedAt'>) =>
      api.createDeal(deal),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deals'] }),
  });

  const deleteDealMutation = useMutation({
    mutationFn: (id: string) => api.deleteDeal(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deals'] }),
  });

  return {
    deals,
    isLoading,
    error,
    updateDeal: (id: string, updates: Partial<Deal>) =>
      updateDealMutation.mutate({ id, updates }),
    createDeal: (deal: Omit<Deal, 'id' | 'createdAt' | 'updatedAt'>) =>
      createDealMutation.mutate(deal),
    deleteDeal: (id: string) => deleteDealMutation.mutate(id),
  };
}
