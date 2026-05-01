import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api/projects';
import { supabase } from '@/lib/supabase';
import type { Project } from '@/types/crm';

export function useProjects() {
  const queryClient = useQueryClient();

  const { data: projects = [], isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
  });

  useEffect(() => {
    const channel = supabase
      .channel('projects-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => {
        queryClient.invalidateQueries({ queryKey: ['projects'] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const createProjectMutation = useMutation({
    mutationFn: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) =>
      api.createProject(project),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const updateProjectMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Project> }) =>
      api.updateProject(id, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const duplicateProjectMutation = useMutation({
    mutationFn: ({ projectId, createdBy }: { projectId: string; createdBy: string }) =>
      api.duplicateProject(projectId, createdBy),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  return {
    projects,
    isLoading,
    error,
    createProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) =>
      createProjectMutation.mutateAsync(project),
    updateProject: (id: string, updates: Partial<Project>) =>
      updateProjectMutation.mutate({ id, updates }),
    deleteProject: (id: string) => deleteProjectMutation.mutate(id),
    duplicateProject: (projectId: string, createdBy: string) =>
      duplicateProjectMutation.mutateAsync({ projectId, createdBy }),
  };
}
