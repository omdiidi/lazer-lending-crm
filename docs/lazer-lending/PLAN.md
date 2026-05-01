# Lazer Lending CRM — Implementation Plan

**Date:** 2026-04-30
**Author:** IntegrateAPI (Nick Pardon, w/ Claude review)
**Client:** Lazer Lending
**Base codebase:** Connect CRM — `https://github.com/nkpardon8-prog/connect-crm`
**Status:** Connect CRM cloned into the repo. Stack confirmed and audited via Connect CRM's own `CODEBASE_ANALYSIS.md`. Plan v2.1 — incorporates merged reviewer feedback (see `PLAN-REVIEW-NOTES.md`) plus post-clone audit findings.
**Re-review gate:** A second `plan-reviewer` pass is recommended once the Supabase migrations + edge functions are walked through and the implementer has verified `CODEBASE_ANALYSIS.md` is current rather than aspirational. Run before any Phase 1 work.

---

## Stack (verified by post-clone audit, 2026-04-30)

- **Frontend:** React 18 + TypeScript + Vite (SWC), Tailwind 3, shadcn/ui (48 Radix-based components), React Router v6, React Context for state, `@tanstack/react-query` installed but unused.
- **Backend:** Supabase (config in `supabase/`, migrations in `supabase/migrations/`, edge functions in `supabase/functions/`). Per Connect CRM's own `CODEBASE_ANALYSIS.md`: "No backend, no API calls, no database — 100% client-side with mock data." This is a critical finding (see Known Mismatches).
- **Data layer (mock):** `src/data/mockData.ts` (hardcoded arrays) loaded into `src/contexts/CRMContext.tsx`. Type definitions at `src/types/crm.ts`.
- **Package manager:** Bun (`bun.lock` + `bun.lockb`).
- **Build/test:** Vite + Vitest + Playwright (minimal coverage today).
- **Deployment:** Netlify (`netlify.toml`).
- **MCP server:** Connect CRM ships an `mcp-server/` directory — scope to investigate in Phase 0.

## Critical finding: Connect CRM is a UI scaffold, not a working CRM

Per `CODEBASE_ANALYSIS.md` §1: *"No backend, no API calls, no database — 100% client-side with mock data."* The PRD's claim that "Connect CRM has warmup logic built in" (PRD §5.2) refers to a UI mockup, not an actual warmup network. The implementer should expect to **build the backend Connect CRM mocks** (leads, deals, sequences, campaigns, plus our new sending/replies/FUB layer) on top of Supabase — not extend a working sending pipeline.

This is good news for the brief's architectural decisions: there is no Resend cold-sender to rip out, because there isn't one. The "Phase 0 audit" work shrinks meaningfully; "Phase 1 build the backend" work expands.

---

## Goal

Ship a Lazer-branded cold-outreach CRM that meets the seven core outcomes from
the PRD: safe high-volume cold campaigns, lead validation, deliverability
protection, reply capture/classification/routing, positive-reply forwarding,
qualified-only push to Follow Up Boss, and aggressive deliverability defense.
The CRM is built in-house on top of Connect CRM. The cold sending layer is
vendored to Smartlead Pro. The mailbox/domain inventory is vendored to
Mailforge. The brand domain `lazerlending.com` is never used to send cold mail.

## Summary

Extend Connect CRM into Lazer Lending CRM with: (1) a Smartlead-driven
headless cold sending layer running on burner-domain Google Workspace
mailboxes provisioned via Mailforge; (2) Resend retained for transactional
mail only on `notify.lazerlending.com`; (3) ZeroBounce-gated lead validation
at upload + JIT before send; (4) inbound replies pulled from real mailboxes
via Smartlead reply webhook into an LLM classifier with explicit failover
behavior; (5) FUB integration for positive replies only with email
normalization and dedup; (6) operator settings panel covering all knobs;
(7) bounce/complaint watchdog using Wilson lower-bound, hard-complaint
escape hatch, daily reconcile against Smartlead stats, plus DNS health
monitoring with DMARC aggregate-report (RUA) collection; (8) routine
domain-rotation flow that replaces the PRD's "torched root" emergency.
Volume target for v1 is 100–300/day, with a documented scale path to
~1,000/day.

## Intent / Why

- **Lazer's primary lead-gen channel is cold outreach.** Every day the system
  is unbuilt, Lazer is leaving pipeline on the table or relying on tools that
  don't integrate with FUB the way they need.
- **The brand domain must survive.** `lazerlending.com` is Lazer's actual
  business mail domain. Cold sending must never burn it.
- **The product moat is the CRM, not the MTA.** Lazer is paying for a
  custom-branded cold-outreach workflow with FUB integration; they are not
  paying for IntegrateAPI to reinvent email-sending infrastructure that
  vendors do better.
- **Outcome stability is non-negotiable.** Even if internal architecture
  changes later (e.g. swapping Smartlead for Saleshandy, swapping Mailforge
  for direct Workspace), the seven PRD outcomes must remain true.

## Source Artifacts

- **Brief:** `tmp/briefs/2026-04-30-email-sending-architecture.md`
- **PRD:** `lazer-lending-crm-prd.md`
- **Plan-review merged notes:** `tmp/review-notes/2026-04-30-plan-review-merged.md`
- **Connect CRM (base codebase):** `https://github.com/nkpardon8-prog/connect-crm`

## What

### User-visible behavior

- Operator can upload a CSV of leads. ZeroBounce validates on upload; invalid
  contacts are dropped with a per-row reason; valid contacts enter the lead
  database with both `email` and `email_normalized`.
- Operator can build a campaign with a sequence of 1–N email steps, schedule
  it, and assign it to a sending pool.
- The system selects available mailboxes from the pool by **utilization
  ratio** (lowest `today_sent_count / daily_cap` first, with random jitter),
  enforces per-mailbox daily cap atomically, and dispatches via Smartlead.
  Inter-send pacing within a mailbox is owned by Smartlead.
- Each campaign launch first sends to a configurable seed-inbox set across
  Gmail/Outlook/Yahoo. Placement is checked **10–15 minutes** after send,
  with a retry pass at 30 minutes. Bad placement on ≥2 seeds pauses the
  campaign and alerts.
- Replies land in the originating Workspace mailbox. Smartlead webhook fires
  the CRM. The classifier categorizes (positive / neutral / OOO / unsubscribe
  / negative) with confidence and rationale. Routing rules forward to the
  configured team email.
- Positive replies trigger a FUB dedup check (using `email_normalized`),
  then push to FUB at the configured pipeline + stage. OOO never pushes.
  Neutral requires human tag. `unsubscribe` classification adds the
  recipient to the suppression list (in addition to the RFC 8058 endpoint).
- Operator dashboard shows per-mailbox health: warmup state, today's send
  count, bounce rate, complaint rate, last placement check, last health
  check, current paused-reason if any.
- A domain-rotation button retires a burner domain and the system stops
  scheduling sends on its mailboxes within 60s.
- Settings panel exposes all operational knobs (see §Settings).

### Technical requirements

- All cold mail authenticated via SPF + DKIM + DMARC on the burner domain.
- DMARC aggregate reports (`rua`) collected per burner domain.
- Every cold send carries RFC 8058 one-click List-Unsubscribe headers
  (both `<https://...>` and `<mailto:...>` plus `List-Unsubscribe-Post`).
- Per-mailbox daily-send limit (configurable 20–40, default 30).
- Per-mailbox bounce-rate watchdog: Wilson lower-bound on rolling 24h with
  min-attempted floor of 10. Threshold 2%.
- Per-mailbox complaint-rate watchdog: same shape, threshold 0.1%. **Plus**
  a hard-rule: any single spam complaint sends the mailbox to a manual-review
  queue regardless of rate (because at v1 volume, 1/30 = 3.3% which is too
  noisy to use as a rate signal).
- Hard bounce on any send → recipient added to suppression list globally and
  any queued future-step sends to that lead are cancelled across all
  campaigns.
- Smartlead webhook signature verification on every inbound event.
- Webhook idempotency: every event short-circuits on duplicate
  `(provider, external_event_id)`.
- Daily reconcile job pulls Smartlead per-mailbox stats and corrects local
  `sends` rows that disagree with vendor truth (covers webhook drops/delays).
- ZeroBounce just-in-time re-validation for contacts unverified in >60 days.
- Reply classifier runs on every inbound reply; classification is persisted
  with confidence + rationale. Failover: on classifier error/timeout,
  classification is `null`, reply is flagged for human review, no auto-FUB
  push.
- A reply (any classification except `negative` low-confidence) cancels all
  queued future-step sends to that lead in that campaign (stop-on-reply).
- FUB push is idempotent against `email_normalized`. If matched, update tags
  only.
- List-Unsubscribe POST endpoint is **idempotent**: re-submits on
  already-suppressed return 200 OK (Gmail prefetchers commonly POST twice).
- List-Unsubscribe token is a stateless HMAC over
  `(lead_id, campaign_id, mailbox_id, expiry_unix)` keyed with
  `LIST_UNSUB_TOKEN_SECRET`. No DB row needed.
- The List-Unsubscribe HTTP route bypasses framework CSRF and is unauthenticated.

### Success Criteria

- [ ] **v1.SC1:** A new operator can provision a fresh burner domain + 2
  Workspace mailboxes from settings, see them appear in the pool with state
  `provisioning → dns_pending → oauth_pending → verifying → ready`, watch
  warmup progress, and see them go "live" only after Smartlead reports
  warmup-ready.
- [ ] **v1.SC2:** A 100-contact list uploaded as CSV passes through ZeroBounce
  validation, drops invalids with reasons, and loads valid contacts into
  the lead store with both `email` and `email_normalized`.
- [ ] **v1.SC3:** A campaign of 100 sends executes end-to-end through
  Smartlead on warmed burner-domain mailboxes, with daily caps respected,
  pacing owned by Smartlead, List-Unsubscribe headers (both URI variants
  + Post header) on every send (verified by raw-MIME inspection), and
  DMARC aggregate reports flowing to the configured RUA mailbox.
- [ ] **v1.SC4:** A reply to one of those sends arrives in the real Workspace
  mailbox, fires the Smartlead webhook (signature-verified), gets
  classified, and gets forwarded to the configured team email per the
  campaign's routing rule. A duplicate webhook event for the same reply
  does NOT produce a second forward.
- [ ] **v1.SC5:** A positive reply pushes to FUB with email-normalization
  dedup; an OOO reply never pushes; a neutral reply waits for human tag;
  a `classification=unsubscribe` reply adds the recipient to the suppression
  list.
- [ ] **v1.SC6:** Manual domain rotation stops sends on the rotated domain's
  mailboxes within 60 seconds.
- [ ] **v1.SC7:** Resend transactional mail (e.g. internal alerts) sends from
  `notify.lazerlending.com` and never from a cold burner domain.
- [ ] **v1.SC8:** A mailbox that exceeds the 24h Wilson-lower-bound bounce
  threshold (2%) or has even one spam complaint is auto-paused or sent to
  manual review within 1h, with a Resend alert email to the configured
  ops address.
