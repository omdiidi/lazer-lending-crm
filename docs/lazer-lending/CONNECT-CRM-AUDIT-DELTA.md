# Connect CRM Audit Delta

> Reconciles the actual state of the codebase against the original `CODEBASE_ANALYSIS.md` (deleted in 2026-05-11 cleanup) and `docs/OVERVIEW.md`. Authoritative as of 2026-05-04. Citations below to `CODEBASE_ANALYSIS.md:<line>` are historical — file no longer in repo.

## TL;DR

`docs/OVERVIEW.md` is accurate; `CODEBASE_ANALYSIS.md` describes an earlier scaffold state that no longer exists in the repository. The codebase has a fully wired Supabase backend — real auth, React Query hooks calling Supabase for all CRM entities, 17 deployed Edge Functions including a live Resend-based send engine with working warmup logic, and a provisioned MCP server. The Lazer plan's core assumption that "the implementer is building the backend" is wrong: a substantial working backend already exists and must be extended, not created from scratch.

## Verdict per claim

| Claim | Source | Reality | Evidence (file:line) | Lazer plan impact |
|---|---|---|---|---|
| "No backend, no API calls, no database — 100% client-side with mock data" | `CODEBASE_ANALYSIS.md:29` | FALSE. Supabase is fully wired. All CRM data flows through Supabase via React Query hooks. | `src/lib/supabase.ts:1-10`; `src/hooks/use-leads.ts:10-13`; `src/lib/api/leads.ts:1` | Plan Phase 0.1 is done. No "build backend from scratch" work needed for the CRM layer. Extend what exists. |
| "Auth is mock (hardcoded credentials)" | `CODEBASE_ANALYSIS.md:4, §6` | FALSE. Auth uses `supabase.auth.signInWithPassword`. `mockCredentials` array is gone. | `src/contexts/AuthContext.tsx:79` | Supabase Auth is the identity system. No auth work needed in Phase 1. |
| "`CRMContext.tsx` provides mock CRUD" | `CODEBASE_ANALYSIS.md:§4`, `CLAUDE.local.md` handoff | FALSE. `src/contexts/CRMContext.tsx` does not exist. `src/data/mockData.ts` does not exist. Neither is imported anywhere. | Glob returns no results for both paths; grep for `mockData` imports returns no matches | Plan references `src/contexts/CRMContext.tsx` as "mock CRUD layer to be backed by Supabase later" — it is already gone. |
| "React Query client exists but is unused" | `CODEBASE_ANALYSIS.md:19` | FALSE. React Query is fully in use across 16 hook files. | `src/hooks/use-leads.ts:2`, `src/hooks/use-campaigns.ts:1`, `src/hooks/use-deals.ts` (all use `useQuery`/`useMutation`) | React Query patterns are established. New Lazer hooks (e.g., `use-domains.ts`) should follow same pattern. |
| "Supabase configured but unused" | `CLAUDE.local.md` handoff | FALSE. Supabase is fully active with a provisioned project (`onthjkzdgsfvmgyhrorw`). | `supabase/migrations/20260326130000_schedule_process_campaigns_cron.sql:26`; `src/lib/supabase.ts:3-4` | Supabase project already provisioned. Phase 0.2 "lock backend choice" is complete. **OPEN: this is IntegrateAPI's project, not Lazer's — see Open Questions below.** |
| "~12 Edge Functions deployed" | `docs/OVERVIEW.md` claim | TRUE, and the count is higher: 17 Edge Function directories confirmed. | `supabase/functions/` glob: 17 `index.ts` files | Functions exist; Lazer plan must extend/replace specific ones rather than create from scratch. |
| "Supabase auth wired, RLS enforced" | `docs/OVERVIEW.md` | TRUE. RLS on leads, campaigns, activities, deals confirmed, with `is_admin()` helper. | `supabase/migrations/20260327000000_campaigns_rls_update_delete.sql`; `supabase/migrations/20260415000001_lead_assignment_rls.sql` | Leads RLS is per-user scoped. Lazer's domain/mailbox tables will need their own RLS policies. |
| "Realtime on leads/deals/activities/emails" | `docs/OVERVIEW.md` | PARTIAL. Realtime confirmed on `leads` table only in current hook code. | `src/hooks/use-leads.ts:15-24` | Other entities (emails, deals, activities) invalidate via mutation success, not Realtime channels. Lazer's reply webhook handler will likely need Realtime or polling for UI updates. |
| "pg_cron runs `process-campaigns` every minute" | `docs/OVERVIEW.md` | PARTIAL. Cron is registered but at **every 5 minutes**, not every minute. | `supabase/migrations/20260326130000_schedule_process_campaigns_cron.sql:19-20` (`*/5 * * * *`) | Lazer plan's concern about cron runs >60s applies at 5-minute intervals, not 1-minute. Still relevant for large enrollments. |
| "MCP server registers ~38 tools" | `docs/OVERVIEW.md` | PARTIAL. MCP server exists with 8 tool modules registered. Count of individual tools (list-leads, get-lead, etc.) is ~30-40 across all modules. | `mcp-server/src/index.ts:5-12` (8 `register*` calls); `mcp-server/src/tools/leads.ts` (8 tools in that file alone) | MCP server is real and calls Supabase via Edge Functions (`api-leads`, `api-emails`, etc.). |
| "Connect CRM has warmup logic built in" | PRD (original claim) | TRUE — and it is more complete than the plan assumed. A `warmup_state` table, `email_send_log` table, `claim_daily_send_budget` Postgres function (with `SELECT FOR UPDATE`), and `getMaxDailyAllowed()` shared module are fully implemented. | `supabase/functions/_shared/warmup.ts:1-11`; `supabase/migrations/20260402000000_add_claim_budget_function.sql:5-41`; `src/types/database.ts:883-894` | The Lazer plan's "build warmup gating" task is already built. The logic targets `integrateapi.ai` domain, not burner domains. For Lazer, the warmup concept needs re-scoping to per-mailbox (not per-domain singleton `warmup_state`). |

