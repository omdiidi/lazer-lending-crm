/**
 * smartlead-campaign Edge Function
 *
 * Actions:
 *   create  — one-shot campaign setup in Smartlead (create + add steps + connect mailboxes + activate)
 *   enroll  — per-cron enrollment of pending leads into an already-created SL campaign
 *   activate — explicit re-activation of a paused SL campaign
 *   mark_replied — tell Smartlead to stop autonomous progression for a specific lead
 *
 * Called by:
 *   create   → campaign launch UI / API
 *   enroll   → process-campaigns cron (Smartlead branch)
 *   activate → operator UI on un-pause
 *   mark_replied → classify-reply (stop-on-reply)
 */

import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { writeAlert } from '../_shared/alerts.ts'
import {
  SmartleadClient,
  SmartleadRateLimited,
  type SmartleadLeadPayload,
} from '../_shared/smartlead.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

/** Normalise email for suppression lookup: lowercase + trim. Full normalise runs in src/lib. */
function normalizeEmail(email: string): string {
  return email.toLowerCase().trim()
}

// ---------------------------------------------------------------------------
// action: create (setupSmartleadCampaign)
// ---------------------------------------------------------------------------

async function handleCreate(campaignId: string): Promise<Response> {
  const sl = new SmartleadClient()

  // Load campaign + steps + pool mailboxes
  const { data: campaign, error: campErr } = await supabaseAdmin
    .from('campaigns')
    .select('id, name, sending_pool_id, smartlead_campaign_id, provider, sequence_id, subject, body')
    .eq('id', campaignId)
    .single()

  if (campErr || !campaign) {
    return json({ success: false, error: `Campaign not found: ${campErr?.message}` }, 404)
  }

  if (campaign.provider !== 'smartlead') {
    return json({ success: false, error: 'Campaign provider is not smartlead' }, 400)
  }

  if (!campaign.sending_pool_id) {
    return json({ success: false, error: 'Campaign has no sending_pool_id' }, 400)
  }

  // Idempotency: if already created, skip
  if (campaign.smartlead_campaign_id) {
    return json({ success: true, smartlead_campaign_id: campaign.smartlead_campaign_id, skipped: true })
  }

  // Compliance-footer gate (blocker B2) — authoritative server-side check.
  // Cold sends legally require the NMLS/CAN-SPAM footer, so refuse to create
  // the Smartlead campaign when the footer is disabled, empty, or still the
  // placeholder. The UI has the same guard, but scheduled campaigns and direct
  // API calls reach here without passing through it.
  const { data: lazerSettings } = await supabaseAdmin
    .from('lazer_settings')
    .select('compliance_footer_template, footer_enabled')
    .eq('id', true)
    .maybeSingle()

  const FOOTER_PLACEHOLDER = '[FOOTER PLACEHOLDER — NOT FOR PRODUCTION]'
  const footerTemplate = (lazerSettings?.compliance_footer_template ?? '').trim()
  const footerUsable =
    lazerSettings?.footer_enabled === true &&
    footerTemplate !== '' &&
    !footerTemplate.includes(FOOTER_PLACEHOLDER)

  if (!footerUsable) {
    const reason = !lazerSettings?.footer_enabled
      ? 'compliance footer is disabled'
      : footerTemplate === ''
        ? 'compliance footer is empty'
        : 'compliance footer still contains the placeholder token'
    const message = `Refusing to launch campaign to Smartlead: ${reason} (B2). Set it in Settings → Compliance.`
    await writeAlert(supabaseAdmin, {
      type: 'error',
      source: 'smartlead-campaign',
      message,
      details: { campaign_id: campaignId, footer_enabled: lazerSettings?.footer_enabled ?? null },
    })
    return json({ success: false, error: message }, 400)
  }

  const footerText = `\n\n---\n${footerTemplate}`

  try {
    // 1. Create the Smartlead campaign
    const slCampaign = await sl.createCampaign(campaign.name)

    // 2. Persist the SL campaign ID immediately so partial failures are recoverable
    await supabaseAdmin
      .from('campaigns')
      .update({ smartlead_campaign_id: String(slCampaign.id) })
      .eq('id', campaignId)

    // 3. Add sequence steps (ordered by step order)
    // campaign_steps.sequence_id → campaign_sequences.id; campaign.sequence_id is the FK.
    // Single-email campaigns have no sequence rows (the builder only creates a
    // sequence when follow-ups are added) — synthesize step 1 from the campaign's
    // own subject/body so Smartlead has content to send.
    let steps: Array<{ order: number; subject: string | null; body: string | null; delay_days: number | null }> = []
    if (campaign.sequence_id) {
      const { data: stepRows } = await supabaseAdmin
        .from('campaign_steps')
        .select('id, order, subject, body, delay_days')
        .eq('sequence_id', campaign.sequence_id)
        .order('order', { ascending: true })
      steps = stepRows ?? []
    }
    if (steps.length === 0 && campaign.subject && campaign.body) {
      steps = [{ order: 1, subject: campaign.subject, body: campaign.body, delay_days: 0 }]
    }
    if (steps.length === 0) {
      throw new Error('Campaign has no sequence steps and no subject/body — nothing to send')
    }

    for (const step of steps) {
      await sl.addSequenceStep(slCampaign.id, {
        seq_number: step.order,
        subject: step.subject ?? '',
        email_body: (step.body ?? '') + footerText,
        delay_in_days: step.delay_days ?? 0,
      })
    }

    // 4. Connect mailboxes from the sending pool
    const { data: memberships } = await supabaseAdmin
      .from('pool_memberships')
      .select('mailbox_id, mailboxes(id, smartlead_account_id, daily_cap)')
      .eq('pool_id', campaign.sending_pool_id)

    let connectedMailboxes = 0
    for (const m of memberships ?? []) {
      const mailbox = (m as { mailboxes: { id: string; smartlead_account_id: string | null; daily_cap: number } | null }).mailboxes
      if (!mailbox?.smartlead_account_id) {
        console.warn(`Mailbox ${mailbox?.id} has no smartlead_account_id — skipping`)
        continue
      }
      await sl.connectMailbox(slCampaign.id, {
        email_account_id: parseInt(mailbox.smartlead_account_id, 10),
        max_email_per_day: mailbox.daily_cap,
      })
      connectedMailboxes++
    }

    if (connectedMailboxes === 0) {
      throw new Error(
        `No mailboxes connected: pool ${campaign.sending_pool_id} has ${memberships?.length ?? 0} member(s), ` +
        'none with a smartlead_account_id. Check mailboxes.smartlead_account_id against the Smartlead account IDs.',
      )
    }

    // 5. Schedule — Smartlead refuses START without one ("Cron Exp value is empty!")
    await sl.setCampaignSchedule(slCampaign.id)

    // 6. Activate
    await sl.activateCampaign(slCampaign.id)

    return json({ success: true, smartlead_campaign_id: slCampaign.id, steps: steps.length, mailboxes: connectedMailboxes })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('smartlead-campaign create failed:', message)
    await writeAlert(supabaseAdmin, {
      type: 'error',
      source: 'smartlead-campaign',
      message: `Campaign ${campaignId} Smartlead setup failed: ${message}`,
      details: { campaign_id: campaignId, error: message },
    })
    // Mark launch as failed so the UI can surface it. We use a notes/metadata
    // approach since the campaigns table may not have a launch_failed boolean column.
    // If that column exists from a future migration, swap this for a proper update.
    return json({ success: false, error: message }, 500)
  }
}

