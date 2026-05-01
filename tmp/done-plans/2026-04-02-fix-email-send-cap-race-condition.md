# Fix: Email Daily Send Cap Race Condition

## Goal

Fix the daily email send cap so it is atomically enforced — no concurrent cron invocations can double-spend the budget, and manual sends via the compose window / MCP agent also count against the limit.

## Why

- **Root cause**: `process-campaigns` reads `emails_sent` from DB once, holds it in a local variable, and writes it back with a last-write-wins `upsert` after each batch. Two concurrent 5-minute cron ticks both read the same starting count, both compute the same budget, and both send their full batch — resulting in 2x the cap.
- **Second issue**: `send-email` (compose window + MCP sends) has zero cap logic. It never reads or writes `email_send_log`. All manual sends are invisible to the daily limit.
- **Result**: 43 emails sent on a 20/day warmup cap today.

## What

1. **New Postgres function** `claim_daily_send_budget(p_date, p_max, p_requested)` — atomically checks the budget and increments by exactly how many slots are available (up to `p_requested`). Uses `SELECT FOR UPDATE` to serialize concurrent calls. Returns how many slots were actually granted.
2. **Rewrite budget tracking in `process-campaigns`** — replace the read-at-top + upsert-after-batch pattern with `rpc('claim_daily_send_budget')` calls. The claim is the only write to `email_send_log`.
3. **Add cap enforcement to `send-email`** — fetch warmup state, call `claim_daily_send_budget` before sending. If 0 slots granted, return 429.
4. **SQL smoke test** — verify the function handles edge cases correctly.

### Success Criteria

- [ ] Two concurrent invocations of `process-campaigns` cannot together exceed `maxDailyAllowed` sends
- [ ] Manual sends via compose window count against the daily cap
- [ ] When cap is reached mid-campaign, exactly 0 additional emails go out that day
- [ ] `send-email` returns a 429 with a clear message when the daily cap is full
- [ ] All existing campaign behavior (spacing, smart send, drip, A/B) is unchanged

## All Needed Context

### Files Being Changed

```
supabase/
  migrations/
    20260402000000_add_claim_budget_function.sql   ← NEW
  functions/
    process-campaigns/
      index.ts                                      ← MODIFIED
    send-email/
      index.ts                                      ← MODIFIED
```

### Existing Schema

`email_send_log` — PRIMARY KEY is `send_date` (unique btree index confirmed):
```sql
send_date   date        PK
emails_sent integer
updated_at  timestamptz
```

### The Race Condition (exact code)

Current broken pattern in `process-campaigns/index.ts`:

```typescript
// Line 89-92: read once at top
const { data: logRow } = await supabaseAdmin.from('email_send_log')
  .select('emails_sent').eq('send_date', today).maybeSingle()
let todaySent = logRow?.emails_sent || 0         // ← both invocations read same value
let remainingBudget = Math.max(0, maxDailyAllowed - todaySent)

// Line 370-375: write back local variable (last-write-wins)
todaySent += chunk.length
remainingBudget -= chunk.length
await supabaseAdmin.from('email_send_log').upsert({
  send_date: today,
  emails_sent: todaySent,   // ← invocation A writes 10, invocation B also writes 10
})                           //   net result: 20 recorded, 20 actually sent (2x budget)
```

### Key Constants and Function Signatures

```typescript
// process-campaigns/index.ts line 42-50
function getMaxDailyAllowed(daysSinceFirstEmail: number): number {
  if (daysSinceFirstEmail >= 91) return 200
  if (daysSinceFirstEmail >= 61) return 150
  if (daysSinceFirstEmail >= 31) return 100
  if (daysSinceFirstEmail >= 22) return 75
  if (daysSinceFirstEmail >= 15) return 50
  if (daysSinceFirstEmail >= 8)  return 25
  return 20
}

// process-campaigns/index.ts line 68
const today = new Date().toISOString().split('T')[0]

// process-campaigns/index.ts line 71-77 (warmup read, keep as-is)
const { data: warmup } = await supabaseAdmin.from('warmup_state')
  .select('*').eq('id', 'default').maybeSingle()
// ... daysSinceFirstEmail calculation ...
const maxDailyAllowed = getMaxDailyAllowed(daysSinceFirstEmail)

// process-campaigns/index.ts line 129-131 (campaign loop entry)
const campaignDailyLimit = campaign.daily_send_limit || 100
const batchSize = Math.min(remainingBudget, campaignDailyLimit, 100)
if (batchSize <= 0) continue

// Drip send budget decrement (lines 573-578) — same pattern, same fix
todaySent += 1
remainingBudget -= 1
await supabaseAdmin.from('email_send_log').upsert({ send_date: today, emails_sent: todaySent })
```

