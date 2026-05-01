import { useQuery } from '@tanstack/react-query';
import * as api from '@/lib/api/sequences';

export function useSequences() {
  const { data: sequences = [], isLoading, error } = useQuery({
    queryKey: ['sequences'],
    queryFn: api.getSequences,
  });

  return {
    sequences,
    isLoading,
    error,
  };
}
