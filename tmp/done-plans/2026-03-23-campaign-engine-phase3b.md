# Plan: Campaign Engine Phase 3b — Smart Send Timing + Lead Engagement Scoring

**Confidence: 9/10** — Focused scope: timezone column + lookup in scheduler, engagement score computation + dashboard display. No new Edge Functions needed.

## Goal

Send campaign emails at optimal times based on the recipient's timezone (9 AM local). Score leads by engagement (opens, clicks, replies) across all campaigns and surface the hottest leads on the dashboard.

## What — Phase 3b Scope

### Smart Send Timing
1. **Add `timezone` column to leads** — stores IANA timezone (e.g., "America/Los_Angeles")
2. **Derive timezone from location** — when Apollo imports leads, map "City, State, Country" to timezone
3. **Scheduler sends at 9 AM local** — for scheduled/drip campaigns, calculate when 9 AM hits in the lead's timezone and set `next_send_at` accordingly
4. **Builder option** — toggle "Optimize send time" in step 4

### Lead Engagement Scoring
1. **Engagement score per lead** — computed from: opens (+1), clicks (+3), replies (+5) across all campaigns
2. **Dashboard leaderboard** — "Hottest Leads" card showing top 10 leads by engagement score
3. **Leads page badge** — small engagement score indicator on leads with high scores
4. **Computed on the fly** — no new table, query aggregated from emails + enrollments

---

## Files Being Changed

```
src/
├── pages/
│   ├── CampaignBuilderPage.tsx         ← MODIFIED (smart send toggle in step 4)
│   ├── DashboardPage.tsx               ← MODIFIED (hottest leads card)
│   └── LeadsPage.tsx                   ← MODIFIED (engagement score badge)
├── components/
│   └── campaigns/
│       └── EngagementLeaderboard.tsx   ← NEW (hottest leads display)
├── hooks/
│   └── use-engagement.ts              ← NEW (engagement score computation)
├── lib/
│   └── api/
│       └── engagement.ts              ← NEW (engagement score queries)
├── types/
│   ├── crm.ts                         ← MODIFIED (add timezone to Lead)
│   └── database.ts                    ← MODIFIED (add timezone to leads table)
supabase/
├── functions/
│   ├── process-campaigns/
│   │   └── index.ts                   ← MODIFIED (timezone-aware send scheduling)
│   └── apollo-search/
│       └── index.ts                   ← MODIFIED (derive timezone on import)
docs/
├── campaigns.md                        ← MODIFIED
├── leads.md                            ← MODIFIED
├── dashboard.md                        ← MODIFIED
├── schema.md                           ← MODIFIED
├── OVERVIEW.md                         ← MODIFIED
```

---

## Architecture Overview

### Smart Send Timing Flow
```
Apollo imports lead with location "Austin, Texas, United States"
  → apollo-search Edge Function maps to timezone "America/Chicago"
  → Stored on lead record

Campaign scheduled or drip step due:
  → Scheduler checks lead.timezone
  → If timezone exists: calculate when 9 AM local hits
    → If 9 AM already passed today: schedule for 9 AM tomorrow
    → If 9 AM hasn't passed: schedule for 9 AM today
  → Set enrollment.next_send_at to the calculated time
  → Process on the next cron tick after that time

If no timezone: send immediately (existing behavior)
```

### Timezone Mapping
```
Simple US timezone mapping (covers ~90% of Apollo leads):
  - Eastern states (NY, FL, GA, etc.) → America/New_York
  - Central states (TX, IL, MN, etc.) → America/Chicago
  - Mountain states (CO, AZ, UT, etc.) → America/Denver
  - Pacific states (CA, WA, OR, etc.) → America/Los_Angeles

International: use country → common timezone mapping
  - United Kingdom → Europe/London
  - Germany → Europe/Berlin
  - India → Asia/Kolkata
  - Australia → Australia/Sydney

Fallback: no timezone = send immediately
```

### Engagement Score
```
Per lead, aggregate across ALL campaigns:
  Score = (opens × 1) + (clicks × 3) + (replies × 5)

Query:
  SELECT lead_id,
    COUNT(CASE WHEN opened_at IS NOT NULL THEN 1 END) * 1 +
    COUNT(CASE WHEN clicked_at IS NOT NULL THEN 1 END) * 3 as email_score
  FROM emails
  WHERE direction = 'outbound' AND lead_id IS NOT NULL
  GROUP BY lead_id

  + SELECT lead_id, COUNT(*) * 5 as reply_score
    FROM emails
    WHERE direction = 'inbound' AND lead_id IS NOT NULL
    GROUP BY lead_id

  Combined: email_score + reply_score = engagement_score
```

