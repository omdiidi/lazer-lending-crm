import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Auth via BACKFILL_SECRET env var — never expose the service role key in URLs
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  const BACKFILL_SECRET = Deno.env.get('BACKFILL_SECRET')
  if (!BACKFILL_SECRET || secret !== BACKFILL_SECRET) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!

  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
  const { data: emails } = await supabaseAdmin
    .from('emails')
    .select('id, provider_message_id')
    .eq('direction', 'inbound')
    .not('provider_message_id', 'is', null)
    .gte('sent_at', cutoff)

  let processed = 0, attachmentsFound = 0, errors = 0
  const MAX_FILE_BYTES = 10 * 1024 * 1024
  const MAX_TOTAL_BYTES = 25 * 1024 * 1024

  for (const email of (emails || [])) {
    try {
      const res = await fetch(
        `https://api.resend.com/emails/receiving/${email.provider_message_id}`,
        { headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` } }
      )
      if (!res.ok) continue
      const emailData = await res.json()
      const atts: Array<{filename: string; content: string | null; content_type: string}> =
        emailData.attachments || []
      processed++
      let total = 0

      for (const att of atts) {
        if (!att.content) continue
        const size = Math.ceil(att.content.length * 0.75)
        if (size > MAX_FILE_BYTES || total + size > MAX_TOTAL_BYTES) continue
        total += size

        // Idempotency: skip if already stored
        const { data: existing } = await supabaseAdmin
          .from('email_attachments')
          .select('id')
          .eq('email_id', email.id)
          .eq('filename', att.filename)
          .maybeSingle()
        if (existing) continue

        const binaryStr = atob(att.content)
        const bytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)

        const storagePath = `${email.id}/${att.filename}`
        const { error: uploadErr } = await supabaseAdmin.storage
          .from('email-attachments')
          .upload(storagePath, bytes, {
            contentType: att.content_type || 'application/octet-stream',
            upsert: true,
          })
        if (uploadErr) { errors++; continue }

        await supabaseAdmin.from('email_attachments').insert({
          email_id: email.id,
          filename: att.filename,
          content_type: att.content_type || 'application/octet-stream',
          file_size: size,
          storage_path: storagePath,
        })
        attachmentsFound++
      }
    } catch (e) {
      console.error(`Error processing email ${email.id}:`, e)
      errors++
    }
  }

  return new Response(
    JSON.stringify({ processed, attachmentsFound, errors }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