- [ ] **v1.SC9:** A hard bounce to a recipient triggers (a) suppression-list
  insert and (b) cancellation of all queued future-step sends to that lead
  across all campaigns.
- [ ] **v1.SC10:** The daily reconcile job, run against a deliberately stale
  local `sends` state, corrects rows to match Smartlead's vendor truth.
- [ ] **v1.SC11:** A simulated dropped webhook event followed by a manual
  Smartlead retry does not double-process the event (idempotency by
  `(provider, external_event_id)`).
- [ ] **v2.SC1:** Spam-placement check on test seeds across Gmail/Outlook/
  Yahoo runs pre-campaign at the 10-min and 30-min marks and pauses the
  campaign on ≥2 seed spam landings.
- [ ] **v2.SC2:** Auto-rotation: a domain enters cooldown if (a) ≥50% of
  its mailboxes are paused within 24h OR (b) aggregate domain complaint
  rate >0.1% over 7d. Mailboxes pause and remaining campaigns are
  reassigned.

## Verified Repo Truths

Connect CRM has been cloned into this repository as the starting state.
Facts below are verified against the actual code (paths relative to repo root).

### PRD

- **Fact:** `docs/lazer-lending/PRD.md` (mirror of original `lazer-lending-crm-prd.md`)
  is the outcome spec.
  Evidence: file present at both paths; 399 lines.
  Implication: The plan's outcome contract is anchored here. Where the PRD and
  this plan disagree (email layer), `Locked Decisions` overrides; everywhere
  else the PRD governs.

### Connect CRM (now in-repo)

- **Fact:** Connect CRM is a frontend-only React/TypeScript SPA with mock data.
  Evidence: `CODEBASE_ANALYSIS.md:1-50` — explicitly states "No backend, no API
  calls, no database — 100% client-side with mock data."
  Implication: The implementer is **building** the backend, not extending one.

- **Fact:** Stack is React 18 + Vite (SWC) + TypeScript + Tailwind + shadcn/ui +
  React Router v6 + React Context + Bun.
  Evidence: `package.json`; `vite.config.ts`; `bun.lock`; `tailwind.config.ts`;
  `components.json`.

- **Fact:** Type definitions for the existing mock model live in
  `src/types/crm.ts` and define `User`, `Lead`, `Activity`, `EmailMessage`,
  `Deal`, `EmailSequence`, `SequenceStep`, `AISuggestion`, `Campaign`.
  Evidence: `CODEBASE_ANALYSIS.md` §2.

- **Fact:** Mock data is in `src/data/mockData.ts`; mutations go through
  `src/contexts/CRMContext.tsx`.
  Evidence: `CODEBASE_ANALYSIS.md` §3, §4.

- **Fact:** Connect CRM includes a `supabase/` directory with `config.toml`,
  `migrations/`, `functions/`. Supabase is configured but the React app does
  not call it (per CODEBASE_ANALYSIS.md §1).
  Evidence: directory listing; CODEBASE_ANALYSIS.md.
  Implication: Supabase is the intended backend home for our additions.

- **Fact:** Connect CRM ships a `mcp-server/` directory with its own
  `package.json`. Scope and integration unknown.
  Evidence: directory listing.
  Implication: Phase 0 should determine whether to keep, extend, or ignore.

- **Fact:** Existing `docs/` already contains `OVERVIEW.md`, `architecture.md`,
  `authentication.md`, `campaigns.md`, `dashboard.md`, `data-model.md`,
  `lead-generator.md`, `leads.md`, `outreach.md`, `pipeline.md`.
  Evidence: directory listing.
  Implication: Implementer should read these before scoping our additions; they
  describe Connect CRM's existing UX and inform our settings/UI extensions.

## Locked Decisions

These decisions are settled in the brief or this plan's reviewer-pass and
are not to be re-litigated by the implementer. Push back only if you discover
a clear technical blocker.

1. **Burner-domain pool, not subdomain rotation on `lazerlending.com`.** Cold
   mail sends from 2–4 brand-affiliated burner domains (e.g. `lazer-loans.com`,
   `getlazerloans.com`, `team-lazer.com`). The brand root never sends cold.
2. **Smartlead Pro is the cold sending engine.** Headless API + webhook
   integration; no end-user UI exposure to Smartlead. Saleshandy was rejected
   for ambiguous reply-webhook documentation.
3. **Mailforge supplies the Workspace mailbox + DNS inventory** at bulk
   reseller pricing. Direct retail Google Workspace is the documented
   fallback if Mailforge becomes unavailable.
4. **Resend is retained for transactional only** on `notify.lazerlending.com`.
   No cold sending through Resend. Free tier (3k/mo) is expected to suffice
   for v1; upgrade only if alert/internal mail volume warrants.
5. **v1 volume target is 100–300/day.** Inventory provisioned to match.
   Scale path to 1,000/day documented but not pre-built.
6. **ZeroBounce stays as the validator** at upload and just-in-time before
   send (per PRD §5.3). No alternative validator evaluated.
7. **DMARC ramp policy: `p=none` at burner launch with `rua` configured →
   4–6 weeks of clean aggregate reports → ramp to `p=quarantine`.** Skipping
   the `none` window is forbidden because it would reject legitimate mail
   while DKIM is still aligning.
8. **Replies pull from real Workspace mailboxes via Smartlead reply
   webhook** — not via inbound-parse webhooks at the ESP level.
9. **"Torched root" reframed as routine inventory rotation.** A burned
   burner domain is retired and replaced; this is operationally cheap.
   Brand-root recovery flows are not built because the brand root is
   architecturally insulated from cold abuse.
10. **No code is written under this plan until the user approves
    implementation separately.** This plan is the documentation deliverable.
11. **Inter-send pacing is owned by Smartlead.** The CRM enforces (a) per-
    mailbox daily ceiling and (b) per-mailbox concurrency = 1 (no parallel
    sends from the same mailbox). All time-of-day spread is Smartlead's job.
12. **Daily cap reset uses mailbox-local timezone** (default
    `America/Phoenix`, per-mailbox overridable). A scheduled job zeroes
    `today_sent_count` at the mailbox-local midnight for each mailbox.
13. **List-Unsubscribe token is a stateless HMAC** over
    `(lead_id, campaign_id, mailbox_id, expiry_unix)` keyed with
    `LIST_UNSUB_TOKEN_SECRET`.
14. **Auto-rotation domain breach formula:** a domain enters cooldown if
    (a) ≥50% of its mailboxes are paused within 24h, OR (b) aggregate
    domain complaint rate >0.1% over 7d.
15. **Per-mailbox daily cap range is 20–40, default 30.** Brief's "25–40"
    is a subset; plan's wider range covers warmup-tail mailboxes.
16. **Watchdog uses Wilson lower-bound + hard-complaint escape hatch.** Min
    attempted floor: 10. Hard-complaint rule: any single spam complaint on
    any mailbox sends that mailbox to manual-review queue regardless of rate.

## Known Mismatches / Assumptions

- **Mismatch:** PRD §5.8 specifies "All sends go through Resend." This plan
  uses Smartlead for cold and Resend for transactional only.
  Repo Evidence: `lazer-lending-crm-prd.md:172-180`
  Requirement Evidence: Brief D2 (Cold sending via Smartlead Pro API).
  Planning Decision: The plan honors the brief.

- **Mismatch:** PRD §5.1 / §5.5 build the architecture around subdomain
  rotation on `lazerlending.com` with "torched root" detection. This plan
  uses burner domains and treats rotation as routine inventory replacement.
  Repo Evidence: `lazer-lending-crm-prd.md:69-79`, `lazer-lending-crm-prd.md:121-146`.
  Requirement Evidence: Brief D1 (burner-domain pool).
  Planning Decision: The plan honors the brief. PRD §5.5's torched-root flow
  is repurposed as the domain-retirement flow.

- **Mismatch (RESOLVED):** PRD §5.2 says "Connect CRM has warmup logic built in."
  Reality: Connect CRM is 100% client-side mock data with no backend at all
  (per its own `CODEBASE_ANALYSIS.md` §1). There is no working warmup module,
  no working send layer, no Resend integration to refactor.
  Planning Decision: Treat the warmup PRD claim as aspirational. Build warmup
  via Smartlead's bundled warmup network (locked in brief D2). The "audit
  warmup module" task in Phase 0 collapses to "verify CODEBASE_ANALYSIS.md
  is current and confirm no working warmup exists."

- **Resolved (was assumption-audit-deferred):** Connect CRM job runner /
  scheduler / locking primitive set is **none** — there is no backend.
  Planning Decision: Build all scheduled jobs (watchdog, reconcile, daily
  reset, DNS health, JIT validation) as Supabase Edge Functions invoked via
  `pg_cron` (Postgres extension Supabase supports natively). Locking primitive
  is Postgres row-level via `FOR UPDATE SKIP LOCKED` in the dispatcher.
  Lock this in Phase 0 once Supabase project is provisioned.

- **Assumption:** Lazer's existing Workspace tenant for `lazerlending.com`
  (if any) is separate from the Mailforge-provided burner-domain mailboxes.
  Planning Decision: Confirm in Phase 0 client kickoff.

- **Assumption:** Connect CRM may already model email messages
  (`messages` / `email_events` table). If so, replies should reuse that
  shape rather than duplicate raw bodies.
  Planning Decision: Phase 0 deliverable; Reply table only stands alone if
  no usable existing message store exists.

## Critical Codebase Anchors

- **Anchor:** Connect CRM existing warmup module (path TBD in Phase 0 audit).
  Reuse / Watch for: The audit must determine whether Connect CRM's warmup
  is (a) self-contained algorithm with no external network, (b) integrates
  an external warmup service, or (c) simulates against company inboxes. If
  (a) or (c), this plan replaces it with Smartlead's built-in warmup; if
  (b), evaluate the existing integration.

- **Anchor:** Connect CRM existing campaign + send pipeline (path TBD).
  Reuse / Watch for: Connect CRM presumably already abstracts a "send"
  operation. The Smartlead integration should slot into that abstraction
  rather than introduce a parallel send pipeline.

- **Anchor:** Connect CRM lead model (path TBD).
  Reuse / Watch for: Reuse Connect CRM's lead/contact model wholesale where
  possible. Add fields, do not replace.

- **Anchor:** Connect CRM job runner / scheduler / locking primitive (TBD).
  Reuse / Watch for: All scheduled and queued work in this plan (watchdog,
  reconcile, daily-cap-reset, DNS health, JIT validation, dispatch fan-out)
  must hook into Connect CRM's existing primitive — do not introduce a
  second job runner.

## All Needed Context

### Documentation & References

#### External — Sending layer

- **Smartlead API docs:** https://api.smartlead.ai/reference
  Section: Campaigns, Mailboxes, Email Accounts, Webhooks
  Why: This is the primary integration surface.
  Critical insight: Webhook events for `reply`, `bounce`, `unsubscribe`,
  `email_sent`, `email_opened`, `email_link_clicked` are the source of
  truth for in-flight campaign state. Verify each event's signed payload
  format before building the verifier.

