# Plan: Campaign Engine Phase 2a — Scheduling, Pause/Resume, Reply Detection

**Confidence: 9/10** — New scheduler infrastructure (pg_cron + Edge Function), enrollment tracking table, UI updates for scheduling and pause/resume. The scheduler is the most complex piece.

## Goal

Add campaign scheduling (send at a future date/time), pause/resume for active campaigns, per-recipient enrollment tracking, and reply detection that auto-flags leads as "warm". Set up the pg_cron scheduler infrastructure that Phase 2b (drip sequences) will also use.

## What — Phase 2a Scope

### Features
1. **Scheduled sends** — campaign builder step 4 gets a "Schedule" option with date/time picker
2. **Campaign pause/resume** — pause stops sending, resume continues where it left off
3. **Per-recipient enrollment tracking** — new `campaign_enrollments` table tracks each recipient's status
4. **Reply detection** — when someone replies to a campaign email, auto-flag the lead as "warm"
5. **Process-campaigns scheduler** — pg_cron fires every 5 minutes, calls Edge Function to process scheduled campaigns and (Phase 2b) drip steps
6. **Campaign status flow** — draft → scheduled → active → completed (or paused)

### NOT in Phase 2a (deferred to Phase 2b)
- Multi-step drip sequences
- Sequence builder UI
- Delay-based follow-ups
- Stop conditions beyond unsubscribe

---

## Files Being Changed

```
supabase/
├── functions/
│   └── process-campaigns/
│       └── index.ts                    ← NEW (scheduler Edge Function)
src/
├── pages/
│   ├── CampaignBuilderPage.tsx         ← MODIFIED (add schedule option in step 4)
│   └── CampaignDetailPage.tsx          ← MODIFIED (add pause/resume buttons)
├── components/
│   └── campaigns/
│       └── CampaignList.tsx            ← MODIFIED (pause/resume actions, scheduled status)
├── hooks/
│   └── use-campaigns.ts               ← MODIFIED (add pause/resume mutations)
├── lib/
│   └── api/
│       └── campaigns.ts               ← MODIFIED (add pauseCampaign, resumeCampaign)
├── types/
│   ├── crm.ts                         ← MODIFIED (add CampaignEnrollment type)
│   └── database.ts                    ← MODIFIED (add campaign_enrollments table)
docs/
├── campaigns.md                        ← MODIFIED
├── schema.md                           ← MODIFIED
├── OVERVIEW.md                         ← MODIFIED
```

---

## Architecture Overview

### Scheduler Flow
```
pg_cron (every 5 minutes)
  └── net.http_post → /functions/v1/process-campaigns
        │
        ├── Step 1: Check scheduled campaigns
        │   SELECT * FROM campaigns WHERE status='scheduled' AND scheduled_at <= now()
        │   → For each: create enrollments, send batch, update status to 'active'/'completed'
        │
        ├── Step 2: Check drip enrollments (Phase 2b — placeholder for now)
        │   SELECT * FROM campaign_enrollments WHERE status='pending' AND next_send_at <= now()
        │   → (Phase 2b will implement this)
        │
        └── Step 3: Reply detection
            Check recent inbound emails with campaign_id
            → If lead replied to a campaign email, update lead status to 'warm'

cron-job.org (every 5 min, backup + keep-alive)
  └── Same endpoint, prevents free-tier project pausing
```

### Campaign Status Flow
```
draft → scheduled (has scheduled_at in future)
     → active (sending in progress or sent but not all completed)
     → paused (admin paused mid-flight)
     → completed (all recipients processed)

Transitions:
- User clicks "Schedule" → draft → scheduled
- User clicks "Send Now" → draft → active → completed (existing flow)
- Scheduler fires → scheduled → active (sending) → completed
- User clicks "Pause" → active → paused
- User clicks "Resume" → paused → active (scheduler picks up remaining)
```

