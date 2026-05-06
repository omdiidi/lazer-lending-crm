/**
 * store-and-notify Edge Function
 *
 * Accepts: { reply_id: string }
 *
 * Per `notifyTeamOfReply` pseudocode (cycle 2 fix: uses `campaign.team_email`
 * not a `routing_rules` table — that table was dropped in plan cycle 1).
 *
 * Routing rules:
 *   - positive → send team email notification + trigger fub-push
 *   - neutral/ooo with requires_human_review = true → send team email notification only
 *   - unsubscribe → no team email (suppression was already handled in classify-reply);
 *     we log it here for audit purposes but do NOT email the team
 *   - negative → no action (caller should not invoke us for negative)
 *
 * Resend sends from RESEND_FROM_DEFAULT on notify.lazerlending.com.
 * NEVER forwards the raw body — only: classification, confidence, first sentence, CRM link.
 *
 * Updates: replies.notified_at + replies.notified_to
 *
 * Called by: classify-reply (fire-and-forget internal fetch)
 * Also calls: fub-push (for positive classifications only)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { writeAlert } from '../_shared/alerts.ts'

// ---------------------------------------------------------------------------
// Supabase admin client
// ---------------------------------------------------------------------------

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ---------------------------------------------------------------------------
// Resend helper
// ---------------------------------------------------------------------------

interface ResendPayload {
  from: string;
  to: string;
  subject: string;
  text: string;
}

async function sendViaResend(payload: ResendPayload): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) throw new Error('RESEND_API_KEY env var not set')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend API error ${res.status}: ${body.slice(0, 300)}`)
  }
}

// ---------------------------------------------------------------------------
// Trigger fub-push for positive replies
// ---------------------------------------------------------------------------

async function triggerFubPush(replyId: string): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/fub-push`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reply_id: replyId }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.warn(`[store-and-notify] fub-push returned ${res.status}: ${body.slice(0, 200)}`)
    }
  } catch (err) {
    // Non-fatal — log and continue
    console.warn('[store-and-notify] fub-push trigger failed:', String(err))
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

/** Extract first sentence, truncated to maxChars. */
function firstSentence(text: string, maxChars = 200): string {
  const sentence = text.split(/[.!?]/)[0] ?? text
  return sentence.slice(0, maxChars)
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

    // ---- Load reply + campaign ----
    const { data: reply, error: replyErr } = await supabaseAdmin
      .from('replies')
      .select(`
        id, lead_id, campaign_id,
        subject, body_text, from_email, from_name,
        classification, classifier_confidence,
        requires_human_review,
        notified_at,
        campaigns(id, name, team_email)
      `)
      .eq('id', replyId)
      .single()

    if (replyErr || !reply) {
      return json({ success: false, error: `Reply not found: ${replyErr?.message}` }, 404)
    }

    const label = reply.classification as string | null

    // ---- Routing decision ----
    // unsubscribe: log only, no team email
    // negative: should not be called for negative (caller responsibility) — silently skip
    // null classification: not classified yet — skip
    if (!label || label === 'negative') {
      return json({ success: true, skipped: true, reason: `No notification needed for label=${label}` })
    }

    if (label === 'unsubscribe') {
      // Audit-only path: no team email
      console.info(`[store-and-notify] Unsubscribe reply ${replyId} — suppression handled in classify-reply, no team email`)

      // Trigger fub-push is NOT needed for unsubscribes — they go to suppression list
      return json({ success: true, action: 'suppression_only' })
    }

    // neutral / ooo: only notify if requires_human_review = true
    if ((label === 'neutral' || label === 'ooo') && !reply.requires_human_review) {
      return json({ success: true, skipped: true, reason: `${label} without requires_human_review — no notification` })
    }

    // Idempotency: already notified
    if (reply.notified_at) {
      // Still trigger fub-push for positive in case it wasn't triggered yet
      if (label === 'positive') await triggerFubPush(replyId)
      return json({ success: true, skipped: true, reason: 'Already notified' })
    }

    // ---- Build notification ----
    const campaign = reply.campaigns as { id: string; name: string; team_email: string | null } | null
    const teamEmail =
      campaign?.team_email ??
      Deno.env.get('DEFAULT_REPLY_FORWARD_EMAIL') ??
      ''

    if (!teamEmail) {
      await writeAlert(supabaseAdmin, {
        type: 'warning',
        source: 'store-and-notify',
        message: `No team email configured for reply ${replyId} — cannot send notification`,
        details: { reply_id: replyId, campaign_id: reply.campaign_id },
      })
      return json({ success: false, error: 'No team email configured' }, 500)
    }

    const fromAddress = Deno.env.get('RESEND_FROM_DEFAULT') ?? 'alerts@notify.lazerlending.com'
    const appBaseUrl = Deno.env.get('APP_BASE_URL') ?? 'https://crm.lazerlending.com'
    const senderName = reply.from_name ?? reply.from_email ?? 'Unknown sender'
    const summary = firstSentence(reply.body_text ?? '')
    const confidence = reply.classifier_confidence
      ? ` (confidence: ${(reply.classifier_confidence as number).toFixed(2)})`
      : ''

    const emailSubject = `[${label.toUpperCase()}] ${senderName}: ${reply.subject ?? '(no subject)'}`
    const emailBody = [
      `Cold reply classified as ${label}${confidence}.`,
      `Sender: ${senderName}${reply.from_email ? ` <${reply.from_email}>` : ''}`,
      `Campaign: ${campaign?.name ?? 'Unknown campaign'}`,
      `First sentence: "${summary}"`,
      '',
      `View full reply (PII stays in our CRM): ${appBaseUrl}/replies/${replyId}`,
      '',
      label === 'neutral' || label === 'ooo'
        ? `Action required: This reply requires human review. Open the link above to classify it.`
        : '',
    ]
      .filter(l => l !== '')
      .join('\n')

    // ---- Send via Resend ----
    await sendViaResend({
      from: fromAddress,
      to: teamEmail,
      subject: emailSubject,
      text: emailBody,
    })

    // ---- Update reply: notified_at + notified_to ----
    await supabaseAdmin
      .from('replies')
      .update({
        notified_at: new Date().toISOString(),
        notified_to: teamEmail,
      })
      .eq('id', replyId)

    // ---- Trigger fub-push for positive classifications ----
    if (label === 'positive') {
      await triggerFubPush(replyId)
    }

    return json({ success: true, notified_to: teamEmail, fub_push_triggered: label === 'positive' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[store-and-notify] Unhandled error:', message)
    await writeAlert(supabaseAdmin, {
      type: 'error',
      source: 'store-and-notify',
      message: `Unhandled error: ${message}`,
      details: { error: message },
    })
    return json({ success: false, error: message }, 500)
  }
})
