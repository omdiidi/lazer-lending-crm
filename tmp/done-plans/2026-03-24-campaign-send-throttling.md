# Plan: Campaign Send Throttling & Domain Warmup (v2)

## Goal

Add a warmup-aware daily send limit dropdown to campaigns, a send spacing toggle, a shared domain-wide daily cap across all users/campaigns, and a re-warmup reset in admin settings. Campaigns with more recipients than the daily cap automatically spread over multiple days.

## Why

- Current scheduler blasts 100 emails in <1 second — reputation killer for new domains
- No daily volume caps, no per-email spacing, no warmup awareness
- Gmail/Outlook throttle senders that spike volume from new domains
- Need graduated warmup: 5-20/day week 1, scaling to 200/day after 3 months

## What

- Per-campaign `daily_send_limit` dropdown with warmup-locked tiers
- Domain-wide shared daily cap (all campaigns + all users combined)
- Per-campaign `send_spacing` toggle (spread emails across 8-hour window)
- `email_send_log` table for atomic daily count tracking
- `warmup_state` table for warmup age tracking
- Re-warmup reset button in admin settings (AlertDialog, admin only)
- Scheduler enforces daily cap and spacing in BOTH bulk + drip paths
- "Send now" campaigns converted to active status and processed by scheduler (not instant)

### Success Criteria

- [ ] Daily send limit dropdown in Campaign Builder with locked tiers
- [ ] Higher tiers unlock automatically as domain ages
- [ ] Domain-wide daily cap enforced across ALL campaigns/users/paths (bulk + drip)
- [ ] Send spacing toggle spreads emails throughout the day
- [ ] "Send now" campaigns go through scheduler (respects daily cap)
- [ ] Campaigns with more recipients than daily cap continue over multiple days
- [ ] Re-warmup reset button in Settings (admin only, AlertDialog)

## Files Being Changed

```
src/types/crm.ts                                  ← MODIFIED (add fields to Campaign)
src/types/database.ts                              ← MODIFIED (add columns + new table types)
src/pages/CampaignBuilderPage.tsx                  ← MODIFIED (dropdown + toggle + convert send-now)
src/pages/SettingsPage.tsx                         ← MODIFIED (re-warmup with AlertDialog)
supabase/functions/process-campaigns/index.ts      ← MODIFIED (enforce daily cap + spacing in bulk + drip)
```

## Architecture Overview

```
email_send_log table (atomic counter)
  ├── Row per date: { send_date, emails_sent }
  ├── Atomic increment on each batch send
  └── Fast O(1) count check (vs scanning emails table)

warmup_state table (single row)
  ├── first_email_at (auto-set on first send)
  └── reset_at / reset_by (for re-warmup)

Campaign Builder
  ├── daily_send_limit dropdown (tiers locked by warmup age)
  ├── send_spacing toggle (spread across day)
  └── "Send now" → creates campaign as 'active', lets scheduler handle it

process-campaigns scheduler (every minute)
  ├── Fetch warmup_state → calculate maxDailyAllowed
  ├── Fetch email_send_log for today → calculate remainingBudget
  ├── BULK path: limit batch to min(remainingBudget, campaign.daily_send_limit)
  ├── DRIP path: check remainingBudget before each send
  ├── Atomic increment email_send_log after each batch/send
  └── Send spacing: stagger enrollments across 8-hour window
```

**Critical design: "Send now" no longer sends instantly.** It creates the campaign in `active` status with enrollments in `pending` status. The scheduler picks it up within 1 minute and sends according to the daily cap. This ensures ALL email sending goes through the throttled scheduler path.

## All Needed Context

### Warmup Tiers (duplicate in frontend + edge function — cross-reference comment needed)