## Lazer-plan tasks affected by reality

**Phase 0.1 — Verify `CODEBASE_ANALYSIS.md`**
This task is now completed by this document. The analysis is stale. The real scaffold state is a working full-stack CRM.

**Phase 0.2 — Lock backend choice**
Already locked. Supabase project `onthjkzdgsfvmgyhrorw` is live and has real data migrations applied. **However**: this project is IntegrateAPI's, not Lazer's. Decision required: new isolated Supabase project for Lazer, or schema-separated namespace within existing one, or row-level tenant isolation via `tenant_id` column on every table. **Recommendation**: new isolated Supabase project. Lower engineering cost, true blast-radius isolation, no data leak risk.

**Phase 0.4 — Verify dev loop**
The dev loop requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to be set. Without them, `src/lib/supabase.ts:6-8` throws at startup. The loop will not work with empty `.env.example` values.

**Phase 1.1 — `SendProvider` interface + Smartlead client**
The existing `send-email` Edge Function is the interface that needs to be replaced for cold sends. It dispatches all outbound email through Resend using the `integrateapi.ai` domain (`EMAIL_DOMAIN = 'integrateapi.ai'` at `supabase/functions/send-email/index.ts:8`). The `SendProvider` abstraction should wrap this existing function for transactional sends and add a new Smartlead path for cold campaign sends. Do not delete `send-email`; it handles compose/reply from the inbox UI.

**Phase 1.2 — Warmup gating**
A warmup system already exists. It is a singleton (`warmup_state` row `id = 'default'`) tracking one domain's ramp. For Lazer, warmup must be per-mailbox (Smartlead manages its own warmup network). The existing `warmup_state` table and `claim_daily_send_budget` function are the correct pattern to clone, not build from zero. The tiers in `supabase/functions/_shared/warmup.ts:3-11` (20→200 emails/day over 91 days) are IntegrateAPI-specific; Lazer's Smartlead-managed warmup makes these irrelevant for cold sends, but the daily cap enforcement pattern is directly reusable for Lazer's per-mailbox ceiling logic.

**Phase 1.6 — `process-campaigns` dispatcher**
The existing `process-campaigns` function (`supabase/functions/process-campaigns/index.ts`) is a 617-line production dispatcher running every 5 minutes via pg_cron. It already implements: atomic `claim_daily_send_budget` (via `SELECT FOR UPDATE` Postgres function), send spacing with jitter, smart-send timezone deferral, A/B testing, drip sequence step advancement, invalid email skip, and bounce/enrollment status tracking. For Lazer, this function needs a Smartlead branch: when a campaign has a `provider = 'smartlead'` flag (new column), dispatch to Smartlead API instead of Resend batch. The existing Resend branch handles transactional campaigns. The function does NOT have overlapping-cron protection at the function level (no distributed lock); it relies on the `claim_daily_send_budget` atomic counter to prevent double-counting, but two concurrent cron invocations can both fetch the same `pending` enrollments before either marks them `sent`. Lazer's plan to add `FOR UPDATE SKIP LOCKED` on enrollment fetch remains necessary.

