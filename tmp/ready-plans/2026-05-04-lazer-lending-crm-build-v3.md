# Lazer Lending CRM — Implementation Plan (v3)

**Date:** 2026-05-05
**Author:** IntegrateAPI (Nick Pardon)
**Status:** v3 — supersedes v2.1 (2026-04-30). Reflects Phase A codebase audit + vendor research.
**Stack-verified:** see `CONNECT-CRM-AUDIT-DELTA.md` (line-cited reconciliation, 2026-05-04).

> This plan REFERENCES rather than duplicates: `CONNECT-CRM-AUDIT-DELTA.md` (real codebase state),
> `BRIEF-email-architecture.md` (locked decisions D1–D10), `VENDOR-CONTRACTS.md` (vendor specifics +
> unblock checklists), `BLOCKED-AWAITING-CLIENT.md` (16 numbered blockers B1–B16).
> Read those first; this plan is the implementer's task spine.

---

## Critical finding — FLIPPED from v2.1

Connect CRM is **not** a 100% client-side mock scaffold. Per `CONNECT-CRM-AUDIT-DELTA.md`, the codebase has a fully wired Supabase backend: real auth + RLS, 16 React Query hooks calling Supabase for all CRM entities, **17 deployed Edge Functions**, a working Resend-based send engine (`send-email`, `process-campaigns`), a working warmup system (`warmup_state` + `claim_daily_send_budget` Postgres function with `SELECT FOR UPDATE`), pg_cron driving `process-campaigns` every 5 minutes, and a provisioned MCP server with ~30+ tools. The plan v2.1 claim that "the implementer is **building** the backend" is wrong — substantial working backend exists.

Practical impact: Phase 0.1 is now done (replaced by audit-delta). Phase 1 tasks shift from "build" to "extend at file:line." Phase 2.5 (FUB push) and Phase 2.1–2.3 (Smartlead reply ingest, classifier, store-and-notify) are net-new. The send pipeline refactor lands in existing files (`process-campaigns/index.ts`, `send-email/index.ts`) — no parallel system.

---

## Goal

Ship a Lazer-branded cold-outreach CRM extending Connect CRM. Cold sending is vendored to **Smartlead Pro** running on **Zapmail-provisioned Google Workspace mailboxes** across 4–6 burner domains. The brand domain `lazerlending.com` never sends cold mail. **Resend** stays for transactional only on `notify.lazerlending.com`. Replies pull from real mailboxes via Smartlead's reply webhook, classify through a two-stage pipeline (keyword → LLM), and only positive classifications push to **Follow Up Boss**. Volume target: **300–500/day v1**, scale path to ~1000/day documented but not pre-built.

## Summary

Extend Connect CRM into Lazer Lending CRM with: (1) a Smartlead-driven headless cold sending layer running on Zapmail-provisioned burner-domain mailboxes; (2) Resend retained for transactional only on `notify.lazerlending.com`; (3) ZeroBounce-gated lead validation at upload + JIT before send (extends existing partial integration in `apollo-search`); (4) inbound replies pulled from real mailboxes via Smartlead reply webhook into a **two-stage classifier** (keyword pre-classify; LLM only on ambiguous ~30% with redacted body); (5) **store-and-notify** forwarder — replies live in our CRM; team gets a Resend notification with subject + classification + first sentence + CRM link; (6) FUB push via `POST /v1/events` (NOT `/v1/people`) for positive replies only with `email_normalized` dedup; (7) operator settings panel; (8) bounce/complaint watchdog using Wilson lower-bound + hard-rule complaint escape, daily reconcile vs Smartlead stats, plus DNS health monitoring with **signal-based DMARC ramp** (14 days clean DKIM + ≥500 sends → `p=quarantine`); (9) routine domain rotation replacing PRD's "torched root" emergency; (10) two-tier retention (raw body 18mo, redacted+metadata 7yr) for lending vertical.

## Source artifacts

- **PRD (outcome contract):** `lazer-lending-crm-prd.md` and mirror at `docs/lazer-lending/PRD.md`
- **Codebase truth:** `docs/lazer-lending/CONNECT-CRM-AUDIT-DELTA.md`
- **Architectural decisions:** `docs/lazer-lending/BRIEF-email-architecture.md`
- **Vendor specifics:** `docs/lazer-lending/VENDOR-CONTRACTS.md`
- **Client-input blockers:** `docs/lazer-lending/BLOCKED-AWAITING-CLIENT.md`
- **Vendor research depth:** `tmp/research/2026-05-04-{smartlead,mailforge-workspace,zerobounce,followupboss,resend-compliance}.md`
- **Plan-review history:** `docs/lazer-lending/PLAN-REVIEW-NOTES.md` (45 reviewer findings on v2 — most still apply)

---

## What we ship

### User-visible behavior

- Operator uploads CSV of leads. ZeroBounce validates on upload (NEW `validate-upload` Edge Function using async file API); invalid contacts dropped with per-row reason; suppressions written for hard-drop sub-statuses (spamtrap/abuse/do_not_mail/role_based); valid contacts persist `email`, `email_normalized`, `zerobounce_status`, `zerobounce_substatus`, `last_validated_at`, `active_in_days`.
- Operator builds a campaign with N steps + sending-pool selection. On launch, the CRM creates a corresponding **Smartlead campaign** via API, configures sequence steps, attaches mailboxes from the pool, bulk-uploads enrolled leads, and activates. Smartlead dispatches autonomously per its own scheduler.
- The CRM enrolls leads into Smartlead campaigns at a rate that respects per-mailbox daily caps (claim semantics still apply — but for ENROLLMENT, not for individual sends). Smartlead owns inter-send pacing.
- Replies land in the real Workspace mailbox. Smartlead's reply webhook fires the CRM. Two-stage classifier: keyword pre-classify handles ~70% (clear positive/OOO/unsub/negative); LLM on ambiguous ~30% with PII-redacted + 200-char-truncated body.
- Positive replies → store-and-notify: full reply body stays in our CRM; team gets a Resend notification on `notify.lazerlending.com` with subject + classification + first sentence + CRM link. NEVER raw-forward.
- Positive replies → FUB push via `POST /v1/events` (not `/v1/people`) with `email_normalized` dedup + `X-System-Key` header + idempotency via `replies.fub_pushed_at`.
- OOO never pushes. Neutral waits for human tag. `unsubscribe` classification adds to suppression list (in addition to RFC 8058 endpoint hits).
- Operator dashboard shows per-mailbox health: warmup state, today's send count, bounce rate, complaint rate, paused reason if any.
- Domain-rotation button retires a burner. Mailboxes stop being eligible for new sends within 60s; in-flight Smartlead campaigns reassigned to other pool mailboxes.
- New pages: Domains, Mailboxes, Replies. Modified: Dashboard, Campaigns (sending-pool selector + provider), Leads, Settings (major expansion).

### Technical requirements

- All cold mail authenticated via SPF + DKIM + DMARC on the burner domain. **Both** SPF and DKIM required (Gmail Nov 2025 enforcement issues 5xx hard rejections, not spam folder, on auth failure).
- DMARC aggregate reports (`rua`) collected per burner. Signal-based ramp: 14 consecutive days clean DKIM alignment AND ≥500 sends → `p=quarantine`. Calendar fallback 4 weeks.
- Every cold send carries RFC 8058 List-Unsubscribe headers (`<https://...>`, `<mailto:...>`, AND `List-Unsubscribe-Post: List-Unsubscribe=One-Click`). DKIM `h=` tag MUST cover both `list-unsubscribe` and `list-unsubscribe-post` headers. Verified via raw MIME on Phase 0.6 sandbox send.
- Per-mailbox daily-send limit (configurable 20–40, default 30; **stepped ramp** — fresh mailboxes start at 10 for week 1).
- Per-mailbox watchdog: Wilson lower-bound on rolling 24h; threshold 2% bounce / 0.1% complaint; hard rule "any 1 spam complaint = manual review queue regardless of rate"; min_attempted floor 10 (5 during fresh-mailbox week-1 ramp).
- Hard bounce → recipient added to suppression list globally + queued future-step sends cancelled across all campaigns.
- Smartlead webhook signature verification (HMAC-SHA256 via `X-Smartlead-Signature: sha256=<hex>`). Idempotency via `(provider, X-Request-Id)` unique constraint on new `webhook_events` table.
- Smartlead webhook auto-disable risk (~7-hour retry window): build webhook health monitor + re-registration mechanism.
- Daily reconcile job pulls Smartlead campaign analytics + corrects local `sends` rows that disagree with vendor truth.
- ZeroBounce JIT re-validation for contacts unverified >60 days. `unknown` is a RETRY signal, not a drop. Greylisted → 24–48h re-check.
- Two-stage reply classifier with failover: on LLM error/timeout → `classification=null`, `requires_human_review=true`, NO auto-FUB push.
- Stop-on-reply: any classification except `negative` low-conf → cancel queued future-step sends to that lead in that campaign.
- FUB push idempotent against `email_normalized`; `204` response = FUB suppressed (alert ops, not a success).
- List-Unsubscribe POST endpoint **idempotent** (re-submits return 200 — Gmail prefetchers POST multiple times). Token = stateless HMAC over `(lead_id, campaign_id, mailbox_id, expiry_unix)` keyed with `LIST_UNSUB_TOKEN_SECRET`. Endpoint bypasses CSRF + unauthenticated.
- **Legacy unsubscribe links keep working**: existing `unsubscribes` table holds UUID tokens from pre-Lazer Connect CRM campaigns. Endpoint tries HMAC verification first; falls back to legacy UUID DB lookup.
- All scheduled jobs run as Supabase Edge Functions invoked by `pg_cron` (existing pattern from `cleanup-lead-assignments`, `process-campaigns`).

### Success Criteria

