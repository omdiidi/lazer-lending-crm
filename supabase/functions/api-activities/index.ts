import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveUser } from '../_shared/auth.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  let user
  try {
    user = await resolveUser(req.headers.get('Authorization'), supabaseAdmin)
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const url = new URL(req.url)
  const leadId = url.searchParams.get('leadId')
  const method = req.method

  try {
    // GET ?leadId=xxx — lead timeline (activities + emails merged, sorted by timestamp desc)
    if (method === 'GET' && leadId) {
      const [activitiesRes, emailsRes] = await Promise.all([
        supabaseAdmin
          .from('activities')
          .select('*')
          .eq('lead_id', leadId)
          .order('created_at', { ascending: false }),
        supabaseAdmin
          .from('emails')
          .select('*')
          .eq('lead_id', leadId)
          .is('deleted_at', null)
          .order('sent_at', { ascending: false }),
      ])

      if (activitiesRes.error) throw activitiesRes.error
      if (emailsRes.error) throw emailsRes.error

      const activities = (activitiesRes.data ?? []).map((a) => ({
        ...a,
        _type: 'activity',
        _timestamp: a.created_at,
      }))

      const emails = (emailsRes.data ?? []).map((e) => ({
        ...e,
        _type: 'email',
        _timestamp: e.sent_at,
      }))

      const timeline = [...activities, ...emails].sort(
        (a, b) => new Date(b._timestamp).getTime() - new Date(a._timestamp).getTime()
      )

      return json(timeline)
    }

    // POST — create activity
    if (method === 'POST') {
      const body = await req.json()

      const { data, error } = await supabaseAdmin
        .from('activities')
        .insert({
          type: body.type,
          description: body.description,
          lead_id: body.lead_id,
          metadata: body.metadata ?? null,
          user_id: user.id,
        })
        .select()
        .single()

      if (error) throw error
      return json(data, 201)
    }

    return json({ error: 'Not found' }, 404)
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
