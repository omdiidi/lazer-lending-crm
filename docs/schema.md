# Database Schema

> Supabase PostgreSQL schema — tables, relationships, RLS policies, triggers, and conventions.

**Status:** Active
**Last Updated:** 2026-03-24
**Supabase Project:** `onthjkzdgsfvmgyhrorw` (CRM, us-east-1)
**Related Docs:** [OVERVIEW.md](./OVERVIEW.md) | [data-model.md](./data-model.md) | [state-management.md](./state-management.md) | [architecture.md](./architecture.md)

---

## Overview

The database runs on Supabase (managed PostgreSQL). It mirrors the TypeScript types in `src/types/crm.ts` with snake_case naming. All tables use UUID primary keys, `created_at`/`updated_at` timestamps, and Row Level Security. A transform layer (`src/lib/transforms.ts`) converts between snake_case (DB) and camelCase (TypeScript).

---

## File Map

| File | Purpose |
|------|---------|
| `src/lib/supabase.ts` | Supabase client singleton |
| `src/lib/transforms.ts` | snake_case ↔ camelCase conversion utilities |
| `src/lib/api/*.ts` | Typed query functions per entity (8 files) |
| `src/types/database.ts` | Auto-generated Supabase TypeScript types |
| `src/types/crm.ts` | App-facing camelCase interfaces |
| `.env` | Supabase URL + anon key |

---

## Tables

### profiles
Extends `auth.users`. Auto-created via trigger on user signup.

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | uuid | PK, FK → auth.users(id) ON DELETE CASCADE | — |
| name | text | NOT NULL | — |
| email | text | NOT NULL, UNIQUE | — |
| role | text | NOT NULL, CHECK (admin, employee) | 'employee' |
| avatar | text | — | NULL |
| email_prefix | text | — | NULL |
| created_at | timestamptz | NOT NULL | now() |
| updated_at | timestamptz | NOT NULL | now() (auto-updated) |

### leads
Central CRM entity.

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | uuid | PK | uuid_generate_v4() |
| first_name | text | NOT NULL | — |
| last_name | text | NOT NULL | — |
| email | text | NOT NULL | — |
| phone | text | NOT NULL | '' |
| job_title | text | NOT NULL | '' |
| company | text | NOT NULL | '' |
| company_size | text | NOT NULL | '' |
| industry | text | NOT NULL | '' |
| location | text | NOT NULL | '' |
| status | text | NOT NULL, CHECK (cold, lukewarm, warm, dead) | 'cold' |
| assigned_to | uuid | FK → profiles(id) ON DELETE SET NULL | NULL |
| last_contacted_at | timestamptz | — | NULL |
| notes | text | NOT NULL | '' |
| tags | text[] | NOT NULL | '{}' |
| linkedin_url | text | — | NULL |
| apollo_id | text | — | NULL |
| email_status | text | NOT NULL | 'unverified' |
| timezone | text | — | NULL |
| engagement_score | integer | NOT NULL | 0 |
| created_at | timestamptz | NOT NULL | now() |
| updated_at | timestamptz | NOT NULL | now() (auto-updated) |
| deleted_at | timestamptz | — | NULL (soft delete) |

**Indexes:** assigned_to, status, industry, deleted_at (partial: WHERE NULL)

**FK note:** `assigned_to` uses `ON DELETE SET NULL` (nullable) so that deleting a team member does not cascade-delete their leads — the leads are preserved and become unassigned.

### activities

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | uuid | PK | uuid_generate_v4() |
| lead_id | uuid | NOT NULL, FK → leads(id) ON DELETE CASCADE | — |
| user_id | uuid | NOT NULL, FK → profiles(id) | — |
| type | text | NOT NULL, CHECK (call, email_sent, email_received, note, status_change, meeting) | — |
| description | text | NOT NULL | '' |
| timestamp | timestamptz | NOT NULL | now() |
| metadata | jsonb | — | NULL |
| created_at | timestamptz | NOT NULL | now() |
| updated_at | timestamptz | NOT NULL | now() (auto-updated) |
| deleted_at | timestamptz | — | NULL (soft delete) |

