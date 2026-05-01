# Brief: Campaign Emails in Activity Timeline + Thread Linking

## Why
Campaign emails sent by `process-campaigns` don't appear in the Lead Detail Activity Timeline. Users see "No activity recorded yet" even after a campaign email was delivered to that lead. Manual emails from Outreach DO create activities — campaign emails don't. This makes it impossible to see a lead's full interaction history from their detail page.

## Context

### Current Behavior
- `process-campaigns` inserts email records into the `emails` table with `lead_id` and `campaign_id` — these show in the Gmail-style inbox
- But it does NOT insert into the `activities` table — so LeadDetailPage Activity Timeline is blank for campaign emails
- Manual compose/reply from OutreachPage DOES create `email_sent` activities via `addActivity()`
- The `emails` table has `thread_id` (format: `t-camp-{campaignId}-{leadId}`) which can link to the inbox thread

### Files Involved
- `supabase/functions/process-campaigns/index.ts` — bulk send (lines 297-312) and drip send (lines 473-486) insert email records but NO activity records
- `src/pages/LeadDetailPage.tsx` — Activity Timeline only reads from `activities` table, doesn't query `emails` table
- `src/hooks/use-activities.ts` — fetches activities for a lead, has `addActivity` function
- Activity types defined in `src/types/crm.ts`: `'call' | 'email_sent' | 'email_received' | 'note' | 'status_change' | 'meeting'`

### Thread ID Format
Campaign emails use `thread_id: t-camp-${campaign.id}-${enrollment.lead_id || enrollment.id}`. This can be used to deep-link from the activity timeline to the specific email thread in Outreach.

## Decisions
- **Add activity creation in process-campaigns** — after each successful campaign email send (both bulk and drip paths), insert an `email_sent` activity for that lead
- **Activity description format** — `Campaign email sent: "${subject}"` to distinguish from manual emails
- **Activity metadata** — include `campaign_id` and `thread_id` in the activity's metadata field so the frontend can link to the thread
- **LeadDetailPage: clickable email activities** — email_sent activities with a `thread_id` in metadata should link to `/outreach?thread={threadId}` (or similar) to open that thread in the inbox
- **Use `campaign.sent_by` as the activity userId** — the campaign sender is the "user" who performed the action

## Rejected Alternatives
- **Query emails table in LeadDetailPage** — adds complexity, mixes two data sources in the timeline. Better to have a single source (activities) with links to emails.
- **Skip activity creation, just show emails inline** — breaks the established pattern where activities = CRM interaction log

## Direction
Add activity record creation in `process-campaigns` for every successfully sent campaign email (bulk + drip). Include `campaign_id` and `thread_id` in activity metadata. On LeadDetailPage, make email activities with thread metadata clickable — linking to the email thread in Outreach.
