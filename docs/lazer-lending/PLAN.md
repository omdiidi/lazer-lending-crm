# Lazer Lending CRM — Implementation Plan

**Date:** 2026-04-30 (v2.1) → 2026-05-01 (v2.5)
**Author:** IntegrateAPI (Nick Pardon, w/ Claude review)
**Client:** Lazer Lending
**Base codebase:** Connect CRM — `https://github.com/nkpardon8-prog/connect-crm`
**Status:** Connect CRM cloned into the repo. Stack confirmed and audited via Connect CRM's own `CODEBASE_ANALYSIS.md`. **Plan v2.5** — incorporates 4-lens feasibility audit (`tmp/review-notes/2026-05-01-codex-feasibility-audit.md`) and external research validation (`tmp/research/2026-05-01-feasibility-validation.md`, ~80 sources). Supersedes v2.1 (April 30 reviewer-pass merge). Source-of-truth hierarchy defined in `tmp/ready-plans/2026-05-01-doc-cleanup-v2.5.md`.
**Re-review gate:** v2.5 audit complete. Another `plan-reviewer` pass is required only if Phase 0.3 vendor-contract verification (Smartlead webhook signing, Mailforge tenant isolation, Saleshandy webhook capability) surfaces new architecture changes. Run before any Phase 1 work begins.

---

## Stack (verified by post-clone audit, 2026-04-30)

- **Frontend:** React 18 + TypeScript + Vite (SWC), Tailwind 3, shadcn/ui (49 Radix-based components), React Router v6, **`@tanstack/react-query` actively used** (16 hooks under `src/hooks/use-*.ts`), Auth via Supabase (`AuthContext` wired to real auth — not the mock placeholder previously documented).
- **Backend:** **Supabase wired (per CONNECT-CRM-AUDIT-DELTA.md, 2026-05-01).** 22 edge functions + 8 migrations exist; 19 src files import `@/lib/supabase` or `@/lib/api/*`. The original `CODEBASE_ANALYSIS.md` (2026-04-30) is materially out of date — see CONNECT-CRM-AUDIT-DELTA.md §1 for verified state.
- **Data layer:** Real Supabase client (`src/lib/supabase.ts`) + per-entity data-access modules in `src/lib/api/` (21 modules) + per-entity TanStack Query hooks in `src/hooks/`. `src/data/mockData.ts` and `src/contexts/CRMContext.tsx` **do not exist** — both removed when Supabase wiring landed (per CONNECT-CRM-AUDIT-DELTA.md §1). Type definitions at `src/types/crm.ts` (247 lines) plus auto-generated Supabase types at `src/types/database.ts` (1,032 lines).
- **Package manager:** Bun (`bun.lock` + `bun.lockb`).
- **Build/test:** Vite + Vitest + Playwright (minimal coverage today).
- **Deployment:** Netlify (`netlify.toml`).
- **MCP server:** Connect CRM ships an `mcp-server/` directory — scope to investigate in Phase 0.
- **Vendor pricing reality (per research §Q2):** Mailforge standard tier is **$3/mailbox/month** (annual, 10-slot minimum). The `$1.67/mailbox` figure cited in v2.1 is a volume-discount tier requiring 50+ mailboxes — not applicable at v1 inventory of 5–10. Cost floor revised accordingly.

## Critical finding: Connect CRM scaffold has Supabase wired — extend, do not "build the backend"

> **Superseded by CONNECT-CRM-AUDIT-DELTA.md (2026-05-01).** The earlier statement that Connect CRM is "100% client-side with mock data" was based on `CODEBASE_ANALYSIS.md` (2026-04-30), which is materially out of date. The audit-delta verifies that Supabase IS wired (22 edge functions, 8 migrations, 21 data-access modules, 16 TanStack Query hooks, real `AuthContext`) and that `src/data/mockData.ts` + `src/contexts/CRMContext.tsx` no longer exist.