- [ ] **v1.SC1** New operator provisions a fresh burner domain + 2 Workspace mailboxes via Zapmail API; sees state machine flow `provisioning → dns_pending → connection_pending → verifying → ready`; warmup gates live sends.
- [ ] **v1.SC2** A 100-contact CSV passes through ZeroBounce upload validation; invalids dropped with reason; valid leads load with `email`, `email_normalized`, `zerobounce_status`, `last_validated_at`. Hard-drop sub-statuses inserted into `unsubscribes` (with `reason='zerobounce'`).
- [ ] **v1.SC3** A campaign of 100 sends executes end-to-end through Smartlead on warmed burner mailboxes. Daily caps respected. List-Unsubscribe headers (both URI variants + Post header) confirmed via raw MIME. DMARC RUA reports flowing. Both SPF AND DKIM align.
- [ ] **v1.SC4** A reply lands in the Workspace mailbox → Smartlead webhook fires → signature verified + idempotency check → two-stage classifier runs → store-and-notify Resend email sent to configured team email per campaign routing rule. Duplicate webhook event does NOT produce a second notification.
- [ ] **v1.SC5** A positive reply pushes to FUB via `POST /v1/events` with `email_normalized` dedup. OOO never pushes. Neutral waits for human tag. `unsubscribe` triggers suppression-list insert.
- [ ] **v1.SC6** Manual domain rotation stops sends on rotated domain's mailboxes within 60 seconds (in-flight Smartlead campaigns reassigned).
- [ ] **v1.SC7** Resend transactional sends originate ONLY from `notify.lazerlending.com` (env var `RESEND_TRANSACTIONAL_DOMAIN`); cold burner sends NEVER touch Resend.
- [ ] **v1.SC8** A mailbox exceeding Wilson-lower 2% bounce threshold OR with even 1 spam complaint auto-pauses or enters manual-review queue within 1h, with a Resend alert email to ops.
- [ ] **v1.SC9** A hard bounce triggers (a) suppression-list insert + (b) cancellation of all queued future-step sends to that lead across all campaigns.
- [ ] **v1.SC10** Daily reconcile job, run against deliberately stale local state, corrects rows to match Smartlead campaign analytics.
- [ ] **v1.SC11** A simulated dropped + replayed Smartlead webhook event does not double-process (idempotency via `(provider, X-Request-Id)` unique constraint).
- [ ] **v2.SC1** Spam-placement check on test seeds across Gmail/Outlook/Yahoo runs pre-campaign at 10-min and 30-min marks; pauses campaign on ≥2 seed spam landings.
- [ ] **v2.SC2** Auto-rotation: domain enters cooldown if (a) ≥50% mailboxes paused within 24h OR (b) aggregate domain complaint rate >0.1% over 7d. Mailboxes pause; remaining campaigns reassigned.

---

## Locked decisions

See `BRIEF-email-architecture.md` D1–D10 (v2, 2026-05-04). Plan v3 is consistent with the brief. No deltas in v3 — the brief itself was updated in Phase B to reflect post-research findings.

---

## Verified repo truths

Per `CONNECT-CRM-AUDIT-DELTA.md` (line refs cited there):

