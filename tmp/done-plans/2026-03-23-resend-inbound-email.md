# Plan: Inbound Email Receiving via Resend Webhooks

**Confidence: 9/10** — Small scope (1 Edge Function modification, no frontend changes). The inbox UI already handles inbound emails — we just need to pipe them in from Resend.

## Goal

When someone replies to an email sent from the CRM, the reply appears in the CRM inbox automatically. Inbound emails are received by Resend (MX record already configured on `mail.integrateapi.ai`), forwarded via webhook to a Supabase Edge Function, which fetches the full email body and inserts it into the `emails` table.

## Why

- Outbound email sending is live — but replies vanish because there's no inbound handler
- The inbox UI already renders inbound emails (`direction: 'inbound'`, left-aligned, gray background) — it just has no real inbound data
- Without inbound, the CRM is send-only, which defeats the purpose of a Gmail-clone email system

## What

### User-Visible Behavior

1. CRM user sends an email to `john@somecompany.com` from `sarah@mail.integrateapi.ai`
2. John replies in his Gmail
3. Within seconds, the reply appears in the CRM inbox — same thread, marked unread (blue dot)
4. CRM user clicks the thread → sees the full conversation (their outbound + John's reply)
5. CRM user can reply again → proper threading continues

### Success Criteria

- [ ] Inbound email webhook handler processes `email.received` events
- [ ] Email body fetched from Resend API (not in webhook payload)
- [ ] Thread matching works via `In-Reply-To` header → links to existing thread
- [ ] New conversations (not replies) create a new thread
- [ ] Lead matching works via sender email → links to CRM lead
- [ ] Inbound emails stored with `direction: 'inbound'`, `read: false`
- [ ] Inbox UI shows inbound emails in threads with unread indicator
- [ ] `npm run build` passes
- [ ] All changes documented in relevant `.md` files

---

## Files Being Changed

```
supabase/
├── functions/
│   └── email-events/
│       └── index.ts                        ← MODIFIED (add email.received handler)
docs/
├── outreach.md                             ← MODIFIED (inbound now works, update limitations)
├── schema.md                               ← MODIFIED (note email-events handles inbound)
├── OVERVIEW.md                             ← MODIFIED (major changes log)
```

---

## Architecture Overview

### Before
```
Someone replies to CRM email
  → Email goes to mail.integrateapi.ai
    → Resend receives it (MX record)
      → Fires email.received webhook to email-events Edge Function
        → Handler has no case for email.received → ignored
          → Reply is LOST
```

### After
```
Someone replies to CRM email
  → Email goes to mail.integrateapi.ai
    → Resend receives it (MX record)
      → Fires email.received webhook to email-events Edge Function
        → Handler:
          1. Extract email_id from webhook payload
          2. Fetch full email (body + headers) from Resend API
          3. Extract In-Reply-To header → find parent email in DB → get threadId
          4. Match sender address against leads table → get leadId
          5. Insert into emails table (direction: 'inbound', read: false)
        → Email appears in CRM inbox immediately
```

### Key Design Decisions

1. **Modify existing `email-events` Edge Function** — don't create a new function. The webhook is already configured and pointing at this endpoint. Just add a `case 'email.received'` handler.

2. **Two-step fetch** — webhook payload only has metadata (no body/headers). Must call `GET /emails/receiving/{id}` to get the full email.

3. **Thread matching via `In-Reply-To` header** — the inbound email's `In-Reply-To` header contains the `Message-ID` of the email it's replying to. Look up `provider_message_id` in our emails table to find the parent → reuse its `thread_id`.

4. **Lead matching via sender email** — look up the `from` address against `leads.email` to link the inbound email to a CRM lead.

5. **New thread for non-replies** — if no `In-Reply-To` header (or no matching parent), create a new thread with `crypto.randomUUID()`.

6. **Activity logging** — if a lead is matched, create an `email_received` activity for the timeline.

---

## All Needed Context

### Documentation & References

```yaml
- url: https://resend.com/docs/api-reference/emails/retrieve-received-email
  why: GET /emails/receiving/{id} — returns body, headers, message_id

- url: https://resend.com/docs/webhooks/emails/received
  why: email.received webhook payload format

- url: https://resend.com/docs/dashboard/receiving/reply-to-emails
  why: Threading via In-Reply-To and References headers

- file: supabase/functions/email-events/index.ts
  why: The file being modified — existing bounce/open/click handlers

- file: src/pages/OutreachPage.tsx (lines 85-108)
  why: Thread building logic — shows how threadId groups emails into conversations
```

### Known Gotchas

```
1. The webhook payload does NOT include email body or headers. You MUST call
   GET https://api.resend.com/emails/receiving/{email_id} to get them.
   This requires RESEND_API_KEY in the Edge Function.

2. The `headers` object from the API uses lowercase keys (e.g., 'in-reply-to',
   'references', 'message-id'). Normalize with toLowerCase() when looking up.

3. The `from` field in the webhook is format "Name <email@domain>". Parse out
   just the email address for lead matching: extract between < and >.

4. The `to` field is an array of strings in the same "Name <email>" format.

5. Thread matching: look for In-Reply-To header → match against provider_message_id
   in emails table → reuse that email's thread_id. If no match, create new thread.

6. If the inbound email has no In-Reply-To header (someone emailed cold, not a reply),
   it's a brand new conversation. Create a new thread_id.

7. The webhook is already configured and fires email.received events. We just
   need to handle them in the existing email-events function.

8. The existing webhook already has RESEND_WEBHOOK_SECRET for signature
   verification. No new secrets needed.

9. RESEND_API_KEY must be available in the email-events Edge Function for the
   body fetch call. It's already set as a Supabase secret from the send-email setup.

10. Inbound emails should store the Resend email_id as provider_message_id
    (for consistency with outbound emails and future tracking).

11. Also store the RFC 2822 Message-ID from the API response headers as a
    reference — but provider_message_id (Resend's UUID) is the primary key
    for webhook event matching.

12. THREAD MATCHING GOTCHA: Resend's outbound emails get a Message-ID like
    "uuid@resend.dev" but we store just the UUID as provider_message_id.
    When Gmail replies, In-Reply-To contains the full "uuid@resend.dev".
    Use LIKE matching (split on @ and match the UUID prefix) to handle this.

13. IDEMPOTENCY: Resend webhooks can fire multiple times for the same event.
    Check if provider_message_id already exists in the emails table before
    inserting to prevent duplicate messages in the inbox.

14. ERROR HANDLING: Destructure the insert result and check for errors.
    Log failures — don't silently drop inbound emails.

15. ACTIVITY USER_ID: The user_id for email_received activities must be the
    lead's assigned_to (a profile UUID), NOT the lead's own ID.
    Fetch assigned_to in the same query as the lead lookup.
```

---

## Key Pseudocode

### email.received Handler (addition to email-events/index.ts)

```typescript
case 'email.received': {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set, cannot fetch inbound email body')
    break
  }

  // event.data.email_id is confirmed present in email.received payloads
  const inboundEmailId = event.data.email_id
  const fromRaw = event.data.from        // "John Doe <john@company.com>"
  const toRaw = event.data.to            // ["sarah@mail.integrateapi.ai"]
  const subject = event.data.subject || '(no subject)'

  // Idempotency: check if we already processed this email
  const { data: existing } = await supabaseAdmin.from('emails')
    .select('id')
    .eq('provider_message_id', inboundEmailId)
    .maybeSingle()

  if (existing) {
    console.log(`Duplicate webhook for email ${inboundEmailId}, skipping`)
    break
  }

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
  const body = emailData.text || emailData.html || ''
  const headers = emailData.headers || {}

  // Step 2: Parse email addresses
  // from: extract email from "Name <email>" format
  const fromMatch = fromRaw.match(/<(.+?)>/)
  const fromEmail = fromMatch ? fromMatch[1] : fromRaw
  // to: take first recipient only (CRM receives on one address)
  const toMatch = toRaw[0]?.match(/<(.+?)>/)
  const toEmail = toMatch ? toMatch[1] : (toRaw[0] || '')

  // Step 3: Thread matching via In-Reply-To header
  // Headers from Resend API use lowercase keys
  const inReplyTo = headers['in-reply-to'] || headers['In-Reply-To'] || null
  let threadId: string | null = null
  let replyToId: string | null = null

  if (inReplyTo) {
    // Strip angle brackets: <abc123@resend.dev> → abc123@resend.dev
    const cleanId = inReplyTo.replace(/[<>]/g, '')

    // Resend's outbound Message-ID may be "uuid@resend.dev" but we store
    // just the uuid as provider_message_id. Use LIKE to match both formats.
    const { data: parentEmail } = await supabaseAdmin.from('emails')
      .select('id, thread_id')
      .like('provider_message_id', cleanId.split('@')[0] + '%')
      .limit(1)
      .maybeSingle()

    if (parentEmail) {
      threadId = parentEmail.thread_id
      replyToId = parentEmail.id
    }
  }

  // If no thread match, create a new thread
  if (!threadId) {
    threadId = crypto.randomUUID()
  }

  // Step 4: Match sender to a CRM lead (include assigned_to for activity logging)
  const { data: lead } = await supabaseAdmin.from('leads')
    .select('id, assigned_to')
    .eq('email', fromEmail)
    .is('deleted_at', null)
    .maybeSingle()

  // Step 5: Insert inbound email (with error handling)
  const { error: insertErr } = await supabaseAdmin.from('emails').insert({
    lead_id: lead?.id || null,
    from: fromEmail,
    to: toEmail,
    subject,
    body,
    sent_at: event.created_at,
    read: false,
    direction: 'inbound',
    thread_id: threadId,
    reply_to_id: replyToId,
    provider_message_id: inboundEmailId,
  })

  if (insertErr) {
    console.error('Failed to insert inbound email:', insertErr)
    break
  }

  // Step 6: Log activity if lead matched (assigned_to already fetched in Step 4)
  if (lead?.id && lead.assigned_to) {
    await supabaseAdmin.from('activities').insert({
      lead_id: lead.id,
      user_id: lead.assigned_to,
      type: 'email_received',
      description: `Received email from ${fromEmail}: "${subject}"`,
      timestamp: event.created_at,
    })
  }

  console.log(`Inbound email processed: ${fromEmail} → ${toEmail}, thread: ${threadId}`)
  break
}
```

---

## Task Execution Order

### Task 1: Update email-events Edge Function

Modify `supabase/functions/email-events/index.ts`:
- Add `case 'email.received'` to the switch statement
- Implement the full handler following the pseudocode above
- The handler: fetches body from Resend API, matches thread via In-Reply-To, matches lead via sender email, inserts email row, logs activity

### Task 2: Deploy the updated Edge Function (BEFORE updating webhook)

Deploy first so the handler exists before Resend starts sending `email.received` events:

```bash
SUPABASE_ACCESS_TOKEN=... npx supabase functions deploy email-events --no-verify-jwt --project-ref onthjkzdgsfvmgyhrorw
```

### Task 3: Update the webhook to include email.received events (AFTER deploy)

The existing webhook (`4b39a45b-9053-46fd-8d42-96c1d4c9741f`) was created with only `email.bounced`, `email.opened`, `email.clicked`, `email.complained`. We need to add `email.received`.

Update via Resend API:
```bash
curl -X PATCH 'https://api.resend.com/webhooks/4b39a45b-9053-46fd-8d42-96c1d4c9741f' \
  -H 'Authorization: Bearer <RESEND_API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"events": ["email.bounced", "email.opened", "email.clicked", "email.complained", "email.received"]}'
```

### Task 4: Smoke test

Send a test email FROM the CRM to `nkpardon8@gmail.com`. Then reply from Gmail. Verify:
1. The reply appears in the CRM database (check `emails` table for `direction = 'inbound'`)
2. The reply has the correct `thread_id` (matches the outbound email's thread)
3. The inbox UI shows the thread with both messages

### Task 5: Update documentation

**`docs/outreach.md`:**
- Update inbox section to note inbound emails are received via Resend webhooks
- Remove "Inbound email receiving requires Resend Pro" from limitations (it's on free tier)
- Add changelog entry

**`docs/schema.md`:**
- Update email-events Edge Function description to include `email.received` handling
- Add changelog entry

**`docs/OVERVIEW.md`:**
- Major Changes Log entry for inbound email

---

## Validation Gates

1. `npm run build` passes
2. Edge Function deploys successfully
3. Webhook updated to include `email.received`
4. Send email from CRM to `nkpardon8@gmail.com` → arrives in Gmail
5. Reply from Gmail → reply appears in CRM database within seconds
6. Reply has correct `thread_id` linking it to the original conversation
7. CRM inbox UI shows the thread with both outbound + inbound messages
8. Lead is matched (if sender email matches a lead in the system)
9. Activity logged for matched leads

---

## Deprecated Code (to remove)

None — this adds a new case to the existing switch statement. No existing code is replaced.
