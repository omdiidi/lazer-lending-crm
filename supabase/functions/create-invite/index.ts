import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Verify caller is admin
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse(401, 'Unauthorized')
    const jwt = authHeader.replace('Bearer ', '')
    const { data: { user: authUser } } = await supabaseAdmin.auth.getUser(jwt)
    if (!authUser) return errorResponse(401, 'Unauthorized')

    const { data: callerProfile } = await supabaseAdmin.from('profiles')
      .select('role').eq('id', authUser.id).single()
    if (callerProfile?.role !== 'admin') return errorResponse(403, 'Admin access required')

    const { name, email, role } = await req.json()
    if (!name || !email || !role) return errorResponse(400, 'Name, email, and role are required')
    if (!['admin', 'employee'].includes(role)) return errorResponse(400, 'Role must be admin or employee')

    // Check email not already in use
    const { data: existingProfile } = await supabaseAdmin.from('profiles')
      .select('id').eq('email', email).maybeSingle()
    if (existingProfile) return errorResponse(409, 'Email already in use by an existing team member')

    // Check no pending invite for this email
    const { data: existingInvite } = await supabaseAdmin.from('invites')
      .select('id').eq('email', email).eq('used', false).maybeSingle()
    if (existingInvite) return errorResponse(409, 'A pending invite already exists for this email')

    // Generate token: 128 bits of entropy (32 hex chars)
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('')

    // Insert invite (expires in 72 hours)
    const expires_at = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
    const { error: insertErr } = await supabaseAdmin.from('invites').insert({
      email, name, role, token, expires_at, created_by: authUser.id,
    })
    if (insertErr) return errorResponse(500, insertErr.message)

    return new Response(JSON.stringify({ token }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('create-invite error:', err)
    return errorResponse(500, (err as Error).message || 'Internal server error')
  }
})