### Per-Recipient Enrollment
```
campaign_enrollments:
  id, campaign_id, lead_id, email
  status: 'pending' | 'sent' | 'opened' | 'replied' | 'bounced' | 'unsubscribed'
  sent_at, next_send_at (for Phase 2b drip)
  current_step (for Phase 2b sequences)

When a campaign is sent (or scheduled):
  1. Create enrollment rows for all recipients (status='pending')
  2. As emails are sent, update status to 'sent'
  3. Webhooks update: opened/clicked/bounced
  4. Inbound reply detected → status='replied', lead.status → 'warm'
```

---

## Database Migration

```sql
-- 1. Create campaign_enrollments table
CREATE TABLE IF NOT EXISTS campaign_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'opened', 'replied', 'bounced', 'unsubscribed')),
  sent_at timestamptz,
  next_send_at timestamptz,
  current_step integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE campaign_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can manage enrollments" ON campaign_enrollments;
CREATE POLICY "Authenticated users can manage enrollments" ON campaign_enrollments
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS campaign_enrollments_campaign_id_idx ON campaign_enrollments(campaign_id);
CREATE INDEX IF NOT EXISTS campaign_enrollments_status_idx ON campaign_enrollments(status);
CREATE INDEX IF NOT EXISTS campaign_enrollments_next_send_at_idx ON campaign_enrollments(next_send_at)
  WHERE status = 'pending';

-- 2. Set up pg_cron (enable extension + create job)
-- Note: pg_cron and pg_net should already be available on Supabase
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- Store project URL and anon key in Vault for scheduler
SELECT vault.create_secret(
  'https://onthjkzdgsfvmgyhrorw.supabase.co',
  'project_url'
);

-- Schedule the process-campaigns job to run every 5 minutes
SELECT cron.schedule(
  'process-campaigns',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
        || '/functions/v1/process-campaigns',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := '{"source":"cron"}'::jsonb
    ) AS request_id;
  $$
);

-- Cleanup cron history (prevent bloat)
SELECT cron.schedule(
  'cleanup-cron-history',
  '0 * * * *',
  $$ DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'; $$
);
```

---

## Key Pseudocode

### process-campaigns Edge Function