**Indexes:** lead_id, user_id, type

### emails

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | uuid | PK | uuid_generate_v4() |
| lead_id | uuid | FK → leads(id) ON DELETE SET NULL | NULL |
| from | text | NOT NULL | — |
| to | text | NOT NULL | — |
| subject | text | NOT NULL | '' |
| body | text | NOT NULL | '' |
| sent_at | timestamptz | NOT NULL | now() |
| read | boolean | NOT NULL | false |
| direction | text | NOT NULL, CHECK (inbound, outbound) | — |
| thread_id | text | — | NULL |
| reply_to_id | uuid | FK → emails(id) ON DELETE SET NULL | NULL |
| provider_message_id | text | — | NULL |
| campaign_id | uuid | FK → campaigns(id) ON DELETE SET NULL | NULL |
| opened_at | timestamptz | — | NULL |
| clicked_at | timestamptz | — | NULL |
| bounced_at | timestamptz | — | NULL |
| created_at | timestamptz | NOT NULL | now() |
| updated_at | timestamptz | NOT NULL | now() (auto-updated) |
| deleted_at | timestamptz | — | NULL (soft delete) |

**Indexes:** lead_id, thread_id, direction, campaign_id, deleted_at (partial: WHERE NULL)

### deals

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | uuid | PK | uuid_generate_v4() |
| lead_id | uuid | NOT NULL, FK → leads(id) ON DELETE CASCADE | — |
| title | text | NOT NULL | — |
| value | numeric(12,2) | NOT NULL | 0 |
| stage | text | NOT NULL, CHECK (new, contacted, qualified, proposal, negotiation, closed_won, closed_lost) | 'new' |
| assigned_to | uuid | FK → profiles(id) ON DELETE SET NULL | NULL |
| created_at | timestamptz | NOT NULL | now() |
| updated_at | timestamptz | NOT NULL | now() (auto-updated) |
| deleted_at | timestamptz | — | NULL (soft delete) |

**Indexes:** lead_id, assigned_to, stage, deleted_at (partial: WHERE NULL)

**FK note:** `assigned_to` uses `ON DELETE SET NULL` (nullable) so that deleting a team member preserves their deals in an unassigned state.

### ai_suggestions

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | uuid | PK | uuid_generate_v4() |
| lead_id | uuid | NOT NULL, FK → leads(id) ON DELETE CASCADE | — |
| suggestion | text | NOT NULL | — |
| priority | text | NOT NULL, CHECK (high, medium, low) | 'medium' |
| dismissed | boolean | NOT NULL | false |
| created_at | timestamptz | NOT NULL | now() |
| updated_at | timestamptz | NOT NULL | now() (auto-updated) |

**Indexes:** lead_id, dismissed (partial: WHERE false)

### campaigns

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | uuid | PK | uuid_generate_v4() |
| name | text | NOT NULL | '' |
| subject | text | NOT NULL | — |
| body | text | NOT NULL | — |
| status | text | NOT NULL, CHECK (draft, active, paused, completed) | 'draft' |
| recipient_ids | uuid[] | NOT NULL | '{}' |
| sent_at | timestamptz | NOT NULL | now() |
| sent_by | uuid | NOT NULL, FK → profiles(id) | — |
| scheduled_at | timestamptz | — | NULL |
| drip_config | jsonb | — | NULL |
| variant_b_subject | text | — | NULL |
| variant_b_body | text | — | NULL |
| ab_test_enabled | boolean | NOT NULL | false |
| sequence_id | uuid | FK → email_sequences(id) ON DELETE SET NULL | NULL |
| smart_send | boolean | NOT NULL | false |
| created_at | timestamptz | NOT NULL | now() |
| updated_at | timestamptz | NOT NULL | now() (auto-updated) |
| deleted_at | timestamptz | — | NULL (soft delete) |