- **Smartlead Help Center — Full API Documentation index:**
  https://helpcenter.smartlead.ai/en/articles/125-full-api-documentation

- **Smartlead webhook setup guide:**
  https://helpcenter.smartlead.ai/en/collections/webhooks
  Why: Webhook payload signing, retry behavior, and event types.

- **Smartlead per-mailbox rate limits + queue behavior:** verify in Phase 0.
  Critical insight: Smartlead enforces its own per-mailbox daily limits to
  protect deliverability. On 429/queue response, our dispatcher must mark
  the mailbox `paused_reason='smartlead_rate_limit'` and not retry today.

#### External — Infra layer

- **Mailforge pricing + provisioning:** https://www.mailforge.ai/pricing
  Critical insight: At small scale (5–10 mailboxes) some bundles include
  free domain registration. Check active bundle at provisioning time.

- **Google Workspace SPF/DKIM/DMARC setup:**
  https://support.google.com/a/answer/33786 (SPF)
  https://support.google.com/a/answer/180504 (DKIM)
  https://support.google.com/a/answer/2466580 (DMARC)

#### External — Compliance

- **RFC 8058 — One-Click List-Unsubscribe:**
  https://datatracker.ietf.org/doc/html/rfc8058
  Critical insight: Both `List-Unsubscribe: <https://...>, <mailto:...>` AND
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers must be
  present. Verify on a real Smartlead-dispatched message in raw MIME.

- **Google Email Sender Guidelines (post-Nov-2025):**
  https://support.google.com/a/answer/81126
  Critical insight: 0.3% complaint rate hard ceiling at Gmail Postmaster
  Tools. Our internal watchdog is set at 0.1% to give buffer.

- **Cloudflare DMARC Management (free aggregate-report aggregator):**
  https://blog.cloudflare.com/dmarc-management/
  Why: Free, simple aggregator that can serve as the `rua` destination.

#### External — Validation

- **ZeroBounce API:** https://www.zerobounce.net/docs/email-validation-api-quickstart
  Critical insight: Bulk validation is async; webhook callback or polling.
  Sub-statuses include `valid`, `invalid`, `catch-all`, `do-not-mail`,
  `spam-trap`, `abuse`, plus an activity score. Handle as buckets, not binary.

#### External — Follow Up Boss

- **FUB API docs:** https://docs.followupboss.com/reference
  Critical insight: FUB matches contacts by email. Pattern: lookup by
  `email_normalized` → POST if absent, PUT to update tags if present.
  FUB has rate limits — back off on 429 with retries.

#### External — Resend

- **Resend domains + DNS:** https://resend.com/docs/dashboard/domains/introduction
  Critical insight: Resend is for transactional only in this build.

#### Repo references (deferred — populated in Phase 0)

- Connect CRM `[path TBD]` — campaign model, send orchestration layer,
  warmup module, settings/auth/jobs plumbing, message/email-event store
  (if present), shared types/exports.

### Files Being Changed

The exact file tree depends on Connect CRM's structure (TBD in Phase 0).
This subsection enumerates the **logical units** to be created or modified.
Phase 0 produces a concrete file tree filling these in.

```
[connect-crm-root]/
├── [data layer / schema location]
│   ├── domains table                                      ← NEW
│   ├── mailboxes table                                    ← NEW
│   ├── pool_memberships table                             ← NEW (join: pools↔mailboxes)
│   ├── sending_pools table                                ← NEW
│   ├── conversations table                                ← NEW (lead × mailbox × thread anchor)
│   ├── campaigns table                                    ← MODIFIED
│   ├── campaign_steps table                               ← NEW (sequence steps)
│   ├── leads table                                        ← MODIFIED (zerobounce_*, email_normalized, fub_id)
│   ├── replies table                                      ← NEW (or extend existing message store)
│   ├── sends table                                        ← MODIFIED or NEW
│   ├── suppressions table                                 ← NEW
│   ├── webhook_events table                               ← NEW (idempotency)
│   ├── seed_inbox_checks table (v2)                       ← NEW
│   └── settings keys (lazer.*)                            ← MODIFIED
│
├── [services / business logic]
│   ├── send/smartlead-client.[ext]                        ← NEW
│   ├── send/provider.[ext]                                ← NEW (SendProvider interface)
│   ├── send/dispatcher.[ext]                              ← NEW or REPLACES Resend dispatcher
│   ├── send/throttle-guard.[ext]                          ← NEW
│   ├── send/list-unsubscribe-handler.[ext]                ← NEW (RFC 8058)
│   ├── send/rate-limit-handler.[ext]                      ← NEW (Smartlead 429)
│   ├── send/bounce-cascade.[ext]                          ← NEW (hard-bounce → suppress + cancel)
│   ├── send/stop-on-reply.[ext]                           ← NEW
│   ├── infra/mailforge-client.[ext]                       ← NEW
│   ├── infra/dns-health-check.[ext]                       ← NEW (DKIM/SPF/DMARC + RBL)
│   ├── infra/dmarc-rua-receiver.[ext]                     ← NEW (or third-party aggregator)
│   ├── validate/zerobounce-client.[ext]                   ← NEW
│   ├── validate/list-uploader.[ext]                       ← NEW or MODIFIED
│   ├── validate/email-normalizer.[ext]                    ← NEW (lowercase, plus-tag, Gmail dots)
│   ├── replies/webhook-receiver.[ext]                     ← NEW (top-level: signature + dispatch)
│   ├── replies/idempotency-guard.[ext]                    ← NEW
│   ├── replies/event-handlers/delivery.[ext]              ← NEW
│   ├── replies/event-handlers/reply.[ext]                 ← NEW
│   ├── replies/classifier.[ext]                           ← NEW (LLM + failover)
│   ├── replies/router.[ext]                               ← NEW
│   ├── replies/forwarder.[ext]                            ← NEW (IMAP redirect or Resend — see OQ)
│   ├── fub/client.[ext]                                   ← NEW
│   ├── fub/sync.[ext]                                     ← NEW (positive-reply push w/ dedup)
│   ├── transactional/resend-client.[ext]                  ← NEW or MODIFIED
│   ├── transactional/alert-emitter.[ext]                  ← NEW
│   ├── deliverability/seed-inbox-checker.[ext]            ← NEW (v2)
│   ├── deliverability/auto-rotation.[ext]                 ← NEW (v2)
│   └── warmup/[evaluate existing]                         ← MODIFIED (likely thin Smartlead wrapper)
│
├── [routes / api surface]
│   ├── api/leads/upload                                   ← NEW or MODIFIED
│   ├── api/campaigns                                      ← MODIFIED
│   ├── api/campaigns/{id}/launch                          ← NEW
│   ├── api/webhooks/smartlead                             ← NEW
│   ├── api/list-unsubscribe                               ← NEW (CSRF-bypass + unauthenticated)
│   ├── api/dmarc-rua                                      ← NEW (if self-hosting RUA receiver)
│   ├── api/settings/*                                     ← MODIFIED
│   ├── api/domains/*                                      ← NEW
│   ├── api/mailboxes/*                                    ← NEW
│   ├── api/replies/*                                      ← NEW (read + manual reclassify + manual FUB push)
│   └── api/fub/*                                          ← NEW
│
├── [scheduled jobs / workers]
│   ├── jobs/daily-cap-reset.[ext]                         ← NEW (mailbox-local midnight)
│   ├── jobs/zerobounce-revalidation.[ext]                 ← NEW (60-day re-validation)
│   ├── jobs/mailbox-watchdog.[ext]                        ← NEW (Wilson lower-bound)
│   ├── jobs/smartlead-reconcile.[ext]                     ← NEW (daily reconcile vs Smartlead stats)
│   ├── jobs/dns-health-monitor.[ext]                      ← NEW
│   ├── jobs/dmarc-ramp-evaluator.[ext]                    ← NEW (signals when domain is ramp-eligible)
│   ├── jobs/seed-placement-check.[ext]                    ← NEW (v2; 10-min + 30-min retry)
│   └── jobs/auto-rotation.[ext]                           ← NEW (v2)
│
├── [ui / frontend]
│   ├── pages/dashboard                                    ← NEW or MODIFIED
│   ├── pages/campaigns                                    ← MODIFIED (sequence builder, pool selector)
│   ├── pages/leads                                        ← MODIFIED
│   ├── pages/replies                                      ← NEW (inbox view, reclassify, manual push)
│   ├── pages/settings                                     ← MODIFIED — major expansion
│   ├── pages/domains                                      ← NEW
│   └── pages/mailboxes                                    ← NEW
│
└── env / config
    └── .env.example                                       ← MODIFIED (see §Env Vars)
```

### Known Gotchas & Library Quirks

- **Smartlead webhook signing:** signature scheme + replay-protection
  window are Phase 0 deliverables. Reject unsigned or mis-signed payloads.
- **Webhook idempotency:** Smartlead retries on non-200. Every event must
  short-circuit on duplicate `(provider, external_event_id)`.
- **Smartlead per-mailbox limits:** App-level cap (default 30) is more
  conservative than Smartlead's. On 429, mark mailbox
  `paused_reason='smartlead_rate_limit'` and do not retry today.
- **Mailforge tenant model:** Mailforge mailboxes typically live in a
  shared Mailforge-owned Workspace organization. If Mailforge loses
  Google's reseller status, all mailboxes can be affected at once.
  Mitigation: doc'd direct-Workspace fallback; backup vendor stance
  recorded in Open Questions.
- **ZeroBounce sub-statuses:** Treat `valid`, `invalid`, `catch-all`,
  `do-not-mail`, `spam-trap`, `abuse` as distinct buckets. Settings policy
  controls dispatcher gate behavior per sub-status.
- **FUB rate limits:** Back off on 429 with retries.
- **List-Unsubscribe POST endpoint:**
  - Unauthenticated, no CSRF token, no redirect.
  - Returns 200 OK on legitimate one-click submits.
  - **Idempotent** — re-submits on already-suppressed return 200.
  - Body must contain `List-Unsubscribe=One-Click`.
  - Token is HMAC; verify with `LIST_UNSUB_TOKEN_SECRET`.
- **Resend AUP — even for transactional:** Do not let cold-style send
  patterns leak into Resend. The transactional Resend domain is reserved
  for system-initiated mail to staff and double-opt-in recipients only.
- **DMARC ramp-up:** Start each new burner at `p=none` with `rua` configured.
  Ramp to `p=quarantine` only after 4–6 weeks of clean DMARC reports
  evaluated by `jobs/dmarc-ramp-evaluator`.
- **DKIM rotation:** Mailforge owns DKIM rotation. DNS health check must
  verify "selector currently signing outgoing mail matches published TXT,"
  not a static expected value.
- **Daily-cap-reset race:** Reset job runs at mailbox-local midnight; an
  in-flight `claimSendSlot` near midnight could see stale `today_sent_count`.
  Mitigation: dispatcher uses atomic UPDATE on `today_sent_count + 1 <=
  daily_cap` so a slightly-late reset is self-correcting on next call.
