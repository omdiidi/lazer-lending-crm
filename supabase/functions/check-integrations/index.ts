/**
 * check-integrations Edge Function
 *
 * Admin-only. Reports which vendor secrets are configured on the backend so the
 * Settings → Integrations panel can show real status instead of hardcoded
 * placeholders.
 *
 * SECURITY: returns booleans ONLY. Never echoes a secret value. A value is
 * considered "configured" when the env var is present and non-empty and not a
 * known placeholder string from .env.example.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveUser } from '../_shared/auth.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

/** True when an env var is set, non-empty, and not a leftover placeholder. */
function isConfigured(name: string): boolean {
  const v = Deno.env.get(name)
  if (!v) return false
  const trimmed = v.trim()
  if (trimmed === '') return false
  // Placeholders shipped in .env.example — treat as not configured.
  if (/^your_/i.test(trimmed)) return false
  if (trimmed.startsWith('generate_with_')) return false
  return true
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  let user
  try {
    user = await resolveUser(req.headers.get('Authorization'), supabaseAdmin)
  } catch (e) {
    return json({ error: (e as Error).message }, 401)
  }
  if (user.role !== 'admin') {
    return json({ error: 'Admin access required' }, 403)
  }

  const configured = {
    smartlead: isConfigured('SMARTLEAD_API_KEY'),
    smartlead_webhook: isConfigured('SMARTLEAD_WEBHOOK_SIGNING_SECRET'),
    zerobounce: isConfigured('ZEROBOUNCE_API_KEY'),
    resend: isConfigured('RESEND_API_KEY'),
    fub: isConfigured('FUB_API_KEY'),
    fub_system_key: isConfigured('FUB_X_SYSTEM_KEY'),
    openrouter: isConfigured('OPENROUTER_API_KEY'),
    list_unsub_secret: isConfigured('LIST_UNSUB_TOKEN_SECRET'),
  }

  return json({ configured })
})
