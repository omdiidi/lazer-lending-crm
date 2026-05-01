import { supabase } from '@/lib/supabase';
import type { Lead } from '@/types/crm';

export interface SearchHistoryEntry {
  id: string;
  prompt: string;
  leads: Lead[];
  filters: Record<string, unknown>;
  totalFound: number;
  creditsUsed: number;
  imported: boolean;
  createdAt: string;
}

export async function saveSearchHistory(entry: {
  userId: string;
  prompt: string;
  leads: Lead[];
  filters: Record<string, unknown>;
  totalFound: number;
  creditsUsed: number;
}): Promise<string> {
  const { data, error } = await supabase.from('lead_search_history').insert({
    user_id: entry.userId,
    prompt: entry.prompt,
    leads: entry.leads,
    filters: entry.filters,
    total_found: entry.totalFound,
    credits_used: entry.creditsUsed,
  }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function loadSearchHistory(userId: string): Promise<SearchHistoryEntry[]> {
  const { data, error } = await supabase.from('lead_search_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(20);
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    prompt: row.prompt,
    leads: (row.leads as Lead[]) || [],
    filters: (row.filters as Record<string, unknown>) || {},
    totalFound: row.total_found,
    creditsUsed: row.credits_used,
    imported: row.imported,
    createdAt: row.created_at,
  }));
}

export async function markSearchImported(id: string): Promise<void> {
  const { error } = await supabase.from('lead_search_history')
    .update({ imported: true })
    .eq('id', id);
  if (error) throw error;
}