**Phase 1.8 — Webhook idempotency (`webhook_events` table)**
`email-events` has partial idempotency: it checks `provider_message_id` uniqueness before inserting inbound emails (`supabase/functions/email-events/index.ts:147-155`). There is no general `webhook_events` table. The Lazer plan's Smartlead webhook receiver is a new function and must build its own idempotency table from scratch.

**Phase 2.2 — Reply classification**
`email-events` auto-flags a reply as `warm` and updates enrollment to `replied` (`supabase/functions/email-events/index.ts:349-384`). This is Resend inbound parse based — it works on emails received at `mail.integrateapi.ai`. For Lazer, Smartlead's reply webhook replaces this path. The classification logic (positive/OOO/neutral/unsubscribe) does not exist yet — the current code sets `status = 'warm'` unconditionally on any reply, which is what the plan aims to replace with LLM classification.

**Phase 2.3 — Unsubscribe token migration**
The `unsubscribe` Edge Function uses a random UUID token stored in the `unsubscribes.token` column (`supabase/functions/unsubscribe/index.ts:12-53`). The Lazer plan switches to stateless HMAC tokens. Old UUID-token links must still resolve via a DB lookup fallback during the transition period. The existing `unsubscribes` table schema supports this: new HMAC tokens can be validated statelessly; old UUID tokens fall through to a DB check.

**Phase 2.5 — FUB push**
No FUB integration exists anywhere in the codebase. This is a net-new build.

**Phase 3 — Spam placement monitoring**
No spam/seed-inbox infrastructure exists. Net-new build.

## Tables that already exist vs Lazer-plan additions

| Table | Exists today | Lazer plan needs | Notes |
|---|---|---|---|
| `profiles` | Yes | Extend | `email_prefix` already present (`src/types/database.ts:788`). No new columns needed. |
| `leads` | Yes | Extend | Add `email_normalized` for FUB dedup (new column). `email_status`, `timezone`, `apollo_id`, `call_count`, `email_count` already present. |
| `activities` | Yes | Extend | Schema sufficient. |
| `emails` | Yes | Extend | `provider_message_id`, `opened_at`, `clicked_at`, `bounced_at`, `campaign_id`, `user_id` all present (`src/types/database.ts:519-601`). |
| `deals` | Yes | No change | |
| `campaigns` | Yes | Extend | Add `provider` column (`'resend'` or `'smartlead'`). `sequence_id`, `status`, `daily_send_limit`, `smart_send` all present. |
| `campaign_enrollments` | Yes | Extend | Add `mailbox_id` FK when Smartlead mailboxes are tracked. |
| `campaign_steps` | Yes | Compatible | Schema at `src/types/database.ts:226-266`. Order-indexed, delay_days present. Lazer plan's `campaign_steps` model matches. |
| `campaign_sequences` | Yes | No change | |
| `unsubscribes` | Yes | Extend | Token column is UUID string — HMAC tokens are also strings, compatible. |
| `warmup_state` | Yes | Repurpose or replace | Singleton `id='default'` model is wrong for per-mailbox. Either add `mailbox_id` column or create new `mailbox_warmup_state` table. |
| `email_send_log` | Yes | Repurpose | Per-date counter. For Lazer, needs per-mailbox per-date counter (`mailbox_id`, `send_date`). New table `mailbox_send_log` is cleaner than altering this. |
| `system_alerts` | Yes | Reuse | Alert pattern is established (`supabase/functions/_shared/alerts.ts`). Lazer watchdog fires alerts here. |
| `api_keys` | Yes | Reuse | MCP auth uses this. |
| `apollo_usage` | Yes | Keep | |
| `phone_reveals` | Yes | Keep | |
| `lead_search_history` | Yes | Keep | |
| `todos` / `projects` / `todo_comments` | Yes | Keep / ignore | Not relevant to Lazer cold outreach. |
| **`domains`** | No | New | Lazer Phase 1 addition. |
| **`mailboxes`** | No | New | Lazer Phase 1 addition. |
| **`sending_pools`** | No | New | Lazer Phase 1 addition. |
| **`pool_memberships`** | No | New | Lazer Phase 1 addition. |
| **`conversations`** | No | New | Lazer Phase 2 addition (reply threading for Smartlead). |
| **`replies`** | No | New | Lazer Phase 2 addition. |
| **`sends`** | No | New | Lazer Phase 1 addition (per-send Smartlead record). |
| **`suppressions`** | No | New | Lazer Phase 1 addition (hard bounce + unsubscribe suppression list separate from existing `unsubscribes` table; or extend `unsubscribes`). |
| **`webhook_events`** | No | New | Smartlead webhook idempotency. |
| **`seed_inbox_checks`** | No | New (v2) | Spam placement monitoring. |
| **`mailbox_send_log`** | No | New | Per-mailbox daily cap counter (replaces/supplements `email_send_log`). |
| **`mailbox_warmup_state`** | No | New | Per-mailbox warmup tracking (replaces singleton `warmup_state`). |

