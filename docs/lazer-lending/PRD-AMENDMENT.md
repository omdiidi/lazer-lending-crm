# PRD Amendment v1 — Lazer Lending CRM Architecture Substitutions

**Date:** 2026-05-01
**Version:** v1 (initial amendment)
**Parties:** Lazer Lending ("Client") and IntegrateAPI ("Builder")
**Amends:** `docs/lazer-lending/PRD.md` (original outcome contract)
**Companion docs:** `BRIEF-email-architecture.md`, `PLAN.md` (v2.5), `COMPLIANCE.md`, `CHARGE-ABILITY.md`, `VENDOR-CONTRACTS.md`
**Source citations:** `tmp/research/2026-05-01-feasibility-validation.md`, `tmp/review-notes/2026-05-01-codex-feasibility-audit.md`

---

## §1 Statement of intent

This amendment modifies the architecture described in `PRD.md`. **The seven core outcomes (PRD §3, restated in §6 below) are preserved.** The substitutions below are required by 2025–2026 deliverability and acceptable-use realities documented in the companion research file and do not constitute scope reduction. Several substitutions add scope (RFC 8058 List-Unsubscribe, DMARC RUA, per-state compliance footers, hot-standby inventory, CCPA delete flow, auth/RBAC) that did not exist in the PRD because the PRD predates the November 2025 Gmail bulk-sender enforcement and the May 2025 Microsoft Outlook enforcement.

Lazer Lending is asked to acknowledge these substitutions in writing before Phase 1 implementation begins. Phase 0 work (vendor sandbox provisioning, audit-delta, client kickoff) may proceed in parallel with this signoff.

---

## §2 Architecture substitutions (side-by-side redline)

