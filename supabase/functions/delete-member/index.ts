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

    const { userId } = await req.json()
    if (!userId) return errorResponse(400, 'userId is required')

    // Can't delete yourself
    if (userId === authUser.id) return errorResponse(400, 'Cannot delete your own account')

    // Delete auth user — profile cascade-deletes via FK
    // FKs on leads, deals, etc. are SET NULL so they won't block deletion
    const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (deleteErr) return errorResponse(500, deleteErr.message)

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('delete-member error:', err)
    return errorResponse(500, (err as Error).message || 'Internal server error')
  }
})
