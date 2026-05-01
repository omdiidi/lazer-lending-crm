import { supabase } from '@/lib/supabase';
import { transformRows, toCamelCase, toSnakeCase } from '@/lib/transforms';
import type { Campaign } from '@/types/crm';

export async function getCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .is('deleted_at', null)
    .order('sent_at', { ascending: false });

  if (error) throw error;
  return transformRows<Campaign>(data || []);
}

export async function createCampaign(
  campaign: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Campaign> {
  const snaked = toSnakeCase(campaign as unknown as Record<string, unknown>);
  const { data, error } = await supabase
    .from('campaigns')
    .insert(snaked)
    .select()
    .single();

  if (error) throw error;
  return toCamelCase<Campaign>(data);
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const { data, error } = await supabase.from('campaigns').select('*').eq('id', id).single();
  if (error) { if (error.code === 'PGRST116') return null; throw error; }
  return toCamelCase<Campaign>(data);
}

export async function updateCampaign(id: string, updates: Partial<Campaign>): Promise<void> {
  const { id: _id, ...rest } = updates;
  const snaked = toSnakeCase(rest as unknown as Record<string, unknown>);
  const { error } = await supabase.from('campaigns').update(snaked).eq('id', id);
  if (error) throw error;
}

export async function cloneCampaign(id: string): Promise<Campaign> {
  const original = await getCampaign(id);
  if (!original) throw new Error('Campaign not found');
  return createCampaign({
    name: `${original.name} (Copy)`,
    subject: original.subject,
    body: original.body,
    recipientIds: [],
    sentAt: new Date().toISOString(),
    sentBy: original.sentBy,
    status: 'draft',
    variantBSubject: original.variantBSubject,
    variantBBody: original.variantBBody,
    abTestEnabled: original.abTestEnabled,
  });
}

export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await supabase.from('campaigns').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function createEnrollments(
  campaignId: string,
  recipients: { leadId: string; email: string; nextSendAt?: string | null; currentStep?: number }[]
): Promise<void> {
  const rows = recipients.map(r => ({
    campaign_id: campaignId,
    lead_id: r.leadId,
    email: r.email,
    status: 'pending',
    next_send_at: r.nextSendAt !== undefined ? r.nextSendAt : null,
    current_step: r.currentStep ?? 0,
  }));
  const { error } = await supabase.from('campaign_enrollments').insert(rows);
  if (error) throw error;
}

export async function createSequenceWithSteps(
  steps: { subject: string; body: string; delayDays: number }[],
  createdBy: string
): Promise<string> {
  // Create sequence
  const { data: seq, error: seqErr } = await supabase
    .from('campaign_sequences')
    .insert({ name: `Sequence ${Date.now()}`, created_by: createdBy })
    .select()
    .single();
  if (seqErr) throw seqErr;

  // Create steps
  const stepRows = steps.map((s, i) => ({
    sequence_id: seq.id,
    order: i,
    subject: s.subject,
    body: s.body,
    delay_days: s.delayDays,
  }));
  const { error: stepsErr } = await supabase.from('campaign_steps').insert(stepRows);
  if (stepsErr) throw stepsErr;

  return seq.id;
}

export async function getSequenceSteps(sequenceId: string) {
  const { data, error } = await supabase
    .from('campaign_steps')
    .select('*')
    .eq('sequence_id', sequenceId)
    .order('order', { ascending: true });
  if (error) throw error;
  return transformRows<{ id: string; sequenceId: string; order: number; subject: string; body: string; delayDays: number }>(data || []);
}

export async function updateEnrollmentStatus(
  campaignId: string,
  leadId: string,
  status: string
): Promise<void> {
  const { error } = await supabase.from('campaign_enrollments')
    .update({ status })
    .eq('campaign_id', campaignId)
    .eq('lead_id', leadId);
  if (error) throw error;
}

export async function getEnrollments(campaignId: string) {
  const { data, error } = await supabase.from('campaign_enrollments')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return transformRows<{ id: string; campaignId: string; leadId: string | null; email: string; status: string; sentAt: string | null }>(data || []);
}

export async function getEnrollmentLeadIdsByStatus(
  userId: string
): Promise<{ contacted: Set<string>; pending: Set<string> }> {
  // Step 1: get the current user's campaign IDs
  const { data: campaignRows, error: campErr } = await supabase
    .from('campaigns')
    .select('id')
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (campErr) throw campErr;

  const campaignIds = (campaignRows ?? []).map(c => c.id);
  if (campaignIds.length === 0) {
    return { contacted: new Set(), pending: new Set() };
  }

  // Step 2: fetch all enrollments for those campaigns
  const { data, error } = await supabase
    .from('campaign_enrollments')
    .select('lead_id, status')
    .in('campaign_id', campaignIds)
    .not('lead_id', 'is', null);
  if (error) throw error;

  const contacted = new Set<string>();
  const pending = new Set<string>();
  for (const row of data ?? []) {
    if (!row.lead_id) continue;
    if (row.status === 'pending') {
      pending.add(row.lead_id);
    } else {
      contacted.add(row.lead_id);
    }
  }
  return { contacted, pending };
}

export async function getCampaignABAnalytics(campaignId: string) {
  const { data: enrollments } = await supabase
    .from('campaign_enrollments')
    .select('id, ab_variant, lead_id, email')
    .eq('campaign_id', campaignId);

  const { data: emails } = await supabase
    .from('emails')
    .select('lead_id, opened_at, clicked_at, bounced_at')
    .eq('campaign_id', campaignId)
    .eq('direction', 'outbound');

  const emailMap = new Map<string, { opened: boolean; clicked: boolean; bounced: boolean }>();
  for (const e of emails || []) {
    if (e.lead_id) emailMap.set(e.lead_id, {
      opened: !!e.opened_at, clicked: !!e.clicked_at, bounced: !!e.bounced_at,
    });
  }

  const calcStats = (variant: string) => {
    const group = enrollments?.filter(e => e.ab_variant === variant) || [];
    return {
      sent: group.length,
      opened: group.filter(e => e.lead_id && emailMap.get(e.lead_id)?.opened).length,
      clicked: group.filter(e => e.lead_id && emailMap.get(e.lead_id)?.clicked).length,
      bounced: group.filter(e => e.lead_id && emailMap.get(e.lead_id)?.bounced).length,
    };
  };

  return { a: calcStats('A'), b: calcStats('B') };
}

export async function getCampaignAnalytics(campaignId: string) {
  const { data: emails, error } = await supabase
    .from('emails')
    .select('id, opened_at, clicked_at, bounced_at, direction')
    .eq('campaign_id', campaignId)
    .eq('direction', 'outbound');
  if (error) throw error;

  const sent = emails?.length || 0;
  const opened = emails?.filter(e => e.opened_at).length || 0;
  const clicked = emails?.filter(e => e.clicked_at).length || 0;
  const bounced = emails?.filter(e => e.bounced_at).length || 0;

  // Count unsubscribes linked to this campaign's recipients
  const { count: unsubscribed } = await supabase
    .from('unsubscribes')
    .select('id', { count: 'exact', head: true });

  return { sent, opened, clicked, bounced, unsubscribed: unsubscribed || 0 };
}