---

## DB Migration

```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS smart_send boolean NOT NULL DEFAULT false;
```

---

## Key Pseudocode

### Timezone Mapping Function (in apollo-search Edge Function)

```typescript
function deriveTimezone(city: string, state: string, country: string): string | null {
  // Split location and match STATE token specifically (index 1)
  // to avoid false positives (e.g., "Washington, DC" matching Pacific)
  const parts = `${city}, ${state}, ${country}`.split(',').map(s => s.trim().toLowerCase())
  const stateToken = parts[1] || ''
  const countryToken = parts[2] || parts[1] || ''

  // US state → timezone mapping (matched against state token only)
  const usTimezones: Record<string, string> = {
    'california': 'America/Los_Angeles', 'washington': 'America/Los_Angeles',
    'oregon': 'America/Los_Angeles', 'nevada': 'America/Los_Angeles',
    'texas': 'America/Chicago', 'illinois': 'America/Chicago',
    'minnesota': 'America/Chicago', 'wisconsin': 'America/Chicago',
    'missouri': 'America/Chicago', 'iowa': 'America/Chicago',
    'louisiana': 'America/Chicago', 'oklahoma': 'America/Chicago',
    'arkansas': 'America/Chicago', 'mississippi': 'America/Chicago',
    'alabama': 'America/Chicago', 'tennessee': 'America/Chicago',
    'kansas': 'America/Chicago', 'nebraska': 'America/Chicago',
    'new york': 'America/New_York', 'florida': 'America/New_York',
    'georgia': 'America/New_York', 'north carolina': 'America/New_York',
    'south carolina': 'America/New_York', 'virginia': 'America/New_York',
    'massachusetts': 'America/New_York', 'pennsylvania': 'America/New_York',
    'new jersey': 'America/New_York', 'connecticut': 'America/New_York',
    'maryland': 'America/New_York', 'ohio': 'America/New_York',
    'michigan': 'America/New_York', 'indiana': 'America/New_York',
    'colorado': 'America/Denver', 'utah': 'America/Denver',
    'arizona': 'America/Denver', 'new mexico': 'America/Denver',
    'montana': 'America/Denver', 'wyoming': 'America/Denver', 'idaho': 'America/Denver',
    'hawaii': 'Pacific/Honolulu', 'alaska': 'America/Anchorage',
  }

  // Check US states against the state token only
  for (const [st, tz] of Object.entries(usTimezones)) {
    if (stateToken === st || stateToken.includes(st)) return tz
  }

  // International country mapping (check country token)
  const countryTimezones: Record<string, string> = {
    'united kingdom': 'Europe/London', 'uk': 'Europe/London',
    'germany': 'Europe/Berlin', 'france': 'Europe/Paris',
    'india': 'Asia/Kolkata', 'australia': 'Australia/Sydney',
    'japan': 'Asia/Tokyo', 'china': 'Asia/Shanghai',
    'canada': 'America/Toronto', 'brazil': 'America/Sao_Paulo',
    'mexico': 'America/Mexico_City', 'israel': 'Asia/Jerusalem',
    'singapore': 'Asia/Singapore', 'south korea': 'Asia/Seoul',
  }

  for (const [c, tz] of Object.entries(countryTimezones)) {
    if (countryToken.includes(c)) return tz
  }

  return null
}
```

### Scheduler Smart Send (in process-campaigns)

```typescript
// When creating enrollments for a scheduled campaign with smart_send enabled:
// Calculate optimal send time per lead based on timezone

function calculateOptimalSendTime(timezone: string | null): Date {
  if (!timezone) return new Date() // No timezone = send immediately

  // Use Intl.DateTimeFormat to get the correct UTC offset for the timezone
  const now = new Date()

  // Get current hour in the lead's timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  })
  const localHour = parseInt(formatter.format(now))

  const targetHour = 9 // 9 AM local
  let hoursUntilTarget = targetHour - localHour

  if (hoursUntilTarget <= 0) {
    // 9 AM already passed today → schedule for 9 AM tomorrow
    hoursUntilTarget += 24
  }

  // Add the hours difference to current UTC time
  return new Date(now.getTime() + hoursUntilTarget * 60 * 60 * 1000)
}
```