| Original PRD spec | Replacement in v2.5 plan | Reasoning + source |
|---|---|---|
| **PRD §3 Ship #1:** "Lazer can warm 3 subdomains on lazerlending.com through a multi-week warmup process." | "Lazer can warm N burner-domain mailboxes (default 5, target 5–10 across 2–4 brand-affiliated burner domains)." | Subdomain rotation on a single brand root provides only partial reputation isolation. Cold-outreach abuse on `mail.lazerlending.com` would propagate to `lazerlending.com` root reputation at Gmail/Outlook. The 2025 enforcement waves (Gmail Nov 2025, Outlook May 5, 2025) require SPF + DKIM + DMARC alignment plus complaint rate < 0.3% — at scale, brand-root contamination is a brand-survival risk. Burner-domain pools are the dominant 2025–2026 operator pattern for cold outreach in regulated verticals. **Source:** BRIEF D1, research §Q1 + §Q2 (Google EDU/panel crackdown October 2025; Smartlead+Workspace pairing named as elevated-risk configuration). |
| **PRD §3 Ship #2:** "Lazer can send a 100-email campaign from a warmed subdomain via Resend." | "Lazer can send a 100-email campaign through Smartlead-managed warmed mailboxes on burner domains. Resend is retained exclusively for transactional notifications on `notify.lazerlending.com`." | Resend's published AUP tolerates cold under thresholds, but (a) Resend is API-mail rather than real-mailbox-sent, which underperforms at Gmail filtering, (b) Resend does not bundle warmup, (c) Resend does not provide reply webhooks suitable for cold-outreach reply handling. Smartlead Pro provides headless API + bundled warmup + reply webhooks at the price tier the Lazer build targets. **Source:** BRIEF D2 + D4, research §Q1 (Smartlead AUP silent on lending vertical; restricts on method not vertical). |
| **PRD §3 Ship #6:** "Manual subdomain rotation works from a single button." | "Manual burner-domain rotation works from a single button. Within 60 seconds of rotation, sends stop on the rotated domain's mailboxes (rotation also calls Smartlead's pause-campaign / cancel-queued-sends API to clear in-flight queue)." | UX preserved as a single-button rotation. Object being rotated is now a burner domain instead of a brand subdomain. The 60-second guarantee is added because Smartlead may have hours of queued sends per mailbox; pausing only the local DB does not recall those. **Source:** Audit §1 (operational finding). |
| **PRD §5.1:** "All sending happens on rotating subdomains of lazerlending.com. Examples: mail.lazerlending.com, send.lazerlending.com, go.lazerlending.com." | "All cold sending happens on rotating brand-affiliated burner domains (e.g., `lazer-loans.com`, `lazerlending-mail.com`). The brand root `lazerlending.com` is reserved for transactional and human correspondence and never sends cold mail." | See PRD §3 Ship #1 reasoning. **Source:** BRIEF D1, research §Q2. |
| **PRD §5.2:** "Connect CRM has warmup logic built in. This project hardens it significantly." | "Warmup capabilities are delivered via Smartlead's bundled warmup network. PRD §5.2 capability expectations are mapped to Smartlead capabilities in `WARMUP-CAPABILITY-MAP.md`. Connect CRM scaffold is wired to Supabase but has no production-grade warmup module (the existing helper is a stub per CONNECT-CRM-AUDIT-DELTA.md §5)." | Connect CRM's `supabase/functions/_shared/warmup.ts` is a possible stub per the post-clone audit; there is no real warmup engine to harden. Smartlead bundles real-network warmup (real-inbox delivery, ramp schedule, simulated engagement, spam recovery, ongoing low-volume warmup traffic). The capability-map doc preserves the PRD intent without re-implementing warmup in-house. **Source:** `CONNECT-CRM-AUDIT-DELTA.md` §5, research §Q1. |
| **PRD §5.5:** "Torched root detection (banner alerts, root-buying flow, root history log, DMARC monitoring on the brand)." | "Routine inventory rotation. Burner retirement is operationally inexpensive; the brand root is architecturally insulated from cold abuse and cannot be 'torched' by cold-outreach activity by construction. A read-only 'brand-root health' status card on the dashboard preserves the original PRD's monitoring intent (DMARC RUA + Google Postmaster Tools)." | Under the burner-domain architecture, the brand root never sends cold and therefore cannot be torched by cold-outreach activity. The torched-root emergency mitigation in PRD §5.5 is unnecessary by construction. The dashboard status card prevents the visible feature from being silently dropped. **Source:** Per BRIEF D1 + PLAN.md Locked Decision 9. |
| **PRD §4 inventory model:** "Subdomain pool at target: 3 to 5 warmed subdomains, hard-capped at 300/day each." | "Burner inventory at target: 5–10 mailboxes across 2–4 burner domains at v1 (100–300/day); ~50 mailboxes across ~17 burners at the 1,000/day scale path. Per-mailbox cap revised to 15–25/day (default 20)." | Inventory shape changed from "few subdomains × high-per-subdomain volume" to "many mailboxes × low-per-mailbox volume" — the dominant 2025–2026 cold pattern post-Google crackdown. Lower per-mailbox cap reduces per-mailbox spam-trigger probability. **Source:** BRIEF D1, research §Q2 (post-October-2025 consensus 15–25/day). |
| **PRD §3 Ship #5:** "Spam placement check via seed inboxes detects when a campaign starts landing in spam, and pauses it." | Deferred to v2 (Phase 3). Same DoD; explicit re-confirmation required from Lazer that v1 launch is acceptable without it. | Per-vendor seed-inbox availability and the data-plumbing for placement scoring add ~3 weeks of scope that competes with launch readiness on auth, RBAC, suppression-import, per-state footer, and hot-standby provisioning. v1 launches with hard watchdog (Wilson lower-bound + hard-complaint rule) and DMARC RUA monitoring; v2 adds placement check. **Source:** Audit §2 (PRD-drift requires explicit client confirmation). |
| **PRD §3 Ship "Not in scope (v1)" #1:** "Automatic subdomain rotation triggered by spam placement or bounce thresholds." | Confirmed deferred to v2 (Phase 4). Manual rotation in v1 is correct. | Unchanged from PRD intent. v1 manual rotation is operationally sufficient at 100–300/day. **Source:** PRD §3, audit §verdict. |
| **PRD "Open Questions" #5:** "Build warmup in-house or integrate external warmup service?" | **Resolved:** Smartlead bundled warmup. Connect CRM scaffold is wired to Supabase but has no production-grade warmup module (the existing helper is a stub per CONNECT-CRM-AUDIT-DELTA.md §5). | See PRD §5.2 row above. **Source:** `CONNECT-CRM-AUDIT-DELTA.md` §5, BRIEF D2. |

---

## §3 New deliverables added since PRD signing

These items are not in the original PRD but are required by 2025–2026 deliverability and compliance enforcement and by gaps the codex-review feasibility audit identified. They are part of v1 scope and are reflected in the build fee in `CHARGE-ABILITY.md`.

