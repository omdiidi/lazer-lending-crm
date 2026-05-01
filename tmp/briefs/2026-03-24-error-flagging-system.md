# Brief: Error Flagging System

## Why
API errors (out of credits, services down, batch send failures) are currently silent — logged to console.error() in edge functions but never surfaced to users. The user has no way to know when Apollo credits run out, Resend fails, or ZeroBounce stops validating. Campaign email failures are silently skipped with no record.

## Context

### Current Error Handling (Broken/Silent)
- `process-campaigns/index.ts` — Resend batch failures: logged, silently skipped. Enrollments marked 'sent' even when send fails.
- `lead-gen-chat/index.ts` — Apollo enrichment batch failures: `continue` with no record. Apollo search failures: returns empty array.
- `apollo-search/index.ts` — Same enrichment batch failure pattern.
- `send-email/index.ts` — Batch failures increment `failedCount` but don't persist errors.
- `generate-template/index.ts` — OpenRouter errors return 502 to frontend (already surfaced via toast).
- `campaign-ai/index.ts` — Missing `data?.error` check.
- ZeroBounce failures — Non-fatal, caught with `/* non-fatal */`.

### Current Error Handling (Working)
- Frontend pages use `toast.error()` for user-triggered action failures (send email, generate template, etc.)
- Edge functions return error JSON with HTTP 500/502 to the client
- `sonner` toast library is set up globally in App.tsx

### External APIs to Monitor
1. **Apollo.io** — People Search, Bulk Enrichment (credit-based)
2. **Resend** — Email send/batch send (credit-based)
3. **ZeroBounce** — Email validation (credit-based)
4. **OpenRouter** — LLM calls for campaign AI, lead gen chat, template generation (credit-based)

### Supabase Realtime
Already used for `leads`, `deals`, `emails`, `activities` tables. Can subscribe to `system_alerts` table for live alert updates.

## Decisions

### system_alerts table
- `id` UUID, `type` ('error' | 'warning'), `source` (API name), `message` (user-friendly), `details` JSONB (raw error data), `resolved` boolean default false, `created_at` timestamptz
- Visible to ALL authenticated team members (not admin-only)
- Edge functions write alerts when they catch API errors
- RLS: authenticated users can read all rows, service role writes

### Alert banner in App.tsx
- Subscribes to `system_alerts` via Supabase Realtime
- Only shows when there are unresolved alerts (fires only if there are issues)
- Small banner at the top of the app, dismissible per-alert
- Dismiss marks alert as `resolved` in the database
- Color-coded: red for errors, amber for warnings
- Shows most recent unresolved alert with a count badge if multiple

### Edge function error capture points
Each edge function writes to `system_alerts` when it catches a non-200 from an external API:

1. **process-campaigns** — Resend batch/single failures, mark enrollment as 'failed' (not 'sent')
2. **lead-gen-chat** — Apollo search 4xx/5xx, OpenRouter failures, ZeroBounce credit exhaustion
3. **apollo-search** — Apollo search/enrichment failures
4. **send-email** — Resend send failures (single + batch)
5. **generate-template** — OpenRouter failures
6. **campaign-ai** — OpenRouter failures
7. **apollo-phone-webhook** — Buffer write failures

### Campaign enrollment failure tracking
- When Resend fails in `process-campaigns`, mark enrollment as `'failed'` instead of silently skipping
- Failed enrollments are NOT retried automatically (avoids spam loops) — but they're visible in campaign detail

### Deduplication
- Don't create duplicate alerts for the same error source within 5 minutes
- Edge function checks: `SELECT id FROM system_alerts WHERE source = X AND resolved = false AND created_at > now() - interval '5 minutes'`
- If recent unresolved alert exists, skip creating a new one

## Rejected Alternatives
- **Email/Slack notifications** — overkill for now, the in-app banner is sufficient
- **Admin-only alerts** — all team members should see if something is broken
- **Auto-retry failed campaigns** — risky, could cause duplicate sends. Manual retry is safer.
- **External monitoring (Sentry, Datadog)** — adds cost and complexity. The system_alerts table is simpler and self-contained.

## Direction
Create a `system_alerts` table that edge functions write to when external API calls fail. Show an alert banner in the app (via Supabase Realtime) that only appears when there are unresolved issues. Capture errors from all 7 edge functions. Mark failed campaign enrollments as 'failed' instead of silently skipping. Deduplicate alerts within 5-minute windows.
