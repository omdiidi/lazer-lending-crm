import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Webhook } from 'https://esm.sh/svix'

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET')
    const rawBody = await req.text()

    // Verify svix signature if secret is configured
    if (WEBHOOK_SECRET) {
      const wh = new Webhook(WEBHOOK_SECRET)
      try {
        wh.verify(rawBody, {
          'svix-id': req.headers.get('svix-id') || '',
          'svix-timestamp': req.headers.get('svix-timestamp') || '',
          'svix-signature': req.headers.get('svix-signature') || '',
        })
      } catch (verifyErr) {
        console.error('Webhook signature verification failed:', verifyErr)
        return new Response('Invalid signature', { status: 401 })
      }
    }

    const event = JSON.parse(rawBody)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const emailId = event.data?.email_id
    if (!emailId) {
      console.log('No email_id in webhook event, skipping')
      return new Response('OK', { status: 200 })
    }

    console.log(`Processing ${event.type} for email ${emailId}`)

    switch (event.type) {
      case 'email.bounced': {
        const { data: email } = await supabaseAdmin.from('emails')
          .update({ bounced_at: event.created_at })
          .eq('provider_message_id', emailId)
          .select('lead_id')
          .single()

        if (email?.lead_id) {
          await supabaseAdmin.from('leads')
            .update({ email_status: 'invalid' })
            .eq('id', email.lead_id)
          console.log(`Marked lead ${email.lead_id} as invalid due to bounce`)
          // Update enrollment status
          const emailRow = await supabaseAdmin.from('emails')
            .select('campaign_id')
            .eq('provider_message_id', emailId)
            .single()
          if (emailRow?.data?.campaign_id) {
            await supabaseAdmin.from('campaign_enrollments')
              .update({ status: 'bounced' })
              .eq('campaign_id', emailRow.data.campaign_id)
              .eq('lead_id', email.lead_id)
          }
        }
        break
      }

      case 'email.opened': {
        await supabaseAdmin.from('emails')
          .update({ opened_at: event.created_at })
          .eq('provider_message_id', emailId)
        // Update enrollment status
        const openedEmail = await supabaseAdmin.from('emails')
          .select('campaign_id, lead_id')
          .eq('provider_message_id', emailId)
          .single()
        if (openedEmail?.data?.campaign_id && openedEmail?.data?.lead_id) {
          await supabaseAdmin.from('campaign_enrollments')
            .update({ status: 'opened' })
            .eq('campaign_id', openedEmail.data.campaign_id)
            .eq('lead_id', openedEmail.data.lead_id)
            .eq('status', 'sent') // Only upgrade from 'sent' to 'opened', not from 'replied'
        }
        break
      }

      case 'email.clicked': {
        await supabaseAdmin.from('emails')
          .update({ clicked_at: event.created_at })
          .eq('provider_message_id', emailId)
        break
      }

      case 'email.complained': {
        const { data: email } = await supabaseAdmin.from('emails')
          .update({ bounced_at: event.created_at })
          .eq('provider_message_id', emailId)
          .select('lead_id')
          .single()

        if (email?.lead_id) {
          await supabaseAdmin.from('leads')
            .update({ email_status: 'invalid' })
            .eq('id', email.lead_id)
          console.log(`Marked lead ${email.lead_id} as invalid due to spam complaint`)
        }
        break
      }

      case 'email.received': {
        const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
        if (!RESEND_API_KEY) {
          console.error('RESEND_API_KEY not set, cannot fetch inbound email body')
          break
        }

        const inboundEmailId = event.data.email_id
        const fromRaw = event.data.from as string
        const toRaw = event.data.to as string[]
        const inboundSubject = event.data.subject || '(no subject)'

        // Step 1: Fetch full email body + headers from Resend API
        const emailRes = await fetch(
          `https://api.resend.com/emails/receiving/${inboundEmailId}`,
          { headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` } }
        )

        if (!emailRes.ok) {
          console.error('Failed to fetch inbound email body:', emailRes.status)
          break
        }

        const emailData = await emailRes.json()
        const inboundBody = emailData.html || emailData.text || ''
        const emailHeaders = emailData.headers || {}

        // Extract actual Message-ID header for correct email threading.
        // Resend's internal email_id is NOT the RFC 5322 Message-ID that
        // recipients' mail clients use for threading. We store the real one
        // so that getThreadingHeaders in send-email produces correct In-Reply-To.
        const rawMessageId = emailHeaders['message-id'] || emailHeaders['Message-Id'] || emailHeaders['Message-ID'] || ''
        const actualMessageId = rawMessageId.replace(/^<|>$/g, '').trim()
        const storedProviderId = actualMessageId || inboundEmailId

        // Idempotency: skip if already processed
        const { data: existing } = await supabaseAdmin.from('emails')
          .select('id')
          .eq('provider_message_id', storedProviderId)
          .maybeSingle()

        if (existing) {
          console.log(`Duplicate webhook for email ${inboundEmailId} (Message-ID: ${storedProviderId}), skipping`)
          break
        }

        // Step 2: Parse email addresses
        const fromMatch = fromRaw.match(/<(.+?)>/)
        const fromEmail = fromMatch ? fromMatch[1] : fromRaw
        const toMatch = toRaw[0]?.match(/<(.+?)>/)
        const toEmail = toMatch ? toMatch[1] : (toRaw[0] || '')

        // Step 3: Thread matching
        // Strategy: collect ALL message IDs from In-Reply-To + References headers,
        // then search our DB for any match. Resend sends via Amazon SES, so the
        // outbound Message-ID is an SES ID (not our provider_message_id UUID).
        // We also check provider_message_id for emails we inserted ourselves.
        let threadId: string | null = null
        let replyToId: string | null = null

        const inReplyTo = emailHeaders['in-reply-to'] || emailHeaders['In-Reply-To'] || ''
        const references = emailHeaders['references'] || emailHeaders['References'] || ''

        // Collect all message IDs from both headers
        const allRefs: string[] = []
        const refStr = typeof references === 'string' ? references : (Array.isArray(references) ? references.join(' ') : '')
        const replyStr = typeof inReplyTo === 'string' ? inReplyTo : ''

        // Extract all <...> message IDs
        const msgIdPattern = /<([^>]+)>/g
        let match
        for (const str of [replyStr, refStr]) {
          while ((match = msgIdPattern.exec(str)) !== null) {
            allRefs.push(match[1])
          }
        }

        // Search DB: try matching provider_message_id (our UUID) or look for
        // the SES message ID pattern in provider_message_id
        for (const ref of allRefs) {
          if (threadId) break

          // Try exact match first (for emails we inserted via inbound)
          const { data: exactMatch } = await supabaseAdmin.from('emails')
            .select('id, thread_id')
            .eq('provider_message_id', ref)
            .maybeSingle()

          if (exactMatch) {
            threadId = exactMatch.thread_id
            replyToId = exactMatch.id
            break
          }

          // Try prefix match (our stored UUID might be prefix of SES Message-ID)
          const uuidPart = ref.split('@')[0]
          const { data: prefixMatch } = await supabaseAdmin.from('emails')
            .select('id, thread_id')
            .like('provider_message_id', `${uuidPart}%`)
            .maybeSingle()

          if (prefixMatch) {
            threadId = prefixMatch.thread_id
            replyToId = prefixMatch.id
            break
          }
        }

        // Fallback: if no thread match via message IDs, try matching by
        // conversation participants — find the most recent outbound email TO
        // this sender's address. This handles the case where Resend/SES assigns
        // a different Message-ID than our stored provider_message_id.
        if (!threadId && fromEmail) {
          const { data: recentOutbound } = await supabaseAdmin.from('emails')
            .select('id, thread_id')
            .eq('to', fromEmail)
            .eq('direction', 'outbound')
            .not('thread_id', 'is', null)
            .order('sent_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (recentOutbound) {
            threadId = recentOutbound.thread_id
            replyToId = recentOutbound.id
            console.log(`Thread matched via sender address fallback: ${threadId}`)
          }
        }

        if (!threadId) {
          threadId = crypto.randomUUID()
        }

        // Step 4: Match sender to a CRM lead (include assigned_to for activity)
        const { data: matchedLead } = await supabaseAdmin.from('leads')
          .select('id, assigned_to')
          .eq('email', fromEmail)
          .is('deleted_at', null)
          .maybeSingle()

        // Find email owner by matching to-address prefix
        const toPrefix = toEmail.split('@')[0]
        const { data: toProfile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('email_prefix', toPrefix)
          .maybeSingle()
        const emailUserId = toProfile?.id || null
        if (!emailUserId) console.warn(`No profile found for email prefix: ${toPrefix}`)

        // Step 5: Insert inbound email
        const { data: insertedRow, error: insertErr } = await supabaseAdmin.from('emails').insert({
          lead_id: matchedLead?.id || null,
          from: fromEmail,
          to: toEmail,
          subject: inboundSubject,
          body: inboundBody,
          sent_at: event.created_at,
          read: false,
          direction: 'inbound',
          thread_id: threadId,
          reply_to_id: replyToId,
          provider_message_id: storedProviderId,
          user_id: emailUserId,
        }).select('id').single()

        if (insertErr) {
          console.error('Failed to insert inbound email:', insertErr)
          break
        }

        // Step 6: Log activity if lead matched
        if (matchedLead?.id && matchedLead.assigned_to) {
          await supabaseAdmin.from('activities').insert({
            lead_id: matchedLead.id,
            user_id: matchedLead.assigned_to,
            type: 'email_received',
            description: `Received email from ${fromEmail}: "${inboundSubject}"`,
            timestamp: event.created_at,
          })
        }

        // Step 6b: Process inbound attachments
        const inboundAttachments: Array<{filename: string; content: string | null; content_type: string}> =
          emailData.attachments || []
        if (inboundAttachments.length > 0 && insertedRow?.id) {
          const MAX_FILE_BYTES = 10 * 1024 * 1024   // 10MB
          const MAX_TOTAL_BYTES = 25 * 1024 * 1024  // 25MB
          let totalBytes = 0

          for (const att of inboundAttachments) {
            if (!att.content) continue  // null content = skip
            try {
              const fileBytes = Math.ceil(att.content.length * 0.75)
              if (fileBytes > MAX_FILE_BYTES) {
                console.warn(`Skipping attachment ${att.filename}: exceeds 10MB`)
                continue
              }
              if (totalBytes + fileBytes > MAX_TOTAL_BYTES) {
                console.warn(`Skipping attachment ${att.filename}: total would exceed 25MB`)
                break
              }
              totalBytes += fileBytes

              // Chunked base64 decode — avoids spread call stack overflow on large files
              const binaryStr = atob(att.content)
              const bytes = new Uint8Array(binaryStr.length)
              for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)

              const storagePath = `${insertedRow.id}/${att.filename}`
              const { error: uploadErr } = await supabaseAdmin.storage
                .from('email-attachments')
                .upload(storagePath, bytes, {
                  contentType: att.content_type || 'application/octet-stream',
                  upsert: true,
                })

              if (uploadErr) {
                console.error(`Failed to upload attachment ${att.filename}:`, uploadErr)
                continue
              }

              await supabaseAdmin.from('email_attachments').insert({
                email_id: insertedRow.id,
                filename: att.filename,
                content_type: att.content_type || 'application/octet-stream',
                file_size: fileBytes,
                storage_path: storagePath,
              })
            } catch (attErr) {
              console.error(`Error processing attachment ${att.filename}:`, attErr)
            }
          }
        }

        // Reply detection: if this inbound email is a reply to a campaign email,
        // set campaign_id on the inbound row, update enrollment to 'replied', and flag lead as 'warm'
        if (replyToId && insertedRow) {
          // Look up the parent outbound email's campaign_id
          const { data: parentEmail } = await supabaseAdmin.from('emails')
            .select('campaign_id, user_id')
            .eq('id', replyToId)
            .single()

          if (parentEmail?.campaign_id) {
            // Set campaign_id on the inbound email
            await supabaseAdmin.from('emails')
              .update({ campaign_id: parentEmail.campaign_id })
              .eq('id', insertedRow.id)

            // Update enrollment to 'replied'
            if (matchedLead?.id) {
              await supabaseAdmin.from('campaign_enrollments')
                .update({ status: 'replied' })
                .eq('campaign_id', parentEmail.campaign_id)
                .eq('lead_id', matchedLead.id)

              // Auto-flag lead as 'warm'
              await supabaseAdmin.from('leads')
                .update({ status: 'warm' })
                .eq('id', matchedLead.id)
                .neq('status', 'warm')

              // Auto-assign to campaign sender if lead is currently unassigned
              if (parentEmail?.user_id && matchedLead?.id && !matchedLead.assigned_to) {
                await supabaseAdmin.from('leads')
                  .update({ assigned_to: parentEmail.user_id })
                  .eq('id', matchedLead.id)
              }

              console.log(`Reply detected: lead ${matchedLead.id} flagged as warm, campaign ${parentEmail.campaign_id}`)
            }
          }
        }

        console.log(`Inbound email processed: ${fromEmail} → ${toEmail}, thread: ${threadId}`)
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error('email-events error:', err)
    return new Response('Internal error', { status: 500 })
  }
})
