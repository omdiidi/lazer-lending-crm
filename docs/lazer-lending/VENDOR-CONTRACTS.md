# Vendor Contracts — Lazer Lending CRM

**Date:** 2026-05-01
**Version:** v1
**Purpose:** Documents the webhook signing, retry semantics, idempotency requirements, rate limits, and known operational risk for each vendor that the Lazer Lending CRM integrates with. Filled where research has answers; flagged `[Phase 0.3 verify]` with a specific test plan where research did not.
**Authority:** This document is the source of truth for vendor integration contracts. `PLAN.md` Phase 0 Task 0.3 (vendor sandbox provisioning) verifies the `[Phase 0.3 verify]` rows by running real test events through each vendor and capturing the actual payload + signature scheme.
**Source citations:** `tmp/research/2026-05-01-feasibility-validation.md` §Q1 + §Q2.

---

## How to read this document

For each vendor, the table captures:

- **Status** — `verified` (research has external sources) or `Phase 0.3 verify` (must be smoke-tested in Phase 0).
- **Source of truth** — primary vendor doc URL.
- **Per-property rows** — API base URL, auth scheme, webhook signing, delivery semantics, retry behavior, rate limits, status page, known incidents, AUP posture, failover plan.
- **Each property row** has its own `Verified?` flag — research may have answered some properties but not others.

Where a property cannot be answered from public docs, the row says `[Phase 0.3 verify]` and the vendor section ends with a numbered test plan.

---

## 1. Smartlead Pro (primary cold sending engine)

**Status:** Mostly verified; webhook signature scheme requires Phase 0.3 capture.
**Source of truth:** https://api.smartlead.ai/reference (API), https://helpcenter.smartlead.ai/en/articles/417-how-to-resolve-webhook-failures (webhooks), https://www.smartlead.ai/new-terms-and-conditions (AUP).