// ---------------------------------------------------------------------------
// action: enroll (enrollPendingLeads)
// ---------------------------------------------------------------------------

const MAX_BATCH = 50

async function handleEnroll(campaignId: string): Promise<Response> {
  const sl = new SmartleadClient()
  const isMock = await sl.checkMockStatus()

  const { data: campaign, error: campErr } = await supabaseAdmin
    .from('campaigns')
    .select('id, name, sending_pool_id, smartlead_campaign_id, provider, sequence_id, subject, body')
    .eq('id', campaignId)
    .single()

  if (campErr || !campaign) {
    return json({ success: false, error: `Campaign not found: ${campErr?.message}` }, 404)
  }

  if (!campaign.smartlead_campaign_id) {
    return json({ success: false, error: 'Campaign not yet set up in Smartlead — run create first' }, 400)
  }

  if (!campaign.sending_pool_id) {
    return json({ success: false, error: 'Campaign has no sending_pool_id' }, 400)
  }

  // Fetch pending enrollments (claim_pending_enrollments RPC provides FOR UPDATE SKIP LOCKED)
  const { data: enrollments, error: enrollErr } = await supabaseAdmin
    .rpc('claim_pending_enrollments', {
      p_campaign_id: campaignId,
      p_limit: MAX_BATCH,
    })

  if (enrollErr) {
    console.error('claim_pending_enrollments error:', enrollErr)
    return json({ success: false, error: enrollErr.message }, 500)
  }

  if (!enrollments?.length) {
    return json({ success: true, enrolled: 0, message: 'No pending enrollments' })
  }

  // Bulk-fetch lead data
  const leadIds = (enrollments as Array<{ lead_id: string }>).map(e => e.lead_id).filter(Boolean)
  const { data: leadsData } = await supabaseAdmin
    .from('leads')
    .select('id, first_name, last_name, email, email_normalized, phone, company, last_validated_at, unsubscribed_at')
    .in('id', leadIds)

  const leadMap = new Map<string, {
    id: string
    first_name: string
    last_name: string
    email: string
    email_normalized: string | null
    phone: string | null
    company: string | null
    last_validated_at: string | null
    unsubscribed_at: string | null
  }>()
  for (const l of leadsData ?? []) {
    leadMap.set(l.id, l)
  }

  const slCampaignId = parseInt(campaign.smartlead_campaign_id, 10)
  let enrolled = 0
  let rejected = 0
  let suppressed = 0
  let noMailbox = false

  for (const enrollment of enrollments as Array<{ id: string; lead_id: string; email: string }>) {
    const lead = leadMap.get(enrollment.lead_id)
    const recipientEmail = lead?.email ?? enrollment.email

    // --- Suppression check (fast path before slot claim) ---
    const norm = normalizeEmail(recipientEmail)
    const { data: suppRow } = await supabaseAdmin
      .from('unsubscribes')
      .select('id, reason')
      .eq('email_normalized', norm)
      .maybeSingle()

    if (suppRow) {
      await supabaseAdmin
        .from('campaign_enrollments')
        .update({ status: 'unsubscribed' })
        .eq('id', enrollment.id)
      suppressed++
      continue
    }

    // --- Claim a mailbox slot (atomic via Postgres fn) ---
    const { data: mailboxRow, error: claimErr } = await supabaseAdmin
      .rpc('claim_mailbox_enrollment_slot', {
        p_pool_id: campaign.sending_pool_id,
      })

    if (claimErr || !mailboxRow) {
      // No mailbox available in pool — stop the batch and resume next cron tick
      noMailbox = true
      // Un-claim enrollment so it stays pending for next tick
      await supabaseAdmin
        .from('campaign_enrollments')
        .update({ status: 'pending' })
        .eq('id', enrollment.id)
      break
    }

    const mailboxId: string = mailboxRow.id

    // --- Smartlead API call (inner try: must release slot on failure) ---
    let slResult
    try {
      const leadPayload: SmartleadLeadPayload = {
        email: recipientEmail,
        first_name: lead?.first_name ?? '',
        last_name: lead?.last_name ?? '',
        company_name: lead?.company ?? '',
        phone_number: lead?.phone ?? '',
      }
      slResult = await sl.addLeadToCampaign(slCampaignId, leadPayload)
    } catch (slErr) {
      // Release the enrollment slot — the Smartlead request failed before SL accepted the lead
      await supabaseAdmin.rpc('release_mailbox_enrollment_slot', { p_mailbox_id: mailboxId })
      await writeAlert(supabaseAdmin, {
        type: 'error',
        source: 'smartlead-campaign',
        message: `Smartlead addLeadToCampaign failed for enrollment ${enrollment.id}`,
        details: { enrollment_id: enrollment.id, error: String(slErr) },
      })
      // Un-claim so it can retry next tick
      await supabaseAdmin
        .from('campaign_enrollments')
        .update({ status: 'pending' })
        .eq('id', enrollment.id)
      if (slErr instanceof SmartleadRateLimited) break // Stop batch on rate limit
      continue
    }

    // --- Resolve the per-lead SL ID (S1 resolved 2026-07-14) ---
    // The upload response carries counts only; a lead is accepted when it was
    // uploaded now or already present. The id comes from a follow-up lookup.
    const accepted =
      (slResult?.upload_count ?? 0) > 0 ||
      (slResult?.already_added_to_campaign ?? 0) > 0
    let slLeadId: string | null = null
    if (accepted) {
      try {
        const slLead = await sl.getLeadByEmail(recipientEmail)
        slLeadId = slLead ? String(slLead.id) : null
      } catch (lookupErr) {
        console.error(`getLeadByEmail failed for ${recipientEmail}:`, lookupErr)
      }
    }

    if (!slLeadId) {
      // Silent drop — Smartlead accepted the request but dropped the lead (malformed, duplicate)
      // Slot was consumed (Smartlead got the request); do NOT release.
      await supabaseAdmin.from('sends').insert({
        lead_id: enrollment.lead_id,
        campaign_id: campaignId,
        campaign_step_id: null, // step assigned when Smartlead confirms dispatch
        claimed_mailbox_id: mailboxId,
        status: 'smartlead_rejected',
        error_reason: 'silent_drop_in_bulk_upload',
      })
      await supabaseAdmin
        .from('campaign_enrollments')
        .update({ status: 'sent' })
        .eq('id', enrollment.id)
      await writeAlert(supabaseAdmin, {
        type: 'warning',
        source: 'smartlead-campaign',
        message: `Smartlead silently dropped lead ${recipientEmail} in campaign ${campaignId}`,
        details: { enrollment_id: enrollment.id, campaign_id: campaignId },
      })
      rejected++
      continue
    }

    // --- Success: create sends row + update enrollment ---
    const now = new Date().toISOString()
    const mockMessageId = isMock ? `msg_${crypto.randomUUID()}` : null

    await supabaseAdmin.from('sends').insert({
      lead_id: enrollment.lead_id,
      campaign_id: campaignId,
      campaign_step_id: null,
      claimed_mailbox_id: mailboxId,
      mailbox_id: isMock ? mailboxId : null,
      smartlead_lead_id: slLeadId,
      smartlead_message_id: mockMessageId,
      status: isMock ? 'sent' : 'queued',
      sent_at: isMock ? now : null,
    })

    // If running in mock/sandbox mode, populate the legacy emails table immediately
    // so the outreach history list, activity feeds, and statistics show correct sent status.
    if (isMock) {
      await supabaseAdmin.from('emails').insert({
        lead_id: enrollment.lead_id,
        from: mailboxRow.address,
        to: recipientEmail,
        subject: campaign.subject || 'Lazer Lending Outreach',
        body: campaign.body || '',
        sent_at: now,
        read: true,
        direction: 'outbound',
        provider_message_id: mockMessageId,
        campaign_id: campaignId,
      })
    }

    await supabaseAdmin
      .from('campaign_enrollments')
      .update({
        status: 'sent',
        sent_at: now,
      })
      .eq('id', enrollment.id)

    enrolled++
  }

  return json({
    success: true,
    enrolled,
    rejected,
    suppressed,
    stopped_early: noMailbox,
  })
}