- **Connect CRM stack uncertainty:** File extensions, ORM, test commands,
  and locking primitives all change with stack. Phase 0 establishes this
  and updates the plan.
- **Seed-inbox check timing:** Placement settles 10–15 min, not 2–3 min.
  Initial check at 10 min, retry at 30 min.

## Reconciliation Notes

This plan was reconciled with the discussion brief, the PRD, and the merged
plan-reviewer feedback as follows:

- **Added from brief:** All Locked Decisions D1–D7. Added D8 (replies pull
  via Smartlead webhook), D9 (torched-root reframe), D10 (doc-only).
- **Added from reviewer feedback:** D11 (pacing owned by Smartlead), D12
  (mailbox-local TZ for daily reset), D13 (HMAC unsub token), D14
  (auto-rotation breach formula), D15 (cap range 20–40), D16 (Wilson +
  hard-complaint).
- **Conflict resolved (PRD vs brief):** PRD §5.8 said "All sends through
  Resend"; brief D2 selected Smartlead. Plan honors brief.
- **Conflict resolved (PRD vs brief):** PRD §5.1/§5.5 said "subdomain
  rotation + torched-root detection on lazerlending.com"; brief D1
  selected burner-domain pool. Plan honors brief.
- **Intentionally dropped:** Self-built warmup network (Smartlead bundled).
  Self-hosted MTA (out of scope at this volume). Per-campaign subdomain
  assignment (deferred — pool-based with manual override is simpler).

## Compliance & Data Retention

Lending-vertical replies regularly include sensitive PII (SSN fragments,
income, addresses, DOB). The CRM stores reply bodies and ships them to a
third-party LLM for classification. This must be architected consciously.

### Retention windows

- **Reply bodies:** retain 18 months by default for sales operations,
  then redact (keep classification + thread metadata, drop body text).
  Lazer compliance/legal must confirm or override.
- **Sends rows:** retain 24 months for deliverability audit.
- **Webhook events:** retain 90 days for replay/idempotency, then prune.
- **Lead PII:** retain per Lazer's own data-retention policy (TBD with client).
- **Suppression list:** retain indefinitely (CAN-SPAM compliance).

### LLM provider requirements

- LLM provider used by the classifier MUST have a no-train DPA. The Anthropic
  API and OpenAI Enterprise API both meet this; OpenAI standard API does
  NOT by default. Confirm before selecting `CLASSIFIER_PROVIDER`.
- Pre-LLM redaction: a lightweight regex-based redactor strips obvious SSN
  patterns (`\d{3}-\d{2}-\d{4}`), 16-digit card-like numbers, and 9-digit
  ITIN-like patterns before building the classifier prompt. The redactor is
  not perfect; the no-train DPA is the load-bearing safeguard.
- Classifier prompts and responses are not logged to third-party logging
  providers (Datadog, Sentry, etc.) without redaction.

### Forwarding & FUB push PII surface

- Forwarded reply emails to Lazer team include the raw reply body. This is
  internal-only mail; no third-party CC.
- FUB push includes the lead's identity and a sanitized reply summary, NOT
  the raw reply body. Operators view raw replies in our CRM, not in FUB.

### Auditability

- Every classification, forwarding, FUB push, and suppression action has an
  audit-log row with actor (system or user), timestamp, before/after values,
  and source event id.

## Webhook Idempotency Strategy

A new `webhook_events` table:

```text
webhook_events (
  id              uuid pk,
  provider        text  not null,             -- 'smartlead' (future: others)
  external_event_id text not null,
  event_type      text  not null,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz null,
  payload_hash    text  not null,
  unique (provider, external_event_id)
)
```

Receiver flow:

1. Verify signature. Reject 401 on mismatch.
2. INSERT INTO `webhook_events` (provider, external_event_id, event_type,
   payload_hash) ON CONFLICT (provider, external_event_id) DO NOTHING
   RETURNING id.
3. If no row inserted (conflict), short-circuit 200 OK — already processed.
4. Otherwise, dispatch to event handler (`delivery` or `reply`).
5. Handler updates the relevant `sends` / `replies` rows.
6. Receiver updates `webhook_events.processed_at = now()`.

This handles: vendor retries, duplicate deliveries, and replay attacks
within a sane window.

## Pacing & Concurrency

- **Per-mailbox concurrency = 1.** No parallel sends from the same mailbox.
  Enforced by the atomic UPDATE in `claimSendSlot`.
- **Inter-send pacing within a mailbox: owned by Smartlead.** Configure
  Smartlead's per-account daily limit and pacing in Smartlead. Our
  dispatcher submits whenever a slot is available; Smartlead times the
  actual SMTP send.
- **Cross-mailbox parallelism is fine.** Different mailboxes can dispatch
  concurrently.
- **Daily-cap reset:** A scheduled job runs at each mailbox's local
  midnight (per `mailbox.timezone`) and zeroes `today_sent_count`. The job
  is idempotent — running it twice in the same midnight produces the same
  state.
- **Stop-on-reply:** When a `reply` event lands and classification is in
  `{positive, neutral, ooo, unsubscribe}` OR (negative AND confidence > 0.8),
  cancel all queued future-step sends to that lead in that campaign. The
  exception (`negative` with low confidence) is to avoid a noisy classifier
  killing a sequence on one ambiguous reply.

## Domain & Mailbox State Machines

### Domain

```
provisioning → dns_pending → verifying → ready
        ↓           ↓             ↓        ↓
       failed    failed       failed    cooldown → retired
                                            ↑
                                       (auto-rotation
                                        or manual)
```

States:
- `provisioning`: Mailforge request fired.
- `dns_pending`: DNS records published but not yet propagated.
- `verifying`: Live DNS check running (DKIM, SPF, DMARC, RUA).
- `ready`: All authentication checks pass; eligible for mailbox creation.
- `cooldown`: All mailboxes on this domain paused; remaining campaigns
  reassigned. Cannot send for the cooldown window (default 14 days).
- `retired`: Permanent. Mailboxes still accept replies for the receive-tail
  window (default 30 days), then are decommissioned at Mailforge.
- `failed`: Provisioning or verification failed. Manual retry or abandon.

### Mailbox

```
provisioning → oauth_pending → warming → live
         ↓          ↓             ↓       ↓
        failed    failed        paused (auto or manual)
                                  ↑
                          (watchdog or smartlead 429
                           or manual)
```

States:
- `provisioning`: Mailforge request fired.
- `oauth_pending`: Mailbox exists at Mailforge; awaiting OAuth into Smartlead.
- `warming`: Smartlead warmup running. Hard-blocked from live sends.
- `live`: Eligible for live sends.
- `paused`: Excluded from `claimSendSlot`. `paused_reason` ∈ {`bounce_threshold`,
  `complaint_threshold`, `single_complaint_review`, `smartlead_rate_limit`,
  `dns_failure`, `manual`}.
- `failed`: Provisioning or OAuth failed. Manual retry or abandon.

## Delta Design

### Data / State Changes

**Existing (pending Phase 0 audit):** Connect CRM has campaigns, leads, sends,
settings, and (per PRD) some warmup state.

**Change (new tables):**
- `domains`: `id, hostname, provider, status, dns_spf_ok, dns_dkim_ok,
  dns_dmarc_ok, dmarc_policy, dmarc_rua, registrar, owner_entity,
  registered_at, retired_at, cooldown_until`.
- `mailboxes`: `id, domain_id, address, smartlead_account_id, oauth_status,
  warmup_state, daily_cap, today_sent_count, last_24h_bounce_rate,
  last_24h_complaint_rate, paused_reason, last_health_check_at, timezone`.
- `sending_pools`: `id, name`.
- `pool_memberships`: `pool_id, mailbox_id, PRIMARY KEY(pool_id, mailbox_id)`.
- `conversations`: `id, lead_id, mailbox_id, thread_id (provider's), started_at`.
- `campaign_steps`: `id, campaign_id, step_number, delay_days, subject_template,
  body_template`.
- `replies`: `id, lead_id, campaign_id, campaign_step_id, mailbox_id,
  conversation_id, in_reply_to_send_id (nullable), classification (nullable),
  classifier_confidence (nullable), classifier_error (nullable),
  classifier_rationale (nullable), language (nullable),
  raw_message_id, raw_thread_id, body_text, redacted_body_text,
  received_at, forwarded_to (nullable), forwarded_at (nullable),
  fub_pushed_at (nullable)`.
- `suppressions`: `id, email, email_normalized, reason, source_event_id, created_at`.
- `webhook_events`: see §Webhook Idempotency.
- `seed_inbox_checks` (v2): `id, campaign_id, results jsonb,
  placement_summary, checked_at_10min, checked_at_30min`.

**Change (modified tables):**
- `campaigns`: add `sending_pool_id`, `routing_rule_id`, `seed_inbox_set_id`
  (v2), `list_unsubscribe_template_id`.
- `leads`: add `email_normalized` (with unique index), `zerobounce_status`,
  `zerobounce_substatus`, `zerobounce_score`, `last_validated_at`,
  `fub_id (nullable)`, `unsubscribed_at`.
- `sends` (or create if absent): `id, lead_id, campaign_id, campaign_step_id,
  mailbox_id, conversation_id, smartlead_message_id, status, bounce_type,
  sent_at, delivered_at, complaint_at`. Status invariant: monotonic; terminal
  states (`delivered`, `bounced`, `complained`, `failed`) never co-exist on
  the same row.
- `settings`: new key namespace `lazer.*` covering all v1 knobs.

**Why:** Per-mailbox state is the granularity at which deliverability
decisions are made. Per-domain state is the granularity at which rotation
happens. Replies need their own table (or extension of an existing message
store) because they're an indirected, classifier-driven flow.

**Risks:** Migration path on `sends` if Connect CRM already has one with a
different shape. Phase 0 must compare and migrate cleanly. `email_normalized`
unique index requires backfill on existing leads.

### Entry Point / Integration Flow

**Existing:** Connect CRM presumably has a campaign-launch flow that ends
in a Resend send call.

**Change:**
- Replace the Resend-based dispatcher with a Smartlead-based dispatcher
  behind a `SendProvider` interface. Resend remains accessible only via
  the new `transactional/resend-client` for system mail.
- New entrypoints: `/api/webhooks/smartlead` (signed inbound),
  `/api/list-unsubscribe` (RFC 8058 POST), `/api/domains/*`,
  `/api/mailboxes/*`, `/api/replies/*`.
- All scheduled jobs hook into Connect CRM's existing job runner — TBD in
  Phase 0.

**Risks:** If Connect CRM hardcodes Resend in many places, the refactor is
larger than expected. Phase 0 quantifies this.

### Execution / Control Flow

**Existing:** Standard CRM request/response + some background jobs.

**Change (cold campaign launch flow):**
1. Operator clicks "Launch."
2. Pre-flight: validate sending pool has ≥1 live, non-paused mailbox; campaign
   has list-unsub config; (v2) seed-inbox check passes.
