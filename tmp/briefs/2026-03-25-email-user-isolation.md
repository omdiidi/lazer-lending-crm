# Brief: Email User Isolation

## Why
All logged-in users can see every email in the system. The `emails` table has no `user_id` column, and RLS only checks `auth.uid() IS NOT NULL`. Each user should only see their own sent/received emails.

## Context
- `emails` table has no `user_id` column — schema at `src/types/database.ts:519-597`
- RLS policies on `emails`: `emails_select` = `auth.uid() IS NOT NULL` (no user scoping)
- `getEmails()` in `src/lib/api/emails.ts` fetches all non-deleted emails with no user filter
- `useEmails()` in `src/hooks/use-emails.ts` passes unfiltered results to OutreachPage
- OutreachPage filters only by direction (inbound/outbound) and search — no user filter
- Inbound webhook (`email-events/index.ts`) inserts emails without a `user_id`
- Campaign sends (`process-campaigns/index.ts`) have `campaign.sent_by` available
- Compose/reply sends (`send-email/index.ts`) authenticate the user via JWT — `authUser.id` is available
- `profiles.email_prefix` can map email addresses to users (e.g. `nick` → `nick@integrateapi.ai`)
- `profiles.role` distinguishes admin vs employee

## Decisions
- **Add `user_id` column to `emails` table** — FK to `auth.users`, set on every insert
- **RLS policy: `user_id = auth.uid()`** — each user only sees their own emails
- **Admin override** — admins can see all emails, but in a separate "All Emails" tab on OutreachPage
- **Inbound email ownership** — `email-events` matches the `to` address against `profiles.email_prefix` to determine `user_id`
- **Outbound email ownership** — `send-email` sets `user_id = authUser.id`; `process-campaigns` sets `user_id = campaign.sent_by`
- **Backfill existing emails** — match `from`/`to` addresses against profiles to assign `user_id`
- **Admin "All Emails" tab** — new tab on OutreachPage visible only to admin role, queries with service role or a separate RLS policy

## Rejected Alternatives
- **Shared inbox for everyone** — rejected because users should not see each other's emails
- **App-level filtering only (no RLS)** — rejected because RLS is the security boundary, app filtering can be bypassed

## Direction
Add `user_id` to `emails`, tighten RLS to `user_id = auth.uid()`, update all email insert paths (send-email, process-campaigns, email-events) to set `user_id`. Add an admin-only "All Emails" tab on OutreachPage. Backfill existing data.
