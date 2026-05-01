import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveUser, sha256 } from '../_shared/auth.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  let user
  try {
    user = await resolveUser(req.headers.get('Authorization'), supabaseAdmin, true) // jwtOnly
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  try {
    const body = await req.json()
    const name = body?.name?.trim()
    if (!name) {
      return new Response(JSON.stringify({ error: 'name is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Generate key server-side using two UUIDs (uniform distribution)
    const random = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '').slice(0, 32)
    const key = `crm_${random}`
    const hash = await sha256(key)
    const preview = `crm_...${key.slice(-4)}`

    const { error } = await supabaseAdmin.from('api_keys').insert({
      user_id: user.id,
      name,
      key_hash: hash,
      key_preview: preview,
    })

    if (error) throw error

    // Plaintext key returned ONCE — never stored
    return new Response(JSON.stringify({ key }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
