/**
 * smartlead-reconcile/index.ts
 * Task 1.13 — Daily reconcile cron vs Smartlead campaign analytics.
 *
 * For each active Smartlead campaign:
 *   1. Fetch yesterday's analytics from Smartlead getCampaignAnalytics.
 *   2. Compare local sends WHERE status='sent' AND date = yesterday.
 *   3. Discrepancy >5% or >5 absolute: fetch per-lead Smartlead stats and backfill / alert.
 *   4. Does NOT touch today_enrolled_count (that is a local enrollment-gate counter).
 *   5. All reconciliation actions logged to system_alerts table.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { writeAlert } from '../_shared/alerts.ts'

// Smartlead client — assumed to exist at _shared/smartlead.ts (parallel-agent deliverable)
// deno-lint-ignore no-explicit-any
type SmartleadClient = any

async function getSmartleadClient(): Promise<SmartleadClient> {
  const { SmartleadClient } = await import('../_shared/smartlead.ts')
  // SmartleadClient reads SMARTLEAD_API_KEY from Deno.env internally (per smartlead-campaign pattern)
  if (!Deno.env.get('SMARTLEAD_API_KEY')) throw new Error('SMARTLEAD_API_KEY is not set')
  return new SmartleadClient()
}

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------
function yesterdayUTC(): { start: string; end: string; label: string } {
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const label = yesterday.toISOString().split('T')[0]
  return {
    start: `${label}T00:00:00.000Z`,
    end: `${label}T23:59:59.999Z`,
    label,
  }
}

// ---------------------------------------------------------------------------
// Reconcile a single campaign
// ---------------------------------------------------------------------------
interface ReconcileResult {
  campaignId: string
  slCampaignId: string
  date: string
  localSentCount: number
  slSentCount: number
  backfilledRows: number
  silentDropsAlerted: number
  skipped: boolean
  skipReason?: string
}

async function reconcileCampaign(
  supabaseAdmin: ReturnType<typeof createClient>,
  sl: SmartleadClient,
  campaign: { id: string; name: string; smartlead_campaign_id: string },
  date: { start: string; end: string; label: string },
): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    campaignId: campaign.id,
    slCampaignId: campaign.smartlead_campaign_id,
    date: date.label,
    localSentCount: 0,
    slSentCount: 0,
    backfilledRows: 0,
    silentDropsAlerted: 0,
    skipped: false,
  }

  // Step 1: Fetch Smartlead campaign analytics for yesterday
  let slAnalytics: { unique_sent_count?: number; leads?: Array<{ email: string; status: string; id: string }> }
  try {
    // SmartleadClient.getCampaignAnalytics(campaignId: number, startDate: string, endDate: string)
    slAnalytics = await sl.getCampaignAnalytics(
      Number(campaign.smartlead_campaign_id),
      date.start,
      date.end,
    )
  } catch (err) {
    console.error(`reconcile: getCampaignAnalytics failed for ${campaign.smartlead_campaign_id}`, err)
    result.skipped = true
    result.skipReason = `Smartlead API error: ${String(err)}`
    await writeAlert(supabaseAdmin, {
      type: 'warning',
      source: 'smartlead-reconcile',
      message: `Failed to fetch analytics for campaign: ${campaign.name}`,
      details: { campaign_id: campaign.id, sl_campaign_id: campaign.smartlead_campaign_id, error: String(err) },
    })
    return result
  }

  const slSentCount: number = slAnalytics.unique_sent_count ?? 0
  result.slSentCount = slSentCount

  // Step 2: Count local sends with status='sent' for yesterday
  const { count: localCount, error: countErr } = await supabaseAdmin
    .from('sends')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('status', 'sent')
    .gte('sent_at', date.start)
    .lte('sent_at', date.end)

  if (countErr) {
    console.error(`reconcile: failed to count local sends for campaign ${campaign.id}`, countErr)
    result.skipped = true
    result.skipReason = `Local DB count error: ${countErr.message}`
    return result
  }

  result.localSentCount = localCount ?? 0

  // Step 3: Assess discrepancy
  const diff = Math.abs(result.localSentCount - slSentCount)
  const diffPct = slSentCount > 0 ? diff / slSentCount : 0
  const ABSOLUTE_THRESHOLD = 5
  const RELATIVE_THRESHOLD = 0.05

  if (diff <= ABSOLUTE_THRESHOLD && diffPct <= RELATIVE_THRESHOLD) {
    // Within acceptable tolerance — no action needed
    console.log(
      `reconcile: campaign ${campaign.name} OK (local=${result.localSentCount}, sl=${slSentCount}, diff=${diff})`,
    )
    return result
  }

  // Step 4: Discrepancy beyond threshold — fetch per-lead Smartlead stats
  console.log(
    `reconcile: discrepancy for ${campaign.name}: local=${result.localSentCount}, sl=${slSentCount}, diff=${diff} (${(diffPct * 100).toFixed(1)}%)`,
  )

  let slLeads: Array<{ email: string; status: string; id: string; sent_time?: string }> = []
  try {
    // getCampaignAnalytics may return an expanded leads array depending on Smartlead plan.
    // If not present, we have no per-lead data for this reconcile cycle — alert and continue.
    if (slAnalytics.leads && slAnalytics.leads.length > 0) {
      slLeads = slAnalytics.leads
    } else {
      // Sandbox verification item: confirm whether getCampaignAnalytics returns per-lead data.
      // If it does not, the reconcile can only alert on aggregate discrepancy, not backfill rows.
      console.log(
        `reconcile: no per-lead data in getCampaignAnalytics response for ${campaign.smartlead_campaign_id} — aggregate-only reconcile`,
      )
    }
  } catch (err) {
    console.error(`reconcile: failed to fetch per-lead stats for ${campaign.smartlead_campaign_id}`, err)
    await writeAlert(supabaseAdmin, {
      type: 'error',
      source: 'smartlead-reconcile',
      message: `Discrepancy detected but per-lead stats unavailable: ${campaign.name}`,
      details: {
        campaign_id: campaign.id,
        local_sent: result.localSentCount,
        sl_sent: slSentCount,
        diff,
        diff_pct: diffPct,
        error: String(err),
      },
    })
    return result
  }

  // Fetch our local send rows for this campaign/date
  const { data: localSends, error: localSendsErr } = await supabaseAdmin
    .from('sends')
    .select('id, lead_id, smartlead_lead_id, status, sent_at')
    .eq('campaign_id', campaign.id)
    .gte('sent_at', date.start)
    .lte('sent_at', date.end)

  if (localSendsErr) {
    console.error(`reconcile: failed to fetch local sends for campaign ${campaign.id}`, localSendsErr)
    return result
  }

  // Build lookup maps
  const localBySlLeadId = new Map<string, { id: string; status: string }>()
  for (const send of localSends ?? []) {
    if (send.smartlead_lead_id) {
      localBySlLeadId.set(send.smartlead_lead_id, { id: send.id, status: send.status })
    }
  }

  const slSentLeadIds = new Set<string>()

  // Step 5a: Backfill — Smartlead says sent, local has no record
  for (const slLead of slLeads) {
    if (slLead.status !== 'EMAIL_SENT' && slLead.status !== 'sent') continue
    slSentLeadIds.add(slLead.id)

    if (!localBySlLeadId.has(slLead.id)) {
      // Smartlead sent it but we have no local record — backfill
      // Resolve lead_id from email
      const { data: lead } = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('email', slLead.email)
        .maybeSingle()

      if (lead?.id) {
        // Check if a sends row exists for this lead in this campaign at all
        const { data: existingSend } = await supabaseAdmin
          .from('sends')
          .select('id')
          .eq('campaign_id', campaign.id)
          .eq('lead_id', lead.id)
          .maybeSingle()

        if (existingSend) {
          // Update existing row (may be queued status)
          await supabaseAdmin
            .from('sends')
            .update({
              status: 'sent',
              sent_at: slLead.sent_time ?? date.start,
              smartlead_lead_id: slLead.id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingSend.id)
        } else {
          // Insert a backfill row — find the claimed mailbox via pool
          const { data: campaign_data } = await supabaseAdmin
            .from('campaigns')
            .select('sending_pool_id')
            .eq('id', campaign.id)
            .maybeSingle()

          // Resolve a mailbox from the campaign's pool for the backfill
          let fallbackMailboxId: string | null = null
          if (campaign_data?.sending_pool_id) {
            const { data: pm } = await supabaseAdmin
              .from('pool_memberships')
              .select('mailbox_id')
              .eq('pool_id', campaign_data.sending_pool_id)
              .limit(1)
              .maybeSingle()
            fallbackMailboxId = pm?.mailbox_id ?? null
          }

          if (fallbackMailboxId) {
            await supabaseAdmin.from('sends').insert({
              lead_id: lead.id,
              campaign_id: campaign.id,
              claimed_mailbox_id: fallbackMailboxId,
              mailbox_id: fallbackMailboxId,
              smartlead_lead_id: slLead.id,
              status: 'sent',
              sent_at: slLead.sent_time ?? date.start,
              error_reason: 'backfilled_by_reconcile',
            })
          }
        }
        result.backfilledRows++
        console.log(`reconcile: backfilled send for lead ${lead.id} in campaign ${campaign.id}`)
      }
    }
  }

  // Step 5b: Silent-drop detection — local says sent, Smartlead has no record
  for (const send of localSends ?? []) {
    if (send.status !== 'sent') continue
    if (!send.smartlead_lead_id) continue

    if (!slSentLeadIds.has(send.smartlead_lead_id)) {
      // Local says sent, Smartlead has no record for this lead — possible silent drop
      result.silentDropsAlerted++
      await writeAlert(supabaseAdmin, {
        type: 'warning',
        source: 'smartlead-reconcile',
        message: `Silent-drop suspect: local send has no Smartlead record`,
        details: {
          send_id: send.id,
          lead_id: send.lead_id,
          campaign_id: campaign.id,
          smartlead_lead_id: send.smartlead_lead_id,
          local_sent_at: send.sent_at,
          reconcile_date: date.label,
        },
      })
    }
  }

  // Log summary alert for this reconcile run
  if (result.backfilledRows > 0 || result.silentDropsAlerted > 0) {
    await writeAlert(supabaseAdmin, {
      type: 'warning',
      source: 'smartlead-reconcile',
      message: `Reconcile action for campaign: ${campaign.name}`,
      details: {
        campaign_id: campaign.id,
        date: date.label,
        local_sent: result.localSentCount,
        sl_sent: slSentCount,
        diff,
        backfilled: result.backfilledRows,
        silent_drops: result.silentDropsAlerted,
      },
    })
  }

  return result
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

    const date = yesterdayUTC()

    // Fetch campaigns active in the last 7 days with a Smartlead campaign ID
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: campaigns, error: campaignsErr } = await supabaseAdmin
      .from('campaigns')
      .select('id, name, smartlead_campaign_id')
      .eq('provider', 'smartlead')
      .not('smartlead_campaign_id', 'is', null)
      .is('deleted_at', null)
      .or(`status.eq.active,updated_at.gt.${sevenDaysAgo}`)

    if (campaignsErr) {
      throw new Error(`Failed to fetch campaigns: ${campaignsErr.message}`)
    }

    if (!campaigns || campaigns.length === 0) {
      console.log('smartlead-reconcile: no Smartlead campaigns to reconcile')
      return new Response(
        JSON.stringify({ success: true, campaignsChecked: 0, date: date.label }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    let sl: SmartleadClient
    try {
      sl = await getSmartleadClient()
    } catch (err) {
      throw new Error(`Failed to initialize Smartlead client: ${err}`)
    }

    const results: ReconcileResult[] = []
    for (const campaign of campaigns) {
      if (!campaign.smartlead_campaign_id) continue
      const result = await reconcileCampaign(
        supabaseAdmin,
        sl,
        campaign as { id: string; name: string; smartlead_campaign_id: string },
        date,
      )
      results.push(result)
    }

    const totalBackfilled = results.reduce((sum, r) => sum + r.backfilledRows, 0)
    const totalSilentDrops = results.reduce((sum, r) => sum + r.silentDropsAlerted, 0)
    const skipped = results.filter((r) => r.skipped).length

    console.log(
      `smartlead-reconcile: date=${date.label} campaigns=${campaigns.length} backfilled=${totalBackfilled} silentDrops=${totalSilentDrops} skipped=${skipped}`,
    )

    return new Response(
      JSON.stringify({
        success: true,
        date: date.label,
        campaignsChecked: campaigns.length,
        skipped,
        totalBackfilled,
        totalSilentDrops,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('smartlead-reconcile error', err)
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
