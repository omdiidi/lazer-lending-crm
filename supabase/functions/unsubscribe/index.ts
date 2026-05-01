import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { token, email } = await req.json()
    if (!token || !email) {
      return new Response(JSON.stringify({ error: 'Token and email are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check if already unsubscribed
    const { data: existing } = await supabaseAdmin.from('unsubscribes')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existing) {
      return new Response(JSON.stringify({ success: true, already: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Find the lead by email
    const { data: lead } = await supabaseAdmin.from('leads')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    // Insert unsubscribe record
    const { error: insertErr } = await supabaseAdmin.from('unsubscribes').insert({
      lead_id: lead?.id || null,
      email,
      token,
    })

    if (insertErr) {
      // Unique constraint on token — might be a duplicate
      if (insertErr.code === '23505') {
        return new Response(JSON.stringify({ success: true, already: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      throw insertErr
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('unsubscribe error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
