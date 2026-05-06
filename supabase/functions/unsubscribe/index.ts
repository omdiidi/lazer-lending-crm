/**
 * Unsubscribe Edge Function
 *
 * Handles both:
 *   1. HMAC stateless tokens (new path — Smartlead cold campaign links)
 *   2. Legacy UUID DB-lookup tokens (pre-Lazer Connect CRM campaigns)
 *
 * RFC 8058 compliance:
 *   - POST body must contain List-Unsubscribe=One-Click (per Gmail's enforcement)
 *   - GET is also accepted for direct browser clicks (returns 200 or redirect)
 *   - Both paths are CSRF-bypassed and unauthenticated
 *   - Re-submits return 200 (idempotent) — Gmail prefetchers POST multiple times
 *
 * Token query param: ?t=<token>
 *   HMAC token:  base64url(payload).base64url(hmac_sha256)
 *   Legacy UUID: raw UUID string (no dot separator)
 */

import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyUnsubToken } from '../_shared/list-unsub-token.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

function normalizeEmail(email: string): string {
  const trimmed = email.toLowerCase().trim()
  const atIdx = trimmed.indexOf('@')
  if (atIdx === -1) return trimmed
  const local = trimmed.slice(0, atIdx).replace(/\+.*$/, '')
  const domain = trimmed.slice(atIdx)
  return local + domain
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Shared: insert-or-ignore into unsubscribes and stamp the lead
// ---------------------------------------------------------------------------

async function recordUnsub(params: {
  email: string
  email_normalized: string
  lead_id: string | null
  campaign_id: string | null
  token: string
  source_event_id: string
}): Promise<void> {
  const { error } = await supabaseAdmin.from('unsubscribes').insert({
    email:           params.email,
    email_normalized: params.email_normalized,
    reason:          'unsubscribe',
    source_event_id: params.source_event_id,
    lead_id:         params.lead_id,
    token:           params.token,
  })
  // 23505 = unique violation (already suppressed) — silent success
  if (error && error.code !== '23505') {
    throw error
  }

  // Stamp lead.unsubscribed_at if we have a lead_id
  if (params.lead_id) {
    await supabaseAdmin
      .from('leads')
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq('id', params.lead_id)
      .is('unsubscribed_at', null) // idempotent — only set once
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // RFC 8058: POST with List-Unsubscribe=One-Click in body (Gmail one-click path)
    // GET: direct browser click on the unsubscribe link
    const url = new URL(req.url)
    const token = url.searchParams.get('t') ?? ''

    if (!token) {
      // Legacy path compatibility: body may contain {token, email} (old Connect CRM format)
      if (req.method === 'POST') {
        const body = await req.json().catch(() => ({})) as { token?: string; email?: string }
        if (!body.token || !body.email) {
          return json({ error: 'Token and email are required' }, 400)
        }
        return handleLegacyBody(body.token, body.email)
      }
      return json({ error: 'Missing token parameter' }, 400)
    }

    // RFC 8058 POST: must contain List-Unsubscribe=One-Click for one-click path.
    // GET is allowed for human browser clicks.
    if (req.method === 'POST') {
      let bodyText = ''
      try { bodyText = await req.text() } catch { /* empty body ok */ }
      if (!bodyText.includes('List-Unsubscribe=One-Click')) {
        return json({ error: 'RFC 8058: body must contain List-Unsubscribe=One-Click' }, 400)
      }
    }

    const LIST_UNSUB_TOKEN_SECRET = Deno.env.get('LIST_UNSUB_TOKEN_SECRET')

    // --- Path 1: Try HMAC token first ---
    if (LIST_UNSUB_TOKEN_SECRET && token.includes('.')) {
      const payload = await verifyUnsubToken(token, LIST_UNSUB_TOKEN_SECRET)
      if (payload) {
        // HMAC tokens carry their own expiry. We do NOT reject expired tokens here
        // (CAN-SPAM: outstanding links must still work). We just record the unsub.
        // Opt-back-in flows (future) would need to check expiry.

        const emailNorm = normalizeEmail(payload.email)
        await recordUnsub({
          email:           payload.email,
          email_normalized: emailNorm,
          lead_id:         payload.lead_id,
          campaign_id:     payload.campaign_id,
          token,
          source_event_id: `hmac:${payload.lead_id}:${payload.campaign_id}`,
        })
        return json({ success: true })
      }
      // HMAC verification failed — fall through to legacy UUID path
    }

    // --- Path 2: Legacy UUID DB lookup ---
    const email = url.searchParams.get('email') ?? ''
    return handleLegacyToken(token, email)
  } catch (err) {
    console.error('unsubscribe error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Legacy body handler (old Connect CRM format: POST {token, email})
// ---------------------------------------------------------------------------

async function handleLegacyBody(token: string, email: string): Promise<Response> {
  // Check already unsubscribed
  const { data: existing } = await supabaseAdmin
    .from('unsubscribes')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existing) {
    return new Response(JSON.stringify({ success: true, already: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: lead } = await supabaseAdmin.from('leads')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  const emailNorm = normalizeEmail(email)
  const { error: insertErr } = await supabaseAdmin.from('unsubscribes').insert({
    lead_id:         lead?.id ?? null,
    email,
    email_normalized: emailNorm,
    reason:          'unsubscribe',
    token,
  })

  if (insertErr) {
    if (insertErr.code === '23505') {
      return new Response(JSON.stringify({ success: true, already: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    throw insertErr
  }

  if (lead?.id) {
    await supabaseAdmin
      .from('leads')
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq('id', lead.id)
      .is('unsubscribed_at', null)
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Legacy token handler (query-param path ?t=<uuid>&email=<addr>)
// ---------------------------------------------------------------------------

async function handleLegacyToken(token: string, email: string): Promise<Response> {
  const { data: legacy } = await supabaseAdmin
    .from('unsubscribes')
    .select('id, email, email_normalized, reason, lead_id')
    .eq('token', token)
    .maybeSingle()

  if (!legacy) {
    return new Response(JSON.stringify({ error: 'Token not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Backfill email_normalized on first encounter (cycle 1 #10 fix)
  if (!legacy.email_normalized && legacy.email) {
    await supabaseAdmin
      .from('unsubscribes')
      .update({
        email_normalized: normalizeEmail(legacy.email),
        reason:           legacy.reason ?? 'unsubscribe',
      })
      .eq('id', legacy.id)
  }

  // Idempotent — already recorded
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
