import { supabase } from '@/lib/supabase';
import { transformRows, toCamelCase } from '@/lib/transforms';
import type { Mailbox, PausedReason, WarmupStats } from '@/types/lazer';

export async function getMailboxes(): Promise<Mailbox[]> {
  const { data, error } = await supabase
    .from('mailboxes')
    .select('*, domain:domains(hostname, status)')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return transformRows<Mailbox>(data || []);
}

export async function getMailboxesByDomain(domainId: string): Promise<Mailbox[]> {
  const { data, error } = await supabase
    .from('mailboxes')
    .select('*, domain:domains(hostname, status)')
    .eq('domain_id', domainId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return transformRows<Mailbox>(data || []);
}

export async function getMailbox(id: string): Promise<Mailbox | null> {
  const { data, error } = await supabase
    .from('mailboxes')
    .select('*, domain:domains(hostname, status)')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return toCamelCase<Mailbox>(data);
}

export interface CreateMailboxPayload {
  address: string;
  domainId: string;
  poolId?: string | null;
  dailyCap?: number;
  timezone?: string;
}

/**
 * Inserts a mailbox row + (optional) pool membership in a single round trip.
 * Mailbox state machine starts at warmup_state='provisioning',
 * connection_status='disconnected'. Smartlead account_id is filled in later
 * once the mailbox is connected via the Smartlead UI (per design D5).
 */
export async function createMailbox(
  payload: CreateMailboxPayload,
): Promise<Mailbox> {
  const { data: mailbox, error } = await supabase
    .from('mailboxes')
    .insert({
      address: payload.address,
      domain_id: payload.domainId,
      daily_cap: payload.dailyCap ?? 30,
      timezone: payload.timezone ?? 'America/Phoenix',
      // explicit defaults so it's clear what state new rows land in
      warmup_state: 'provisioning',
      connection_status: 'disconnected',
    })
    .select('*, domain:domains(hostname, status)')
    .single();

  if (error) throw error;

  if (payload.poolId) {
    const { error: pmErr } = await supabase
      .from('pool_memberships')
      .insert({ pool_id: payload.poolId, mailbox_id: mailbox.id });
    if (pmErr) throw pmErr;
  }

  return toCamelCase<Mailbox>(mailbox);
}

export async function pauseMailbox(
  id: string,
  reason: PausedReason,
): Promise<void> {
  const { error } = await supabase
    .from('mailboxes')
    .update({
      paused_reason: reason,
      warmup_state: 'paused',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
}

export async function resumeMailbox(id: string): Promise<void> {
  const { error } = await supabase
    .from('mailboxes')
    .update({
      paused_reason: null,
      warmup_state: 'live',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
}

/**
 * Fetches warmup stats for a mailbox from the `mailbox-warmup-stats` Edge Function.
 * The function proxies to Smartlead's account stats API.
 * Returns null while the Edge Function is pending deployment (B12-blocked).
 */
export async function getWarmupStats(
  mailboxId: string,
): Promise<WarmupStats | null> {
  const { data: { session } } = await supabase.auth.getSession();
  try {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mailbox-warmup-stats?mailbox_id=${mailboxId}`,
      {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      },
    );
    if (!res.ok) return null;
    return res.json() as Promise<WarmupStats>;
  } catch {
    return null;
  }
}
