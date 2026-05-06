/**
 * fub-push Edge Function
 *
 * Accepts: { reply_id: string }
 *
 * Pushes a qualified positive reply to Follow Up Boss via POST /v1/events.
 *
 * Idempotency: skip if replies.fub_pushed_at IS NOT NULL.
 *
 * Payload shape per VENDOR-CONTRACTS.md §4:
 *   occurredAt = replies.notified_at (NOT received_at — Smartlead reply lag can push
 *     received_at >24h in the past, which silently disables FUB automations per P4).
 *   source = FUB_DEFAULT_SOURCE_LABEL env var.
 *   stage = FUB_DEFAULT_STAGE_NAME env var (stage NAME, not ID — P9).
 *   tags = ['cold-reply', 'cold-reply-{campaign_slug}', 'lazer-crm', 'classified-{label}']
 *   message = first sentence of redacted body, truncated to 200 chars.
 *
 * After event push:
 *   201 → new person: update leads.fub_id + leads.fub_pushed_at + replies.fub_pushed_at + replies.fub_event_id
 *   200 → existing: update leads.fub_id if null + replies.fub_pushed_at
 *   204 → FubArchived: ops alert + write replies.fub_pushed_at (records attempt)
 *
 * After event push succeeds (200 or 201): call fubClient.addNote with sanitized note.
 *
 * Called by: store-and-notify (for positive replies only)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { writeAlert } from '../_shared/alerts.ts'
import { FubClient, FubArchived, FubRateLimited, type FubEventPayload } from '../_shared/fub.ts'

// ---------------------------------------------------------------------------
// Supabase admin client
// ---------------------------------------------------------------------------

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Slugify a campaign name to a URL-safe tag suffix. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

/** PII redaction (inline — avoids cross-runtime browser-TS import). */
const CARD_RE = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;
const ITIN_RE = /\b9\d{2}-\d{2}-\d{4}\b/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
const EMAIL_ADDR_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

function redactPII(text: string): string {
  return text
    .replace(CARD_RE, '[REDACTED]')
    .replace(ITIN_RE, '[REDACTED]')
    .replace(SSN_RE, '[REDACTED]')
    .replace(PHONE_RE, '[REDACTED]')
    .replace(EMAIL_ADDR_RE, '[REDACTED]')
}

