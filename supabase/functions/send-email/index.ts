import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { writeAlert } from '../_shared/alerts.ts'
import { plainTextToHtml } from '../_shared/html.ts'
import { resolveUser } from '../_shared/auth.ts'
import { getMaxDailyAllowed } from '../_shared/warmup.ts'

const EMAIL_DOMAIN = 'integrateapi.ai'

const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Resend API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const SITE_URL = Deno.env.get('SITE_URL') || ''

    const authHeader = req.headers.get('Authorization')
    const { emails, campaignId } = await req.json()

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No emails provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    let user
    try {
      user = await resolveUser(authHeader, supabaseAdmin)
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (!user.emailPrefix) {
      return new Response(
        JSON.stringify({ error: 'Sending email not configured. Set it in Settings.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const validFrom = `${user.emailPrefix}@${EMAIL_DOMAIN}`
    const senderName = user.name

    // --- Daily send cap enforcement ---
    const today = new Date().toISOString().split('T')[0]
    const { data: warmup } = await supabaseAdmin.from('warmup_state')
      .select('first_email_at').eq('id', 'default').maybeSingle()
    const firstEmailAt = warmup?.first_email_at ? new Date(warmup.first_email_at) : null
    const daysSinceFirstEmail = firstEmailAt
      ? Math.floor((Date.now() - firstEmailAt.getTime()) / (24 * 60 * 60 * 1000))
      : 0
    const maxDailyAllowed = getMaxDailyAllowed(daysSinceFirstEmail)

    const { data: grantedSlots, error: claimError } = await supabaseAdmin.rpc('claim_daily_send_budget', {
      p_date: today,
      p_max: maxDailyAllowed,
      p_requested: emails.length,
    })
    if (claimError) {
      console.error('Failed to claim send budget:', claimError)
      return new Response(
        JSON.stringify({ error: 'Internal error checking send limit' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!grantedSlots || grantedSlots <= 0) {
      return new Response(
        JSON.stringify({ error: 'Daily send limit reached. Sends will resume tomorrow.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // If near the cap, trim to however many slots were granted
    const emailsToProcess = grantedSlots < emails.length
      ? emails.slice(0, grantedSlots)
      : emails
    const capReached = grantedSlots < emails.length
    // --- End cap enforcement ---

    // Helper: get threading headers for replies
    async function getThreadingHeaders(threadId?: string, replyToId?: string) {
      if (!replyToId || !threadId) return {}

      const { data: replyTo } = await supabaseAdmin
        .from('emails')
        .select('provider_message_id')
        .eq('id', replyToId)
        .single()

      const { data: threadEmails } = await supabaseAdmin
        .from('emails')
        .select('provider_message_id')
        .eq('thread_id', threadId)
        .not('provider_message_id', 'is', null)
        .order('sent_at', { ascending: true })

      const headers: Record<string, string> = {}
      if (replyTo?.provider_message_id) {
        headers['In-Reply-To'] = `<${replyTo.provider_message_id}>`
      }
      if (threadEmails?.length) {
        headers['References'] = threadEmails
          .map((e: { provider_message_id: string }) => `<${e.provider_message_id}>`)
          .join(' ')
      }
      return headers
    }

    const results: unknown[] = []
    let failedCount = 0

    if (emailsToProcess.length === 1) {
      // Single send (compose or reply)
      const email = emailsToProcess[0]
      const threadingHeaders = await getThreadingHeaders(email.threadId, email.replyToId)

      // Generate threadId if not provided
      const threadId = email.threadId || crypto.randomUUID()

      // Build Resend attachments array (single send only)
      const resendAttachments: { filename: string; content: string }[] = []
      if (email.attachments?.length) {
        for (const att of email.attachments) {
          try {
            const { data: fileData, error: dlErr } = await supabaseAdmin.storage
              .from('email-attachments')
              .download(att.storagePath)
            if (dlErr || !fileData) {
              console.error(`Failed to download attachment ${att.filename}:`, dlErr)
              continue
            }
            const buffer = await fileData.arrayBuffer()
            const bytes = new Uint8Array(buffer)
            // Chunked encode — avoids spread stack overflow on files > ~250KB
            let binary = ''
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
            resendAttachments.push({ filename: att.filename, content: btoa(binary) })
          } catch (e) {
            console.error(`Error encoding attachment ${att.filename}:`, e)
          }
        }
      }

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${senderName} <${validFrom}>`,
          to: [email.to],
          subject: email.subject,
          text: email.body,
          ...(campaignId ? { html: plainTextToHtml(email.body) } : {}),
          headers: Object.keys(threadingHeaders).length > 0 ? threadingHeaders : undefined,
          ...(resendAttachments.length > 0 ? { attachments: resendAttachments } : {}),
        }),
      })

      if (!resendRes.ok) {
        const err = await resendRes.json()
        console.error('Resend send failed:', err)
        await writeAlert(supabaseAdmin, {
          type: 'error', source: 'resend',
          message: `Email send failed (HTTP ${resendRes.status}). The email was not delivered.`,
          details: { status: resendRes.status, to: email.to, error: err },
        })
        return new Response(
          JSON.stringify({ error: err.message || 'Failed to send email' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const { id: providerMessageId } = await resendRes.json()

      const { data: row, error: dbErr } = await supabaseAdmin.from('emails').insert({
        lead_id: email.leadId || null,
        campaign_id: campaignId || null,
        from: validFrom,
        to: email.to,
        subject: email.subject,
        body: email.body,
        sent_at: new Date().toISOString(),
        read: true,
        direction: 'outbound',
        thread_id: threadId,
        reply_to_id: email.replyToId || null,
        provider_message_id: providerMessageId,
        user_id: user.id,
      }).select().single()

      if (dbErr) console.error('DB insert failed after send:', dbErr)
      if (email.leadId) {
        await supabaseAdmin.from('leads').update({ last_contacted_at: new Date().toISOString() }).eq('id', email.leadId)
      }
      results.push(row)

      if (row?.id && email.attachments?.length) {
        await supabaseAdmin.from('email_attachments').insert(
          email.attachments.map((att: { storagePath: string; filename: string; contentType: string; size: number }) => ({
            email_id: row.id,
            filename: att.filename,
            content_type: att.contentType,
            file_size: att.size,
            storage_path: att.storagePath,
          }))
        )
      }

    } else {
      // Batch send (campaigns) — chunks of 100
      for (let i = 0; i < emailsToProcess.length; i += 100) {
        const chunk = emailsToProcess.slice(i, i + 100)
        // Resolve unsubscribe links per recipient before sending
        const resolvedBodies: string[] = chunk.map((email: Record<string, string>) => {
          let emailBody = email.body
          if (SITE_URL && emailBody.includes('{{unsubscribeLink}}')) {
            const unsubToken = crypto.randomUUID()
            const unsubUrl = `${SITE_URL}/unsubscribe/${unsubToken}?email=${encodeURIComponent(email.to)}`
            emailBody = emailBody.replace(/\{\{unsubscribeLink\}\}/g, unsubUrl)
          }
          return emailBody
        })

        const resendBatch = chunk.map((email: Record<string, string>, idx: number) => ({
          from: `${senderName} <${validFrom}>`,
          to: [email.to],
          subject: email.subject,
          text: resolvedBodies[idx],
          html: plainTextToHtml(resolvedBodies[idx]),
        }))

        const resendRes = await fetch('https://api.resend.com/emails/batch', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(resendBatch),
        })

        if (!resendRes.ok) {
          const batchError = await resendRes.text()
          console.error('Resend batch failed:', resendRes.status, batchError)
          await writeAlert(supabaseAdmin, {
            type: 'error', source: 'resend',
            message: `Email batch send partially failed (HTTP ${resendRes.status}). Some emails were not delivered.`,
            details: { status: resendRes.status, batchSize: chunk.length },
          })
          failedCount += chunk.length
          continue
        }

        const { data: resendResults } = await resendRes.json()

        const rows = chunk.map((email: Record<string, string>, idx: number) => ({
          lead_id: email.leadId || null,
          campaign_id: campaignId || null,
          from: validFrom,
          to: email.to,
          subject: email.subject,
          body: resolvedBodies[idx],
          sent_at: new Date().toISOString(),
          read: true,
          direction: 'outbound',
          thread_id: email.threadId || crypto.randomUUID(),
          reply_to_id: null,
          provider_message_id: resendResults?.[idx]?.id || null,
          user_id: user.id,
        }))

        const { data: inserted, error: dbErr } = await supabaseAdmin
          .from('emails')
          .insert(rows)
          .select()

        if (dbErr) console.error('DB batch insert failed:', dbErr)
        results.push(...(inserted || []))

        if (i + 100 < emailsToProcess.length) await new Promise(r => setTimeout(r, 250))
      }
    }

    return new Response(
      JSON.stringify({
        emails: results,
        count: results.length,
        failedCount,
        capReached,
        skipped: emails.length - emailsToProcess.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('send-email error:', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
