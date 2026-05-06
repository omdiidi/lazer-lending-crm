import { supabase } from '@/lib/supabase';
import { transformRows, toCamelCase } from '@/lib/transforms';
import type { Mailbox, PoolMembership, SendingPool } from '@/types/lazer';

export async function getSendingPools(): Promise<SendingPool[]> {
  const { data, error } = await supabase
    .from('sending_pools')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return transformRows<SendingPool>(data || []);
}

export async function createSendingPool(name: string): Promise<SendingPool> {
  const { data, error } = await supabase
    .from('sending_pools')
    .insert({ name })
    .select()
    .single();

  if (error) throw error;
  return toCamelCase<SendingPool>(data);
}

export async function addMailboxToPool(
  poolId: string,
  mailboxId: string,
): Promise<PoolMembership> {
  const { data, error } = await supabase
    .from('pool_memberships')
    .insert({ pool_id: poolId, mailbox_id: mailboxId })
    .select()
    .single();

  if (error) throw error;
  return toCamelCase<PoolMembership>(data);
}

export async function removeMailboxFromPool(
  poolId: string,
  mailboxId: string,
): Promise<void> {
  const { error } = await supabase
    .from('pool_memberships')
    .delete()
    .eq('pool_id', poolId)
    .eq('mailbox_id', mailboxId);

  if (error) throw error;
}

export async function getMailboxesInPool(poolId: string): Promise<Mailbox[]> {
  const { data, error } = await supabase
    .from('pool_memberships')
    .select('mailbox:mailboxes(*, domain:domains(hostname, status))')
    .eq('pool_id', poolId);

  if (error) throw error;
  // Unwrap the join: each row has { mailbox: {...} }
  const mailboxRows = (data || [])
    .map((row: Record<string, unknown>) => row.mailbox)
    .filter(Boolean);
  return transformRows<Mailbox>(mailboxRows as Record<string, unknown>[]);
}