3. For each `(lead, campaign_step)` pair, enqueue ONE job at the appropriate
   send time. The mailbox claim happens inside the job, not at enqueue time.
4. Inside the job: check suppression, atomically claim a slot from the pool
   (utilization-ratio + jitter), call Smartlead.
5. Smartlead dispatch returns a `smartlead_message_id`; persist on `sends`.
6. Smartlead webhook later fires for each event; receiver verifies signature
   and idempotency, then dispatches to delivery or reply handler.

**Change (reply flow):**
1. Smartlead reply webhook → CRM verifies signature.
2. Idempotency-guard short-circuits duplicate events.
3. Persist reply + redact PII for LLM input.
4. Classifier runs (with failover behavior).
5. If `classification=unsubscribe`, insert into suppression list immediately.
6. Stop-on-reply: cancel queued future-step sends per §Pacing & Concurrency.
7. Router applies the campaign's routing rule and forwards to the configured
   team email (via IMAP redirect or Resend — see OQ).
8. If `classification=positive`, FUB sync: lookup by `email_normalized` →
   POST or PUT.

**Change (bounce-cascade flow):**
1. Smartlead delivery webhook with `event=email_bounced`,
   `bounce_type=hard`.
2. Idempotency check.
3. Update `sends.status='bounced'`, persist `bounce_type`.
4. Insert recipient into `suppressions(reason='bounce')`.
5. Cancel all queued future-step sends to that lead (across all campaigns).

**Change (mailbox watchdog flow):**
1. Hourly job aggregates last-24h bounce + complaint rates per mailbox using
   Wilson lower-bound at 95% confidence:
   `wilson_lower(p, n) = (p + z²/2n - z·sqrt((p(1-p) + z²/4n)/n)) / (1 + z²/n)`
   where `z=1.96`, `p=hits/attempted`, `n=attempted`.
2. Skip mailboxes with `attempted < 10`.
3. If Wilson-lower of bounce rate > 0.02, set `paused_reason='bounce_threshold'`.
4. If Wilson-lower of complaint rate > 0.001, set `paused_reason='complaint_threshold'`.
5. **Hard rule:** any single spam complaint sets
   `paused_reason='single_complaint_review'` regardless of rate.
6. Pause + alert via Resend; reroute live sends; pause campaign if pool exhausted.

**Change (daily reconcile flow):**
1. Daily job pulls Smartlead per-mailbox stats API (sent, bounced, complained).
2. Compare against local `sends` rollups for the same window.
3. For any mailbox with delta > 5%, fetch detailed event list from Smartlead
   and reconcile each `sends` row to its true state.
4. Log reconciliations to audit log.

**Risks:** Concurrency on `today_sent_count` — single atomic UPDATE solves
the SELECT-then-UPDATE race. Daily reset around midnight has a small race
window; the atomic UPDATE's `today_sent_count + 1 <= daily_cap` predicate
self-corrects.

### User-Facing / Operator-Facing Surface

**Existing:** Connect CRM presumably has campaigns, leads, settings UI.

**Change:**
- New pages: domains, mailboxes, replies inbox.
- Modified pages: dashboard (per-mailbox health cards), campaigns (sequence
  builder, sending-pool selector, routing rule selector, list-unsub
  template), settings (major expansion — see §Settings).

**Risks:** UI complexity. Mitigate by reusing Connect CRM's existing UI
patterns rather than introducing new component libraries.

### External / Operational Surface

**Existing:** Connect CRM Resend integration (presumed).

**Change:** New external dependencies:
- Smartlead Pro account + API key + webhook signing secret
- Mailforge account
- ZeroBounce account
- Follow Up Boss API key (Lazer-provided)
- Resend account + `notify.lazerlending.com` configured (transactional only)
- Burner domain registrations (initial set + spare inventory)
- DMARC RUA aggregator (Cloudflare DMARC Management free tier OR self-hosted)
- LLM provider with no-train DPA
- Seed-inbox accounts on Gmail/Outlook/Yahoo (v2)

## Implementation Blueprint

### Architecture Overview

```
                           ┌──────────────────────────────────┐
                           │  Lazer Lending CRM (custom build)│
                           │  (extends Connect CRM)           │
                           └──────────────┬───────────────────┘
                                          │
        ┌─────────────────────────────────┼─────────────────────────────────┐
        │                                 │                                 │
   Campaign launch                  Reply ingest                   Operator UI
   (per-step jobs)                  (signed + idempotent)           (settings, replies, etc.)
        │                                 │
        ▼                                 ▼
 ┌──────────────┐               ┌──────────────────┐
 │ Dispatcher   │ POST send     │ /api/webhooks/   │
 │ (atomic slot │──────────────▶│ smartlead        │
 │  + suppress) │               │  → idempotency   │
 └──────┬───────┘               │  → fanout        │
        │                       └────────┬─────────┘
        ▼                                │
 ┌──────────────┐               ┌────────┴─────────┐
 │ Smartlead    │               │ Reply handler    │   Delivery handler
 │ Pro API      │               │  → redact        │     → bounce-cascade
 └──────┬───────┘               │  → classify      │     → watchdog updates
        │ OAuth                 │  → router        │
        ▼                       │  → forwarder     │
 ┌──────────────────┐           │  → FUB if + or   │
 │ Burner-domain    │           │     reclassified │
 │ Workspace inboxes│           └──────────────────┘
 │ (Mailforge)      │
 └──────────────────┘

Side flows:
  • ZeroBounce: list upload + 60-day re-validation
  • Daily-cap reset: mailbox-local midnight
  • Mailbox watchdog: hourly Wilson-lower + hard-complaint rule
  • Daily reconcile: vs Smartlead stats API
  • DNS health monitor: per-domain DKIM/SPF/DMARC + RBL
  • DMARC RUA aggregator: collect aggregate reports per burner
  • DMARC ramp evaluator: nominate domains for `p=quarantine`
  • Seed-inbox placement check (v2): 10-min + 30-min retry
  • Auto-rotation (v2): pool-level cooldown on aggregate breach
  • Resend transactional: alerts to ops, internal notifications
```

### Key Pseudocode

#### Atomic mailbox-slot claim (with suppression check)

```typescript
// Goal: pick an eligible mailbox AND claim a daily slot in ONE atomic UPDATE.
// Postgres syntax shown; adapt to repo's actual SQL dialect/ORM in Phase 0.
async function claimSendSlot(poolId: string, recipientEmail: string): Promise<Mailbox> {
  // Suppression check: check inside same tx as claim, by normalized email.
  const norm = normalizeEmail(recipientEmail);

  return await db.tx(async (t) => {
    const suppressed = await t.suppressions
      .where({ email_normalized: norm })
      .first();
    if (suppressed) throw new RecipientSuppressed(norm, suppressed.reason);

    // Atomic UPDATE pattern:
    //   - Filters mailboxes via INNER JOIN on pool_memberships.
    //   - Locks one eligible row with FOR UPDATE SKIP LOCKED.
    //   - Increments today_sent_count in same statement.
    //   - Predicate enforces cap at write-time (race-safe).
    //   - Returns the picked row.
    const row = await t.raw(`
      WITH eligible AS (
        SELECT m.id
        FROM mailboxes m
        JOIN pool_memberships pm ON pm.mailbox_id = m.id
        WHERE pm.pool_id = $1
          AND m.warmup_state = 'live'
          AND m.paused_reason IS NULL
          AND m.today_sent_count < m.daily_cap
        ORDER BY (m.today_sent_count::float / m.daily_cap) ASC,
                 random() ASC
        LIMIT 1
        FOR UPDATE OF m SKIP LOCKED
      )
      UPDATE mailboxes m
      SET today_sent_count = today_sent_count + 1
      FROM eligible e
      WHERE m.id = e.id
        AND m.today_sent_count + 1 <= m.daily_cap
      RETURNING m.*;
    `, [poolId]);

    if (!row) throw new NoMailboxAvailable(poolId);
    return row;
  });
}
```

#### Mailbox watchdog (Wilson lower-bound + hard-complaint)

```typescript
// Goal: detect mailboxes whose 24h true rate (Wilson-lower) exceeds thresholds,
// AND flag any single spam complaint for manual review regardless of rate.
async function runMailboxWatchdog() {
  const z = 1.96;             // 95% confidence
  const minAttempted = 10;
  const bounceThreshold    = Number(process.env.WATCHDOG_BOUNCE_THRESHOLD    ?? 0.02);
  const complaintThreshold = Number(process.env.WATCHDOG_COMPLAINT_THRESHOLD ?? 0.001);

  // Use parameterized interval — never string-interpolate.
  const rows = await db.raw(`
    SELECT mailbox_id,
           COUNT(*) FILTER (WHERE sent_at IS NOT NULL)            AS attempted,
           COUNT(*) FILTER (WHERE status = 'bounced')             AS bounced,
           COUNT(*) FILTER (WHERE status = 'complained')          AS complained
    FROM sends
    WHERE sent_at > NOW() - $1::interval
    GROUP BY mailbox_id
  `, ['24 hours']);

  for (const r of rows) {
    if (r.attempted < minAttempted) continue;

    const wilsonLower = (hits: number, n: number) => {
      const p = hits / n;
      const num = p + (z*z) / (2*n) - z * Math.sqrt((p*(1 - p) + (z*z)/(4*n)) / n);
      return num / (1 + (z*z)/n);
    };

    const bounceLower    = wilsonLower(r.bounced,    r.attempted);
    const complaintLower = wilsonLower(r.complained, r.attempted);

    if (bounceLower > bounceThreshold) {
      await pauseMailbox(r.mailbox_id, { reason: 'bounce_threshold', bounceLower });
      await sendOpsAlert({ kind: 'mailbox_paused_bounce', mailbox: r.mailbox_id, bounceLower });
    } else if (complaintLower > complaintThreshold) {
      await pauseMailbox(r.mailbox_id, { reason: 'complaint_threshold', complaintLower });
      await sendOpsAlert({ kind: 'mailbox_paused_complaint', mailbox: r.mailbox_id, complaintLower });
    }

    // Hard rule: any single spam complaint sends mailbox to manual-review.
    if (r.complained >= 1 && complaintLower <= complaintThreshold) {
      await pauseMailbox(r.mailbox_id, { reason: 'single_complaint_review' });
      await sendOpsAlert({ kind: 'mailbox_complaint_review', mailbox: r.mailbox_id });
    }
  }
}
```

#### Reply classification (with failover)