```typescript
// WARMUP TIERS — duplicated in:
// - src/pages/CampaignBuilderPage.tsx (frontend dropdown)
// - supabase/functions/process-campaigns/index.ts (scheduler enforcement)
// Keep both in sync when modifying.
const WARMUP_TIERS = [
  { value: 5, label: '5/day', unlocksAfterDays: 0 },
  { value: 10, label: '10/day', unlocksAfterDays: 0 },
  { value: 15, label: '15/day', unlocksAfterDays: 0 },
  { value: 20, label: '20/day', unlocksAfterDays: 0 },
  { value: 25, label: '25/day', unlocksAfterDays: 8 },
  { value: 50, label: '50/day', unlocksAfterDays: 15 },
  { value: 75, label: '75/day', unlocksAfterDays: 22 },
  { value: 100, label: '100/day', unlocksAfterDays: 31 },
  { value: 150, label: '150/day', unlocksAfterDays: 61 },
  { value: 200, label: '200/day', unlocksAfterDays: 91 },
]
```

### CampaignBuilderPage handleSend structure

There is ONE `handleSend` function (not a separate handleSchedule). It branches internally:
- Line ~85: `if (sendMode === 'schedule')` → creates campaign with `status: 'scheduled'`
- Line ~127: else → creates campaign with `status: 'draft'`, then calls `sendBulkEmails` directly

The "send now" path must be changed to create campaign as `active` (not `draft`) and NOT call `sendBulkEmails`. Instead, create enrollments and let the scheduler send them.

### Type chain

`Campaign` interface (crm.ts) → `Omit<Campaign, 'id'>` in `use-campaigns.ts` → `toSnakeCase()` in transforms.ts → Supabase insert. Adding fields to `Campaign` interface is sufficient — no hook changes needed. `toSnakeCase` automatically converts `dailySendLimit` → `daily_send_limit`.

### SettingsPage pattern for destructive actions

Uses `AlertDialog` (not `window.confirm`). Pattern from delete member (line ~241):
```tsx
<AlertDialog>
  <AlertDialogTrigger asChild><Button>...</Button></AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader><AlertDialogTitle>...</AlertDialogTitle></AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={...}>Confirm</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

## Known Gotchas

1. **Race condition: overlapping cron runs** — pg_cron fires every minute. If run A is still executing when run B starts, both read the same `email_send_log` count and could double-send. Fix: use atomic `INSERT ... ON CONFLICT DO UPDATE SET emails_sent = emails_sent + $count` on `email_send_log`. This makes the increment atomic even with concurrent runs.

2. **"Send now" conversion** — the biggest change. The current "send now" path calls `sendBulkEmails` directly, creates email records, marks enrollments as sent, etc. All of this must be removed. Instead: create campaign as `active`, create enrollments as `pending`, return. The scheduler does the rest.

3. **Drip path also counts against daily cap** — a drip follow-up email is still an email. The drip loop must check and decrement `remainingBudget` just like the bulk path.

4. **Budget is claimed, not just checked** — when spacing is ON, the scheduler defers most emails but must claim the full batch from the daily budget. Otherwise the next campaign will over-allocate.

5. **`sent_at` is the canonical send timestamp** — use it consistently for counting, not `created_at`.

## Key Pseudocode

### Atomic daily count increment

```typescript
// After each successful batch send:
await supabaseAdmin.rpc('increment_daily_sends', { count: sentCount })

// Or inline SQL:
await supabaseAdmin.from('email_send_log').upsert(
  { send_date: today, emails_sent: sentCount },
  { onConflict: 'send_date' }
)
// Then update: emails_sent = emails_sent + sentCount
```

Actually, Supabase doesn't support atomic increment in upsert cleanly. Use a simple approach:

```typescript
// Read current count
const { data: logRow } = await supabaseAdmin.from('email_send_log')
  .select('emails_sent').eq('send_date', today).maybeSingle()

const currentSent = logRow?.emails_sent || 0
const remainingBudget = Math.max(0, maxDailyAllowed - currentSent)

