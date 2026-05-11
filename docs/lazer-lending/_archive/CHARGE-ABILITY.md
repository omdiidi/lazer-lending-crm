# Charge-Ability — Lazer Lending CRM Pricing, Termination, SLA, and Engagement Letter Terms

**Date:** 2026-05-01
**Version:** v1
**Parties:** Lazer Lending ("Client") and IntegrateAPI ("Builder")
**Authority:** This document governs the commercial terms of the build and operations engagement. It is referenced from `PRD-AMENDMENT.md` §4 and incorporates the schedule reality from `PRD-AMENDMENT.md` §5. Pricing is anchored to `tmp/research/2026-05-01-feasibility-validation.md` §Q4 (custom-build market data, late 2025 / early 2026).

---

## §1 Recommended quote

Two equivalent options. Lazer chooses one.

### Option A — Single fixed-bid + retainer

| Component | Amount | Notes |
|---|---|---|
| **Build fee (Phase 0+1+2 v1)** | **$95,000 fixed-bid** | Net-30 invoicing. 25% on signature, 25% on Phase 0 signoff, 25% on Phase 1 signoff (v1.SC1–SC11 verified), 25% on Phase 2 signoff. |
| **Monthly retainer** | **$2,200/month all-in** | Includes vendor passthroughs up to $150/month. 10 hr/month cap on engineering. Overage at $150/hour, prior approval required. |
| **v2 (Phase 3 placement check + Phase 4 auto-rotation)** | **$28,000** | Quoted as a separate engagement when Lazer triggers it. Same termination + SLA terms as v1. |
| **Hot-standby mailbox provisioning (ongoing)** | **$25–85/month** | NOT in build fee. Separate line item per `PRD-AMENDMENT.md` §3. Vendor passthrough at cost (Litemail $4.99/inbox, EmailAstra $4–7/inbox, Infraforge $17/inbox). |
| **California mortgage-compliance counsel** | **$5,000–$15,000 initial + $1,000–$3,000/month retainer** | Billed directly by counsel to Lazer. Required pre-launch per `COMPLIANCE.md`. Not in IntegrateAPI build fee. |

### Option B — Phased fixed-bid (recommended given 13 unanswered Open Questions)

| Component | Amount | Notes |
|---|---|---|
| **Phase 0 + Phase 1** | **$80,000 fixed-bid** | Phase 0 signoff at 30%, Phase 1 signoff (v1.SC1–SC11 minus reply-handling) at 70%. |
| **Phase 2** | **$18,000** | Quoted after Phase 1 ships, based on what Phase 1 learned about classifier accuracy, IMAP forwarder feasibility, and FUB pipeline mapping. Lazer can stop after Phase 1 and use the operator UI to dispatch sends + manually forward replies if Phase 2 scope feels wrong. |
| **Monthly retainer, v2, hot-standby, counsel** | Same as Option A | |

**Recommendation:** Option B. The 13 unanswered Open Questions in `PLAN.md` (per-state footer language, IMAP forwarder feasibility, Smartlead-failover vendor onboarding, classifier eval set authoring, etc.) place 100% of scope risk on IntegrateAPI under a pure fixed bid. Option B distributes risk: Lazer pays for what's been learned, IntegrateAPI re-scopes Phase 2 with knowledge.

---

## §2 Pricing reasoning (with market comparables)

### Custom-build market anchors (late 2025 / early 2026)

