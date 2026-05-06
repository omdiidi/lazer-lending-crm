import { supabase } from '@/lib/supabase';
import { transformRows, toCamelCase, toSnakeCase } from '@/lib/transforms';
import type {
  Domain,
  CreateDomainPayload,
  UpdateDomainPayload,
} from '@/types/lazer';

export async function getDomains(): Promise<Domain[]> {
  const { data, error } = await supabase
    .from('domains')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return transformRows<Domain>(data || []);
}

export async function getDomain(id: string): Promise<Domain | null> {
  const { data, error } = await supabase
    .from('domains')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return toCamelCase<Domain>(data);
}

export async function createDomain(payload: CreateDomainPayload): Promise<Domain> {
  // Placeholder: calls the `domains-provision` Edge Function which
  // proxies to Zapmail's provisioning API. The function is not deployed yet (B12-blocked).
  // UI renders optimistically; status starts at 'provisioning'.
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/domains-provision`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Provisioning failed (${res.status})`);
  }

  const data = await res.json();
  return toCamelCase<Domain>(data.domain ?? data);
}

export async function updateDomain(
  id: string,
  updates: UpdateDomainPayload,
): Promise<void> {
  const snaked = toSnakeCase(updates as unknown as Record<string, unknown>);
  const { error } = await supabase
    .from('domains')
    .update({ ...snaked, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

export async function retireDomain(id: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('domains')
    .update({
      status: 'cooldown',
      retired_at: now,
      cooldown_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: now,
    })
    .eq('id', id);

  if (error) throw error;
}
