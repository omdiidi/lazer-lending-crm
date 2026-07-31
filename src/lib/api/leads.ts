import { supabase } from '@/lib/supabase';
import { transformRows, toCamelCase, toSnakeCase } from '@/lib/transforms';
import type { Lead } from '@/types/crm';

// Supabase/PostgREST caps a single response at max_rows (1000 by default), so we
// page through with .range() to fetch every lead regardless of table size.
const PAGE_SIZE = 1000;

export async function getLeads(): Promise<Lead[]> {
  // IMPORTANT: created_at alone is NOT a stable sort — bulk imports write thousands
  // of rows in the same second, and Postgres returns ties in arbitrary order. Without
  // the `id` tiebreaker, page boundaries shift between requests, so the same lead can
  // appear on two pages (and others get skipped) → duplicate React keys → corrupted
  // table rendering. The id tiebreaker makes pagination deterministic; the Map dedupes
  // defensively in case rows move between page fetches.
  const byId = new Map<string, Record<string, unknown>>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data as Record<string, unknown>[]) {
      byId.set(String(row.id), row);
    }
    if (data.length < PAGE_SIZE) break;
  }
  return transformRows<Lead>([...byId.values()]);
}

export async function getLead(id: string): Promise<Lead | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return toCamelCase<Lead>(data);
}

export async function createLead(lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>): Promise<Lead> {
  const snaked = toSnakeCase(lead as unknown as Record<string, unknown>);
  const { data, error } = await supabase
    .from('leads')
    .insert(snaked)
    .select()
    .single();

  if (error) throw error;
  return toCamelCase<Lead>(data);
}

export async function updateLead(id: string, updates: Partial<Lead>): Promise<void> {
  const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = updates;
  const snaked = toSnakeCase(rest as unknown as Record<string, unknown>);
  const { error } = await supabase
    .from('leads')
    .update(snaked)
    .eq('id', id);

  if (error) throw error;
}

export async function createLeads(
  leads: Omit<Lead, 'id' | 'createdAt'>[]
): Promise<Lead[]> {
  // Insert in chunks: keeps each request payload/response under PostgREST's
  // max_rows cap (1000) so large imports (5k+ rows) don't silently truncate,
  // and every inserted row is returned for an accurate count.
  const CHUNK = 500;
  const inserted: unknown[] = [];
  for (let i = 0; i < leads.length; i += CHUNK) {
    const slice = leads.slice(i, i + CHUNK);
    const snaked = slice.map(l => toSnakeCase(l as unknown as Record<string, unknown>));
    const { data, error } = await supabase
      .from('leads')
      .insert(snaked)
      .select();

    if (error) throw error;
    if (data) inserted.push(...data);
  }
  return transformRows<Lead>(inserted);
}

export async function deleteLead(id: string): Promise<void> {
  const { error } = await supabase
    .from('leads')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

export async function incrementCallCount(leadIds: string[], amount = 1): Promise<void> {
  const { error } = await supabase.rpc('increment_call_count', { lead_ids: leadIds, amount });
  if (error) throw error;
}

export async function incrementEmailCount(leadIds: string[], amount = 1): Promise<void> {
  const { error } = await supabase.rpc('increment_email_count', { lead_ids: leadIds, amount });
  if (error) throw error;
}

export async function mergePhoneReveals(leads: Array<{ apolloId?: string | null; phone?: string }>): Promise<void> {
  const apolloIds = leads.map(l => l.apolloId).filter(Boolean) as string[]
  if (apolloIds.length === 0) return

  const { data: reveals } = await supabase
    .from('phone_reveals')
    .select('apollo_id, phone')
    .in('apollo_id', apolloIds)

  if (!reveals || reveals.length === 0) return

  const phoneMap = new Map(reveals.map(r => [r.apollo_id, r.phone]))
  for (const lead of leads) {
    if (lead.apolloId && !lead.phone && phoneMap.has(lead.apolloId)) {
      lead.phone = phoneMap.get(lead.apolloId)!
    }
  }
}
