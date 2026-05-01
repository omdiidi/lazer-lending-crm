# Plan: Resend Email Integration — Real Email Sending + Event Tracking

**Confidence: 9/10** — Well-defined scope (2 Edge Functions, 1 migration, frontend wiring). The main complexity is correctly wiring the send flow through the Edge Function while keeping the existing DB write pattern working alongside it.

## Goal

Wire compose, reply, and campaign email sends to actually deliver via Resend. Add webhook-based event tracking for bounces, opens, and clicks. Emails sent from the CRM will land in real inboxes. Bounced emails automatically mark the lead's `email_status` as `invalid`.

## Why

- The Outreach page is fully built but emails only save to the database — nothing is actually delivered
- Users expect compose/reply/campaign to send real emails
- Bounce tracking protects domain reputation by auto-flagging invalid leads
- Open/click tracking gives users insight into campaign performance
- This is the last piece to make the Outreach page a functional email tool

## What

### User-Visible Behavior

1. **Compose:** User writes an email, clicks Send → email is delivered to the recipient's real inbox AND saved to CRM database
2. **Reply:** User replies in a thread → reply is delivered with proper threading headers (appears in same thread in recipient's Gmail/Outlook)
3. **Campaign:** User sends to N recipients → each email is delivered via Resend's batch API AND saved to CRM
4. **Bounce handling:** If an email bounces, the lead's `email_status` is set to `invalid` — they're automatically excluded from future sends
5. **Open/click tracking:** `opened_at` and `clicked_at` timestamps populated on emails via webhooks
6. **Sending guard:** Users must set their `sendingEmail` in Settings before they can send (no fallback to auth email)

### Success Criteria

- [ ] Compose send delivers real email via Resend
- [ ] Reply delivers with correct `In-Reply-To` + `References` headers (threading works)
- [ ] Campaign sends deliver via Resend batch API
- [ ] All sent emails have `provider_message_id` stored
- [ ] Bounce webhook marks lead `email_status = 'invalid'`
- [ ] Open/click webhooks populate `opened_at`/`clicked_at` on emails
- [ ] Users without `sendingEmail` see a prompt to set it, cannot send
- [ ] `npm run build` passes
- [ ] All changes documented in relevant `.md` files

---

## Files Being Changed

```
supabase/
├── functions/
│   ├── send-email/
│   │   └── index.ts                        ← NEW (Edge Function — sends via Resend API)
│   └── email-events/
│       └── index.ts                        ← NEW (Edge Function — webhook for bounce/open/click)
src/
├── types/
│   ├── crm.ts                              ← MODIFIED (add providerMessageId, openedAt, clickedAt, bouncedAt to EmailMessage)
│   └── database.ts                         ← MODIFIED (add columns to emails table type)
├── lib/
│   └── api/
│       └── send-email.ts                   ← NEW (client function to invoke send-email Edge Function)
├── pages/
│   └── OutreachPage.tsx                    ← MODIFIED (wire sends through Edge Function, add sendingEmail guard)
docs/
├── OVERVIEW.md                             ← MODIFIED (major changes log)
├── outreach.md                             ← MODIFIED (email sending now real, tracking added)
├── schema.md                               ← MODIFIED (new columns, new Edge Functions)
├── settings.md                             ← MODIFIED (note sendingEmail is required for sending)
├── architecture.md                         ← MODIFIED (new Edge Functions)
```

---

## Architecture Overview

### Before (current)
```
User clicks Send
  → addEmail() / addEmailAsync()
    → supabase.from('emails').insert(...)
    → Email saved to DB
    → NOTHING IS DELIVERED — recipient never sees it
```

### After
```
User clicks Send
  → sendEmailViaResend() — calls Edge Function
    → Edge Function:
      1. Calls Resend API (POST /emails) with from, to, subject, html, headers
      2. Gets back Resend message ID
      3. Inserts email row into DB (with provider_message_id)
      4. Returns the created email to frontend
    → Frontend receives the email, React Query cache invalidated
    → Recipient gets a REAL email in their inbox

Webhook (async, minutes/hours later):
  → Resend fires event to email-events Edge Function
    → email.bounced → update lead.email_status = 'invalid'
    → email.opened → update email.opened_at
    → email.clicked → update email.clicked_at
```

### Key Design Decisions

1. **Edge Function does BOTH the Resend API call AND the DB insert** — this ensures atomicity. If Resend fails, no DB row is created. If DB fails after Resend succeeds, we log the error but the email was still delivered.

2. **Frontend calls `sendEmailViaResend()` instead of `addEmail()`** — the Edge Function replaces the direct DB insert for outbound emails. `addEmail()` is kept for internal use (e.g., if we later add inbound email processing).

3. **`from` address uses `user.sendingEmail`** — the `@mail.integrateapi.ai` address verified in Resend. Users MUST set this in Settings before sending.

4. **Campaign sends use Resend's batch API** — up to 100 emails per request. For larger campaigns, chunk into batches.

5. **Webhook Edge Function is publicly accessible (no JWT)** — Resend can't authenticate with Supabase JWTs. Instead, we verify the webhook signature using the svix signing secret.

6. **`provider_message_id` stored on every outbound email** — this is the Resend UUID returned from the send API. It's the key that links webhook events back to our email records.

---

## All Needed Context

### Documentation & References

```yaml
- url: https://resend.com/docs/api-reference/emails/send-email
  why: Send email API — request body, response, headers field for threading

- url: https://resend.com/docs/api-reference/emails/send-batch-emails
  why: Batch send — max 100 per request, no attachments

- url: https://resend.com/docs/dashboard/webhooks/event-types
  why: Webhook event types and payloads (bounced, opened, clicked)

- url: https://resend.com/docs/webhooks/verify-webhooks-requests
  why: Svix signature verification for webhook security

- url: https://resend.com/docs/send-with-supabase-edge-functions
  why: Official Supabase integration guide

- file: supabase/functions/campaign-ai/index.ts
  why: Reference pattern for Edge Functions (CORS, error handling)

- file: src/pages/OutreachPage.tsx
  why: The page being modified — compose, reply, campaign send handlers

- file: src/lib/api/emails.ts
  why: Existing createEmail function — Edge Function replaces this for outbound

- file: src/hooks/use-emails.ts
  why: Existing hook — addEmail/addEmailAsync mutations
```

### Known Gotchas

```
1. Resend send response ONLY returns { id: "uuid" } — no message_id header.
   The `id` IS the provider_message_id used to match webhook events.

2. Resend batch API does NOT support attachments or scheduled_at.
   Use single send for emails with attachments (future feature).

3. Webhook Edge Function must be deployed with --no-verify-jwt flag
   (or verify_jwt: false in the deploy config) since Resend can't send JWTs.
   Security comes from svix signature verification instead.

4. Svix verification requires the RAW request body string — not re-parsed JSON.
   Use `await req.text()` then verify, THEN `JSON.parse()`.

5. The webhook signing secret (whsec_xxx) must be stored as a Supabase secret.
   Get it from the Resend dashboard when creating the webhook endpoint.

6. The `from` field format should be "Name <email>" e.g.,
   "Sarah Chen <sarah@mail.integrateapi.ai>"

7. Campaign emails are sent via batch API (100/request). For >100 recipients,
   chunk into multiple batch calls with a small delay between them.

8. The email-events webhook receives `data.email_id` which matches our
   `provider_message_id`. Use this to look up the email row and update it.

9. For bounce events, we need to find the LEAD associated with the email
   to update their email_status. Join emails.lead_id → leads.id.

10. Rate limit: 5 requests/second across all API calls. Campaign sends
    with batch API (100 emails/request) are efficient — a 500-lead campaign
    needs only 5 API calls.

11. Free tier: 100 emails/day, 3000/month. Sufficient for development.

12. The `from` address MUST be on a verified domain. The user's sendingEmail
    must use the mail.integrateapi.ai domain (already verified in Resend).
    If sendingEmail is not set, block sending with a UI message.

13. For threading, store the Resend message ID as provider_message_id.
    When replying, set In-Reply-To to the previous email's provider_message_id.
    Build References from all prior provider_message_ids in the thread.

14. SECURITY: The send-email Edge Function MUST validate that the `from` address
    in the request matches the authenticated user's `sending_email` from their
    profile. Otherwise any authenticated user could spoof another user's address.
    Look up the profile in the Edge Function and enforce the match.

15. handleSendEmail and handleSendReply in OutreachPage are currently SYNCHRONOUS
    functions (not async). They MUST be converted to async for await/try-catch
    to work. This is load-bearing, not optional.

16. Svix webhook signature verification: Do NOT implement manual HMAC. Import
    the svix package via esm.sh: `import { Webhook } from 'https://esm.sh/svix'`
    and use `new Webhook(secret).verify(rawBody, headers)`. Manual base64
    comparison has encoding mismatches that will reject all real webhooks.

17. The Forward feature currently sets `to: ''` (empty string). Resend will
    reject this with 4xx. For now, disable the forward Send button when
    toAddress is empty. Forward is an existing known limitation.

18. Campaign batch sends can partially fail — some chunks succeed, others don't.
    The Edge Function should track `failedCount` and return it in the response.
    The frontend should show a warning toast if any sends failed.

19. The bounce handler should combine the update + select into a single query:
    `.update({ bounced_at }).eq('provider_message_id', emailId).select('lead_id').single()`
    Same for complaint handler — also set bounced_at on the email row.

20. If threadId is not provided in the request, the Edge Function should
    generate one via `crypto.randomUUID()` to prevent client-side collisions.

21. The smoke test MUST use a real user JWT (obtained via Supabase auth),
    NOT the anon key. The anon key has no user identity and getUser() returns null.

22. src/lib/api/emails.ts is intentionally NOT modified. Its createEmail()
    is kept for internal/inbound use. Only the CALL SITES in OutreachPage change.
```

---

## DB Migration

```sql
-- Add tracking columns to emails table
ALTER TABLE emails ADD COLUMN IF NOT EXISTS provider_message_id text;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS opened_at timestamptz;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS clicked_at timestamptz;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS bounced_at timestamptz;
```

---

## Key Pseudocode

### Send Email Edge Function (`supabase/functions/send-email/index.ts`)

```typescript
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: 'Resend API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const authHeader = req.headers.get('Authorization')!
    const { emails } = await req.json()
    // emails is an array of: { leadId, from, to, subject, body, threadId, replyToId, fromName }

    // Create Supabase admin client for DB operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Get user from JWT and validate sendingEmail
    const jwt = authHeader.replace('Bearer ', '')
    const { data: { user: authUser } } = await supabaseAdmin.auth.getUser(jwt)
    if (!authUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Look up profile to verify sending_email
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('sending_email, name')
      .eq('id', authUser.id)
      .single()

    if (!profile?.sending_email) {
      return new Response(JSON.stringify({ error: 'Sending email not configured. Set it in Settings.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Enforce that from address matches the user's configured sending_email
    const validFrom = profile.sending_email
    const senderName = profile.name

    // For threading: look up provider_message_ids of prior emails in thread
    async function getThreadingHeaders(threadId?: string, replyToId?: string) {
      if (!replyToId || !threadId) return {}

      // Get the email being replied to
      const { data: replyTo } = await supabaseAdmin
        .from('emails')
        .select('provider_message_id')
        .eq('id', replyToId)
        .single()

      // Get all prior emails in thread for References header
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
          .map(e => `<${e.provider_message_id}>`)
          .join(' ')
      }
      return headers
    }

    const results = []

    // Send via Resend — batch if multiple, single if one
    if (emails.length === 1) {
      const email = emails[0]
      const threadingHeaders = await getThreadingHeaders(email.threadId, email.replyToId)

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${senderName} <${validFrom}>`,  // Always use validated profile address
          to: [email.to],
          subject: email.subject,
          text: email.body,
          headers: Object.keys(threadingHeaders).length > 0 ? threadingHeaders : undefined,
        }),
      })

      if (!resendRes.ok) {
        const err = await resendRes.json()
        return new Response(JSON.stringify({ error: err.message || 'Resend send failed' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const { id: providerMessageId } = await resendRes.json()

      // Insert into DB with provider_message_id
      const { data: row, error: dbErr } = await supabaseAdmin.from('emails').insert({
        lead_id: email.leadId || null,
        from: email.from,
        to: email.to,
        subject: email.subject,
        body: email.body,
        sent_at: new Date().toISOString(),
        read: true,
        direction: 'outbound',
        thread_id: email.threadId || null,
        reply_to_id: email.replyToId || null,
        provider_message_id: providerMessageId,
      }).select().single()

      if (dbErr) console.error('DB insert failed after send:', dbErr)
      results.push(row)

    } else {
      // Batch send — chunk into groups of 100
      let failedCount = 0
      for (let i = 0; i < emails.length; i += 100) {
        const chunk = emails.slice(i, i + 100)
        const resendBatch = chunk.map((email: Record<string, string>) => ({
          from: `${senderName} <${validFrom}>`,  // Always use validated profile address
          to: [email.to],
          subject: email.subject,
          text: email.body,
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
          console.error('Resend batch failed:', resendRes.status)
          failedCount += chunk.length
          continue
        }

        const { data: resendResults } = await resendRes.json()

        // Insert all into DB with provider_message_ids
        const rows = chunk.map((email: Record<string, string>, idx: number) => ({
          lead_id: email.leadId || null,
          from: email.from,
          to: email.to,
          subject: email.subject,
          body: email.body,
          sent_at: new Date().toISOString(),
          read: true,
          direction: 'outbound',
          thread_id: email.threadId || null,
          reply_to_id: null,
          provider_message_id: resendResults?.[idx]?.id || null,
        }))

        const { data: inserted, error: dbErr } = await supabaseAdmin
          .from('emails')
          .insert(rows)
          .select()

        if (dbErr) console.error('DB batch insert failed:', dbErr)
        results.push(...(inserted || []))

        // Delay between batch API calls
        if (i + 100 < emails.length) await new Promise(r => setTimeout(r, 250))
      }
    }

    return new Response(JSON.stringify({ emails: results, count: results.length, failedCount: failedCount || 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('send-email error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
```

### Email Events Webhook (`supabase/functions/email-events/index.ts`)

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Webhook } from 'https://esm.sh/svix'

// NO CORS needed — this is called by Resend servers, not browsers
// NO JWT verification — Resend can't send JWTs
// Security: verify svix signature

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET')
    const rawBody = await req.text()

    // Verify svix signature
    if (WEBHOOK_SECRET) {
      const wh = new Webhook(WEBHOOK_SECRET)
      try {
        wh.verify(rawBody, {
          'svix-id': req.headers.get('svix-id') || '',
          'svix-timestamp': req.headers.get('svix-timestamp') || '',
          'svix-signature': req.headers.get('svix-signature') || '',
        })
      } catch {
        return new Response('Invalid signature', { status: 401 })
      }
    }

    const event = JSON.parse(rawBody)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const emailId = event.data?.email_id // Resend's ID = our provider_message_id
    if (!emailId) return new Response('OK', { status: 200 })

    switch (event.type) {
      case 'email.bounced': {
        // Combined update + select in one query
        const { data: email } = await supabaseAdmin.from('emails')
          .update({ bounced_at: event.created_at })
          .eq('provider_message_id', emailId)
          .select('lead_id')
          .single()

        if (email?.lead_id) {
          await supabaseAdmin.from('leads')
            .update({ email_status: 'invalid' })
            .eq('id', email.lead_id)
        }
        break
      }

      case 'email.opened': {
        await supabaseAdmin.from('emails')
          .update({ opened_at: event.created_at })
          .eq('provider_message_id', emailId)
        break
      }

      case 'email.clicked': {
        await supabaseAdmin.from('emails')
          .update({ clicked_at: event.created_at })
          .eq('provider_message_id', emailId)
        break
      }

      case 'email.complained': {
        // Spam complaint — treat same as bounce
        const { data: email } = await supabaseAdmin.from('emails')
          .update({ bounced_at: event.created_at })
          .eq('provider_message_id', emailId)
          .select('lead_id')
          .single()

        if (email?.lead_id) {
          await supabaseAdmin.from('leads')
            .update({ email_status: 'invalid' })
            .eq('id', email.lead_id)
        }
        break
      }
    }

    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error('email-events error:', err)
    return new Response('Internal error', { status: 500 })
  }
})
```

### Client API Function (`src/lib/api/send-email.ts`)

```typescript
import { supabase } from '@/lib/supabase';

interface SendEmailRequest {
  leadId?: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  replyToId?: string;
}

export async function sendEmail(email: SendEmailRequest) {
  const { data, error } = await supabase.functions.invoke('send-email', {
    body: { emails: [email] },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function sendBulkEmails(emails: SendEmailRequest[]) {
  const { data, error } = await supabase.functions.invoke('send-email', {
    body: { emails },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
```

### OutreachPage Changes

```typescript
// Import sendEmail, sendBulkEmails from @/lib/api/send-email
// Replace addEmail/addEmailAsync calls with sendEmail/sendBulkEmails
// Add sendingEmail guard at the top of each send handler

// CRITICAL: Convert handleSendEmail and handleSendReply from sync to async:
// Before: const handleSendEmail = () => {
// After:  const handleSendEmail = async () => {
// Same for handleSendReply.

// GUARD — add at the start of handleSendEmail, handleSendReply, handleSendCampaign:
if (!user?.sendingEmail) {
  toast.error('Set your sending email in Settings before sending');
  return;
}

// FORWARD GUARD — in handleSendReply, after computing toAddress:
if (!toAddress) {
  toast.error('Forward requires a recipient address');
  return;
  // Note: forward is a known limitation — the existing code sets to='' for forwards.
  // This guard prevents a Resend 4xx error. Full forward support is a future feature.
}

// COMPOSE — replace addEmail call:
// Before: addEmail({ leadId, from: user!.email, to: lead.email, ... })
// After:
await sendEmail({
  leadId: toLeadId,
  from: user!.sendingEmail,
  fromName: user!.name,
  to: lead.email,
  subject: subject.trim(),
  body: body.trim(),
  threadId: `t-${Date.now()}`,
});
// Remove the separate addEmail call — Edge Function handles DB insert

// REPLY — replace addEmail call:
// Before: addEmail({ leadId, from: user!.email, to: toAddress, ... })
// After:
await sendEmail({
  leadId: selectedThread.leadId,
  from: user!.sendingEmail,
  fromName: user!.name,
  to: toAddress,
  subject: newSubject,
  body: replyBody.trim(),
  threadId: selectedThread.id,
  replyToId: lastMsg.id,
});

// CAMPAIGN — replace the for loop of addEmailAsync calls:
// Before: for (const leadId of recipientIds) { await addEmailAsync({...}) }
// After:
const campaignEmails = recipientIds.map(leadId => {
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return null;
  return {
    leadId,
    from: user!.sendingEmail!,
    fromName: user!.name,
    to: lead.email,
    subject: campaignSubject.trim()
      .replace('{{firstName}}', lead.firstName)
      .replace('{{company}}', lead.company),
    body: campaignBody.trim()
      .replace(/\{\{firstName\}\}/g, lead.firstName)
      .replace(/\{\{company\}\}/g, lead.company),
    threadId: `t-camp-${Date.now()}-${leadId}`,
  };
}).filter(Boolean);
const result = await sendBulkEmails(campaignEmails);
if (result?.failedCount > 0) {
  toast.warning(`${result.failedCount} of ${campaignEmails.length} emails failed to send`);
}

// Activity logging stays the same — keep the addActivity calls
// React Query invalidation: after sendEmail/sendBulkEmails completes,
// call queryClient.invalidateQueries({ queryKey: ['emails'] }) to refresh inbox
```

---

## Task Execution Order

### Task 1: Database Migration

Add tracking columns to emails table:
```sql
ALTER TABLE emails ADD COLUMN IF NOT EXISTS provider_message_id text;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS opened_at timestamptz;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS clicked_at timestamptz;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS bounced_at timestamptz;
```

### Task 2: Update TypeScript Types

**`src/types/crm.ts`** — Add to EmailMessage interface:
- `providerMessageId?: string`
- `openedAt?: string`
- `clickedAt?: string`
- `bouncedAt?: string`

**`src/types/database.ts`** — Add to emails Row/Insert/Update:
- `provider_message_id: string | null` (Row)
- `provider_message_id?: string | null` (Insert/Update)
- `opened_at: string | null`, `clicked_at: string | null`, `bounced_at: string | null` (Row)
- Same as optional for Insert/Update

### Task 3: Create send-email Edge Function

Create `supabase/functions/send-email/index.ts` following pseudocode above.
- Single send with threading headers (In-Reply-To, References)
- Batch send for campaigns (chunks of 100)
- DB insert with provider_message_id
- User auth via JWT
- Error handling

### Task 4: Create email-events Webhook Edge Function

Create `supabase/functions/email-events/index.ts` following pseudocode above.
- Handle: email.bounced, email.opened, email.clicked, email.complained
- Bounce/complaint → update lead.email_status = 'invalid'
- Open/click → update email.opened_at/clicked_at
- Svix signature verification
- **Deploy with `--no-verify-jwt` flag** (Resend can't send JWTs)

### Task 5: Create client API function

Create `src/lib/api/send-email.ts`:
- `sendEmail()` — single email via Edge Function
- `sendBulkEmails()` — batch via Edge Function

### Task 6: Update OutreachPage

**`src/pages/OutreachPage.tsx`:**
- Import `sendEmail`, `sendBulkEmails` from `@/lib/api/send-email`
- Import `toast` from `sonner`
- Add `sendingEmail` guard to compose, reply, and campaign handlers
- Replace `addEmail`/`addEmailAsync` calls with `sendEmail`/`sendBulkEmails`
- Keep `addActivity` calls (activity logging stays)
- Add `queryClient.invalidateQueries({ queryKey: ['emails'] })` after successful sends
- Remove direct `addEmail` calls for outbound sends (Edge Function handles DB insert)
- Campaign: replace the per-recipient for-loop with a single `sendBulkEmails` call
- Make `handleSendEmail` and `handleSendReply` async (if not already)
- Add try/catch with toast.error for send failures

### Task 7: Deploy Edge Functions and Set Secrets

```bash
SUPABASE_ACCESS_TOKEN=... npx supabase functions deploy send-email --project-ref onthjkzdgsfvmgyhrorw
SUPABASE_ACCESS_TOKEN=... npx supabase functions deploy email-events --no-verify-jwt --project-ref onthjkzdgsfvmgyhrorw
SUPABASE_ACCESS_TOKEN=... npx supabase secrets set RESEND_API_KEY=<from .env> --project-ref onthjkzdgsfvmgyhrorw
```

**After deploying email-events:** configure the webhook in Resend dashboard:
1. Go to Resend Dashboard → Webhooks → Add Webhook
2. Endpoint URL: `https://onthjkzdgsfvmgyhrorw.supabase.co/functions/v1/email-events`
3. Select events: email.bounced, email.opened, email.clicked, email.complained
4. Save → copy the signing secret (whsec_xxx)
5. `npx supabase secrets set RESEND_WEBHOOK_SECRET=whsec_xxx`

### Task 8: Smoke test

Test single send:
```bash
curl -X POST 'https://onthjkzdgsfvmgyhrorw.supabase.co/functions/v1/send-email' \
  -H 'Authorization: Bearer <SUPABASE_ANON_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"emails":[{"from":"test@mail.integrateapi.ai","fromName":"Test","to":"<YOUR_REAL_EMAIL>","subject":"CRM Test","body":"This is a test from IntegrateAPI CRM","threadId":"t-test-1"}]}'
```

Verify: check your real inbox for the email. Check the DB for `provider_message_id` populated.

### Task 9: Update Documentation

**`docs/outreach.md`:**
- Update compose/reply/campaign sections to note emails are now delivered via Resend
- Note threading headers (In-Reply-To, References) for reply threading
- Add tracking section (bounces, opens, clicks via webhooks)
- Update Known Limitations: remove "No real email sending/receiving", "No SMTP/Gmail/Outlook integration"
- Add: "Inbound email receiving requires Resend Pro upgrade ($20/mo)"
- Update changelog

**`docs/schema.md`:**
- Add provider_message_id, opened_at, clicked_at, bounced_at to emails table
- Add send-email and email-events to Edge Functions section
- Update changelog

**`docs/architecture.md`:**
- Add send-email and email-events Edge Functions
- Update changelog

**`docs/settings.md`:**
- Note that sendingEmail is required for sending emails
- Update changelog

**`docs/OVERVIEW.md`:**
- Major Changes Log entry
- Update Outreach status from "Partial" to "Active"

---

## Validation Gates

1. `npm run build` passes with zero errors
2. send-email Edge Function deploys successfully
3. email-events Edge Function deploys with --no-verify-jwt
4. Smoke test: curl send-email → real email delivered to your inbox
5. DB check: email row has provider_message_id populated
6. Login → Outreach → Compose → send to your real email → arrives in inbox
7. Reply to a thread → reply arrives with correct threading in inbox
8. Campaign send → all recipients receive personalized emails
9. User without sendingEmail → sees error message, cannot send
10. (Manual) Trigger a bounce → lead's email_status updates to 'invalid'

---

## Deprecated Code (to remove)

| Code | File | Reason |
|------|------|--------|
| Direct `addEmail()` calls for outbound in compose handler | OutreachPage.tsx | Replaced by `sendEmail()` through Edge Function |
| Direct `addEmailAsync()` calls in reply handler | OutreachPage.tsx | Replaced by `sendEmail()` |
| Per-recipient `addEmailAsync()` loop in campaign handler | OutreachPage.tsx | Replaced by `sendBulkEmails()` batch call |

Note: `addEmail()` and `addEmailAsync()` are NOT removed from the hook — they're still used for potential future inbound email processing and internal operations. Only the CALLS in OutreachPage for outbound sends are replaced.