**Indexes:** sent_by, status, deleted_at (partial: WHERE NULL)

### unsubscribes
Tracks leads who have opted out of campaigns. Populated by the `unsubscribe` Edge Function via token validation.

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | uuid | PK | uuid_generate_v4() |
| lead_id | uuid | FK → leads(id) ON DELETE CASCADE | NULL |
| email | text | NOT NULL | — |
| token | text | NOT NULL, UNIQUE | — |
| campaign_id | uuid | FK → campaigns(id) ON DELETE SET NULL | NULL |
| created_at | timestamptz | NOT NULL | now() |

**Indexes:** lead_id, email, token (unique)

### campaign_enrollments (Phase 2a)
Per-recipient enrollment tracking for campaigns.

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | uuid | PK | uuid_generate_v4() |
| campaign_id | uuid | NOT NULL, FK → campaigns(id) ON DELETE CASCADE | — |
| lead_id | uuid | NOT NULL, FK → leads(id) ON DELETE CASCADE | — |
| status | text | NOT NULL, CHECK (pending, sent, failed, unsubscribed) | 'pending' |
| sent_at | timestamptz | — | NULL |
| created_at | timestamptz | NOT NULL | now() |
| updated_at | timestamptz | NOT NULL | now() (auto-updated) |

**Indexes:** campaign_id, lead_id, status
**Unique constraint:** (campaign_id, lead_id) — one enrollment row per recipient per campaign

### campaign_templates (Phase 1b)
Template library for reusable campaign email templates.

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | uuid | PK | uuid_generate_v4() |
| name | text | NOT NULL | — |
| subject | text | NOT NULL | — |
| body | text | NOT NULL | — |
| created_by | uuid | NOT NULL, FK → profiles(id) | — |
| created_at | timestamptz | NOT NULL | now() |
| updated_at | timestamptz | NOT NULL | now() (auto-updated) |

### campaign_sequences (Phase 2)
Links campaigns to follow-up sequences.

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | uuid | PK | uuid_generate_v4() |
| campaign_id | uuid | NOT NULL, FK → campaigns(id) ON DELETE CASCADE | — |
| sequence_id | uuid | NOT NULL, FK → email_sequences(id) ON DELETE CASCADE | — |
| created_at | timestamptz | NOT NULL | now() |

### campaign_steps (Phase 2)
Individual steps in a campaign follow-up sequence.

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | uuid | PK | uuid_generate_v4() |
| campaign_id | uuid | NOT NULL, FK → campaigns(id) ON DELETE CASCADE | — |
| order | integer | NOT NULL | — |
| subject | text | NOT NULL | '' |
| body | text | NOT NULL | '' |
| delay_days | integer | NOT NULL | 0 |
| created_at | timestamptz | NOT NULL | now() |
| updated_at | timestamptz | NOT NULL | now() (auto-updated) |

**Indexes:** campaign_id

### email_sequences

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | uuid | PK | uuid_generate_v4() |
| name | text | NOT NULL | — |
| created_by | uuid | NOT NULL, FK → profiles(id) | — |
| active | boolean | NOT NULL | true |
| created_at | timestamptz | NOT NULL | now() |
| updated_at | timestamptz | NOT NULL | now() (auto-updated) |

### sequence_steps

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | uuid | PK | uuid_generate_v4() |
| sequence_id | uuid | NOT NULL, FK → email_sequences(id) ON DELETE CASCADE | — |
| order | integer | NOT NULL | — |
| subject | text | NOT NULL | '' |
| body | text | NOT NULL | '' |
| delay_days | integer | NOT NULL | 0 |
| created_at | timestamptz | NOT NULL | now() |
| updated_at | timestamptz | NOT NULL | now() (auto-updated) |

**Indexes:** sequence_id

