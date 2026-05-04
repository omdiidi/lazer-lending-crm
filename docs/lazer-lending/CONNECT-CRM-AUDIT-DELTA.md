# Connect CRM Audit Delta

**Date:** 2026-05-01
**Source baseline:** `CODEBASE_ANALYSIS.md` at repo root (Connect CRM's own self-audit)
**Scope:** Verify CODEBASE_ANALYSIS.md claims against live code; fill in `[path TBD Phase 0]` anchors from PLAN.md.

## Top-line finding

**CODEBASE_ANALYSIS.md is materially out of date.** It describes Connect CRM as "100% client-side mock data, no backend, React Query unused." The actual code in this repo has been wired to Supabase since the analysis was written: 8 migrations, 22 edge functions, a full `src/lib/api/*` data-access layer, 16 TanStack Query hooks consuming real Supabase queries, and an MCP server (`mcp-server/`) with a 38-tool surface. The mock data layer (`src/data/mockData.ts`) does not exist. The CRMContext described in CODEBASE_ANALYSIS.md does not exist either — state is now managed via React Query against Supabase.

This drift changes Phase 1 scope: instead of "swap mock-array reads to async Supabase queries" (PLAN.md Task 1.0a), the work becomes "extend the existing Supabase schema with Lazer tables, extend the existing query hooks with new keys, and add new pages/screens that consume them." The frontend → Supabase wiring is already there.

## §1 Verification of CODEBASE_ANALYSIS.md claims

| Claim from CODEBASE_ANALYSIS.md | Actual code state | Drift? |
|---|---|---|
| "100% client-side mock data, no backend" (§1) | `src/lib/supabase.ts` instantiates a real Supabase client; 19 files in `src/` import from `@/lib/supabase` or `@/lib/api/*`; `supabase/functions/` has 22 edge functions; `supabase/migrations/` has 8 migrations | **YES — major drift.** The app is wired to Supabase. |
| Stack: React 18 + TypeScript + Vite (SWC) + Tailwind + shadcn/ui + Bun | `package.json` confirms React 18, TypeScript, Vite, Tailwind, shadcn/ui (49 files in `src/components/ui/`); `bun.lock` and `bun.lockb` confirm Bun | No |
| Type definitions in `src/types/crm.ts` define User, Lead, Activity, EmailMessage, Deal, EmailSequence, SequenceStep, AISuggestion, Campaign | `src/types/crm.ts` confirmed (247 lines). Adds `CampaignEnrollment`, `CampaignTemplate`, `Unsubscribe`, `SearchHistory`, `Todo`, `Project`, `TodoComment`, `TodoActivityEntry`, `TodoColumn` — all post-analysis additions. Also adds a separate `src/types/database.ts` (1,032 lines) of Supabase-generated types | **YES — additive drift.** New type files and new entities. |
| Mock data in `src/data/mockData.ts` | **File does not exist.** `find src -name "mockData*"` returns nothing. The `src/data/` directory does not exist. | **YES — file removed.** Mock data layer is gone. |
| State management: `src/contexts/AuthContext.tsx`, `src/contexts/CRMContext.tsx` | `src/contexts/AuthContext.tsx` exists (109 lines, now wired to Supabase auth, calls `getProfile()` from `src/lib/api/profiles`). `src/contexts/CRMContext.tsx` **does not exist.** State is now managed via React Query hooks (`src/hooks/use-*.ts`). | **YES — CRMContext eliminated.** State management pattern changed from Context API to React Query against Supabase. |
| Supabase configured but unused | Supabase fully wired: `src/lib/supabase.ts` client, `src/lib/api/*` (21 modules), `src/hooks/use-*.ts` (16 hooks), 22 edge functions, 8 migrations | **YES — fully integrated, not unused.** |
| `mcp-server/` ships with own package.json, scope unknown | `mcp-server/package.json` exists (`@connect-crm/mcp-server` v0.1.0, exposes 38 CRM tools per `mcp-server/README.md`). Scope: gives Claude Code agents full CRUD access to leads, emails, campaigns, Apollo search, pipeline. **Decision for Lazer v1: ignore.** Rationale below in §3. | **YES — drift; scope clarified.** |

## §2 PLAN.md anchor fills

The following anchors in PLAN.md were marked `[path TBD Phase 0]` or `[TBD]`. Resolved paths against live code:

| Anchor | Concrete path |
|---|---|
| Lead model | `src/types/crm.ts` — `Lead` interface (line 14, ends line 37) |
| Lead status enum | `src/types/crm.ts` — `LeadStatus` type (line 12) |
| Mock data: leads | **N/A.** `src/data/mockData.ts` does not exist; mock data layer removed when Supabase wiring landed. Lead seeds now live in migrations or are created via the live Supabase project. |
| Mock data: campaigns | **N/A.** Same as above. |
| State management | `src/contexts/AuthContext.tsx` (auth only); per-entity React Query hooks in `src/hooks/use-*.ts`; data-access modules in `src/lib/api/*.ts`. **No CRMContext exists.** |
| Auth | `src/contexts/AuthContext.tsx` (Supabase auth, 109 lines) |
| Routing | `src/App.tsx` (77 lines) |
| Pages directory | `src/pages/` — 15 pages: `DashboardPage`, `LeadsPage`, `LeadDetailPage`, `LeadGeneratorPage`, `OutreachPage`, `CampaignBuilderPage`, `CampaignDetailPage`, `PipelinePage`, `SettingsPage`, `LoginPage`, `Index`, `NotFound`, `StaffPerformancePage`, `TodoPage`, `UnsubscribePage` |
| Existing campaign types | `src/types/crm.ts` — `Campaign` (line 108), `CampaignEnrollment` (line 128), `CampaignTemplate` (line 141), `EmailSequence` (line 83), `SequenceStep` (line 91) |
| Existing email model | `src/types/crm.ts` — `EmailMessage` (line 51) |
| Existing UI components | `src/components/` — top-level: `AlertBanner.tsx`, `AppLayout.tsx`, `AppSidebar.tsx`, `NavLink.tsx`. Subdirs: `campaigns/` (8 files), `email/` (1), `outreach/` (1), `staff/` (1), `todo/` (12), `ui/` (49 shadcn primitives) |
| Supabase config | `supabase/config.toml` |
| Supabase migrations | `supabase/migrations/` — 8 migrations: `20260326130000_schedule_process_campaigns_cron.sql`, `20260327000000_campaigns_rls_update_delete.sql`, `20260401000000_add_api_keys.sql`, `20260402000000_add_claim_budget_function.sql`, `20260408000000_create_todos_tables.sql`, `20260410000000_add_contact_counts.sql`, `20260415000001_lead_assignment_rls.sql`, `20260415000002_lead_cleanup_cron.sql` |
| Supabase functions | `supabase/functions/` — 22 functions: `_shared/` (alerts, auth, cors, html, warmup), `api-activities`, `api-campaigns`, `api-deals`, `api-emails`, `api-leads`, `api-templates`, `apollo-phone-webhook`, `apollo-search`, `assign-leads-ai`, `backfill-attachments`, `campaign-ai`, `cleanup-lead-assignments`, `create-invite`, `delete-member`, `email-events`, `generate-api-key`, `generate-template`, `lead-gen-chat`, `process-campaigns`, `send-email`, `signup-with-token`, `todo-ai-enhance`, `unsubscribe` |
| Supabase auto-generated types | `src/types/database.ts` (1,032 lines) — full Supabase typed client; consumed by `src/lib/api/*` |
| Data-access layer | `src/lib/api/` — 21 modules: `activities.ts`, `api-keys.ts`, `apollo.ts`, `assign-leads-ai.ts`, `campaign-ai.ts`, `campaigns.ts`, `deals.ts`, `email-attachments.ts`, `emails.ts`, `engagement.ts`, `lead-gen-chat.ts`, `leads.ts`, `profiles.ts`, `projects.ts`, `search-history.ts`, `send-email.ts`, `sequences.ts`, `suggestions.ts`, `team.ts`, `templates.ts`, `todos.ts` |
| Query hooks | `src/hooks/` — 16 hooks: `use-activities`, `use-alerts`, `use-campaigns`, `use-deals`, `use-email-attachments`, `use-emails`, `use-engagement`, `use-leads`, `use-mobile`, `use-profiles`, `use-projects`, `use-sequences`, `use-suggestions`, `use-templates`, `use-toast`, `use-todos` |
| Existing warmup helper | `supabase/functions/_shared/warmup.ts` (existing scaffold; Phase 1 must verify whether it is functional or stub) |
| MCP server | `mcp-server/` — `@connect-crm/mcp-server` v0.1.0. **Decision: ignore for Lazer v1.** |

## §3 Decisions

### MCP server scope
Read `mcp-server/package.json` and `mcp-server/README.md`. The MCP server exposes 38 tools to Claude Code agents covering the full Connect CRM surface (leads, emails, campaigns, Apollo, pipeline). It is a developer-productivity tool, not a runtime dependency of the React app.

**Decision: ignore for Lazer v1.** Rationale:
- It is not in the user-facing send/reply pipeline.
- The plan does not depend on agent-driven CRUD; humans operate the CRM through the React UI.
- Adding Lazer-specific tools (e.g., manage burner domains, retire mailbox) is post-v1 polish, not v1-critical.
- Keeping it untouched also means we do not accidentally regress Connect CRM's existing developer ergonomics if the upstream scaffold ever resyncs.

If Lazer or IntegrateAPI later wants agent access to Lazer-specific operations (e.g., "agent, retire burner X"), revisit in v2 — the existing MCP server is the right place to extend.

### Connect CRM existing screens
| Page | Reused for Lazer | Notes |
|---|---|---|
| `DashboardPage` | Yes (extended) | Add Lazer-specific KPIs: paused mailboxes, pending replies, FUB push queue depth, RUA report freshness |
| `LeadsPage` / `LeadDetailPage` | Yes (extended) | Add fields per `PLAN.md` §Lead extensions: `email_normalized`, `source_list_id`, `source_acquired_at`, `consent_basis`, suppression status |
| `LeadGeneratorPage` | Yes (kept; non-blocking for v1) | Apollo integration already exists; not in Lazer v1 critical path |
| `OutreachPage` | Yes (replaced) | Existing inbox/compose model is for human-typed mail. Lazer's outreach is automated through Smartlead. Replace inbox with reply-classification queue; keep compose for transactional |
| `CampaignBuilderPage` / `CampaignDetailPage` | Yes (heavily extended) | Existing campaign concept maps onto Lazer's campaign + sequence + step structure. Add: per-state footer injection, send window, daily cap, sequence step model with delays |
| `PipelinePage` | Yes (kept as-is for v1) | Deal Kanban remains; Lazer uses for warm-lead stages post-FUB push |
| `SettingsPage` | Yes (extended) | Add: domain inventory, mailbox provisioning, vendor connections (Smartlead, Mailforge, ZeroBounce, FUB, Resend), per-state footer templates |
| `StaffPerformancePage` | Optional | Connect CRM artifact; not in Lazer v1 scope. Keep or remove — low priority |
| `TodoPage` | Optional | Connect CRM artifact; not in Lazer v1 scope. Keep |
| `UnsubscribePage` | Yes (replaced) | Existing unsubscribe flow must be replaced with HMAC-token RFC 8058 endpoint per `PLAN.md` §Locked Decision 13 |
| `LoginPage` / `Index` / `NotFound` | Yes (kept) | Standard scaffold |

### New pages required for Lazer v1 (not in Connect CRM)
- `DomainsPage` — burner domain inventory + retire button + DNS health
- `MailboxesPage` — per-mailbox state, warmup status, daily cap, paused reason, manual review queue
- `RepliesPage` — reply classification queue, manual triage, FUB push status
- `WebhookEventsPage` (admin) — webhook idempotency log, signature health
- `SuppressionsPage` — full suppression list with source lineage
- `SeedInboxChecksPage` (v2)

### Connect CRM existing types to extend (not replace)
Lazer extends, not replaces:
- `Lead` — add `email_normalized`, `source_list_id`, `source_acquired_at`, `consent_basis`
- `Campaign` — add per-state footer, Smartlead campaign id, suppression policy
- `EmailMessage` — already has `providerMessageId`, `bouncedAt`; add Smartlead-specific fields
- `EmailSequence` / `SequenceStep` — already model multi-step campaigns; reuse for Lazer drip

### New types (per PLAN.md §Data Models)
`Domain`, `Mailbox`, `SendingPool`, `PoolMembership`, `Send`, `Reply`, `Conversation`, `Suppression`, `WebhookEvent`, `SeedInboxCheck`.

### `mockData.ts` retention
**N/A.** The file no longer exists. PLAN.md Task 1.0a's "swap mock-array reads to async Supabase queries" is moot — the swap already happened upstream. Phase 1 scope shifts to "extend the existing schema and hooks."

## §4 Phase 1 frontend work (revised given drift)

The frontend is already wired to Supabase via React Query. Phase 1 frontend scope becomes:

1. **Extend the schema.** Add new migrations under `supabase/migrations/` for: `domains`, `mailboxes`, `pool_memberships`, `sending_pools`, `conversations`, `campaign_steps`, `replies`, `sends`, `suppressions`, `webhook_events`, `seed_inbox_checks`. Plus `Lead` and `Campaign` table extensions.
2. **Regenerate `src/types/database.ts`** from the updated Supabase schema (`supabase gen types typescript`).
3. **Add new data-access modules** in `src/lib/api/`: `domains.ts`, `mailboxes.ts`, `replies.ts`, `sends.ts`, `suppressions.ts`, `webhook-events.ts`. Mirror the existing pattern in `src/lib/api/leads.ts` and `src/lib/api/campaigns.ts`.
4. **Add new hooks** in `src/hooks/`: `use-domains.ts`, `use-mailboxes.ts`, `use-replies.ts`, `use-sends.ts`, `use-suppressions.ts`. Use TanStack Query (already installed).
5. **Add real-time subscription channels** for `replies` and `sends` (Supabase Realtime channels). The pattern in `src/hooks/use-emails.ts` is the reference.
6. **Add the new pages** listed in §3 above.
7. **Extend existing pages** per the table in §3 above.
8. **Add edge functions** under `supabase/functions/`: `smartlead-webhook`, `mailforge-webhook`, `dispatcher`, `watchdog`, `dmarc-rua-aggregator`, `dispatch-fub-push`, `list-unsubscribe`, `bounce-cascade`, etc. Mirror the existing pattern (e.g., `supabase/functions/email-events/`).
9. **Wire optimistic updates** for mutations on the new pages (existing pattern uses `useMutation` with `onMutate` / `onError` / `onSettled`).

## §5 What's missing from CODEBASE_ANALYSIS.md

Things the analysis did not cover that affect the Lazer build:

- **22 edge functions exist.** CODEBASE_ANALYSIS.md said "Email Provider integration: placeholder." In reality, `supabase/functions/send-email`, `email-events`, `process-campaigns`, `unsubscribe` already exist. Phase 0.1 must read each to determine: stub, partial, or functional. Some may be reusable for Lazer; others may need to be replaced with Lazer-specific implementations (Smartlead, Mailforge, etc.).
- **Apollo integration exists.** CODEBASE_ANALYSIS.md said "Apollo.io integration: placeholder." In reality, `supabase/functions/apollo-search` and `supabase/functions/apollo-phone-webhook` exist. Lead generator (`src/pages/LeadGeneratorPage.tsx`) likely consumes these. Phase 0.1 verifies functionality; Lazer reuses if working.
- **Cron schedule already configured for campaigns.** Migration `20260326130000_schedule_process_campaigns_cron.sql` schedules `process-campaigns` via `pg_cron`. Lazer's dispatcher will need a similar cron. Pattern is established.
- **API keys infrastructure.** Migration `20260401000000_add_api_keys.sql` + `supabase/functions/generate-api-key` provides API-key management. Lazer can reuse for vendor credential storage if appropriate.
- **Lead assignment cron.** Migrations for lead assignment RLS and cleanup cron exist (`20260415000001_lead_assignment_rls.sql`, `20260415000002_lead_cleanup_cron.sql`). May or may not apply to Lazer's lead model — review in Phase 0.1.
- **Warmup shared helper.** `supabase/functions/_shared/warmup.ts` exists. Possibly a stub for the original PRD §5.2 warmup; possibly unused. Phase 0.1 reads to determine status. If functional, it may inform the Smartlead-warmup mapping in `WARMUP-CAPABILITY-MAP.md`.
- **Drip / sequence execution.** `src/components/campaigns/SequenceEditor.tsx` exists. CODEBASE_ANALYSIS.md said "Sequences are display-only." Verify whether sequence execution is now wired through `process-campaigns` edge function.
- **Email events / engagement tracking.** `src/lib/api/engagement.ts`, `src/hooks/use-engagement.ts`, `supabase/functions/email-events` exist. Confirms open/click tracking infrastructure is partially built. Lazer can extend rather than rebuild.
- **Templates infrastructure.** `src/components/campaigns/TemplateEditor.tsx`, `src/components/campaigns/TemplateLibrary.tsx`, `supabase/functions/api-templates`, `supabase/functions/generate-template` exist. Lazer can reuse the template library to host per-state footer variants.
- **Unsubscribe page exists.** `src/pages/UnsubscribePage.tsx` + `supabase/functions/unsubscribe`. Must be reviewed against RFC 8058 + HMAC token requirements per `PLAN.md` §Locked Decision 13. Likely needs replacement, not extension, because the existing implementation predates the HMAC-token design.
- **Todo system.** `TodoPage`, `src/components/todo/*`, `src/hooks/use-todos.ts`, `migrations/20260408000000_create_todos_tables.sql`, `supabase/functions/todo-ai-enhance`. Not relevant to Lazer v1; ignore.
- **Staff performance page.** Not relevant to Lazer v1; ignore or remove.

## §6 Recommendations

1. **Update CODEBASE_ANALYSIS.md** or supersede it with this delta. It is misleading as a primary onboarding doc.
2. **Phase 0.1 must read each of the 22 edge functions** to classify: stub / partial / functional. The audit assumed empty functions; reality has 22 functions of varying maturity.
3. **Phase 0.1 must read each of the 8 migrations** to confirm schema state. The Lazer migrations build on top of whatever exists today — if `leads`, `campaigns`, `email_messages`, `deals` tables already have RLS and indexes, the Lazer migrations should not redefine.
4. **Adjust PLAN.md Task 1.0a.** Replace "swap mock-array reads to async Supabase queries" with "audit existing edge functions and hooks; identify which are reusable, which need extension, which need replacement."
5. **Decide explicitly on TodoPage and StaffPerformancePage.** Either remove (cleanup) or hide behind admin role (preserve upstream parity). Not Lazer-critical either way; do not let scope creep into reworking them.