```typescript
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Use service role key — this function is called by cron, no user JWT
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    const SITE_URL = Deno.env.get('SITE_URL') || ''

    let processed = 0

    // Step 1: Process scheduled campaigns
    // Atomically claim campaigns to prevent double-sends
    const { data: scheduledCampaigns } = await supabaseAdmin
      .from('campaigns')
      .update({ status: 'active' })
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString())
      .is('deleted_at', null)
      .select('*')

    for (const campaign of scheduledCampaigns || []) {
      // Get pending enrollments for this campaign
      const { data: enrollments } = await supabaseAdmin
        .from('campaign_enrollments')
        .select('*')
        .eq('campaign_id', campaign.id)
        .eq('status', 'pending')

      if (!enrollments?.length) {
        // No pending enrollments — mark completed
        await supabaseAdmin.from('campaigns')
          .update({ status: 'completed' })
          .eq('id', campaign.id)
        continue
      }

      // Get sender profile
      const { data: profile } = await supabaseAdmin.from('profiles')
        .select('name, sending_email')
        .eq('id', campaign.sent_by)
        .single()

      if (!profile?.sending_email) {
        console.error(`Campaign ${campaign.id}: sender has no sending_email`)
        continue
      }

      // Build email batch (chunks of 100)
      const emails = enrollments.map(e => {
        let emailBody = campaign.body
          .replace(/\{\{firstName\}\}/g, '') // We don't have lead data here
          .replace(/\{\{company\}\}/g, '')
        // Unsubscribe link
        if (SITE_URL && emailBody.includes('{{unsubscribeLink}}')) {
          const token = crypto.randomUUID()
          emailBody = emailBody.replace(/\{\{unsubscribeLink\}\}/g,
            `${SITE_URL}/unsubscribe/${token}?email=${encodeURIComponent(e.email)}`)
        }
        return {
          from: `${profile.name} <${profile.sending_email}>`,
          to: [e.email],
          subject: campaign.subject,
          text: emailBody,
        }
      })

      // Send via Resend batch API
      for (let i = 0; i < emails.length; i += 100) {
        const chunk = emails.slice(i, i + 100)
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
          // Update enrollment statuses to 'sent'
          const batchEnrollments = enrollments.slice(i, i + 100)
          for (let j = 0; j < batchEnrollments.length; j++) {
            await supabaseAdmin.from('campaign_enrollments')
              .update({
                status: 'sent',
                sent_at: new Date().toISOString(),
              })
              .eq('id', batchEnrollments[j].id)

            // Also insert email record for tracking
            await supabaseAdmin.from('emails').insert({
              lead_id: batchEnrollments[j].lead_id,
              from: profile.sending_email,
              to: batchEnrollments[j].email,
              subject: campaign.subject,
              body: campaign.body,
              sent_at: new Date().toISOString(),
              read: true,
              direction: 'outbound',
              thread_id: `t-camp-${campaign.id}-${batchEnrollments[j].lead_id}`,
              campaign_id: campaign.id,
              provider_message_id: resendResults?.[j]?.id || null,
            })
          }
        }
        if (i + 100 < emails.length) await new Promise(r => setTimeout(r, 250))
      }

      // Mark campaign completed
      await supabaseAdmin.from('campaigns')
        .update({ status: 'completed' })
        .eq('id', campaign.id)
      processed++
    }

    // Step 2: Reply detection
    // Find recent inbound emails linked to campaigns (via thread matching)
    // and update lead status to 'warm'
    const { data: recentReplies } = await supabaseAdmin.from('emails')
      .select('lead_id, campaign_id')
      .eq('direction', 'inbound')
      .not('lead_id', 'is', null)
      .not('campaign_id', 'is', null)
      .gte('sent_at', new Date(Date.now() - 10 * 60 * 1000).toISOString()) // Last 10 min

    for (const reply of recentReplies || []) {
      // Update lead to warm
      await supabaseAdmin.from('leads')
        .update({ status: 'warm' })
        .eq('id', reply.lead_id)
        .neq('status', 'warm') // Don't downgrade if already warm

      // Update enrollment to 'replied'
      if (reply.campaign_id) {
        await supabaseAdmin.from('campaign_enrollments')
          .update({ status: 'replied' })
          .eq('campaign_id', reply.campaign_id)
          .eq('lead_id', reply.lead_id)
      }
    }

    return new Response(JSON.stringify({
      processed,
      scheduledProcessed: scheduledCampaigns?.length || 0,
      repliesDetected: recentReplies?.length || 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('process-campaigns error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
```

### CampaignBuilderPage — Schedule Option (Step 4)

```tsx
// Add to state:
const [scheduledAt, setScheduledAt] = useState('');
const [sendMode, setSendMode] = useState<'now' | 'schedule'>('now');

// In step 4 UI, before the Send button:
<div className="flex items-center gap-3 mb-4">
  <Button variant={sendMode === 'now' ? 'default' : 'outline'} size="sm"
    onClick={() => setSendMode('now')}>Send Now</Button>
  <Button variant={sendMode === 'schedule' ? 'default' : 'outline'} size="sm"
    onClick={() => setSendMode('schedule')}>Schedule</Button>
</div>
{sendMode === 'schedule' && (
  <Input type="datetime-local" value={scheduledAt}
    onChange={e => setScheduledAt(e.target.value)}
    min={new Date().toISOString().slice(0, 16)} />
)}

// On send:
// If sendMode === 'schedule': create campaign with status='scheduled', scheduledAt
//   + create enrollment rows for all recipients (status='pending')
//   + do NOT send emails (scheduler will handle it)
// If sendMode === 'now': existing flow (send immediately)
```

### Pause/Resume

```tsx
// CampaignDetailPage + CampaignList:
const handlePause = async (id: string) => {
  await updateCampaign(id, { status: 'paused' });
  toast.success('Campaign paused');
};
const handleResume = async (id: string) => {
  await updateCampaign(id, { status: 'active' });
  toast.success('Campaign resumed — will continue on next scheduler run');
};

// Show Pause button for active/scheduled campaigns
// Show Resume button for paused campaigns
```

