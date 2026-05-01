# Plan: HTML email sending with open + click tracking

## Goal

Enable open and click tracking for all campaign emails by sending HTML alongside plain text. Currently all emails go out as plain text only — Resend cannot instrument plain text for tracking. The webhook and DB columns already exist; the only missing piece is HTML in the send payload.

## Why

- `email.clicked` and `email.opened` webhooks from Resend require HTML in the email to work — Resend rewrites `<a href>` tags for click tracking and injects a 1×1 pixel for open tracking
- The `email-events` edge function is already deployed and handling webhooks correctly; `clicked_at` / `opened_at` columns exist on the `emails` table
- The `CampaignAnalytics` cards (Opened %, Clicked %, etc.) and per-recipient "Clicked"/"Opened" badges on the detail page already exist — they just show 0% because no data flows without HTML
- Once fixed, all existing UI will automatically start showing real numbers

## What

- Add a `plainTextToHtml` shared utility that converts plain text to clean, minimal HTML (no styling beyond readable defaults, bare URLs auto-linked)
- Add `html` field to all Resend API calls in `process-campaigns` and `send-email`
- Keep `text` field — sending both is multipart/alternative, which is best practice for deliverability
- After implementation: send a test email to `nkpardon8@gmail.com` to verify tracking works end-to-end

### Success Criteria

- [ ] Test email to nkpardon8@gmail.com renders cleanly (looks like conversational text, not code)
- [ ] Open tracking pixel fires when email is opened
- [ ] Clicking a link in a test email increments `clicked_at` in the DB
- [ ] `CampaignAnalytics` opens/clicks cards show non-zero values for future sends
- [ ] Per-recipient "Clicked" badge appears on `CampaignDetailPage` when a recipient clicks

## All Needed Context

### How the shared directory works

```
supabase/functions/_shared/cors.ts    ← imported by edge functions as '../_shared/cors.ts'
supabase/functions/_shared/alerts.ts  ← same pattern
```

Add new utility here, import the same way.

### Email object shape sent to Resend — process-campaigns (lines 282-288)

```typescript
// process-campaigns/index.ts:282-288 — CURRENT (text only)
return {
  from:    `${profile.name} <${profile.email_prefix}@${CAMPAIGN_DOMAIN}>`,
  headers: { 'Reply-To': `${profile.name} <${profile.email_prefix}@${EMAIL_DOMAIN}>` },
  to:      [e.email],
  subject: emailSubject,
  text:    emailBody,   // ← only field, no html
}
```

```typescript
// AFTER — add html field
return {
  from:    `${profile.name} <${profile.email_prefix}@${CAMPAIGN_DOMAIN}>`,
  headers: { 'Reply-To': `${profile.name} <${profile.email_prefix}@${EMAIL_DOMAIN}>` },
  to:      [e.email],
  subject: emailSubject,
  text:    emailBody,
  html:    plainTextToHtml(emailBody),  // ← add this
}
```

### Email object shape — send-email single send (lines 110-116)

```typescript
// send-email/index.ts:110-116 — CURRENT
body: JSON.stringify({
  from: `${senderName} <${validFrom}>`,
  to: [email.to],
  subject: email.subject,
  text: email.body,
  headers: Object.keys(threadingHeaders).length > 0 ? threadingHeaders : undefined,
}),
```

```typescript
// AFTER
body: JSON.stringify({
  from: `${senderName} <${validFrom}>`,
  to: [email.to],
  subject: email.subject,
  text: email.body,
  html: plainTextToHtml(email.body),  // ← add this
  headers: Object.keys(threadingHeaders).length > 0 ? threadingHeaders : undefined,
}),
```

### Email object shape — send-email batch send (lines 172-177)

```typescript
// send-email/index.ts:172-177 — CURRENT
const resendBatch = chunk.map((email: Record<string, string>, idx: number) => ({
  from: `${senderName} <${validFrom}>`,
  to: [email.to],
  subject: email.subject,
  text: resolvedBodies[idx],
}))
```

```typescript
// AFTER
const resendBatch = chunk.map((email: Record<string, string>, idx: number) => ({
  from: `${senderName} <${validFrom}>`,
  to: [email.to],
  subject: email.subject,
  text: resolvedBodies[idx],
  html: plainTextToHtml(resolvedBodies[idx]),  // ← add this
}))
```

### plainTextToHtml logic (hot spot — get this right)

```typescript
// supabase/functions/_shared/html.ts
export function plainTextToHtml(text: string): string {
  // 1. Escape HTML special chars FIRST (before any substitution)
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  // 2. Auto-link bare URLs (http/https)
  //    CRITICAL: Use [^\s<>"] NOT [^\s<>"&] — after escaping, & becomes &amp;
  //    so stopping at & would truncate URLs with multiple query params
  //    (e.g. https://example.com?a=1&b=2 would become https://example.com?a=1&amp;b=2
  //    and stopping at & truncates it to https://example.com?a=1&amp;b=2... wait,
  //    actually after escaping & becomes &amp; which contains no bare & chars.
  //    So the real issue: don't stop at & in the char class since & no longer appears
  //    as a raw char post-escaping. Use [^\s<>"] to capture full escaped URLs.)
  const linked = escaped.replace(
    /(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1">$1</a>'
  )

  // 3. Split on double newlines → paragraphs; single newlines → <br>
  const paragraphs = linked
    .split(/\n\n+/)
    .filter(p => p.trim().length > 0)
    .map(p => `<p style="margin:0 0 12px 0;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n')

  // 4. Wrap in minimal styling — looks like a real email, not a webpage
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#222;max-width:600px;margin:0 auto;padding:20px 0;">
${paragraphs}
</body>
</html>`
}
```