function firstSentence(text: string, maxChars = 200): string {
  const sentence = text.split(/[.!?]/)[0] ?? text
  return sentence.slice(0, maxChars)
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

    // ---- Load reply + lead + campaign ----
    const { data: reply, error: replyErr } = await supabaseAdmin
      .from('replies')
      .select(`
        id, lead_id, campaign_id,
        subject, body_text, from_email, from_name,
        classification, classifier_confidence,
        notified_at, fub_pushed_at,
        campaigns(id, name, team_email)
      `)
      .eq('id', replyId)
      .single()

    if (replyErr || !reply) {
      return json({ success: false, error: `Reply not found: ${replyErr?.message}` }, 404)
    }

    // ---- Idempotency check ----
    if (reply.fub_pushed_at) {
      return json({ success: true, skipped: true, reason: 'Already pushed to FUB' })
    }

    // ---- Only push positive classifications ----
    if (reply.classification !== 'positive') {
      return json({
        success: false,
        error: `Cannot push to FUB: classification is '${reply.classification}', expected 'positive'`,
      }, 400)
    }

    // ---- Load lead ----
    const { data: lead, error: leadErr } = await supabaseAdmin
      .from('leads')
      .select('id, first_name, last_name, email, email_normalized, phone, fub_id')
      .eq('id', reply.lead_id)
      .single()

    if (leadErr || !lead) {
      return json({ success: false, error: `Lead not found: ${leadErr?.message}` }, 404)
    }

    const campaign = reply.campaigns as { id: string; name: string; team_email: string | null } | null

    // ---- Build FUB event payload ----
    const sourceLabel =
      Deno.env.get('FUB_DEFAULT_SOURCE_LABEL') ?? 'Lazer Lending CRM Cold Outreach'
    const defaultStage = Deno.env.get('FUB_DEFAULT_STAGE_NAME') ?? 'Lead'
    const appBaseUrl = Deno.env.get('APP_BASE_URL') ?? 'https://crm.lazerlending.com'

    // occurredAt = notified_at (not received_at) — prevents >24h gap issue (P4)
    const occurredAt = reply.notified_at
      ? new Date(reply.notified_at as string).toISOString()
      : new Date().toISOString()

    const emailNorm = lead.email_normalized ?? lead.email.toLowerCase().trim()
    const redactedBody = redactPII(reply.body_text ?? '')
    const messageSummary = firstSentence(redactedBody, 200)
    const campaignSlug = slugify(campaign?.name ?? 'unknown')

    const payload: FubEventPayload = {
      source: sourceLabel,
      type: 'General Inquiry',
      occurredAt,
      message: messageSummary,
      uri: `${appBaseUrl}/replies/${replyId}`,
      person: {
        firstName: lead.first_name ?? undefined,
        lastName: lead.last_name ?? undefined,
        emails: [{ type: 'work', value: emailNorm }],
        phones: lead.phone ? [{ type: 'work', value: lead.phone }] : [],
        stage: defaultStage,
        tags: [
          'cold-reply',
          `cold-reply-${campaignSlug}`,
          'lazer-crm',
          `classified-${reply.classification}`,
        ],
      },
    }

    const fub = new FubClient()
    const now = new Date().toISOString()

    // ---- Push to FUB ----
    let fubResult
    try {
      fubResult = await fub.pushEvent(payload)
    } catch (err) {
      if (err instanceof FubArchived) {
        // 204 = FUB silently archived — record the attempt but alert ops
        await supabaseAdmin
          .from('replies')
          .update({ fub_pushed_at: now })
          .eq('id', replyId)

        await writeAlert(supabaseAdmin, {
          type: 'warning',
          source: 'fub-push',
          message: `FUB suppressed lead silently for reply ${replyId} — investigate FUB routing rules`,
          details: { reply_id: replyId, lead_id: reply.lead_id, email: emailNorm },
        })
        return json({ success: true, status: 204, archived: true, warning: 'FUB suppressed the lead push (HTTP 204)' })
      }

      if (err instanceof FubRateLimited) {
        // 429 — let caller handle retry
        return json({ success: false, error: 'FUB rate limited', retry_after_ms: err.retryAfterMs }, 429)
      }

      throw err
    }

    // ---- Persist results ----
    if (fubResult.status === 201) {
      // New person created
      await supabaseAdmin
        .from('leads')
        .update({ fub_id: String(fubResult.person_id ?? ''), fub_pushed_at: now })
        .eq('id', lead.id)
    } else if (fubResult.status === 200) {
      // Existing person updated — only update fub_id if we didn't have one
      if (!lead.fub_id && fubResult.person_id) {
        await supabaseAdmin
          .from('leads')
          .update({ fub_id: String(fubResult.person_id) })
          .eq('id', lead.id)
      }
    }

    await supabaseAdmin
      .from('replies')
      .update({
        fub_pushed_at: now,
        fub_event_id: fubResult.event_id ? String(fubResult.event_id) : null,
      })
      .eq('id', replyId)

    // ---- Add note to FUB person (sanitized — no raw body) ----
    if (fubResult.person_id) {
      const personId = fubResult.person_id
      const noteBody = [
        `Campaign: ${campaign?.name ?? 'Unknown'}`,
        `Classified: POSITIVE (confidence: ${(reply.classifier_confidence as number | null)?.toFixed(2) ?? 'n/a'})`,
        `First sentence (redacted): "${messageSummary}"`,
        `View full reply: ${appBaseUrl}/replies/${replyId}`,
        `Classified by: Lazer CRM on ${new Date().toISOString()}`,
      ].join('\n')

      try {
        await fub.addNote({
          personId,
          subject: `Cold reply classified POSITIVE — Lazer CRM`,
          body: noteBody,
        })
      } catch (noteErr) {
        // Non-fatal: log but don't fail the push
        console.warn('[fub-push] addNote failed:', String(noteErr))
        await writeAlert(supabaseAdmin, {
          type: 'warning',
          source: 'fub-push',
          message: `FUB addNote failed for reply ${replyId}: ${String(noteErr).slice(0, 200)}`,
          details: { reply_id: replyId, person_id: personId },
        })
      }
    }

    return json({
      success: true,
      fub_status: fubResult.status,
      person_id: fubResult.person_id,
      event_id: fubResult.event_id,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[fub-push] Unhandled error:', message)
    await writeAlert(supabaseAdmin, {
      type: 'error',
      source: 'fub-push',
      message: `Unhandled error: ${message}`,
      details: { error: message },
    })
    return json({ success: false, error: message }, 500)
  }
})
