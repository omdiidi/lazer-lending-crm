import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api/suggestions';
import type { AISuggestion } from '@/types/crm';

export function useSuggestions(leadId?: string) {
  const queryClient = useQueryClient();

  const { data: suggestions = [], isLoading, error } = useQuery({
    queryKey: leadId ? ['suggestions', leadId] : ['suggestions'],
    queryFn: () => leadId ? api.getSuggestionsByLead(leadId) : api.getSuggestions(),
  });

  const dismissSuggestionMutation = useMutation({
    mutationFn: (id: string) => api.dismissSuggestion(id),
    onSuccess: () => {
      // Invalidate all suggestion queries (both global and per-lead)
      queryClient.invalidateQueries({ queryKey: ['suggestions'] });
    },
  });

  return {
    suggestions,
    isLoading,
    error,
    dismissSuggestion: (id: string) => dismissSuggestionMutation.mutate(id),
  };
}