## Edge Functions: keep / refactor / new build

| Function | Status | Action for Lazer | Key detail |
|---|---|---|---|
| `send-email` | Live, Resend only | **Keep as-is for transactional.** | Handles inbox compose and replies. Sends from `user.emailPrefix@integrateapi.ai`. For Lazer: transactional from `notify.lazerlending.com` — update `EMAIL_DOMAIN` constant or add env var. Do NOT route cold sends through this. |
| `process-campaigns` | Live, Resend batch | **Refactor — add Smartlead branch.** | When `campaign.provider = 'smartlead'`, call Smartlead API instead of Resend. Add `FOR UPDATE SKIP LOCKED` on enrollment fetch to prevent double-send race. Existing Resend branch stays for transactional campaigns. |
| `email-events` | Live, Resend webhook | **Keep for transactional; add Smartlead reply webhook as new function.** | Current function handles Resend inbound parse (`email.received` event). Lazer cold replies come via Smartlead's reply webhook — that's a new `smartlead-events` function. Idempotency check at `:147-155` is the pattern to copy. |
| `unsubscribe` | Live | **Extend — add HMAC token path.** | Currently stores and validates UUID tokens from DB. Add HMAC verification before the DB lookup; if HMAC valid, bypass DB check. Old UUID links remain functional via DB fallback. |
| `apollo-search` | Live | **Keep and extend.** | ZeroBounce validation is already wired (`:327-353`). For Lazer's JIT 60-day re-validation, add a `validated_at` timestamp to the leads table and call ZeroBounce if `validated_at` is null or >60 days old. |
| `campaign-ai` | Live | **Keep as-is.** | LLM-powered campaign targeting using OpenRouter. Not relevant to Lazer cold outreach but does not conflict. |
| `lead-gen-chat` | Live | **Keep as-is.** | Apollo search + enrichment via chat interface. Reusable for Lazer lead upload flow. |
| `apollo-phone-webhook` | Live | **Keep as-is.** | Receives async phone reveals from Apollo bulk_match webhook. |
| `create-invite` / `signup-with-token` / `delete-member` | Live | **Keep as-is.** | Team invite flow. |
| `generate-api-key` | Live | **Keep as-is.** | MCP authentication. |
| `generate-template` | Live | **Keep as-is.** | LLM template generation. |
| `backfill-attachments` | Live | **Keep / ignore.** | One-time backfill utility. |
| `cleanup-lead-assignments` | Live | **Keep as-is.** | Nightly cron via pg_cron at 02:00 UTC. |
| `assign-leads-ai` | Live | **Keep as-is.** | LLM-powered lead assignment. |
| `todo-ai-enhance` | Live | **Keep as-is.** | Todo AI helper. |
| `api-leads` / `api-emails` / `api-campaigns` / `api-activities` / `api-deals` / `api-templates` | Live | **Keep as-is.** | REST-style Edge Functions used by the MCP server. |
| **`smartlead-webhook`** | Does not exist | **New build — Phase 2.** | Receives Smartlead reply events. Must: verify Smartlead HMAC signature, check `webhook_events` for idempotency, classify reply via LLM, route to FUB or suppression. |
| **`fub-push`** | Does not exist | **New build — Phase 2.** | Pushes qualified leads to Follow Up Boss via FUB API. |

## Resend integration scope

