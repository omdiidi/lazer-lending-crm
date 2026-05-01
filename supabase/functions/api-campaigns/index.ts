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
  const stats = url.searchParams.get('stats')
  const action = url.searchParams.get('action')
  const method = req.method

  try {
    // GET ?stats=xxx — campaign enrollment + email engagement stats
    if (method === 'GET' && stats) {
      const [enrollmentsRes, emailsRes] = await Promise.all([
        supabaseAdmin
          .from('campaign_enrollments')
          .select('status')
          .eq('campaign_id', stats),
        supabaseAdmin
          .from('emails')
          .select('opened_at, clicked_at, bounced_at')
          .eq('campaign_id', stats)
          .eq('direction', 'outbound'),
      ])

      if (enrollmentsRes.error) throw enrollmentsRes.error
      if (emailsRes.error) throw emailsRes.error

      const enrollmentCounts: Record<string, number> = {}
      for (const e of enrollmentsRes.data ?? []) {
        enrollmentCounts[e.status] = (enrollmentCounts[e.status] ?? 0) + 1
      }

      const emails = emailsRes.data ?? []
      const emailStats = {
        sent: emails.length,
        opened: emails.filter((e) => e.opened_at).length,
        clicked: emails.filter((e) => e.clicked_at).length,
        bounced: emails.filter((e) => e.bounced_at).length,
      }

      return json({ enrollmentCounts, emailStats })
    }

    // GET ?id=xxx — single campaign with enrollment counts
    if (method === 'GET' && id) {
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .is('deleted_at', null)
        .single()

      if (campaignError) throw campaignError

      const { data: enrollments, error: enrollError } = await supabaseAdmin
        .from('campaign_enrollments')
        .select('status')
        .eq('campaign_id', id)

      if (enrollError) throw enrollError

      const enrollmentCounts: Record<string, number> = {}
      for (const e of enrollments ?? []) {
        enrollmentCounts[e.status] = (enrollmentCounts[e.status] ?? 0) + 1
      }

      return json({ ...campaign, enrollmentCounts })
    }

    // GET — list campaigns
    if (method === 'GET') {
      const status = url.searchParams.get('status')

      let query = supabaseAdmin
        .from('campaigns')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (user.role !== 'admin') {
        query = query.eq('sent_by', user.id)
      }

      if (status) {
        query = query.eq('status', status)
      }

      const { data, error } = await query
      if (error) throw error
      return json(data)
    }

    // POST ?action=enroll&id=xxx — enroll leads into campaign
    if (method === 'POST' && action === 'enroll' && id) {
      const { leadIds } = await req.json()

      const { data: leads, error: leadsError } = await supabaseAdmin
        .from('leads')
        .select('id, email')
        .in('id', leadIds)

      if (leadsError) throw leadsError
      if (!leads?.length) return json({ error: 'No matching leads found' }, 400)

      const enrollmentRows = leads.map((lead) => ({
        campaign_id: id,
        lead_id: lead.id,
        email: lead.email,
        status: 'pending',
        current_step: 0,
      }))

      const { error: enrollError } = await supabaseAdmin
        .from('campaign_enrollments')
        .insert(enrollmentRows)

      if (enrollError) throw enrollError

      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from('campaigns')
        .select('recipient_ids')
        .eq('id', id)
        .single()

      if (campaignError) throw campaignError

      const existing: string[] = campaign?.recipient_ids ?? []
      const merged = Array.from(new Set([...existing, ...leads.map((l) => l.id)]))

      const { error: updateError } = await supabaseAdmin
        .from('campaigns')
        .update({ recipient_ids: merged })
        .eq('id', id)

      if (updateError) throw updateError

      return json({ enrolled: leads.length })
    }

    // POST ?action=launch&id=xxx — launch campaign
    if (method === 'POST' && action === 'launch' && id) {
      const body = await req.json().catch(() => ({}))
      const scheduledAt: string | undefined = body?.scheduledAt
      const newStatus = scheduledAt ? 'scheduled' : 'active'
      const now = new Date().toISOString()

      const { data, error } = await supabaseAdmin
        .from('campaigns')
        .update({
          status: newStatus,
          scheduled_at: scheduledAt ?? null,
          sent_at: now,
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return json(data)
    }

    // POST ?action=pause&id=xxx — pause campaign
    if (method === 'POST' && action === 'pause' && id) {
      const { data, error } = await supabaseAdmin
        .from('campaigns')
        .update({ status: 'paused' })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return json(data)
    }

    // POST ?action=resume&id=xxx — resume campaign
    if (method === 'POST' && action === 'resume' && id) {
      const { data, error } = await supabaseAdmin
        .from('campaigns')
        .update({ status: 'active' })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return json(data)
    }

    // POST ?action=sequence — create campaign sequence with steps
    if (method === 'POST' && action === 'sequence') {
      const { steps } = await req.json()

      const { data: sequence, error: seqError } = await supabaseAdmin
        .from('campaign_sequences')
        .insert({
          name: `Sequence ${Date.now()}`,
          created_by: user.id,
        })
        .select()
        .single()

      if (seqError) throw seqError

      const stepRows = steps.map(
        (s: { subject: string; body: string; delayDays: number }, i: number) => ({
          sequence_id: sequence.id,
          order: i,
          subject: s.subject,
          body: s.body,
          delay_days: s.delayDays,
        })
      )

      const { error: stepsError } = await supabaseAdmin
        .from('campaign_steps')
        .insert(stepRows)

      if (stepsError) throw stepsError

      return json({ sequenceId: sequence.id, stepsCreated: steps.length }, 201)
    }

    // POST — create campaign in draft status
    if (method === 'POST') {
      const body = await req.json()

      const { data, error } = await supabaseAdmin
        .from('campaigns')
        .insert({
          ...body,
          sent_by: user.id,
          status: 'draft',
          recipient_ids: [],
        })
        .select()
        .single()

      if (error) throw error
      return json(data, 201)
    }

    // PATCH ?id=xxx — edit campaign content
    if (method === 'PATCH' && id) {
      const body = await req.json()
      const updates: Record<string, string> = {}
      if (body.subject !== undefined) updates.subject = body.subject
      if (body.body !== undefined) updates.body = body.body

      if (Object.keys(updates).length === 0) {
        return json({ error: 'No fields provided to update' }, 400)
      }

      const { data, error } = await supabaseAdmin
        .from('campaigns')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return json(data)
    }

    return json({ error: 'Not found' }, 404)
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
