import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Auth: accept either CLEANUP_SECRET Bearer token (for pg_cron) or admin JWT (for UI button)
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const CLEANUP_SECRET = Deno.env.get('CLEANUP_SECRET')

  let authorized = !!(CLEANUP_SECRET && token === CLEANUP_SECRET)

  if (!authorized) {
    try {
      const { data: { user } } = await supabaseAdmin.auth.getUser(token)
      if (user) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()
        authorized = profile?.role === 'admin'
      }
    } catch {
      // invalid JWT — stay unauthorized
    }
  }

  if (!authorized) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  }

  // Unassign all non-warm leads that currently have an assigned_to value
  const { data, error } = await supabaseAdmin
    .from('leads')
    .update({ assigned_to: null })
    .neq('status', 'warm')
    .not('assigned_to', 'is', null)
    .is('deleted_at', null)
    .select('id')

  if (error) {
    console.error('Cleanup failed:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  console.log(`Cleanup complete: ${data?.length ?? 0} leads unassigned`)

  return new Response(
    JSON.stringify({ unassigned: data?.length ?? 0 }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
