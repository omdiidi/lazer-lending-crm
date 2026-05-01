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
  const threadId = url.searchParams.get('threadId')
  const threads = url.searchParams.get('threads')
  const limitParam = url.searchParams.get('limit')
  const method = req.method

  try {
    // GET ?threads=1 — list thread summaries
    if (method === 'GET' && threads) {
      const folder = url.searchParams.get('folder') ?? 'all'
      let query = supabaseAdmin.from('emails')
        .select('*')
        .is('deleted_at', null)
        .order('sent_at', { ascending: false })
      if (limitParam) query = query.limit(Number(limitParam) * 5) // fetch extra to account for dedup
      if (user.role !== 'admin') query = query.eq('user_id', user.id)
      if (folder === 'inbox') query = query.eq('direction', 'inbound')
      if (folder === 'sent') query = query.eq('direction', 'outbound')
      const { data, error } = await query
      if (error) throw error
      // Deduplicate by thread_id — keep first (most recent) per thread
      const seen = new Set<string>()
      let threadList = (data ?? []).filter(e => {
        const key = e.thread_id ?? e.id
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      if (limitParam) threadList = threadList.slice(0, Number(limitParam))
      return json(threadList)
    }

    // GET ?threadId=xxx — get full thread
    if (method === 'GET' && threadId) {
      const { data, error } = await supabaseAdmin.from('emails')
        .select('*')
        .eq('thread_id', threadId)
        .is('deleted_at', null)
        .order('sent_at', { ascending: true })
      if (error) throw error
      return json(data)
    }

    // GET ?id=xxx — get single
    if (method === 'GET' && id) {
      const { data, error } = await supabaseAdmin.from('emails').select('*').eq('id', id).single()
      if (error) throw error
      return json(data)
    }

    // GET — list emails
    if (method === 'GET') {
      const folder = url.searchParams.get('folder') ?? 'all'
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
      let query = supabaseAdmin.from('emails')
        .select('*')
        .is('deleted_at', null)
        .order('sent_at', { ascending: false })
        .limit(limit)
      if (user.role !== 'admin') query = query.eq('user_id', user.id)
      if (folder === 'inbox') query = query.eq('direction', 'inbound')
      if (folder === 'sent') query = query.eq('direction', 'outbound')
      const { data, error } = await query
      if (error) throw error
      return json(data)
    }

    // PATCH ?id=xxx — mark read/unread
    if (method === 'PATCH' && id) {
      const body = await req.json()
      const { data, error } = await supabaseAdmin.from('emails')
        .update({ read: body.read }).eq('id', id).select().single()
      if (error) throw error
      return json(data)
    }

    // DELETE ?id=xxx — soft delete
    if (method === 'DELETE' && id) {
      const { error } = await supabaseAdmin.from('emails')
        .update({ deleted_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      return json({ success: true })
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
