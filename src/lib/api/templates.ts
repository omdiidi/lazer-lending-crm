import { supabase } from '@/lib/supabase';
import { transformRows, toCamelCase, toSnakeCase } from '@/lib/transforms';
import type { CampaignTemplate } from '@/types/crm';

export async function getTemplates(userId: string): Promise<CampaignTemplate[]> {
  const { data, error } = await supabase
    .from('campaign_templates')
    .select('*')
    .eq('created_by', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return transformRows<CampaignTemplate>(data || []);
}

export async function createTemplate(
  template: { name: string; subject: string; body: string; createdBy: string; tags?: string[] }
): Promise<CampaignTemplate> {
  const snaked = toSnakeCase(template as unknown as Record<string, unknown>);
  const { data, error } = await supabase
    .from('campaign_templates')
    .insert(snaked)
    .select()
    .single();

  if (error) throw error;
  return toCamelCase<CampaignTemplate>(data);
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from('campaign_templates')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