### Engagement Score Query

```typescript
export async function getLeadEngagementScores(): Promise<Map<string, number>> {
  // Get outbound email engagement (last 90 days only for performance)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const { data: outbound } = await supabase
    .from('emails')
    .select('lead_id, opened_at, clicked_at')
    .eq('direction', 'outbound')
    .not('lead_id', 'is', null)
    .gte('sent_at', ninetyDaysAgo)

  // Get inbound replies (last 90 days)
  const { data: inbound } = await supabase
    .from('emails')
    .select('lead_id')
    .eq('direction', 'inbound')
    .not('lead_id', 'is', null)
    .gte('sent_at', ninetyDaysAgo)

  const scores = new Map<string, number>()

  for (const e of outbound || []) {
    if (!e.lead_id) continue
    const current = scores.get(e.lead_id) || 0
    let add = 0
    if (e.opened_at) add += 1
    if (e.clicked_at) add += 3
    scores.set(e.lead_id, current + add)
  }

  for (const e of inbound || []) {
    if (!e.lead_id) continue
    const current = scores.get(e.lead_id) || 0
    scores.set(e.lead_id, current + 5)
  }

  return scores
}
```

---

## Task Execution Order

### Task 1: DB Migration
Add `timezone text` column to leads table.

### Task 2: Update types
Add `timezone?: string` to Lead in crm.ts and `timezone: string | null` to leads in database.ts.

### Task 3: Update apollo-search Edge Function
Add `deriveTimezone()` function. In the lead transform (Step 5), set `timezone` from city/state/country.

### Task 4: Create engagement API + hook
- `src/lib/api/engagement.ts` — `getLeadEngagementScores()`, `getTopEngagedLeads(limit)`
- `src/hooks/use-engagement.ts` — React Query hook

### Task 5: Create EngagementLeaderboard component
- `src/components/campaigns/EngagementLeaderboard.tsx` — top 10 leads by score

### Task 6: Update DashboardPage
Add "Hottest Leads" card using EngagementLeaderboard.

### Task 7: Update LeadsPage
Add small engagement score badge on leads with score > 0.

### Task 8: Update CampaignBuilderPage
Add "Optimize send time" toggle in step 4.

### Task 9: Update process-campaigns scheduler
When campaign has smart send enabled, calculate per-lead optimal send time based on timezone.

### Task 10: Deploy + test + docs

---

## Validation Gates

1. `npm run build` passes
2. Apollo import sets timezone on new leads
3. Dashboard shows "Hottest Leads" with engagement scores
4. Leads page shows engagement badges
5. Builder step 4: "Optimize send time" toggle visible
6. Scheduled campaign with smart send: enrollments get timezone-adjusted next_send_at

---

## Known Gotchas

```
1. Timezone derivation is approximate — US state mapping covers ~90% of cases.
   International is best-effort. Leads without recognizable locations get no timezone.

2. Smart send only applies to SCHEDULED and DRIP campaigns, not "Send Now".
   "Send Now" sends immediately regardless of timezone.

3. The scheduler checks next_send_at <= now() — if a lead's 9 AM is 3 hours away,
   their enrollment sits as 'pending' until the next cron tick after that time.

4. Engagement scores are computed on the fly — no caching. For <1000 leads this is
   fine. If it gets slow, add a materialized view or cache table later.

5. The timezone column is nullable — existing leads get NULL (no timezone).
   Only Apollo-imported leads get a timezone.

6. Engagement score model (per email row): opened=+1, clicked=+3. Per inbound
   reply: +5. A clicked email that was also opened scores +4 (1+3). This is
   the implemented model — matches the TypeScript code, not the SQL pseudocode.

7. The LeadResult interface in apollo-search must include timezone in the return.

8. campaigns.smart_send column added via migration. Campaign type must include
   smartSend?: boolean. Builder stores it, scheduler reads it.

9. Timezone mapping uses SPLIT on ", " and matches the STATE token (index 1)
   specifically — NOT substring on the full concatenated location string.
   This prevents "Washington, DC" from matching Pacific timezone.

10. calculateOptimalSendTime uses Intl.DateTimeFormat to get the local hour
    in the lead's timezone, then calculates hours until 9 AM and adds to UTC now.
    This avoids the broken offset calculation from Date.toLocaleString.

11. Engagement query filtered to last 90 days for performance.
```

---

## Deprecated Code (to remove)

None — adds new functionality.