- **Purrweb 2026** (https://www.purrweb.com/blog/crm-development-cost/): Medium-complexity custom CRM (custom automation + 4–6 vendor integrations + role-based access) — the bucket Lazer Lending CRM falls into — quotes at **$98,000–$140,000**. Lazer build at $95,000 sits at the conservative floor of this bucket.
- **Cleveroad 2026** (https://www.cleveroad.com/blog/crm-development-cost/): General custom CRM range $30,000–$200,000. Each complex API integration is $6,000–$10,000. Lazer integrates 5 vendor APIs (Smartlead, Mailforge, ZeroBounce, FUB, Resend) — API integration alone is $30,000–$50,000 by this metric.
- **Clutch April 2026 dev pricing** (https://clutch.co/developers/pricing): Average all-software-engagement cost is **$132,480 over 13 months**. The Lazer build at $95,000 is below this average, supporting a "you're getting a fair deal" anchor.
- **ThoughtBot via Clutch** (https://clutch.co/profile/thoughtbot): Published rate $150–$199/hour; minimum project $10,000. ThoughtBot would scope Lazer at $90,000–$140,000 without flinching.
- **Galaxy Weblinks 2026** (https://www.galaxyweblinks.com/blog/custom-crm-development-cost): Same $30,000–$200,000 range. AI integration alone is $20,000–$150,000 (Lazer classifier sits at the low end of this).
- **FullStack Labs 2025 pricing guide** (https://www.fullstack.com/labs/resources/blog/software-development-price-guide-hourly-rate-comparison): U.S. mid-market agency $120–$250/hour blended. Lazer at $95,000 ÷ ~700 hours = **$135/hour** blended — within market for U.S. delivery.

### Cold-outreach agency comparison (the ROI ceiling)

Full-service cold-outreach agencies bundle copy + lead lists + inbox infrastructure + reply handling. Lazer's alternative path:

- **Belkins** (https://outboundsalespro.com/belkins-review/): $5,000–$14,800+/month retainer; 3–6 month minimum.
- **Martal Group** (https://outboundsalespro.com/best-appointment-setting-companies/): $3,600–$8,000/month; 3-month pilot required.
- **Boutique cold-email agencies** (https://reachoutly.com/cold-email/agency-pricing/): $2,500–$5,000/month boutique; $4,000–$10,000/month mid-sized; $8,000–$25,000+/month enterprise. Setup $1,500–$5,000.
- **Cold Outreach Agency** (https://coldoutreachagency.com/cold-outreach-agency-pricing-breakdown/): Low-end $1,500–$2,500/month; mid $3,000–$7,000/month.

**ROI math:** Custom build at $95,000 + $2,200/month × 36 months = **$174,200 over 3 years**, Lazer owns the asset, owns the data, owns the FUB integration. Agency at $4,000/month × 36 months = **$144,000 over 3 years**, Lazer owns nothing, depends on the agency's continued willingness to serve mortgage cold outreach (a vertical many agencies have stopped serving in 2025–2026).

**Crossover:** Build wins on horizon over **18 months at $4,000/month agency** or **12 months at $6,000/month agency**. For any horizon longer than 18 months, custom build is the rational choice.

### Mortgage-vertical CRMs do NOT cap pricing

Mortgage CRMs are inbound-nurture systems, not cold-outreach systems.

- **BNTouch** (https://www.itqlick.com/bntouch-mortgage-crm/pricing): $59–$249/user/month.
- **Surefire (ICE/Black Knight)** (https://www.capterra.com/p/202529/Surefire-CRM/): $150–$250+/month per license.
- **Total Expert** (https://www.capterra.com/p/146103/Total-Expert/): From $69/user/month; targets 50+ LOs.
- **Whiteboard / Aidium** (https://www.softwareadvice.com/crm/whiteboard-mortgage-profile/): 3-user minimum, $79–$150/user/month.

None of these include cold-email warmup, burner-domain pooling, deliverability infrastructure, or suppression management. They solve a different problem. Lazer would still need a cold-outreach system on top. **Mortgage-CRM pricing is irrelevant to the IntegrateAPI quote.**

### Why $95,000, not $85,000

The codex-review audit suggested a $85,000–$110,000 range. Research validation revised the floor to $95,000 because:

- 700 hours at $125/hour blended is aggressive for a 25-task v1 with tests, migrations, edge functions, 5 vendor integrations, and a per-state footer engine. 760 hours at $125/hour = $95,000 with a 10% contingency.
- ThoughtBot's published rate ($150–$199/hour) would scope this at $105,000–$150,000.
- Clutch's all-software average is $132,000 — $95,000 is below average, defensible as a fair-deal anchor.
- $95,000 is below the Purrweb medium-complexity floor of $98,000 — good for closing.

---

## §3 Retainer floor analysis

### Direct cost

| Component | Monthly cost |
|---|---|
| Vendor passthroughs (Smartlead Pro $94 + Mailforge ~$25 + ZeroBounce ~$10 + Resend free tier) | ~$130 |
| 6 hours engineering at $125/hour loaded | $750 |
| 1 hour PM / weekly health review | ~$125 |
| **Total direct cost** | **~$1,005** |

### Margin at $2,200/month

- Gross margin: $1,195/month (~54%) — sustainable, covers incident months and benefits/overhead.

### Why not $1,800/month (the audit's original suggestion)

At $1,800/month, gross margin is ~$795/month. Any incident month (2 hours of unscheduled work) erases margin. The retainer is structurally thin under Smartlead 4xx/5xx incidents, classifier-prompt iteration, FUB API breakage, or DMARC ramp re-evaluation — all of which are normal operations for this product. $2,200/month is the lowest defensible floor.

### Compared to in-house ops

- In-house ops hire at $50,000–$65,000/year loaded = **$4,200–$5,400/month equivalent**.
- $2,200/month retainer is **3× cheaper than in-house** for Lazer.
- Sustainability for Lazer at $2,200/month is strong; sustainability for IntegrateAPI is acceptable.

---

## §4 Termination clause

### What Lazer owns

On termination for any reason, Lazer retains ownership of and full export rights to:

1. **CRM source code** (with a perpetual royalty-free license back to IntegrateAPI for portfolio and template-reuse purposes).
2. **Lazer-branded UI assets** (logos, color tokens, copy, templates).
3. **Classifier prompts** (work-product, including any prompt iteration that landed in production).
4. **All prospect data** (leads, sends, replies, conversations, suppressions, audit logs).
5. **Suppression list** — full export in CSV + JSON, with `source_campaign_id`, `source_send_id`, and per-sender records preserved (CAN-SPAM portability).
6. **Follow Up Boss API tokens** (transferred back; IntegrateAPI removes from secret stores).
7. **All campaign templates and content** (subject lines, body templates, footer templates including per-state variants).
8. **All operational data** — sends log with timestamps + IPs + headers, RUA reports, opt-out log with 10-day-honor evidence, bounce data.
9. **All configuration** (settings, footer templates, routing rules, RBAC role assignments).

### What IntegrateAPI owns

1. **Smartlead account credentials** — transferable to Lazer's name on a 30-day handoff for a one-time **$2,500 handoff fee** that covers reconfiguring API keys, rotating webhook secrets, transferring billing, and a 30-day post-handoff support window.
2. **Mailforge inventory** — **NON-transferable**. Burner domains revert to retirement at Mailforge per Mailforge's reseller terms. Lazer keeps any directly-registered burners (those Lazer registered itself outside Mailforge). Plan to register at least 2 burners directly in Lazer's name to preserve continuity.
3. **Hot-standby mailbox accounts** — transferable on the same 30-day handoff terms as the Smartlead account.
4. **Internal deliverability runbooks** (separate from `OPS-RUNBOOK.md` which Lazer owns; these are IntegrateAPI's accumulated tribal knowledge for serving other clients).
5. **Classifier-prompt iteration logbook** — process artifact (the prompts that DIDN'T work). Lazer owns the production prompts; IntegrateAPI keeps the discarded experiments.
6. **Vendor relationship intel** (Smartlead account-rep notes, Mailforge support history, ZeroBounce custom rate cards if any).

### Data-export deliverable

Within **30 days** of termination, Lazer receives:

- Full CSV + JSON exports of `leads`, `sends`, `replies`, `conversations`, `suppressions`, `audit_log`.
- Schema documentation (auto-generated from Supabase migrations).
- Configuration snapshot (settings, footer templates by state, routing rules, RBAC roles).
- All campaign templates with version history.
- Read-only Supabase database snapshot for 60 days post-termination so Lazer can restore into a new Supabase project.

The `webhook_events` idempotency table and Supabase RLS policy bodies are excluded as operational artifacts (no business value to Lazer outside the live system).

### Why this matters commercially

"Owns the code" deals command roughly a 30% premium over rental/SaaS structures and create stronger commitment from both sides. For Lazer, this prevents the lock-in panic that makes year-3 negotiations adversarial. For IntegrateAPI, this justifies the higher one-time fee.

---

## §5 SLA

### Uptime

- **Target:** 99.0% uptime measured monthly on the cold-sending pipeline (the dispatcher + webhook receiver + Supabase Edge Functions that run reply classification and FUB push).
- **Excluded:** Vendor-side outages outside IntegrateAPI's control — Smartlead, Mailforge, ZeroBounce, Resend, FUB, Anthropic. SLA pauses during a vendor outage of >15 minutes; resumes when the vendor's status page or our internal monitoring confirms recovery.
- **Measurement:** External uptime monitor (e.g., Better Uptime, UptimeRobot) on the webhook receiver endpoint and the dispatcher health-check route.
- **Remedy for SLA breach:** 10% of that month's retainer credited to the next invoice for each percentage point below target, capped at one month's retainer.

### Response time

- **Business hours:** 9am–6pm ET, Monday–Friday excluding U.S. federal holidays.
- **Incident acknowledgment:** Within **4 business hours** during business hours.
- **After-hours:** Best-effort with **no SLA in v1**. Available as a paid upgrade — see §7.
- **Resolution targets** (best-effort, not contractual):
  - Severity 1 (system-down, no sends going out, no replies being processed): same business day.
  - Severity 2 (degraded — partial outage, single mailbox unhealthy, single vendor 4xx): next business day.
  - Severity 3 (cosmetic, low-impact): within 5 business days.

### Support channel

- Dedicated email address (e.g., `lazer-support@integrateapi.dev`).
- Shared Slack channel for Severity 1 incidents and active operational coordination.
- Severity-1 incidents may also page IntegrateAPI's on-call number (provided at engagement-letter signing) — answered best-effort outside business hours.

### Maintenance windows

- Scheduled changes deploy **Tuesday–Thursday 10am–4pm ET**.
- **No Friday or weekend deploys** (avoids weekend incident response).
- Maintenance windows announced **48 hours in advance** to Lazer's designated operator email.

### Change management

- **Classifier prompt changes** notified to Lazer 48 hours before deploy. Lazer can request review or veto.
- **Watchdog threshold changes** notified to Lazer 48 hours before deploy.
- **Operator approval required** (cannot be deployed unilaterally) for: domain retirement, footer template changes, suppression-list mass-edits, RBAC role changes, RUA aggregator changes.
- **Compliance-counsel sign-off required** before any new campaign template enters production (per `COMPLIANCE.md` workflow).

---

## §6 Engagement letter terms

### Warranty

- **90-day post-launch warranty** included in the build fee. Defects (bugs, broken integrations, regressions) are fixed at no additional charge during this window. Feature changes and scope additions are billed at standard retainer or hourly rates.
- Defect = behavior that contradicts a v1 success criterion (`v1.SC1`–`v1.SC11`) or the PRD outcome contract as amended.

### Scope cap on retainer

- 10 hours/month of engineering time included in the $2,200/month retainer.
- Overage billed at **$150/hour** with prior approval required for any single block over 4 hours.
- Unused hours do not roll forward (use-it-or-lose-it on a calendar-month basis).

### Payment terms

- Net-30 invoicing.
- Late fee of **1.5%/month** after 60 days past due.
- IntegrateAPI may suspend retainer services (not the production system itself) after 90 days past due, with 14 days' written notice.
- Production-system access is never suspended for non-payment without 30 days' written notice and a fair-export window — operators must always be able to log in to retrieve data even during a billing dispute.

### Confidentiality

- Mutual NDA covering: Lazer's lead lists and source data, classifier prompts (as work-product), IntegrateAPI's deliverability methods and runbooks, both parties' commercial terms.
- Survives termination by 5 years.

### Non-solicitation

- 12 months post-engagement. Neither party hires the other's employees or contractors during the engagement or for 12 months after termination, except by mutual written consent.

### IP assignment

- All work-product produced under the build fee is owned by Lazer per `§4 Termination clause` above.
- IntegrateAPI retains a perpetual royalty-free license to the source code for portfolio and template-reuse purposes.
- Pre-existing IntegrateAPI tooling, libraries, and templates are licensed to Lazer for use in this project but not assigned.

### Indemnification

- **Lazer indemnifies IntegrateAPI** for compliance violations stemming from Lazer's content, copy, list-procurement, target-state selection, or operator decisions (e.g., approving a non-compliant footer, sending into a state without proper licensing).
- **IntegrateAPI indemnifies Lazer** for engineering defects causing data loss, data-breach incidents stemming from code defects, or system unavailability beyond the SLA in §5.
- Liability cap: **6 months of retainer** for IntegrateAPI's indemnification, on the theory that Lazer's downside in such an event is bounded by what they've paid recently.

### Governing law

- Delaware law (or whichever state IntegrateAPI is registered in). Disputes over $50,000 go to AAA arbitration; under $50,000 stays in small-claims.

---

## §7 Upsell paths (optional, post-v1)

### Rev-share on FUB-pushed leads that close

- **$25–$50/closed lead** as a flat fee per qualified-positive that converts to a closed mortgage application.
- **Default OFF.** Lazer opts in via written addendum.
- Tracked via FUB pipeline-stage transition; reconciliation monthly.
- Aligns incentives but complicates accounting; pitch only if Lazer asks for it or pushes back hard on retainer.

### v2 features

- Combined Phase 3+4 v2 quote: **$28,000 fixed**. Per-phase indicative cost (subject to scoping): Phase 3 placement-check ~$15k, Phase 4 auto-rotation ~$13k. The combined fixed quote of $28k assumes scoping in the lower half of those per-phase ranges; if Lazer requests scope expansion during quoting, the combined fixed quote increases proportionally.

### Operational upgrades

- **Premium SLA upgrade — after-hours on-call:** **$500/month additional**. Severity 1 incidents acknowledged within 1 hour, 24/7. Pager rotation maintained by IntegrateAPI.
- **Additional state coverage:** **$1,500/state one-time** for per-state footer + license disclosure for any state beyond the v1 set (CA, NY, FL, NJ, TX, MA, MD, IL, AZ, CT). Includes counsel review pass.
- **Annual deliverability deep-dive + full deliverability test:** **$5,000/year**. Comprehensive seed-inbox placement test across major providers, raw-MIME audit on a sample of recent sends, DMARC-ramp evaluation, FUB integration health audit, classifier-accuracy audit against current eval set.

### Out of scope (always)

- Per-send pricing — turns IntegrateAPI into a vendor profiting from MORE cold mail; conflicts with the "protect deliverability" outcome.
- Per-warmup-mailbox pricing — invites Lazer to micromanage inventory IntegrateAPI controls.
- Per-seat pricing — Lazer's operator team is small and stable; per-seat is misaligned with managed-service framing.

---

*End of CHARGE-ABILITY.md. Pricing is anchored to research §Q4 (custom-build market data, late 2025 / early 2026). All terms negotiable in writing before signing the engagement letter.*
