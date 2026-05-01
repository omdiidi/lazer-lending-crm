# Brief: Full Campaign Automation Engine

## Why
The current campaign tab is a chatbot-only interface with manual recipient selection. Salespeople need a full campaign management dashboard with audience filtering, AI template generation, A/B testing, follow-up sequences, scheduling, drip sends, analytics, and Apollo lead auto-generation. This turns the CRM from a tool into an automation platform.

## Context
- Current campaign UI: `src/pages/OutreachPage.tsx` — Campaigns tab has AI chatbot + manual mode
- `CampaignAIChat.tsx` — current AI chat for campaign creation (will become supplemental, filling form fields)
- Existing `campaigns` table: id, subject, body, recipient_ids[], sent_at, sent_by
- Existing `email_sequences` + `sequence_steps` tables (display-only, never wired to execution)
- `send-email` Edge Function handles single + batch sends via Resend
- `email-events` Edge Function handles bounce/open/click/complaint webhooks
- `emailSafeLeads` filter already excludes unverified/invalid leads from campaigns
- Apollo `apollo-search` Edge Function already returns enriched leads with ZeroBounce validation
- Resend free tier: 3,000 emails/mo, 100/day
- All existing docs in `docs/` directory need to be kept in sync

## Decisions

### Phase 1: Campaign Builder Dashboard + Infrastructure
- **New Campaign Management tab** — replaces or sits alongside current Campaigns tab. Shows all campaigns (draft, active, paused, completed) with per-campaign analytics
- **Campaign builder form** — audience selection (filters), template creation (AI or manual), preview, A/B variant support, send/schedule
- **AI template generation** — describe requirements → AI generates subject + body, OR paste template → AI suggests cleanup. Uses DeepSeek V3.2 via existing campaign-ai Edge Function (extended)
- **Template library** — save templates for reuse. New `campaign_templates` table
- **AI chatbot becomes supplemental** — still accessible, but its output fills the builder form fields instead of being the primary UI
- **Unsubscribe page** — standalone React route (`/unsubscribe/:token`) that marks a lead as unsubscribed
- **`{{unsubscribeLink}}` merge field** — auto-injected into every campaign email body
- **Unsubscribes table** — new DB table, leads excluded from all future campaign sends
- **Campaign analytics** — sent, delivered, opened, clicked, bounced, replied, unsubscribed per campaign
- **Campaign cloning** — duplicate a campaign with editable fields
- **Full database schema for all phases** — build all tables now even if Phase 2/3 features use them later

### Phase 2: Automation (future session)
- Scheduled sends (date/time picker)
- Drip sends (spread over hours/days — configurable rate)
- Follow-up sequences (up to 5 steps: intro + 4 follow-ups, each with delay_days, subject, body)
- Stop conditions: unsubscribe stops sequence. Opens/clicks do NOT stop.
- Suspend/resume/edit campaigns mid-flight
- Reply detection → auto-flag lead as "warm" + notify rep

### Phase 3: Advanced (future session)
- Apollo auto-gen pipeline in campaigns (with credit confirmation)
- A/B testing execution + winner selection (full body variants, not just subject)
- Smart send timing (timezone-based from Apollo location data)
- Lead engagement scoring (aggregate opens/clicks/replies across campaigns)
- Campaign cloning enhancements

### Database Tables (ALL created in Phase 1)

**Modified: `campaigns` table**
- Add: status (draft/active/paused/completed), scheduled_at, drip_config (jsonb), variant_a_subject, variant_a_body, variant_b_subject, variant_b_body, ab_test_enabled, sequence_id, analytics (jsonb cache)

**New: `campaign_templates`**
- id, name, subject, body, created_by, tags[], created_at, updated_at

**New: `campaign_sequences`** (or modify existing `email_sequences`)
- id, campaign_id, steps[] (jsonb or separate table), active

**New: `campaign_steps`**
- id, sequence_id, order, delay_days, subject, body, variant_b_subject, variant_b_body

**New: `unsubscribes`**
- id, lead_id (FK), email, token (unique, for unsubscribe link), unsubscribed_at

**New: `campaign_analytics`** (materialized/cached per campaign)
- campaign_id, sent, delivered, opened, clicked, bounced, replied, unsubscribed, updated_at

### Follow-up Sequences
- Max 5 steps (intro + 4 follow-ups)
- Each step: delay_days, subject, body
- Stop condition: unsubscribe only (opens/clicks do NOT stop the sequence)
- Replies stop the sequence for that specific lead

### A/B Testing
- Full body variants (not just subject)
- 50/50 split by default
- Track separate analytics per variant
- AI tools to help analyze results

### Unsubscribe Flow
- Every campaign email includes `{{unsubscribeLink}}` — auto-replaced with a unique per-lead URL
- Unsubscribe page at `/unsubscribe/:token` — simple page confirming opt-out
- Link to this page shown in Settings for admin reference
- Actual domain URL configured later when hosted on real domain

## Rejected Alternatives
- **Keep chatbot as primary UI** — not scalable for complex campaigns with multiple filters, A/B tests, sequences
- **Build all 3 phases at once** — too much scope for one session
- **Subject-only A/B testing** — user wants full body variants for deeper testing
- **Opens/clicks as stop conditions** — user explicitly wants only unsubscribes to stop sequences

## Direction
Phase 1 builds the full campaign dashboard UI (builder, templates, analytics, management list), all database tables for all 3 phases, unsubscribe infrastructure, and campaign cloning. The AI chatbot becomes supplemental (fills form fields). Phase 2 adds automation (scheduling, drip, sequences). Phase 3 adds Apollo auto-gen, A/B execution, and advanced analytics.