| Property | Value | Verified? | Notes |
|---|---|---|---|
| API base URL | `https://server.smartlead.ai/api/v1` | verified | Per public API reference. |
| API version | `v1` (no semantic versioning published; breaking changes have historically been silent — confirmed by operator reports on G2 / Indie Hackers) | verified | Pin to v1 in code; expect backward-incompatible changes without notice. Add a daily reconcile job to detect drift. |
| Auth scheme | API key passed as `api_key` query parameter on every request | verified | Per API reference. Key is high-privilege; treat as a production secret. |
| Webhook signing | Event ID present in payload; signature scheme **not documented in public help center** | [Phase 0.3 verify] | Smartlead's webhook-failure article confirms each event has an event ID for idempotency but does not describe HMAC or other signature verification. Must capture from a real test event. |
| Webhook delivery semantics | **At-least-once** | verified | "The server can say it received the event (2xx), but then fail to process the data and drop it internally" (https://helpcenter.smartlead.ai/en/articles/417). Receiver MUST be idempotent. |
| Webhook retry behavior | Smartlead retries on non-2xx responses; specific backoff schedule **not documented**. Operator reports indicate 10–30s timeout on the receiver end (slow handlers cause retries). | [Phase 0.3 verify] | Capture real retry intervals during smoke test by deliberately responding 500 to a test event and timing the retries. |
| Rate limits | Per-mailbox throttling enforced server-side. CRM dispatcher must handle 429 responses by pausing the affected mailbox with `paused_reason='smartlead_rate_limit'` per `PLAN.md` Task 1.5a. Specific RPS / RPM limits **not published**. | [Phase 0.3 verify] | Test by issuing rapid sends; capture 429 threshold and Retry-After header behavior. |
| Status page | **None public.** | verified | No `smartlead.statuspage.io` or equivalent. Third-party monitor StatusGator (https://statusgator.com/services/smartlead) provides the only operational visibility. |
| Known incidents (12 months) | **49+ outages over ~12 months per StatusGator.** Two specific 2025 incidents documented: November 18 (1h34m, "internal server error"); October 26 (2h, login issues). Neither officially acknowledged by Smartlead. | verified | Operational risk: no contractual uptime, no public incident transparency, no SLA. Tracked via StatusGator. |
| AUP posture for lending vertical | AUP is **silent on residential mortgage / lending vertical**. Restricts on spam-law method, not vertical. Suspension grounds = AUP violation not cured in 14 days OR emergency basis. | verified | Per https://www.smartlead.ai/new-terms-and-conditions and https://www.smartlead.ai/fair-use-policy. No operator reports of Smartlead suspending mortgage accounts found across Reddit / G2 / Trustpilot / Indie Hackers, but **absence of evidence is not evidence of absence**. Phase 0.3 should include direct conversation with Smartlead account rep about lending. |
| Auto-pause on complaint rates | **Smartlead does NOT auto-pause on complaint rates.** Pauses fire on bounce limit, exhausted quota, mailbox connectivity, billing — not complaint rate, not AUP enforcement. | verified | Per https://helpcenter.smartlead.ai/en/articles/69. **The watchdog described in `PLAN.md` must be entirely CRM-owned.** No vendor-side complaint enforcement is available. |
| Operator-reported issues (12 months) | "Campaigns failing to send", "warmup pausing unexpectedly", "analytics not loading", email-account disconnections "at least bi-weekly" per G2 / Trustpilot reviews. G2 average 4.6/5 across 306 reviews; Trustpilot 3.4/5 across 85 reviews. | verified | Score gap (4.6 vs 3.4) suggests power users are satisfied while occasional users have a notably worse experience. Operator alerts on disconnections are required. |
| Failover plan | **Saleshandy** is the candidate failover vendor (no industry-specific prohibitions, comparable AUP permissiveness). Webhook-signing capability requires direct vendor confirmation (not documented in public help center). **Instantly is disqualified** for lending — Instantly's sending policy explicitly gates lending behind "custom account" approval (https://instantly.ai/instantly-sending-policy) which adds weeks of onboarding friction. | verified | Pre-onboard Saleshandy in Phase 0 (sandbox account + test webhook capture), do NOT post-onboard at incident time. |

### Phase 0.3 test plan for Smartlead

1. Create a Smartlead Pro sandbox account; verify billing.
2. Generate an API key; confirm it works against `GET /api/v1/campaigns` (list campaigns).
3. Configure a webhook receiver pointing at a Phase-0 test endpoint (e.g., a temporary Cloudflare Worker logging request headers + body to a R2 bucket).
4. **Trigger a real test event** (send one email through the test campaign and let the `email_sent` event fire). Capture: full request headers, full request body, signature header (if any), event ID location in payload.
5. **Document the signature scheme** in `PLAN.md` §Webhook Idempotency — header name, algorithm (likely HMAC-SHA256), payload shape (raw body vs JSON-canonical), shared secret rotation behavior.
6. **Test retry behavior** — respond 500 to a webhook, time the retries, capture the Retry-After header (if any), confirm at-least-once semantics.
7. **Test rate-limit behavior** — issue rapid sends until 429, capture the Retry-After header, verify CRM dispatcher correctly pauses the mailbox.
8. **Direct Smartlead account-rep conversation** about lending vertical: confirm AUP enforcement posture, ask about historical suspensions in residential mortgage.
9. Document findings in `tmp/done-plans/2026-XX-XX-phase-0-vendor-contracts.md`.

---

## 2. Mailforge (burner-domain Workspace inventory)

**Status:** Pricing verified; tenant architecture is the critical unknown.
**Source of truth:** https://www.mailforge.ai/pricing.

| Property | Value | Verified? | Notes |
|---|---|---|---|
| Pricing | **$3/mailbox/month** standard tier (annual billing); minimum 10 slots. Domains separately ~$14/year. | verified | Per https://www.mailforge.ai/pricing and https://woodpecker.co/blog/mailforge-pricing/. **The $1.67/mailbox figure cited in earlier plan iterations is a high-volume discount tier (50+ mailboxes), not applicable at v1 inventory of 5–10.** |
| API | None disclosed. Mailforge is provisioning-only; integration with sending engine (Smartlead) happens via OAuth on the Workspace mailbox. | verified | Lazer does not integrate Mailforge programmatically; operator provisions mailboxes via Mailforge UI, then OAuths each into Smartlead. |
| Auth scheme (operator-side) | Mailforge dashboard login (email + password / SSO). | verified | Treat operator credentials as production secrets. |
| Webhook signing | N/A — no webhooks documented. | verified | Mailforge has no published webhook integration with the CRM; provisioning lifecycle events (mailbox created, DNS verified) are surfaced only in the Mailforge UI. |
| Tenant architecture (isolated vs shared Workspace) | **Undisclosed by Mailforge.** Mailboxes "distributed across a large pool of IP addresses shared with other Mailforge users" per third-party review (https://skywork.ai/skypage/en/Mailforge-Review-(2025)-...); whether each customer gets a dedicated Workspace tenant or shares a Mailforge reseller tenant is **not publicly clarified**. | [Phase 0.3 verify] | **Critical:** answer determines disaster blast radius. If shared tenant, a single Mailforge customer's Google AUP violation can cascade into a tenant-wide suspension affecting Lazer. If isolated, blast radius is bounded to Lazer's mailboxes. **Must ask Mailforge directly before contract signing.** |
| Status page | **None public.** | verified | No `mailforge.statuspage.io` or equivalent. |
| SLA | **None published.** | verified | No contractual uptime commitment; no incident-history page. |
| Known operational risk | **Smartlead+Workspace pairing was specifically named** by Google during the October–November 2025 cold-email crackdown as a trigger pattern. (https://prospeo.io/s/google-workspace-cold-email — "Google started quietly cracking down on cold email Workspace accounts throughout late 2025... Triggers explicitly listed: high-volume sending patterns, shared tracking pixels, integration with Smartlead, Instantly, and Zapmail.") | verified | This is the elevated-risk configuration. Mitigation: lower per-mailbox cap to 15–25/day (per `BRIEF` D9), Smartlead+Workspace flagged in `PLAN.md §Gotchas`, hot-standby inventory provisioned. |
| Reseller cascade risk | Reseller TOS removes Google liability for reseller-side suspensions: "Google will not have any Liability arising out of a Reseller's (A) suspension or termination of Customer's access to the Services" (https://admin.google.com/terms/apps/1/3/en/reseller_premier_terms.html). | verified | Lazer has no recourse against Google in a reseller-suspension scenario. Recourse is only against Mailforge per Mailforge's (unpublished) terms. |
| Probability of mailbox suspension (12 months) | **20–40%** for an individual Lazer mailbox or tenant under the Smartlead+Workspace pattern, based on the post-October-2025 crackdown evidence. | verified | Per research §Q2. Higher than the audit's original 5–10% estimate. |
| Probability of Mailforge reseller deplatform | **<5%** over 12 months. No documented precedent for legitimate Workspace resellers being deplatformed by Google. | verified | Per research §Q2. Lower than the audit's original 5–10% estimate. |
| Recovery time without hot-standby | **7–10 weeks** cold-start (24–48h DNS + per-domain DKIM/SPF/DMARC + 6–8 weeks warmup + OAuth re-provisioning into Smartlead). | verified | Per https://litemail.ai/blog/google-workspace-cold-email-account-setup-cost-2026: $584 first-2-months direct-Workspace setup cost, 6–9 weeks to first send. |
| Recovery time with hot-standby | **24–72 hours** (activate pre-warmed standby mailboxes, OAuth into Smartlead, switch active sending pool). | verified | Per `PRD-AMENDMENT.md` §3 and `PLAN.md` Task 0.9 (hot-standby provisioning). |
| Failover plan | Hot-standby mailboxes pre-warmed at Litemail / EmailAstra / Infraforge ($25–85/month for 5 accounts). Activation procedure documented in `OPS-RUNBOOK.md` (incident #4: Mailforge tenant suspension/deplatform). | verified | This is the primary failover path. Direct-Workspace provisioning as a deeper fallback is documented but takes 7–10 weeks. |

### Phase 0.3 test plan for Mailforge

1. **Direct conversation with Mailforge sales/support** asking explicitly: "Are customer mailboxes provisioned in isolated Workspace accounts (one per customer), or do customers share a reseller tenant? If isolated, what is the blast radius of a Google enforcement action against one of your customers?"
2. Capture answer in writing (email or recorded call). If answer is "shared tenant," reduce v1 inventory expectations and increase hot-standby budget.
3. Provision 1 burner domain + 2 mailboxes through Mailforge to validate the provisioning lifecycle (DNS propagation, OAuth into Smartlead, first warmup send).
4. Document Mailforge's actual response time to support requests (informal SLA observation).

---

## 3. ZeroBounce (email validation)

**Status:** Capabilities verified; concrete rate limits + bulk-async polling cadence require Phase 0.3 capture.
**Source of truth:** https://www.zerobounce.net/docs/email-validation-api-quickstart/.

| Property | Value | Verified? | Notes |
|---|---|---|---|
| API base URL | `https://api.zerobounce.net/v2` | verified | Public API reference. |
| API version | `v2` | verified | Stable for several years. |
| Auth scheme | API key passed as `api_key` query parameter or in JSON body. | verified | Per docs. |
| Validation modes | (a) **Bulk** — async; upload CSV, poll for results. (b) **JIT (single-email)** — synchronous in dispatcher hot path. | verified | Per `PLAN.md` Task 1.6 / 1.7. |
| Bulk validation latency | **Minutes to hours**, depends on file size and queue. | [Phase 0.3 verify] | Specific latency not published. Test with a 1k-row sample to capture realistic timings. |
| JIT validation latency | Synchronous; typical 200–1500ms. | verified | Within hot-path acceptable bounds; failover behavior on timeout documented in `PLAN.md` Task 1.7 (cached-validation acceptable within 60 days). |
| Rate limits | Not specifically published. Operator reports indicate large headroom; back-off on 429. | [Phase 0.3 verify] | Test rapid JIT calls in Phase 0; capture limit + Retry-After behavior. |
| Webhook signing | N/A — ZeroBounce does not push webhooks; Lazer polls for bulk results. | verified | |
| Status page | https://status.zerobounce.net (per ZeroBounce docs reference). | verified | Public. |
| Known incidents | No major recent outages reported in operator forums. ZeroBounce is one of the more reliable validation providers. | verified | Lower operational risk than Smartlead or Mailforge. |
| AUP posture | No vertical restrictions; ZeroBounce is a pure validation utility. | verified | |
| Failover plan | Cached-validation acceptable within 60 days (per `PLAN.md` Task 1.7). On extended outage, cached results carry the dispatcher; new lead-list uploads queue. Alternative validators (NeverBounce, Bouncer) can be added as a second `Validator` interface impl if ZeroBounce reliability becomes a problem. | verified | |
| Credit balance monitoring | Account balance accessible via `GET /v2/getcredits`. CRM should check balance daily and alert at <500 credits. | verified | Per `PLAN.md` system-health dashboard task. |

### Phase 0.3 test plan for ZeroBounce

1. Provision a sandbox account; capture API key.
2. Run a 100-row bulk validation; time end-to-end (upload → ready → download).
3. Run JIT validation on 50 single emails; capture per-call latency distribution.
4. Trigger 429 by rapid JIT calls; capture rate limit + Retry-After.
5. Document credit consumption rate (1 credit per validation? bulk-discount?) — relevant for monthly cost forecasting.

---

## 4. Follow Up Boss (FUB) — downstream CRM

**Status:** API verified; specific 4xx/5xx behavior + pipeline-discovery API require Phase 0.3 capture.
**Source of truth:** https://docs.followupboss.com/.

| Property | Value | Verified? | Notes |
|---|---|---|---|
| API base URL | `https://api.followupboss.com/v1` | verified | Public API reference. |
| API version | `v1`. **No explicit versioning policy published** — FUB does not pin API versions cleanly. Breaking changes have been reported by operators with limited notice. | verified | Pin to v1 in code; daily reconcile against expected schema; alert on FUB API schema drift. |
| Auth scheme | API key (Basic Auth, key as username, blank password). Per-user keys. | verified | Treat as production secret; rotate quarterly. |
| Rate limits | Documented as **250 requests/10 seconds per user** with burst tolerance. | [Phase 0.3 verify] | Back-off on 429 with Retry-After. CRM should never hit this in normal v1 operation. Test plan: send 300 dummy contact-create calls in 10s; document 429 behavior; verify retry-after header semantics. |
| Webhook signing | FUB supports outbound webhooks; signature scheme **not used by Lazer in v1** (Lazer pushes to FUB, doesn't receive from FUB). | n/a | FUB-to-Lazer webhooks deferred to v2 if needed. |
| Status page | https://status.followupboss.com (publicly documented). | verified | |
| Known incidents | Periodic 4xx/5xx during high-load periods (FUB is a small-team product). 24-hour-plus outages have occurred. | verified | Operator reports on FUB community forum. |
| Pipeline + stage discovery | Pipelines and stages enumerated via `GET /v1/pipelines` and `GET /v1/stages`. CRM Settings panel should populate these as dropdowns rather than hand-typed IDs (per audit Gaps lens finding). | [Phase 0.3 verify] | Confirm that the API returns stable IDs that can be persisted in CRM settings without breaking on FUB schema changes. |
| AUP posture | None — FUB is the lender's own CRM. No vertical restrictions. | verified | |
| Failover plan | On FUB outage, positive-classified replies queue locally in `replies` with `fub_push_status='pending'`. Retry on FUB recovery. Alert if queue depth > 50 or oldest-pending > 4 hours. | verified | Per `PLAN.md` Task 2.6 (FUB push) + system-health dashboard. |
| Email-normalization compatibility | FUB does its own dedup on email; normalization scheme unknown. To prevent double-pushes, Lazer's `email_normalized` (Gmail-conditional dot-collapse + plus-tag strip) is checked before push. | [Phase 0.3 verify] | Test by pushing the same email in two normalization variants and observing FUB's behavior. |

### Phase 0.3 test plan for FUB

1. Create a FUB sandbox account (or use Lazer's existing account in a test pipeline).
2. Generate an API key; confirm authentication against `GET /v1/me`.
3. Enumerate pipelines and stages via `GET /v1/pipelines` and `GET /v1/stages`. Document IDs for use in CRM settings.
4. Push a test lead to the configured pipeline+stage; verify it lands correctly.
5. Push the same email in two normalization variants (e.g., `john.doe@gmail.com` and `johndoe@gmail.com`) and observe FUB dedup behavior.
6. Test 429 behavior by rapid-fire pushes; capture Retry-After.
7. Document the API response schema for the most-used endpoints (`POST /v1/people`, `POST /v1/notes`).

---

## 5. Resend (transactional notifications only)

**Status:** Verified.
**Source of truth:** https://resend.com/docs.

| Property | Value | Verified? | Notes |
|---|---|---|---|
| API base URL | `https://api.resend.com` | verified | Public API reference. |
| API version | Versionless (Resend uses backwards-compatible additive changes). | verified | |
| Auth scheme | Bearer token (API key) in Authorization header. | verified | Treat as production secret. |
| Pricing | Free tier 3,000 emails/month, 100/day. **Pro $20/month** for 50,000/month. v1 transactional volume (operator alerts, RUA report summaries) easily fits free tier. | verified | Per https://resend.com/pricing. |
| Sending domain | Lazer uses `notify.lazerlending.com` exclusively. **Cold sending via Resend is prohibited by architecture (per BRIEF D2 + D4) regardless of Resend AUP.** | verified | Per `PRD-AMENDMENT.md` §2 substitution row. |
| Inbound parse | **Not used.** Replies pull from real Workspace mailboxes via Smartlead reply webhooks. | verified | Per BRIEF.D6 (= PLAN.D8). |
| Webhook signing | HMAC-SHA256 via Svix. Header: `svix-signature`. Documented at https://resend.com/docs/dashboard/webhooks/introduction. | verified | If Lazer uses Resend send-status webhooks for transactional (delivery confirmation, bounce), implement Svix signature verification. v1 may not need this — transactional volume is low and operator can read Resend dashboard. |
| Webhook delivery semantics | At-least-once via Svix. | verified | |
| AUP posture for transactional | Tolerant; transactional notification email is the explicit primary use case. | verified | https://resend.com/legal/acceptable-use. |
| AUP posture for cold | Permitted below thresholds, but **Lazer's architecture prohibits cold via Resend** by construction (separate sending domain). | verified | |
| Status page | https://resend.com/status | verified | Public, frequently updated. |
| Known incidents | Occasional minor incidents; no extended outages in 2025–2026. Resend is operationally one of the more reliable transactional ESPs. | verified | |
| Rate limits | 10 requests/second by default; raisable on request. | verified | Per docs. v1 transactional volume is well below this. |
| Failover plan | Queue alerts locally on Resend outage; retry on recovery. Alternative transactional ESPs (Postmark, SES) can be wired as backup if Resend has a multi-day outage; not pre-onboarded for v1. | verified | |

### Phase 0.3 test plan for Resend

1. Provision Lazer's `notify.lazerlending.com` subdomain in Resend; configure SPF + DKIM + DMARC.
2. Send a test transactional email from `alerts@notify.lazerlending.com`; verify deliverability to a Gmail and Outlook test inbox.
3. Confirm Resend dashboard shows the send and any open/click events.
4. (Optional v1) Configure a Resend webhook for `email.bounced` events using Svix signature verification; test a soft bounce.

---

## 6. Anthropic API (LLM classifier)

**Status:** Verified; retry SLA + queue-depth alarm + DPA confirmation are required additions per audit.
**Source of truth:** https://docs.anthropic.com/.

| Property | Value | Verified? | Notes |
|---|---|---|---|
| API base URL | `https://api.anthropic.com/v1` | verified | Public API reference. |
| API version | API version pinned via `anthropic-version` header (e.g., `2023-06-01`). Model versions pinned separately (e.g., `claude-sonnet-4-5`). | verified | Pin both in code. Avoid `claude-3-sonnet-latest`-style aliases that move under you. |
| Auth scheme | `x-api-key` header. | verified | Treat as production secret. |
| Rate limits | Per-organization tiers; classifier traffic at v1 volume (50–150 replies/day) is well below any tier. | verified | https://docs.anthropic.com/en/api/rate-limits. |
| SLA | **Standard API tier has no contractual uptime commitment.** Enterprise tier (Anthropic Standard with DPA) has support obligations but uptime SLA is negotiated per contract. | verified | |
| Outage history | **4+ hour incidents documented** in 2024–2025 (e.g., status.anthropic.com history). | verified | Per https://status.anthropic.com. |
| Failover plan (per `PLAN.md` Task 2.2) | On classifier timeout (5s) or error: `classification=null` + `requires_human_review=true`; reply persists in `replies` table; operator-visible queue at the system-health dashboard. **Required addition per audit:** retry SLA (3 attempts with 5s/15s/45s backoff before falling back to human review), queue-depth alarm (alert if pending > 25 or oldest > 30 minutes), operator-visible "X replies pending classification" surface on the dashboard. | verified | These additions are tracked in `PLAN.md §1.0d` (system-health dashboard) and `OPS-RUNBOOK.md` incident #5 (Anthropic API outage > 1hr). |
| Webhook signing | N/A — Anthropic API is request/response only. | verified | |
| DPA / no-train clause | **Required.** Anthropic Standard API tier supports a DPA addendum that includes no-train commitments and data-handling guarantees. Default API tier without DPA does NOT include the no-train clause. | verified | Per Anthropic Trust Center (https://trust.anthropic.com). **OQ9 in `PLAN.md` is closed by signing the Standard API DPA before Phase 2 production traffic.** |
| PII redaction before LLM input | Mandatory per `PLAN.md` Task 2.2a. Redactor runs before every classifier call; eval set tested separately. | verified | DPAs aren't retroactive against breaches; redactor is the load-bearing safeguard. |
| Cost forecast | Claude Sonnet 4.5 at v1 reply volume (~150 replies/day × 1k input + 200 output tokens × 30 days) ≈ ~$15–$30/month at standard pricing. Negligible. | verified | Tracked in monthly retainer budget. |
| Status page | https://status.anthropic.com | verified | Public. |
| AUP posture | No vertical restrictions; Anthropic AUP focuses on disallowed use cases (CSAM, weapons, election interference, etc.) — none apply to reply classification. | verified | https://www.anthropic.com/legal/aup. |

### Phase 0.3 test plan for Anthropic

1. Provision Anthropic API access at the Standard API tier; sign DPA addendum (closes OQ9).
2. Confirm classifier prompt + structured-output schema works against the chosen model version (default Sonnet 4.5).
3. Test failover: simulate 5s timeout, verify `classification=null + requires_human_review=true` path.
4. Test queue-depth alarm: queue >25 pending replies, verify dashboard alert fires.
5. Validate PII redactor against the eval set (separate from classifier eval set).
6. Document model + API version pins in `PLAN.md` env vars.

---

## Summary table

| Vendor | Status | Critical Phase 0.3 question |
|---|---|---|
| Smartlead Pro | Mostly verified | What is the actual webhook signature scheme? |
| Mailforge | Pricing verified; tenant architecture undisclosed | Are customer mailboxes in isolated Workspace tenants or shared reseller tenant? |
| ZeroBounce | Capabilities verified | Specific rate limits + bulk-async cadence |
| Follow Up Boss | API verified | Pipeline + stage IDs stable across schema changes? Email dedup behavior? |
| Resend | Verified | None blocking — transactional integration is well-trodden. |
| Anthropic | Verified | DPA addendum signed before production traffic. |

**Phase 0.3 deliverable** is a `tmp/done-plans/2026-XX-XX-phase-0-vendor-contracts.md` file documenting the answers to every `[Phase 0.3 verify]` row above, with captured payload samples and signature schemes for Smartlead.

---

*End of VENDOR-CONTRACTS.md. All claims trace to the research file (`tmp/research/2026-05-01-feasibility-validation.md`) or the audit (`tmp/review-notes/2026-05-01-codex-feasibility-audit.md`). Where research did not answer, the row is flagged for Phase 0.3 with a specific test plan.*