// ---------------------------------------------------------------------------
// action: activate
// ---------------------------------------------------------------------------

async function handleActivate(campaignId: string): Promise<Response> {
  const sl = new SmartleadClient()

  const { data: campaign } = await supabaseAdmin
    .from('campaigns')
    .select('smartlead_campaign_id')
    .eq('id', campaignId)
    .single()

  if (!campaign?.smartlead_campaign_id) {
    return json({ success: false, error: 'No smartlead_campaign_id on campaign' }, 400)
  }

  try {
    await sl.activateCampaign(parseInt(campaign.smartlead_campaign_id, 10))
    return json({ success: true })
  } catch (err) {
    return json({ success: false, error: String(err) }, 500)
  }
}

// ---------------------------------------------------------------------------
// action: mark_replied
// ---------------------------------------------------------------------------

async function handleMarkReplied(leadId: string, campaignId: string): Promise<Response> {
  const sl = new SmartleadClient()

  // Look up the smartlead_lead_id and campaign's SL id
  const { data: sendRow } = await supabaseAdmin
    .from('sends')
    .select('smartlead_lead_id, campaigns(smartlead_campaign_id)')
    .eq('lead_id', leadId)
    .eq('campaign_id', campaignId)
    .not('smartlead_lead_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!sendRow?.smartlead_lead_id) {
    return json({ success: false, error: 'No smartlead_lead_id found for this lead+campaign' }, 404)
  }

  const slCampaignId = (sendRow.campaigns as { smartlead_campaign_id: string | null })?.smartlead_campaign_id
  if (!slCampaignId) {
    return json({ success: false, error: 'No smartlead_campaign_id on campaign' }, 404)
  }

  try {
    await sl.markLeadReplied(
      parseInt(slCampaignId, 10),
      parseInt(sendRow.smartlead_lead_id, 10),
    )
    return json({ success: true })
  } catch (err) {
    return json({ success: false, error: String(err) }, 500)
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json() as {
      action: 'create' | 'enroll' | 'activate' | 'mark_replied'
      campaign_id?: string
      lead_id?: string
    }

    switch (body.action) {
      case 'create':
        if (!body.campaign_id) return json({ success: false, error: 'campaign_id required' }, 400)
        return handleCreate(body.campaign_id)

      case 'enroll':
        if (!body.campaign_id) return json({ success: false, error: 'campaign_id required' }, 400)
        return handleEnroll(body.campaign_id)

      case 'activate':
        if (!body.campaign_id) return json({ success: false, error: 'campaign_id required' }, 400)
        return handleActivate(body.campaign_id)

      case 'mark_replied':
        if (!body.lead_id || !body.campaign_id) {
          return json({ success: false, error: 'lead_id and campaign_id required' }, 400)
        }
        return handleMarkReplied(body.lead_id, body.campaign_id)

      default:
        return json({ success: false, error: `Unknown action: ${body.action}` }, 400)
    }
  } catch (err) {
    console.error('smartlead-campaign error:', err)
    return json({ success: false, error: (err as Error).message ?? 'Internal server error' }, 500)
  }
})
