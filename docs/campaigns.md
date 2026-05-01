# Campaign Engine

> Campaign management dashboard with analytics, unsubscribe infrastructure, and template support.

**Status:** Complete (all phases shipped)
**Last Updated:** 2026-03-23
**Related Docs:** [OVERVIEW.md](./OVERVIEW.md) | [outreach.md](./outreach.md) | [schema.md](./schema.md)

---

## Overview

The campaign engine provides a full campaign management dashboard within the Outreach page. Users can create campaigns (via AI or manual mode), view campaign analytics (sent/opened/clicked/bounced), clone campaigns, and manage unsubscribes. Campaigns are linked to individual emails via `campaign_id` for analytics tracking.

---

## Features

### Campaign Management List
- All campaigns displayed with status badges (draft/active/paused/completed)
- Per-campaign analytics: sent, opened (%), clicked, bounced
- Actions: view detail, clone, delete
- Replaces the old campaign history expandable cards

### Campaign Detail Page
- Route: `/outreach/campaign/:id`
- Full analytics display (CampaignAnalytics component)
- Email content preview (subject + body)
- Recipient list with per-recipient delivery status (delivered/opened/clicked/bounced)
- Clone campaign button

### Campaign Cloning
- Clones name, subject, body, A/B variants
- Does NOT clone recipient_ids (stale data) — user must re-select audience

### Unsubscribe Infrastructure
- Route: `/unsubscribe/:token?email=...` (public, no auth)
- `{{unsubscribeLink}}` merge field auto-injected in campaign emails
- Unsubscribe tokens generated per-recipient at send time in send-email Edge Function
- Unsubscribe Edge Function handles token validation + record creation
- Unsubscribed leads excluded from future campaign recipient selection

### Scheduled Sends
- Date/time picker on the Campaign Builder preview step
- Campaigns with a `scheduled_at` value are dispatched by the `process-campaigns` Edge Function rather than immediately
- Scheduler runs every minute via pg_cron: `SELECT cron.schedule('process-campaigns', '* * * * *', ...)`

### Pause / Resume
- Campaigns in `active` status can be paused (sets status to `paused`)
- Paused campaigns can be resumed (sets status back to `active`)
- Pause/Resume actions available from CampaignList and CampaignDetailPage

### Per-Recipient Enrollment Tracking
- `campaign_enrollments` table records one row per recipient per campaign
- Columns: `id`, `campaign_id`, `lead_id`, `status` (pending/sent/failed/unsubscribed), `sent_at`, `created_at`, `updated_at`
- Allows per-lead delivery visibility in the CampaignDetailPage recipient list

### Reply Detection (Auto-Warm Leads)
- `email-events` Edge Function detects inbound replies referencing a `campaign_id` via `In-Reply-To` header
- On reply: sets lead `status` to `warm` automatically
- Enrollment record updated to reflect reply received

### Multi-Step Drip Sequences
- Campaigns can define up to 5 sequential drip steps, each with its own delay (in days), subject, and body
- Built with the SequenceEditor component — accessible from the Campaign Builder
- Stop conditions: unsubscribe, reply, or bounce halts further steps for that recipient; opens do not stop the sequence
- Sequence progress displayed on the CampaignDetailPage per-recipient (current step, steps completed, next send date)
- `process-campaigns` Edge Function extended to process drip steps: evaluates delay windows, respects stop conditions, advances enrollment step counters

### SequenceEditor
- Multi-step drip configuration UI embedded in CampaignBuilderPage
- Add/remove steps (up to 5); each step has delay_days, subject, and body fields
- Persists steps to `campaign_steps` table via `sequence_id` on the campaign

### Campaign Builder
- Route: `/outreach/campaign/new`
- Multi-step form: Name + Audience → Template → Sequence → Preview → Send/Draft
- Integrates AudienceSelector, TemplateEditor, and SequenceEditor components
- Preview step includes date/time picker for scheduled sends

### Template Library
- Save, load, and delete reusable email templates
- Backed by the `campaign_templates` table (user-scoped via `created_by`)
- Accessible from within the TemplateEditor

### AI Template Generation
- Powered by GPT-4.1-mini via OpenRouter (`generate-template` Edge Function)
- Generate from description: temperature 0.7 (creative generation)
- Cleanup/improve existing content: temperature 0.5 (conservative edits)

### A/B Testing
- Campaigns support two full body variants (Variant A and Variant B), each with independent subject and body fields
- Split is 50/50: recipients are divided evenly between variants at send time
- Per-variant analytics tracked independently: sent, opened, clicked, bounced counts and rates
- Winner comparison view in CampaignDetailPage shows side-by-side variant performance
- `ab_test_enabled`, `variant_b_subject`, `variant_b_body` columns on the `campaigns` table

### Smart Send Timing
- Campaigns with `smart_send` enabled deliver each email at 9 AM local time for the recipient's timezone
- Timezone is sourced from the `timezone` column on the lead record (populated during Apollo import)
- `process-campaigns` Edge Function uses the recipient's timezone offset to calculate the UTC send window
- Recipients with no timezone value fall back to immediate delivery (standard behavior)
- Controlled by the `smart_send` boolean column on the `campaigns` table
- Toggle exposed in the Campaign Builder preview step

