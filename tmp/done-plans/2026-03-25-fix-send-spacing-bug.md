# Plan: Fix Send Spacing Re-Scheduling Bug

## Goal

Fix the bug where send spacing re-applies to already-scheduled enrollments on every cron run, pushing them into the future indefinitely and burning the daily send budget without actually sending emails. Also reset today's inflated send log so the campaign resumes immediately.

## Why

- The Construction campaign has 42 pending emails stuck — 36 are past-due but keep getting re-deferred
- Only 4 of 46 emails have been sent since yesterday
- The daily budget (20) gets claimed by phantom re-spacings, blocking all real sends

## What

The spacing block at line 228 of `process-campaigns/index.ts` runs unconditionally on all fetched enrollments. Enrollments that were already spaced (have `next_send_at` set) and are now due get re-spaced again. Fix: only apply spacing to enrollments that have never been scheduled (`next_send_at IS NULL`). Already-scheduled enrollments that are now due should send normally.

### Success Criteria

- [ ] Already-spaced enrollments (next_send_at set, now past-due) send normally without re-deferral
- [ ] Fresh enrollments (next_send_at null) still get spaced correctly on first pass
- [ ] Budget only claimed for newly-deferred enrollments, not already-due ones
- [ ] No duplicate sends — enrollment `status` check is unchanged
- [ ] Existing campaign stays active with all 42 pending enrollments intact
- [ ] Today's inflated send log reset so sends resume immediately

## Files Being Changed

```
supabase/functions/process-campaigns/index.ts    ← MODIFIED (fix spacing logic)
DB fix (via SQL)                                  ← Reset today's email_send_log
```

## Architecture Overview

The send spacing block (lines 227-248) currently:
1. Checks `campaign.send_spacing && enrollments.length > 1`
2. Defers ALL enrollments except the first
3. Claims the full batch against the daily budget
4. Only keeps the first enrollment for immediate send

The fix splits enrollments into two groups:
- **Fresh** (`next_send_at IS NULL`) — never been scheduled, apply spacing to these
- **Due** (`next_send_at` is set, already past) — already spaced and now due, send normally

## Tasks

### Task 1a: MODIFY `supabase/functions/process-campaigns/index.ts` — lines 227-248 (spacing block)

Replace the current spacing block:

```typescript
// CURRENT (BROKEN):
if (campaign.send_spacing && enrollments.length > 1) {
  ...
  remainingBudget -= enrollments.length
  todaySent += enrollments.length
  enrollments = [enrollments[0]]
}
```

With:

```typescript
// FIXED: only space fresh enrollments, send due ones normally
if (campaign.send_spacing) {
  const fresh = enrollments.filter(e => !e.next_send_at)
  const due = enrollments.filter(e => e.next_send_at)

  if (fresh.length > 1) {
    const SEND_WINDOW_MS = 8 * 60 * 60 * 1000
    const intervalMs = Math.floor(SEND_WINDOW_MS / fresh.length)
    const randomJitter = () => Math.floor(Math.random() * 120000) - 60000

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
  // If fresh.length <= 1: all enrollments are due or only 1 fresh — send them all normally
  // No upfront budget claim — budget is charged when emails actually send (Task 1b)
}
```

Key changes:
- `fresh` = enrollments with no `next_send_at` (first time through spacing)
- `due` = enrollments with `next_send_at` set (already spaced, now past-due — just send them)
- **No upfront budget pre-claim** — budget charged only on actual send (see Task 1b)
- `enrollments` includes first fresh + all due — these flow into the batch send below

### Task 1b: MODIFY `supabase/functions/process-campaigns/index.ts` — lines 351-356 (budget guard)

Remove the `if (!campaign.send_spacing)` guard so ALL sends are counted against the budget:

```typescript
// CURRENT (matches old pre-claim pattern):
if (!campaign.send_spacing) {
  todaySent += chunk.length
  remainingBudget -= chunk.length
}

// FIXED (always charge budget on actual send):
todaySent += chunk.length
remainingBudget -= chunk.length
```

This ensures:
- Due enrollments get charged when they send (was previously skipped)
- Fresh[0] gets charged when it sends (no longer pre-claimed)
- Deferred fresh enrollments get charged when they become due and send in future cron runs
- Budget is always accurate — only counts emails that actually went out

### Task 2: DB fix — reset today's inflated send log

First verify the 4 sent emails have enrollment status = 'sent' (dedup safety):
```sql
SELECT ce.status, e."to", e.sent_at
FROM emails e
JOIN campaign_enrollments ce ON ce.lead_id = e.lead_id AND ce.campaign_id = e.campaign_id
WHERE e.campaign_id = 'acbe7b3b-98a1-4e7a-9982-739b2e7098b0';
-- All 4 should show status = 'sent'
```

Then reset today's inflated count. The 20 on 2026-03-25 is phantom (from re-spacing). The 2 emails sent on 3/25 UTC (Laurie + Reynolds) were counted under 3/24's log. Reset today to 0:
```sql
UPDATE email_send_log SET emails_sent = 0 WHERE send_date = '2026-03-25';
```

### Task 3: Deploy

```bash
supabase functions deploy process-campaigns --no-verify-jwt
```

## Duplicate Send Protection (unchanged)

These existing guards remain intact and prevent any duplicates:
- Enrollment query filters `status = 'pending'` — sent enrollments are never re-fetched
- After successful batch send, enrollments are updated to `status: 'sent'` atomically
- `provider_message_id` stored per email prevents duplicate DB inserts
- The 4 already-sent enrollments (John, Chris, Laurie, Reynolds) have `status: 'sent'` and will never appear in the pending query

## Campaign Integrity

- Campaign status stays `active` — not touched
- All 42 pending enrollments remain in the DB with their current data
- Enrollments only transition `pending → sent` on successful Resend API response
- Campaign auto-completes when `SELECT count(*) ... status = 'pending'` returns 0

## Validation

After deploy + DB fix, monitor next cron run:
```sql
-- Should see new emails appearing
SELECT count(*) FROM emails WHERE campaign_id = 'acbe7b3b-98a1-4e7a-9982-739b2e7098b0';
-- Should see enrollments moving to 'sent'
SELECT status, count(*) FROM campaign_enrollments
WHERE campaign_id = 'acbe7b3b-98a1-4e7a-9982-739b2e7098b0' GROUP BY status;
```

## Confidence: 10/10