**Phase 1 scope is to EXTEND existing Supabase schema/edge-functions/hooks** (not "build the backend" — that's done). New surfaces (domains, mailboxes, sending pools, replies, webhook_events, suppressions, ccpa_requests, mailbox_slot_reservations) are additive: new migrations on top of the existing 8, new edge functions alongside the existing 22, new data-access modules in `src/lib/api/`, new TanStack Query hooks in `src/hooks/`, new pages in `src/pages/`. Existing pages are extended (per CONNECT-CRM-AUDIT-DELTA.md §3).

The PRD's claim that "Connect CRM has warmup logic built in" (PRD §5.2) was UI-mock language; `supabase/functions/_shared/warmup.ts` exists as a helper but Phase 0.1 must verify whether it is functional or stub. Smartlead's bundled warmup is the v1 implementation regardless.

---

## Goal

Ship a Lazer-branded cold-outreach CRM that meets the seven core outcomes from
the PRD: safe high-volume cold campaigns, lead validation, deliverability
protection, reply capture/classification/routing, positive-reply forwarding,
qualified-only push to Follow Up Boss, and aggressive deliverability defense.
The CRM is built in-house on top of Connect CRM. The cold sending layer is
vendored to Smartlead Pro. The mailbox/domain inventory is vendored to
Mailforge. The brand domain `lazerlending.com` is never used to send cold mail.

Additional v2.5 commitments (per research §Q3 NMLS + CCPA findings):

- **Per-recipient-state compliance footer** assembled dynamically with 10+ state variants (CA, NY, FL, NJ, TX, MA, MD, IL, AZ, CT) plus federal floor. A single global footer is non-compliant for residential mortgage cold mail.
- **CCPA right-to-delete flow** over prospect records. The GLBA-blanket-exemption assumption from v2.1 was wrong: GLBA exemption is data-level, not entity-level. Pre-application prospect records are subject to CCPA delete (Cal. Civ. Code § 1798.105, 45-day SLA).

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
domain-rotation flow that replaces the PRD's "torched root" emergency;
(9) **hot-standby mailbox provisioning** ($25–85/mo for 5 pre-warmed
accounts via Litemail/EmailAstra/Infraforge) converting Mailforge-failure
recovery from 7–10 weeks cold to 24–72 hours (per research §Q2);
(10) **auth + RBAC layer** for the operator UI — Connect CRM's mock
`AuthContext` is a UI placeholder, not a working sign-in system, and reply
bodies contain lending PII that requires role-gated access (per audit
Gaps lens); (11) **suppression-list seed-import** from Lazer's existing
FUB and legacy unsubscribe records BEFORE campaign #1 (per audit Gaps lens).
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
- Per-mailbox daily-send limit (configurable 15–25, default 20 — per Locked Decision 19).
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

> **Source of truth: `docs/lazer-lending/CONNECT-CRM-AUDIT-DELTA.md` (2026-05-01).** All facts below verified against live code. The original `CODEBASE_ANALYSIS.md` (2026-04-30) is `[superseded]` — its "100% client-side mock data" claim was correct at the time of writing but the upstream Connect CRM repo has since been wired to Supabase.

- **Fact:** Connect CRM is a Supabase-wired React/TypeScript SPA. `[superseded]` claim from CODEBASE_ANALYSIS.md (2026-04-30): "100% client-side mock data" — incorrect as of 2026-05-01.
  Evidence: CONNECT-CRM-AUDIT-DELTA.md §1 — `src/lib/supabase.ts` instantiates a real client; 19 src files import `@/lib/supabase` or `@/lib/api/*`; 22 edge functions + 8 migrations.
  Implication: The implementer is **extending** the backend, not building one.

- **Fact:** Stack is React 18 + Vite (SWC) + TypeScript + Tailwind + shadcn/ui + React Router v6 + TanStack Query + Bun.
  Evidence: `package.json`; `vite.config.ts`; `bun.lock`; `tailwind.config.ts`; `components.json`; CONNECT-CRM-AUDIT-DELTA.md §1.

- **Fact:** Type definitions live in `src/types/crm.ts` (247 lines) and define User, Lead, Activity, EmailMessage, Deal, EmailSequence, SequenceStep, AISuggestion, Campaign, plus newer entities (CampaignEnrollment, CampaignTemplate, Unsubscribe, SearchHistory, Todo, Project, TodoComment, TodoActivityEntry, TodoColumn). Auto-generated Supabase types at `src/types/database.ts` (1,032 lines).
  Evidence: CONNECT-CRM-AUDIT-DELTA.md §1, §2.

- **Fact:** `[superseded]` claim from CODEBASE_ANALYSIS.md (2026-04-30): "Mock data is in `src/data/mockData.ts`; mutations go through `src/contexts/CRMContext.tsx`." Both files **do not exist** in current code. State is managed via TanStack Query hooks (`src/hooks/use-*.ts`) against Supabase.
  Evidence: CONNECT-CRM-AUDIT-DELTA.md §1 (rows for `mockData.ts` and `CRMContext.tsx`).
  Implication: PLAN.md Task 1.0a's "swap mock-array reads" framing is moot — that swap already happened upstream.

- **Fact:** Connect CRM includes a `supabase/` directory with `config.toml`, 8 migrations, and 22 edge functions, all of which are actively wired into the React app via `src/lib/api/*` (21 modules) and `src/hooks/*` (16 hooks).
  Evidence: directory listing; CONNECT-CRM-AUDIT-DELTA.md §2.
  Implication: Supabase is the live backend; Lazer extends rather than provisions from scratch.

- **Fact:** Connect CRM ships a `mcp-server/` directory with its own `package.json` (`@connect-crm/mcp-server` v0.1.0, 38 tools). Decision per CONNECT-CRM-AUDIT-DELTA.md §3: ignore for Lazer v1 (not in user-facing send/reply pipeline).
  Evidence: CONNECT-CRM-AUDIT-DELTA.md §3.

- **Fact:** Existing `docs/` already contains `OVERVIEW.md`, `architecture.md`, `authentication.md`, `campaigns.md`, `dashboard.md`, `data-model.md`, `lead-generator.md`, `leads.md`, `outreach.md`, `pipeline.md`.
  Evidence: directory listing.
  Implication: Implementer should read these before scoping additions; they describe Connect CRM's existing UX and inform settings/UI extensions.

## Locked Decisions

These decisions are settled in the brief or this plan's reviewer-pass and
are not to be re-litigated by the implementer. Push back only if you discover
a clear technical blocker.

> **D-numbering authority.** PLAN.md Locked Decisions D1–D24 are the canonical numbering for cross-doc references. BRIEF-email-architecture.md uses its own internal numbering (D1–D10) for the email-architecture decisions; when both docs reference the same decision, prefer the PLAN.md number. The cross-doc mappings are: BRIEF.D8 = PLAN.D18 (hot-standby); BRIEF.D9 = PLAN.D19 (per-mailbox cap 15–25/default 20); BRIEF.D10 = PLAN.D20 (CA mortgage-compliance counsel pre-launch). Earlier reviewer notes that referenced "D8/D9/D10" for "replies pull via Smartlead webhook / torched-root reframe / doc-only" used the v2.1 numbering — those decisions are now PLAN.D8 (replies), PLAN.D9 (torched-root reframe), PLAN.D10 (doc-only) and remain at those positions.

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
15. **Per-mailbox daily cap range is 15–25/day, default 20** (revised in v2.5
    per D19 below; was 20–40/default 30 in v2.1, now superseded). Lowered
    per post-Oct-2025 Google Workspace crackdown consensus to reduce trigger
    probability for tenant-wide suspension (research §Q2).
16. **Watchdog uses Wilson lower-bound + hard-complaint escape hatch.** Min
    attempted floor: 10. Hard-complaint rule: any single spam complaint on
    any mailbox sends that mailbox to manual-review queue regardless of rate.
17. **Per-state compliance footer is required, not optional** (per research §Q3).
    Minimum 10 state variants (CA, NY, FL, NJ, TX, MA, MD, IL, AZ, CT) plus
    federal floor. Footer assembled dynamically per recipient state from
    `Lead.address_state`. NJ requires NMLS unique identifier "in conspicuous
    manner" on every solicitation; TX requires 12-point minimum font; NY
    requires "Registered Mortgage Broker — NYS DFS" legend; CA requires
    DRE/DFPI license disclosure plus § 17529.5 auth-perfection. Source of
    truth: `docs/lazer-lending/COMPLIANCE.md` §3.
18. **Hot-standby mailbox inventory required at v1 launch** (per research §Q2).
    5 pre-warmed mailboxes from Litemail / EmailAstra / Infraforge ($25–85/mo
    total). Converts disaster-recovery from 7–10 weeks (cold) to 24–72 hours.
    The plan's earlier "2–4 weeks recovery" assumption was wrong without
    standby; cold-start recovery is 7–10 weeks (24–48h DNS + 6–8 weeks warmup
    + OAuth provisioning).
19. **Per-mailbox daily cap is 15–25/day** (was 20–40 in v2.1) with default 20
    (per research §Q2). Post-October-2025 Google crackdown literature names
    Smartlead+Workspace as a trigger pattern; lowering volume reduces
    suspension probability. Caps surface in `mailbox.daily_cap` with default
    `DEFAULT_MAILBOX_DAILY_CAP=20` env var.
20. **California mortgage-compliance counsel retained before first send**
    (per research §Q3). Cal. Bus. & Prof. Code § 17529.5 imposes $1,000/email
    strict-liability private right of action with no proof of harm required —
    actively litigated by Pacific Trial Attorneys and similar plaintiff firms.
    SPF/DKIM/DMARC failures on any California-addressed message are treated
    as evidence of "deceptive header." Engagement is non-optional pre-launch.
21. **Classifier regex pre-filter for unambiguous opt-out language**
    (per audit §1 + research §Q3). Patterns "stop", "remove", "unsubscribe",
    "do not contact", "cease", "opt out" force `unsubscribe` classification
    BEFORE the LLM call. Each missed opt-out is a potential CAN-SPAM violation
    at $53,088/violation (Jan 2024 inflation adjustment, not the $51,744 cited
    in v2.1). The LLM at 88–92% accuracy is too unreliable for this category.
22. **Stop-on-reply fires on ALL replies at v1**, not just non-low-confidence
    negative (per audit §1). The v2.1 exception ("`negative` confidence ≤ 0.8
    does NOT stop the sequence") was premature optimization; classifier
    mis-classification of positives as low-confidence-negative would hammer
    leads with steps 2/3/4 and trigger spam complaints. Optimize this rule
    only after operating data accumulates to measure classifier accuracy
    against ground truth. Supersedes v2.1 §Pacing & Concurrency exception.
23. **Webhook receiver returns 200 immediately after idempotency-INSERT;
    LLM classifier + forwarder + FUB push run in deferred async job**
    (per audit §1 + research §Q1). Smartlead's at-least-once delivery
    semantics with 10–30s timeout retries make synchronous handlers unsafe:
    a slow LLM call causes Smartlead to retry, the idempotency row is found,
    but the original handler is still in-flight — and may then fail, leaving
    the event permanently lost. Smartlead's own help center
    (https://helpcenter.smartlead.ai/en/articles/417-how-to-resolve-webhook-failures)
    explicitly requires receivers to "check the event ID so it doesn't process
    the same event twice if Smartlead retries."
24. **Smartlead-failover vendor pre-onboarded BEFORE launch**, not "in 2–4
    weeks if Smartlead suspends" (per research §Q1). Saleshandy is the
    candidate (no industry restrictions) but webhook-signing capability
    requires direct vendor confirmation. Instantly is **disqualified** for
    lending — its public sending policy explicitly gates lending behind
    custom-account approval (verified May 2026 against
    https://instantly.ai/instantly-sending-policy). The `SendProvider`
    interface from v2.1 must be wired with a working second implementation
    before v1 launch, not deferred.

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
  Reality: Per CONNECT-CRM-AUDIT-DELTA.md (2026-05-01), `supabase/functions/_shared/warmup.ts` exists as a helper but functionality status is unverified. The earlier `[superseded]` claim that Connect CRM was "100% client-side mock data with no backend at all" (from CODEBASE_ANALYSIS.md) overstated absence — Supabase IS wired, but the warmup helper is at best a stub.
  Planning Decision: Treat the warmup PRD claim as aspirational. Build warmup
  via Smartlead's bundled warmup network (locked in brief D2). The "audit
  warmup module" task in Phase 0 becomes "read `supabase/functions/_shared/warmup.ts` and classify as stub / partial / functional per CONNECT-CRM-AUDIT-DELTA.md §5."

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
- **Smartlead per-mailbox limits:** App-level cap (default 20, per D19) is more
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

- **Added from brief:** PLAN Locked Decisions D1–D7 (BRIEF.D1–D7 same numbering). Added PLAN.D8 (replies pull via Smartlead webhook), PLAN.D9 (torched-root reframe), PLAN.D10 (doc-only).
- **Added from reviewer feedback:** PLAN.D11 (pacing owned by Smartlead), PLAN.D12 (mailbox-local TZ for daily reset), PLAN.D13 (HMAC unsub token), PLAN.D14 (auto-rotation breach formula), PLAN.D15 (cap range — `[superseded by D19: now 15–25 default 20]`), PLAN.D16 (Wilson + hard-complaint).
- **Added from v2.5 audit + research:** PLAN.D17 (per-state footer), PLAN.D18 (hot-standby; corresponds to BRIEF.D8), PLAN.D19 (cap 15–25/default 20; corresponds to BRIEF.D9), PLAN.D20 (CA counsel; corresponds to BRIEF.D10), PLAN.D21 (regex pre-filter), PLAN.D22 (stop-on-all-replies), PLAN.D23 (deferred-processing webhook), PLAN.D24 (Saleshandy pre-onboarded).
- **Conflict resolved (PRD vs brief):** PRD §5.8 said "All sends through
  Resend"; brief D2 selected Smartlead. Plan honors brief.
- **Conflict resolved (PRD vs brief):** PRD §5.1/§5.5 said "subdomain
  rotation + torched-root detection on lazerlending.com"; brief D1
  selected burner-domain pool. Plan honors brief.
- **Intentionally dropped:** Self-built warmup network (Smartlead bundled).
  Self-hosted MTA (out of scope at this volume). Per-campaign subdomain
  assignment (deferred — pool-based with manual override is simpler).

## Compliance & Data Retention

> **Compliance is governed by `docs/lazer-lending/COMPLIANCE.md`** as the
> source of truth. The bullets below are pointers; that doc is authoritative
> for any disagreement. v2.5 corrections from research §Q3 included there:
> TCPA does NOT apply to standalone email (covers calls/texts only — risk
> is multi-channel sequences); GLBA exemption from CCPA is data-level NOT
> entity-level (pre-application prospect records ARE subject to CCPA delete);
> CAN-SPAM penalty is $53,088/violation (Jan 2024 inflation-adjusted, not
> $51,744); and California § 17529.5 ($1k/email strict-liability private
> right of action) is the highest-probability enforcement vector — higher
> than the federal CFPB / state-AG redlining concerns flagged in v2.1.

Pointers to COMPLIANCE.md sections:

- **Federal floor:** CAN-SPAM (§2), Reg Z trigger terms (§2), Reg N / MAP
  Rule 24-month retention (§2), FCRA + HBPPA narrowed scope (§2),
  SAFE Act NMLS baseline (§2).
- **State-by-state:** CA, NY, FL, NJ, TX, MA, MD, IL, AZ, CT (§3).
  v2.1's "Florida § 501.059" and "NY GBL § 369-aa" citations were wrong;
  correct authorities are FL Chapter 494 + Rule 69V-40 and NY Banking Law
  Article 12-D + 3 NYCRR Part 38.2.
- **California § 17529.5 deep-dive:** $1k/email strict liability, plaintiff
  firm activity, SPF/DKIM/DMARC perfection requirement (§4).
- **TCPA clarification:** calls/texts only; risk is multi-channel sequences (§5).
- **Reg B / ECOA fair-lending:** cold-list demographic risk; documentation
  requirements; Fairway Independent Oct 2024 case fact pattern (§6).
- **CCPA right-to-delete:** GLBA exemption is data-level only; 45-day SLA;
  what data falls under exemption vs not (§7).
- **Default footer template + per-state additions** (§8).
- **Records-needed-for-AG-subpoena table** (§9, 10 items).
- **Attorney engagement:** California mortgage-compliance counsel pre-launch
  is non-optional per D20 (§10).

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

> **v2.5 architecture change (per audit §1, locked decision D23):** The
> v2.1 design did all reply-handling work synchronously inside the webhook
> handler — signature → idempotency → persist → 5s LLM call → suppression →
> stop-on-reply → router → forwarder → FUB push, all before returning 200.
> Smartlead retries on slow webhooks (10–30s timeout) per its own help center
> (https://helpcenter.smartlead.ai/en/articles/417-how-to-resolve-webhook-failures),
> which explicitly requires receivers to "check the event ID so it doesn't
> process the same event twice if Smartlead retries." A slow LLM call would
> exceed Smartlead's timeout, trigger a retry, and the dupe would arrive while
> the original handler was still in-flight — TOCTOU window where both handlers
> race or where a failure between INSERT and `processed_at` permanently loses
> the event. Industry pattern: split sync from async.

A new `webhook_events` table:

```text
webhook_events (
  id                  uuid pk,
  provider            text  not null,             -- 'smartlead' (future: others)
  external_event_id   text  not null,
  event_type          text  not null,
  received_at         timestamptz not null default now(),
  state               text  not null default 'received',  -- received | processing | processed | failed
  attempts            int   not null default 0,
  last_attempt_at     timestamptz null,
  last_error          text  null,
  processed_at        timestamptz null,
  payload             jsonb not null,            -- full body for async handler
  payload_hash        text  not null,
  unique (provider, external_event_id)
)
```

### Sync receiver path (target latency < 200ms)

1. Verify signature. Reject 401 on mismatch.
2. `INSERT INTO webhook_events (provider, external_event_id, event_type,
   payload, payload_hash, state) VALUES (..., 'received')
   ON CONFLICT (provider, external_event_id) DO NOTHING RETURNING id`.
3. **Return 200 OK immediately**, regardless of whether INSERT succeeded
   (CONFLICT means the event is already enqueued or processed — duplicate
   delivery, idempotent path).
4. The async worker (next section) does all real work.

### Async worker path (`pg_cron` polls every minute, OR realtime trigger)

1. `SELECT … FROM webhook_events WHERE state = 'received' ORDER BY received_at
   LIMIT 100 FOR UPDATE SKIP LOCKED` and mark `state='processing',
   last_attempt_at = now(), attempts = attempts + 1`.
2. For each event, dispatch to handler by `event_type`:
   - `delivery` events → bounce-cascade + watchdog signals.
   - `reply` events → persist `replies` row → redact PII → classify
     (LLM, 5s timeout) → suppression insert (if `unsubscribe`) →
     stop-on-reply → forwarder → FUB push.
3. On success: `UPDATE webhook_events SET state='processed', processed_at = now()`.
4. On error: `UPDATE webhook_events SET state='received', last_error = ?` and
   leave for retry. After 5 failed attempts, set `state='failed'` and alert.

### Why this is safe under Smartlead's at-least-once semantics

- The sync path's only side-effect is `INSERT` into `webhook_events` —
  idempotent on `(provider, external_event_id)`.
- A duplicate Smartlead delivery hits the conflict and 200s without any
  handler code running.
- The async worker's `FOR UPDATE SKIP LOCKED` ensures only one worker
  processes a given event at a time; `attempts++` guards against infinite
  retry loops.
- A worker crash mid-processing leaves the row in `processing` state;
  a janitor sweeps `processing` rows older than `WORKER_PROCESSING_TIMEOUT`
  back to `received` for retry.

This handles vendor retries, duplicate deliveries, slow downstream calls
(LLM, FUB), and replay attacks within the configured retention window.

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
- **Per-mailbox daily cap (v2.5):** 15–25/day, default 20 (per D19). v2.1's
  20–40/default 30 is superseded — post-October-2025 Google Workspace
  crackdown literature names Smartlead+Workspace as a trigger pattern, and
  lowering volume reduces suspension probability (research §Q2).
- **Wilson watchdog rate path is mathematically dormant at v1 volume.** With
  per-mailbox cap of 20/day and `min_attempted=10`, the rate path requires
  roughly ~400 sends/mailbox/24h to fire on a single complaint. At v1, that's
  20× scale. Until ~400 sends/mailbox/24h is reached, the rate path is
  dormant and the **hard-complaint rule is the primary signal**. Documented
  honestly per audit §1; engineers should not rely on Wilson at v1 volume.
- **Stop-on-reply (v2.5):** Stop on **ALL** replies, including null
  classifier. v2.1's exception (`negative` low confidence does NOT stop) is
  superseded by D22 — too risky given classifier accuracy. Optimize this
  rule only after operating data shows ground-truth classifier accuracy.

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
provisioning → oauth_pending → warming → live → standby
         ↓          ↓             ↓       ↓        ↓
        failed    failed        paused   paused (re-activate)
                                  ↑
                          (watchdog or smartlead 429
                           or manual)
```

States:
- `provisioning`: Mailforge request fired.
- `oauth_pending`: Mailbox exists at Mailforge; awaiting OAuth into Smartlead.
- `warming`: Smartlead warmup running. Hard-blocked from live sends.
- `live`: Eligible for live sends.
- `standby` (v2.5, per D18): Warmed mailbox held in reserve, NOT assigned to
  any live sending pool. Activated within 24–72h on Mailforge failure or
  capacity event. Per Task 0.9, 5 standby mailboxes are provisioned at v1
  launch via Litemail / EmailAstra / Infraforge ($25–85/mo total).
- `paused`: Excluded from `claimSendSlot`. `paused_reason` ∈ {`bounce_threshold`,
  `complaint_threshold`, `single_complaint_review`, `smartlead_rate_limit`,
  `dns_failure`, `manual`}.
- `failed`: Provisioning or OAuth failed. Manual retry or abandon.

### Domain — additional v2.5 fields

The `domains` table now tracks `expires_at` (registrar registration expiry,
typically 1 year from registration) and `expiry_alarm_sent_at`. A daily DNS
health job alerts when `expires_at < now() + interval '30 days'` per audit
§4 ("Burner-domain expiry = sends bounce overnight"). Operator forgetting
renewal is a documented production failure mode; SPF/DKIM/DMARC TXT records
evaporate when DNS goes dark, sends bounce hard, reputation tanks.

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
- `mailbox_slot_reservations` (v2.5, per pseudocode `claimSendSlot`): `id, mailbox_id, lead_id, reserved_at, confirmed_at (nullable), released_at (nullable), expires_at (reserved_at + RESERVED_SLOT_TIMEOUT_SECONDS), state ('reserved'|'confirmed'|'released'), smartlead_message_id (nullable), release_reason (nullable)`. Required for the two-phase reserve → confirm/release pattern that closes the v2.1 slot-leak bug.
- `ccpa_requests` (v2.5, per COMPLIANCE.md §7 / Task 1.0b): `id, received_at, due_at (received_at + 45 days per Cal. Civ. Code § 1798.105), request_type ('delete' | 'access'), requester_email, lead_id (nullable — null when no match found), completed_at (nullable), completion_notes (text), audit_log_id`. A daily job alerts on rows with `due_at < now() AND completed_at IS NULL` (per COMPLIANCE.md §7 SLA enforcement).

**Change (modified tables):** (per COMPLIANCE.md §6 Reg B retention, §8 per-state footer, §9 subpoena-ready records)
- `campaigns`: add `sending_pool_id`, `routing_rule_id`, `seed_inbox_set_id` (v2), `list_unsubscribe_template_id`, **`targeting_criteria_snapshot` (JSONB; immutable after first send — captures ZIPs included, demographic filters, age brackets, homeowner status per COMPLIANCE.md §6)**, **`geographic_coverage_map` (JSONB)**, **`legal_approved` (boolean, default false)**, **`legal_approved_by` (uuid → users.id, nullable)**, **`legal_approved_at` (timestamptz, nullable)**, **`compliance_footer_version` (text — points at the per-state footer template version active at launch)**.
- `leads`: add `email_normalized` (with unique index), `zerobounce_status`, `zerobounce_substatus`, `zerobounce_score`, `last_validated_at`, `fub_id (nullable)`, `unsubscribed_at`, **`address_state` (text, ISO state code — required for per-state footer engine, per COMPLIANCE.md §8)**, **`source` (enum: `prior_relationship` | `purchased_list` | `public_data` | `prescreened_credit` | `other` — per COMPLIANCE.md §6/§9)**, **`source_acquired_at` (timestamptz)**, **`source_list_id` (text, nullable — references the data-broker list provenance row)**, **`consent_record_id` (uuid, nullable — references the immutable consent-capture record per COMPLIANCE.md §9 row 6)**, **`data_broker_contract_id` (text, nullable — references the contract under which the list was acquired)**.
- `sends` (or create if absent): `id, lead_id, campaign_id, campaign_step_id, mailbox_id, conversation_id, smartlead_message_id, status, bounce_type, sent_at, delivered_at, complaint_at`, **`footer_template_version` (text — bump on any state-specific change, per COMPLIANCE.md §8)**, **`footer_hash` (text — resolved-footer plaintext SHA-256 for subpoena reproduction, per COMPLIANCE.md §9 row 4)**, **`compliance_jurisdiction` (text, ISO state code — copies from `lead.address_state` at send-time)**, **`raw_mime_hash` (text — SHA-256 of the raw MIME emitted to the SMTP envelope, for AG audit reproduction, per COMPLIANCE.md §9 row 1)**. Status invariant: monotonic; terminal states (`delivered`, `bounced`, `complained`, `failed`) never co-exist on the same row.
- `mailboxes`: (in addition to fields in §New tables) **add `nmls_id` (text, nullable — per-mailbox MLO NMLS ID for state disclosure compliance per COMPLIANCE.md §3)**.
- `users`: **add `mlo_nmls_id` (text, nullable — for individual MLO NMLS in footers per COMPLIANCE.md §3 NJ "in conspicuous manner" obligation)**.
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

### Job runtime decision (v2.5, per audit §1 + research §Q1)

The audit flagged Supabase Edge Functions (Deno, ~150s timeout, `pg_cron` SQL-only) as architecturally insufficient for long-lived per-mailbox loops with HTTP forwards, LLM calls, and paginated vendor stats fetches. Smartlead's own help center requires receivers to defer real work to async processing. Decision:

- **Edge Functions** (Deno, max ~150s execution, `pg_cron`-triggered via `pg_net`): suitable for the **webhook receiver** (sync 200 OK + idempotency INSERT), the **List-Unsubscribe endpoint** (HMAC verify + suppression upsert), **ZeroBounce JIT validation** (single-row gate), simple per-row jobs, and edge functions that already exist in the Connect CRM scaffold. Pattern: short-lived, request-scoped, return promptly.
- **Separate worker host** (Render / Fly background worker, longer-lived process — to be provisioned in Phase 0.2 alongside the Supabase project): required for **mailbox watchdog** (per-mailbox loop), **daily Smartlead reconcile** (paginate per-mailbox stats — Smartlead docs require deferred async processing), **DMARC RUA aggregator parsing** (XML batch processing), **classifier-async-job** (5s LLM call inside `webhook_events` worker loop with `FOR UPDATE SKIP LOCKED`), **daily-cap-reset hourly sweep**, and **slot-reservation reaper**. Estimate: **+1 week setup** added to Phase 1 budget (worker host provisioning, deploy pipeline, observability wiring).

Cite: per audit §1 + research §Q1 (Smartlead docs require deferred async processing; Edge Function 150s ceiling cannot host per-mailbox watchdog loops or paginated daily reconciles).

### Key Pseudocode

#### Atomic mailbox-slot claim (with suppression check)

> **v2.5 correctness fix (per audit §1):** v2.1 incremented `today_sent_count`
> before the Smartlead POST. If Smartlead returned 5xx/429, the slot was
> consumed and never refunded — at 20/day per mailbox, ~5–10 leaked slots/day
> per mailbox is meaningful. The pseudocode below uses a **two-phase reserve
> → confirm/release** pattern: claim reserves a slot, the caller MUST call
> `confirmSlot` on a successful Smartlead POST or `releaseSlot` on any error
> (timeout, 429, 5xx, signature reject). The reserved slot is also reaped by
> a janitor job after `RESERVED_SLOT_TIMEOUT_SECONDS` (default 300) to handle
> caller crashes. The `ORDER BY (m.today_sent_count::float / m.daily_cap)
> ASC, random() ASC` hint is honored as a *tie-breaker*, not a primary sort —
> Postgres may evaluate `random()` per row but the load-balance ordering is
> what matters; document the actual semantics rather than the intended one.

```typescript
// Goal: pick an eligible mailbox AND reserve a daily slot in ONE atomic UPDATE.
// Caller MUST confirmSlot or releaseSlot to complete the lifecycle.
// Postgres syntax shown; adapt to repo's actual SQL dialect/ORM in Phase 0.
async function claimSendSlot(poolId: string, recipientEmail: string): Promise<{ mailbox: Mailbox, reservationId: string }> {
  const norm = normalizeEmail(recipientEmail);

  return await db.tx(async (t) => {
    const suppressed = await t.suppressions
      .where({ email_normalized: norm })
      .first();
    if (suppressed) throw new RecipientSuppressed(norm, suppressed.reason);

    // Atomic reserve. Predicate enforces cap at write-time. Reserved slot
    // counts toward today_sent_count but is recorded in mailbox_slot_reservations
    // so a crash/timeout janitor can release it.
    //
    // Note on ORDER BY: load-balance utilization is the primary sort;
    // random() is a tie-breaker. Postgres evaluates random() per row in
    // the subquery — output is non-deterministic across executions, which
    // is the desired behavior, but do not over-rely on uniform distribution.
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

    // Record the reservation so a janitor can release on caller crash.
    const reservation = await t.mailbox_slot_reservations.insert({
      mailbox_id: row.id,
      reserved_at: new Date(),
      state: 'reserved',
    });

    return { mailbox: row, reservationId: reservation.id };
  });
}

// Caller MUST invoke one of these on the SAME mailbox after Smartlead POST.
async function confirmSlot(reservationId: string, smartleadMessageId: string) {
  await db.mailbox_slot_reservations.update({ id: reservationId }, {
    state: 'confirmed',
    smartlead_message_id: smartleadMessageId,
    confirmed_at: new Date(),
  });
}

async function releaseSlot(reservationId: string, reason: string) {
  // Decrement today_sent_count and mark reservation released, atomically.
  await db.tx(async (t) => {
    const r = await t.mailbox_slot_reservations
      .where({ id: reservationId, state: 'reserved' })
      .forUpdate()
      .first();
    if (!r) return; // already confirmed or released — idempotent
    await t.raw(`
      UPDATE mailboxes
      SET today_sent_count = GREATEST(0, today_sent_count - 1)
      WHERE id = $1
    `, [r.mailbox_id]);
    await t.mailbox_slot_reservations.update({ id: reservationId }, {
      state: 'released',
      release_reason: reason,
      released_at: new Date(),
    });
  });
}

// Janitor (runs every minute): release any 'reserved' rows older than
// RESERVED_SLOT_TIMEOUT_SECONDS. Counts as a leaked-slot recovery so we
// can alert if it fires non-trivially often.
async function reapStaleReservations() {
  const ttl = Number(process.env.RESERVED_SLOT_TIMEOUT_SECONDS ?? 300);
  const stale = await db.mailbox_slot_reservations
    .where({ state: 'reserved' })
    .where('reserved_at', '<', new Date(Date.now() - ttl * 1000))
    .all();
  for (const r of stale) {
    await releaseSlot(r.id, 'reaper:timeout');
  }
  if (stale.length > 0) {
    await sendOpsAlert({ kind: 'slot_reaper_fired', count: stale.length });
  }
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

    // Rate path (Wilson lower-bound). Pauses on rate breach.
    if (bounceLower > bounceThreshold) {
      await pauseMailbox(r.mailbox_id, { reason: 'bounce_threshold', bounceLower });
      await sendOpsAlert({ kind: 'mailbox_paused_bounce', mailbox: r.mailbox_id, bounceLower });
    } else if (complaintLower > complaintThreshold) {
      await pauseMailbox(r.mailbox_id, { reason: 'complaint_threshold', complaintLower });
      await sendOpsAlert({ kind: 'mailbox_paused_complaint', mailbox: r.mailbox_id, complaintLower });
    }

    // Hard rule (v2.5 fix per audit §1): fires INDEPENDENTLY of the rate
    // path, even if rate-path already paused. v2.1's `else if` chain made
    // this branch dead code — a mailbox with 5 complaints in 50 sends paused
    // with reason `complaint_threshold` and never reached the manual-review
    // queue the brief required. Now: any single complaint also flags for
    // manual review, regardless of whether rate-path already triggered.
    if (r.complained >= 1) {
      await flagMailboxForReview(r.mailbox_id, { reason: 'single_complaint_review' });
      await sendOpsAlert({ kind: 'mailbox_complaint_review', mailbox: r.mailbox_id });
    }
  }
}

// IMPORTANT: Rate path is mathematically dormant at v1 volume.
// At 20 sends/mailbox/day with min_attempted=10 and complaintThreshold=0.001,
// the Wilson lower-bound on a single complaint requires roughly ~400 attempts
// in 24h to exceed 0.001. At v1 volume of 20/mailbox/day, that's 20× scale.
// Until the system reaches ~400 sends/mailbox/24h (impossible at v1 caps),
// the rate path is dormant; the hard-complaint rule is the primary signal.
// Documented honestly per audit §1. Rate path becomes load-bearing only at
// scale-up (~500–1000+ sends/mailbox/day across multi-mailbox aggregation).

#### Reply classification (with failover)

```typescript
// Goal: classify reply with structured output + confidence + rationale.
// On error/timeout, leave classification null and flag for human review —
// never auto-route to FUB on classifier failure.
async function classifyReply(reply: Reply): Promise<Classification | null> {
  const redacted = redactPII(reply.body_text);

  // v2.5 fix (per audit §1, locked decision D21): regex pre-filter forces
  // `unsubscribe` classification for unambiguous opt-out language BEFORE the
  // LLM call. The LLM at 88–92% accuracy mis-classifies ~10% of true
  // unsubscribes; each missed opt-out is a potential CAN-SPAM violation at
  // $53,088 statutory cap. Run regex first; if it matches, short-circuit.
  const OPT_OUT_PATTERNS = /\b(stop|remove|unsubscribe|do not (contact|email)|cease|opt[\s-]?out)\b/i;
  if (OPT_OUT_PATTERNS.test(reply.body_text)) {
    return {
      label: 'unsubscribe',
      confidence: 1.0,
      rationale: 'regex_optout_match',
      language: detectLanguage(redacted),
      requires_human_review: false,
    };
  }

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
  if (!c) {
    // null classifier (timeout/error/unsupported language). v2.5: still stop
    // future steps. A human-review reply means a human is actively engaged;
    // hammering them with steps 2/3/4 is the wrong default.
    await stopOnReply.cancelFutureSteps(reply.lead_id, reply.campaign_id);
    return;
  }
  if (c.label === 'unsubscribe') {
    await suppressions.insertIfMissing({
      email_normalized: normalizeEmail(reply.from),
      reason: 'unsubscribe',
      source_event_id: reply.raw_message_id,
    });
  }
  // v2.5 fix (per audit §1, locked decision D22): stop on ANY reply at v1.
  // The v2.1 exception (`negative` confidence ≤ 0.8 does NOT stop) was
  // premature optimization — at 88–92% classifier accuracy, ~10% of true
  // positives mis-classify as low-conf negative and would keep getting
  // hammered by steps 2/3/4 of the sequence, triggering spam complaints.
  // One mis-class can kill a mailbox. Optimize this rule only after
  // operating data shows classifier ground-truth accuracy.
  await stopOnReply.cancelFutureSteps(reply.lead_id, reply.campaign_id);
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

// v2.5 fix (per audit §1): timing-safe HMAC compare + previous-secret
// support for non-disruptive secret rotation. v2.1's `===` HMAC compare
// was a timing-attack vector, and rotating LIST_UNSUB_TOKEN_SECRET would
// invalidate every in-flight unsubscribe link (recipients get 401 →
// flag as spam → reputation hit). The previous-secret support lets ops
// rotate without breaking outstanding tokens.
//
// Rotation procedure: (1) set LIST_UNSUB_TOKEN_SECRET_PREVIOUS to the
// current secret, (2) generate and deploy a new LIST_UNSUB_TOKEN_SECRET,
// (3) leave PREVIOUS in place for at least 180 days (the current TTL),
// (4) after that window, clear PREVIOUS.
import { timingSafeEqual, createHmac } from 'node:crypto';

function hmac(secret: string, payloadB64: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('hex');
}

function verifyUnsubToken(token: string): UnsubPayload | null {
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const sigBuf = Buffer.from(sig, 'hex');
  const expectedSig = hmac(process.env.LIST_UNSUB_TOKEN_SECRET!, payloadB64);
  const expectedBuf = Buffer.from(expectedSig, 'hex');

  let ok = false;
  if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) {
    ok = true;
  } else if (process.env.LIST_UNSUB_TOKEN_SECRET_PREVIOUS) {
    const prevSig = hmac(process.env.LIST_UNSUB_TOKEN_SECRET_PREVIOUS, payloadB64);
    const prevBuf = Buffer.from(prevSig, 'hex');
    if (sigBuf.length === prevBuf.length && timingSafeEqual(sigBuf, prevBuf)) {
      ok = true;
    }
  }
  if (!ok) return null;

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  if (payload.expiry_unix < Date.now() / 1000) return null;
  return payload;
}
```

#### Email normalizer — domain-conditional Gmail dot-collapse (v2.5 fix)

```typescript
// v2.5 fix (per audit §1, multiple lenses agreed): Gmail collapses dots in
// the local part; Outlook / Yahoo / Proton do NOT. v2.1's "Gmail dot-
// insensitive" applied globally over-merged distinct mailboxes —
// `john.doe@outlook.com` and `johndoe@outlook.com` are different mailboxes
// at Outlook and would be falsely deduped by `UNIQUE INDEX(email_normalized)`,
// cross-contaminating FUB pushes. Apply dot-collapse ONLY for gmail.com and
// googlemail.com.
function normalizeEmail(email: string): string {
  const [local, domain] = email.toLowerCase().split('@');
  let normalizedLocal = local.split('+')[0]; // strip plus-tag for all providers
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    normalizedLocal = normalizedLocal.replace(/\./g, ''); // dot-collapse Gmail only
  }
  return `${normalizedLocal}@${domain}`;
}
```

#### Daily-cap reset — single hourly job (v2.5 fix)

```typescript
// v2.5 fix (per audit §1): replace per-mailbox-TZ cron with one hourly job
// that resets any mailbox where local-midnight has passed since last reset.
// Per-mailbox-TZ cron has multiple failure modes (DST, missing timezones,
// scheduler skew); a single hourly reconciler is simpler and self-healing.
//
// Health check: alert if any mailbox `last_reset_at < (now - 25h)` in mailbox
// local TZ — would indicate the job stopped running and reputation cliff is
// imminent.
async function runDailyCapResetSweep() {
  const mailboxes = await db.mailboxes.where({ /* not retired */ }).all();
  for (const m of mailboxes) {
    const localNow = nowInTz(m.timezone);
    const localLastReset = inTz(m.last_reset_at, m.timezone);
    const passedMidnight = localNow.toDateString() !== localLastReset.toDateString();
    if (passedMidnight) {
      await db.mailboxes.update({ id: m.id }, {
        today_sent_count: 0,
        last_reset_at: new Date(),
      });
    }
    // Health check: 25h since last reset means we missed at least one cycle.
    const hoursSinceReset = (Date.now() - m.last_reset_at.getTime()) / 3_600_000;
    if (hoursSinceReset > 25) {
      await sendOpsAlert({ kind: 'daily_cap_reset_stale', mailbox: m.id, hoursSinceReset });
    }
  }
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
  // v2.5: full state set including `standby` (per D18) and intermediate states.
  // Matches the narrative state machine in §Domain & Mailbox State Machines.
  warmup_state: 'provisioning' | 'dns_pending' | 'oauth_pending' | 'verifying'
              | 'ready' | 'live' | 'standby' | 'paused' | 'failed';
  daily_cap: number;                               // 15–25, default 20 (per D19)
  today_sent_count: number;
  last_24h_bounce_rate: number;
  last_24h_complaint_rate: number;
  paused_reason: 'bounce_threshold' | 'complaint_threshold'
              | 'single_complaint_review' | 'smartlead_rate_limit'
              | 'dns_failure' | 'manual' | null;
  last_health_check_at: Date;
  timezone: string;                                // IANA, default 'America/Phoenix'
  nmls_id: string | null;                          // per-mailbox MLO NMLS ID (per COMPLIANCE.md §3)
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
  // v2.5 compliance columns (per COMPLIANCE.md §6/§8/§9):
  address_state: string | null;                    // ISO state code; drives per-state footer
  source: 'prior_relationship' | 'purchased_list' | 'public_data'
        | 'prescreened_credit' | 'other' | null;
  source_acquired_at: Date | null;
  source_list_id: string | null;
  consent_record_id: string | null;
  data_broker_contract_id: string | null;
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
  // v2.5 compliance columns (per COMPLIANCE.md §8/§9):
  footer_template_version: string;                 // bump on any state-specific change
  footer_hash: string;                             // SHA-256 of resolved footer plaintext
  compliance_jurisdiction: string | null;          // ISO state code at send-time
  raw_mime_hash: string;                           // SHA-256 of raw MIME for AG audit
};

type Campaign = {
  // Connect-CRM-inherited fields...
  sending_pool_id: string;
  routing_rule_id: string | null;
  seed_inbox_set_id: string | null;                // v2
  list_unsubscribe_template_id: string;
  // v2.5 compliance columns (per COMPLIANCE.md §6):
  targeting_criteria_snapshot: Record<string, unknown>;  // JSONB, immutable after first send
  geographic_coverage_map: Record<string, unknown>;      // JSONB
  legal_approved: boolean;                                // hard gate before launch
  legal_approved_by: string | null;                       // user.id
  legal_approved_at: Date | null;
  compliance_footer_version: string;                      // points at active per-state footer template
};

type User = {
  // Connect-CRM-inherited fields (id, email, role, etc.)...
  mlo_nmls_id: string | null;                       // per COMPLIANCE.md §3 NJ "conspicuous manner"
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

**Task 0.1: Verify CONNECT-CRM-AUDIT-DELTA.md against live code (v2.5 update).**
- The drift doc itself is produced as part of v2.5 doc cleanup at
  `docs/lazer-lending/CONNECT-CRM-AUDIT-DELTA.md`. Phase 0.1 becomes
  verification, not authoring.
- Walk through `CODEBASE_ANALYSIS.md` and `CONNECT-CRM-AUDIT-DELTA.md`
  side-by-side; verify file paths still resolve, type definitions match,
  and Supabase migrations directory state is as documented.
- Particular care: §3 (mock data), §4 (CRMContext), and `supabase/migrations/`
  contents (analysis says "no backend, no API calls, no database" — confirm
  Supabase is unused, or document what's there).
- DoD: Drift doc validated against live code. Any deltas appended as a
  "Verified $DATE" addendum. Open question resolved: is `mcp-server/`
  load-bearing for Lazer or can we ignore it? (Default per audit-delta:
  ignore for v1.)

**Task 0.2: Lock the backend choice.**
- Default per this plan: Supabase (already configured in `supabase/`).
- DoD: Decision recorded. If Supabase: provision project, capture URL +
  anon key + service role into `.env.example`. If alternative chosen,
  document reasoning + new validation commands.

**Task 0.3: Verify vendor contracts by sending real test events (v2.5 update).**
- `VENDOR-CONTRACTS.md` is scaffolded in v2.5 doc cleanup with the contract
  shape and known-from-research data filled in. Phase 0.3 becomes verifying
  webhook signing, retry semantics, and idempotency-key behavior by sending
  real test events to a sandbox endpoint and inspecting headers/bodies.
- Smartlead: confirm signature scheme, retry timeout (research suggests
  10–30s), at-least-once delivery (Smartlead's own help center confirms,
  per https://helpcenter.smartlead.ai/en/articles/417-how-to-resolve-webhook-failures).
- **Mailforge: ask directly about Workspace tenant isolation** (research
  §Q2 open question). Mailforge does NOT publicly disclose whether customer
  mailboxes share a Workspace tenant or are isolated; this determines
  blast-radius on Google enforcement events. Resolve before contract
  signing.
- ZeroBounce: bulk async polling cadence, webhook callback availability.
- FUB: rate limit numbers, 429 backoff guidance.
- Resend: transactional AUP boundaries.
- Saleshandy: confirm webhook-signing capability exists and is HMAC-based
  (required to be a real backup `SendProvider` per D24).
- Goal: API keys in `.env.example`. Smoke-test calls succeed.
- DoD: All keys present in `.env.example`. `VENDOR-CONTRACTS.md` rows
  flipped from `[Phase 0.3 verify]` to `[verified]` for each vendor whose
  test event was inspected. Mailforge tenant-isolation answer recorded.

**Task 0.4: Verify Bun + Vite + Vitest + Playwright dev loop.**
- DoD: `bun install`, `bun run dev` (port 8080), `bun run lint`, and
  `bun run test` all pass on a fresh checkout.

**Task 0.5: Client kickoff — close all Phase-1-blocking Open Questions (v2.5 update).**
- Goal: Lock burner-domain naming, forwarding addresses, neutral-reply rule,
  OOO rule, **per-state compliance footer text** (10+ state variants per
  D17), Workspace tenant ownership, DMARC ramp acceptance, classifier
  provider DPA, forwarder choice (Resend vs IMAP), **data-broker source**
  (CRA-sold trigger leads triggers HBPPA scope, commercial broker does not —
  see research §Q3), **state-licensing scope** (all 50 vs subset), **CA
  compliance counsel engagement** (per D20), **Lazer's existing FUB
  suppression list** for seed import (per Task 0.10 below).
- v2.1's 13 Open Questions are superseded by the audit + research findings.
  See updated Open Questions section at the end of this plan.
- DoD: All `[Phase 1 blocker]`-tagged Open Questions answered in writing.
  Realistic close: 3–6 weeks calendar across multiple touchpoints (per
  audit §5 — Lazer's compliance/legal is one part-time person, not a
  one-call kickoff).

**Task 0.6: Smoke-test 1 burner domain end-to-end via Mailforge.**
- Goal: Validate the provisioning path before Phase 1 code.
- DoD: 1 burner domain registered, DNS verified (SPF/DKIM/DMARC), 1 mailbox
  created, OAuth'd into Smartlead, warmup state set, all in <2 hours total
  including support latency.

**Task 0.7: Re-review this plan with `plan-reviewer` against the updated paths.**
- Goal: Catch issues that only become visible once Connect CRM specifics
  are known.
- DoD: Reviewer findings either applied or explicitly deferred.

**Task 0.8: California mortgage-compliance counsel engagement (v2.5, per D20).**
- Goal: Engage CA mortgage-compliance counsel before any production send.
  § 17529.5 strict-liability ($1k/email private right of action) is the
  single highest-probability enforcement vector and Pacific Trial
  Attorneys actively litigate (research §Q3).
- Scope of engagement: review of cold-mail templates, per-state footer
  language, suppression-list legal portability, list-source provenance,
  SPF/DKIM/DMARC perfection sign-off.
- DoD: Signed engagement letter on file. First review of cold-mail
  templates booked. Counsel contact recorded in `OPS-RUNBOOK.md` for
  state-AG subpoena response.

**Task 0.9: Hot-standby mailbox provisioning (v2.5, per D18).**
- Goal: Provision 5 pre-warmed mailboxes from Litemail / EmailAstra /
  Infraforge ($25–85/mo total) and hold in `standby` state. Activates
  within 24–72h on Mailforge failure or capacity event.
- DoD: 5 mailboxes provisioned with at least 4 weeks of warmup completed,
  OAuth-ready into Smartlead within 24–72h. Activation procedure tested
  per Task 1.0f drill. Vendor selected and contract signed.

**Task 0.10: Suppression-list seed import (v2.5, per audit Gaps lens).**
- Goal: Import Lazer's existing FUB unsubscribe + complaint records, plus
  any legacy suppression data from prior cold-outreach tools, into
  `suppressions` table BEFORE first campaign. Without this, v1's first
  campaign mails people who already opted out — immediate complaint-rate
  spike before the watchdog has any data.
- DoD: Lazer-supplied suppression list loaded (provenance recorded in
  `suppressions.source_event_id`). Pre-launch cross-check of campaign #1
  recipient list against `suppressions` shows zero overlap (any overlap
  must be filtered before send).

#### Phase 1 — Send Layer + Warmup + Compliance

> **v2.5 prelude (Tasks 1.0–1.0f, per audit Gaps lens):** Six foundation
> tasks land BEFORE the v2.1 send-layer tasks because Connect CRM is a UI
> mock without a working backend, auth, RBAC, CCPA delete-flow, per-state
> footer engine, system health dashboard, campaign preview, or hot-standby
> activation runbook. v2.1 implicitly assumed these existed; they don't.

**Task 1.0: Authentication + RBAC.**
- Build Supabase Auth integration replacing Connect CRM's mock `AuthContext`.
- Roles: `admin`, `operator`, `viewer`. Enforced via Supabase RLS on
  PII-bearing tables (`replies`, `audit_log`, `suppressions`, `leads`).
- DoD: Real sign-in, password reset, role-based access enforced. RLS
  test cases: viewer cannot read `replies.body_text`, operator cannot
  delete from `audit_log`, admin can do both.

**Task 1.0a: Extend existing Supabase data layer for new Lazer entities.**
- Per CONNECT-CRM-AUDIT-DELTA.md (2026-05-01), the mock layer is gone and Supabase is wired with TanStack Query hooks. Phase 1 work is **additive extension**, not migration. The earlier "swap mock-array reads to async Supabase queries" framing is `[superseded]`.
- Phase 1 work:
  (a) Add migrations for new tables under `supabase/migrations/`: `domains`, `mailboxes`, `sending_pools`, `pool_memberships`, `webhook_events`, `replies`, `suppressions`, `conversations`, `mailbox_slot_reservations`, `ccpa_requests` (see Delta Design + COMPLIANCE.md §9).
  (b) Extend Lead / Campaign / Send / Mailbox / users types with compliance columns enumerated in §Delta Design (per COMPLIANCE.md §6, §8, §9 — `address_state`, `source`, `targeting_criteria_snapshot`, `legal_approved_*`, `mailboxes.nmls_id`, `users.mlo_nmls_id`, `sends.footer_template_version`, `sends.footer_hash`, `sends.compliance_jurisdiction`, `sends.raw_mime_hash`, etc.).
  (c) Regenerate `src/types/database.ts` via `supabase gen types typescript` after migrations apply.
  (d) Add new data-access modules in `src/lib/api/` mirroring the existing pattern (e.g., `domains.ts`, `mailboxes.ts`, `replies.ts`, `sends.ts`, `suppressions.ts`, `webhook-events.ts`).
  (e) Add new hooks in `src/hooks/` (e.g., `use-domains.ts`, `use-mailboxes.ts`, `use-replies.ts`, `use-sends.ts`, `use-suppressions.ts`).
  (f) Add new pages in `src/pages/` per CONNECT-CRM-AUDIT-DELTA.md §3 (DomainsPage, MailboxesPage, RepliesPage, WebhookEventsPage, SuppressionsPage).
  (g) Wire optimistic updates and Realtime subscriptions where applicable (pattern: `src/hooks/use-emails.ts`).
- DoD: New entities readable + writable from the React UI through TanStack Query hooks against Supabase; loading / error / optimistic states match the existing pattern; new pages routable from the sidebar; existing pages extended per CONNECT-CRM-AUDIT-DELTA.md §3.

**Task 1.0b: CCPA right-to-delete flow (v2.5, per D17/COMPLIANCE.md §7).**
- Operator (admin role only) can locate and delete a recipient's data
  across `leads`, `sends`, `replies`, `conversations`, `webhook_events`,
  `audit_log`. 45-day SLA per Cal. Civ. Code § 1798.105.
- The deletion event itself is audit-logged (deletion record preserved
  even when subject data is removed).
- **Each request creates a row in `ccpa_requests`** with `received_at`, `due_at = received_at + 45 days`, and is processed within the SLA window per COMPLIANCE.md §7. A daily job alerts on rows with `due_at < now() AND completed_at IS NULL`.
- DoD: End-to-end test of a deletion request. `ccpa_requests` row created with correct `due_at`. Verify the audit-log entry remains after deletion. Verify suppressions row is created during the deletion to prevent re-mail. Verify SLA-overdue alert fires when `completed_at` remains null past `due_at`.

**Task 1.0c: Per-state compliance footer engine (v2.5, per D17).**
- Footer assembled per recipient state with 10+ variants (CA, NY, FL, NJ,
  TX, MA, MD, IL, AZ, CT) plus federal floor. Reads state from
  `Lead.address_state`. Compliance review flag (`legal_approved=true`)
  required on every campaign before send.
- DoD: Outbound MIME inspection confirms per-recipient-state footer:
  CA recipients receive DRE/DFPI license disclosure;
  TX recipients receive 12pt-minimum NMLS ID;
  NY recipients receive "Registered Mortgage Broker — NYS DFS" legend;
  NJ recipients receive NMLS unique identifier "in conspicuous manner";
  FL recipients receive Chapter 494/Rule 69V-40 license disclosure.
  Counsel-approved templates loaded. Hard gate: no campaign sends
  without `legal_approved=true` per template.

**Task 1.0d: System health dashboard (v2.5, per audit Gaps lens).**
- Operator-facing aggregated view: dispatcher backlog depth, classifier
  failure rate, webhook receiver uptime + 60-min event count (alerts on
  zero), `pg_cron` last-run age per job, FUB push error rate, ZeroBounce
  credit balance, Smartlead 4xx/5xx rate, DMARC RUA last-received age
  per burner, watchdog last-run age, suppression-list size growth rate,
  reaper-fired count.
- **Brand-root (`lazerlending.com`) health card** (per PRD-AMENDMENT row 4 — honors PRD §5.5 user-visible torched-root expectation). Read-only display of: DMARC RUA last-received timestamp for `lazerlending.com`, Postmaster Tools score (if configured), recent volume on `notify.lazerlending.com` transactional, alert if any cold-pool send is detected with from-domain matching the brand root or any subdomain of it.
- DoD: All 9+ metrics + brand-root card live on a single dashboard page, refreshing every 30s. Alert hooks wired to ops alert email per metric threshold. Brand-root card visible to all roles (read-only); detection of any cold send originating from `lazerlending.com` or its subdomains escalates to P0.

**Task 1.0e: Campaign preview / dry-run flow (v2.5, per audit Gaps lens).**
- Pre-send operator preview: total emails, mailboxes used, time-to-complete,
  per-state-footer preview (one example per state in recipient list),
  List-Unsub URL preview, raw-MIME preview of one outbound message.
- DoD: Operator sees all of the above before clicking Launch. Cannot
  launch a campaign that fails any pre-flight (suppression overlap,
  `legal_approved=false`, missing pool).

**Task 1.0f: Hot-standby activation procedure (v2.5, per D18).**
- Operational runbook + test drill: simulate Mailforge failure, OAuth
  the 5 standby mailboxes (from Task 0.9) into Smartlead, switch active
  sending pool to include them.
- DoD: Drill executed end-to-end in <72h with reproducible runbook.
  Procedure documented in `OPS-RUNBOOK.md` incident #4.

**Task 1.1: Define `SendProvider` interface; implement Smartlead client.**
- **Blocked by:** Phase 0.3 Smartlead sandbox provisioning + auth-scheme verification documented in `VENDOR-CONTRACTS.md` §1.
- DoD: Sending a single test email through Smartlead returns a
  `smartlead_message_id` persisted in our `sends` table.

**Task 1.2: Domains + Mailboxes data model + APIs.**
- DoD: Operator can manually add a domain + Smartlead-known mailbox, see
  status reflected. State machines from §Domain & Mailbox State Machines
  enforced.

**Task 1.3: Mailforge integration for provisioning.**
- **Blocked by:** Phase 0.3 Mailforge sandbox + provisioning-lifecycle webhook scheme documented in `VENDOR-CONTRACTS.md` §2.
- DoD: UI request → Mailforge provisions → mailboxes appear OAuth'd into
  Smartlead. Failure path: domain/mailbox sit in `failed` with manual-retry
  button.

**Task 1.4: Sending pools.**
- Files: CREATE `sending_pools` and `pool_memberships` tables.
- DoD: Campaign references a pool, not a specific mailbox.

**Task 1.5: Throttle guard + dispatcher (atomic claim + suppression check, v2.5 update).**
- Implement the **two-phase reserve → confirm/release** pattern from
  pseudocode (per audit §1, Fix 1). Caller invokes `claimSendSlot` to
  reserve, then `confirmSlot` on Smartlead 2xx or `releaseSlot` on any
  error path. Janitor `reapStaleReservations` runs every minute to
  release reservations older than `RESERVED_SLOT_TIMEOUT_SECONDS`.
- Tables: add `mailbox_slot_reservations (id, mailbox_id, reserved_at,
  state ['reserved'|'confirmed'|'released'], smartlead_message_id,
  release_reason, confirmed_at, released_at)`.
- DoD: Stress test of N>cap concurrent jobs results in exactly `cap` sends
  succeeding. Suppression check inside the claim transaction verified
  (just-suppressed lead does not receive a queued send). Slot-leak test:
  inject 100 simulated Smartlead 5xx responses; verify zero leaked slots
  after janitor runs. ORDER BY semantics documented (load-balance primary,
  random tie-breaker, not random primary).

**Task 1.5a: Smartlead rate-limit handler.**
- DoD: On Smartlead 429, mailbox enters `paused_reason='smartlead_rate_limit'`,
  ops alert fires, no retries today on that mailbox.

**Task 1.6: ZeroBounce client + list upload validation.**
- **Blocked by:** Phase 0.3 ZeroBounce sandbox + bulk-async polling contract documented in `VENDOR-CONTRACTS.md` §3.
- DoD: Test list with known-bad rows produces rejection report and clean
  lead set. Lead persists `zerobounce_status` + `substatus` + `score`. The
  dispatcher gates sends based on settings policy per sub-status.

**Task 1.7: Just-in-time re-validation job.**
- DoD: Lead with `last_validated_at > 60 days` gets re-validated when added
  to a campaign.

**Task 1.8: Smartlead webhook receiver — deferred-processing pattern (v2.5 update).**
- **Blocked by:** Phase 0.3 vendor-contracts smoke test of Smartlead webhook signature scheme. Task 1.8 idempotency + signature verification cannot be implemented until the signing scheme is documented in `VENDOR-CONTRACTS.md` §1.
- Implement the sync/async split from §Webhook Idempotency Strategy
  (per audit §1, D23, Fix 7). Sync receiver: signature verify →
  idempotency-INSERT → 200 OK. All real work (LLM classifier, suppression
  insert, stop-on-reply, forwarder, FUB push) runs in an async worker
  polling new `webhook_events` rows via `pg_cron` or realtime trigger.
- Files: CREATE `replies/webhook-receiver.[ext]` (sync) and
  `replies/async-worker.[ext]` (async).
- DoD: Test event fires; signature verification rejects unsigned payloads;
  receiver returns 200 in <200ms. Replayed event short-circuits at
  `INSERT … ON CONFLICT`. Slow LLM (simulated 8s response) does not
  cause Smartlead retry to double-process — async worker's `FOR UPDATE
  SKIP LOCKED` ensures single-handler. Worker-crash test: kill worker
  mid-processing, verify janitor sweeps stuck `processing` rows back to
  `received` after `WORKER_PROCESSING_TIMEOUT`.

**Task 1.8a: Webhook idempotency guard.**
- Files: CREATE `webhook_events` table + `replies/idempotency-guard.[ext]`.
- DoD: Replayed webhook event short-circuits 200 OK without dispatching to
  handlers.

**Task 1.8c: Webhook receiver hardening (v2.5, beyond signature).**
- Per-route rate limit at the edge (Netlify or Cloudflare):
  `/api/webhooks/smartlead` max 10 req/sec per source IP;
  `/api/list-unsubscribe` max 5 req/sec per source IP.
- IP allowlist for `/api/webhooks/smartlead`: Smartlead's webhook source IP range. Verify exact ranges in Phase 0.3 (TBD Phase 0).
- Replay-window enforcement: reject webhooks whose `event_timestamp` is older than 1 hour (defense-in-depth on top of idempotency-by-event-id).
- DDoS protection at the edge (Netlify or Cloudflare). Operator-facing dashboard surfaces rate-limit-rejection counts.
- DoD: Load test simulates burst above rate limit; receiver returns 429 with retry hint, idempotency table not polluted. Synthetic webhook with timestamp 2 hours old rejected with 401. IP allowlist verified by sending from a non-Smartlead source — rejected.

**Task 1.8b: Bounce-cascade.**
- Files: CREATE `send/bounce-cascade.[ext]`.
- DoD: Hard bounce → recipient suppressed + queued future-step sends
  cancelled across all campaigns.

**Task 1.9: List-Unsubscribe RFC 8058 endpoint + suppression list (v2.5 update).**
- Implement timing-safe HMAC compare via `crypto.timingSafeEqual` and
  previous-secret support via `LIST_UNSUB_TOKEN_SECRET_PREVIOUS` per
  audit §1, Fix 8. Document rotation procedure in OPS-RUNBOOK.md.
- DoD:
  - Endpoint accepts POST, no auth, no CSRF.
  - Idempotent (re-submits return 200 OK).
  - Token is HMAC verified with `crypto.timingSafeEqual` (NOT `===`);
    expiry enforced.
  - Previous-secret rotation supported: a token signed with the
    previous secret continues to verify during the rotation window.
  - Raw-MIME inspection of a Smartlead-dispatched message confirms BOTH
    `<https://...>` AND `<mailto:...>` URI variants AND
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header.
  - If Smartlead does not auto-emit, headers are injected via Smartlead
    per-campaign custom-header support.

**Task 1.10: Resend transactional client + ops alert plumbing.**
- DoD: Test "mailbox paused" alert email arrives at the configured ops
  address from `notify.lazerlending.com`.

**Task 1.11: Per-mailbox health watchdog job (Wilson + INDEPENDENT hard-complaint, v2.5 update).**
- Restructure per audit §1, Fix 3: the hard-complaint rule fires
  INDEPENDENTLY of the rate path, even if rate-path already paused.
  v2.1's `else if` chain made the hard rule dead code — a mailbox with
  5 complaints in 50 sends paused with reason `complaint_threshold` and
  never reached manual-review queue.
- Document the dormancy reality per audit §1, Fix 4: at v1 volume
  (20/mailbox/day), the Wilson rate path is mathematically dormant
  below ~400 sends/24h/mailbox; the hard-complaint rule is the
  primary signal at v1.
- DoD: Simulated bounce-rate spike auto-pauses mailbox within one watchdog
  interval. A single simulated complaint sends mailbox to
  `single_complaint_review` regardless of rate AND independently of
  whether the rate path also fired (e.g., 5 complaints in 50 sends results
  in BOTH `complaint_threshold` pause AND `single_complaint_review` flag).

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

**Phase 1 acceptance (v2.5 expanded):** v1.SC1, v1.SC2, v1.SC3, v1.SC7,
v1.SC8, v1.SC9, v1.SC10, v1.SC11. PLUS new v2.5 acceptance criteria:
(a) auth + RBAC enforced via Supabase RLS on all PII-bearing tables;
(b) per-state footer verified by raw-MIME inspection on outbound messages
to each of CA / NY / TX / NJ / FL test recipients;
(c) suppression seed-imported (Task 0.10) and first campaign cross-checked
against existing FUB unsubscribes (zero overlap before send);
(d) hot-standby mailboxes provisioned and warmup-ready (Task 0.9);
(e) CCPA delete-flow tested end-to-end against a known recipient.

#### Hard launch gate (v2.5)

**NO production sends until ALL of the following are green:**

- [ ] Task 1.0 — auth + RBAC enforced via RLS on `replies`, `audit_log`,
      `suppressions`, `leads`.
- [ ] Task 1.0c — per-state compliance footer engine live with
      `legal_approved=true` per template; counsel-approved (Task 0.8).
- [ ] Task 1.9 — RFC 8058 List-Unsub headers verified by raw-MIME on a real
      Smartlead-dispatched message (both URI variants + `List-Unsubscribe-Post`).
- [ ] Task 1.11 — watchdog tested with hard-rule independence verified.
- [ ] Task 1.12a — DMARC RUA flowing for every burner; aggregator
      receiving reports (alert if 0 reports in 7 days).
- [ ] Task 0.10 — suppression seed-imported from Lazer's existing FUB +
      legacy data; first-campaign cross-check shows zero overlap.

**Compliance-counsel sign-off on copy + footers required before each new
campaign template** (per Task 0.8).

#### Phase 2 — Reply Handling and FUB

**Task 2.1: Reply ingest from Smartlead webhook (reply event handler).**
- DoD: Reply to a sent email appears in `replies` table within seconds.
  Linked to the originating `Send` via `in_reply_to_send_id` (derived from
  `In-Reply-To`/`References` headers; falls back to most-recent send to that
  lead in that mailbox).

**Task 2.1a: Author classifier eval set (v2.5 prerequisite).**
- 100+ labeled lending replies covering positive / neutral / OOO /
  unsubscribe / negative + Spanish + edge cases (typo opt-outs,
  multi-paragraph mixed-intent, role-change autoresponders, parental-leave
  autoresponders).
- Owned by Lazer team in Phase 0.5 client kickoff; checked into the repo
  under `tests/classifier-eval/`.
- DoD: Eval set committed; required gate before Task 2.2 acceptance.

**Task 2.2: LLM classifier with regex pre-filter + failover (v2.5 update).**
- Implement the regex pre-filter from pseudocode (Fix 5, D21): `OPT_OUT_PATTERNS`
  forces `unsubscribe` BEFORE the LLM call.
- DoD: Test reply set (positive / OOO / negative / Spanish samples)
  classifies with ≥90% accuracy on the eval set (Task 2.1a). Regex
  pre-filter fires before LLM on each opt-out pattern (`stop`, `remove`,
  `unsubscribe`, `do not contact`, `cease`, `opt out`). Classifier
  timeout/error produces `classification=null`, `requires_human_review=true`,
  no auto-FUB push. `classification=unsubscribe` triggers suppression-list
  insert.

**Task 2.3: Routing + forwarding — verify IMAP feasibility BEFORE locking (v2.5 update).**
- Smartlead may not expose IMAP credentials for managed Workspace mailboxes
  (Workspace mailboxes typically use OAuth, and IMAP requires per-mailbox
  enablement that Workspace admins must allow). Smoke-test in Phase 0.3
  vendor-contracts work. If infeasible, fallback is Resend forwarder with
  PII-redaction caveat (Resend AUP exposure: forwarded raw reply bodies
  contain prospect PII).
- DoD: A positive reply on a campaign with `route_to=sam@lazer.com` results
  in a forwarded email to that address. Forwarder choice (Resend vs IMAP
  redirect) confirmed against actual Smartlead/Mailforge capability, not
  default-assumed.

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

**Task 2.7: Stop-on-reply enforcement (v2.5 update).**
- v2.5 fix per audit §1, D22, Fix 6: stop on **ALL** replies at v1, including
  null classifier and low-conf negative. v2.1's exception (low-conf negative
  does NOT stop) is superseded — see D22 reasoning.
- DoD: Reply to step 1 cancels all queued sends for steps 2..N to that
  lead in that campaign, regardless of classification. Verified across
  positive, neutral, OOO, unsubscribe, negative (any confidence), and
  null-classifier cases.

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

- **Data / schema source of truth:** `supabase/migrations/` (8 existing migrations) + `src/types/database.ts` (1,032-line auto-generated typed client). See `CONNECT-CRM-AUDIT-DELTA.md` §2 for live paths.
- **Entry points to extend:** Connect CRM HTTP routes + job runner.
- **Validation layer:** Connect CRM validation library (TBD); reuse.
- **Domain / service layer:** Add `send/`, `infra/`, `validate/`, `replies/`,
  `fub/`, `transactional/`, `deliverability/` modules under existing
  services dir.
- **User-facing surface:** New pages: domains, mailboxes, replies. Modified:
  dashboard, campaigns, leads, settings.
- **Shared types / export hubs:** `src/types/crm.ts` (entity interfaces — extend, do not replace) + `src/types/database.ts` (Supabase auto-gen). Data-access layer at `src/lib/api/` (21 modules); query hooks at `src/hooks/use-*.ts` (16 hooks). See `CONNECT-CRM-AUDIT-DELTA.md` §2 for live paths.
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

## Audit log policy (v2.5)

The `audit_log` table is **append-only**. Enforced by Postgres RLS / role grants — not by application code:

- `REVOKE DELETE, UPDATE FROM all roles` on `audit_log`. Application service-account has `INSERT` only; admin/operator/viewer roles have `SELECT` only.
- Operators (admin / operator / viewer) can read but never write or delete. Admin role does not bypass the immutability — even CCPA right-to-delete (Task 1.0b) **preserves audit-log rows** for the deleted subject; the deletion event itself is appended as an audit-log row referencing the redacted record.
- Retention floor: **25 months minimum** (Reg B § 1002.12 maximum, per COMPLIANCE.md §9). No per-row TTL enforced. Manual archive after retention period only with counsel sign-off.
- Phase 1 acceptance: RLS test cases verify `DELETE FROM audit_log` and `UPDATE audit_log SET ...` both fail under all role grants.
- Final Validation Checklist references this section.

## Logging & observability (v2.5)

- **Format:** structured JSON, one event per line. Every event carries: `timestamp`, `level`, `service`, `event`, `correlation_id`, `actor` (system or user), and a typed payload. No free-form messages.
- **Destination:** Supabase logs for v1; consider Axiom or Logtail for production scale (revisit at Phase 4 / scale-up).
- **PII redaction (hard rule):** **NEVER log raw reply bodies, raw lead PII (SSN/income/address/DOB), or HMAC tokens** (cite COMPLIANCE.md §7 PII rules + §LLM provider requirements pre-LLM redaction). The redactor that runs before LLM input also runs before any log line that includes reply content.
- **Correlation ID propagation:** every webhook event gets a `correlation_id` UUID at sync receiver INSERT. The ID propagates through reply ingest → classifier → forwarder → FUB push so a single end-to-end trace is reconstructable from logs alone.
- **Retention:** 90 days hot (queryable), 12 months cold (archived). Tighter than `audit_log` because logs are operational, not legal — `audit_log` carries the legal retention burden.

### Alerting severity hierarchy

| Severity | Trigger examples | Response time | Channel |
|---|---|---|---|
| **P0** (page immediately) | Full system down: dispatcher offline > 15 min, webhook receiver returning 5xx > 5 min, all sending-pool mailboxes paused, `audit_log` write failing | Immediate | PagerDuty / SMS |
| **P1** (alert within 1h) | Single mailbox auto-pause via watchdog, Smartlead 429 sustained > 30 min, FUB push failures > 5 in 1h, classifier failure rate > 10%, webhook IP-allowlist rejecting non-trivially, slot-reaper firing > 5/h | 1h | Email + Slack |
| **P2** (digest) | Domain expiry within 30 days, ZeroBounce credits < 1000, DMARC RUA reports stale < 48h, hot-standby OAuth-test stale > 30d, CCPA-request `due_at` within 7 days | Daily digest | Email |

**Alert rate-limit:** maximum 3 emails/hour per severity per channel (prevents 3am flood from cascade failures). Throttling is per-(severity, channel, alert-kind) tuple, not global.

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
14. **Per-state footer editor (v2.5, per D17)** — 10+ variants by ISO state
    code. Each footer entry has `legal_approved` boolean, last-counsel-review
    date, and version (`COMPLIANCE_FOOTER_VERSION`). Hard gate: campaigns
    cannot launch with a footer template where `legal_approved=false`.
15. **RBAC roles UI (v2.5, per Task 1.0)** — admin/operator/viewer
    assignment per user. Audit-logged.
16. **CCPA delete-flow trigger (v2.5, per Task 1.0b)** — admin can run a
    delete request against an email or `lead_id`. 45-day SLA tracker.
    Deletion event preserved in `audit_log` even after subject data removal.
17. **Hot-standby pool view (v2.5, per D18, Task 0.9)** — read-only display
    of standby mailbox count, warmup progress, vendor (Litemail / EmailAstra /
    Infraforge), last-OAuth-test date. Activation procedure linked.
18. **Campaign preview / dry-run toggle (v2.5, per Task 1.0e)** — operator
    enables for any campaign before launch.
19. **Compliance-counsel approval status per campaign template (v2.5, per
    Task 0.8)** — last-reviewed-by, reviewed-on, approval flag.

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
DEFAULT_MAILBOX_DAILY_CAP=20         # v2.5: was 30; lowered per D19

# --- v2.5 additions ---
LIST_UNSUB_TOKEN_SECRET_PREVIOUS=    # for rotation; previous secret accepted during transition window
COMPLIANCE_FOOTER_VERSION=v1         # bump on per-state footer template changes; logged in audit_log per send
HOT_STANDBY_VENDOR=litemail          # litemail | emailastra | infraforge
HOT_STANDBY_API_KEY=
HOT_STANDBY_OAUTH_CALLBACK=
RBAC_DEFAULT_ROLE=viewer             # safe default
CCPA_DELETE_SLA_DAYS=45              # Cal. Civ. Code § 1798.105
RESERVED_SLOT_TIMEOUT_SECONDS=300    # janitor sweeps reserved slots older than this
WORKER_PROCESSING_TIMEOUT=120        # async webhook worker stuck-state janitor

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

- **Scenario:** Two concurrent jobs each try to send the 21st email of the
  day from a mailbox with cap 20.
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
12. **[RESOLVED by Locked Decision D24, 2026-05-01]** Smartlead outage contingency. Saleshandy is pre-onboarded before launch with webhook-signing capability verified in Phase 0.3 vendor-contracts work (the `SendProvider` interface from v2.1 must be wired with a working second implementation before v1 launch, not deferred). Instantly is **disqualified** for lending due to AUP custom-account gate (verified May 2026 against https://instantly.ai/instantly-sending-policy). Earlier "accept temporary downtime" default is `[superseded]`.
13. **[Phase 1, soft]** Volume ramp expectations. When does Lazer want to
    attempt 500/day? 1,000/day? Tied to inventory expansion, not calendar.

## Final Validation Checklist (v2.5)

- [ ] Phase 0 audit completed and this plan updated with concrete
      Connect-CRM paths from `CONNECT-CRM-AUDIT-DELTA.md`.
- [ ] No `[path TBD]` markers remain after Phase 0 (some `TBD Phase 0`
      markers may persist for vendor-contract verification — flagged
      explicitly in Phase 0.3).
- [ ] Plan re-reviewed by `plan-reviewer` after Phase 0 completes (only
      required if vendor-contract findings change architecture).
- [ ] All Phase-1-blocker Open Questions answered before Phase 1.
- [ ] All v1 success criteria verified manually before declaring v1 done.
- [ ] **CA mortgage-compliance counsel engaged before first send (Task 0.8, D20).**
- [ ] **Suppression-list seed-imported from FUB/legacy before first campaign (Task 0.10).**
- [ ] **Auth + RBAC enforced on all PII-bearing tables (Task 1.0): `replies`,
      `audit_log`, `suppressions`, `leads`.**
- [ ] **CCPA delete-flow tested end-to-end against a known recipient (Task 1.0b).**
- [ ] Resend transactional sends originate only from `notify.lazerlending.com`.
- [ ] No cold campaign send originates from `lazerlending.com` (root or any
      brand-root subdomain).
- [ ] List-Unsubscribe `<https://...>` AND `<mailto:...>` AND
      `List-Unsubscribe-Post: List-Unsubscribe=One-Click` confirmed by
      raw-MIME inspection.
- [ ] List-Unsubscribe endpoint idempotent + uses `crypto.timingSafeEqual`
      for HMAC verify + supports `LIST_UNSUB_TOKEN_SECRET_PREVIOUS` rotation.
- [ ] List-Unsubscribe endpoint bypasses CSRF and is unauthenticated.
- [ ] **Per-state compliance footer assembled dynamically; raw-MIME
      inspection confirms correct license disclosure for CA/NY/TX/NJ/FL
      test recipients (Task 1.0c, D17).**
- [ ] DMARC `p=none` + `rua` configured on every burner at launch;
      aggregate-report aggregator receiving reports + alert on `0 reports
      in 7d`.
- [ ] `dmarc-ramp-evaluator` job functional.
- [ ] All vendor API keys are in `.env`, never in code or fixtures.
- [ ] Smartlead webhook signature verification rejects unsigned payloads
      + alert on `0 events accepted in 60min during business hours`.
- [ ] **Webhook receiver hardening (Task 1.8c):** per-route rate limit (10
      req/s for `/api/webhooks/smartlead`, 5 req/s for `/api/list-unsubscribe`),
      IP allowlist on `/api/webhooks/smartlead`, replay-window enforcement
      (1h max stale), DDoS protection at edge — all verified by load test
      and synthetic stale-timestamp test.
- [ ] **Webhook receiver uses deferred-processing pattern: 200 OK after
      idempotency-INSERT, real work in async worker (Task 1.8, D23).**
- [ ] Webhook idempotency by `(provider, external_event_id)` enforced.
- [ ] Suppression list checked at enqueue AND inside dispatcher claim
      transaction.
- [ ] Daily-cap reset runs as a single hourly sweep job (NOT per-mailbox-TZ
      cron) and zeroes `today_sent_count` when local-midnight has passed
      since last reset; alert if any mailbox `last_reset_at < now-25h`.
- [ ] Watchdog uses Wilson lower-bound + **independent** hard-complaint
      escape hatch (rate path and hard rule fire INDEPENDENTLY).
- [ ] Daily reconcile job runs and corrects vs Smartlead truth.
- [ ] `email_normalized` populated and unique-indexed; **Gmail dot-collapse
      applied only when domain ∈ {gmail.com, googlemail.com}**; Outlook /
      Yahoo / Proton retain dots.
- [ ] Hard bounce → global suppression + future-step cancellation verified.
- [ ] **Stop-on-reply fires on ALL replies at v1 (D22), not just non-low-conf
      negative.**
- [ ] Classifier failover (timeout/error → null + flag) verified.
- [ ] **Classifier regex pre-filter for opt-out language tested; runs
      BEFORE LLM call (D21).**
- [ ] Non-English/Spanish replies routed to human review (not auto-FUB).
- [ ] LLM provider has no-train DPA (per OQ — Anthropic API or OpenAI
      Enterprise, NOT OpenAI standard).
- [ ] PII redactor runs before LLM input + has its own eval set.
- [ ] Reply body retention window enforced by background job.
- [ ] **Hot-standby mailboxes provisioned and warmup-ready before launch
      (Task 0.9, D18).**
- [ ] **System health dashboard live and showing all 9+ metrics (Task 1.0d).**
- [ ] **Campaign preview / dry-run mandatory before launching any new
      campaign (Task 1.0e).**
- [ ] **Slot-leak test: 100 simulated Smartlead 5xx responses produce
      zero leaked slots after janitor (`reapStaleReservations`) runs.**
- [ ] **Audit-log immutability (per §Audit log policy):** RLS test cases
      verify `DELETE FROM audit_log` and `UPDATE audit_log SET ...` both
      fail under admin / operator / viewer roles; application service-account
      has INSERT only.
- [ ] **Structured logging (per §Logging & observability):** end-to-end
      `correlation_id` traceable from webhook receive → classifier → forwarder
      → FUB push for a sample reply event; redactor verified to strip
      SSN/PII patterns from any log line carrying reply content.
- [ ] **Alerting hierarchy (per §Logging & observability):** synthetic
      P0/P1/P2 triggers each fire to the correct channel (page / email+slack
      / digest) within the documented response time; rate-limit caps verified
      under flood (max 3/h per severity per channel).

## Deprecated / Removed Code

- ~~Connect CRM's Resend-as-cold-sender code path is removed.~~ Per
  audit Gaps lens + `CODEBASE_ANALYSIS.md`, this code path does not exist
  in the scaffold. v2.1's line is misleading and removed in v2.5. Resend
  is still scoped to `transactional/resend-client.[ext]` for system mail.
- ~~Connect CRM's existing warmup module is removed.~~ Same: per
  `CODEBASE_ANALYSIS.md` §1, no working warmup module exists. PRD §5.2's
  "warmup logic built in" was UI-mock language. Smartlead's bundled
  warmup is the v1 implementation.
- Any subdomain-rotation-on-`lazerlending.com` plumbing in Connect CRM
  (if present) is removed. (Caveat retained — actual presence not yet
  verified against live code; Phase 0.1 verification confirms.)
- v2.1's stop-on-reply exception (`negative` low confidence does NOT stop)
  is superseded by D22; remove any handler-level guard that preserves the
  v2.1 behavior.
- v2.1's per-mailbox-TZ cron job for daily-cap reset is superseded by the
  single hourly sweep pattern; if v2.1-style code lands during early
  Phase 1, replace with the v2.5 pattern.

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
- **Trusting GLBA blanket-exemption for CCPA on prospect records** (per
  research §Q3 — GLBA exemption is data-level only; pre-application
  prospect records ARE subject to CCPA delete).
- **Single global compliance footer** (per D17 — must be per-state with
  10+ variants).
- **Skipping classifier regex pre-filter for opt-out language** (per D21 —
  each missed opt-out is a potential CAN-SPAM violation at $53,088).
- **Treating Wilson watchdog as the primary signal at v1 volume** (per
  audit §1 — the rate path is mathematically dormant below ~400 sends/24h;
  hard-complaint rule is primary at v1).
- **Synchronous webhook handlers that include LLM calls** (per D23 —
  Smartlead retries on slow handlers; double-process risk).
- **Per-mailbox-TZ cron job for daily-cap reset** (per audit §1 — single
  hourly sweep is simpler and self-recovering).
- **HMAC token verification with `===`** (per audit §1 — must use
  `crypto.timingSafeEqual` to prevent timing attacks).
- **Applying Gmail dot-collapse globally** (per audit §1 — over-merges
  Outlook / Yahoo / Proton addresses; apply only when domain ∈
  {gmail.com, googlemail.com}).

## Confidence Score (v2.5)

**One-pass implementation confidence: 8/10 baseline**, but ONLY if all of
the following are true:

- v2.5 corrections (D17–D24, pseudocode Fixes 1–10) are applied as
  written;
- Realistic 14–20 dev-week timeline is accepted by all stakeholders
  (per audit §5 Engineering Effort);
- California mortgage-compliance counsel is engaged before first send
  (per Task 0.8, D20);
- Hot-standby mailboxes are provisioned (per Task 0.9, D18);
- Suppression-list seed-import is completed before campaign #1 (per
  Task 0.10).

If any of those slip, confidence drops to **5/10** — the system either
won't ship on time, won't survive its first month under regulatory
attention, or will leak slots and double-process replies in production.

v2.1 was 7/10 (raised from 6/10 by reviewer pass). v2.5 raises to 8/10
because the audit + research validation closed 8–10 named correctness
bugs in v2.1's pseudocode and added the auth/RBAC/CCPA/footer/standby
gaps that v2.1 hand-waved. The 1-point ceiling vs 9/10 reflects vendor
capability questions Phase 0.3 must verify (Mailforge tenant isolation,
Saleshandy webhook signing, Smartlead lending-vertical AUP enforcement
history) and the open question about whether Lazer's data broker is
HBPPA-restricted.

Limited by:

- Connect CRM stack and existing patterns are partially known (verified
  by post-clone audit, 2026-04-30) but Supabase migration state and edge
  function content not yet walked. Phase 0.1 verification closes this.
- Smartlead/Mailforge/Saleshandy API specifics need first-hand
  verification (Phase 0.3).
- LLM classifier accuracy depends on Lazer-authored eval set (Task 2.1a)
  + prompt iteration. 100+ labeled lending replies is the gating effort.
- California § 17529.5 plaintiff-firm activity is unpredictable; counsel
  engagement reduces but does not eliminate risk.

### Schedule reality (per audit §5 Engineering Effort)

Implicit single-quarter framing in v2.1 was wrong. Realistic dev-weeks:

| Phase | Dev-time | Notes |
|---|---|---|
| Phase 0 | **5–10 working days** | Plus 3–6 weeks calendar for client kickoff to close OQs |
| Phase 1 | **8–12 weeks** single FT engineer with Claude assistance | 38–57 working days across Tasks 1.0–1.17 |
| Phase 2 | **3–5 weeks** | Classifier prompt iteration + eval set + redactor + IMAP forward integration |
| **Total to v1** | **14–20 dev-weeks** | + 5-week real-time floor for warmup that cannot be parallelized |
| Phase 3 (v2) | not pre-scheduled | 2–3 weeks when triggered (placement check) |
| Phase 4 (v2) | not pre-scheduled | 1–2 weeks when triggered (auto-rotation) |

Distribution: ~60–70% of Phase 1 is mechanical plumbing (FUB CRUD,
ZeroBounce client, Resend wrapper, settings UI, domains/mailboxes pages);
genuinely hard novel work concentrates in 5 areas — atomic dispatcher
correctness, classifier prompt + eval set + failover, DMARC RUA XML
parser, IMAP forwarding integration, Mailforge state-machine integration.
The 17-task framing in v2.1 created a uniform-difficulty illusion that
the schedule reality table corrects.

---