// After sending:
await supabaseAdmin.from('email_send_log').upsert({
  send_date: today,
  emails_sent: currentSent + actualSentCount,
})
```

The race window is small (scheduler runs take seconds) and the worst case is slightly over-sending by one batch — acceptable.

### Scheduler: Combined budget tracking

```typescript
// At top of handler:
const today = new Date().toISOString().split('T')[0]

// Get warmup state
const { data: warmup } = await supabaseAdmin.from('warmup_state')
  .select('*').eq('id', 'default').maybeSingle()
const firstEmailAt = warmup?.first_email_at ? new Date(warmup.first_email_at) : null
const daysSinceFirstEmail = firstEmailAt
  ? Math.floor((Date.now() - firstEmailAt.getTime()) / (24*60*60*1000))
  : 0
const maxDailyAllowed = getMaxDailyAllowed(daysSinceFirstEmail)

// Get today's sent count
const { data: logRow } = await supabaseAdmin.from('email_send_log')
  .select('emails_sent').eq('send_date', today).maybeSingle()
let todaySent = logRow?.emails_sent || 0
let remainingBudget = Math.max(0, maxDailyAllowed - todaySent)

if (remainingBudget <= 0) {
  console.log(`Daily limit reached (${todaySent}/${maxDailyAllowed}), skipping`)
  return new Response(JSON.stringify({ processed: 0, dailyLimitReached: true }), ...)
}

// ... process campaigns, decrementing remainingBudget after each batch ...

// After each successful send/batch, update the log:
todaySent += actualSent
await supabaseAdmin.from('email_send_log').upsert({
  send_date: today,
  emails_sent: todaySent,
})
```

### "Send now" conversion

```typescript
// OLD: handleSend "send now" path
// Creates campaign as 'draft', calls sendBulkEmails directly, marks complete

// NEW: handleSend "send now" path
const campaign = await addCampaignAsync({
  name, subject, body, recipientIds, sentBy: user.id,
  status: 'active', // NOT 'draft', NOT 'completed'
  abTestEnabled, variantBSubject, variantBBody,
  smartSend, dailySendLimit, sendSpacing,
})

// Create enrollments for all recipients (same as schedule path)
const enrollments = recipientIds.map(leadId => {
  const lead = leads.find(l => l.id === leadId)
  return { campaign_id: campaign.id, lead_id: leadId, email: lead?.email, status: 'pending' }
})
await createEnrollments(enrollments)

toast.success(`Campaign "${campaignName}" is now active. Emails will be sent according to your daily limit.`)
navigate('/outreach?tab=campaigns')
```

## Tasks (in implementation order)

### Task 1: Create tables + update types

**Migration via Supabase MCP:**
```sql
-- Warmup state (single row)
CREATE TABLE warmup_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  first_email_at TIMESTAMPTZ,
  reset_at TIMESTAMPTZ,
  reset_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE warmup_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read" ON warmup_state FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_update" ON warmup_state FOR UPDATE TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON warmup_state FOR INSERT TO authenticated WITH CHECK (true);

