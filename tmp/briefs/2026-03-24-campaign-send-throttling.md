# Brief: Campaign Send Throttling & Domain Warmup

## Why
The current campaign scheduler blasts emails with only 250ms between batches of 100 — no daily volume caps, no send spacing, no warmup awareness. For a new domain (mail.integrateapi.ai), this destroys sender reputation. Gmail/Outlook throttle or block senders that spike volume. Need a built-in warmup-aware throttling system.

## Context

### Current Sending Behavior
- `process-campaigns/index.ts` runs every minute via pg_cron
- Fetches 100 pending enrollments per campaign per run
- Sends via Resend batch API in chunks of 100 with 250ms delay between chunks
- Smart send feature exists (delays to 9 AM local time) but doesn't pace emails
- No daily volume cap, no per-email spacing, no warmup schedule

### Industry Best Practices (from research)
- New domain: start at 10-20 emails/day, ramp over 4-8 weeks
- Established domain: 100-200 emails/day max for cold outreach
- Min 5-12 minutes between individual emails with randomization
- Gmail: max 20-25 emails/hour from a single domain
- Spam complaint rate must stay below 0.1%

### Files Affected
- `process-campaigns/index.ts` — main scheduler, needs daily cap enforcement + spacing
- `CampaignBuilderPage.tsx` — needs daily send rate dropdown
- `SettingsPage.tsx` — needs re-warmup toggle (admin only)
- Needs new table or setting to track warmup state (first email date, current tier)

## Decisions

### Per-campaign daily send rate dropdown
- Dropdown in Campaign Builder with stepped options: 5, 10, 15, 20, 25, 50, 75, 100, 150, 200 per day
- Higher tiers locked/greyed out based on domain warmup age
- Stored on the campaign record (e.g., `daily_send_limit` column)
- This is NOT a total campaign cap — a 500-recipient campaign at 20/day runs for 25 days

### Warmup tier unlock schedule (automatic)
- System tracks the date of the very first campaign email sent (stored in a settings/config table)
- Unlocked tiers based on days since first email:
  - Day 0-7: max 5, 10, 15, 20
  - Day 8-14: unlock 25
  - Day 15-21: unlock 50
  - Day 22-30: unlock 75
  - Day 31-60: unlock 100
  - Day 61-90: unlock 150
  - Day 91+: unlock 200 (all tiers available)

### Shared domain-wide daily cap
- The daily send limit is shared across ALL campaigns, ALL users on the same account
- If one campaign sends 18 of the day's 20 limit, another campaign only gets 2 more
- Track daily sent count in a simple table: `daily_email_count` with date + count
- The scheduler checks the global daily count before sending each batch
- Prevents any user from exceeding the domain's safe daily volume

### Campaign completion over multiple days
- Single-email campaigns with more recipients than the daily cap automatically spread over multiple days
- The scheduler processes pending enrollments each run (every minute), but stops when the daily cap is hit
- Next day, it picks up where it left off and continues sending
- Campaign status stays 'active' until all enrollments are processed

### Smart send spacing toggle
- Per-campaign toggle: "Space emails evenly throughout the day"
- When ON: emails spread across an 8-hour window (e.g., 8 AM - 4 PM) with randomization. 20 emails/day = one every ~24 minutes ± random 1-5 minutes
- When OFF: emails send as fast as the scheduler allows within the daily cap (front-loaded, but still respects per-minute processing limits)
- Stored on campaign record (e.g., `send_spacing` boolean)

### Re-warmup toggle in admin settings
- Button in Settings (admin only): "Reset Domain Warmup"
- Resets the first-email-sent date to now, restarting the tier unlock schedule
- Use case: domain reputation tanked, need to start warmup process over
- Requires confirmation dialog ("This will restrict your daily send limits. Are you sure?")

### No per-provider hourly caps
- Skip tracking Gmail vs Outlook recipients per hour
- The daily cap + spacing should be sufficient for deliverability

## Rejected Alternatives
- **Global hardcoded volume cap** — too rigid, user needs per-campaign control
- **Per-provider hourly caps (Gmail/Outlook tracking)** — over-engineered, daily cap + spacing is sufficient
- **Manual warmup date in settings** — automatic tracking from first email is cleaner
- **Total campaign cap (not per-day)** — defeats the purpose of warmup; need daily pacing

## Direction
Add a daily send rate dropdown to campaigns with warmup-aware tier unlocking. Track first email date automatically to calculate which tiers are available. Enforce a shared domain-wide daily cap across all campaigns and users. Add a smart spacing toggle to spread emails throughout the day. Add a re-warmup reset in admin settings. Campaigns with more recipients than the daily cap automatically spread over multiple days.
