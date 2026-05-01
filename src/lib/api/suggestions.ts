import { supabase } from '@/lib/supabase';
import { transformRows } from '@/lib/transforms';
import type { AISuggestion } from '@/types/crm';

export async function getSuggestions(): Promise<AISuggestion[]> {
  const { data, error } = await supabase
    .from('ai_suggestions')
    .select('*')
    .eq('dismissed', false)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return transformRows<AISuggestion>(data || []);
}

export async function getSuggestionsByLead(leadId: string): Promise<AISuggestion[]> {
  const { data, error } = await supabase
    .from('ai_suggestions')
    .select('*')
    .eq('lead_id', leadId)
    .eq('dismissed', false)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return transformRows<AISuggestion>(data || []);
}

export async function dismissSuggestion(id: string): Promise<void> {
  const { error } = await supabase
    .from('ai_suggestions')
    .update({ dismissed: true })
    .eq('id', id);

  if (error) throw error;
}