### invites
Stores pending team member invitations. Consumed on successful signup.

| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | uuid | PK | uuid_generate_v4() |
| email | text | NOT NULL | — |
| name | text | NOT NULL | — |
| role | text | NOT NULL, CHECK (admin, employee) | 'employee' |
| token | text | NOT NULL, UNIQUE | — |
| expires_at | timestamptz | NOT NULL | — |
| used | boolean | NOT NULL | false |
| created_by | uuid | FK → profiles(id) ON DELETE SET NULL | NULL |
| created_at | timestamptz | NOT NULL | now() |

**Indexes:** token (unique), email, used (partial: WHERE false)

**Notes:** Tokens are single-use — `used` is set to `true` after the invited member completes signup. Expired or used tokens are rejected by the `signup-with-token` Edge Function.

### lead_search_history
Persists Lead Generator search results so chat history survives page navigation. A row is written immediately when Apollo returns results, before the user imports anything.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | uuid | uuid_generate_v4() | Primary key |
| user_id | uuid (FK → profiles, ON DELETE CASCADE) | — | User who ran the search |
| prompt | text | — | Original free-text prompt entered by the user |
| results | jsonb | — | Full array of enriched `Lead[]` objects returned by Apollo |
| imported | boolean | false | Set to `true` when the user clicks "Import N as Cold Leads" |
| created_at | timestamptz | now() | When the search was executed |

**Indexes:** user_id, created_at

**RLS:** Users can SELECT and INSERT their own rows (`user_id = auth.uid()`). UPDATE is permitted on own rows (for marking `imported = true`). No DELETE.

**Usage pattern:** On `LeadGeneratorPage` mount, rows are queried for the current user ordered by `created_at` ASC and reconstructed into the chat message list. Un-imported rows restore with an active import button. On each new Apollo search, a row is inserted before the bot message is rendered.

### apollo_usage
Tracks Apollo API credit consumption for circuit breaker enforcement.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | uuid | uuid_generate_v4() | Primary key |
| user_id | uuid (FK → profiles) | — | User who triggered the search |
| action | text | — | Action type (e.g., 'search_and_enrich') |
| credits_used | integer | 0 | Apollo credits consumed |
| search_count | integer | 0 | People returned by search |
| enrichment_count | integer | 0 | People successfully enriched |
| results_returned | integer | 0 | Leads returned to frontend |
| prompt | text | — | Original user prompt |
| created_at | timestamptz | now() | When the search occurred |

---

## Triggers

### `handle_updated_at`
Applied to ALL tables. Automatically sets `updated_at = now()` before any UPDATE.

### `handle_new_user`
Fires AFTER INSERT on `auth.users`. Creates a matching `profiles` row using:
- `id` from auth user
- `name` from `raw_user_meta_data->>'name'` (falls back to email prefix)
- `email` from auth user
- `role` from `raw_user_meta_data->>'role'` (falls back to 'employee')

Declared as `SECURITY DEFINER` so it can write to `profiles` regardless of RLS.

---

## Row Level Security (RLS)

All tables have RLS enabled. Policies use a helper function:

```sql
function is_admin() returns boolean
-- Returns true if current auth user has role='admin' in profiles
-- Declared STABLE for same-statement caching
```

### Policy Summary

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| profiles | All users | — | Own profile only (no role escalation) | — |
| leads | Admin: all / Employee: assigned_to=self | Admin: any / Employee: assigned_to=self | Admin: all / Employee: assigned_to=self | Admin only |
| activities | Admin: all / Employee: own or assigned lead | Any authenticated | — | — |
| emails | Any authenticated | Any authenticated | Any authenticated | — |
| deals | Admin: all / Employee: assigned_to=self | Admin: any / Employee: assigned_to=self | Admin: all / Employee: assigned_to=self | — |
| ai_suggestions | Admin: all / Employee: owns the lead | — | Admin: all / Employee: owns the lead | — |
| campaigns | Any authenticated | Any authenticated | — | — |
| email_sequences | Any authenticated | Any authenticated | — | — |
| sequence_steps | Any authenticated | Any authenticated | — | — |
| apollo_usage | Admin: all / Employee: own rows | Any authenticated | — | — |
| lead_search_history | Own rows only | Own rows only | Own rows only (imported flag) | — |