Resend is called in two places:

1. `supabase/functions/send-email/index.ts` — single sends (compose/reply) at `https://api.resend.com/emails` (`:156`) and batch sends at `https://api.resend.com/emails/batch` (`:246`). From domain: `user.emailPrefix@integrateapi.ai`.

2. `supabase/functions/process-campaigns/index.ts` — batch campaign sends at `https://api.resend.com/emails/batch` (`:302`), drip sends at `https://api.resend.com/emails` (`:500`). Campaign from-domain: `profile.email_prefix@mail.integrateapi.ai`; Reply-To: `profile.email_prefix@integrateapi.ai`.

Inbound: `supabase/functions/email-events/index.ts` receives Resend webhook events (`email.bounced`, `email.opened`, `email.clicked`, `email.complained`, `email.received`) and calls `https://api.resend.com/emails/receiving/{id}` to fetch inbound body (`:125-131`). Verified via svix signature (`:13-25`).

For Lazer: `send-email` from-domain must change from `integrateapi.ai` to `notify.lazerlending.com` for transactional. Cold outbound exits through Smartlead, bypassing both Resend functions entirely. `email-events` continues to handle transactional inbound replies.

## Warmup: what already exists

The warmup system is not aspirational — it is live:

- `supabase/functions/_shared/warmup.ts` — `getMaxDailyAllowed(daysSinceFirstEmail)` returns tier-gated daily max (20 → 200 emails over 91 days).
- `warmup_state` table — singleton row `id='default'` stores `first_email_at` timestamp.
- `email_send_log` table — per-date row tracks `emails_sent`.
- `claim_daily_send_budget` Postgres function — atomic `SELECT FOR UPDATE` claim, returns granted slots. Called by both `send-email` and `process-campaigns`.
- UI: `src/pages/SettingsPage.tsx:48-283` shows warmup age, current tier, and "Reset Warmup" button.
- UI: `src/pages/CampaignBuilderPage.tsx:27-78` reads warmup days and gates daily-limit selector.

For Lazer: this system is designed for a single shared domain (`integrateapi.ai`). Lazer needs per-mailbox warmup state. The pattern (singleton state + atomic budget claim) is directly portable; the table schema and function need to become per-mailbox.

## Open questions surfaced by audit

1. **Which Supabase project does Lazer use?** The cron migration hard-codes the IntegrateAPI project URL (`onthjkzdgsfvmgyhrorw.supabase.co`) and an anon key. Lazer needs either a new isolated Supabase project or a schema-separated namespace within the existing one. Sharing the project means Lazer's leads/campaigns mix with IntegrateAPI's in the same tables. **Recommendation: new isolated Supabase project for Lazer.**

2. **`EMAIL_DOMAIN` constant is hardcoded.** Both `send-email/index.ts:8` and `process-campaigns/index.ts:7-8` hard-code `'integrateapi.ai'` and `'mail.integrateapi.ai'`. For Lazer's `notify.lazerlending.com`, this must be an env var, not a constant.

3. **The `unsubscribe` function accepts any `{token, email}` payload — no HMAC verification.** The token is a `crypto.randomUUID()` value generated at send time and embedded in the email body. It is stored in `unsubscribes.token` and used only for deduplication (idempotency), not cryptographic verification. The Lazer plan's HMAC switch adds real security but breaks all existing unsubscribe links sent before the change.

4. **`process-campaigns` has no distributed lock on enrollment fetch.** Lines `:122-129` fetch `pending` enrollments without `FOR UPDATE SKIP LOCKED`. Two concurrent 5-minute cron invocations can pick up the same enrollments. The `claim_daily_send_budget` atomic counter prevents over-sending against the daily cap, but enrollment rows can be processed twice (sent twice to the same recipient). Lazer's plan to add row-level locking here is correct and necessary.

5. **MCP server auth.** `mcp-server/src/client.ts` connects to Supabase via API keys from the `api_keys` table. For Lazer, the MCP server identity and key management needs to be confirmed before extending with new tools.

6. **`campaign_steps` table name collision.** The Lazer plan lists `campaign_steps` as a new table to add. It already exists (`src/types/database.ts:226-266`) linked to `campaign_sequences` via `sequence_id`. The schema matches what the Lazer plan needs for multi-step drip sequences. No new table is needed — only the FK from campaigns to sequences (`campaigns.sequence_id`) already in place.
