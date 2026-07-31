/**
 * smartlead-events/index.ts
 * Task 1.11 — Smartlead webhook receiver + sweeper (Task 1.11 / Task 1.17 piggybacked).
 *
 * Two entry points on the same function:
 *   POST /functions/v1/smartlead-events          — main webhook receiver
 *   POST /functions/v1/smartlead-events?action=sweep — background sweeper (cron)
 *
 * Security: HMAC-SHA256 via X-Smartlead-Signature: sha256=<hex>.
 * Idempotency: ON CONFLICT (provider, external_event_id) DO NOTHING on webhook_events table.
 * Event normalization: `event` (most events) OR `eventType` (EMAIL_ACCOUNT_DISCONNECTED camelCase).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { writeAlert } from '../_shared/alerts.ts'
import { bounceCascade } from '../_shared/bounce-cascade.ts'

// ---------------------------------------------------------------------------
// Smartlead client stub — the parallel-agent Smartlead client is assumed to
// exist at _shared/smartlead.ts. We call its methods here; if the module is
// not yet deployed, these calls will throw at runtime (not at type-check time).
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
type SmartleadClient = any
async function getSmartleadClient(): Promise<SmartleadClient> {
  const { SmartleadClient } = await import('../_shared/smartlead.ts')
  // SmartleadClient reads SMARTLEAD_API_KEY from Deno.env internally (per smartlead-campaign pattern)
  if (!Deno.env.get('SMARTLEAD_API_KEY')) throw new Error('SMARTLEAD_API_KEY is not set')
  return new SmartleadClient()
}

// ---------------------------------------------------------------------------
// HMAC verification
// ---------------------------------------------------------------------------
async function verifyHmacSha256(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false
  // Header format: "sha256=<hex>"
  const prefix = 'sha256='
  if (!signatureHeader.startsWith(prefix)) return false
  const providedHex = signatureHeader.slice(prefix.length)

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const computedHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Constant-time comparison to prevent timing attacks
  if (computedHex.length !== providedHex.length) return false
  let mismatch = 0
  for (let i = 0; i < computedHex.length; i++) {
    mismatch |= computedHex.charCodeAt(i) ^ providedHex.charCodeAt(i)
  }
  return mismatch === 0
}

// ---------------------------------------------------------------------------
// SHA-256 hash of payload (for payload_hash column)
// ---------------------------------------------------------------------------
async function sha256Hex(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ---------------------------------------------------------------------------
// Event dispatcher
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function dispatchByEvent(
  supabaseAdmin: ReturnType<typeof createClient>,
  eventName: string,
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>,
): Promise<void> {
  switch (eventName) {
    case 'EMAIL_SENT':
      await onEmailSentWebhook(supabaseAdmin, body)
      break

    // Smartlead's documented tokens are EMAIL_OPEN/EMAIL_LINK_CLICK/EMAIL_REPLY/
    // EMAIL_BOUNCE; the *_ED variants predate that and are kept as aliases so
    // either spelling routes correctly.
    case 'EMAIL_OPENED':
    case 'EMAIL_OPEN':
      await onEmailOpenedWebhook(supabaseAdmin, body)
      break

    case 'EMAIL_CLICKED':
    case 'EMAIL_LINK_CLICK':
      await onEmailClickedWebhook(supabaseAdmin, body)
      break

    case 'EMAIL_REPLIED':
    case 'EMAIL_REPLY':
      await onEmailRepliedWebhook(supabaseAdmin, body)
      break

    case 'EMAIL_BOUNCED':
    case 'EMAIL_BOUNCE':
      await onEmailBouncedWebhook(supabaseAdmin, body)
      break

    case 'EMAIL_UNSUBSCRIBED':
    case 'LEAD_UNSUBSCRIBED':
      await onUnsubscribeWebhook(supabaseAdmin, body)
      break

    case 'EMAIL_ACCOUNT_DISCONNECTED':
      await onEmailAccountDisconnected(supabaseAdmin, body)
      break

    case 'CAMPAIGN_BOUNCE_THRESHOLD_BREACHED':
      await onCampaignBounceThreshold(supabaseAdmin, body)
      break

    default:
      console.log(`smartlead-events: unhandled event type "${eventName}" — ignoring`)
  }
}

// ---------------------------------------------------------------------------
// Smartlead payload → CRM reference resolution
// Smartlead webhook payloads carry Smartlead's own identifiers — numeric
// campaign_id, sl_email_lead_id, and the sender mailbox *address* — never CRM
// uuids. (Field names verified against a live EMAIL_REPLY payload 2026-07-31.)
// ---------------------------------------------------------------------------
interface SmartleadRefs {
  campaignId: string | null
  leadId: string | null
  mailboxId: string | null
  mailboxAccountId: string | null
  slLeadId: string | null
}

// deno-lint-ignore no-explicit-any
async function resolveSmartleadRefs(supabaseAdmin: ReturnType<typeof createClient>, event: Record<string, any>): Promise<SmartleadRefs> {
  const slCampaignId = event.campaign_id != null ? String(event.campaign_id) : null
  const slLeadId = event.sl_email_lead_id != null ? String(event.sl_email_lead_id) : null
  const leadEmail: string | null = event.sl_lead_email ?? event.lead_email ?? event.to_email ?? null
  const mailboxAddress: string | null = event.sl_senders_mailbox ?? event.from_email ?? null

  let campaignId: string | null = null
  if (slCampaignId) {
    const { data } = await supabaseAdmin
      .from('campaigns')
      .select('id')
      .eq('smartlead_campaign_id', slCampaignId)
      .is('deleted_at', null)
      .maybeSingle()
    campaignId = data?.id ?? null
  }

  // Lead: prefer the sends row keyed by Smartlead's lead id (set at enroll),
  // fall back to email match.
  let leadId: string | null = null
  if (slLeadId) {
    const { data } = await supabaseAdmin
      .from('sends')
      .select('lead_id')
      .eq('smartlead_lead_id', slLeadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    leadId = data?.lead_id ?? null
  }
  if (!leadId && leadEmail) {
    const { data } = await supabaseAdmin
      .from('leads')
      .select('id')
      .eq('email_normalized', leadEmail.toLowerCase().trim())
      .maybeSingle()
    leadId = data?.id ?? null
  }

  let mailboxId: string | null = null
  let mailboxAccountId: string | null = null
  if (mailboxAddress) {
    const { data } = await supabaseAdmin
      .from('mailboxes')
      .select('id, smartlead_account_id')
      .eq('address', mailboxAddress.toLowerCase().trim())
      .maybeSingle()
    mailboxId = data?.id ?? null
    mailboxAccountId = data?.smartlead_account_id ?? null
  }

  return { campaignId, leadId, mailboxId, mailboxAccountId, slLeadId }
}

// ---------------------------------------------------------------------------
// EMAIL_SENT handler
// Stamps the queued sends row (enroll leaves it 'queued' with no message id —
// the message id only exists at send time) and increments today_sent_count.
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function onEmailSentWebhook(supabaseAdmin: ReturnType<typeof createClient>, event: Record<string, any>) {
  const refs = await resolveSmartleadRefs(supabaseAdmin, event)
  const sentMessageId: string | null =
    event.sent_message?.message_id ?? event.message_id ?? event.messageId ?? null
  const sentAt: string = event.event_timestamp ?? event.time_sent ?? new Date().toISOString()

  if (!refs.campaignId || !refs.slLeadId) {
    console.warn('EMAIL_SENT: could not resolve campaign/lead', {
      campaign_id: event.campaign_id,
      sl_email_lead_id: event.sl_email_lead_id,
    })
    return
  }

  const { data: sendRow } = await supabaseAdmin
    .from('sends')
    .select('id, mailbox_id, claimed_mailbox_id')
    .eq('campaign_id', refs.campaignId)
    .eq('smartlead_lead_id', refs.slLeadId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!sendRow) {
    console.warn(`EMAIL_SENT: no sends row for campaign ${refs.campaignId} sl_lead ${refs.slLeadId}`)
    return
  }

  const { error: sendErr } = await supabaseAdmin
    .from('sends')
    .update({
      status: 'sent',
      sent_at: sentAt,
      smartlead_message_id: sentMessageId,
      mailbox_id: refs.mailboxId ?? sendRow.mailbox_id ?? sendRow.claimed_mailbox_id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sendRow.id)

  if (sendErr) {
    console.error('EMAIL_SENT: failed to update sends row', sendErr)
    // Non-fatal: continue to attempt counter increment
  }

  // Increment today_sent_count ONLY if sent_at falls in the same local-day
  // reset window (avoids cross-midnight inflation).
  if (refs.mailboxAccountId && sentMessageId) {
    const { error: mbErr } = await supabaseAdmin.rpc('increment_mailbox_sent_count_if_same_day', {
      p_smartlead_account_id: refs.mailboxAccountId,
      p_message_id: sentMessageId,
    })
    if (mbErr) {
      console.warn('EMAIL_SENT: increment_mailbox_sent_count_if_same_day RPC failed', mbErr)
    }
  }
}

// ---------------------------------------------------------------------------
// EMAIL_OPENED handler
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function onEmailOpenedWebhook(supabaseAdmin: ReturnType<typeof createClient>, event: Record<string, any>) {
  const messageId: string | null = event.message_id ?? event.messageId ?? null
  if (!messageId) return

  await supabaseAdmin
    .from('sends')
    .update({ updated_at: new Date().toISOString() })
    .eq('smartlead_message_id', messageId)

  // Also update the legacy emails table for UI compatibility (opened_at)
  await supabaseAdmin
    .from('emails')
    .update({ opened_at: new Date().toISOString() })
    .eq('provider_message_id', messageId)
}

// ---------------------------------------------------------------------------
// EMAIL_CLICKED handler
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function onEmailClickedWebhook(supabaseAdmin: ReturnType<typeof createClient>, event: Record<string, any>) {
  const messageId: string | null = event.message_id ?? event.messageId ?? null
  if (!messageId) return

  await supabaseAdmin
    .from('emails')
    .update({ clicked_at: new Date().toISOString() })
    .eq('provider_message_id', messageId)
}

// ---------------------------------------------------------------------------
// EMAIL_REPLIED handler
// Inserts a replies row and enqueues async classification.
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function onEmailRepliedWebhook(supabaseAdmin: ReturnType<typeof createClient>, event: Record<string, any>) {
  // Field names verified against a live EMAIL_REPLY payload 2026-07-31:
  // campaign_id (Smartlead numeric), sl_email_lead_id, sl_lead_email,
  // sl_senders_mailbox, stats_thread_id, reply_message{text,message_id,time}.
  const refs = await resolveSmartleadRefs(supabaseAdmin, event)
  const { campaignId, leadId, mailboxId } = refs
  const threadId: string | null =
    event.stats_thread_id != null ? String(event.stats_thread_id) : (event.thread_id ?? null)
  const replyBody: string =
    event.reply_message?.text ?? event.preview_text ?? event.reply_body ?? ''
  const rawMessageId: string =
    event.reply_message?.message_id ?? event.message_id ?? crypto.randomUUID()
  const receivedAt: string =
    event.time_replied ?? event.event_timestamp ?? new Date().toISOString()

  if (!leadId || !campaignId) {
    console.warn('EMAIL_REPLIED: could not resolve CRM lead/campaign', {
      campaign_id: event.campaign_id,
      sl_email_lead_id: event.sl_email_lead_id,
      sl_lead_email: event.sl_lead_email,
    })
    return
  }

  if (!mailboxId) {
    console.warn(`EMAIL_REPLIED: could not resolve mailbox for ${event.sl_senders_mailbox ?? event.from_email}`)
    return
  }

  // Derive in_reply_to_send_id: match by lead_id × campaign_id, most-recent sent row
  const { data: matchedSend } = await supabaseAdmin
    .from('sends')
    .select('id')
    .eq('lead_id', leadId)
    .eq('campaign_id', campaignId)
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const inReplyToSendId: string | null = matchedSend?.id ?? null

  // Insert replies row
  const { data: replyRow, error: replyErr } = await supabaseAdmin
    .from('replies')
    .insert({
      lead_id: leadId,
      campaign_id: campaignId,
      mailbox_id: mailboxId,
      in_reply_to_send_id: inReplyToSendId,
      smartlead_thread_id: threadId,
      raw_message_id: rawMessageId,
      body_text: replyBody,
      redacted_body_text: '', // PII redaction runs in classify-reply function
      received_at: receivedAt,
      requires_human_review: false,
    })
    .select('id')
    .single()

  if (replyErr || !replyRow) {
    console.error('EMAIL_REPLIED: failed to insert reply row', replyErr)
    return
  }

  console.log(`EMAIL_REPLIED: inserted reply ${replyRow.id} for lead ${leadId}`)

  // Enqueue classification. A bare un-awaited fetch is killed when the webhook
  // returns its response (edge runtime cancels pending work), so the trigger
  // never fired — use EdgeRuntime.waitUntil to keep it alive past the response,
  // falling back to await where waitUntil is unavailable.
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (supabaseUrl && serviceRoleKey) {
    const classifyPromise = fetch(`${supabaseUrl}/functions/v1/classify-reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ reply_id: replyRow.id }),
    }).catch((e) => console.error('EMAIL_REPLIED: failed to enqueue classify-reply', e))

    // deno-lint-ignore no-explicit-any
    const runtime = (globalThis as any).EdgeRuntime
    if (runtime?.waitUntil) {
      runtime.waitUntil(classifyPromise)
    } else {
      await classifyPromise
    }
  }
}

// ---------------------------------------------------------------------------
// EMAIL_BOUNCED handler
// Delegates to shared bounceCascade logic (Task 1.15).
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function onEmailBouncedWebhook(supabaseAdmin: ReturnType<typeof createClient>, event: Record<string, any>) {
  const messageId: string | null = event.message_id ?? event.messageId ?? null
  // Smartlead sends bounce_type as 'hard_bounce' or 'soft_bounce'
  const rawBounceType: string = event.bounce_type ?? event.bounceType ?? 'hard_bounce'
  const bounceType: 'hard' | 'soft' = rawBounceType.includes('hard') ? 'hard' : 'soft'

  if (!messageId) {
    console.warn('EMAIL_BOUNCED: missing message_id')
    return
  }

  // Look up the send row by smartlead_message_id
  const { data: send } = await supabaseAdmin
    .from('sends')
    .select('id')
    .eq('smartlead_message_id', messageId)
    .maybeSingle()

  if (!send?.id) {
    console.warn(`EMAIL_BOUNCED: no sends row found for message_id ${messageId}`)
    return
  }

  // Resolve Smartlead client for markLeadReplied calls
  let sl: SmartleadClient | null = null
  try {
    sl = await getSmartleadClient()
  } catch (e) {
    console.warn('EMAIL_BOUNCED: Smartlead client unavailable, cascade will skip SL stop', e)
  }

  const markLeadReplied = async (slCampaignId: string | number, slLeadId: string | number) => {
    if (sl) {
      // SmartleadClient.markLeadReplied expects numeric IDs (Smartlead uses integers)
      await sl.markLeadReplied(Number(slCampaignId), Number(slLeadId))
    }
  }

  await bounceCascade(supabaseAdmin, send.id, bounceType, markLeadReplied)
}

// ---------------------------------------------------------------------------
// EMAIL_UNSUBSCRIBED / LEAD_UNSUBSCRIBED handler
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function onUnsubscribeWebhook(supabaseAdmin: ReturnType<typeof createClient>, event: Record<string, any>) {
  // event.lead_id / campaign_id in Smartlead payloads are Smartlead's own
  // numeric ids, not CRM uuids — resolve them (see resolveSmartleadRefs).
  const refs = await resolveSmartleadRefs(supabaseAdmin, event)
  const leadEmail: string | null =
    event.sl_lead_email ?? event.lead_email ?? event.email ?? event.to_email ?? null
  const leadId: string | null = refs.leadId
  const campaignId: string | null = refs.campaignId

  if (!leadEmail) {
    console.warn('UNSUBSCRIBE: missing lead email in payload')
    return
  }

  const emailNormalized = leadEmail.toLowerCase().trim()

  // Insert into unsubscribes (idempotent — UPSERT via ON CONFLICT on email_normalized)
  const { error: suppressErr } = await supabaseAdmin
    .from('unsubscribes')
    .insert({
      email: leadEmail,
      email_normalized: emailNormalized,
      reason: 'unsubscribe',
      source_event_id: `smartlead:unsub:${event.sl_email_lead_id ?? leadEmail}`,
      lead_id: leadId ?? null,
    })
    .select('id')

  if (suppressErr && !suppressErr.message.includes('duplicate')) {
    console.error('UNSUBSCRIBE: failed to insert suppression', suppressErr)
  }

  // Mark lead.unsubscribed_at
  if (leadId) {
    await supabaseAdmin
      .from('leads')
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq('id', leadId)
      .is('unsubscribed_at', null)
  }

  // Tell Smartlead to stop progression
  if (campaignId && leadId) {
    try {
      // Resolve smartlead_lead_id from sends table
      const { data: send } = await supabaseAdmin
        .from('sends')
        .select('smartlead_lead_id, campaign_id')
        .eq('lead_id', leadId)
        .eq('campaign_id', campaignId)
        .maybeSingle()

      // Resolve smartlead_campaign_id for this campaign
      let slCampaignId: string | null = null
      if (send?.campaign_id) {
        const { data: campaignRow } = await supabaseAdmin
          .from('campaigns')
          .select('smartlead_campaign_id')
          .eq('id', send.campaign_id)
          .maybeSingle()
        slCampaignId = campaignRow?.smartlead_campaign_id ?? null
      }
      const slLeadId = send?.smartlead_lead_id

      if (slCampaignId && slLeadId) {
        const sl = await getSmartleadClient()
        // SmartleadClient.markLeadReplied expects numeric IDs
        await sl.markLeadReplied(Number(slCampaignId), Number(slLeadId))
      }
    } catch (e) {
      console.error('UNSUBSCRIBE: Smartlead stop failed (non-fatal)', e)
    }
  }

  console.log(`UNSUBSCRIBE: suppressed ${emailNormalized}`)
}

// ---------------------------------------------------------------------------
// EMAIL_ACCOUNT_DISCONNECTED handler (P1 ops alert)
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function onEmailAccountDisconnected(supabaseAdmin: ReturnType<typeof createClient>, event: Record<string, any>) {
  const accountId: string | null = event.accountId ?? event.account_id ?? null
  const accountEmail: string | null = event.email ?? null
  const errorMsg: string = event.error ?? event.message ?? 'unknown reason'

  // Update mailbox row via smartlead_account_id
  if (accountId) {
    const { error: mbErr } = await supabaseAdmin
      .from('mailboxes')
      .update({
        paused_reason: 'connection_lost',
        connection_status: 'disconnected',
        updated_at: new Date().toISOString(),
      })
      .eq('smartlead_account_id', accountId)

    if (mbErr) {
      console.error('EMAIL_ACCOUNT_DISCONNECTED: failed to update mailbox', mbErr)
    }
  }

  // P1 ops alert — use Resend (via writeAlert + direct Resend call)
  await writeAlert(supabaseAdmin, {
    type: 'error',
    source: 'smartlead-events',
    message: `[P1] Smartlead mailbox disconnected: ${accountEmail ?? accountId}`,
    details: {
      account_id: accountId,
      account_email: accountEmail,
      error: errorMsg,
    },
  })

  // Send immediate Resend alert email to ops
  await sendOpsAlert(
    `[P1 ALERT] Smartlead mailbox disconnected: ${accountEmail ?? accountId}`,
    `Mailbox ${accountEmail ?? accountId} lost Smartlead connection.\n\nError: ${errorMsg}\n\nAction required: reconnect via Smartlead UI or re-provision app password.`,
  )

  console.error(`EMAIL_ACCOUNT_DISCONNECTED: P1 alert fired for ${accountEmail ?? accountId}`)
}

// ---------------------------------------------------------------------------
// CAMPAIGN_BOUNCE_THRESHOLD_BREACHED handler
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function onCampaignBounceThreshold(supabaseAdmin: ReturnType<typeof createClient>, event: Record<string, any>) {
  const slCampaignId: string | null = event.campaign_id ?? event.campaignId ?? null

  if (!slCampaignId) {
    console.warn('CAMPAIGN_BOUNCE_THRESHOLD_BREACHED: missing campaign_id')
    return
  }

  // Look up our campaign by smartlead_campaign_id
  const { data: campaign } = await supabaseAdmin
    .from('campaigns')
    .select('id, name')
    .eq('smartlead_campaign_id', slCampaignId)
    .maybeSingle()

  if (campaign?.id) {
    await supabaseAdmin
      .from('campaigns')
      .update({ status: 'paused' })
      .eq('id', campaign.id)
  }

  await writeAlert(supabaseAdmin, {
    type: 'error',
    source: 'smartlead-events',
    message: `Campaign bounce threshold breached: ${campaign?.name ?? slCampaignId}`,
    details: { smartlead_campaign_id: slCampaignId, campaign_id: campaign?.id },
  })

  await sendOpsAlert(
    `[ALERT] Campaign bounce threshold breached: ${campaign?.name ?? slCampaignId}`,
    `Smartlead reported bounce threshold exceeded for campaign ${campaign?.name ?? slCampaignId}.\n\nCampaign has been paused. Review mailbox health and suppress the affected sending domain.`,
  )
}

// ---------------------------------------------------------------------------
// Ops alert via Resend transactional email
// ---------------------------------------------------------------------------
async function sendOpsAlert(subject: string, body: string): Promise<void> {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const OPS_ALERT_EMAIL = Deno.env.get('OPS_ALERT_EMAIL')
  const RESEND_FROM_DEFAULT = Deno.env.get('RESEND_FROM_DEFAULT') ?? 'Laser CRM <ops@notify.lazerlending.com>'

  if (!RESEND_API_KEY || !OPS_ALERT_EMAIL) {
    console.warn('sendOpsAlert: RESEND_API_KEY or OPS_ALERT_EMAIL not configured')
    return
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM_DEFAULT,
        to: [OPS_ALERT_EMAIL],
        subject,
        text: body,
      }),
    })
    if (!res.ok) {
      console.error('sendOpsAlert: Resend API error', res.status, await res.text())
    }
  } catch (e) {
    console.error('sendOpsAlert: failed to send alert email', e)
  }
}

// ---------------------------------------------------------------------------
// Webhook sweeper — heals unprocessed webhook_events rows
// (called via ?action=sweep; invoked by 5-min pg_cron job)
// ---------------------------------------------------------------------------
async function runWebhookSweeper(supabaseAdmin: ReturnType<typeof createClient>): Promise<number> {
  const { data: stuck, error } = await supabaseAdmin
    .from('webhook_events')
    .select('id, event_type, payload_raw')
    .is('processed_at', null)
    .lt('received_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .limit(50)

  if (error) {
    console.error('webhook-sweeper: failed to query stuck events', error)
    return 0
  }

  let healed = 0
  for (const ev of stuck ?? []) {
    try {
      const payload =
        typeof ev.payload_raw === 'string' ? JSON.parse(ev.payload_raw) : ev.payload_raw
      await dispatchByEvent(supabaseAdmin, ev.event_type, payload)
      await supabaseAdmin
        .from('webhook_events')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', ev.id)
      healed++
    } catch (err) {
      // Will retry on next sweep — last_error updated for visibility
      console.error(`webhook-sweeper: retry failed for event ${ev.id}`, err)
      await supabaseAdmin
        .from('webhook_events')
        .update({ last_error: String(err) })
        .eq('id', ev.id)
    }
  }

  console.log(`webhook-sweeper: healed ${healed}/${stuck?.length ?? 0} stuck events`)
  return healed
}

// ---------------------------------------------------------------------------
// Main Deno.serve handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // --- Sweeper path ---
  const url = new URL(req.url)
  if (url.searchParams.get('action') === 'sweep') {
    try {
      const healed = await runWebhookSweeper(supabaseAdmin)
      return new Response(JSON.stringify({ success: true, healed }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } catch (err) {
      console.error('sweeper error', err)
      return new Response(JSON.stringify({ success: false, error: String(err) }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  // --- Main webhook receiver path ---
  const rawBody = await req.text()

  // 1. Signature verification
  // NOTE (B13): Smartlead's UI does not expose a signing secret — it simply POSTs to the URL.
  // If SMARTLEAD_WEBHOOK_SIGNING_SECRET is set AND Smartlead sends X-Smartlead-Signature,
  // we verify HMAC. If the secret is unset OR the header is absent, we log and proceed
  // (sandbox-safe). Enable strict mode once Phase 0.6 confirms Smartlead's actual header behaviour.
  const SIGNING_SECRET = Deno.env.get('SMARTLEAD_WEBHOOK_SIGNING_SECRET')
  const signatureHeader = req.headers.get('X-Smartlead-Signature')
  if (SIGNING_SECRET && signatureHeader) {
    const valid = await verifyHmacSha256(rawBody, signatureHeader, SIGNING_SECRET)
    if (!valid) {
      console.warn('smartlead-events: HMAC verification failed')
      return new Response('Unauthorized', { status: 401 })
    }
  } else if (SIGNING_SECRET && !signatureHeader) {
    // Secret configured but Smartlead didn't send header — log, proceed (B13 pending resolution)
    console.warn('smartlead-events: SMARTLEAD_WEBHOOK_SIGNING_SECRET set but no X-Smartlead-Signature header received. Proceeding without verification.')
  } else {
    // No secret configured — sandbox / pre-B13 mode, log and proceed
    console.warn('smartlead-events: No SMARTLEAD_WEBHOOK_SIGNING_SECRET set. Accepting unauthenticated webhook (sandbox mode).')
  }

  // 2. Request-Id header (idempotency key)
  // Smartlead may not send X-Request-Id — fall back to a hash of the payload for dedup.
  const eventId = req.headers.get('X-Request-Id') ?? await sha256Hex(rawBody)

  // 3. Parse body
  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  // 3b. Payload-secret verification. Smartlead sends no signature header, but
  // includes the account's secret_key in every payload (verified against a live
  // EMAIL_REPLY payload 2026-07-31). When our secret is configured and no HMAC
  // header was provided, require the payload secret to match.
  if (SIGNING_SECRET && !signatureHeader) {
    const payloadSecret = (body.secret_key ?? '') as string
    if (payloadSecret && payloadSecret !== SIGNING_SECRET) {
      console.warn('smartlead-events: payload secret_key mismatch — rejecting')
      return new Response('Unauthorized', { status: 401 })
    }
  }

  // 4. Normalize event name. Smartlead's documented payload field is
  // `event_type` (snake_case); `event` and camelCase `eventType`
  // (EMAIL_ACCOUNT_DISCONNECTED) are kept for older payload variants.
  const eventName: string = (body.event ?? body.eventType ?? body.event_type ?? '') as string
  if (!eventName) {
    return new Response('Missing event, eventType, or event_type field', { status: 400 })
  }

  // 5. Compute payload hash
  const payloadHash = await sha256Hex(rawBody)

  // 6. Insert into webhook_events — idempotent ON CONFLICT DO NOTHING
  const { data: insertedRows, error: insertErr } = await supabaseAdmin
    .from('webhook_events')
    .insert({
      provider: 'smartlead',
      external_event_id: eventId,
      event_type: eventName,
      received_at: new Date().toISOString(),
      payload_hash: payloadHash,
      payload_raw: body,
    })
    .select('id')

  if (insertErr) {
    // Unique constraint violation = already processed → return 200 immediately (idempotent)
    if (insertErr.message.includes('duplicate') || insertErr.code === '23505') {
      console.log(`smartlead-events: duplicate event ${eventId} — skipping (already processed)`)
      return new Response(JSON.stringify({ success: true, duplicate: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    console.error('smartlead-events: failed to insert webhook_event', insertErr)
    return new Response('DB insert failed', { status: 500 })
  }

  // If no row was inserted (ON CONFLICT DO NOTHING returned empty), it's already processed
  if (!insertedRows || insertedRows.length === 0) {
    console.log(`smartlead-events: event ${eventId} already exists — skipping`)
    return new Response(JSON.stringify({ success: true, duplicate: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const webhookEventId = insertedRows[0].id

  // 7. Dispatch to event handler
  try {
    await dispatchByEvent(supabaseAdmin, eventName, body as Record<string, unknown>)

    // 8. Mark processed
    await supabaseAdmin
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', webhookEventId)

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    // On dispatch failure: write last_error and return 500 so Smartlead retries.
    // The sweeper will pick it up if retries are exhausted.
    console.error(`smartlead-events: dispatch failed for event ${eventId}`, err)
    await supabaseAdmin
      .from('webhook_events')
      .update({ last_error: String(err) })
      .eq('id', webhookEventId)

    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
