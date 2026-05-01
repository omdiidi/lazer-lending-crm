import { useQuery } from '@tanstack/react-query';
import { getTopEngagedLeads } from '@/lib/api/engagement';

export function useEngagement(limit = 10) {
  const { data: topLeads = [], isLoading, error } = useQuery({
    queryKey: ['engagement', limit],
    queryFn: () => getTopEngagedLeads(limit),
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  });

  return { topLeads, isLoading, error };
}