**Key security detail:** The `profiles_update_own` policy includes a `WITH CHECK` clause that prevents users from changing their own `role` field.

---

## Realtime

Enabled on: `leads`, `deals`, `activities`, `emails`

These tables are added to the `supabase_realtime` publication for Supabase Realtime subscriptions.

---

## Naming Conventions

| Layer | Convention | Example |
|-------|-----------|---------|
| Database columns | snake_case | `first_name`, `assigned_to`, `last_contacted_at` |
| TypeScript interfaces | camelCase | `firstName`, `assignedTo`, `lastContactedAt` |
| Transform utility | `src/lib/transforms.ts` | `toCamelCase()`, `toSnakeCase()`, `transformRows()` |

---

## UUID Mapping (Seed Data)

Deterministic UUIDs used for seed data, enabling repeatable seeding:

| Entity | Pattern | Example |
|--------|---------|---------|
| Users (auth) | `00000000-0000-0000-0000-00000000000N` | u1 → ...0001 |
| Leads | `10000000-0000-0000-0000-0000000000NN` | l1 → ...0001 |
| Activities | `20000000-0000-0000-0000-0000000000NN` | a1 → ...0001 |
| Emails | `30000000-0000-0000-0000-0000000000NN` | e1 → ...0001 |
| Deals | `40000000-0000-0000-0000-0000000000NN` | d1 → ...0001 |
| AI Suggestions | `50000000-0000-0000-0000-0000000000NN` | s1 → ...0001 |
| Sequences | `60000000-0000-0000-0000-0000000000NN` | seq1 → ...0001 |
| Sequence Steps | `70000000-0000-0000-0000-0000000000NN` | st1 → ...0001 |
| Campaigns | `80000000-0000-0000-0000-0000000000NN` | camp1 → ...0001 |

---

## API Layer — `src/lib/api/`

| File | Functions |
|------|-----------|
| `profiles.ts` | `getProfiles`, `getProfile`, `updateProfile` |
| `leads.ts` | `getLeads`, `getLead`, `createLead`, `updateLead`, `deleteLead` |
| `activities.ts` | `getActivities`, `getActivitiesByLead`, `createActivity` |
| `emails.ts` | `getEmails`, `getEmail`, `createEmail`, `updateEmail`, `markEmailRead`, `deleteEmail` |
| `deals.ts` | `getDeals`, `getDeal`, `createDeal`, `updateDeal`, `deleteDeal` |
| `suggestions.ts` | `getSuggestions`, `getSuggestionsByLead`, `dismissSuggestion` |
| `campaigns.ts` | `getCampaigns`, `createCampaign` |
| `sequences.ts` | `getSequences`, `getSequenceWithSteps` |
| `search-history.ts` | `saveSearchHistory`, `getSearchHistory`, `markSearchHistoryImported` |

All functions: query via Supabase client → transform snake_case → return camelCase typed objects.

---

## Edge Functions

Supabase Edge Functions provide server-side compute for operations that require API keys or external service calls.

