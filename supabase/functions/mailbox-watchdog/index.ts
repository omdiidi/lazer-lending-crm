/**
 * mailbox-watchdog/index.ts
 * Task 1.12 — Hourly mailbox health watchdog.
 * Task 1.17 — Webhook gap-alert (piggybacked on same cron, per plan).
 *
 * Per runMailboxWatchdog pseudocode (plan §Pseudocode):
 *   1. Query mailboxes + rolling-24h send stats via LEFT JOIN sends.
 *   2. Skip if attempted < min_attempted (5 during fresh-mailbox week-1, else 10).
 *   3. Hard-rule FIRST: any single complaint → pause + ops alert + continue.
 *   4. Wilson lower-bound: bounce >2% → pause; complaint >0.1% → pause.
 *   5. Webhook gap-alert: if no Smartlead webhook events in last 2h AND active campaigns exist.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { writeAlert } from '../_shared/alerts.ts'

// Wilson lower-bound at 95% confidence (z = 1.96)
const Z = 1.96
function wilsonLower(hits: number, n: number): number {
  if (n === 0) return 0
  const p = hits / n
  const numerator =
    p + (Z * Z) / (2 * n) - Z * Math.sqrt((p * (1 - p) + (Z * Z) / (4 * n)) / n)
  const denominator = 1 + (Z * Z) / n
  return numerator / denominator
}

const BOUNCE_THRESHOLD = 0.02 // 2%
const COMPLAINT_THRESHOLD = 0.001 // 0.1%
const FRESH_MAILBOX_DAYS = 7
const MIN_ATTEMPTED_FRESH = 5
const MIN_ATTEMPTED_STANDARD = 10
const WEBHOOK_GAP_ALERT_HOURS = 2

// ---------------------------------------------------------------------------
// Ops alert via Resend transactional email
// ---------------------------------------------------------------------------
async function sendOpsEmail(subject: string, body: string): Promise<void> {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const OPS_ALERT_EMAIL = Deno.env.get('OPS_ALERT_EMAIL')
  const RESEND_FROM_DEFAULT =
    Deno.env.get('RESEND_FROM_DEFAULT') ?? 'Lazer CRM <ops@notify.lazerlending.com>'

  if (!RESEND_API_KEY || !OPS_ALERT_EMAIL) {
    console.warn('mailbox-watchdog: RESEND_API_KEY or OPS_ALERT_EMAIL not configured — alert skipped')
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
      console.error('mailbox-watchdog: Resend API error', res.status, await res.text())
    }
  } catch (e) {
    console.error('mailbox-watchdog: failed to send ops email', e)
  }
}

// ---------------------------------------------------------------------------
// pauseMailbox — updates warmup_state and paused_reason
// ---------------------------------------------------------------------------
async function pauseMailbox(
  supabaseAdmin: ReturnType<typeof createClient>,
  mailboxId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('mailboxes')
    .update({
      warmup_state: 'paused',
      paused_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', mailboxId)

  if (error) {
    console.error(`mailbox-watchdog: failed to pause mailbox ${mailboxId}`, error)
  }
}

// ---------------------------------------------------------------------------
// Main watchdog logic
// ---------------------------------------------------------------------------
interface MailboxHealthRow {
  mailbox_id: string
  address: string
  live_started_at: string | null
  attempted: number
  bounced: number
  complained: number
}

async function runMailboxWatchdog(supabaseAdmin: ReturnType<typeof createClient>): Promise<{
  checked: number
  paused: number
  skipped: number
}> {
  // Query mailboxes with rolling-24h send stats via raw SQL.
  // Supabase JS client does not support CTEs directly, so we use rpc or
  // a PostgREST-compatible query. We fetch sends separately and aggregate in JS
  // to avoid a raw SQL dependency on rpc('exec_sql').

  // Fetch all non-paused mailboxes
  const { data: mailboxes, error: mbErr } = await supabaseAdmin
    .from('mailboxes')
    .select('id, address, live_started_at, warmup_state')
    .is('paused_reason', null)
    .neq('warmup_state', 'paused')

  if (mbErr || !mailboxes) {
    console.error('mailbox-watchdog: failed to fetch mailboxes', mbErr)
    return { checked: 0, paused: 0, skipped: 0 }
  }

  if (mailboxes.length === 0) {
    console.log('mailbox-watchdog: no active mailboxes to check')
    return { checked: 0, paused: 0, skipped: 0 }
  }

  // Fetch rolling-24h sends for these mailboxes
  const mailboxIds = mailboxes.map((m) => m.id)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: sends, error: sendsErr } = await supabaseAdmin
    .from('sends')
    .select('mailbox_id, status, sent_at')
    .in('mailbox_id', mailboxIds)
    .gt('sent_at', since24h)
    .not('sent_at', 'is', null)

  if (sendsErr) {
    console.error('mailbox-watchdog: failed to fetch sends', sendsErr)
    return { checked: 0, paused: 0, skipped: 0 }
  }

  // Aggregate per mailbox
  const statsMap = new Map<
    string,
    { attempted: number; bounced: number; complained: number }
  >()
  for (const mailboxId of mailboxIds) {
    statsMap.set(mailboxId, { attempted: 0, bounced: 0, complained: 0 })
  }
  for (const send of sends ?? []) {
    const stats = statsMap.get(send.mailbox_id)
    if (!stats) continue
    stats.attempted++
    if (send.status === 'bounced') stats.bounced++
    if (send.status === 'complained') stats.complained++
  }

  const rows: MailboxHealthRow[] = mailboxes.map((m) => {
    const s = statsMap.get(m.id) ?? { attempted: 0, bounced: 0, complained: 0 }
    return {
      mailbox_id: m.id,
      address: m.address,
      live_started_at: m.live_started_at,
      ...s,
    }
  })

  let checked = 0
  let paused = 0
  let skipped = 0

  for (const r of rows) {
    checked++

    // Stepped ramp: fresh mailboxes use min_attempted=5 for the first 7 days
    const isFresh =
      r.live_started_at !== null &&
      Date.now() - new Date(r.live_started_at).getTime() < FRESH_MAILBOX_DAYS * 24 * 60 * 60 * 1000
    const minAttempted = isFresh ? MIN_ATTEMPTED_FRESH : MIN_ATTEMPTED_STANDARD

    if (r.attempted < minAttempted) {
      skipped++
      continue
    }

    // HARD RULE FIRST: any single complaint → manual review queue
    // This prevents double-pause (complaint also satisfies Wilson threshold).
    if (r.complained >= 1) {
      await pauseMailbox(supabaseAdmin, r.mailbox_id, 'single_complaint_review')
      await writeAlert(supabaseAdmin, {
        type: 'error',
        source: 'mailbox-watchdog',
        message: `Mailbox paused for manual review: ${r.address} (single spam complaint)`,
        details: {
          mailbox_id: r.mailbox_id,
          address: r.address,
          complained: r.complained,
          attempted: r.attempted,
        },
      })
      await sendOpsEmail(
        `[ALERT] Mailbox paused — spam complaint: ${r.address}`,
        `Mailbox ${r.address} received 1 spam complaint and has been moved to manual review.\n\n` +
          `Attempts (24h): ${r.attempted}\nComplaints: ${r.complained}\n\n` +
          `Action required: review sending content, suppress affected contacts, manually unpause if clear.`,
      )
      paused++
      continue // Skip Wilson check for this mailbox this cycle
    }

    // Wilson lower-bound check: bounce rate
    const bounceLower = wilsonLower(r.bounced, r.attempted)
    if (bounceLower > BOUNCE_THRESHOLD) {
      await pauseMailbox(supabaseAdmin, r.mailbox_id, 'bounce_threshold')
      await writeAlert(supabaseAdmin, {
        type: 'error',
        source: 'mailbox-watchdog',
        message: `Mailbox auto-paused (bounce rate): ${r.address}`,
        details: {
          mailbox_id: r.mailbox_id,
          address: r.address,
          bounce_lower: bounceLower,
          bounced: r.bounced,
          attempted: r.attempted,
        },
      })
      await sendOpsEmail(
        `[ALERT] Mailbox paused — bounce threshold: ${r.address}`,
        `Mailbox ${r.address} exceeded the bounce rate threshold and has been auto-paused.\n\n` +
          `Attempts (24h): ${r.attempted}\nBounces: ${r.bounced}\n` +
          `Wilson lower bound: ${(bounceLower * 100).toFixed(2)}% (threshold: ${BOUNCE_THRESHOLD * 100}%)\n\n` +
          `Action required: review list quality, suppress bounced addresses, investigate domain health.`,
      )
      paused++
      continue
    }

    // Wilson lower-bound check: complaint rate (only reaches here if complained === 0)
    const complaintLower = wilsonLower(r.complained, r.attempted)
    if (complaintLower > COMPLAINT_THRESHOLD) {
      await pauseMailbox(supabaseAdmin, r.mailbox_id, 'complaint_threshold')
      await writeAlert(supabaseAdmin, {
        type: 'error',
        source: 'mailbox-watchdog',
        message: `Mailbox auto-paused (complaint rate): ${r.address}`,
        details: {
          mailbox_id: r.mailbox_id,
          address: r.address,
          complaint_lower: complaintLower,
          complained: r.complained,
          attempted: r.attempted,
        },
      })
      await sendOpsEmail(
        `[ALERT] Mailbox paused — complaint rate: ${r.address}`,
        `Mailbox ${r.address} exceeded the complaint rate threshold and has been auto-paused.\n\n` +
          `Attempts (24h): ${r.attempted}\nComplaints: ${r.complained}\n` +
          `Wilson lower bound: ${(complaintLower * 100).toFixed(3)}% (threshold: ${COMPLAINT_THRESHOLD * 100}%)\n\n` +
          `Action required: review sending content and list quality.`,
      )
      paused++
    }
  }

  return { checked, paused, skipped }
}

// ---------------------------------------------------------------------------
// Task 1.17 — Webhook gap-alert
// Alerts ops if no Smartlead webhook events received in the last 2 hours
// while active campaigns exist (indicates Smartlead auto-disabled our webhook).
// ---------------------------------------------------------------------------
async function runWebhookGapAlert(supabaseAdmin: ReturnType<typeof createClient>): Promise<boolean> {
  // Check if there are any active Smartlead campaigns
  const { count: activeCampaignCount } = await supabaseAdmin
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'smartlead')
    .eq('status', 'active')

  if (!activeCampaignCount || activeCampaignCount === 0) {
    // No active Smartlead campaigns — gap is expected
    return false
  }

  // Check last received webhook event from Smartlead
  const { data: lastEvent } = await supabaseAdmin
    .from('webhook_events')
    .select('received_at')
    .eq('provider', 'smartlead')
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const gapThreshold = new Date(Date.now() - WEBHOOK_GAP_ALERT_HOURS * 60 * 60 * 1000)

  let gapDetected = false
  if (!lastEvent) {
    // No events ever received — if campaigns are active, this is a gap
    gapDetected = true
  } else if (new Date(lastEvent.received_at) < gapThreshold) {
    gapDetected = true
  }

  if (gapDetected) {
    const lastReceivedMsg = lastEvent
      ? `Last event: ${lastEvent.received_at}`
      : 'No Smartlead webhook events have ever been received'

    await writeAlert(supabaseAdmin, {
      type: 'warning',
      source: 'mailbox-watchdog',
      message: `Smartlead webhook gap detected — no events in ${WEBHOOK_GAP_ALERT_HOURS}h`,
      details: {
        active_campaigns: activeCampaignCount,
        last_received: lastEvent?.received_at ?? null,
        gap_threshold: gapThreshold.toISOString(),
      },
    })

    await sendOpsEmail(
      `[WARNING] Smartlead webhook gap: no events in ${WEBHOOK_GAP_ALERT_HOURS} hours`,
      `No Smartlead webhook events received in the last ${WEBHOOK_GAP_ALERT_HOURS} hours despite ${activeCampaignCount} active campaign(s).\n\n` +
        `${lastReceivedMsg}\n\n` +
        `Action required: log into Smartlead and verify the webhook URL is still registered and active.\n` +
        `Smartlead auto-disables webhooks after ~7 hours of failed deliveries. Re-register if needed.`,
    )

    console.warn(
      `mailbox-watchdog: webhook gap alert fired (${activeCampaignCount} active campaigns, last event: ${lastEvent?.received_at ?? 'none'})`,
    )
  }

  return gapDetected
}

// ---------------------------------------------------------------------------
// Main Deno.serve handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const [watchdogResult, gapDetected] = await Promise.all([
      runMailboxWatchdog(supabaseAdmin),
      runWebhookGapAlert(supabaseAdmin),
    ])

    console.log('mailbox-watchdog complete', { ...watchdogResult, webhookGapDetected: gapDetected })

    return new Response(
      JSON.stringify({
        success: true,
        ...watchdogResult,
        webhookGapDetected: gapDetected,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('mailbox-watchdog error', err)
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
