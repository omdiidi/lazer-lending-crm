import { supabase } from '@/lib/supabase';
import { transformRows, toCamelCase, toSnakeCase } from '@/lib/transforms';
import type { Activity } from '@/types/crm';

export async function getActivities(): Promise<Activity[]> {
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .is('deleted_at', null)
    .order('timestamp', { ascending: false });

  if (error) throw error;
  return transformRows<Activity>(data || []);
}

export async function getActivitiesByLead(leadId: string): Promise<Activity[]> {
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('lead_id', leadId)
    .is('deleted_at', null)
    .order('timestamp', { ascending: false });

  if (error) throw error;
  return transformRows<Activity>(data || []);
}

export async function createActivity(
  activity: Omit<Activity, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Activity> {
  const snaked = toSnakeCase(activity as unknown as Record<string, unknown>);
  // Ensure metadata is cast properly for jsonb
  if (activity.metadata) {
    (snaked as Record<string, unknown>).metadata = activity.metadata;
  }
  const { data, error } = await supabase
    .from('activities')
    .insert(snaked)
    .select()
    .single();

  if (error) throw error;
  return toCamelCase<Activity>(data);
}