### Lead Engagement Scoring
- Each lead carries a computed `engagement_score` derived from campaign interaction history
- Scoring formula: `opens × 1 + clicks × 3 + replies × 5`
- Score is recalculated by the `process-campaigns` Edge Function after each delivery event and stored on the lead record
- Badge displayed in the leads table and lead detail page showing the numeric score
- Dashboard "Hottest Leads" leaderboard ranks leads by engagement score descending

### Apollo Auto-Gen Pipeline
- Campaign builder includes an "Auto-Generate Audience from Apollo" option
- Triggers an Apollo search directly from the campaign builder (keyword + filters)
- Credit confirmation dialog shown before executing the search (displays estimated credit cost)
- Results are added to the audience selector for immediate use in the campaign

### TemplateEditor
- Rich editing with AI Generate, AI Improve, Template Library, Save to Library, and formatting toolbar

### AudienceSelector
- Lead filtering by search, status, and industry with checkbox selection
- Excludes unsubscribed leads from the selectable pool

### Analytics
- Computed from `emails` table via `campaign_id` foreign key
- Metrics: sent count, opened count + rate, clicked count, bounced count, unsubscribed count
- Real-time from webhook data (email-events Edge Function populates opened_at/clicked_at/bounced_at)

---

## Database Tables

### campaigns (expanded)
New columns: `name`, `status` (draft/active/paused/completed), `scheduled_at`, `drip_config` (jsonb), `variant_b_subject`, `variant_b_body`, `ab_test_enabled`, `sequence_id`, `smart_send` (boolean — enables timezone-based 9 AM local delivery)

### emails.campaign_id
New FK column linking emails to campaigns for analytics queries.

### campaign_templates (Phase 1b)
Template library for reusable email templates.

### campaign_sequences (Phase 2)
Links campaigns to follow-up sequences.

### campaign_steps (Phase 2)
Individual steps in a follow-up sequence with delay_days, subject, body.

### unsubscribes
Tracks unsubscribed leads. Token-based lookup. Indexed on lead_id and email.

---

## Edge Functions

| Function | Purpose |
|----------|---------|
| `send-email` | Batch sends now include campaign_id on email rows + inject {{unsubscribeLink}} |
| `unsubscribe` | Public endpoint — validates token, inserts unsubscribe record |
| `generate-template` | Generates or improves email templates via GPT-4.1-mini (OpenRouter); temp 0.7 for generation, 0.5 for cleanup |
| `process-campaigns` | Scheduled via pg_cron (every minute) — queries campaigns where `scheduled_at <= now()` and `status = active`, dispatches sends, updates enrollment records, handles pause checks |

---

## Phase Roadmap

- **Phase 1a (complete):** DB schema, campaign list + analytics, detail page, unsubscribe infrastructure, cloning
- **Phase 1b (complete):** Multi-step campaign builder, template library, AI template generation (GPT-4.1-mini), audience selector
- **Phase 2a (complete):** Scheduled sends (date/time picker), pause/resume, per-recipient enrollment tracking, reply detection (auto-warm leads), pg_cron scheduler
- **Phase 2b (complete):** Multi-step drip sequences (up to 5 steps), SequenceEditor, scheduler drip processing, stop conditions, sequence progress display
- **Phase 3a (complete):** A/B testing (full body variants, 50/50 split, per-variant analytics, winner comparison), Apollo auto-gen pipeline from campaign builder with credit confirmation
- **Phase 3b (complete):** Smart send timing (timezone-based 9 AM local delivery, `smart_send` column on campaigns, `timezone` on leads), lead engagement scoring (opens×1 + clicks×3 + replies×5, stored on lead, badge in leads table, Dashboard leaderboard)

---

## Changelog

| Date | Change | Files Affected |
|------|--------|----------------|
| 2026-03-23 | Campaign Engine Phase 1a: DB schema, campaign list, analytics, detail page, unsubscribe, cloning | All campaign files |
| 2026-03-23 | Campaign Engine Phase 1b: builder, templates, AI generation (GPT-4.1-mini), audience selector | CampaignBuilderPage, TemplateEditor, AudienceSelector, TemplateLibrary, generate-template |
| 2026-03-23 | Phase 2a: scheduling, pause/resume, enrollment tracking, reply detection, pg_cron scheduler | process-campaigns, CampaignBuilderPage, CampaignDetailPage, CampaignList, email-events |
| 2026-03-23 | Phase 2b: multi-step drip sequences, SequenceEditor, scheduler drip processing, stop conditions, sequence progress display | SequenceEditor, CampaignBuilderPage, process-campaigns, CampaignDetailPage |
| 2026-03-23 | Phase 3a: A/B testing (full body variants, 50/50 split, per-variant analytics, winner comparison), Apollo auto-gen pipeline with credit confirmation | CampaignBuilderPage, CampaignDetailPage, CampaignAnalytics, send-email |
| 2026-03-23 | Phase 3b: Smart send timing (9 AM local via lead timezone, smart_send column on campaigns), lead engagement scoring (opens×1 + clicks×3 + replies×5, badge in leads table, Dashboard leaderboard) | process-campaigns, CampaignBuilderPage, LeadsPage, LeadDetailPage, DashboardPage |