### `supabase.rpc()` call pattern (Deno edge functions)

```typescript
// Call a Postgres function and get back a scalar
const { data: granted, error } = await supabaseAdmin.rpc('claim_daily_send_budget', {
  p_date: today,
  p_max: maxDailyAllowed,
  p_requested: wantedSlots,
})
// granted is a number (int) — actual slots claimed, 0 if cap already reached
if (error) throw error
```

## Implementation Blueprint

### Task 1: Migration — `claim_daily_send_budget` Postgres function

Create `supabase/migrations/20260402000000_add_claim_budget_function.sql`:

```sql
CREATE OR REPLACE FUNCTION claim_daily_send_budget(
  p_date date,
  p_max  integer,
  p_requested integer
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_current integer := 0;
  v_granted integer := 0;
BEGIN
  -- Ensure a row exists for today (no-op if already exists)
  INSERT INTO email_send_log (send_date, emails_sent, updated_at)
  VALUES (p_date, 0, now())
  ON CONFLICT (send_date) DO NOTHING;

  -- Lock the row, read current count
  SELECT emails_sent INTO v_current
  FROM email_send_log
  WHERE send_date = p_date
  FOR UPDATE;

  -- Compute how many slots we can actually grant
  v_granted := LEAST(p_requested, GREATEST(0, p_max - v_current));

  -- Only write if we're granting something
  IF v_granted > 0 THEN
    UPDATE email_send_log
    SET emails_sent = v_current + v_granted,
        updated_at  = now()
    WHERE send_date = p_date;
  END IF;

  RETURN v_granted;
END;
$$;
```

Key points:
- `FOR UPDATE` serializes concurrent calls — only one transaction holds the lock at a time
- Insert-then-lock (not lock-then-insert) avoids a gap where the row doesn't exist yet
- Returns 0 if cap already reached, returns less than `p_requested` if near the cap

Apply via `mcp__supabase__apply_migration`.

---

### Task 2: Rewrite budget tracking in `process-campaigns/index.ts`

**Remove**: the `todaySent` and `remainingBudget` local variables and all their read/write operations.

**Keep**: the initial warmup state read (lines 71-92) and the early-exit check — but rewrite the early-exit to use a simple SELECT instead of the `remainingBudget` variable.

**New pattern**:

```typescript
// After computing maxDailyAllowed:

// Quick non-locking check for early exit (avoids full campaign loop when obviously full)
const { data: logRow } = await supabaseAdmin.from('email_send_log')
  .select('emails_sent').eq('send_date', today).maybeSingle()
if ((logRow?.emails_sent || 0) >= maxDailyAllowed) {
  console.log(`Daily limit reached, skipping all campaigns`)
  return new Response(JSON.stringify({ processed: 0, dailyLimitReached: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// --- Campaign loop ---
for (const campaign of uniqueCampaigns) {
  const campaignDailyLimit = campaign.daily_send_limit || 100
  const wantedSlots = Math.min(campaignDailyLimit, 100)

  // Atomically claim budget slots BEFORE fetching enrollments
  const { data: grantedSlots, error: claimError } = await supabaseAdmin.rpc('claim_daily_send_budget', {
    p_date: today,
    p_max: maxDailyAllowed,
    p_requested: wantedSlots,
  })
  if (claimError) throw claimError
  if (!grantedSlots || grantedSlots <= 0) {
    console.log('Daily cap reached mid-campaign, stopping')
    break  // Stop processing further campaigns
  }

  // Fetch exactly grantedSlots enrollments (not wantedSlots)
  const { data: enrollmentsData } = await supabaseAdmin
    .from('campaign_enrollments')
    .select('*')
    .eq('campaign_id', campaign.id)
    .eq('status', 'pending')
    .or(`next_send_at.is.null,next_send_at.lte.${new Date().toISOString()}`)
    .limit(grantedSlots)  // ← was batchSize, now grantedSlots

  // ... rest of campaign send logic unchanged ...

  // REMOVE the upsert at lines 370-375 entirely — claim already incremented the counter
  // todaySent += chunk.length           ← DELETE
  // remainingBudget -= chunk.length     ← DELETE
  // await supabaseAdmin.from('email_send_log').upsert(...)  ← DELETE
}
```

**For the drip section** (lines 413-596): Same change. Before each drip send:

```typescript
// Before sending each drip enrollment:
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

// Then proceed with the Resend send as before
// REMOVE the upsert at lines 573-578 entirely
```