---

## Task Execution Order

### Task 1: Database Migration
- Create `campaign_enrollments` table with indexes
- Set up pg_cron extension, Vault secrets, cron job

### Task 2: Update TypeScript Types
- Add `CampaignEnrollment` to `crm.ts`
- Add `campaign_enrollments` to `database.ts`

### Task 3: Create process-campaigns Edge Function
- Handles scheduled campaign sending
- Handles reply detection (lead → warm)
- Deploy with `--no-verify-jwt`

### Task 4: Update CampaignBuilderPage
- Add sendMode toggle (now/schedule) in step 4
- Add datetime-local input for scheduling
- On schedule: create campaign + enrollments, don't send
- On send now: existing flow + create enrollments

### Task 5: Update CampaignDetailPage + CampaignList
- Add Pause/Resume buttons
- Show scheduled date/time
- Update status badge colors

### Task 6: Update campaigns API + hook
- Add `pauseCampaign`, `resumeCampaign` functions
- Add enrollment creation function

### Task 7: Update email-events for enrollment tracking + reply detection
- When bounce/open/click events fire, also update the corresponding enrollment status
- In the `email.received` handler: look up the parent outbound email's `campaign_id`, set it on the inbound email row, then update the enrollment to 'replied' and lead.status to 'warm'
- This replaces the scheduler-based reply detection — it's instant via webhook

### Task 8: Set up cron-job.org backup
- Register free account
- Add job: `POST https://onthjkzdgsfvmgyhrorw.supabase.co/functions/v1/process-campaigns`
- Every 5 minutes

### Task 9: Deploy + Test
- Deploy process-campaigns Edge Function
- Test: create scheduled campaign → wait 5 min → verify sent
- Test: pause/resume flow
- Test: reply to campaign email → lead flagged as warm

### Task 10: Update Documentation

---

## Validation Gates

1. `npm run build` passes
2. process-campaigns Edge Function deploys
3. pg_cron job created and visible in Supabase dashboard
4. Create scheduled campaign → appears as "Scheduled" in list
5. After 5 min → campaign sent, status changes to "Completed"
6. Pause an active campaign → status changes to "Paused"
7. Resume → status changes back to "Active"
8. Reply to campaign email → lead status becomes "warm"
9. Enrollment table tracks per-recipient status

---

## Known Gotchas

```
1. pg_cron fires every 5 minutes — campaigns scheduled for 2:03 PM won't
   send until the 2:05 PM cron tick. This is acceptable for email campaigns.

2. The process-campaigns function uses SUPABASE_SERVICE_ROLE_KEY directly.

3. Double-send prevention: atomically UPDATE status from 'scheduled' to
   'active'. ALSO query 'active' campaigns with remaining pending enrollments
   (handles partial sends from timeouts).

4. "Send Now" flow MUST create enrollment rows client-side after
   sendBulkEmails completes. Otherwise enrollment-based analytics are empty.

5. Reply detection happens in email-events (email.received handler), NOT
   the scheduler. When an inbound email is matched to a thread, look up
   the parent outbound email's campaign_id and set it on the inbound row.
   Then update the enrollment to 'replied' and lead status to 'warm'.
   This is instant (webhook), not polling (5 min delay).

6. The process-campaigns function MUST fetch lead data (firstName, company)
   from the leads table before building emails. Use bulk SELECT with
   id = ANY(enrollment_lead_ids). Never send blank merge fields.

7. Free tier: pg_cron stops if project pauses. cron-job.org prevents this.

8. Vault secrets: use specific names (process_campaigns_project_url) and
   wrap in exception handling for idempotent re-runs.

9. pg_cron body parameter must be TEXT not JSONB: '{"source":"cron"}'
   (no ::jsonb cast).

10. Edge Function deployed with --no-verify-jwt since cron caller has no JWT.
```

---

## Deprecated Code (to remove)

None — Phase 2a adds new functionality on top of Phase 1b without replacing anything.
