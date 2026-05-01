import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api/profiles';
import { deleteMember as deleteMemberApi } from '@/lib/api/team';
import type { User } from '@/types/crm';

export function useProfiles() {
  const queryClient = useQueryClient();

  const { data: profiles = [], isLoading, error } = useQuery({
    queryKey: ['profiles'],
    queryFn: api.getProfiles,
  });

  const updateProfileMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Pick<User, 'name' | 'avatar' | 'emailPrefix'>> }) =>
      api.updateProfile(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
  });

  const deleteMemberMutation = useMutation({
    mutationFn: (userId: string) => deleteMemberApi(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
  });

  return {
    profiles,
    isLoading,
    error,
    updateProfile: (id: string, updates: Partial<Pick<User, 'name' | 'avatar' | 'emailPrefix'>>) =>
      updateProfileMutation.mutateAsync({ id, updates }),
    deleteMember: (userId: string) => deleteMemberMutation.mutateAsync(userId),
  };
}