Note: The drip section currently iterates `dueEnrollments` and claims/sends one at a time — this is fine, each `rpc('claim_daily_send_budget', { p_requested: 1 })` is a separate atomic operation.

---

### Task 3: Add cap enforcement to `send-email/index.ts`

After the `resolveUser()` call and before the Resend send, add:

```typescript
// Fetch warmup state to compute today's cap
const today = new Date().toISOString().split('T')[0]
const { data: warmup } = await supabaseAdmin.from('warmup_state')
  .select('first_email_at').eq('id', 'default').maybeSingle()
const firstEmailAt = warmup?.first_email_at ? new Date(warmup.first_email_at) : null
const daysSinceFirstEmail = firstEmailAt
  ? Math.floor((Date.now() - firstEmailAt.getTime()) / (24 * 60 * 60 * 1000))
  : 0
const maxDailyAllowed = getMaxDailyAllowed(daysSinceFirstEmail)

// Claim slots for all emails in this request
const emailCount = emails.length
const { data: grantedSlots, error: claimError } = await supabaseAdmin.rpc('claim_daily_send_budget', {
  p_date: today,
  p_max: maxDailyAllowed,
  p_requested: emailCount,
})
if (claimError) throw claimError

if (!grantedSlots || grantedSlots <= 0) {
  return new Response(
    JSON.stringify({ error: 'Daily send limit reached. Sends will resume tomorrow.' }),
    { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// If near the cap, only send as many as were granted
const emailsToProcess = emails.slice(0, grantedSlots)
// Use emailsToProcess instead of emails for the rest of the function
```

Also add the `getMaxDailyAllowed` function to `send-email/index.ts` — copy exactly from `process-campaigns/index.ts` lines 42-50. Keep them in sync (both files already have a comment noting this).

---

### Task 4: SQL smoke test

After applying the migration, run these SQL statements to verify the function is correct:

```sql
-- Setup: insert a test row
INSERT INTO email_send_log (send_date, emails_sent)
VALUES ('2099-01-01', 0) ON CONFLICT DO NOTHING;

-- Test 1: normal claim — should return 10
SELECT claim_daily_send_budget('2099-01-01', 20, 10);
-- Verify: emails_sent should now be 10
SELECT emails_sent FROM email_send_log WHERE send_date = '2099-01-01';

-- Test 2: claim near the cap — should return 5 (not 15, only 10 remain)
-- (current = 15, max = 20, requested = 15 → granted = 5)
INSERT INTO email_send_log (send_date, emails_sent)
VALUES ('2099-01-02', 15) ON CONFLICT (send_date) DO UPDATE SET emails_sent = 15;
SELECT claim_daily_send_budget('2099-01-02', 20, 15);  -- expect 5

-- Test 3: cap already reached — should return 0
INSERT INTO email_send_log (send_date, emails_sent)
VALUES ('2099-01-03', 20) ON CONFLICT (send_date) DO UPDATE SET emails_sent = 20;
SELECT claim_daily_send_budget('2099-01-03', 20, 5);  -- expect 0

-- Test 4: no row exists — should create row and return requested amount
SELECT claim_daily_send_budget('2099-01-04', 20, 10);  -- expect 10
SELECT emails_sent FROM email_send_log WHERE send_date = '2099-01-04';  -- expect 10

-- Cleanup
DELETE FROM email_send_log WHERE send_date >= '2099-01-01';
```

Run these immediately after applying the migration (Task 1), before modifying any edge functions. All 4 tests must return the expected values.

---

## Deprecated Code to Remove

In `process-campaigns/index.ts`:
- `let todaySent = ...` variable declaration (line 91)
- `let remainingBudget = ...` variable declaration (line 92)
- The `remainingBudget` early-exit block (lines 94-99) — replace with the simpler SELECT-based check
- `batchSize` calculation using `remainingBudget` (line 131) — replaced by `grantedSlots`
- `todaySent += chunk.length` (line 370)
- `remainingBudget -= chunk.length` (line 371)
- The `email_send_log` upsert after campaign batch (lines 372-375)
- `todaySent += 1` (line 573)
- `remainingBudget -= 1` (line 574)
- The `email_send_log` upsert after drip send (lines 575-578)

## Validation

After implementation, deploy both edge functions and run the SQL smoke test (Task 4). Then verify:

1. Set `email_send_log` for today to `maxDailyAllowed - 1` (e.g. 19 for 20-cap domain)
2. Trigger `process-campaigns` manually — it should send exactly 1 email and stop
3. Check `email_send_log` — should show exactly `maxDailyAllowed`
4. Trigger `process-campaigns` again — should immediately return `{ dailyLimitReached: true }`
