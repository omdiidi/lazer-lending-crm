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
    // GET — list templates
    if (method === 'GET') {
      let query = supabaseAdmin
        .from('templates')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (user.role !== 'admin') {
        query = query.eq('created_by', user.id)
      }

      const { data, error } = await query
      if (error) throw error
      return json(data)
    }

    // POST — create template
    if (method === 'POST') {
      const body = await req.json()

      const { data, error } = await supabaseAdmin
        .from('templates')
        .insert({
          name: body.name,
          subject: body.subject,
          body: body.body,
          tags: body.tags ?? null,
          created_by: user.id,
        })
        .select()
        .single()

      if (error) throw error
      return json(data, 201)
    }

    // DELETE ?id=xxx — soft delete
    if (method === 'DELETE' && id) {
      const { error } = await supabaseAdmin
        .from('templates')
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
