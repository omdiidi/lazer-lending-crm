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

    const { token, password } = await req.json()
    if (!token || !password) return errorResponse(400, 'Token and password are required')
    if (password.length < 8) return errorResponse(400, 'Password must be at least 8 characters')

    // Atomically claim the invite: mark used BEFORE creating user
    const { data: invite, error: claimErr } = await supabaseAdmin.from('invites')
      .update({ used: true })
      .eq('token', token)
      .eq('used', false)
      .select('*')
      .single()

    if (claimErr || !invite) return errorResponse(404, 'Invalid or already used invite token')

    if (new Date(invite.expires_at) < new Date()) {
      // Expired — un-claim it
      await supabaseAdmin.from('invites').update({ used: false }).eq('id', invite.id)
      return errorResponse(410, 'Invite token has expired')
    }

    // Create auth user with metadata
    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: invite.email,
      password,
      email_confirm: true,
      user_metadata: { name: invite.name, role: invite.role },
    })

    if (createErr) {
      // Rollback: un-claim the invite
      await supabaseAdmin.from('invites').update({ used: false }).eq('id', invite.id)
      return errorResponse(500, createErr.message)
    }

    // Set email_prefix on profile (trigger is synchronous — profile should exist)
    // Retry once if trigger hasn't fired yet
    const { error: updateErr } = await supabaseAdmin.from('profiles')
      .update({ email_prefix: invite.email.split('@')[0] })
      .eq('id', newUser.user.id)

    if (updateErr) {
      await new Promise(r => setTimeout(r, 500))
      await supabaseAdmin.from('profiles')
        .update({ email_prefix: invite.email.split('@')[0] })
        .eq('id', newUser.user.id)
    }

    return new Response(JSON.stringify({
      success: true,
      email: invite.email,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('signup-with-token error:', err)
    return errorResponse(500, (err as Error).message || 'Internal server error')
  }
})