**Critical gotcha:** Escape HTML chars BEFORE the URL regex. If you run the URL regex first, the `https://` gets escaped to `https://` and won't match.

**Critical gotcha:** The `text` body already has `{{unsubscribeLink}}` replaced with a real URL before this function is called (in both edge functions). So the unsubscribe URL will be present as a bare `https://...` string in `text` — the auto-linker will wrap it correctly in an `<a>` tag.

## Files Being Changed

```
supabase/
  functions/
    _shared/
      html.ts                        ← NEW
    process-campaigns/
      index.ts                       ← MODIFIED (add html field + import)
    send-email/
      index.ts                       ← MODIFIED (add html field to single + batch paths + import)
```

No frontend changes. All existing UI already handles the data once it flows.

## Architecture Overview

```
User sends campaign
  → process-campaigns builds resendEmails array
  → Each email now has: { text: "...", html: "<html>...</html>", ... }
  → Resend receives multipart/alternative email
  → Resend injects 1×1 tracking pixel into HTML <body>
  → Resend rewrites <a href> links through their click tracking domain
  → Recipient opens email → Resend fires email.opened webhook
  → email-events edge function sets emails.opened_at (already works)
  → Recipient clicks link → Resend fires email.clicked webhook
  → email-events edge function sets emails.clicked_at (already works)
  → CampaignDetailPage reads emails, computes stats, shows real percentages ✓
```

## Tasks (in order)

### Task 1 — Create shared HTML utility

CREATE `supabase/functions/_shared/html.ts`:
- Export `plainTextToHtml(text: string): string`
- Implement the escaping → auto-linking → paragraph conversion → HTML wrapper logic exactly as shown in the pseudocode above

### Task 2 — Update process-campaigns

MODIFY `supabase/functions/process-campaigns/index.ts`:
- Import `plainTextToHtml` from `'../_shared/html.ts'`
- **Batch send path** (lines 282-288 in `resendEmails` map): add `html: plainTextToHtml(emailBody)` to the returned object. `emailBody` is already the resolved, merge-field-substituted, unsubscribe-link-replaced string at this point.
- **Drip send path** (line ~496, the single `fetch` call in the drip sequence block): add `html: plainTextToHtml(emailBody)` to the JSON payload. `emailBody` is resolved at line ~481 and unsubscribe-replaced at lines ~483-487 before this point.

### Task 3 — Update send-email

MODIFY `supabase/functions/send-email/index.ts`:
- Import `plainTextToHtml` from `'../_shared/html.ts'`
- **Single send path** (line ~114): Only add `html` when `campaignId` is set (this path handles both manual compose/replies AND campaign sends — HTML tracking should only apply to campaign sends). Check `if (campaignId)` before adding the field: `...(campaignId ? { html: plainTextToHtml(email.body) } : {})`
- **Batch send path** (line ~176): This path is campaign-only (always has `campaignId`), add `html: plainTextToHtml(resolvedBodies[idx])` to every item. Use `resolvedBodies[idx]` (post-unsubscribe-link-replacement), same as `text`.

### Task 4 — Deploy both edge functions

Deploy via MCP:
1. `mcp__supabase__deploy_edge_function` for `process-campaigns`
2. `mcp__supabase__deploy_edge_function` for `send-email`

### Task 5 — Send test email

After both functions deploy, send a test email by calling the `send-email` edge function directly via `mcp__supabase__execute_sql` to invoke a test, OR by using `mcp__supabase__get_edge_function` to confirm deploy then calling the edge function URL via fetch.

**Do NOT use `mcp__resend__send-email` directly** — that bypasses the edge functions entirely and won't test the HTML conversion code.

Instead, trigger a send via the deployed `send-email` edge function:
- POST to `https://onthjkzdgsfvmgyhrorw.supabase.co/functions/v1/send-email`
- Use the service role key or anon key in Authorization header
- Body: `{ "emails": [{ "to": "nkpardon8@gmail.com", "subject": "Test — email tracking", "body": "Hey Nick,\n\nThis is a test email to verify HTML tracking is working.\n\nHere is a link you can click: https://google.com\n\nTalk soon." }] }`
- After it sends, query `SELECT id, to, provider_message_id, opened_at, clicked_at FROM emails WHERE \"to\" = 'nkpardon8@gmail.com' ORDER BY sent_at DESC LIMIT 1` to confirm `provider_message_id` was stored (prerequisite for webhook matching)

## Validation Loop

```bash
# After deploying, check edge function logs for errors
mcp__supabase__get_logs — service: edge-functions, filter: process-campaigns
mcp__supabase__get_logs — service: edge-functions, filter: send-email
mcp__supabase__get_logs — service: edge-functions, filter: email-events

# After sending test email, check that provider_message_id was stored
SELECT id, to, provider_message_id, opened_at, clicked_at
FROM emails
WHERE to = 'nkpardon8@gmail.com'
ORDER BY sent_at DESC
LIMIT 5;
```

## Deprecated Code

None — no existing code removed.
