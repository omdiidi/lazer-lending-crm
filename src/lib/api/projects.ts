import { supabase } from '@/lib/supabase';
import { transformRows, toCamelCase, toSnakeCase } from '@/lib/transforms';
import type { Project } from '@/types/crm';

export async function getProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return transformRows<Project>(data || []);
}

export async function getProject(id: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return toCamelCase<Project>(data);
}

export async function createProject(
  project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Project> {
  const snaked = toSnakeCase(project as unknown as Record<string, unknown>);
  const { data, error } = await supabase
    .from('projects')
    .insert(snaked)
    .select()
    .single();

  if (error) throw error;
  return toCamelCase<Project>(data);
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<void> {
  const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = updates;
  const snaked = toSnakeCase(rest as unknown as Record<string, unknown>);
  const { error } = await supabase
    .from('projects')
    .update(snaked)
    .eq('id', id);

  if (error) throw error;
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

export async function duplicateProject(
  projectId: string,
  createdBy: string
): Promise<Project> {
  const original = await getProject(projectId);
  if (!original) throw new Error('Project not found');

  return createProject({
    title: `${original.title} (Copy)`,
    goal: original.goal,
    outcomes: original.outcomes,
    notes: original.notes,
    status: 'active',
    createdBy,
  });
}