| Deliverable | Reasoning + source |
|---|---|
| **RFC 8058 List-Unsubscribe (one-click)** — both `<https://...>` and `<mailto:...>` URI variants plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header on every cold send. | Mandatory under Gmail November 2025 bulk-sender enforcement and Outlook May 5, 2025 enforcement for any sender at meaningful volume. Non-compliance results in SMTP-level rejection (550 5.7.515) at Outlook and routes to spam at Gmail. **Source:** research §Q1 (Suped + Ironscales summaries of Google's Nov 2025 update). |
| **DMARC RUA aggregator + DMARC-ramp evaluator job** | Gmail Nov 2025 requires `p=none` minimum + alignment for bulk senders. Lazer's DMARC-ramp policy (per BRIEF D7: 4–6 weeks at `p=none` with clean RUA, then `p=quarantine`) requires aggregate-report ingestion. Default RUA aggregator is Cloudflare DMARC Management free tier; `dmarc-ramp-evaluator` is an internal job that gates the policy bump. **Source:** BRIEF D7, research §Q1, audit §4. |
| **Per-state compliance footer engine** | Residential mortgage cold email is governed by a stack of state-by-state advertising rules. Footer must be assembled dynamically per recipient state with at minimum 10 variants (CA, NY, FL, NJ, TX, MA, MD, IL, AZ, CT) plus the federal SAFE-Act floor (NMLS unique identifier). California requires DRE/DFPI license disclosure; Texas requires 12-point minimum font + NMLS ID; New York requires "Registered Mortgage Broker — NYS DFS" legend + NY office address. **Source:** research §Q3 (state-by-state table). |
| **Hot-standby mailbox inventory (5 pre-warmed accounts)** | Mailforge tenant suspension probability over 12 months is 20–40% per the October–November 2025 Google crackdown; cold-recovery without standbys is 7–10 weeks (DNS + DKIM/SPF/DMARC + 6–8 weeks warmup). Hot-standby provisioning at $25–85/month converts recovery to 24–72 hours. **Source:** research §Q2 (Litemail $4.99/inbox; EmailAstra $4–7; Infraforge $17). |
| **CCPA right-to-delete flow over prospect records** | The audit incorrectly assumed GLBA blanket-exempts mortgage prospect records from CCPA. The exemption is data-level, not entity-level. Pre-application prospect records (consumer never applied) are NOT GLBA-covered and ARE subject to CCPA right-to-delete with a 45-day SLA per Cal. Civ. Code § 1798.105. **Source:** research §Q3 (CCPA correction). |
| **Auth + RBAC layer** | Connect CRM ships with a mock `AuthContext`. Production cannot operate on a mock auth context — reply bodies contain SSN fragments and lending PII; access must be role-gated. v2.5 plan adds Supabase Auth integration with roles `admin`, `operator`, `viewer` enforced via Supabase RLS on PII-bearing tables (`replies`, `audit_log`, `suppressions`, `leads`). **Source:** audit §7 (Gaps lens). |
| **Suppression-list seed import from FUB / legacy unsubscribes** | First cold campaign without a seed import would mail people who already unsubscribed via FUB or legacy tools, generating an immediate complaint-rate spike before the watchdog has data. Phase 0.10 task imports Lazer's existing FUB/legacy unsubscribe and complaint records into the `suppressions` table before campaign #1. **Source:** audit §7. |
| **Webhook deferred-processing pattern** | Smartlead's at-least-once webhook delivery with 10–30s retry windows requires the receiver to return 200 OK immediately after idempotency-INSERT and run LLM classifier + forwarder + FUB push in a deferred async job. A synchronous handler that includes a 5s LLM call risks Smartlead retry → double-process. **Source:** Smartlead help-center article on webhook failures (https://helpcenter.smartlead.ai/en/articles/417-how-to-resolve-webhook-failures), audit §1. |
| **California mortgage-compliance counsel pre-launch** | California Business & Professions Code § 17529.5 imposes $1,000-per-email strict-liability private right of action with no proof-of-harm requirement, actively litigated by Pacific Trial Attorneys and similar firms. SPF/DKIM/DMARC failures on California-addressed mail are statutory exposure. Initial CA-counsel review of cold-mail templates + footers + auth-perfection is required before first send. Counsel cost ($5,000–$15,000 initial + $1,000–$3,000/month retainer) is separate from the build fee and billed directly to Lazer. **Source:** research §Q3 (California § 17529.5 deep-dive). |
| **System-health dashboard, campaign preview / dry-run flow, OPS-RUNBOOK** | Operational readiness items the audit Gaps lens flagged. The system-health dashboard surfaces dispatcher backlog, classifier failure rate, webhook receiver uptime, cron last-run age, FUB push error rate, ZeroBounce credit balance, Smartlead 4xx/5xx error rate, and DMARC RUA last-received age. The campaign preview lets the operator see total emails / mailboxes / time-to-complete / footer preview / List-Unsub URL preview / raw-MIME of one outbound message before clicking Launch. The OPS-RUNBOOK documents the 10 most likely production incidents. **Source:** audit §7. |

---

## §4 Pricing summary

`CHARGE-ABILITY.md` is the authoritative pricing document. Summary:

- **Build fee (Phase 0+1+2 v1):** $95,000 fixed-bid (or phased: $80k Phase 0+1, $18k Phase 2 quoted after Phase 1 ships).
- **Monthly retainer:** $2,200/month all-in, includes vendor passthroughs up to $150/month, 10 hr/month cap, overage at $150/hour.
- **v2 (Phase 3 placement check + Phase 4 auto-rotation):** $28,000, quoted separately when triggered.
- **Hot-standby mailbox provisioning:** $25–85/month ongoing (separate line item).
- **California mortgage-compliance counsel:** $5,000–$15,000 initial review + $1,000–$3,000/month retainer (billed directly to Lazer).

---

## §5 Schedule reality (honest)

The original PRD did not include a project schedule. The codex-review audit found the implicit "single quarter" framing in the v2.1 plan was unrealistic. The honest schedule is:

| Phase | Calendar duration | Reasoning |
|---|---|---|
| **Phase 0 (Audit & Foundation)** | 5–10 working days for the technical work; **3–6 weeks calendar** when accounting for the client kickoff to close the 13 Open Questions | Vendor sandbox provisioning, audit-delta doc, Supabase lock, smoke-test, plan re-review. Client-kickoff calendar drag is the binding constraint. |
| **Phase 1 (Send Layer + Warmup + Compliance)** | 8–12 dev-weeks single FT engineer with Claude assistance | Full per-task breakdown in `PLAN.md` §Schedule reality. Auth + RBAC, mock-data → real-data migration, CCPA delete flow, per-state footer engine, system-health dashboard, campaign preview, hot-standby activation procedure are net-new tasks added in v2.5. |
| **Phase 2 (Reply Handling + FUB)** | 3–5 dev-weeks | Classifier prompt iteration, eval-set authoring (200+ labeled replies × 5 classes × 2 languages), PII redactor accuracy testing, IMAP forward integration. |
| **Total v1 ship** | **14–20 dev-weeks + 5-week real-time floor for warmup** | Warmup is real-clock and cannot be parallelized away. |
| **Phase 3 (v2: Spam placement check)** | 3–5 weeks when triggered | Not pre-scheduled. |
| **Phase 4 (v2: Auto-rotation + retirement)** | 1–2 weeks when triggered | Not pre-scheduled. |

---

## §6 Acknowledgments

By signing below, Lazer Lending acknowledges:

1. **The seven core outcomes (PRD §3) are preserved.** Restated:
   - (1) Lazer can run cold email campaigns safely and at meaningful volume.
   - (2) Leads can be uploaded, cleaned, and validated.
   - (3) Emails can be sent without damaging domain reputation or getting the system blocked.
   - (4) Replies can be captured, classified, and routed.
   - (5) Positive or qualified replies can be forwarded to the right Lazer team member.
   - (6) Only qualified warm leads get pushed into Follow Up Boss.
   - (7) The system protects deliverability as much as possible.
2. **Architectural substitutions in §2 are research-grounded** and trace to `tmp/research/2026-05-01-feasibility-validation.md`.
3. **New compliance and deliverability requirements in §3 are mandatory** under 2025–2026 sender enforcement (Gmail Nov 2025, Outlook May 2025, RFC 8058) and California mortgage advertising statutes — they are not optional add-ons and they are within v1 scope.
4. **California mortgage-compliance counsel must be retained before first send.** Cost is separate from the build fee and is billed directly to Lazer.
5. **Spam placement check (PRD §3 Ship #5) is deferred to v2.** Confirmed acceptable for v1 launch.
6. **The schedule in §5 is realistic.** v1 ships in 14–20 dev-weeks plus the warmup floor, not in a single quarter.
7. **The pricing summary in §4 is accepted** as the basis for the engagement letter governed by `CHARGE-ABILITY.md`.

---

## §7 Signature block

**Lazer Lending**

Name (printed): _________________________________

Title: _________________________________

Signature: _________________________________

Date: _________________________________

**IntegrateAPI**

Name (printed): _________________________________

Title: _________________________________

Signature: _________________________________

Date: _________________________________

---

*End of PRD Amendment v1. The original `PRD.md` remains the historical outcome contract. Any future architecture changes require a new amendment.*
