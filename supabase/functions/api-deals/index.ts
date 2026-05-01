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
  const id = url.searchParams.get('id')
  const method = req.method

  try {
    // GET ?id=xxx — single deal
    if (method === 'GET' && id) {
      const { data, error } = await supabaseAdmin
        .from('deals')
        .select('*')
        .eq('id', id)
        .is('deleted_at', null)
        .single()

      if (error) throw error
      return json(data)
    }

    // GET — list deals
    if (method === 'GET') {
      const stage = url.searchParams.get('stage')

      let query = supabaseAdmin
        .from('deals')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (user.role !== 'admin') {
        query = query.eq('assigned_to', user.id)
      }

      if (stage) {
        query = query.eq('stage', stage)
      }

      const { data, error } = await query
      if (error) throw error
      return json(data)
    }

    // POST — create deal
    if (method === 'POST') {
      const body = await req.json()

      const { data, error } = await supabaseAdmin
        .from('deals')
        .insert({ ...body, assigned_to: user.id })
        .select()
        .single()

      if (error) throw error
      return json(data, 201)
    }

    // PATCH ?id=xxx — update deal
    if (method === 'PATCH' && id) {
      const body = await req.json()
      const updates: Record<string, unknown> = {}
      if (body.stage !== undefined) updates.stage = body.stage
      if (body.value !== undefined) updates.value = body.value
      if (body.title !== undefined) updates.title = body.title

      const { data, error } = await supabaseAdmin
        .from('deals')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return json(data)
    }

    // DELETE ?id=xxx — soft delete
    if (method === 'DELETE' && id) {
      const { error } = await supabaseAdmin
        .from('deals')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error
      return json({ success: true })
    }

    return json({ error: 'Not found' }, 404)
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
