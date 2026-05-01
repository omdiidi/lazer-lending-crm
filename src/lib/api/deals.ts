import { supabase } from '@/lib/supabase';
import { transformRows, toCamelCase, toSnakeCase } from '@/lib/transforms';
import type { Deal } from '@/types/crm';

export async function getDeals(): Promise<Deal[]> {
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return transformRows<Deal>(data || []);
}

export async function getDeal(id: string): Promise<Deal | null> {
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return toCamelCase<Deal>(data);
}

export async function createDeal(deal: Omit<Deal, 'id' | 'createdAt' | 'updatedAt'>): Promise<Deal> {
  const snaked = toSnakeCase(deal as unknown as Record<string, unknown>);
  const { data, error } = await supabase
    .from('deals')
    .insert(snaked)
    .select()
    .single();

  if (error) throw error;
  return toCamelCase<Deal>(data);
}

export async function updateDeal(id: string, updates: Partial<Deal>): Promise<void> {
  const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = updates;
  const snaked = toSnakeCase(rest as unknown as Record<string, unknown>);
  const { error } = await supabase
    .from('deals')
    .update(snaked)
    .eq('id', id);

  if (error) throw error;
}

export async function deleteDeal(id: string): Promise<void> {
  const { error } = await supabase
    .from('deals')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}
