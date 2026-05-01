# Plan: Campaign Email Activity Linking

## Goal
Make campaign emails appear in lead Activity Timelines with clickable links to the email thread in Outreach.

## Files Being Changed
```
supabase/functions/process-campaigns/index.ts    ← MODIFIED (add activity creation)
src/pages/LeadDetailPage.tsx                     ← MODIFIED (clickable email activities)
src/pages/OutreachPage.tsx                       ← MODIFIED (read ?thread= param for deep-link)
```

## Tasks

### Task 1: process-campaigns — add activity creation
**MODIFY `supabase/functions/process-campaigns/index.ts`**

1a. **Bulk path** — INSIDE the `if (res.ok)` block, AFTER enrollment status updates (after variant A/B updates ~line 328), add activity insert. Use `batchEnrollments` (already `enrollments.slice(i, i+100)`). Wrap in try-catch with console.error.

1b. **Drip path** — After drip email insert (~line 486), add single activity insert. Wrap in try-catch.

Both use: `{ lead_id, user_id: campaign.sent_by, type: 'email_sent', description: 'Campaign email sent: "{subject}"', timestamp, metadata: { campaignId, threadId } }`

### Task 2: LeadDetailPage — clickable email activities
**MODIFY `src/pages/LeadDetailPage.tsx`**

In activity timeline rendering (~line 364), check `act.metadata?.threadId`. If present, render description as a clickable button with `navigate('/outreach?thread=...')`. Style with `text-primary hover:underline`. `useNavigate` is already imported.

### Task 3: OutreachPage — read ?thread= param
**MODIFY `src/pages/OutreachPage.tsx`**

Add `useSearchParams` to read `thread` query param on mount. If present, set `selectedThreadId` to that value and set `tab` to `'inbox'`. Use a `useEffect` that runs on mount.

### Task 4: Deploy
```bash
supabase functions deploy process-campaigns --no-verify-jwt
```

## Confidence: 9/10