| Function | Path | Purpose | External Service |
|----------|------|---------|-----------------|
| `campaign-ai` | `supabase/functions/campaign-ai/index.ts` | Proxies campaign copy generation to LLM | OpenRouter (DeepSeek V3.2) |
| `apollo-search` | `supabase/functions/apollo-search/index.ts` | Parses prompt via LLM, searches Apollo, bulk-enriches contacts (reveal_phone_number=true), scores results, logs credit usage | Apollo.io API, OpenRouter (Qwen 3.5 Flash) |
| `apollo-phone-webhook` | `supabase/functions/apollo-phone-webhook/index.ts` | Receives async phone reveal webhooks from Apollo; matches lead by apollo_id, updates leads.phone | Apollo.io (webhook) |
| `send-email` | `supabase/functions/send-email/index.ts` | Delivers outbound emails (compose, reply, campaign batch) via Resend API | Resend |
| `email-events` | `supabase/functions/email-events/index.ts` | Receives Resend webhook events: writes bounce/open/click timestamps to the emails table (`email.bounced`, `email.opened`, `email.clicked`); also handles `email.received` (inbound emails) — fetches full message body from Resend API, matches thread via `In-Reply-To` header, matches sender to a lead, inserts inbound email, logs `email_received` activity | Resend (webhook) |
| `create-invite` | `supabase/functions/create-invite/index.ts` | Admin-only: validates caller is admin, generates a secure random token, inserts a row into `invites`, returns the invite link | — |
| `signup-with-token` | `supabase/functions/signup-with-token/index.ts` | Public: validates invite token (exists, not used, not expired), calls `supabase.auth.admin.createUser` with the provided password, marks the invite as `used = true`, returns session tokens for auto-login | — |
| `delete-member` | `supabase/functions/delete-member/index.ts` | Admin-only: deletes a user from `auth.users` (cascades to `profiles`); `ON DELETE SET NULL` on `leads.assigned_to` and `deals.assigned_to` ensures their records are preserved unassigned | — |
| `unsubscribe` | `supabase/functions/unsubscribe/index.ts` | Public endpoint (no auth): validates token from query param, inserts row into `unsubscribes`, returns confirmation page | — |
| `generate-template` | `supabase/functions/generate-template/index.ts` | Generates or improves email templates via GPT-4.1-mini; temperature 0.7 for generation from description, 0.5 for cleanup of existing content | OpenRouter (GPT-4.1-mini) |
| `process-campaigns` | `supabase/functions/process-campaigns/index.ts` | Invoked every minute by pg_cron — queries campaigns where `scheduled_at <= now()` and `status = active`, dispatches sends via Resend, updates `campaign_enrollments` rows, handles paused campaign checks | Resend |
| `lead-gen-chat` | `supabase/functions/lead-gen-chat/index.ts` | Conversational lead generator — GPT-4.1-mini (via OpenRouter) manages multi-turn dialog: confirms search intent, suggests refinements on zero results, returns clickable action buttons; Apollo search pipeline (prompt parsing, People Search, bulk enrichment, contact scoring, credit logging) runs inline | OpenRouter (GPT-4.1-mini), Apollo.io API |

### campaign-ai

Accepts a campaign prompt, lead summaries, available industries, and chat history. Calls OpenRouter's API with DeepSeek V3.2 using enforced JSON schema output. Returns structured campaign configuration: matched lead IDs, email subject, email body, applied filters, and an explanation for the chat UI.

**Environment secrets required:** `OPENROUTER_API_KEY` (set via `supabase secrets set`)

**Shared utilities:** `supabase/functions/_shared/cors.ts` — CORS headers used by all Edge Functions.

### apollo-phone-webhook

Receives asynchronous phone reveal payloads from Apollo.io. When `apollo-search` enriches contacts with `reveal_phone_number=true`, Apollo delivers phone numbers to this webhook rather than returning them inline. The function extracts the Apollo person ID and phone number from the payload, looks up the matching lead by `apollo_id`, and updates `leads.phone`. Supabase Realtime then propagates the update to any connected frontend clients, replacing the "pending..." indicator in the search results table.

**No additional environment secrets required.** Uses the service-role key available inside Edge Functions to bypass RLS for the update.

### apollo-search

