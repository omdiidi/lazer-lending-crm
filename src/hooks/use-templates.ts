import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import * as api from '@/lib/api/templates';

export function useTemplates() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: templates = [], isLoading, error } = useQuery({
    queryKey: ['templates', user?.id],
    queryFn: () => api.getTemplates(user!.id),
    enabled: !!user?.id,
  });

  const createTemplateMutation = useMutation({
    mutationFn: (template: { name: string; subject: string; body: string; tags?: string[] }) =>
      api.createTemplate({ ...template, createdBy: user!.id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (id: string) => api.deleteTemplate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });

  return {
    templates,
    isLoading,
    error,
    createTemplate: (template: { name: string; subject: string; body: string; tags?: string[] }) =>
      createTemplateMutation.mutateAsync(template),
    deleteTemplate: (id: string) => deleteTemplateMutation.mutateAsync(id),
  };
}