```typescript
// Goal: classify reply with structured output + confidence + rationale.
// On error/timeout, leave classification null and flag for human review —
// never auto-route to FUB on classifier failure.
async function classifyReply(reply: Reply): Promise<Classification | null> {
  const redacted = redactPII(reply.body_text);

  // Detect language; fall back to human queue for non-English/non-Spanish.
  const lang = detectLanguage(redacted);
  if (lang !== 'en' && lang !== 'es') {
    return {
      label: null, confidence: 0, rationale: `unsupported_language=${lang}`,
      language: lang, requires_human_review: true,
    };
  }

  try {
    const result = await llm.complete({
      model: process.env.CLASSIFIER_MODEL,
      timeoutMs: 5000,
      system: classifierSystemPrompt(lang),
      user: `Subject: ${reply.subject}\nFrom: ${reply.from}\nBody:\n${redacted}`,
      response_format: { type: 'json_schema', schema: ClassificationSchema },
    });
    return { ...result, language: lang };
  } catch (err) {
    // Failover: persist null + error reason; surface in inbox; never auto-FUB.
    await replies.update({ id: reply.id }, {
      classifier_error: serializeError(err),
      requires_human_review: true,
    });
    return null;
  }
}

// IMPORTANT: classification === 'unsubscribe' triggers suppression-list
// insert, in addition to the RFC 8058 endpoint. "stop calling" and "remove
// me" patterns must never silently slip through.
async function applyClassification(reply: Reply, c: Classification | null) {
  if (!c) return;             // null = human review, no auto-action
  if (c.label === 'unsubscribe') {
    await suppressions.insertIfMissing({
      email_normalized: normalizeEmail(reply.from),
      reason: 'unsubscribe',
      source_event_id: reply.raw_message_id,
    });
  }
  // stop-on-reply: cancel queued future-step sends to this lead.
  if (c.label && (c.label !== 'negative' || c.confidence > 0.8)) {
    await stopOnReply.cancelFutureSteps(reply.lead_id, reply.campaign_id);
  }
  // route + forward + maybe FUB happen in router/forwarder/sync.
}
```

#### List-Unsubscribe (RFC 8058) — idempotent endpoint

```typescript
// Goal: handle Gmail's one-click unsubscribe POST.
// MUST be idempotent (Gmail prefetchers POST multiple times).
// MUST bypass framework CSRF; MUST be unauthenticated.
app.post('/api/list-unsubscribe', { csrf: false, auth: 'none' }, async (req, res) => {
  if (req.body['List-Unsubscribe'] !== 'One-Click') {
    return res.sendStatus(400);
  }
  const token = String(req.query.t ?? '');
  const ctx = verifyUnsubToken(token, process.env.LIST_UNSUB_TOKEN_SECRET!);
  if (!ctx) return res.sendStatus(404);
  if (ctx.expiry_unix < Date.now() / 1000) return res.sendStatus(404);

  // Idempotent: re-submits on already-suppressed return 200 OK.
  const norm = normalizeEmail(ctx.email);
  await suppressions.insertIfMissing({
    email: ctx.email,
    email_normalized: norm,
    reason: 'unsubscribe',
    source_event_id: `list-unsub:${ctx.lead_id}:${ctx.campaign_id}`,
  });
  await leads.update({ id: ctx.lead_id }, { unsubscribed_at: new Date() });
  return res.sendStatus(200);
});

function verifyUnsubToken(token: string, secret: string) {
  // Token format: base64url(json{lead_id, campaign_id, mailbox_id, expiry_unix}).hmac
  // Verify HMAC, then return parsed payload or null.
}
```

### Data Models and Structure

(See §Delta Design > Data / State Changes for the authoritative shape.
Logical TypeScript-style summary below; final ORM/dialect decided in Phase 0.)

```typescript
type Domain = {
  id: string;
  hostname: string;                                // 'lazer-loans.com'
  provider: 'mailforge' | 'direct';
  status: 'provisioning' | 'dns_pending' | 'verifying' | 'ready'
        | 'cooldown' | 'retired' | 'failed';
  dns_spf_ok: boolean;
  dns_dkim_ok: boolean;
  dns_dmarc_ok: boolean;
  dmarc_policy: 'none' | 'quarantine' | 'reject';
  dmarc_rua: string;                               // mailto URI for aggregate reports
  registrar: string;
  owner_entity: string;                            // 'lazer' or 'integrateapi'
  registered_at: Date;
  retired_at: Date | null;
  cooldown_until: Date | null;
};

type Mailbox = {
  id: string;
  domain_id: string;
  address: string;
  smartlead_account_id: string;
  oauth_status: 'pending' | 'connected' | 'failed';
  warmup_state: 'provisioning' | 'oauth_pending' | 'warming' | 'live'
              | 'paused' | 'failed';
  daily_cap: number;                               // 20–40, default 30
  today_sent_count: number;
  last_24h_bounce_rate: number;
  last_24h_complaint_rate: number;
  paused_reason: 'bounce_threshold' | 'complaint_threshold'
              | 'single_complaint_review' | 'smartlead_rate_limit'
              | 'dns_failure' | 'manual' | null;
  last_health_check_at: Date;
  timezone: string;                                // IANA, default 'America/Phoenix'
};

type Lead = {
  // Connect-CRM-inherited fields...
  email: string;
  email_normalized: string;                        // unique index
  zerobounce_status: 'valid' | 'invalid' | 'catch-all' | 'do-not-mail'
                  | 'spam-trap' | 'abuse' | null;
  zerobounce_substatus: string | null;
  zerobounce_score: number | null;
  last_validated_at: Date | null;
  fub_id: string | null;
  unsubscribed_at: Date | null;
};

type Send = {
  id: string;
  lead_id: string;
  campaign_id: string;
  campaign_step_id: string;
  mailbox_id: string;
  conversation_id: string;
  smartlead_message_id: string;
  status: 'queued' | 'sent' | 'delivered' | 'bounced' | 'complained' | 'failed';
  bounce_type: 'hard' | 'soft' | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  complaint_at: Date | null;
};

type Reply = {
  id: string;
  lead_id: string;
  campaign_id: string;
  campaign_step_id: string | null;
  mailbox_id: string;
  conversation_id: string;
  in_reply_to_send_id: string | null;
  classification: 'positive' | 'neutral' | 'ooo' | 'unsubscribe' | 'negative' | null;
  classifier_confidence: number | null;
  classifier_error: string | null;
  classifier_rationale: string | null;
  language: string | null;
  raw_message_id: string;
  raw_thread_id: string;
  body_text: string;
  redacted_body_text: string;
  received_at: Date;
  forwarded_to: string | null;
  forwarded_at: Date | null;
  fub_pushed_at: Date | null;
  requires_human_review: boolean;
};
```

### Tasks (in implementation order)

#### Phase 0 — Audit and Foundation

