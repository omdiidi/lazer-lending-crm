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
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  let user
  try {
    user = await resolveUser(req.headers.get('Authorization'), supabaseAdmin)
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  const leadId = url.searchParams.get('leadId')
  const method = req.method

  try {
    // GET /api-leads?leadId=xxx — list emails for a lead
    if (method === 'GET' && leadId) {
      let query = supabaseAdmin.from('emails')
        .select('*')
        .eq('lead_id', leadId)
        .is('deleted_at', null)
        .order('sent_at', { ascending: false })
      if (user.role !== 'admin') query = query.eq('user_id', user.id)
      const { data, error } = await query
      if (error) throw error
      return json(data)
    }

    // GET /api-leads — list
    if (method === 'GET' && !id) {
      const status = url.searchParams.get('status')
      const q = url.searchParams.get('q')
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)

      let query = supabaseAdmin.from('leads')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (user.role !== 'admin') query = query.or(`assigned_to.eq.${user.id},assigned_to.is.null`)
      if (status) query = query.eq('status', status)
      if (q) query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,company.ilike.%${q}%`)

      const { data, error } = await query
      if (error) throw error
      return json(data)
    }

    // GET /api-leads?id=xxx — get single
    if (method === 'GET' && id) {
      const { data, error } = await supabaseAdmin.from('leads').select('*').eq('id', id).single()
      if (error) throw error
      return json(data)
    }

    // POST — create or bulk import
    if (method === 'POST') {
      const body = await req.json()
      if (Array.isArray(body)) {
        // Bulk import — admin preserves assigned_to from payload; non-admin always self-assigns
        const rows = body.map((l: Record<string, unknown>) => ({
          ...l,
          assigned_to: user.role === 'admin' ? (l.assigned_to ?? null) : user.id,
        }))
        const { data, error } = await supabaseAdmin.from('leads').insert(rows).select()
        if (error) throw error
        return json(data, 201)
      }
      // Single create — admin can pass assigned_to; non-admin always self-assigns
      const { data, error } = await supabaseAdmin.from('leads')
        .insert({ ...body, assigned_to: user.role === 'admin' ? (body.assigned_to ?? null) : user.id })
        .select().single()
      if (error) throw error
      return json(data, 201)
    }

    // PATCH /api-leads?id=xxx — update
    if (method === 'PATCH' && id) {
      const body = await req.json()
      const { data, error } = await supabaseAdmin.from('leads')
        .update(body).eq('id', id).select().single()
      if (error) throw error
      return json(data)
    }

    // DELETE /api-leads?id=xxx — soft delete
    if (method === 'DELETE' && id) {
      const { error } = await supabaseAdmin.from('leads')
        .update({ deleted_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      return json({ success: true })
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