-- Daily send count (atomic tracking)
CREATE TABLE email_send_log (
  send_date DATE PRIMARY KEY DEFAULT CURRENT_DATE,
  emails_sent INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE email_send_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read" ON email_send_log FOR SELECT TO authenticated USING (true);

-- Campaign columns
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS daily_send_limit INTEGER DEFAULT 20;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS send_spacing BOOLEAN DEFAULT false;
```

**MODIFY `src/types/crm.ts`** — add to Campaign interface:
```typescript
dailySendLimit?: number;
sendSpacing?: boolean;
```

**MODIFY `src/types/database.ts`** — add `daily_send_limit` and `send_spacing` to campaigns Row/Insert/Update. Add `warmup_state` and `email_send_log` table types.

### Task 2: Update CampaignBuilderPage

**MODIFY `src/pages/CampaignBuilderPage.tsx`**

2a. Add WARMUP_TIERS constant (with cross-reference comment to process-campaigns).

2b. Add state: `dailySendLimit` (default 20), `sendSpacing` (default false), `warmupDays` (fetched on mount from warmup_state).

2c. Fetch warmup state on mount to calculate unlocked tiers.

2d. Add daily send limit dropdown + send spacing toggle in Step 4 (near smart_send button). Use Select component. Locked tiers show "(unlocks in Xd)" and are disabled.

2e. **Convert "send now" path:** Remove the `sendBulkEmails` call. Instead create campaign as `active` status, create enrollments as `pending`. Show toast explaining emails will send according to daily limit. The campaign creation payload includes `dailySendLimit` and `sendSpacing`.

2f. **Schedule path:** Add `dailySendLimit` and `sendSpacing` to the scheduled campaign creation payload (same `handleSend` function, schedule branch).

### Task 3: Update SettingsPage with re-warmup

**MODIFY `src/pages/SettingsPage.tsx`**

Add "Domain Warmup" section inside admin-only block. Shows:
- Current warmup age (days since first email, fetched from warmup_state)
- Current max tier allowed
- "Reset Domain Warmup" button using AlertDialog pattern (not window.confirm)
- Reset upserts warmup_state with first_email_at = now, reset_at = now, reset_by = user.id

### Task 4: Update process-campaigns scheduler

**MODIFY `supabase/functions/process-campaigns/index.ts`**

This is the most critical and complex task.

4a. Add WARMUP_TIERS constant + `getMaxDailyAllowed()` function at top (with cross-reference comment).

4b. **At the top of the handler** (before processing campaigns):
- Fetch warmup_state → calculate daysSinceFirstEmail + maxDailyAllowed
- Fetch email_send_log for today → calculate remainingBudget
- If remainingBudget <= 0, return early

4c. **Auto-initialize warmup**: On first send, if warmup_state doesn't exist or first_email_at is null, set it to now.

4d. **Bulk campaign path**: Limit enrollment fetch to `min(remainingBudget, campaign.daily_send_limit || 100, 100)`. After successful send, update email_send_log atomically and decrement local remainingBudget.

4e. **Send spacing (bulk path)**: When `campaign.send_spacing` is true and batchSize > 1, keep only the first enrollment for immediate send. Set `next_send_at` on the rest to stagger across 8 hours with randomized intervals. Claim the full batchSize from remainingBudget (not just 1).

4f. **Update enrollment fetch query**: Change `.is('next_send_at', null)` to `.or('next_send_at.is.null,next_send_at.lte.' + new Date().toISOString())` so spaced/deferred enrollments are picked up when their time arrives.

4g. **Drip path**: Before each drip send, check remainingBudget > 0. If 0, break. After each successful drip send, increment todaySent and update email_send_log.

4h. **Use `sent_at` consistently** if counting from emails table for any reason (though primary count is from email_send_log).

### Task 5: Deploy process-campaigns

```bash
supabase functions deploy process-campaigns --no-verify-jwt
```

## Validation Loop

```bash
npm run lint
```

Manual test:
1. Campaign Builder shows daily limit dropdown with correct locked/unlocked tiers
2. "Send now" creates an active campaign (no instant send)
3. Scheduler picks up active campaigns and sends within daily limit
4. Daily cap shared across campaigns
5. Settings page shows warmup info + reset button

## Deprecated Code

- The direct `sendBulkEmails` call in CampaignBuilderPage "send now" path is REMOVED
- The campaign email row insertion in CampaignBuilderPage is REMOVED (scheduler handles it)
- Campaign status should not be set to 'completed' immediately in "send now" — scheduler marks completion

## Confidence Score: 7/10

Complex scheduler rearchitecture + "send now" conversion. The individual pieces are clear but the integration is tricky. The "send now" conversion is the riskiest part — it changes fundamental behavior (user expects instant send, now gets queued send).
