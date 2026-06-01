import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAppSettings, updateAppSettings } from '@/lib/api/app-settings';
import { toast } from 'sonner';

export const APP_SETTINGS_KEY = ['app-settings'] as const;

export function useAppSettings() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: APP_SETTINGS_KEY,
    queryFn: getAppSettings,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: APP_SETTINGS_KEY });
      toast.success('Settings saved');
    },
    onError: () => toast.error('Failed to save settings'),
  });

  return {
    ...query,
    update: mutation.mutate,
    updateAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
}