1. Auth: `src/contexts/AuthContext.tsx:79` calls `supabase.auth.signInWithPassword`. NOT mock.
2. Supabase client live: `src/lib/supabase.ts:1-10`. Project: `onthjkzdgsfvmgyhrorw` (IntegrateAPI's). **B1 blocker:** new isolated Lazer project recommended.
3. CRM data via React Query: 16 hook files in `src/hooks/use-*.ts`. `mockData.ts` and `CRMContext.tsx` GONE.
4. RLS enforced (admin-helper `is_admin()`); migrations in `supabase/migrations/`.
5. Realtime currently active on `leads` table only; other entities invalidate via mutation success.
6. **17 Edge Functions deployed** in `supabase/functions/` including `send-email`, `process-campaigns`, `email-events`, `apollo-search`, `lead-gen-chat`, `unsubscribe`, `apollo-phone-webhook`, `campaign-ai`, `create-invite`, `signup-with-token`, `delete-member`, `generate-template`, `generate-api-key`, `assign-leads-ai`, `cleanup-lead-assignments`, `backfill-attachments`, `todo-ai-enhance`, plus REST `api-*` functions used by MCP.
7. pg_cron schedule: **every 5 minutes** for `process-campaigns` (`supabase/migrations/20260326130000_*.sql:19-20`). NOT every minute.
8. `process-campaigns` enrollment fetch at `:122-129` lacks `FOR UPDATE SKIP LOCKED` — confirmed concurrency bug.
9. Working warmup system: `supabase/functions/_shared/warmup.ts:1-11`, `warmup_state` table singleton, `claim_daily_send_budget` Postgres fn with `SELECT FOR UPDATE` (`supabase/migrations/20260402000000_*.sql:5-41`).
10. `EMAIL_DOMAIN` hardcoded `'integrateapi.ai'` in `send-email/index.ts:8` and `process-campaigns/index.ts:7-8`. Must become env var.
11. `unsubscribe` Edge Function uses random UUID tokens stored in `unsubscribes.token`. NO HMAC verification (`supabase/functions/unsubscribe/index.ts:12-53`).
12. ZeroBounce already integrated in `apollo-search/index.ts:327-353`; only checks `status=invalid`; doesn't write to suppressions; doesn't read sub-statuses.
13. `campaign_steps` table ALREADY EXISTS (`src/types/database.ts:226-266`). No new table needed for Lazer's multi-step drip.
14. MCP server with 8 tool modules registered (`mcp-server/src/index.ts:5-12`); ~30–40 tools across modules.

---

## Codebase anchors (extend, don't replace)

| File | Action |
|---|---|
| `src/lib/supabase.ts` | Update env vars when Lazer's isolated Supabase project provisioned (B1) |
| `src/contexts/AuthContext.tsx` | Reuse — Lazer team uses same auth flow |
| `src/hooks/use-*.ts` | Add new hooks for `domains`, `mailboxes`, `sending_pools`, `replies`, `sends` |
| `src/lib/api/*.ts` | Add new API modules per new entity |
| `supabase/functions/send-email/index.ts:8` | `EMAIL_DOMAIN` constant → env var `RESEND_TRANSACTIONAL_DOMAIN` (default `notify.lazerlending.com`) |
| `supabase/functions/process-campaigns/index.ts:7-8` | Same env var refactor |
| `supabase/functions/process-campaigns/index.ts:122-129` | Add `FOR UPDATE SKIP LOCKED` to enrollment fetch |
| `supabase/functions/process-campaigns/index.ts` | Add `provider` branch — `'smartlead'` calls Smartlead API, `'resend'` keeps existing path |
| `supabase/functions/_shared/warmup.ts` | Pattern to clone for per-mailbox warmup; existing singleton stays for IntegrateAPI use |
| `supabase/migrations/20260402000000_*.sql` | `claim_daily_send_budget` pattern to clone for per-mailbox slot claim |
| `supabase/functions/unsubscribe/index.ts` | Add HMAC token verification; preserve UUID DB-lookup fallback |
| `supabase/functions/apollo-search/index.ts:327-353` | Extend ZeroBounce policy: read all sub-statuses; write hard-drops to `unsubscribes` (with `reason='zerobounce'`); add `activity_data=true` |
| `supabase/functions/email-events/index.ts:147-155` | Idempotency pattern to copy for new `smartlead-events` Edge Function |
| `src/pages/SettingsPage.tsx` | Major expansion — see Settings Panel Scope |
| `src/pages/CampaignBuilderPage.tsx:27-78` | Extend with sending-pool selector + provider toggle |
| `mcp-server/src/index.ts:5-12` | Add tool modules: domains, mailboxes, replies, fub-push (after Phase 2) |

---

## Files being changed

```
[repo root]/
├── supabase/
│   ├── migrations/                                                        ← Consolidated to 4 (cycle 1)
│   │   ├── 20260505000001_lazer_send_layer.sql                            ← NEW: domains, mailboxes, sending_pools, pool_memberships, sends
│   │   ├── 20260505000002_lazer_extend_existing.sql                       ← MODIFIED: leads, campaigns, warmup_state (mailbox_id), email_send_log (mailbox_id), unsubscribes (reason/email_normalized/source_event_id + backfill), claim_daily_send_budget fn
│   │   ├── 20260505000003_lazer_reply_layer.sql                           ← NEW: replies, webhook_events, classifier_circuit
│   │   └── 20260505000004_lazer_v2_seed_inbox.sql                         ← NEW v2 only: seed_inbox_set, seed_inbox_checks
│   │
│   │   Filenames are timestamp-sorted (Supabase runs in lexicographic order). Order matches FK dependency: send-layer → extend-existing → reply-layer → v2.
│   │
│   └── functions/
│       ├── send-email/index.ts                                            ← MODIFIED (EMAIL_DOMAIN → env var)
│       ├── process-campaigns/index.ts                                     ← REFACTOR (FOR UPDATE SKIP LOCKED + Smartlead branch + setup-vs-enroll split)
│       ├── unsubscribe/index.ts                                           ← EXTEND (HMAC + legacy UUID fallback, single unsubscribes table)
│       ├── apollo-search/index.ts                                         ← EXTEND (ZeroBounce all sub-statuses + write to unsubscribes for hard-drops)
│       ├── validate-upload/index.ts                                       ← NEW (async ZeroBounce file API)
│       ├── smartlead-events/index.ts                                      ← NEW (sig verify + idempotency + event-name normalization + sweeper)
│       ├── smartlead-campaign/index.ts                                    ← NEW (action='create'|'enroll'|'activate' — merged per cycle 1)
│       ├── classify-reply/index.ts                                        ← NEW (two-stage with multi-label routing + circuit breaker)
│       ├── store-and-notify/index.ts                                      ← NEW (Resend notification on positive reply)
│       ├── fub-push/index.ts                                              ← NEW (POST /v1/events with stage NAME, occurredAt = notified_at)
│       ├── mailbox-watchdog/index.ts                                      ← NEW (Wilson + hard-rule-first, hourly cron)
│       ├── smartlead-reconcile/index.ts                                   ← NEW (daily cron, vs Smartlead campaign analytics)
│       ├── dns-health-check/index.ts                                      ← NEW (daily cron, alerts when DMARC ramp-eligible)
│       ├── mailbox-cap-reset/index.ts                                     ← NEW (hourly cron, idempotent via last_reset_at; resets BOTH today_enrolled_count AND today_sent_count)
│       ├── seed-placement-check/index.ts                                  ← NEW (v2)
│       └── auto-rotation/index.ts                                         ← NEW (v2)

   Deferred to v2 (per cycle 1 cuts): dmarc-ramp-evaluator, smartlead-webhook-health-monitor, zerobounce-revalidate
│
├── src/
│   ├── pages/
│   │   ├── DomainsPage.tsx                                                ← NEW
│   │   ├── MailboxesPage.tsx                                              ← NEW
│   │   ├── RepliesPage.tsx                                                ← NEW (inbox view, reclassify, manual FUB push)
│   │   ├── CampaignBuilderPage.tsx                                        ← EXTEND (pool selector + provider toggle + team_email per-campaign override field)
│   │   ├── DashboardPage.tsx                                              ← EXTEND (per-mailbox health cards)
│   │   └── SettingsPage.tsx                                               ← MAJOR EXTEND (see Settings Panel Scope)
│   ├── hooks/
│   │   ├── use-domains.ts                                                 ← NEW
│   │   ├── use-mailboxes.ts                                               ← NEW
│   │   ├── use-sending-pools.ts                                           ← NEW
│   │   ├── use-replies.ts                                                 ← NEW
│   │   └── use-sends.ts                                                   ← NEW
│   ├── lib/api/
│   │   ├── domains.ts                                                     ← NEW
│   │   ├── mailboxes.ts                                                   ← NEW
│   │   ├── sending-pools.ts                                               ← NEW
│   │   ├── replies.ts                                                     ← NEW
│   │   └── sends.ts                                                       ← NEW
│   ├── lib/
│   │   ├── email-normalize.ts                                             ← NEW (lowercase + plus-tag strip + Gmail dot-insensitivity)
│   │   ├── list-unsub-token.ts                                            ← NEW (HMAC sign + verify)
│   │   ├── pii-redact.ts                                                  ← NEW (regex SSN/CC/ITIN before LLM)
│   │   └── classifier-keywords.ts                                         ← NEW (stage-1 pre-classifier)
│   └── types/database.ts                                                  ← REGENERATE after migrations land
│
├── mcp-server/src/tools/
│   ├── domains.ts                                                         ← NEW (Phase 2+)
│   ├── mailboxes.ts                                                       ← NEW
│   └── replies.ts                                                         ← NEW
│
├── .env.example                                                            ← EXTEND (Lazer vars)
└── docs/lazer-lending/
    └── (already updated in Phase B — README, BRIEF, CONNECT-CRM-AUDIT-DELTA, VENDOR-CONTRACTS, BLOCKED-AWAITING-CLIENT, this PLAN)
```

---

## Architecture

```
                                ┌──────────────────────────────────────┐
                                │  Lazer Lending CRM (extends Connect) │
                                │  React + Supabase + pg_cron          │
                                └──────────────┬───────────────────────┘
                                               │
        ┌─────────────────────┬────────────────┼─────────────────────┬────────────────────┐
        │                     │                │                     │                    │
   Campaign launch       Reply ingest      Operator UI         Transactional         Validation
   (enroll → Smartlead)  (signed +         (settings/replies/  (Resend on            (ZeroBounce
        │                  idempotent)      mailboxes)          notify.lazer-       upload + JIT)
        ▼                                                       lending.com)
 ┌──────────────────┐      ┌─────────────────┐
 │ smartlead-       │      │ smartlead-      │
 │ campaign +       │      │ events          │
 │ enroll           │      │ (sig verify +   │
 │ (atomic slot     │      │  idempotency +  │
 │  claim)          │      │  dispatch)      │
 └────────┬─────────┘      └────────┬────────┘
          │ POST                    │
          ▼                         ▼
 ┌──────────────────┐      ┌──────────────────────┐
 │ Smartlead Pro    │      │ Two-stage classifier │
 │ (campaign engine,│      │  → store-and-notify  │
 │  autonomous      │      │  → fub-push (events) │
 │  pacing, SMTP/   │      │  → suppress on unsub │
 │  IMAP app pwd)   │      └──────────────────────┘
 └────────┬─────────┘
          │ SMTP/IMAP app password
          ▼
 ┌─────────────────────────┐
 │ Zapmail-provisioned GWS │
 │ mailboxes on burner     │
 │ domains (lazer-loans.com│
 │  etc.)                  │
 └─────────────────────────┘

Cron jobs (pg_cron, all 5min/hourly/daily/midnight):
  • process-campaigns (5min) — REFACTORED (Smartlead branch + FOR UPDATE SKIP LOCKED)
  • mailbox-watchdog (hourly, Wilson + hard-rule + webhook gap-alert)
  • webhook-event-sweeper (5min, heals stuck webhook_events rows >10min unprocessed)
  • smartlead-reconcile (daily, vs Smartlead campaign analytics)
  • mailbox-cap-reset (hourly, idempotent via last_reset_at)
  • dns-health-check (daily, alerts when DMARC ramp-eligible — operator does manual DNS edit)
  Deferred to v2: dmarc-ramp-evaluator, zerobounce-revalidate, smartlead-webhook-health-monitor (auto-reregister), seed-placement-check, auto-rotation
```

Smartlead is autonomous after activation. Our enrollment job ensures we don't push more leads into a Smartlead campaign than the per-mailbox daily caps allow today. Smartlead's own scheduler then dispatches at its pace; webhook events update our `sends` table via `smartlead-events` after-the-fact.

---

## Data model

### Existing tables — extend (cycle 1: consolidate, don't clone)

| Table | New columns |
|---|---|
| `leads` | `email_normalized` (unique idx), `zerobounce_substatus`, `zerobounce_score`, `last_validated_at`, `active_in_days`, `fub_id`, `fub_pushed_at`, `unsubscribed_at` |
| `campaigns` | `provider` ('resend' \| 'smartlead'), `sending_pool_id`, `team_email` (per-campaign reply-notify override; null defaults to env), `seed_inbox_set_id` (v2), `smartlead_campaign_id` |
| `unsubscribes` | EXTENDED to be the canonical suppression table: `reason` enum ('unsubscribe'/'hard_bounce'/'complaint'/'zerobounce'), `email_normalized` (with index), `source_event_id`, `lead_id` (nullable for non-lead bounces). Existing UUID `token` column unchanged for legacy fallback |
| `warmup_state` | Add nullable `mailbox_id` FK. Singleton row (`id='default'`) preserved for IntegrateAPI. Per-mailbox rows added on Lazer mailbox provisioning |
| `email_send_log` | Add nullable `mailbox_id` FK. Same pattern — singleton + per-mailbox |
| `claim_daily_send_budget` (Postgres fn) | Add optional `p_mailbox_id` param. When non-null, scopes claim to that mailbox |

### New tables

| Table | Purpose |
|---|---|
| `domains` | Per-burner: hostname, provider (zapmail/maildoso), status (FSM), DNS check flags, dmarc_policy, dmarc_rua, registrar, owner_entity, registered_at, retired_at, cooldown_until |
| `mailboxes` | Per-mailbox: domain_id, address, smartlead_account_id, **connection_status** ('connected'/'disconnected'/'app_password_invalid' — was `oauth_status`), warmup_state (FSM), daily_cap, **today_enrolled_count** (gates enrollment, resets midnight), **today_sent_count** (driven by EMAIL_SENT webhook, resets midnight), **last_reset_at** (idempotency for cap-reset), live_started_at, last_24h_bounce_rate, last_24h_complaint_rate, paused_reason, last_health_check_at, timezone |
| `sending_pools` | Named groups of mailboxes |
| `pool_memberships` | M:N — pool_id × mailbox_id |
| `sends` | Per-send: lead_id, campaign_id, campaign_step_id, **claimed_mailbox_id** (mailbox at enrollment), **mailbox_id** (confirmed via EMAIL_SENT — may differ), smartlead_message_id, **smartlead_lead_id** (detect silent drops), smartlead_thread_id, status (FSM: queued/sent/delivered/bounced/complained/failed/smartlead_rejected), bounce_type, error_reason, sent_at, delivered_at, complaint_at |
| `replies` | Per-reply: lead_id, campaign_id, mailbox_id, in_reply_to_send_id, smartlead_thread_id (was `conversations.thread_id` — flattened), classification, classifier_confidence, classifier_error, language, raw_message_id, body_text, redacted_body_text, received_at, notified_at, notified_to, fub_pushed_at, fub_event_id (the FUB events-API response id, for audit), requires_human_review |
| `webhook_events` | provider, external_event_id (Smartlead's `X-Request-Id`), event_type, received_at, processed_at, last_error, payload_hash, payload_raw. Unique on `(provider, external_event_id)` |
| `classifier_circuit` | Single-row state for LLM circuit breaker: open_at (nullable), failure_count, last_failure_at |
| `seed_inbox_checks` (v2) | campaign_id, results jsonb, placement_summary, checked_at_10min, checked_at_30min |

**Dropped from v1 plan v3 first draft (per cycle 1 review):** `suppressions` (extended `unsubscribes` instead), `conversations` (flattened `smartlead_thread_id` onto `replies` + `sends`), `mailbox_warmup_state` (extended `warmup_state`), `mailbox_send_log` (extended `email_send_log`), `routing_rules` (replaced with `campaigns.team_email` column).

---

## Pseudocode

### Slot semantics: enrollment vs send (CRITICAL — fixed in cycle 1 review)

Smartlead is a campaign engine, not a transactional API. Smartlead dispatches autonomously hours/days after we enroll a lead. Two separate counters:

- **`today_enrolled_count`** — incremented when we hand a lead to Smartlead. Gates further enrollment today (so we don't push more leads into Smartlead than the daily cap supports). Reset at mailbox-local midnight.
- **`today_sent_count`** — incremented ONLY when `EMAIL_SENT` webhook arrives confirming Smartlead actually dispatched. Used by watchdog (which queries `sends WHERE sent_at IS NOT NULL`). Reset at mailbox-local midnight.

This separates "slots claimed for enrollment" from "actual sends today" — the two diverge by hours and the watchdog needs the real count.

### claimMailboxSlotForEnrollment (REPLACES v2.1 claimSendSlot)

```typescript
// Atomic claim of an enrollment slot (NOT a send slot). The actual send happens later
// when Smartlead's autonomous scheduler dispatches; we count that via the EMAIL_SENT webhook.
async function claimMailboxSlotForEnrollment(poolId: string, recipientEmail: string): Promise<Mailbox> {
  const norm = normalizeEmail(recipientEmail);
  return await db.tx(async (t) => {
    // Single source of truth: extended unsubscribes table (was 'suppressions' in plan v3 first draft)
    const suppressed = await t.unsubscribes.where({ email_normalized: norm }).first();
    if (suppressed) throw new RecipientSuppressed(norm, suppressed.reason);

    const row = await t.raw(`
      WITH eligible AS (
        SELECT m.id
        FROM mailboxes m
        JOIN pool_memberships pm ON pm.mailbox_id = m.id
        WHERE pm.pool_id = $1
          AND m.warmup_state = 'live'
          AND m.paused_reason IS NULL
          AND m.today_enrolled_count < m.daily_cap
        ORDER BY (m.today_enrolled_count::float / m.daily_cap) ASC, random() ASC
        LIMIT 1
        FOR UPDATE OF m SKIP LOCKED
      )
      UPDATE mailboxes m
      SET today_enrolled_count = today_enrolled_count + 1
      FROM eligible e
      WHERE m.id = e.id AND m.today_enrolled_count + 1 <= m.daily_cap
      RETURNING m.*;
    `, [poolId]);
    if (!row) throw new NoMailboxAvailable(poolId);
    return row;
  });
}

// EMAIL_SENT webhook handler increments the real send counter.
// Cycle 2 fix: only increment if send was confirmed in the SAME reset window
// (avoids cross-midnight inflation when Smartlead dispatches at 00:01 of day N+1
// for a lead enrolled on day N).
async function onEmailSentWebhook(event: SmartleadEvent) {
  await sends.update({ smartlead_message_id: event.message_id }, {
    status: 'sent',
    sent_at: new Date(),
    mailbox_id: event.email_account_id,  // confirmed mailbox (may differ from claimed)
  });
  await db.raw(`
    UPDATE mailboxes m
    SET today_sent_count = today_sent_count + 1
    FROM sends s
    WHERE s.smartlead_message_id = $1
      AND m.id = s.mailbox_id
      AND date_trunc('day', s.sent_at AT TIME ZONE m.timezone)
        = date_trunc('day', m.last_reset_at AT TIME ZONE m.timezone)
  `, [event.message_id]);
}
```

### launchCampaign — split: setup is one-shot, enrollment is cron-driven

```typescript
// Setup runs ONCE at campaign creation (not in the per-cron enrollment loop).
async function setupSmartleadCampaign(campaignId: string) {
  const campaign = await campaigns.findById(campaignId);
  const sl = await smartlead.createCampaign({ name: campaign.name });
  await campaigns.update(campaignId, { smartlead_campaign_id: sl.id });
  for (const step of await campaignSteps.byCampaign(campaignId)) {
    await smartlead.addSequenceStep(sl.id, {
      seq_number: step.order, subject: step.subject,
      email_body: step.body, delay_in_days: step.delay_days,
    });
  }
  for (const mb of await mailboxes.byPool(campaign.sending_pool_id)) {
    // SMTP/IMAP app password connection (NOT OAuth — scriptable recovery)
    // max_email_per_day kept in sync with our daily_cap
    await smartlead.connectMailbox(sl.id, {
      account_id: mb.smartlead_account_id,
      max_email_per_day: mb.daily_cap,
    });
  }
  await smartlead.activateCampaign(sl.id);
}

// Enrollment runs from process-campaigns cron each tick. Bounded loop, fast exit.
async function enrollPendingLeads(campaignId: string, maxBatch = 50) {
  const campaign = await campaigns.findById(campaignId);
  const enrollments = await campaignEnrollments.pendingForCampaign(campaignId, maxBatch);
  for (const enrollment of enrollments) {
    let mailbox: Mailbox | null = null;
    try {
      mailbox = await claimMailboxSlotForEnrollment(campaign.sending_pool_id, enrollment.email);
      try {
        // Inner try: post-slot-claim work. On ANY failure here, we MUST release the slot
        // or `today_enrolled_count` permanently leaks against the daily cap.
        const result = await smartlead.addLeadToCampaign(campaign.smartlead_campaign_id, enrollment.lead);
        const slLeadId = result.leads?.find((l: any) => l.email === enrollment.email)?.id;
        if (!slLeadId) {
          // CRITICAL: Smartlead silently drops malformed leads (G2). Capture per-lead status.
          // Slot was used (Smartlead got the request); don't release. Mark rejected.
          await sends.create({
            lead_id: enrollment.lead_id, campaign_id: campaignId,
            campaign_step_id: enrollment.campaign_step_id,
            mailbox_id: mailbox.id, claimed_mailbox_id: mailbox.id,
            status: 'smartlead_rejected', error_reason: 'silent_drop_in_bulk_upload',
          });
          await opsAlert({ kind: 'smartlead_silent_drop', lead: enrollment });
          continue;
        }
        await sends.create({
          lead_id: enrollment.lead_id, campaign_id: campaignId,
          campaign_step_id: enrollment.campaign_step_id,
          mailbox_id: mailbox.id, claimed_mailbox_id: mailbox.id,
          smartlead_lead_id: slLeadId, status: 'queued',
        });
        await campaignEnrollments.update(enrollment.id, { status: 'sent' });
      } catch (slErr) {
        // Slot was claimed, Smartlead/DB failed AFTER. Release the slot — the send didn't happen.
        await db.raw(`UPDATE mailboxes SET today_enrolled_count = today_enrolled_count - 1 WHERE id = $1`, [mailbox.id]);
        throw slErr;  // bubble for outer catch
      }
    } catch (e) {
      if (e instanceof RecipientSuppressed) {
        await campaignEnrollments.update(enrollment.id, { status: 'unsubscribed' });
        continue;
      }
      if (e instanceof NoMailboxAvailable) break;  // resume next tick
      // Other errors (Smartlead 5xx, network) — slot already released by inner catch above.
      // Log + continue rather than abort the whole batch.
      await opsAlert({ kind: 'enrollment_failed', lead: enrollment, error: String(e) });
      continue;
    }
  }
}

// Stop-on-reply (cycle 1 #3 fix): ALSO tell Smartlead to stop autonomous progression.
async function stopSmartleadFollowups(leadId: string, campaignId: string) {
  const send = await sends.findOne({ lead_id: leadId, campaign_id: campaignId });
  if (!send?.smartlead_lead_id) return;
  // Per Smartlead docs: PATCH lead category to 'replied' stops further sequence steps.
  // SANDBOX VERIFICATION ITEM (Phase 0.6): confirm exact endpoint + payload.
  await smartlead.markLeadReplied(campaignId, send.smartlead_lead_id);
}
```

### Two-stage classifier (cycle 1 fix: scan all labels, route multi-hit to LLM)

```typescript
// Stage 1: scan ALL keyword categories. Single match → return; multi-match → null (LLM stage).
// This protects against dual-signal replies like "not interested but please remove me" where
// first-match would silently miss the unsubscribe (compliance risk in regulated lending vertical).
function keywordClassify(reply: { subject: string; body: string }): Classification | null {
  const text = (reply.subject + '\n' + reply.body).toLowerCase();
  const matches: Classification[] = [];
  if (/\b(out of office|vacation|away until|return on|on leave|on holiday)\b/.test(text))
    matches.push({ label: 'ooo', confidence: 0.95 });
  if (/\b(unsubscribe|remove me|stop calling|stop emailing|opt out|take me off)\b/.test(text))
    matches.push({ label: 'unsubscribe', confidence: 0.95 });
  if (/\b(not interested|leave me alone|do not contact|fuck off|never email)\b/.test(text))
    matches.push({ label: 'negative', confidence: 0.85 });
  // Stronger positive affirmatives only — avoid false-positives on bare "schedule" / "wrong person"
  if (/\b(yes please|i'm interested|i am interested|tell me more|send me (more|info|details)|sign me up|book (a call|time|meeting)|let's connect|calendar)\b/i.test(text))
    matches.push({ label: 'positive', confidence: 0.85 });

  if (matches.length === 1) return matches[0];      // confident single-label match
  return null;                                       // 0 matches OR multi-label → route to LLM
}

// Stage 2: LLM only for ambiguous ~30%, with PII-redacted + truncated body.
async function classifyReply(reply: Reply): Promise<Classification | null> {
  const stage1 = keywordClassify(reply);
  if (stage1) return stage1;
  const redacted = redactPII(reply.body_text).slice(0, 200);
  try {
    const result = await llm.complete({
      model: process.env.CLASSIFIER_MODEL,
      timeoutMs: 5000,
      system: classifierSystemPrompt('en'),
      user: `Subject: ${reply.subject}\nBody (redacted, truncated): ${redacted}`,
      response_format: { type: 'json_schema', schema: ClassificationSchema },
    });
    return result;
  } catch (err) {
    await replies.update({ id: reply.id }, {
      classifier_error: serializeError(err),
      requires_human_review: true,
    });
    return null;  // null => human review, no auto-FUB
  }
}
```

### Store-and-notify forwarder

```typescript
// On positive (or any classification != null where routing rule fires):
// Reply stays in our CRM. Team gets a Resend notification on notify.lazerlending.com.
// NO raw forwarding (no IMAP redirect, no Resend forward of the prospect's body to external addresses).
async function notifyTeamOfReply(reply: Reply, campaign: Campaign) {
  // Per-campaign override on campaigns.team_email (cycle 1 dropped routing_rules table)
  const teamEmail = campaign.team_email ?? process.env.DEFAULT_REPLY_FORWARD_EMAIL!;
  const summary = reply.body_text.split('.')[0].slice(0, 200);  // first sentence
  await resend.send({
    from: process.env.RESEND_FROM_DEFAULT!,  // Lazer CRM <ops@notify.lazerlending.com>
    to: teamEmail,
    subject: `[${reply.classification.toUpperCase()}] ${reply.from_name}: ${reply.subject}`,
    text: `Cold reply classified as ${reply.classification} (confidence: ${reply.classifier_confidence}).
Sender: ${reply.from_name} <${reply.from_email}>
Campaign: ${campaign.name}
First sentence: "${summary}"

View full reply (PII stays in our CRM): ${process.env.APP_BASE_URL}/replies/${reply.id}
`,
  });
  await replies.update({ id: reply.id }, { notified_at: new Date(), notified_to: teamEmail });
}
```

### Webhook idempotency receiver (cycle 1 fix: normalize event field, self-healing sweeper)

```typescript
async function smartleadWebhookHandler(req: Request, res: Response) {
  if (!verifyHmacSha256(req.body, req.headers['x-smartlead-signature'], process.env.SMARTLEAD_WEBHOOK_SIGNING_SECRET!)) {
    return res.sendStatus(401);
  }
  const eventId = req.headers['x-request-id'];
  if (!eventId) return res.sendStatus(400);

  // CRITICAL: EMAIL_ACCOUNT_DISCONNECTED uses `eventType` (camelCase), all other events use `event`.
  // Normalize on receipt or this P1 path silently misses (sends stop, no alert).
  const eventName = req.body.event ?? req.body.eventType;

  const inserted = await db.raw(`
    INSERT INTO webhook_events (provider, external_event_id, event_type, payload_hash, payload_raw)
    VALUES ('smartlead', $1, $2, $3, $4) ON CONFLICT (provider, external_event_id) DO NOTHING RETURNING id
  `, [eventId, eventName, sha256(JSON.stringify(req.body)), JSON.stringify(req.body)]);
  if (!inserted) return res.sendStatus(200);  // already processed

  try {
    await dispatchByEvent(eventName, req.body);
    await db.raw(`UPDATE webhook_events SET processed_at = now() WHERE id = $1`, [inserted.id]);
  } catch (err) {
    // Don't lose the event — let the background sweeper retry.
    await db.raw(`UPDATE webhook_events SET last_error = $1 WHERE id = $2`, [String(err), inserted.id]);
    return res.sendStatus(500);  // Smartlead will retry
  }
  return res.sendStatus(200);
}

// Background sweeper (5-min cron) — heals from in-flight failures after the inserted-but-unprocessed
// state where dispatchByEvent failed. Without this, a transient failure orphans the webhook permanently
// because ON CONFLICT short-circuits future retries.
async function webhookEventSweeper() {
  const stuck = await db.raw(`
    SELECT * FROM webhook_events
    WHERE processed_at IS NULL AND received_at < NOW() - INTERVAL '10 minutes'
    LIMIT 50
  `);
  for (const e of stuck) {
    try {
      await dispatchByEvent(e.event_type, JSON.parse(e.payload_raw));
      await db.raw(`UPDATE webhook_events SET processed_at = now() WHERE id = $1`, [e.id]);
    } catch (err) { /* will retry next sweep */ }
  }
}

// EMAIL_ACCOUNT_DISCONNECTED handler — P1 alert + immediate mailbox pause
async function onEmailAccountDisconnected(event: any) {
  await mailboxes.update({ smartlead_account_id: event.accountId }, {
    paused_reason: 'connection_lost',
    connection_status: 'disconnected',
  });
  await opsAlert({ kind: 'P1_mailbox_disconnected', mailbox_email: event.email, error: event.error });
}
```

### Classifier circuit breaker (cycle 1 fix: prevent LLM brownout cascade)

```typescript
// State stored in a tiny `classifier_circuit` table: { open_at, failure_count }
async function classifyReplyWithCircuit(reply: Reply): Promise<Classification | null> {
  const circuit = await classifierCircuit.get();
  // open_at is a Postgres timestamp; coerce via Date constructor to avoid NaN comparison
  if (circuit.open_at && Date.now() - new Date(circuit.open_at).getTime() < 5 * 60 * 1000) {
    // Circuit open — skip LLM, mark for human review
    await replies.update({ id: reply.id }, { requires_human_review: true, classifier_error: 'circuit_open' });
    return null;
  }
  try {
    const result = await classifyReply(reply);
    if (circuit.failure_count > 0) await classifierCircuit.reset();
    return result;
  } catch (err) {
    const failures = await classifierCircuit.incrementFailure();
    if (failures >= 3) {
      await classifierCircuit.openCircuit();
      await opsAlert({ kind: 'classifier_circuit_opened' });
    }
    return null;
  }
}
```

### Mailbox watchdog (Wilson + hard-rule, cycle 1 fix: hard-rule first + continue, single pause per cycle)

```typescript
async function runMailboxWatchdog() {
  const z = 1.96;
  const bounceThreshold = 0.02, complaintThreshold = 0.001;
  const rows = await db.raw(`
    SELECT m.id AS mailbox_id, m.warmup_state,
           m.live_started_at,
           COUNT(s.*) FILTER (WHERE s.sent_at IS NOT NULL) AS attempted,
           COUNT(s.*) FILTER (WHERE s.status = 'bounced') AS bounced,
           COUNT(s.*) FILTER (WHERE s.status = 'complained') AS complained
    FROM mailboxes m LEFT JOIN sends s ON s.mailbox_id = m.id AND s.sent_at > NOW() - INTERVAL '24 hours'
    WHERE m.paused_reason IS NULL GROUP BY m.id
  `);
  const wilsonLower = (h: number, n: number) => {
    const p = h / n;
    return (p + (z*z)/(2*n) - z * Math.sqrt((p*(1-p) + (z*z)/(4*n))/n)) / (1 + (z*z)/n);
  };
  for (const r of rows) {
    // Stepped ramp: fresh mailboxes (live for <7 days) use min_attempted=5, then 10
    const isFresh = r.live_started_at && (Date.now() - new Date(r.live_started_at).getTime()) < 7*24*60*60*1000;
    const minAttempted = isFresh ? 5 : 10;
    if (r.attempted < minAttempted) continue;

    // HARD RULE FIRST: any single complaint → manual review, skip Wilson.
    // Prevents double-pause where complaint also satisfies Wilson threshold.
    if (r.complained >= 1) {
      await pauseMailbox(r.mailbox_id, 'single_complaint_review');
      await opsAlert({ kind: 'mailbox_complaint_review', mailbox: r.mailbox_id });
      continue;
    }

    if (wilsonLower(r.bounced, r.attempted) > bounceThreshold) {
      await pauseMailbox(r.mailbox_id, 'bounce_threshold');
      await opsAlert({ kind: 'mailbox_paused_bounce', mailbox: r.mailbox_id });
    } else if (wilsonLower(r.complained, r.attempted) > complaintThreshold) {
      await pauseMailbox(r.mailbox_id, 'complaint_threshold');
      await opsAlert({ kind: 'mailbox_paused_complaint', mailbox: r.mailbox_id });
    }
  }
}
```

### Unsubscribe endpoint (HMAC + legacy UUID — single `unsubscribes` table)

Cycle 1 fix: drop the new `suppressions` table; extend the existing `unsubscribes` table with `reason` enum + `email_normalized` + `source_event_id` columns. Single source of truth. Suppression check at enrollment queries one table.

```typescript
app.post('/api/list-unsubscribe', { csrf: false, auth: 'none' }, async (req, res) => {
  if (req.body['List-Unsubscribe'] !== 'One-Click') return res.sendStatus(400);
  const token = String(req.query.t ?? '');

  // Try HMAC first (new path)
  const hmacCtx = verifyUnsubToken(token, process.env.LIST_UNSUB_TOKEN_SECRET!);
  if (hmacCtx) {
    if (hmacCtx.expiry_unix < Date.now() / 1000) return res.sendStatus(404);
    await unsubscribes.insertIfMissing({
      email: hmacCtx.email,
      email_normalized: normalizeEmail(hmacCtx.email),
      reason: 'unsubscribe',
      source_event_id: `hmac:${hmacCtx.lead_id}:${hmacCtx.campaign_id}`,
      lead_id: hmacCtx.lead_id, campaign_id: hmacCtx.campaign_id,
      token: token,
    });
    await leads.update({ id: hmacCtx.lead_id }, { unsubscribed_at: new Date() });
    return res.sendStatus(200);
  }
  // Fallback: legacy UUID (pre-Lazer Connect CRM rows in same table)
  const legacy = await unsubscribes.findByToken(token);
  if (legacy) {
    // Backfill the new columns on first encounter so future checks work via email_normalized
    if (!legacy.email_normalized) {
      await unsubscribes.update({ id: legacy.id }, {
        email_normalized: normalizeEmail(legacy.email),
        reason: legacy.reason ?? 'unsubscribe',
      });
    }
    return res.sendStatus(200);
  }
  return res.sendStatus(404);
});
```

> **Token rotation note:** if `LIST_UNSUB_TOKEN_SECRET` is ever rotated, the `dmarc-ramp-evaluator`-style migration must batch-resign all outstanding tokens (or insert legacy rows for them) before the new secret goes live. Otherwise outstanding unsubscribe links break — CAN-SPAM violation.

---

## State machines

### Domain

```
provisioning → dns_pending → verifying → ready
       ↓            ↓            ↓        ↓
     failed      failed       failed   cooldown → retired
                                          ↑
                                  (auto-rotation v2 OR manual)
```

### Mailbox

```
provisioning → connection_pending → warming → live ←→ paused
        ↓               ↓               ↓                ↑
       failed        failed          failed     (watchdog | smartlead 429
                                                  | dns_failure | manual
                                                  | connection_lost)
```

`connection_status` ∈ {connected, disconnected, app_password_invalid}.
`paused_reason` ∈ {bounce_threshold, complaint_threshold, single_complaint_review, smartlead_rate_limit, dns_failure, app_password_invalid, connection_lost, manual}.

---

## Compliance & data retention

Two-tier (lending vertical regulator alignment):

- **Reply bodies (raw):** 18 months → redact body text, keep metadata.
- **Replies (redacted body + classification + thread metadata + audit log):** 7 years.
- **Sends rows:** 24 months for deliverability audit.
- **Webhook events:** 90 days for replay/idempotency.
- **Suppression list:** indefinite (CAN-SPAM compliance).
- **Lead PII:** per Lazer's policy (B10 blocker — defaults to 7 years for lending).

LLM provider: must have no-train DPA. Default Anthropic (B9 blocker — Lazer compliance confirms). PII redactor pre-LLM. Reply body NEVER pushed to FUB or to third-party logging.

---

## Tasks

### Phase 0 — Audit & Foundation

**0.1 [DONE]** Audit Connect CRM real state. → `docs/lazer-lending/CONNECT-CRM-AUDIT-DELTA.md`. Outcome: Phase 0.1 from v2.1 plan is complete.

**0.2 [PENDING — gates B1]** Lock backend tenant choice + provision staging+prod.
- Default: NEW isolated Supabase project for Lazer (recommended for blast-radius isolation).
- DoD: TWO Lazer Supabase projects provisioned — `lazer-staging` and `lazer-prod`. `.env.staging` + `.env.production` documented. Migrations + Edge Functions deploy to staging first via `supabase db push --project-ref <staging-ref>`, smoke-tested, then promoted to prod. Cron migration repointed in both.

**0.3 [PENDING — gates B12]** Provision sandbox vendor accounts. See unblock checklists in `VENDOR-CONTRACTS.md`. Required: Smartlead Pro, Zapmail Starter, ZeroBounce credit block, FUB API key + X-System-Key, Resend account.

**0.4 [PENDING]** Verify Bun + Vite + Vitest dev loop with real Supabase env vars. DoD: `bun install && bun run dev` boots port 8080; lint + test pass.

**0.5 [PENDING — gates B2/B3/B4/B5/B6/B7/B8/B9/B10]** Client kickoff. Close all `[Phase 1 blocker]` items in `BLOCKED-AWAITING-CLIENT.md`. **NMLS/state lending disclosure footer text** is the single hardest blocker — no live cold sends without it (B2).

**0.6 [PENDING — gates B13]** Smoke-test 1 burner domain end-to-end via Zapmail. Provision domain + 2 mailboxes; OAuth into Smartlead; verify warmup begins; **inspect raw MIME on a test send to confirm whether Smartlead's auto-injected List-Unsubscribe URL is ours or Smartlead's** (resolves B13).

**0.7 [PENDING]** Re-review this plan with `plan-reviewer` after Phase 0 sandbox findings land. Update plan in place.

### Phase 1 — Send layer + warmup + compliance

**1.1** Database migrations — 4 consolidated files (cycle 1 cut from 11; cycle 2 reordered).
- Files: `supabase/migrations/20260505000001_lazer_send_layer.sql`, `_002_lazer_extend_existing.sql`, `_003_lazer_reply_layer.sql`, `_004_lazer_v2_seed_inbox.sql` (the v2 file lands now to keep migration history immutable; `seed_inbox_set` table sits empty until Phase 3).
- Order matches Supabase's lexicographic execution: send-layer → extend-existing → reply-layer → v2.
- DoD: Migrations apply cleanly via `bunx supabase migration up`. `src/types/database.ts` regenerated. Existing `claim_daily_send_budget` Postgres fn extended with optional `p_mailbox_id` param. **Migration `_002` includes (a) a one-shot backfill `UPDATE unsubscribes SET email_normalized = lower(trim(email)) WHERE email_normalized IS NULL AND email IS NOT NULL`, AND (b) a `BEFORE INSERT` trigger on `unsubscribes` that auto-populates `email_normalized = lower(trim(NEW.email))` when null, so the existing `unsubscribe` Edge Function's writes during the migration window are also normalized — no concurrent-insert gap.**

**1.2** Smartlead client + SendProvider abstraction.
- Files: `src/lib/clients/smartlead.ts` (NEW), `src/lib/clients/send-provider.ts` (NEW interface).
- DoD: Test campaign created in Smartlead sandbox via API.

**1.3** Zapmail provisioning client + UI.
- Files: `src/lib/clients/zapmail.ts` (NEW), `src/pages/DomainsPage.tsx` (NEW), `src/pages/MailboxesPage.tsx` (NEW), `src/hooks/use-domains.ts` (NEW), `src/hooks/use-mailboxes.ts` (NEW).
- DoD: Operator clicks "Add domain"; Zapmail provisions; domain state machine runs to `ready`; mailboxes appear OAuth'd into Smartlead.

**1.4** Sending pools UI.
- Files: `src/pages/SettingsPage.tsx` (extend), `src/hooks/use-sending-pools.ts` (NEW).
- DoD: Operator creates a pool; assigns N mailboxes; campaign builder references pool.

**1.5** Per-mailbox warmup + cap-claim Postgres function (extends existing).
- Files: existing `warmup_state` and `email_send_log` get `mailbox_id` column; existing `claim_daily_send_budget` fn gains optional `p_mailbox_id` param. Plus new `today_enrolled_count` + `today_sent_count` + `last_reset_at` columns on `mailboxes`.
- DoD: Stress test of N>cap concurrent enrollment claims yields exactly `cap` claims. Existing IntegrateAPI singleton still works via NULL `mailbox_id`.

**1.6** Smartlead `smartlead-campaign` Edge Function (merged setup + enroll + activate per cycle 1).
- Files: `supabase/functions/smartlead-campaign/index.ts` (NEW). Single function with `{action: 'create'|'enroll'|'activate'|'mark_replied'}`.
- DoD: Setup runs ONCE at campaign launch (not per-cron). Enrollment runs per-cron, bounded `maxBatch=50`. Activation has rollback path on mid-flight failure (mark `campaigns.launch_failed`). Per-lead silent-drop detection via `smartlead_lead_id` capture from `addLeadToCampaign` response. `mark_replied` action calls Smartlead's lead-category PATCH to stop autonomous progression on stop-on-reply.

**1.7** `process-campaigns` refactor.
- Files: `supabase/functions/process-campaigns/index.ts:7-8` env var, `:122-129` `FOR UPDATE SKIP LOCKED`, add `provider` branch.
- DoD: Concurrent 5-min cron invocations do NOT double-process enrollments; Smartlead branch dispatches to `smartlead-enroll`; existing Resend branch unchanged.

**1.8** `send-email` env-var refactor.
- Files: `supabase/functions/send-email/index.ts:8`.
- DoD: `EMAIL_DOMAIN` reads from `RESEND_TRANSACTIONAL_DOMAIN` (default `notify.lazerlending.com`).

**1.9** ZeroBounce extension.
- Files: `supabase/functions/apollo-search/index.ts:327-353` (extend), `supabase/functions/validate-upload/index.ts` (NEW). JIT re-validation runs **before** `claimMailboxSlotForEnrollment` (NOT inside the FOR UPDATE SKIP LOCKED transaction — holding row locks during a 500ms-2s ZeroBounce HTTP call would tank enrollment throughput at concurrent cron load). The dispatcher checks `lead.last_validated_at`; if >60 days, it calls ZeroBounce, writes the result + suppression if needed, THEN enters the slot-claim transaction. The `unsubscribes` lookup inside the transaction stays (it's a fast index lookup, not a network call).
- DoD: All sub-statuses mapped to policy per `VENDOR-CONTRACTS.md §3`. Hard-drop sub-statuses (`spamtrap`/`abuse`/`do_not_mail` variants) write to `unsubscribes` (with `reason='zerobounce'`) transactionally. `unknown` sub-status routed correctly per type (`greylisted` → 24-48h re-check; others → allow with warning flag). `activity_data=true` on single-email path; `active_in_days` stored on lead. Stress test: 50 concurrent enrollment claims with 60-day-stale leads do not block each other on ZeroBounce HTTP latency.

**1.10** List-Unsubscribe RFC 8058 endpoint with HMAC + legacy fallback.
- Files: `supabase/functions/unsubscribe/index.ts` (extend), `src/lib/list-unsub-token.ts` (NEW).
- DoD: HMAC tokens verified statelessly; legacy UUID DB lookup fallback works; idempotent (re-submits return 200); raw MIME inspection of Smartlead-dispatched message confirms both URI variants + Post header (or documents that Smartlead URL is used per B13).

**1.11** Webhook events table + Smartlead webhook receiver.
- Files: `webhook_events` table lives in `supabase/migrations/20260505000003_lazer_reply_layer.sql` (already in Task 1.1's consolidated 4-migration set). New: `supabase/functions/smartlead-events/index.ts`.
- DoD: Replayed Smartlead event short-circuits 200 OK without dispatch. Signature verification rejects unsigned payloads.

**1.12** Mailbox watchdog cron job.
- Files: `supabase/functions/mailbox-watchdog/index.ts` (NEW), pg_cron schedule (hourly).
- DoD: Simulated bounce-rate spike auto-pauses mailbox within 1h. Single simulated complaint sends mailbox to `single_complaint_review`.

**1.13** Daily reconcile vs Smartlead.
- Files: `supabase/functions/smartlead-reconcile/index.ts` (NEW), pg_cron schedule (daily).
- DoD: Reconcile compares `sends WHERE status='sent'` row count against Smartlead's `unique_sent_count` for that campaign/date. **Does NOT touch `today_enrolled_count`** — that's a local enrollment-gate counter that legitimately exceeds vendor sent-count during warmup or partial dispatch. Discrepancies on `sends` rows: fetch Smartlead's per-lead status; correct rows where local says `queued` but Smartlead says `sent`/`bounced`; alert on rows where local says `sent` but Smartlead has no record (smartlead silent-drop).

**1.14** DNS health monitor (DMARC ramp evaluator deferred to v2 per cycle 1).
- Files: `supabase/functions/dns-health-check/index.ts` (NEW).
- DoD: Domain with broken DKIM flagged red within one job run. When 14 consecutive days clean DKIM + ≥500 sends per burner, fires ops alert "ramp eligible — perform DNS edit." Operator handles DNS edit manually until volume justifies automation.

**1.15** Bounce cascade.
- Files: in `smartlead-events/index.ts` `EMAIL_BOUNCED` handler.
- DoD: Hard bounce → `unsubscribes` insert (reason='hard_bounce') + cancel queued future-step sends across all campaigns + Smartlead `mark_lead_blocked` call to stop autonomous progression.

**1.16** Mailbox-cap-reset cron (mailbox-local midnight, idempotent).
- Files: `supabase/functions/mailbox-cap-reset/index.ts` (NEW), pg_cron hourly. Idempotent via `last_reset_at` column.
- DoD: Resets BOTH `today_enrolled_count` AND `today_sent_count` to 0 at mailbox-local midnight per `mailbox.timezone`. Re-running within same hour is a no-op.

**1.17** Webhook gap-alert (auto-reregistration deferred to v2 per cycle 1).
- Files: piggyback on `mailbox-watchdog/index.ts` hourly cron.
- DoD: Alerts ops via Resend if no Smartlead webhook events received in last 2 hours despite active campaigns. Operator re-registers manually via Smartlead UI. Avoids 7-hour silent disable.

**Phase 1 acceptance:** v1.SC1, v1.SC2, v1.SC3, v1.SC7, v1.SC8, v1.SC9, v1.SC10, v1.SC11.

### Phase 2 — Reply handling + FUB

**2.1** Reply ingest from Smartlead webhook.
- Files: `supabase/functions/smartlead-events/index.ts` `EMAIL_REPLIED` handler.
- DoD: Reply appears in `replies` table within seconds of webhook receipt. `in_reply_to_send_id` derived via `lead_id × campaign_id × sequence_number` matching to `sends`.

**2.2** Two-stage classifier.
- Files: `supabase/functions/classify-reply/index.ts` (NEW), `src/lib/classifier-keywords.ts` (NEW), `src/lib/pii-redact.ts` (NEW).
- DoD: Test reply set classifies with ≥90% accuracy. Keyword stage handles ~70%. LLM failover marks `classifier_error` + `requires_human_review`. `unsubscribe` triggers suppression insert.

**2.3** Store-and-notify forwarder.
- Files: `supabase/functions/store-and-notify/index.ts` (NEW). Per-campaign override read from `campaigns.team_email` column (set in CampaignBuilder UI).
- DoD: Positive reply triggers Resend notification per `notifyTeamOfReply` pseudocode. Per-campaign override fires on `campaigns.team_email`; falls back to `DEFAULT_REPLY_FORWARD_EMAIL` env when null.

**2.4** FUB client.
- Files: `src/lib/clients/fub.ts` (NEW).
- DoD: Smoke-test against FUB sandbox (trial account). Required headers (X-System, X-System-Key) present.

**2.5** FUB push on positive reply.
- Files: `supabase/functions/fub-push/index.ts` (NEW).
- DoD: Positive reply pushes to FUB via `POST /v1/events` (NEVER `/v1/people`). Payload: `source = FUB_DEFAULT_SOURCE_LABEL`, `occurredAt = replies.notified_at` (NOT `received_at` — Smartlead poll lag could push >24h gap which silently suppresses FUB automations per FUB P4), `person.stage = FUB_DEFAULT_STAGE_NAME` (string, not ID), `person.emails = [{value: email_normalized, type: 'work'}]`. Headers `X-System` + `X-System-Key`. Idempotency: skip if `replies.fub_pushed_at IS NOT NULL`. HTTP 201 → store `fub_person_id` on `leads.fub_id` (column already added in `_002` migration); 200 → update `leads.fub_id` if null; **204 → ops alert (FUB suppressed silently — not success)**; 4xx/5xx → exponential backoff retry. The FUB event id from the response is stored on `replies.fub_event_id` (add to `_003` migration replies table) for per-reply audit traceability; the `leads.fub_id` is the canonical person link.

**2.5b** Onboarding step: confirm Lazer's FUB stage name.
- Files: `scripts/fub-onboarding-check.ts` or one-shot Edge Function.
- DoD: Calls `GET /v1/stages` + `GET /v1/pipelines` against Lazer's live account; prints results; operator confirms stage name in `.env` matches.

**2.6** Replies inbox UI + manual reclassify + manual FUB push (with Realtime).
- Files: `src/pages/RepliesPage.tsx` (NEW), `src/hooks/use-replies.ts` (NEW).
- DoD: Realtime channel on `replies` table — INSERT events update the inbox without manual refresh. Operator can reclassify; `neutral → positive` reclassify triggers FUB push (same dedup path as auto-classify).

**2.8** FUB outbound webhook registration (cheap if done now per cycle 1).
- Files: in `supabase/functions/fub-push/index.ts` setup path; new `supabase/functions/fub-events/index.ts`.
- DoD: At Phase 2 setup, register webhooks for `peopleCreated` + `peopleStageUpdated` against our endpoint. Verify FUB-Signature header (SHA256 keyed with `X-System-Key`). Persist events to `webhook_events` (`provider='fub'`). Surfaces feedback signal for future classifier improvement and OQ4 (neutral-reply rule).

**2.7** Stop-on-reply enforcement.
- Files: in `classify-reply/index.ts` post-classification handler.
- DoD: Reply to step 1 cancels queued step 2..N sends to that lead in that campaign. Exception: `negative` low-conf does NOT stop.

> **Implementation order within Phase 2:** 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.5b → 2.6 → 2.7 → 2.8. Task 2.7 (stop-on-reply enforcement) MUST land before 2.8 (FUB outbound webhook registration) goes live in production — otherwise FUB events arrive before stop-on-reply prevents continued autonomous Smartlead progression.

**Phase 2 acceptance:** v1.SC4, v1.SC5.

### Phase 3 — Spam placement monitoring (v2)

**3.1** Seed inbox configuration UI + encrypted creds storage. New table `seed_inbox_set`. DoD: 3+ seeds saved with provider tags + IMAP/Gmail-API creds encrypted at rest.

**3.2** Pre-launch placement test. New `seed-placement-check` Edge Function. Initial check 10min, retry 30min. DoD: Spammy-copy campaign auto-pauses on placement check.

**Phase 3 acceptance:** v2.SC1.

### Phase 4 — Auto-rotation + routine domain retirement (v2)

**4.1** Aggregate domain-level health roll-up from mailbox signals. DoD: Domain dashboard shows aggregate.

**4.2** Auto-rotation trigger logic. New `auto-rotation` Edge Function. DoD: Either trigger condition (≥50% mailboxes paused 24h OR aggregate complaint >0.1% over 7d) puts domain in cooldown.

**4.3** Routine domain-retirement flow. DoD: Retired-domain mailboxes accept replies for 30-day tail; cannot be selected for sends.

**Phase 4 acceptance:** v2.SC2.

---

## Settings panel scope (v1 = 9 panels — cycle 1 cuts: 6, 10, 12, 13 → `.env`-only)

1. **Domains** — list, status, DKIM/SPF/DMARC indicators, ramp-eligible flag, retire button.
2. **Mailboxes** — per-domain list, connection_status, warmup state, today_enrolled / today_sent / daily cap, last-24h Wilson rates, manual-review flag, pause/resume.
3. **Sending pools** — name + member mailboxes.
4. **ZeroBounce** — API key (read), credit balance, validation policy per sub-status.
5. **Smartlead** — API key (read), webhook signing secret (read), warmup config display, per-campaign pacing display (read-only).
6. **Resend** — API key (read), transactional sending domain (display).
7. **Follow Up Boss** — API key (read), X-System-Key (read), default stage NAME (text input — must match `GET /v1/stages` response), dedup behavior toggle.
8. **Reply forwarding** — default team email, per-campaign override editor (writes to `campaigns.team_email`), classifier model display.
9. **Alerts** — ops alert email, alert categories enabled.

**v1 `.env`-only (no UI panel):** Zapmail provisioning (operate via API + CLI), seed inbox set (v2 only), NMLS/state-licensing footer template (B2 placeholder; no UI for content that doesn't exist), data retention windows (set in env, change requires deploy).

---

## Environment variables

See `VENDOR-CONTRACTS.md` for unblock-checklist source per var.

```bash
# --- Supabase (Lazer-isolated project per B1) ---
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# --- Smartlead Pro ---
SMARTLEAD_API_KEY=
SMARTLEAD_WEBHOOK_SIGNING_SECRET=
SMARTLEAD_BASE_URL=https://server.smartlead.ai/api/v1

# --- Zapmail (primary mailbox provisioning) ---
ZAPMAIL_API_KEY=
ZAPMAIL_BASE_URL=

# --- Maildoso (fallback) ---
MAILDOSO_API_KEY=

# --- ZeroBounce ---
ZEROBOUNCE_API_KEY=
ZEROBOUNCE_BASE_URL=https://api.zerobounce.net/v2

# --- Follow Up Boss ---
FUB_API_KEY=
FUB_X_SYSTEM=lazer-lending-crm
FUB_X_SYSTEM_KEY=                     # email FUB support to register; without it rate limits halve
FUB_BASE_URL=https://api.followupboss.com/v1
FUB_DEFAULT_STAGE_NAME=Lead           # must match `GET /v1/stages` response on Lazer's account — confirm in Phase 2.4
FUB_DEFAULT_SOURCE_LABEL=Lazer Lending CRM Cold Outreach

# --- Resend (transactional only) ---
RESEND_API_KEY=
RESEND_TRANSACTIONAL_DOMAIN=notify.lazerlending.com
RESEND_FROM_DEFAULT="Lazer CRM <ops@notify.lazerlending.com>"

# --- LLM classifier (no-train DPA required — B9) ---
CLASSIFIER_PROVIDER=anthropic
CLASSIFIER_MODEL=claude-sonnet-4-6
CLASSIFIER_API_KEY=

# --- DMARC RUA aggregator ---
DMARC_RUA_PROVIDER=cloudflare
DMARC_RUA_ENDPOINT=

# --- App ---
APP_BASE_URL=
LIST_UNSUB_TOKEN_SECRET=
LIST_UNSUB_TOKEN_TTL_DAYS=1825    # 5 years (CAN-SPAM friendly for legacy unsub clicks)
OPS_ALERT_EMAIL=
DEFAULT_REPLY_FORWARD_EMAIL=
DEFAULT_MAILBOX_TIMEZONE=America/Phoenix

# --- Watchdog thresholds ---
WATCHDOG_BOUNCE_THRESHOLD=0.02
WATCHDOG_COMPLAINT_THRESHOLD=0.001
WATCHDOG_MIN_ATTEMPTED=10
WATCHDOG_MIN_ATTEMPTED_FRESH=5
DEFAULT_MAILBOX_DAILY_CAP=30
FRESH_MAILBOX_WEEK1_CAP=10
```

---

## Validation

```bash
bun install
bun run lint
bun run test
bun run dev    # port 8080 — requires real VITE_SUPABASE_URL
bunx supabase migration up
```

### Manual scenarios

1. **CSV upload** — 50 leads, 10 known-invalid → ZeroBounce flags + suppressions; valid leads load with `email_normalized`.
2. **Concurrent enrollment race** — 31 jobs claim slots on cap=30 mailbox → exactly 30 succeed, 1 gets `NoMailboxAvailable`.
3. **Positive reply (English)** — "Sounds great, send a calendar link" → keyword classifier matches; store-and-notify fires; FUB push with email_normalized dedup; stop-on-reply cancels queued steps.
4. **Unsubscribe reply** — "Stop calling me, remove me" → keyword matches `unsubscribe`; suppression insert; never pushed to FUB.
5. **Spanish reply** — "Estoy interesado, llámeme" → keyword fails; LLM classifies positive; routed normally.
6. **Italian reply (unsupported)** — Language detection routes to human review queue; `classification=null`.
7. **Webhook replay** — Same Smartlead event delivered twice → first processes; second short-circuits via `webhook_events` unique constraint.
8. **Bounce-rate spike** — 3 hard bounces / 50 sends in 24h (Wilson lower 0.013, below threshold) → mailbox NOT auto-paused; 3 affected recipients individually suppressed; future-step sends cancelled.
9. **Single complaint** — 1 spam complaint on mailbox → enters `single_complaint_review` regardless of rate.
10. **Domain retirement** — Operator clicks Retire → mailboxes stop being eligible within 60s; in-flight Smartlead campaigns reassigned; replies still ingested for 30d.
11. **Daily reconcile** — Local DB shows 100 sends; Smartlead reports 102 → reconcile fetches detail + corrects 2 missing rows.
12. **Legacy unsubscribe link** — UUID-token URL from pre-Lazer Connect CRM campaign POSTs to `/api/list-unsubscribe` → fallback DB lookup succeeds; suppression inserted; 200 returned.

---

## Open questions

→ See `docs/lazer-lending/BLOCKED-AWAITING-CLIENT.md` for the canonical 16-blocker list (B1–B16) with per-item severity, current default, action-on-unblock, and code locations.

---

## Final validation checklist

- [ ] Phase 0.1 done (audit-delta written) ✓
- [ ] Phase 0 unblockers resolved or defaults documented in `BLOCKED-AWAITING-CLIENT.md`
- [ ] No `[path TBD]` markers remain in this plan
- [ ] All Phase-1-blocker items in BLOCKED-AWAITING-CLIENT.md answered before live cold sends
- [ ] All success criteria verified manually before declaring v1 done
- [ ] Resend transactional sends originate ONLY from `notify.lazerlending.com`
- [ ] No cold campaign send originates from `lazerlending.com` (root or any brand-root subdomain)
- [ ] List-Unsubscribe `<https://...>` AND `<mailto:...>` AND `List-Unsubscribe-Post: List-Unsubscribe=One-Click` confirmed by raw-MIME inspection
- [ ] DKIM `h=` tag covers both `list-unsubscribe` and `list-unsubscribe-post` headers
- [ ] List-Unsubscribe endpoint idempotent (re-submits return 200)
- [ ] List-Unsubscribe endpoint bypasses CSRF + unauthenticated
- [ ] Legacy UUID unsubscribe links continue to work (fallback path)
- [ ] DMARC `p=none` + `rua` configured on every burner at launch
- [ ] DMARC ramp evaluator triggers signal-based ramp (14 days clean + ≥500 sends)
- [ ] Both SPF AND DKIM align (Gmail Nov 2025 enforcement)
- [ ] All vendor API keys in `.env`, never in code or fixtures
- [ ] Smartlead webhook signature verification rejects unsigned payloads
- [ ] Smartlead webhook idempotency by `(provider, X-Request-Id)` enforced
- [ ] Smartlead webhook gap-alert deployed (>2h with no events fires ops alert; auto-reregistration deferred to v2)
- [ ] FUB push uses `POST /v1/events`, NOT `/v1/people`
- [ ] FUB X-System-Key registered (without it rate limits halve)
- [ ] FUB 204 response triggers ops alert (silent suppression)
- [ ] Suppression checked at enqueue AND inside dispatcher claim transaction
- [ ] Mailbox-cap-reset job runs at mailbox-local midnight per `mailbox.timezone`
- [ ] Watchdog uses Wilson lower-bound + hard-complaint escape
- [ ] Daily reconcile job runs and corrects vs Smartlead campaign analytics
- [ ] `email_normalized` populated and unique-indexed; FUB lookup uses it
- [ ] Hard bounce → global suppression + future-step cancellation verified
- [ ] Stop-on-reply verified across positive/neutral/OOO/unsubscribe paths
- [ ] Two-stage classifier verified — keyword handles ~70%; LLM only on ambiguous
- [ ] Classifier failover (timeout/error → null + flag) verified
- [ ] LLM provider has no-train DPA (B9 closed)
- [ ] PII redactor runs before LLM input
- [ ] Reply body retention windows enforced by background job
- [ ] NMLS / state lending disclosure footer present on every cold send (B2 closed)
- [ ] Lazer-isolated Supabase project provisioned (B1 closed) OR shared-tenant decision documented

---

## Deprecated / removed code

- `CODEBASE_ANALYSIS.md` (root) — preserved with supersession header (Phase B). Authoritative source is now `CONNECT-CRM-AUDIT-DELTA.md`.
- v2.1 `claimSendSlot` synchronous-send pseudocode — replaced by `claimMailboxSlotForEnrollment` + autonomous Smartlead dispatch.
- v2.1 plan's "build the backend from scratch" framing — invalidated by audit. Phase 0.1 task collapsed.
- v2.1 forwarder OQ (IMAP-redirect vs Resend-forward) — both options retired in favor of store-and-notify.
- v2.1 `EMAIL_DOMAIN` constant — refactored to `RESEND_TRANSACTIONAL_DOMAIN` env var.
- Mailforge as primary mailbox provider — demoted to "documented for completeness only" per VENDOR-CONTRACTS.md §2c.
- v2.1 calendar-based DMARC ramp — replaced with signal-based ramp.
- v2.1 single-tier 18-month retention — replaced with two-tier (18mo raw / 7yr metadata).

---

## Anti-patterns to avoid

- Cold mail through Resend, even "for testing." Smartlead from day 1.
- Cold mail from `lazerlending.com` or any brand-root subdomain.
- Treating Smartlead as a CRM. We use it as a campaign engine; UI + classifier + FUB sync are ours.
- Calling `POST /v1/people` for FUB lead creation (creates duplicates per FUB's own docs).
- Forwarding raw prospect reply bodies via Resend (use store-and-notify).
- Synchronous send loops against Smartlead (it's a campaign engine; activate then let it dispatch).
- Catching all errors generically — be specific (`Bounced`, `RateLimited`, `WebhookSignatureMismatch`, `RecipientSuppressed`, `NoMailboxAvailable`, `ClassifierTimeout`, `FubArchived`).
- Hardcoding daily caps, thresholds, vendor URLs, timezones, or `EMAIL_DOMAIN` — use env or settings.
- Skipping `FOR UPDATE SKIP LOCKED` on enrollment fetch (existing `process-campaigns:122-129` bug).
- String-interpolating SQL intervals.
- Logging raw reply bodies to third-party logging providers without redaction.
- Pushing the raw reply body to FUB.
- Skipping the suppression check inside the claim transaction (just enqueue-time check is insufficient).
- Single-use list-unsub tokens (Gmail prefetchers POST multiple times).
- Trusting webhook events without signature + idempotency check.
- Treating ZeroBounce `unknown` as a drop (it's a retry signal).

---

## Confidence

**One-pass implementation confidence: 8/10** (raised from 7/10 in v2.1 after Phase A audit + research).

Strong on: real codebase grounding, vendor API specifics, integration surface, idempotency model, deliverability compliance, two-stage classifier reducing LLM cost + PII surface, signal-based DMARC ramp, two-tier retention.

Limited by:
- 16 client-input blockers (B1–B16) — most have safe defaults but B2 (NMLS footer) is genuinely show-stopping for live sends until Lazer compliance/legal supplies text.
- Smartlead List-Unsubscribe URL ownership (B13) requires Phase 0.6 sandbox confirmation.
- FUB API tier confirmation (B11) needs Lazer's account rep.
- Zapmail provisioning API hands-on verification (Phase 0.6).
- Smartlead's autonomous dispatch latency (~2h reply lag for Outlook) means no real-time SLA.

Score climbs to 9/10 after Phase 0.5 client kickoff resolves Phase-1-blocker items in `BLOCKED-AWAITING-CLIENT.md` and Phase 0.6 sandbox confirms Smartlead specifics.

---

*Plan v3 — written 2026-05-05 by IntegrateAPI based on Phase A codebase audit (line-cited in CONNECT-CRM-AUDIT-DELTA.md) + 5 vendor research files. Ready for plan-reviewer cycles per Phase D of the build workflow.*
