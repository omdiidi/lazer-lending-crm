/**
 * bounce-cascade.ts
 * Task 1.15 — Hard/soft bounce processing.
 *
 * bounceCascade(send_id, bounce_type):
 *   - Updates sends.status to 'bounced' + stores bounce_type.
 *   - Hard bounce only:
 *       • Inserts into unsubscribes (reason='hard_bounce', email_normalized)
 *       • Cancels ALL queued future-step sends for this lead across all campaigns
 *       • Calls Smartlead markLeadReplied-equivalent to stop autonomous progression
 *         (uses the smartlead client markLeadReplied method which stops further sends)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { writeAlert } from './alerts.ts'

type SupabaseAdmin = ReturnType<typeof createClient>

/**
 * Execute hard/soft bounce cascade for a confirmed bounce event.
 * Called from smartlead-events EMAIL_BOUNCED handler.
 */
export async function bounceCascade(
  supabaseAdmin: SupabaseAdmin,
  sendId: string,
  bounceType: 'hard' | 'soft',
  // Accepts string IDs (our DB) or numeric IDs (Smartlead's integer IDs).
  // The caller coerces to the type expected by the Smartlead client.
  // deno-lint-ignore no-explicit-any
  smartleadMarkLeadReplied: (campaignId: any, smartleadLeadId: any) => Promise<void>,
): Promise<void> {
  // Step 1: Fetch the send row to get lead_id, mailbox_id, and recipient info.
  const { data: send, error: sendErr } = await supabaseAdmin
    .from('sends')
    .select('id, lead_id, campaign_id, claimed_mailbox_id, mailbox_id, smartlead_lead_id, status')
    .eq('id', sendId)
    .maybeSingle()

  if (sendErr || !send) {
    console.error(`bounceCascade: send ${sendId} not found`, sendErr)
    return
  }

  // Step 2: Update sends.status + bounce_type.
  const { error: updateSendErr } = await supabaseAdmin
    .from('sends')
    .update({ status: 'bounced', bounce_type: bounceType, updated_at: new Date().toISOString() })
    .eq('id', sendId)

  if (updateSendErr) {
    console.error(`bounceCascade: failed to update sends row ${sendId}`, updateSendErr)
  }

  if (bounceType !== 'hard') {
    // Soft bounce: just record the status, no cascade needed.
    console.log(`bounceCascade: soft bounce for send ${sendId} — no cascade`)
    return
  }

  // --- Hard bounce cascade ---

  // Step 3: Fetch lead email for suppression insert.
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, email, email_normalized')
    .eq('id', send.lead_id)
    .maybeSingle()

  if (!lead?.email) {
    console.error(`bounceCascade: lead ${send.lead_id} has no email — cannot insert suppression`)
    return
  }

  const emailNormalized = lead.email_normalized ?? lead.email.toLowerCase().trim()

  // Step 4: Insert into unsubscribes (reason='hard_bounce').
  // ON CONFLICT DO NOTHING — suppression may already exist from a prior bounce.
  const { error: suppressErr } = await supabaseAdmin
    .from('unsubscribes')
    .insert({
      email: lead.email,
      email_normalized: emailNormalized,
      reason: 'hard_bounce',
      source_event_id: `bounce:${sendId}`,
      lead_id: lead.id,
    })
    .select('id')

  if (suppressErr && !suppressErr.message.includes('duplicate')) {
    // Log but continue — suppression failure should not abort the cascade.
    console.error(`bounceCascade: suppression insert failed for ${emailNormalized}`, suppressErr)
    await writeAlert(supabaseAdmin, {
      type: 'error',
      source: 'bounce-cascade',
      message: `Failed to insert suppression for hard bounce: ${emailNormalized}`,
      details: { send_id: sendId, lead_id: lead.id, error: suppressErr.message },
    })
  }

  // Step 5: Mark lead.unsubscribed_at (so enrollment checks short-circuit immediately).
  await supabaseAdmin
    .from('leads')
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq('id', lead.id)
    .is('unsubscribed_at', null)

  // Step 6: Cancel ALL queued future-step sends to this lead across all campaigns.
  const { data: cancelled, error: cancelErr } = await supabaseAdmin
    .from('sends')
    .update({
      status: 'failed',
      error_reason: 'lead_hard_bounced',
      updated_at: new Date().toISOString(),
    })
    .eq('lead_id', lead.id)
    .eq('status', 'queued')
    .select('id, campaign_id, smartlead_lead_id')

  if (cancelErr) {
    console.error(`bounceCascade: failed to cancel queued sends for lead ${lead.id}`, cancelErr)
  } else {
    console.log(
      `bounceCascade: cancelled ${cancelled?.length ?? 0} queued sends for lead ${lead.id}`,
    )
  }

  // Step 7: Tell Smartlead to stop autonomous progression for each affected campaign.
  // We collect unique (campaign_id, smartlead_lead_id) pairs from cancelled sends
  // PLUS the original send row itself.
  const affectedCampaigns = new Map<string, string>()

  // Include the bounced send's own campaign if it has a smartlead_lead_id
  if (send.campaign_id && send.smartlead_lead_id) {
    affectedCampaigns.set(send.campaign_id, send.smartlead_lead_id)
  }

  // Include campaigns from cancelled queued sends
  for (const c of (cancelled ?? [])) {
    if (c.campaign_id && c.smartlead_lead_id && !affectedCampaigns.has(c.campaign_id)) {
      affectedCampaigns.set(c.campaign_id, c.smartlead_lead_id)
    }
  }

  for (const [campaignId, slLeadId] of affectedCampaigns.entries()) {
    try {
      // Fetch the smartlead_campaign_id for this campaign
      const { data: campaign } = await supabaseAdmin
        .from('campaigns')
        .select('smartlead_campaign_id')
        .eq('id', campaignId)
        .maybeSingle()

      if (campaign?.smartlead_campaign_id) {
        await smartleadMarkLeadReplied(campaign.smartlead_campaign_id, slLeadId)
        console.log(
          `bounceCascade: told Smartlead to stop lead ${slLeadId} in campaign ${campaign.smartlead_campaign_id}`,
        )
      }
    } catch (slErr) {
      // Non-fatal: if Smartlead call fails, local cancellation already prevents new sends.
      console.error(
        `bounceCascade: Smartlead markLeadReplied failed for campaign ${campaignId}`,
        slErr,
      )
      await writeAlert(supabaseAdmin, {
        type: 'warning',
        source: 'bounce-cascade',
        message: `Smartlead stop-on-hard-bounce failed for lead ${emailNormalized} in campaign ${campaignId}`,
        details: { send_id: sendId, campaign_id: campaignId, error: String(slErr) },
      })
    }
  }

  console.log(`bounceCascade: hard bounce cascade complete for send ${sendId} (lead ${lead.id})`)
}
