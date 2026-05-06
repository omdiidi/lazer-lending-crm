/**
 * fub-events Edge Function — FUB outbound webhook receiver
 *
 * Receives events from Follow Up Boss (FUB) when reps update records.
 * Registered via fub-register-webhooks.ts one-off script.
 *
 * Events handled:
 *   - peopleStageUpdated: log + persist for future classifier improvement signal
 *   - peopleCreated: low-priority log
 *
 * Security:
 *   Verifies FUB-Signature header: SHA256 of base64-encoded JSON body,
 *   keyed with FUB_X_SYSTEM_KEY env var.
 *
 * Idempotency:
 *   Inserts into webhook_events with (provider='fub', external_event_id=body.eventId).
 *   ON CONFLICT DO NOTHING — duplicate webhooks silently skipped.
 *
 * NOTE: In v1 we do not act on peopleStageUpdated beyond logging.
 * The signal is preserved for Phase 3 classifier improvement feedback loop.
 *
 * Webhook registration:
 *   Run scripts/fub-register-webhooks.ts after Phase 2 setup.
 *   Max 2 webhooks per event per system (FUB P6 constraint).
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
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify FUB-Signature header.
 *
 * FUB signs with: SHA256 HMAC of the base64-encoded raw JSON body,
 * keyed with X-System-Key.
 *
 * Format: "sha256=<hex_digest>" or just "<hex_digest>" — we accept both.
 */
async function verifyFubSignature(
  rawBody: string,
  signatureHeader: string | null,
  systemKey: string,
): Promise<boolean> {
  if (!signatureHeader) return false

  const sig = signatureHeader.replace(/^sha256=/, '')

  // FUB signs: HMAC-SHA256 of base64(rawBody) using X-System-Key
  const base64Body = btoa(rawBody)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(systemKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base64Body))
  const computed = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  // Constant-time comparison
  if (computed.length !== sig.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ sig.charCodeAt(i)
  }
  return diff === 0
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
// Event handlers
// ---------------------------------------------------------------------------

async function handlePeopleStageUpdated(eventData: Record<string, unknown>): Promise<void> {
  // v1: log only — this is a future classifier improvement signal.
  // The event data (personId, old stage, new stage) is already persisted
  // in webhook_events.payload_raw. No action needed beyond the log.
  console.info('[fub-events] peopleStageUpdated received — persisted for future feedback loop', {
    person_id: eventData?.person?.id ?? eventData?.personId,
    stage: eventData?.stage,
  })
}

async function handlePeopleCreated(eventData: Record<string, unknown>): Promise<void> {
  // Low-priority log — FUB creates people via our events pushes
  console.info('[fub-events] peopleCreated received', {
    person_id: eventData?.person?.id ?? eventData?.personId,
  })
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Only accept POST
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const systemKey = Deno.env.get('FUB_X_SYSTEM_KEY')
  if (!systemKey) {
    console.error('[fub-events] FUB_X_SYSTEM_KEY not set')
    return json({ error: 'Server configuration error' }, 500)
  }

  // Read raw body for signature verification
  const rawBody = await req.text()
  const signatureHeader = req.headers.get('FUB-Signature')

  // Verify signature
  const isValid = await verifyFubSignature(rawBody, signatureHeader, systemKey)
  if (!isValid) {
    console.warn('[fub-events] Invalid FUB-Signature — rejecting webhook')
    return json({ error: 'Invalid signature' }, 401)
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const eventId = payload.eventId as string | undefined
  const eventType = payload.event as string | undefined

  if (!eventId || !eventType) {
    return json({ error: 'Missing eventId or event field' }, 400)
  }

  // ---- Idempotency: insert into webhook_events, skip on conflict ----
  const { data: insertedRows, error: insertErr } = await supabaseAdmin
    .from('webhook_events')
    .insert({
      provider: 'fub',
      external_event_id: eventId,
      event_type: eventType,
      payload_raw: rawBody,
      received_at: new Date().toISOString(),
    })
    .select('id')

  if (insertErr) {
    // Unique constraint violation (23505) = duplicate — silently skip
    if (insertErr.code === '23505') {
      return json({ success: true, skipped: true, reason: 'duplicate' })
    }
    console.error('[fub-events] webhook_events insert error:', insertErr)
    return json({ error: insertErr.message }, 500)
  }

  if (!insertedRows || insertedRows.length === 0) {
    // ON CONFLICT DO NOTHING returned empty — duplicate
    return json({ success: true, skipped: true, reason: 'duplicate' })
  }

  const insertedId = (insertedRows[0] as { id: string }).id

  // ---- Dispatch ----
  try {
    const eventData = (payload.data ?? payload) as Record<string, unknown>

    switch (eventType) {
      case 'peopleStageUpdated':
        await handlePeopleStageUpdated(eventData)
        break
      case 'peopleCreated':
        await handlePeopleCreated(eventData)
        break
      default:
        // Unknown event type — log but don't fail
        console.info(`[fub-events] Unhandled event type: ${eventType}`)
    }

    // Mark processed
    await supabaseAdmin
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', insertedId)

    return json({ success: true, event_type: eventType })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[fub-events] Dispatch error:', message)

    // Update last_error but keep processed_at null so sweeper can retry
    await supabaseAdmin
      .from('webhook_events')
      .update({ last_error: message.slice(0, 500) })
      .eq('id', insertedId)

    await writeAlert(supabaseAdmin, {
      type: 'error',
      source: 'fub-events',
      message: `Dispatch error for event ${eventId} (${eventType}): ${message}`,
      details: { event_id: eventId, event_type: eventType, error: message },
    })

    return json({ error: message }, 500)
  }
})