Accepts a free-text user prompt describing an ideal customer profile. Uses Qwen 3.5 Flash (via OpenRouter) to parse the prompt into structured Apollo filters (job title, seniority, industry, company size, location). Calls Apollo's `/mixed_people/search` endpoint, then bulk-enriches results via Apollo's `/people/bulk_match` for verified emails and phone numbers. Validates email deliverability via ZeroBounce and scores each contact 0–100 by contact quality. Writes credit usage to the `apollo_usage` table. Returns up to 50 enriched, scored leads to the frontend.

**Environment secrets required:** `APOLLO_API_KEY`, `OPENROUTER_API_KEY`, `ZEROBOUNCE_API_KEY` (set via `supabase secrets set`)

### lead-gen-chat

Manages the conversational lead generation flow. Accepts the full chat message history from the frontend. Uses GPT-4.1-mini (via OpenRouter) to determine the next dialog step: if the user has described a search but not yet confirmed it, the model returns a confirmation summary with clickable action button suggestions ("Yes, search now", "Refine criteria"). Once the user confirms, the full Apollo search pipeline runs inline — GPT-4.1-mini parses the prompt into structured filters, Apollo People Search is called, results are bulk-enriched, and each contact is scored 0–100 by contact quality. If the search returns zero results, GPT-4.1-mini generates an explanation and 2–3 refinement suggestions as clickable action buttons. Credit usage is written to `apollo_usage`.

**Environment secrets required:** `OPENROUTER_API_KEY`, `APOLLO_API_KEY`

### create-invite

Admin-only endpoint (validates JWT + `is_admin()`). Accepts `{ email, name, role }` in the request body. Generates a cryptographically random token, sets `expires_at` to 7 days from now, and inserts a row into the `invites` table. Returns the invite link (e.g. `https://<app>/signup?token=<token>`) for the admin to share with the new member.

**No environment secrets required.** Uses the Supabase service-role key (available automatically inside Edge Functions) to bypass RLS for the insert.

### signup-with-token

Public endpoint (no auth required). Accepts `{ token, password }`. Looks up the invite by token — rejects if not found, already `used`, or past `expires_at`. Calls `supabase.auth.admin.createUser` with `email`, `password`, and `raw_user_meta_data: { name, role }` from the invite row — this triggers the `handle_new_user` trigger which creates the `profiles` row. Marks the invite as `used = true`. Returns a Supabase session (access token + refresh token) so the frontend can auto-login the new member immediately after signup.

**No additional environment secrets required.**

### delete-member

Admin-only endpoint (validates JWT + `is_admin()`). Accepts `{ userId }` in the request body. Calls `supabase.auth.admin.deleteUser(userId)`, which hard-deletes the row from `auth.users`. The `ON DELETE CASCADE` from `auth.users → profiles` removes the profile. The `ON DELETE SET NULL` on `leads.assigned_to` and `deals.assigned_to` preserves all their CRM records in an unassigned state. Returns `{ success: true }` on completion.

**No additional environment secrets required.**

### unsubscribe

Public endpoint (no auth required). Accepts a `token` query parameter (and optionally `email` for display). Looks up the token in the `unsubscribes` table to prevent double-inserts — rejects if the token has already been used. Inserts a new row into `unsubscribes` with the `lead_id`, `email`, and `campaign_id` derived from the token payload. Returns an HTML confirmation page to the browser. Tokens are generated per-recipient by the `send-email` Edge Function at campaign send time and embedded in the `{{unsubscribeLink}}` merge field.

**No environment secrets required.**

### process-campaigns

Invoked on a 1-minute schedule via the `pg_cron` PostgreSQL extension. The cron job is registered with:

```sql
SELECT cron.schedule(
  'process-campaigns',
  '* * * * *',
  $$SELECT net.http_post(url := '<SUPABASE_PROJECT_URL>/functions/v1/process-campaigns', headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>"}') AS request_id$$
);
```

The function queries for campaigns where `scheduled_at <= now()` and `status = active`, sends emails to all enrolled recipients whose enrollment `status = pending`, and updates each enrollment row to `sent` or `failed`. Paused campaigns are skipped entirely.

