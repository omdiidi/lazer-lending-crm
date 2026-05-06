import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api/domains';
import type { CreateDomainPayload, UpdateDomainPayload } from '@/types/lazer';

export function useDomains() {
  const queryClient = useQueryClient();

  const { data: domains = [], isLoading, error } = useQuery({
    queryKey: ['domains'],
    queryFn: api.getDomains,
  });

  const createDomainMutation = useMutation({
    mutationFn: (payload: CreateDomainPayload) => api.createDomain(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['domains'] }),
  });

  const updateDomainMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: UpdateDomainPayload }) =>
      api.updateDomain(id, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['domains'] }),
  });

  const retireDomainMutation = useMutation({
    mutationFn: (id: string) => api.retireDomain(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['domains'] }),
  });

  return {
    domains,
    isLoading,
    error,
    createDomain: (payload: CreateDomainPayload) =>
      createDomainMutation.mutate(payload),
    createDomainAsync: (payload: CreateDomainPayload) =>
      createDomainMutation.mutateAsync(payload),
    isCreating: createDomainMutation.isPending,
    updateDomain: (id: string, updates: UpdateDomainPayload) =>
      updateDomainMutation.mutate({ id, updates }),
    retireDomain: (id: string) => retireDomainMutation.mutate(id),
    isRetiring: retireDomainMutation.isPending,
  };
}
