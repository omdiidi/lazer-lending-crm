import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { writeAlert } from '../_shared/alerts.ts'
import { plainTextToHtml } from '../_shared/html.ts'
import { getMaxDailyAllowed } from '../_shared/warmup.ts'

const EMAIL_DOMAIN = 'integrateapi.ai'
const CAMPAIGN_DOMAIN = 'mail.integrateapi.ai'

function applyMergeFields(text: string, data: {
  first_name?: string; last_name?: string; company?: string;
  job_title?: string; industry?: string; location?: string;
  phone?: string; email?: string;
}): string {
  return text
    .replace(/\{\{firstName\}\}/g, data.first_name || '')
    .replace(/\{\{lastName\}\}/g, data.last_name || '')
    .replace(/\{\{fullName\}\}/g, [data.first_name, data.last_name].filter(Boolean).join(' '))
    .replace(/\{\{jobTitle\}\}/g, data.job_title || '')
    .replace(/\{\{company\}\}/g, data.company || '')
    .replace(/\{\{industry\}\}/g, data.industry || '')
    .replace(/\{\{location\}\}/g, data.location || '')
    .replace(/\{\{phone\}\}/g, data.phone || '')
    .replace(/\{\{email\}\}/g, data.email || '')
}

function calculateOptimalSendTime(timezone: string | null): Date | null {
  if (!timezone) return null
  try {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false })
    const localHour = parseInt(formatter.format(now))
    const targetHour = 9
    let hoursUntilTarget = targetHour - localHour
    if (hoursUntilTarget <= 0) hoursUntilTarget += 24
    if (hoursUntilTarget < 1) return null // Close enough, send now
    return new Date(now.getTime() + hoursUntilTarget * 60 * 60 * 1000)
  } catch { return null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    const SITE_URL = Deno.env.get('SITE_URL') || ''

    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const today = new Date().toISOString().split('T')[0]

    // Get warmup state
    const { data: warmup } = await supabaseAdmin.from('warmup_state')
      .select('*').eq('id', 'default').maybeSingle()
    const firstEmailAt = warmup?.first_email_at ? new Date(warmup.first_email_at) : null
    const daysSinceFirstEmail = firstEmailAt
      ? Math.floor((Date.now() - firstEmailAt.getTime()) / (24 * 60 * 60 * 1000))
      : 0
    const maxDailyAllowed = getMaxDailyAllowed(daysSinceFirstEmail)

    // Auto-initialize warmup on first campaign send
    if (!warmup || !warmup.first_email_at) {
      await supabaseAdmin.from('warmup_state').upsert({
        id: 'default',
        first_email_at: new Date().toISOString(),
      })
      console.log('Warmup initialized: first campaign email')
    }

    // Quick non-locking check for early exit
    const { data: logRow } = await supabaseAdmin.from('email_send_log')
      .select('emails_sent').eq('send_date', today).maybeSingle()
    const currentSent = logRow?.emails_sent || 0
    if (currentSent >= maxDailyAllowed) {
      console.log(`Daily limit reached (${currentSent}/${maxDailyAllowed}), skipping all campaigns`)
      return new Response(JSON.stringify({ processed: 0, dailyLimitReached: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    let scheduledProcessed = 0
    const activeProcessed = 0

    // Step 1: Claim scheduled campaigns (atomic — prevents double-sends)
    const { data: scheduledCampaigns } = await supabaseAdmin
      .from('campaigns')
      .update({ status: 'active' })
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString())
      .is('deleted_at', null)
      .select('*')

    // Step 2: Also get active campaigns with pending enrollments (handles timeout recovery)
    const { data: activeCampaigns } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .eq('status', 'active')
      .is('deleted_at', null)

    // Merge both lists, deduplicate by id
    const allCampaigns = [...(scheduledCampaigns || []), ...(activeCampaigns || [])]
    const seenIds = new Set<string>()
    const uniqueCampaigns = allCampaigns.filter(c => {
      if (seenIds.has(c.id)) return false
      seenIds.add(c.id)
      return true
    })

    for (const campaign of uniqueCampaigns) {
      const campaignDailyLimit = campaign.daily_send_limit || 100
      const fetchSize = Math.min(campaignDailyLimit, 100)
      if (fetchSize <= 0) continue

      // Get pending enrollments
      const { data: enrollmentsData } = await supabaseAdmin
        .from('campaign_enrollments')
        .select('*')
        .eq('campaign_id', campaign.id)
        .eq('status', 'pending')
        .or(`next_send_at.is.null,next_send_at.lte.${new Date().toISOString()}`)
        .limit(fetchSize) // Process in chunks to avoid timeout
      let enrollments = enrollmentsData

      if (!enrollments?.length) {
        // None due right now — check if any are still pending (e.g. future next_send_at from send_spacing)
        const { count: totalPending } = await supabaseAdmin.from('campaign_enrollments')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', campaign.id)
          .eq('status', 'pending')
        if (!totalPending) {
          // Truly nothing left — mark completed
          await supabaseAdmin.from('campaigns')
            .update({ status: 'completed' })
            .eq('id', campaign.id)
            .eq('status', 'active')
        }
        continue
      }

      // Get sender profile
      const { data: profile } = await supabaseAdmin.from('profiles')
        .select('name, email_prefix')
        .eq('id', campaign.sent_by)
        .single()

      if (!profile?.email_prefix) {
        console.error(`Campaign ${campaign.id}: sender has no email_prefix`)
        continue
      }

      // Bulk-fetch lead data for merge fields
      const leadIds = enrollments.map(e => e.lead_id).filter(Boolean)
      const { data: leadsData } = await supabaseAdmin.from('leads')
        .select('id, first_name, last_name, email, phone, job_title, company, industry, location, company_size, timezone, email_status')
        .in('id', leadIds)

      const leadMap = new Map<string, {
        first_name: string; last_name: string; email: string; phone: string;
        job_title: string; company: string; industry: string; location: string;
        company_size: string; timezone: string | null; email_status: string | null;
      }>()
      for (const l of leadsData || []) {
        leadMap.set(l.id, {
          first_name: l.first_name, last_name: l.last_name || '', email: l.email || '',
          phone: l.phone || '', job_title: l.job_title || '', company: l.company,
          industry: l.industry || '', location: l.location || '',
          company_size: l.company_size || '', timezone: l.timezone ?? null,
          email_status: l.email_status ?? null,
        })
      }

      // Smart send: defer enrollments where it's not 9 AM local yet
      if (campaign.smart_send) {
        const deferredIds: string[] = []
        for (const e of enrollments || []) {
          if (e.lead_id) {
            const lead = leadMap.get(e.lead_id)
            if (lead?.timezone) {
              const optimalTime = calculateOptimalSendTime(lead.timezone)
              if (optimalTime && optimalTime > new Date()) {
                deferredIds.push(e.id)
                await supabaseAdmin.from('campaign_enrollments')
                  .update({ next_send_at: optimalTime.toISOString() })
                  .eq('id', e.id)
              }
            }
          }
        }
        // Remove deferred enrollments from the batch
        enrollments = (enrollments || []).filter(e => !deferredIds.includes(e.id))
        if (enrollments.length === 0) continue // All deferred, skip this campaign for now
      }

      // Skip leads with invalid email — mark as bounced so they don't re-process
      const invalidEnrollmentIds: string[] = []
      enrollments = enrollments.filter(e => {
        if (!e.lead_id) return true  // bare-email enrollment, no lead to check
        const lead = leadMap.get(e.lead_id)
        if (lead?.email_status === 'invalid') {
          invalidEnrollmentIds.push(e.id)
          return false
        }
        return true
      })

      if (invalidEnrollmentIds.length > 0) {
        await supabaseAdmin.from('campaign_enrollments')
          .update({ status: 'bounced' })
          .in('id', invalidEnrollmentIds)
        console.log(`Marked ${invalidEnrollmentIds.length} enrollments as bounced (invalid email)`)
      }

      if (enrollments.length === 0) continue

      // Send spacing: only space fresh enrollments, send due ones normally
      if (campaign.send_spacing) {
        const fresh = enrollments.filter(e => !e.next_send_at)
        const due = enrollments.filter(e => e.next_send_at)

        if (fresh.length > 1) {
          const SEND_WINDOW_MS = 8 * 60 * 60 * 1000 // 8 hours
          const intervalMs = Math.floor(SEND_WINDOW_MS / fresh.length)
          const randomJitter = () => Math.floor(Math.random() * 120000) - 60000 // ±1 min

          for (let j = 1; j < fresh.length; j++) {
            const sendAt = new Date(Date.now() + (j * intervalMs) + randomJitter())
            await supabaseAdmin.from('campaign_enrollments')
              .update({ next_send_at: sendAt.toISOString() })
              .eq('id', fresh[j].id)
          }
          console.log(`Spacing: deferred ${fresh.length - 1} fresh emails across ${SEND_WINDOW_MS / 3600000}h`)

          // Keep first fresh + all due enrollments for immediate send
          enrollments = [fresh[0], ...due]
        }
      }

      // Build email batch
      const resendEmails = enrollments.map(e => {
        // Determine A/B variant
        let useVariantB = false
        if (campaign.ab_test_enabled && campaign.variant_b_subject && campaign.variant_b_body) {
          const hash = e.id.split('').reduce((sum: number, c: string) => sum + c.charCodeAt(0), 0)
          useVariantB = hash % 2 === 1
        }

        const templateSubject = useVariantB ? (campaign.variant_b_subject as string) : campaign.subject
        const templateBody = useVariantB ? (campaign.variant_b_body as string) : campaign.body

        ;(e as Record<string, unknown>)._variant = useVariantB ? 'B' : 'A'

        const lead = e.lead_id ? leadMap.get(e.lead_id) : null
        let emailBody = applyMergeFields(templateBody, lead || {})
        const emailSubject = applyMergeFields(templateSubject, lead || {})

        // Unsubscribe link
        if (SITE_URL && emailBody.includes('{{unsubscribeLink}}')) {
          const token = crypto.randomUUID()
          emailBody = emailBody.replace(/\{\{unsubscribeLink\}\}/g,
            `${SITE_URL}/unsubscribe/${token}?email=${encodeURIComponent(e.email)}`)
        }

        return {
          from: `${profile.name} <${profile.email_prefix}@${CAMPAIGN_DOMAIN}>`,
          headers: { 'Reply-To': `${profile.name} <${profile.email_prefix}@${EMAIL_DOMAIN}>` },
          to: [e.email],
          subject: emailSubject,
          text: emailBody,
          html: plainTextToHtml(emailBody),
        }
      })

      // Atomically claim exactly the number of emails we're about to send
      if (resendEmails.length > 0) {
        const { data: grantedSlots, error: claimError } = await supabaseAdmin.rpc('claim_daily_send_budget', {
          p_date: today,
          p_max: maxDailyAllowed,
          p_requested: resendEmails.length,
        })
        if (claimError) throw claimError
        if (!grantedSlots || grantedSlots <= 0) {
          console.log('Daily cap reached mid-campaign, stopping')
          break
        }
        // If cap only allows fewer than we built (race), trim the batch
        if (grantedSlots < resendEmails.length) {
          resendEmails.splice(grantedSlots)
          enrollments = enrollments.slice(0, grantedSlots)
        }
      }

      // Send via Resend batch API (chunks of 100)
      for (let i = 0; i < resendEmails.length; i += 100) {
        const chunk = resendEmails.slice(i, i + 100)
        const res = await fetch('https://api.resend.com/emails/batch', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(chunk),
        })

        if (res.ok) {
          const { data: resendResults } = await res.json()
          const batchEnrollments = enrollments.slice(i, i + 100)

          // Batch-update enrollment statuses + insert email records
          const emailRows = batchEnrollments.map((e, j) => {
            // Use substituted subject/body from the resend payload (not raw template)
            const sentEmail = resendEmails[i + j]
            return {
            lead_id: e.lead_id,
            from: `${profile.email_prefix}@${CAMPAIGN_DOMAIN}`,
            to: e.email,
            subject: sentEmail?.subject || campaign.subject,
            body: sentEmail?.text || campaign.body,
            sent_at: new Date().toISOString(),
            read: true,
            direction: 'outbound',
            thread_id: `t-camp-${campaign.id}-${e.lead_id || e.id}`,
            campaign_id: campaign.id,
            provider_message_id: resendResults?.[j]?.id || null,
            user_id: campaign.sent_by,
          }})

          await supabaseAdmin.from('emails').insert(emailRows)

          // Update last_contacted_at and email_count on leads
          const contactedLeadIds = batchEnrollments.map(e => e.lead_id).filter(Boolean)
          if (contactedLeadIds.length) {
            await supabaseAdmin.from('leads')
              .update({ last_contacted_at: new Date().toISOString() })
              .in('id', contactedLeadIds)
            await supabaseAdmin.rpc('increment_email_count', {
              lead_ids: contactedLeadIds,
              amount: 1,
            })
          }

          // Update enrollments to 'sent', grouped by A/B variant
          const variantAIds = batchEnrollments.filter((e: Record<string, unknown>) => e._variant === 'A').map(e => e.id)
          const variantBIds = batchEnrollments.filter((e: Record<string, unknown>) => e._variant === 'B').map(e => e.id)
          if (variantAIds.length) {
            await supabaseAdmin.from('campaign_enrollments')
              .update({ status: 'sent', sent_at: new Date().toISOString(), ab_variant: 'A' })
              .in('id', variantAIds)
          }
          if (variantBIds.length) {
            await supabaseAdmin.from('campaign_enrollments')
              .update({ status: 'sent', sent_at: new Date().toISOString(), ab_variant: 'B' })
              .in('id', variantBIds)
          }

          // Create activity records for sent emails
          try {
            const activityRows = batchEnrollments
              .filter(e => e.lead_id)
              .map((e, j) => ({
                lead_id: e.lead_id,
                user_id: campaign.sent_by,
                type: 'email_sent',
                description: `Campaign email sent: "${resendEmails[i + j]?.subject || campaign.subject}"`,
                timestamp: new Date().toISOString(),
                metadata: { campaignId: campaign.id, threadId: `t-camp-${campaign.id}-${e.lead_id || e.id}` },
              }))
            if (activityRows.length > 0) {
              await supabaseAdmin.from('activities').insert(activityRows)
            }
          } catch (e) { console.error('Activity creation failed:', e) }
        } else {
          const error = await res.text()
          const status = res.status
          console.error('Resend batch failed:', status, error)
          await writeAlert(supabaseAdmin, {
            type: 'error',
            source: 'resend',
            message: `Campaign email batch failed (HTTP ${status}). Some emails may not have been sent.`,
            details: { campaign_id: campaign.id, status, error },
          })
          await supabaseAdmin.from('campaign_enrollments')
            .update({ status: 'failed' })
            .in('id', enrollments.slice(i, i + 100).map(e => e.id))
          continue
        }

        if (i + 100 < resendEmails.length) await new Promise(r => setTimeout(r, 250))
      }

      // Check if all enrollments are now sent
      const { count: remaining } = await supabaseAdmin
        .from('campaign_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaign.id)
        .eq('status', 'pending')

      if (remaining === 0) {
        await supabaseAdmin.from('campaigns')
          .update({ status: 'completed' })
          .eq('id', campaign.id)
      }

      scheduledProcessed++
    }

    // Step 3: Process drip sequence enrollments (due steps)
    let dripProcessed = 0
    const { data: dueEnrollments } = await supabaseAdmin
      .from('campaign_enrollments')
      .select('*')
      .eq('status', 'pending')
      .not('next_send_at', 'is', null)
      .lte('next_send_at', new Date().toISOString())
      .limit(50)

    for (const enrollment of dueEnrollments || []) {
      // Fetch the campaign
      const { data: campaign } = await supabaseAdmin
        .from('campaigns')
        .select('*')
        .eq('id', enrollment.campaign_id)
        .single()

      if (!campaign || campaign.status === 'paused' || campaign.status === 'completed' || !campaign.sequence_id) continue

      // Check stop conditions
      const { data: unsub } = await supabaseAdmin.from('unsubscribes')
        .select('id').eq('email', enrollment.email).maybeSingle()
      if (unsub) {
        await supabaseAdmin.from('campaign_enrollments')
          .update({ status: 'unsubscribed' }).eq('id', enrollment.id)
        continue
      }

      // Fetch the step for current_step (column name is 'order')
      const { data: step } = await supabaseAdmin
        .from('campaign_steps')
        .select('*')
        .eq('sequence_id', campaign.sequence_id)
        .eq('order', enrollment.current_step)
        .single()

      if (!step) {
        // No more steps — mark complete
        await supabaseAdmin.from('campaign_enrollments')
          .update({ status: 'sent', next_send_at: null }).eq('id', enrollment.id)
        continue
      }

      // Fetch sender profile
      const { data: profile } = await supabaseAdmin.from('profiles')
        .select('name, email_prefix').eq('id', campaign.sent_by).single()
      if (!profile?.email_prefix) continue

      // Fetch lead data for merge fields
      let lead: { first_name: string; last_name: string; email: string; phone: string; job_title: string; company: string; industry: string; location: string; email_status: string | null } | null = null
      if (enrollment.lead_id) {
        const { data: leadResult } = await supabaseAdmin.from('leads')
          .select('first_name, last_name, email, phone, job_title, company, industry, location, email_status').eq('id', enrollment.lead_id).single()
        if (leadResult?.email_status === 'invalid') {
          await supabaseAdmin.from('campaign_enrollments')
            .update({ status: 'bounced' }).eq('id', enrollment.id)
          console.log(`Drip skip: enrollment ${enrollment.id} lead ${enrollment.lead_id} has invalid email`)
          continue
        }
        lead = leadResult ?? null
      }

      // Build email
      const leadData = lead || { first_name: '', last_name: '', company: '', job_title: '', industry: '', location: '', phone: '', email: '' }
      const emailSubject = applyMergeFields(step.subject, leadData)
      let emailBody = applyMergeFields(step.body, leadData)

      if (SITE_URL && emailBody.includes('{{unsubscribeLink}}')) {
        const token = crypto.randomUUID()
        emailBody = emailBody.replace(/\{\{unsubscribeLink\}\}/g,
          `${SITE_URL}/unsubscribe/${token}?email=${encodeURIComponent(enrollment.email)}`)
      }

      // Atomically claim 1 slot for this drip email
      const { data: grantedDrip, error: dripClaimError } = await supabaseAdmin.rpc('claim_daily_send_budget', {
        p_date: today,
        p_max: maxDailyAllowed,
        p_requested: 1,
      })
      if (dripClaimError) throw dripClaimError
      if (!grantedDrip || grantedDrip <= 0) {
        console.log('Daily cap reached during drip processing, stopping')
        break
      }

      // Send via Resend
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${profile.name} <${profile.email_prefix}@${CAMPAIGN_DOMAIN}>`,
          headers: { 'Reply-To': `${profile.name} <${profile.email_prefix}@${EMAIL_DOMAIN}>` },
          to: [enrollment.email],
          subject: emailSubject,
          text: emailBody,
          html: plainTextToHtml(emailBody),
        }),
      })

      if (res.ok) {
        const { id: providerMessageId } = await res.json()

        // Insert email record
        await supabaseAdmin.from('emails').insert({
          lead_id: enrollment.lead_id,
          from: `${profile.email_prefix}@${CAMPAIGN_DOMAIN}`,
          to: enrollment.email,
          subject: emailSubject,
          body: emailBody,
          sent_at: new Date().toISOString(),
          read: true,
          direction: 'outbound',
          thread_id: `t-camp-${campaign.id}-${enrollment.lead_id || enrollment.id}`,
          campaign_id: campaign.id,
          provider_message_id: providerMessageId,
          user_id: campaign.sent_by,
        })

        // Update last_contacted_at and email_count on lead
        if (enrollment.lead_id) {
          await supabaseAdmin.from('leads')
            .update({ last_contacted_at: new Date().toISOString() })
            .eq('id', enrollment.lead_id)
          await supabaseAdmin.rpc('increment_email_count', {
            lead_ids: [enrollment.lead_id],
            amount: 1,
          })
        }

        // Create activity record for drip email
        try {
          if (enrollment.lead_id) {
            await supabaseAdmin.from('activities').insert({
              lead_id: enrollment.lead_id,
              user_id: campaign.sent_by,
              type: 'email_sent',
              description: `Campaign email sent: "${emailSubject}"`,
              timestamp: new Date().toISOString(),
              metadata: { campaignId: campaign.id, threadId: `t-camp-${campaign.id}-${enrollment.lead_id || enrollment.id}` },
            })
          }
        } catch (e) { console.error('Drip activity creation failed:', e) }

        // Check if more steps exist
        const { data: nextStep } = await supabaseAdmin
          .from('campaign_steps')
          .select('delay_days')
          .eq('sequence_id', campaign.sequence_id)
          .eq('order', enrollment.current_step + 1)
          .maybeSingle()

        if (nextStep) {
          // More steps: increment and schedule next
          const nextSendAt = new Date(Date.now() + nextStep.delay_days * 24 * 60 * 60 * 1000)
          await supabaseAdmin.from('campaign_enrollments')
            .update({
              current_step: enrollment.current_step + 1,
              next_send_at: nextSendAt.toISOString(),
              sent_at: new Date().toISOString(),
            })
            .eq('id', enrollment.id)
        } else {
          // Last step — mark complete
          await supabaseAdmin.from('campaign_enrollments')
            .update({ status: 'sent', sent_at: new Date().toISOString(), next_send_at: null })
            .eq('id', enrollment.id)
        }

        dripProcessed++
      } else {
        const error = await res.text()
        const status = res.status
        console.error('Drip send failed:', status, error)
        await writeAlert(supabaseAdmin, {
          type: 'error',
          source: 'resend',
          message: `Drip sequence email failed (HTTP ${status}).`,
          details: { enrollment_id: enrollment.id, campaign_id: enrollment.campaign_id, status, error },
        })
        await supabaseAdmin.from('campaign_enrollments')
          .update({ status: 'failed' })
          .eq('id', enrollment.id)
        continue
      }
    }

    return new Response(JSON.stringify({
      scheduledProcessed,
      activeProcessed,
      campaignsChecked: uniqueCampaigns.length,
      dripProcessed,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('process-campaigns error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