**Environment secrets required:** `RESEND_API_KEY`

---

## Scheduler Infrastructure (pg_cron)

The `pg_cron` extension must be enabled on the Supabase project:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO postgres;
```

The `process-campaigns` cron job is then registered as described in its Edge Function section above. To inspect registered jobs: `SELECT * FROM cron.job;`

---

## Known Limitations

- `is_admin()` runs a subquery per row — `STABLE` annotation allows same-statement caching, but could become a concern with very large result sets
- `recipient_ids` on campaigns is a uuid[] array — not normalized, so "all campaigns for a lead" requires array contains query
- No database-level enum types — status/stage/type constraints are CHECK on text columns
- `from` and `to` on emails and `order` on sequence_steps are reserved words — must be quoted in raw SQL

---

## Future Considerations

- If `is_admin()` becomes a bottleneck, store role in JWT claims via Supabase Auth hook
- If campaign recipient queries become common, normalize to a junction table
- Consider Postgres enums instead of text CHECK constraints for better type safety
- Add database-level full-text search indexes on leads (name, company, email) when search volume grows

---

## Changelog

| Date | Change | Files Affected |
|------|--------|----------------|
| 2026-03-22 | Initial schema: 9 tables, RLS, triggers, realtime, seed data | All migrations |
| 2026-03-23 | Added Edge Functions section documenting campaign-ai | supabase/functions/ |
| 2026-03-23 | Added apollo_usage table for circuit breaker tracking | Migration 005 |
| 2026-03-23 | Added email_status to leads, email_prefix to profiles, apollo_usage RLS, apollo-search Edge Function | leads, profiles, apollo_usage, supabase/functions/ |
| 2026-03-23 | Added email tracking columns (provider_message_id, opened_at, clicked_at, bounced_at), send-email and email-events Edge Functions | emails table, supabase/functions/ |
| 2026-03-23 | email-events Edge Function now handles inbound email (email.received) | supabase/functions/email-events/ |
| 2026-03-23 | Team management: invites table, create-invite / signup-with-token / delete-member Edge Functions, FK changes (leads.assigned_to, deals.assigned_to now ON DELETE SET NULL) | invites table, supabase/functions/ |
| 2026-03-23 | Campaign Engine Phase 1a: new columns on campaigns (name, status, scheduled_at, drip_config, variant_b_subject, variant_b_body, ab_test_enabled, sequence_id), campaign_id FK on emails, new tables (unsubscribes, campaign_templates, campaign_sequences, campaign_steps), unsubscribe Edge Function | campaigns, emails, supabase/functions/ |
| 2026-03-23 | Campaign Engine Phase 1b: generate-template Edge Function (GPT-4.1-mini via OpenRouter) for AI template generation and cleanup | supabase/functions/generate-template/ |
| 2026-03-23 | Campaign Engine Phase 2a: campaign_enrollments table (per-recipient tracking), process-campaigns Edge Function, pg_cron scheduler setup | campaign_enrollments, supabase/functions/process-campaigns/ |
| 2026-03-23 | Campaign Engine Phase 3b: `timezone` (text, nullable) and `engagement_score` (integer, default 0) added to leads; `smart_send` (boolean, default false) added to campaigns | leads, campaigns |
| 2026-03-23 | Apollo phone reveal: apollo_id column added to leads for webhook matching; apollo-phone-webhook Edge Function added | leads table, supabase/functions/apollo-phone-webhook/ |
| 2026-03-24 | lead_search_history table added: persists Apollo search results immediately on return, enables chat restore on navigation | lead_search_history, src/lib/api/search-history.ts |
| 2026-03-24 | lead-gen-chat Edge Function added: GPT-4.1-mini conversation manager with inlined Apollo search pipeline, clickable action buttons, zero-result refinements | supabase/functions/lead-gen-chat/ |