**Task 0.1: ~~Clone Connect CRM~~ + verify CODEBASE_ANALYSIS.md.**
- ~~Clone~~ already done (Connect CRM is checked into this repo).
- Walk through `CODEBASE_ANALYSIS.md` and verify it's current, not aspirational.
  Particular care: §3 (mock data), §4 (CRMContext), and `supabase/migrations/`
  contents (analysis says "no backend, no API calls, no database" — confirm
  Supabase is unused, or document what's there).
- Files: produce `docs/lazer-lending/CONNECT-CRM-AUDIT-DELTA.md` documenting
  any drift between the analysis doc and the live code.
- DoD: Drift doc complete. Open question: is `mcp-server/` load-bearing for
  Lazer or can we ignore it?

**Task 0.2: Lock the backend choice.**
- Default per this plan: Supabase (already configured in `supabase/`).
- DoD: Decision recorded. If Supabase: provision project, capture URL +
  anon key + service role into `.env.example`. If alternative chosen,
  document reasoning + new validation commands.

**Task 0.3: Provision sandbox external accounts + verify Smartlead webhook signing.**
- Goal: API keys in `.env.example`. Smoke-test calls succeed.
- DoD: All keys present in `.env.example`. **Smartlead webhook signing scheme +
  retry/idempotency contract documented in `docs/lazer-lending/VENDOR-CONTRACTS.md`.**
  Verified by sending a test event and inspecting headers.

**Task 0.4: Verify Bun + Vite + Vitest + Playwright dev loop.**
- DoD: `bun install`, `bun run dev` (port 8080), `bun run lint`, and
  `bun run test` all pass on a fresh checkout.

**Task 0.5: Client kickoff — close all Phase-1-blocking Open Questions.**
- Goal: Lock burner-domain naming, forwarding addresses, neutral-reply rule,
  OOO rule, compliance footer text, Workspace tenant ownership, DMARC ramp
  acceptance, classifier provider DPA, forwarder choice (Resend vs IMAP).
- DoD: All `[Phase 1 blocker]`-tagged Open Questions answered in writing.

**Task 0.6: Smoke-test 1 burner domain end-to-end via Mailforge.**
- Goal: Validate the provisioning path before Phase 1 code.
- DoD: 1 burner domain registered, DNS verified (SPF/DKIM/DMARC), 1 mailbox
  created, OAuth'd into Smartlead, warmup state set, all in <2 hours total
  including support latency.

**Task 0.7: Re-review this plan with `plan-reviewer` against the updated paths.**
- Goal: Catch issues that only become visible once Connect CRM specifics
  are known.
- DoD: Reviewer findings either applied or explicitly deferred.

#### Phase 1 — Send Layer + Warmup + Compliance

**Task 1.1: Define `SendProvider` interface; implement Smartlead client.**
- DoD: Sending a single test email through Smartlead returns a
  `smartlead_message_id` persisted in our `sends` table.

**Task 1.2: Domains + Mailboxes data model + APIs.**
- DoD: Operator can manually add a domain + Smartlead-known mailbox, see
  status reflected. State machines from §Domain & Mailbox State Machines
  enforced.

**Task 1.3: Mailforge integration for provisioning.**
- DoD: UI request → Mailforge provisions → mailboxes appear OAuth'd into
  Smartlead. Failure path: domain/mailbox sit in `failed` with manual-retry
  button.

**Task 1.4: Sending pools.**
- Files: CREATE `sending_pools` and `pool_memberships` tables.
- DoD: Campaign references a pool, not a specific mailbox.

**Task 1.5: Throttle guard + dispatcher (atomic claim + suppression check).**
- DoD: Stress test of N>cap concurrent jobs results in exactly `cap` sends
  succeeding. Suppression check inside the claim transaction verified
  (just-suppressed lead does not receive a queued send).

**Task 1.5a: Smartlead rate-limit handler.**
- DoD: On Smartlead 429, mailbox enters `paused_reason='smartlead_rate_limit'`,
  ops alert fires, no retries today on that mailbox.

**Task 1.6: ZeroBounce client + list upload validation.**
- DoD: Test list with known-bad rows produces rejection report and clean
  lead set. Lead persists `zerobounce_status` + `substatus` + `score`. The
  dispatcher gates sends based on settings policy per sub-status.

**Task 1.7: Just-in-time re-validation job.**
- DoD: Lead with `last_validated_at > 60 days` gets re-validated when added
  to a campaign.

**Task 1.8: Smartlead webhook receiver (top-level dispatcher).**
- Files: CREATE `replies/webhook-receiver.[ext]` with signature verification
  and dispatch to delivery/reply handlers.
- DoD: Test event fires; signature verification rejects unsigned payloads.

**Task 1.8a: Webhook idempotency guard.**
- Files: CREATE `webhook_events` table + `replies/idempotency-guard.[ext]`.
- DoD: Replayed webhook event short-circuits 200 OK without dispatching to
  handlers.

**Task 1.8b: Bounce-cascade.**
- Files: CREATE `send/bounce-cascade.[ext]`.
- DoD: Hard bounce → recipient suppressed + queued future-step sends
  cancelled across all campaigns.

**Task 1.9: List-Unsubscribe RFC 8058 endpoint + suppression list.**
- DoD:
  - Endpoint accepts POST, no auth, no CSRF.
  - Idempotent (re-submits return 200 OK).
  - Token is HMAC; expiry enforced.
  - Raw-MIME inspection of a Smartlead-dispatched message confirms BOTH
    `<https://...>` AND `<mailto:...>` URI variants AND
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header.
  - If Smartlead does not auto-emit, headers are injected via Smartlead
    per-campaign custom-header support.

**Task 1.10: Resend transactional client + ops alert plumbing.**
- DoD: Test "mailbox paused" alert email arrives at the configured ops
  address from `notify.lazerlending.com`.

**Task 1.11: Per-mailbox health watchdog job (Wilson + hard-complaint).**
- DoD: Simulated bounce-rate spike auto-pauses mailbox within one watchdog
  interval. A single simulated complaint sends mailbox to
  `single_complaint_review` regardless of rate.

**Task 1.12: DNS health monitor.**
- DoD: Domain with broken DKIM (deliberately removed TXT) flagged red on
  dashboard within one job run. DKIM check verifies the selector currently
  signing outgoing mail (not a static expected value).

**Task 1.12a: DMARC RUA aggregator + ramp evaluator.**
- Goal: Collect DMARC aggregate reports per burner; nominate domains for
  `p=quarantine` after 4–6 weeks of clean reports.
- DoD: For each burner, `rua=mailto:dmarc@<aggregator>` is configured. The
  aggregator (Cloudflare DMARC Management free tier OR self-hosted parser)
  ingests reports. UI flag "ready to ramp" appears on domains with 4+ weeks
  of no auth-failure reports.

**Task 1.13: Daily reconcile job (vs Smartlead stats).**
- DoD: Run against deliberately stale local `sends` state corrects rows to
  match Smartlead vendor truth. Reconciliations logged to audit log.

**Task 1.14 (was Phase 2): Audit Connect CRM's existing warmup module.**
- DoD: Decision recorded in `docs/connect-crm-warmup-audit.md`: reuse,
  replace, or adapt.

**Task 1.15 (was Phase 2): Adopt Smartlead built-in warmup as primary.**
- DoD: New mailboxes hard-blocked from live sends until Smartlead warmup-
  ready. UI surfaces state.

**Task 1.16 (was Phase 2): Continuous low-volume warmup post-go-live.**
- DoD: A live mailbox shows both real campaign sends and warmup engagement
  in Smartlead.

**Task 1.17: Daily-cap reset job.**
- DoD: Job runs at each mailbox's local midnight (per `mailbox.timezone`)
  and zeroes `today_sent_count`. Idempotent.

**Phase 1 acceptance:** v1.SC1, v1.SC2, v1.SC3, v1.SC7, v1.SC8, v1.SC9,
v1.SC10, v1.SC11.

#### Phase 2 — Reply Handling and FUB

**Task 2.1: Reply ingest from Smartlead webhook (reply event handler).**
- DoD: Reply to a sent email appears in `replies` table within seconds.
  Linked to the originating `Send` via `in_reply_to_send_id` (derived from
  `In-Reply-To`/`References` headers; falls back to most-recent send to that
  lead in that mailbox).

**Task 2.2: LLM classifier with failover.**
- DoD: Test reply set (positive / OOO / negative / Spanish samples)
  classifies with ≥90% accuracy on the eval set. Classifier timeout/error
  produces `classification=null`, `requires_human_review=true`, no auto-FUB
  push. `classification=unsubscribe` triggers suppression-list insert.

**Task 2.3: Routing + forwarding.**
- DoD: A positive reply on a campaign with `route_to=sam@lazer.com` results
  in a forwarded email to that address. Forwarder choice (Resend vs IMAP
  redirect) per Task 0.5 OQ resolution.

**Task 2.4: FUB client.**
- DoD: Smoke test calls succeed against FUB sandbox.

**Task 2.5: Positive-reply → FUB sync (with email normalization).**
- DoD: Positive reply produces exactly one FUB person record using
  `email_normalized` (lowercase + plus-tag stripped + Gmail dot-insensitive);
  second positive on same lead updates tags only.

**Task 2.6: Replies inbox UI + manual reclassify + manual FUB push.**
- DoD: Operator can change classification on a reply. Manual reclassify
  `neutral → positive` triggers the same FUB push path as auto-classify
  (with same dedup logic).

**Task 2.7: Stop-on-reply enforcement.**
- DoD: Reply to step 1 cancels all queued sends for steps 2..N to that
  lead in that campaign. Exception: `negative` with confidence ≤ 0.8 does
  NOT stop the sequence (low-conf negatives are noisy).

**Phase 2 acceptance:** v1.SC4, v1.SC5.

#### Phase 3 — Spam Placement Monitoring (v2)

**Task 3.1: Seed inbox configuration UI.**
- DoD: 3+ seed inboxes saved with provider tags + IMAP/Gmail-API credentials
  (encrypted at rest).

**Task 3.2: Pre-launch placement test.**
- DoD: Campaign with deliberately spammy copy auto-pauses on placement check.
  Initial check at 10 min, retry at 30 min, all seeds must respond before
  scoring.

**Phase 3 acceptance:** v2.SC1.

#### Phase 4 — Auto-Rotation and Routine Domain Retirement (v2)

**Task 4.1: Aggregate domain-level health.**
- DoD: Roll mailbox-level signals up to the domain.

**Task 4.2: Auto-rotation trigger logic.**
- DoD: Simulated breach matching either of the two trigger conditions
  (≥50% mailboxes paused in 24h, or aggregate domain complaint >0.1% over
  7d) puts the domain in cooldown; mailboxes pause; in-flight campaigns
  rebalance.

**Task 4.3: Routine domain-retirement flow.**
- DoD: Retired-domain mailboxes accept replies for the receive-tail window
  (default 30 days) but cannot be selected for sends.

**Phase 4 acceptance:** v2.SC2.

### Integration Points

- **Data / schema source of truth:** TBD Phase 0.
- **Entry points to extend:** Connect CRM HTTP routes + job runner.
- **Validation layer:** Connect CRM validation library (TBD); reuse.
- **Domain / service layer:** Add `send/`, `infra/`, `validate/`, `replies/`,
  `fub/`, `transactional/`, `deliverability/` modules under existing
  services dir.
- **User-facing surface:** New pages: domains, mailboxes, replies. Modified:
  dashboard, campaigns, leads, settings.
- **Shared types / export hubs:** TBD Phase 0.
- **External / operational hooks:**
  - Cron/jobs: ZeroBounce re-validation (daily), mailbox watchdog (hourly),
    daily reconcile, daily-cap reset (mailbox-local midnight), DNS health
    (daily), DMARC ramp evaluator (daily), seed placement (on launch),
    auto-rotation (hourly).
  - Webhooks ingress: `/api/webhooks/smartlead` (Smartlead),
    `/api/dmarc-rua` (if self-hosting RUA receiver).
  - Public POST: `/api/list-unsubscribe`.
  - External APIs egress: Smartlead, Mailforge, ZeroBounce, FUB, Resend,
    LLM provider, DMARC aggregator (if external).

## Settings Panel Scope

1. **Domains pool** — list, status, DKIM/SPF/DMARC indicators, ramp-eligible
   flag, retire button.
2. **Mailboxes pool** — list per domain, OAuth status, warmup state, today's
   send count, daily cap, last-24h Wilson bounce/complaint, manual-review
   flag, pause/resume.
3. **Sending pools** — name, member mailboxes (via `pool_memberships`).
4. **ZeroBounce** — API key, credit balance, validation policy per
   sub-status (drop catch-all? do-not-mail? policy applied at upload AND
   dispatch).
5. **Smartlead** — API key, webhook signing secret, default warmup config,
   per-mailbox pacing override (read-only display; truth lives in Smartlead).
6. **Mailforge** — API key, current bundle, "request N new mailboxes" button.
7. **Resend** — API key, transactional sending domain (default
   `notify.lazerlending.com`).
8. **Follow Up Boss** — API key, default pipeline, default stage, dedup
   behavior toggle.
9. **Reply forwarding** — forwarder mode (`imap_redirect` | `resend`),
   default team email, per-campaign override editing UI, classifier model
   selector.
10. **Seed inbox set (v2)** — list with provider tags + encrypted creds.
11. **Alerts** — ops alert email, alert categories enabled.
12. **Compliance** — list-unsub URL template, mailing footer template
    (CAN-SPAM physical address, NMLS/state-licensing language placeholder
    — actual content per legal).
13. **Data retention** — reply body retention window (default 18mo), audit
    log retention (default 24mo), webhook events retention (default 90d).

## Environment Variables (`.env.example`)

```bash
# --- Vendor: Smartlead ---
SMARTLEAD_API_KEY=
SMARTLEAD_WEBHOOK_SIGNING_SECRET=
SMARTLEAD_BASE_URL=https://server.smartlead.ai/api/v1

# --- Vendor: Mailforge ---
MAILFORGE_API_KEY=
MAILFORGE_BASE_URL=
MAILFORGE_DEFAULT_BUNDLE=

# --- Vendor: ZeroBounce ---
ZEROBOUNCE_API_KEY=
ZEROBOUNCE_BASE_URL=https://api.zerobounce.net/v2

# --- Vendor: Follow Up Boss ---
FUB_API_KEY=
FUB_BASE_URL=https://api.followupboss.com/v1
FUB_DEFAULT_PIPELINE_ID=
FUB_DEFAULT_STAGE_ID=

# --- Vendor: Resend (transactional only) ---
RESEND_API_KEY=
RESEND_TRANSACTIONAL_DOMAIN=notify.lazerlending.com
RESEND_FROM_DEFAULT="Lazer CRM <ops@notify.lazerlending.com>"

# --- LLM (reply classifier) — must have no-train DPA ---
CLASSIFIER_PROVIDER=anthropic
CLASSIFIER_MODEL=
CLASSIFIER_API_KEY=

# --- DMARC RUA aggregator ---
DMARC_RUA_PROVIDER=cloudflare       # cloudflare | self_hosted | dmarcian
DMARC_RUA_ENDPOINT=                 # if self_hosted: where reports POST

# --- App ---
APP_BASE_URL=
LIST_UNSUB_TOKEN_SECRET=            # for HMAC over (lead,campaign,mailbox,expiry)
LIST_UNSUB_TOKEN_TTL_DAYS=180
OPS_ALERT_EMAIL=
DEFAULT_REPLY_FORWARD_EMAIL=
FORWARDER_MODE=imap_redirect        # imap_redirect | resend
DEFAULT_MAILBOX_TIMEZONE=America/Phoenix

# --- Watchdog thresholds ---
WATCHDOG_BOUNCE_THRESHOLD=0.02
WATCHDOG_COMPLAINT_THRESHOLD=0.001
WATCHDOG_MIN_ATTEMPTED=10
DEFAULT_MAILBOX_DAILY_CAP=30

# --- Connect CRM-inherited (TBD Phase 0) ---
# DATABASE_URL=...
# REDIS_URL=...
```

## Validation

Connect CRM uses Bun + Vite + Vitest. Concrete commands:

```bash
bun install                  # install deps
bun run lint                 # ESLint (eslint.config.js)
bun run typecheck            # tsc --noEmit (verify in package.json scripts)
bun run test                 # Vitest
bun run dev                  # Vite dev server, port 8080
bunx supabase migration up   # apply migrations (verify exact subcommand vs project state)
```

Verify the `package.json` scripts before relying on these names — the
`tsconfig.json` and `tsconfig.app.json` define the typecheck targets, and
the Vitest config is at `vitest.config.ts`.

### Factuality Checks

- `Verified Repo Truths` only contains the PRD reference and the deferred-
  audit acknowledgement; no invented Connect CRM paths.
- All `[path TBD]` markers are explicit.
- All MODIFY entries in the file tree are stack-agnostic logical units.
- Pseudocode uses parameterized SQL intervals (no string interpolation).

### Manual Checks

- **Scenario:** Operator uploads a CSV of 50 leads with 10 known-invalid emails.
  **Expected:** ZeroBounce flags the 10 with sub-status; valid leads load
  with `email_normalized`; rejection report downloadable.

- **Scenario:** Two concurrent jobs each try to send the 31st email of the
  day from a mailbox with cap 30.
  **Expected:** Exactly one succeeds; the other gets `NoMailboxAvailable`.

- **Scenario:** A test reply with body "Sounds great, send a calendar link"
  is delivered to a sending mailbox.
  **Expected:** Within 30s, reply appears classified as `positive`,
  forwarded to the configured team email, pushed to FUB (deduped via
  `email_normalized`). Stop-on-reply cancels queued future-step sends.

- **Scenario:** A test reply with body "Stop calling me, remove me from your list"
  is delivered.
  **Expected:** Classified as `unsubscribe`; suppression-list insert; stop-
  on-reply cancels future-step sends; never pushed to FUB.

- **Scenario:** A test reply in Spanish ("Estoy interesado, llámeme") is delivered.
  **Expected:** Language detected as `es`; classified positive; routed and
  pushed to FUB normally.

- **Scenario:** A test reply in Italian is delivered.
  **Expected:** Language detected as `it`; classification null;
  `requires_human_review=true`; surfaced in inbox; never auto-pushed.

- **Scenario:** Smartlead delivers the same `reply` event twice (vendor retry).
  **Expected:** First event processed; second short-circuited 200 OK; one
  classifier invocation; one forwarded email; one FUB push.

- **Scenario:** Simulated bounce-rate spike on mailbox A: 3 hard bounces
  out of 50 sends in 24h (Wilson lower 0.013 — below threshold).
  **Expected:** Mailbox A NOT auto-paused on rate; the 3 affected recipients
  ARE individually suppressed; future-step sends to those leads cancelled.

- **Scenario:** Mailbox A: 1 spam complaint in 24h.
  **Expected:** Mailbox enters `single_complaint_review` regardless of rate.

- **Scenario:** Mailbox A: bounce rate Wilson lower exceeds 2%.
  **Expected:** Mailbox auto-paused; ops alert fires from
  `notify.lazerlending.com`.

- **Scenario:** Operator clicks "Retire `lazer-loans.com`."
  **Expected:** Mailboxes stop being eligible for new sends within 60s;
  in-flight campaign tasks reroute or pause; replies still ingested for 30
  days; domain auto-decommissions at Mailforge after window.

- **Scenario:** Daily reconcile job runs while local DB shows mailbox B has
  100 sends today but Smartlead reports 102.
  **Expected:** Reconcile fetches detailed event list; corrects 2 missing
  rows; logs reconciliation.

## Open Questions

Each tagged with the phase it gates:

1. **[Phase 1 blocker]** Burner-domain naming convention. Confirm with Lazer
   (`lazer-loans.com`, `getlazerloans.com`, `team-lazer.com`,
   `trylazerlending.com` — verify availability). Who legally owns?
2. **[Phase 1 blocker]** Reply forwarding default address(es). Single team
   email or multiple? Per-campaign override at v1 expected (default in plan)?
3. **[Phase 1 blocker]** Forwarder mode: **IMAP redirect** (forward replies
   from the originating Workspace mailbox itself, no Resend AUP exposure)
   OR **Resend forward** (forward via `notify.lazerlending.com`, simpler
   but bleeds prospect-text PII into Resend's complaint exposure)?
   Plan default: IMAP redirect.
4. **[Phase 1 blocker]** Neutral-reply rule for FUB. Plan default: human tag
   required before push. Confirm.
5. **[Phase 1 blocker]** OOO rule. Plan default: never push to FUB; auto-
   snooze if return-date parseable. Confirm.
6. **[Phase 1 blocker]** Compliance footer text — state-specific lending
   disclosures, NMLS, licensing. Lazer compliance/legal supplies exact strings.
7. **[Phase 1 blocker]** Lazer's existing `lazerlending.com` Workspace tenant.
   Does it exist? Should `notify.lazerlending.com` Resend records share that
   tenant or be independent?
8. **[Phase 1 blocker]** DMARC ramp policy acceptance: `p=none` first 4–6
   weeks per burner, then `p=quarantine`. Confirm timeline.
9. **[Phase 1 blocker]** LLM provider with no-train DPA — Anthropic API
   default. OpenAI Enterprise also acceptable; OpenAI standard API not
   acceptable. Confirm choice.
10. **[Phase 1 blocker]** Reply body retention window. Plan default: 18
    months then redact. Lazer compliance/legal confirms.
11. **[Phase 3 blocker]** Seed inbox ownership. IntegrateAPI or Lazer?
12. **[Post-launch]** Smartlead outage contingency. Plan default: accept
    temporary downtime; `SendProvider` interface justifies future-proofing
    only, not active dual-vendor.
13. **[Phase 1, soft]** Volume ramp expectations. When does Lazer want to
    attempt 500/day? 1,000/day? Tied to inventory expansion, not calendar.

## Final Validation Checklist

- [ ] Phase 0 audit completed and this plan updated with concrete
      Connect-CRM paths.
- [ ] No `[path TBD]` markers remain after Phase 0.
- [ ] Plan re-reviewed by `plan-reviewer` after Phase 0 completes.
- [ ] All Phase-1-blocker Open Questions answered before Phase 1.
- [ ] All success criteria verified manually before declaring v1 done.
- [ ] Resend transactional sends originate only from `notify.lazerlending.com`.
- [ ] No cold campaign send originates from `lazerlending.com` (root or any
      brand-root subdomain).
- [ ] List-Unsubscribe `<https://...>` AND `<mailto:...>` AND
      `List-Unsubscribe-Post: List-Unsubscribe=One-Click` confirmed by
      raw-MIME inspection.
- [ ] List-Unsubscribe endpoint idempotent (re-submits return 200).
- [ ] List-Unsubscribe endpoint bypasses CSRF and is unauthenticated.
- [ ] DMARC `p=none` + `rua` configured on every burner at launch;
      aggregate-report aggregator receiving reports.
- [ ] `dmarc-ramp-evaluator` job functional.
- [ ] All vendor API keys are in `.env`, never in code or fixtures.
- [ ] Smartlead webhook signature verification rejects unsigned payloads.
- [ ] Webhook idempotency by `(provider, external_event_id)` enforced.
- [ ] Suppression list checked at enqueue AND inside dispatcher claim
      transaction.
- [ ] Daily-cap reset job runs at mailbox-local midnight per
      `mailbox.timezone`.
- [ ] Watchdog uses Wilson lower-bound + hard-complaint escape hatch.
- [ ] Daily reconcile job runs and corrects vs Smartlead truth.
- [ ] `email_normalized` populated and unique-indexed; FUB lookup uses it.
- [ ] Hard bounce → global suppression + future-step cancellation verified.
- [ ] Stop-on-reply verified across positive/neutral/OOO/unsubscribe paths.
- [ ] Classifier failover (timeout/error → null + flag) verified.
- [ ] Non-English/Spanish replies routed to human review (not auto-FUB).
- [ ] LLM provider has no-train DPA (per Open Question 9).
- [ ] PII redactor runs before LLM input.
- [ ] Reply body retention window enforced by background job.

## Deprecated / Removed Code

- Connect CRM's Resend-as-cold-sender code path (if present) is removed.
  Resend stays only via `transactional/resend-client.[ext]`.
- Connect CRM's existing warmup module is removed or downgraded to a thin
  Smartlead pass-through, depending on Task 1.14 audit outcome.
- Any subdomain-rotation-on-`lazerlending.com` plumbing in Connect CRM
  (if present) is removed.

## Anti-Patterns to Avoid

- Cold mail through Resend, even "for testing." Use Smartlead from day 1.
- Cold mail from `lazerlending.com` or any of its subdomains.
- Treating Smartlead as a CRM. We use it as a send + warmup engine; lead
  lists, sequences, and replies are owned by our CRM.
- Inventing new Connect CRM file paths in code before Phase 0 verifies the
  real ones.
- Catching all errors generically — be specific (`Bounced`, `RateLimited`,
  `WebhookSignatureMismatch`, `MailforgeProvisioningPending`,
  `RecipientSuppressed`, `NoMailboxAvailable`, `ClassifierTimeout`).
- Hardcoding daily caps, thresholds, vendor URLs, or timezones — use env
  or settings.
- Mixing concurrency primitives in the dispatcher (stack-specific —
  whichever Connect CRM uses, do not introduce a second).
- String-interpolating SQL intervals (`INTERVAL '${x}'`). Use parameters.
- Logging raw reply bodies to third-party logging providers without
  redaction.
- Pushing the raw reply body to FUB.
- Skipping the suppression check inside the claim transaction (just
  checking at enqueue is not sufficient).
- Single-use list-unsub tokens (Gmail prefetchers POST multiple times).
- Trusting webhook events without signature + idempotency check.

## Confidence Score

**One-pass implementation confidence: 7/10** (raised from 6/10 in plan v1
after reviewer-pass incorporation).

Strong on: architecture, decision rationale, integration surface, risk
inventory, idempotency model, deliverability compliance, data retention
policy.

Limited by:
- Connect CRM stack and existing patterns are not yet known. Phase 0 is
  effectively "complete the plan." Expect Phase 0 to take 1–3 days and to
  update this plan in place before Phase 1 starts.
- **Re-review gate:** Plan must be re-reviewed by `plan-reviewer` after
  Phase 0's audit doc lands and replaces all `[path TBD]` markers, before
  Phase 1 work begins.
- Smartlead/Mailforge API specifics need first-hand verification.
- LLM classifier accuracy depends on prompt + eval set authoring effort.

Score climbs to 9/10 after Phase 0's audit doc lands and the post-Phase-0
re-review pass clears.

---
