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
  // Try the Zapmail-backed Edge Function first; fall back to a direct DB
  // insert when the function is missing/404 (e.g., during local dev without
  // Zapmail credentials, or before B12 unblocks). Manual provisioning still
  // works — the row just lands in `provisioning` status and an admin can
  // walk DNS verification by hand.
  const { data: { session } } = await supabase.auth.getSession();

  try {
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
    if (res.ok) {
      const data = await res.json();
      return toCamelCase<Domain>(data.domain ?? data);
    }
    // 404 means the function isn't deployed; fall through to direct insert.
    if (res.status !== 404) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Provisioning failed (${res.status})`);
    }
  } catch (err) {
    // Network errors / fetch failures (function genuinely missing) → fall through.
    if (!(err instanceof TypeError)) throw err;
  }

  const { data, error } = await supabase
    .from('domains')
    .insert({
      hostname: payload.hostname,
      provider: payload.provider ?? 'zapmail',
      status: 'provisioning',
      owner_entity: payload.ownerEntity ?? null,
      registrar: payload.registrar ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return toCamelCase<Domain>(data);
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
