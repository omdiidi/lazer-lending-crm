/**
 * classify-reply Edge Function
 *
 * Accepts: { reply_id: string }
 *
 * Pipeline:
 *   1. Load reply + associated send + campaign from DB.
 *   2. Stage 1: keyword pre-classifier (keywordClassify) — handles ~70% of cases.
 *   3. Stage 2: LLM via classifyReplyWithCircuit — runs on null from stage 1.
 *   4. Persist classification (label, confidence, rationale, language, requires_human_review).
 *   5. Side effects on classification:
 *      a. unsubscribe → insert into `unsubscribes` + update `leads.unsubscribed_at`
 *         + call Smartlead markLeadReplied to stop autonomous progression.
 *      b. Any classification != null AND NOT (negative AND confidence <= 0.8):
 *         cancel queued future-step sends (stop-on-reply) + markLeadReplied in Smartlead.
 *      c. positive → invoke store-and-notify (via internal fetch) which then calls fub-push.
 *      d. neutral/ooo with requires_human_review=true → invoke store-and-notify for team alert.
 *
 * Called by: smartlead-events (on EMAIL_REPLIED event).
 * Does NOT call fub-push directly — fub-push is called from store-and-notify.
 *
 * Dependency on smartlead-events (Phase 1D): this function expects the `replies` row
 * to already exist (created by smartlead-events on EMAIL_REPLIED). If the row does not
 * exist, returns 404. The reply row must have: subject, body_text, lead_id, campaign_id,
 * in_reply_to_send_id (nullable), from_email, from_name.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { writeAlert } from '../_shared/alerts.ts'
import { classifyReplyWithCircuit, type Classification } from '../_shared/classifier.ts'

// ---------------------------------------------------------------------------
// Helpers — keyword classifier (duplicated here to avoid cross-runtime import
// of src/lib/classifier-keywords.ts which is a browser-compiled TS module)
// ---------------------------------------------------------------------------

type ClassificationLabel = 'positive' | 'neutral' | 'ooo' | 'unsubscribe' | 'negative';

interface KeywordClassification {
  label: ClassificationLabel;
  confidence: number;
}

const OOO_RE =
  /\b(out of office|vacation|away until|return on|on leave|on holiday|be back|will be back|currently out|temporarily unavailable|auto-?reply|automatic reply)\b/i;

const UNSUB_RE =
  /\b(unsubscribe|remove me|stop (calling|emailing|contacting)|opt out|take me off|don't email|do not email|remove my (name|email)|please stop|no more emails?|stop sending)\b/i;

const NEGATIVE_RE =
  /\b(not interested|leave me alone|do not contact|don't contact|never email|fuck off|go away|lose my (number|email|contact)|stop bothering|this is spam|mark as spam|unsubscribe me)\b/i;

const POSITIVE_RE =
  /\b(yes[,!.]? please|i'?m interested|i am interested|tell me more|send me (more|info|details|information)|sign me up|book (a call|time|a meeting)|let'?s connect|i'?d like to (chat|talk|connect|learn more)|sounds good|i'?d be interested|great timing|perfect timing|how does .{1,30} work|can we schedule|set up a call|interested in learning|want to learn more)\b/i;

function keywordClassify(reply: {
  subject: string;
  body: string;
}): KeywordClassification | null {
  const text = (reply.subject ?? '') + '\n' + (reply.body ?? '');
  const matches: KeywordClassification[] = [];

  if (OOO_RE.test(text)) matches.push({ label: 'ooo', confidence: 0.95 });
  if (UNSUB_RE.test(text)) matches.push({ label: 'unsubscribe', confidence: 0.95 });
  if (NEGATIVE_RE.test(text)) matches.push({ label: 'negative', confidence: 0.85 });
  if (POSITIVE_RE.test(text)) matches.push({ label: 'positive', confidence: 0.85 });

  if (matches.length === 1) return matches[0];
  return null;
}

// ---------------------------------------------------------------------------
// PII redaction (inline to avoid cross-runtime TS module import)
// ---------------------------------------------------------------------------

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const CARD_RE = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;
const ITIN_RE = /\b9\d{2}-\d{2}-\d{4}\b/g;
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

function redactPII(text: string): string {
  return text
    .replace(CARD_RE, '[REDACTED]')
    .replace(ITIN_RE, '[REDACTED]')
    .replace(SSN_RE, '[REDACTED]')
    .replace(PHONE_RE, '[REDACTED]')
    .replace(EMAIL_RE, '[REDACTED]');
}

// ---------------------------------------------------------------------------
// Supabase admin client
// ---------------------------------------------------------------------------

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ---------------------------------------------------------------------------
// Stop-on-reply: cancel queued sends + mark lead replied in Smartlead
// ---------------------------------------------------------------------------

async function applyStopOnReply(
  leadId: string,
  campaignId: string,
  currentStepNumber: number | null,
): Promise<void> {
  // Cancel queued future-step sends for this lead/campaign
  // Step filter: only cancel steps AFTER the current reply's step
  let updateQuery = supabaseAdmin
    .from('sends')
    .update({
      status: 'cancelled_stop_on_reply',
      error_reason: 'lead_replied',
    })
    .eq('lead_id', leadId)
    .eq('campaign_id', campaignId)
    .eq('status', 'queued')

  if (currentStepNumber !== null) {
    // Join through campaign_steps to filter step_number
    // Since we can't easily join in a simple update, we first fetch the step IDs
    const { data: laterSteps } = await supabaseAdmin
      .from('campaign_steps')
      .select('id')
      .eq('campaign_id', campaignId)
      .gt('order', currentStepNumber)

    if (laterSteps && laterSteps.length > 0) {
      const stepIds = laterSteps.map((s: { id: string }) => s.id)
      updateQuery = supabaseAdmin
        .from('sends')
        .update({
          status: 'cancelled_stop_on_reply',
          error_reason: 'lead_replied',
        })
        .eq('lead_id', leadId)
        .eq('campaign_id', campaignId)
        .eq('status', 'queued')
        .in('campaign_step_id', stepIds)
    }
  }

  await updateQuery

  // Tell Smartlead to stop autonomous progression
  // Calls smartlead-campaign with action=mark_replied
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  try {
    await fetch(`${supabaseUrl}/functions/v1/smartlead-campaign`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'mark_replied', lead_id: leadId, campaign_id: campaignId }),
    })
  } catch (err) {
    // Non-fatal: log but don't fail classification
    console.warn('[classify-reply] markLeadReplied failed:', String(err))
  }
}

// ---------------------------------------------------------------------------
// Trigger store-and-notify for this reply
// ---------------------------------------------------------------------------

async function triggerStoreAndNotify(replyId: string): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  try {
    await fetch(`${supabaseUrl}/functions/v1/store-and-notify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reply_id: replyId }),
    })
  } catch (err) {
    console.warn('[classify-reply] store-and-notify trigger failed:', String(err))
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
    const body = await req.json() as { reply_id?: string }
    const { reply_id: replyId } = body

    if (!replyId) return json({ success: false, error: 'reply_id required' }, 400)

    // ---- Load reply ----
    const { data: reply, error: replyErr } = await supabaseAdmin
      .from('replies')
      .select(`
        id, lead_id, campaign_id, in_reply_to_send_id,
        subject, body_text, from_email, from_name,
        classification, requires_human_review,
        campaigns(id, name, team_email, smartlead_campaign_id)
      `)
      .eq('id', replyId)
      .single()

    if (replyErr || !reply) {
      return json({ success: false, error: `Reply not found: ${replyErr?.message}` }, 404)
    }

    // Skip if already classified (idempotency)
    if (reply.classification) {
      return json({ success: true, skipped: true, classification: reply.classification })
    }

    // ---- Load send row for step number (stop-on-reply) ----
    let currentStepNumber: number | null = null
    if (reply.in_reply_to_send_id) {
      const { data: sendRow } = await supabaseAdmin
        .from('sends')
        .select('campaign_step_id, campaign_steps(order)')
        .eq('id', reply.in_reply_to_send_id)
        .maybeSingle()

      if (sendRow?.campaign_steps) {
        const steps = sendRow.campaign_steps as { order: number } | { order: number }[]
        const step = Array.isArray(steps) ? steps[0] : steps
        currentStepNumber = step?.order ?? null
      }
    }

    // ---- Stage 1: keyword pre-classifier ----
    const stage1 = keywordClassify({
      subject: reply.subject ?? '',
      body: reply.body_text ?? '',
    })

    let classification: Classification | KeywordClassification | null = stage1

    // ---- Stage 2: LLM classifier (only if stage 1 returned null) ----
    if (!classification) {
      const redactedBody = redactPII(reply.body_text ?? '').slice(0, 200)
      classification = await classifyReplyWithCircuit(
        supabaseAdmin,
        {
          id: reply.id,
          subject: reply.subject ?? '',
          body_text: reply.body_text ?? '',
          from_email: reply.from_email ?? undefined,
          from_name: reply.from_name ?? undefined,
        },
        redactedBody,
      )
    }

    // ---- Persist result ----
    if (classification) {
      const llmClassification = classification as Classification
      await supabaseAdmin
        .from('replies')
        .update({
          classification: classification.label,
          classifier_confidence: classification.confidence,
          classifier_error: null,
          language: llmClassification.language ?? null,
          classifier_rationale: llmClassification.rationale ?? null,
          requires_human_review: false,
        })
        .eq('id', replyId)
    }
    // If classification is null, classifyReplyWithCircuit already wrote requires_human_review=true

    // ---- Side effects ----
    if (classification) {
      const label = classification.label

      // a. Unsubscribe: insert suppression + update lead + stop Smartlead
      if (label === 'unsubscribe') {
        // Load lead email for normalization
        const { data: lead } = await supabaseAdmin
          .from('leads')
          .select('id, email, email_normalized')
          .eq('id', reply.lead_id)
          .maybeSingle()

        if (lead) {
          const emailNorm = lead.email_normalized ?? lead.email.toLowerCase().trim()
          // Insert unsubscribe (ignore conflict — idempotent)
          await supabaseAdmin
            .from('unsubscribes')
            .upsert(
              {
                email: lead.email,
                email_normalized: emailNorm,
                reason: 'unsubscribe',
                lead_id: reply.lead_id,
                source_event_id: `reply:${replyId}`,
              },
              { onConflict: 'email_normalized' },
            )

          // Update lead unsubscribed_at
          await supabaseAdmin
            .from('leads')
            .update({ unsubscribed_at: new Date().toISOString() })
            .eq('id', reply.lead_id)
        }

        // Stop Smartlead progression + cancel queued sends
        await applyStopOnReply(reply.lead_id, reply.campaign_id, currentStepNumber)
      }

      // b. Stop-on-reply for all non-null classifications EXCEPT negative with low confidence
      const isLowConfidenceNegative = label === 'negative' && classification.confidence <= 0.8
      if (!isLowConfidenceNegative && label !== 'unsubscribe') {
        // unsubscribe already handled above
        await applyStopOnReply(reply.lead_id, reply.campaign_id, currentStepNumber)
      }

      // c/d. Trigger store-and-notify for classifications that warrant team alert
      //   positive: always notify + fub-push (store-and-notify handles fub-push)
      //   neutral/ooo with requires_human_review: notify (handled in store-and-notify)
      //   unsubscribe: suppress only, store-and-notify will check label and skip team email
      //   negative: no notification
      const shouldNotify =
        label === 'positive' ||
        label === 'unsubscribe' ||  // for audit log; store-and-notify skips team email
        (label === 'neutral' && (reply.requires_human_review ?? false)) ||
        (label === 'ooo' && (reply.requires_human_review ?? false))

      if (shouldNotify) {
        await triggerStoreAndNotify(replyId)
      }
    }

    return json({
      success: true,
      classification: classification?.label ?? null,
      confidence: classification?.confidence ?? null,
      requires_human_review: classification === null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[classify-reply] Unhandled error:', message)
    await writeAlert(supabaseAdmin, {
      type: 'error',
      source: 'classify-reply',
      message: `Unhandled error in classify-reply: ${message}`,
      details: { error: message },
    })
    return json({ success: false, error: message }, 500)
  }
})
