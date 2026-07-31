# Vendor Contracts

> Authoritative reference for every external vendor in the Lazer Lending CRM. Last updated 2026-05-04. Each section answers: what does the vendor do, how do we authenticate, what are the rate limits, what are the gotchas, and what's the unblock checklist (steps to take when the client provisions an account).
>
> **Architecture context this document reflects:** v1 volume target 300–500/day with a documented (but not pre-built) scale path to 1,000/day. Cold sending runs through Smartlead Pro as a campaign engine on real Google Workspace mailboxes provisioned through Zapmail (primary) or Maildoso (fallback). Burner-domain pool is 4–6 brand-affiliated `.com` domains (e.g., `lazer-loans.com`). The brand domain `lazerlending.com` never sends cold mail. Resend is retained for transactional only on `notify.lazerlending.com` (internal team notifications). Reply classification uses a two-stage pipeline (keyword → LLM) with provider TBD by client. Qualified positive replies push to Follow Up Boss via `POST /v1/events`.

---

## Quick reference table

| # | Vendor | Role | Plan tier needed | Approx $/mo at v1 | Account status |
|---|---|---|---|---:|---|
| 1 | Smartlead | Cold sending engine (campaign-based) | **Pro** (annual) | $78–94 | Not provisioned |
| 2 | Zapmail | Real Google Workspace mailbox provisioner — PRIMARY | Starter $39 (≤10 mbx) or Growth $99 (≤30 mbx) | $39–99 | Not provisioned |
| 2b | Maildoso | Mailbox fallback (shared SMTP + IP rotation) | 30-mbx monthly | $75 | Not provisioned (fallback only) |
| 2c | Mailforge | DEPRIORITIZED — documented for completeness | n/a | n/a | Do not use unless 2 + 2b rejected |
| 3 | ZeroBounce | Email validation (upload + JIT 60-day) | Pay-as-you-go credits | $5–15 (steady state) | Partial integration in `apollo-search` |
| 4 | Follow Up Boss | Qualified-lead destination CRM (Lazer's primary) | Confirm with rep | Lazer's existing seat | Lazer owns; API access TBC |
| 5 | Resend | Transactional only (internal alerts) | Free tier (3K/mo) | $0 | Connect CRM scaffold integrated; refactor needed |
| 6 | LLM classifier | Reply classification (Anthropic or OpenAI Enterprise) | Standard API w/ no-train DPA | $5–20 (low at v1 volume) | Not provisioned (client choice) |
| 7 | DMARC RUA aggregator | Receive DMARC aggregate reports per burner | Cloudflare DMARC Mgmt free | $0 | Not provisioned |
| **Total** | | | | **~$200–300/mo realistic v1** | |

Domain registration costs (~$13/yr × 4–6 = $4–7/mo amortized) are billed through Zapmail/Maildoso, not separately.

---

## 1. Smartlead Pro — cold sending engine

### What it does
Smartlead is the entire cold-send pipeline: it owns mailbox connections, manages warmup, paces sends, polls for replies, and emits webhooks on every event. Our CRM never opens an SMTP socket — it tells Smartlead what to send and listens for outcomes.

### Why we chose it (over Saleshandy, Instantly, Lemlist, etc.)
- **Headless API + reply webhook** that actually works at the Pro tier (Saleshandy's webhook payload spec was ambiguous; user picked certainty over $25/mo savings — see CLAUDE.local.md D2).
- **Unlimited mailboxes on every plan** including Pro — no per-mailbox tax as we scale from 4 to 17 mailboxes (source: `tmp/research/2026-05-04-smartlead.md` §8).
- **Bundled warmup** runs in parallel with live campaigns indefinitely (source: `tmp/research/2026-05-04-resend-compliance.md` §3.6).
- Resend, SendGrid, Mailgun, Postmark, Brevo, Mailjet, SparkPost, and SES all explicitly ban cold mail in their AUPs — Smartlead is purpose-built for cold and therefore tolerated by sending infrastructure peers.
- Instantly Hypergrowth ($97/mo) was rejected for operator-reported reputation degradation post-2024.

### Authentication
- **Method:** API key only — passed as URL query parameter `api_key=YOUR_KEY` on every request. No `Authorization: Bearer` header form is documented (source: `tmp/research/2026-05-04-smartlead.md` §1).
- **Base URL:** `https://server.smartlead.ai/api/v1/`
- **Key types:** account-level (we use this) vs client-level (white-label feature, irrelevant for our single-tenant build).
- **Security implication:** Because the key sits in the URL, it appears in any HTTP intermediary's access logs. Treat it as a credential. HTTPS is enforced by Smartlead's base URL.

### Send flow — campaign engine, not per-message

This is the most consequential architectural finding in the entire vendor stack. **Smartlead has no transactional `POST /send` endpoint.** Every email must traverse the campaign → sequence → leads → mailbox-attach → activate flow (source: `tmp/research/2026-05-04-smartlead.md` §2).

```
1. POST /api/v1/campaigns/create                            → returns campaign_id
2. POST /api/v1/campaigns/{id}/sequences                    → add steps {seq_number, subject, email_body, delay_in_days}
3. POST /api/v1/campaigns/{id}/leads                        → batch upload (max 100/req per one source, up to 400/req per another — verify in sandbox)
4. POST /api/v1/campaigns/{id}/email-accounts               → attach mailboxes that will rotate sends
5. POST /api/v1/campaigns/{id}/settings                     → schedule, daily caps, time windows
6. PATCH /api/v1/campaigns/{id}/status   { status: ACTIVE } → Smartlead's scheduler takes over
```

**Mapping to our CRM data model:**
- Our `campaigns` table (already exists in Connect CRM scaffold; needs `provider = 'smartlead'` column added per CONNECT-CRM-AUDIT-DELTA.md) maps 1:1 to Smartlead's campaign.
- Our `campaign_steps` table (already exists, schema compatible) maps to Smartlead sequences.
- Our `leads` table is the source for batched lead upload. Always pre-validate via ZeroBounce — Smartlead silently drops malformed leads (G2 below).
- Our `mailboxes` table (new in Phase 1) tracks which Smartlead `email_account_id` is attached to which campaign via the `pool_memberships` table.
- The campaign-engine model means **`from_account_id` per individual send is unverified** — Smartlead picks the next mailbox in the attached pool. Per-send mailbox control is not documented (source: `tmp/research/2026-05-04-smartlead.md` §2).

**No per-message ID returned at dispatch time.** A `message_id` only appears later in webhook payloads. Our `sends` table writes a row when we add a lead to a campaign and reconciles to a `message_id` on the first `EMAIL_SENT` webhook for that lead.

**For one-off transactional sends (internal alerts, FUB-push confirmation emails) → use Resend, never Smartlead.**

### Webhooks

#### Event types (union of two slightly inconsistent docs sources)
| Event | When it fires |
|---|---|
| `EMAIL_SENT` | Email dispatched from mailbox |
| `EMAIL_OPENED` | Tracking pixel fired |
| `EMAIL_CLICKED` | Link click tracked |
| `EMAIL_REPLIED` | Reply detected in mailbox (polled, not pushed — see latency below) |
| `EMAIL_BOUNCED` | Hard or soft bounce |
| `EMAIL_UNSUBSCRIBED` / `LEAD_UNSUBSCRIBED` | Unsubscribe click — exact name varies between docs, **verify in sandbox** |
| `LEAD_CATEGORY_UPDATED` | Lead status changed inside Smartlead |
| `EMAIL_ACCOUNT_DISCONNECTED` | Mailbox auth failure (P1 alert — sends silently stop) |
| `CAMPAIGN_BOUNCE_THRESHOLD_BREACHED` | Bounce-rate breach |

Source: `tmp/research/2026-05-04-smartlead.md` §4.

#### Signing scheme
- **Algorithm:** HMAC-SHA256 over the raw request body using the webhook secret set at registration.
- **Header:** `X-Smartlead-Signature: sha256=<hex_digest>`.
- **Verification:** constant-time comparison only. Whether the timestamp is mixed into the HMAC is **unverified** — confirm in sandbox before locking the verification routine (source: `tmp/research/2026-05-04-smartlead.md` §4).
- **Idempotency header:** `X-Request-Id` — unique per delivery. Use as our `webhook_events.external_event_id` with unique constraint on `(provider='smartlead', external_event_id)` to prevent double-processing.
- **Webhook level header:** `X-Webhook-Level` ∈ {`user`, `client`, `campaign`}. We register at user level only (see G4).

#### Retry behavior
| Source | Retries | Intervals |
|---|---|---|
| `api.smartlead.ai/core/webhooks` | 5 | 1m / 5m / 15m / 1h / 6h |
| `api.smartlead.ai/guides/webhook-integration` | 3 | 1m / 5m / 30m |

Discrepancy is unresolved — assume the worst case (5 retries, ~7-hour total window) for capacity planning. After max retries, **the webhook is auto-disabled silently** (G5). Our handler must return HTTP 200 within 30 seconds or the delivery is counted as failed; enqueue work asynchronously and return immediately.

#### Webhook level precedence (CRITICAL footgun)
A user-level webhook **silently suppresses all client-level and campaign-level webhooks**. Register at user level once and never mix levels — if events stop firing, the first thing to check is whether a competing webhook at a different level was registered (G4).

### Rate limits

All limits enforced **per API key**, across all endpoints combined.

| Tier | Req/min | Req/hour | Burst |
|---|---|---|---|
| Standard (Base $39) | 60 | 1,000 | 10/sec |
| **Pro ($78–94)** | **120** | **3,000** | **20/sec** |
| Enterprise | Custom | Custom | Custom |

Headers on every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` (on 429 only). Use `Retry-After` value when present; fall back to exponential backoff from 1s (1, 2, 4, 8, 16). Source: `tmp/research/2026-05-04-smartlead.md` §5.

**Per-mailbox dispatch limits** are Smartlead-internal queue control (set via `max_email_per_day` on the email account), not an API rate limit. There is no documented 429 for per-mailbox cap — Smartlead simply stops dispatching from that mailbox for the day.

### Reply ingestion

- Replies land in the **real Google Workspace mailbox** (not intercepted at the SMTP layer). Smartlead polls via Gmail API (OAuth-connected) or IMAP (SMTP-connected) and fires `EMAIL_REPLIED` when a new thread is detected.
- This preserves Gmail's conversational signal — critical for deliverability of follow-on sends in the same thread.
- **Latency is the binding constraint:** up to 2 hours for Outlook-connected mailboxes, typically <15 minutes for Gmail (operator reports — exact polling interval is undocumented). Source: `tmp/research/2026-05-04-smartlead.md` §6.
- **SLA implication:** never expose "instant FUB push" as a guarantee. Our v1 SLA: positive reply → FUB push within 5 minutes of webhook receipt, but webhook receipt itself is up to 2 hours behind the actual reply.
- **Threading headers (`In-Reply-To`, `References`) are not in the documented payload.** The reply payload contains only `reply.message_id` (the reply's own ID, not the original send's). Correlate via `(campaign_id, lead_id, sequence_number)` joined against our local `sends` table.

### Stats / reconciliation

#### Endpoints
```
GET /api/v1/campaigns/{id}/statistics
GET /api/v1/campaigns/{id}/analytics
GET /api/v1/campaigns/{id}/analytics-by-date?start_date=...&end_date=...   # max 30-day span
GET /api/v1/analytics/overview
GET /api/v1/campaigns/{id}/leads-statistics?event_time_gt=YYYY-MM-DD       # incremental reconcile
```

#### Per-mailbox per-date stats
**No general-purpose endpoint exists.** SmartDelivery's `sender-account-wise` report is tied to a specific `spamTestId` (a placement test run), not arbitrary date ranges. The `warmup-stats` endpoint may return 7-day rolling per-mailbox metrics — verify in sandbox.

For our daily reconcile job:
1. For each active campaign, call `analytics-by-date` for yesterday.
2. Cross-reference against our local `sends` count and `bounce_count`.
3. Flag discrepancies for manual review.

This will under-attribute per-mailbox detail; complete per-mailbox reconciliation may require per-lead iteration via `leads-statistics`.

### Pricing — what plan we need

| Plan | Monthly | Annual | Active leads | Monthly emails | Verified emails |
|---|---:|---:|---:|---:|---:|
| Base | $39 | $32.50 | 2,000 | 6,000 | 2,000 |
| **Pro** | **$94** | **$78.30** | **30,000** | **90,000** | **30,000** |
| Unlimited Smart | $174 | $144.50 | Unlimited | 150,000 | 50,000 |
| Unlimited Prime | $379 | $314.60 | Unlimited | 500,000 | 170,000 |

**Pro is the minimum viable tier:** API access and webhooks are gated to Pro and above, NOT available on Base. At our v1 volume (300–500/day × 30 = 9,000–15,000/month), we are well inside Pro's 90,000/month cap. Pro covers up to ~3,000/day before the cap becomes constraining. Source: `tmp/research/2026-05-04-smartlead.md` §8.

### Gotchas

1. **G1 — No transactional send endpoint.** Architectural; covered above. Use Resend for one-offs.
2. **G2 — Batch lead upload silent partial failures.** `POST /campaigns/{id}/leads` returns 200 even when malformed leads are dropped. Always pre-validate via ZeroBounce.
3. **G3 — Variable substitution fails silently.** `{{first_name}}` with no value renders blank, no error. Implement pre-upload variable completeness checks.
4. **G4 — Webhook level precedence overrides lower scopes.** Register at user level only. If events stop, check for competing registrations.
5. **G5 — Webhook auto-disable after retry exhaustion.** ~7-hour deployment outage = silent webhook disable. Implement health monitoring (alert on gap in webhook traffic) and a re-registration mechanism.
6. **G6 — Reply latency up to 2 hours (especially Outlook).** Do not promise real-time FUB push.
7. **G7 — OAuth reconnection requires UI.** `EMAIL_ACCOUNT_DISCONNECTED` events on OAuth-connected mailboxes need a UI re-auth — sends silently stop. Mitigation: prefer SMTP/IMAP app passwords on Zapmail-provisioned mailboxes where possible; if OAuth is unavoidable, treat the disconnect event as P1.
8. **G8 — Daily cap reset timing undocumented.** Smartlead's per-mailbox daily counter resets at an unknown UTC time. Our reset uses mailbox-local TZ (default `America/Phoenix`, D12). Over/under-counting near midnight is possible — verify in sandbox.
9. **G9 — Pro plan monthly email cap.** 90,000/month becomes constraining only at sustained ~3,000/day. Monitor `unique_sent_count` on analytics endpoint.
10. **G10 — Google Nov 2025 / Outlook May 2025 sender requirements.** Both providers now hard-reject (550 5.x.x) for missing SPF/DKIM/DMARC. Smartlead's auto-injected unsubscribe header is meant to satisfy RFC 8058. Verify the exact header format in the Phase 0.6 raw-MIME inspection (S1 below).
11. **G11 — `send_as_plain_text` setting strips HTML and unsubscribe link.** Do not enable "Optimize Email Delivery" if RFC 8058 compliance is required. Plain-text campaigns must include unsubscribe instructions in the body itself.

Source: `tmp/research/2026-05-04-smartlead.md` §9.

### Phase 0 sandbox-verification list (S1–S11)

These items must be confirmed first-hand on a sandbox account before locking the implementation. They are blockers for Phase 1 task design.

| ID | Question | Risk if wrong |
|---|---|---|
| S1 | Is the auto-injected `List-Unsubscribe` header RFC 8058 compliant (HTTPS URI + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`)? | RFC non-compliance → Gmail/Yahoo spam-folder routing |
| S2 | Can a custom unsubscribe URL be configured per-campaign (so HMAC tokens we control can be embedded)? | Suppression-list logic must rely on Smartlead's webhook instead of HMAC-verified POST |
| S3 | Per-mailbox daily-sent-count API field (real-time) | Our `claimSendSlot` cap enforcement design |
| S4 | Webhook retry count — 3 or 5? | Dead-letter window sizing |
| S5 | HMAC body-only or body+timestamp? | Signature verification code correctness |
| S6 | `EMAIL_UNSUBSCRIBED` vs `LEAD_UNSUBSCRIBED` — which fires? | Webhook routing logic |
| S7 | Daily cap reset UTC time inside Smartlead | Midnight double-send risk |
| S8 | Threading headers (`In-Reply-To`, `References`) in `EMAIL_REPLIED` payload | Reply-to-send correlation accuracy |
| S9 | Reply webhook latency for Gmail (confirm <15 min) | FUB push latency expectations |
| S10 | Existence of a per-mailbox date-range stats endpoint | Daily reconcile job design |
| S11 | OAuth Gmail mailbox — API-initiated connection possible without UI? | Headless onboarding flow |

Source: `tmp/research/2026-05-04-smartlead.md` summary table.

### Unblock checklist

1. Sign up for Smartlead Pro account at https://smartlead.ai (annual ~$78.30/mo).
2. Generate API key in Settings → API Key Management. Note: shown only once at creation — capture immediately.
3. Generate webhook signing secret (set when registering the first webhook).
4. Capture into `.env`:
   - `SMARTLEAD_API_KEY` = the key from step 2.
   - `SMARTLEAD_WEBHOOK_SIGNING_SECRET` = the secret from step 3.
   - `SMARTLEAD_BASE_URL=https://server.smartlead.ai/api/v1`
5. Register a single user-level webhook pointing to `https://crm.lazerlending.com/api/webhooks/smartlead` with all event-type flags enabled (`event_type_map`).
6. Run sandbox smoke test per Phase 0.6 of `PLAN.md`: provision 1 burner domain via Zapmail → connect 1 mailbox to Smartlead → create a 1-step campaign with a 1-lead audience pointed at a personal Gmail → activate → verify (a) raw MIME has correct `List-Unsubscribe` headers (S1), (b) `EMAIL_SENT` webhook fires with verified HMAC, (c) reply triggers `EMAIL_REPLIED` webhook within expected latency.

---

## 2. Zapmail — Workspace mailbox provisioner (PRIMARY)

### What it does

Zapmail is a Google Workspace reseller that provisions **real GWS mailboxes on dedicated tenants per domain** — one Workspace org per burner domain — and exposes an API for programmatic provisioning. The mailboxes are real Google accounts that connect to Smartlead via OAuth (or app password for SMTP/IMAP). This is the architecturally clean path for the burner-domain pool.

### Why over Mailforge

The original plan assumed Mailforge at $1.67/mailbox. Research invalidated this:

| Issue | Mailforge | Zapmail |
|---|---|---|
| Real GWS? | **No** — proprietary shared SMTP infrastructure | Yes — real Google Workspace |
| Inbox placement (independent test) | **63% avg, 23% spam** | ~80–85% est. (real GWS baseline ~82%) |
| Tenant model | Shared IP pool across all customers | **Dedicated GWS org per domain** (low blast radius) |
| Provisioning API | **None** (UI-only, manual CSV export) | Yes (documented) |
| Lifecycle webhooks | None | Not confirmed (verify in sandbox) |
| Smartlead connection | CSV → IMAP/SMTP credentials only | OAuth (preferred) or IMAP/SMTP |
| At our scale (10–17 mbx) | $3.00/mbx/mo (the $1.67 figure was wrong for our volume) | $3.00–3.50/mbx/mo via plan tiers |

The 19-point inbox-placement gap (63% vs 82%) is material for a regulated industry (residential mortgage) where lead quality depends on landing in the primary inbox. A 23% spam rate means roughly 1 in 4 emails is invisible to the recipient. Source: `tmp/research/2026-05-04-mailforge-workspace.md` §3 (InboxKit independent benchmark).

### Pricing

| Plan | $/mo | Mailboxes included |
|---|---:|---:|
| Starter | $39 | 10 |
| Growth | $99 | 30 |

Annual discounts available. Domain registration is a separate ~$13/yr add-on per domain. For our v1 scale:

- **300/day with 10 active sending mailboxes (at 30/day each):** Starter $39/mo + 4 domains × $13/yr ÷ 12 = **~$43/mo**.
- **500/day with 17 active sending mailboxes:** Growth $99/mo + 6 domains × $13/yr ÷ 12 = **~$105/mo**.

Source: `tmp/research/2026-05-04-mailforge-workspace.md` Side-by-Side Provider Comparison + Outreach Almanac Zapmail review.

### Provisioning API

Zapmail exposes **documented provisioning endpoints** for domain registration, mailbox creation, and SMTP/IMAP app password issuance. This is the differentiator from Mailforge — it lets the CRM's `domains` and `mailboxes` state machines (`provisioning → dns_pending → connection_pending → verifying → ready`) drive everything via API rather than manual UI clicks.

**Connection method to Smartlead:** SMTP/IMAP **app passwords**, NOT OAuth (locked decision per cycle 2 review — OAuth disconnect requires Smartlead UI to re-auth, which is unscriptable per Smartlead G7).

**[unverified — exact endpoint paths and lifecycle webhook support need to be confirmed against the live Zapmail account during Phase 0.3.]** The research source confirms that the API exists and is documented; specific endpoint shapes were not fetched in the research pass. This is the highest-priority Phase 0 verification item for vendor #2.

### DNS auto-config (SPF, DKIM, DMARC)

Zapmail auto-configures SPF, DKIM, and DMARC at the domain level when the domain is registered through their platform. The DMARC record defaults to `p=none` per industry best practice — we then advance the policy to `p=quarantine` after the 4–6 week monitoring window per D7. The DMARC `rua=` field must point to our chosen aggregator (see §7).

Source: `tmp/research/2026-05-04-mailforge-workspace.md` Side-by-Side table + Outreach Almanac Zapmail review.

### Domain registration

- Buy `.com` burner domains directly through Zapmail at ~$13/yr each.
- Naming convention (per CLAUDE.local.md OQ1, blocking Phase 1): brand-affiliated like `lazer-loans.com`, `getlazerlending.com`, `lazermortgage.com`. Final naming requires client kickoff sign-off.
- Buying through Zapmail (vs Cloudflare/Porkbun) eliminates DNS integration friction. Zapmail handles MX, SPF, DKIM, DMARC records automatically. Burner domains do not need Cloudflare proxy features (they are send-only).

### Tenant model — dedicated per domain (low blast radius)

Zapmail's defining architectural property: **one GWS organization per domain**. If a single mailbox in domain A trips a complaint threshold and Google flags the workspace, the blast radius is limited to that one workspace (one domain, ~3 mailboxes). The other 3–5 burner domains continue sending uninterrupted. This is the workspace-level isolation pattern explicitly cited as the standard mitigation for Google's late-2025 GWS crackdown.

Source: `tmp/research/2026-05-04-mailforge-workspace.md` §6 + Side-by-Side table.

### Risks

- **Newer entrant.** Less long-term track record than direct Google Workspace retail. Operator reports of OAuth disconnect events exist but are not quantified.
- **GWS crackdown context.** Google escalated enforcement against cold-email-flagged GWS tenants throughout late 2025 — entire workspaces locked, triggers including "OAuth connections to known cold platforms (Smartlead, Instantly)." Zapmail's per-domain isolation reduces blast radius but does not eliminate the underlying risk. Mitigation: keep complaint rate below Gmail's 0.10% target via the Wilson-lower-bound watchdog (D16).
- **Pre-warmed mailboxes:** Zapmail markets pre-warmed delivery — verify the warmup state on first connection is sufficient, or rely on Smartlead's bundled warmup network for an additional 14–30 days before live cold sends.

Source: `tmp/research/2026-05-04-mailforge-workspace.md` §6 + §8.

### Unblock checklist

1. Create Zapmail account at https://zapmail.ai.
2. Choose plan tier:
   - **300/day v1 → Starter $39/mo** (10 mailboxes, enough for ~10 mailboxes × 30/day = 300/day).
   - **500/day v1 → Growth $99/mo** (30 mailboxes, headroom to scale to 1,000/day).
3. Register provisioning API key (location TBC during account setup).
4. Register 4–6 brand-affiliated `.com` burner domains through Zapmail (~$13/yr each). Final names pending OQ1 client decision; suggested seeds: `lazer-loans.com`, `lazermortgage.com`, `getlazerlending.com`, `lazerlendinginquiry.com`.
5. Trigger provisioning of 2–3 mailboxes per domain via API (matches D14 — domain breach formula relies on >=50% of mailboxes paused → if 3 per domain, 2/3 paused triggers rotation).
6. Capture into `.env`:
   - `ZAPMAIL_API_KEY` = the provisioning key.
   - `ZAPMAIL_BASE_URL` = (TBC during account setup).
7. Connect first mailbox to Smartlead via OAuth (preferred) or app password (fallback if OAuth-disconnect risk is unacceptable).

---

## 2b. Maildoso (FALLBACK)

If Zapmail is unavailable or rejected by client, Maildoso is the documented fallback:

- **Infrastructure:** Shared SMTP with active IP rotation and self-healing — better reputation isolation than Mailforge's static shared pool, but not real GWS.
- **Pricing:** $75/mo for 30 SMTP mailboxes (monthly) or quarterly billing with bundled domains.
- **Provisioning:** No documented public provisioning API — manual CSV export → Smartlead import (same friction as Mailforge).
- **Deliverability:** Best-rated among shared-IP providers (~75–80% inbox est.) but still below real GWS baseline.
- **Refund:** 30-day money-back guarantee.
- **Smartlead connection:** IMAP/SMTP credentials only.

**Use only if Zapmail is unavailable** — accept the loss of programmatic provisioning and lower deliverability ceiling. Trade-off: lower per-mailbox cost ($2.50/mbx vs $3.30/mbx) at the cost of manual provisioning and shared-IP risk.

Source: `tmp/research/2026-05-04-mailforge-workspace.md` Side-by-Side table.

---

## 2c. Mailforge (NOT RECOMMENDED — documented for completeness)

Mailforge appears in the original plan but research found it unsuitable:

- **63% avg inbox placement vs 82% on real GWS** (independent InboxKit benchmark). 23% spam-folder rate.
- **No provisioning API** — UI-only manual provisioning + CSV export.
- **No real Google Workspace** — proprietary shared SMTP infrastructure on a shared IP pool with all other Mailforge customers (no visibility into co-tenants, no isolation when one bad actor degrades the pool).
- The "$1.67/mailbox" figure cited in CLAUDE.local.md and the original plan is a 200+ mailbox volume tier — at 10–17 mailboxes our actual price would be $3.00/mbx/mo, equivalent to Zapmail real-GWS pricing without the deliverability advantage.

**Do NOT use unless Zapmail and Maildoso are both rejected by the client.** Even then, recommend re-evaluating before commit — for residential mortgage lead quality, the inbox-placement gap is a worse trade than $30/mo of cost savings.

Source: `tmp/research/2026-05-04-mailforge-workspace.md` Executive Summary + §3 + §6.

---

## 3. ZeroBounce — email validation

### Existing partial integration

A single-email validation path exists today in `supabase/functions/apollo-search/index.ts:327–353`. Current behavior:
- Calls `GET https://api.zerobounce.net/v2/validate` with `api_key` query param.
- Reads only `status === 'invalid'` → marks lead `email_status = 'invalid'`.
- Does NOT inspect `sub_status` (misses spamtrap, abuse, do_not_mail, toxic, role_based, disposable).
- Does NOT use `activity_data=true` (misses engagement signal).
- Does NOT write to a `suppressions` table (only flags the lead).
- Treats ZeroBounce errors as non-fatal (correct for Apollo enrichment; NOT acceptable for upload validation).

This is a partial scaffold that needs four extensions. Source: `tmp/research/2026-05-04-zerobounce.md` §"Existing Integration Gap Analysis".

### Required extensions

1. **Extend single-email path** to read all sub-statuses, write to `suppressions` for any drop-mapped result, set `zb_validated_at` timestamp on the lead.
2. **New `validate-upload` Edge Function** — accepts a CSV, calls bulk file API (upload → poll/webhook via `return_url` → download), maps all sub-statuses to dispatcher policies, inserts valid leads + suppressions in one transaction.
3. **JIT 60-day re-validation** in dispatcher — before `claimSendSlot` claims a slot for a lead, check `NOW() - zb_validated_at > INTERVAL '60 days'`. If yes, validate, update, then proceed.
4. **`activity_data=true` flag** for engagement scoring — store `active_in_days` on the lead row; sort send queues so 30/60-day-active inboxes go first, 365+ deprioritized.

### Sub-status policy table

This table is the policy contract — implementation must follow this exactly. Source: `tmp/research/2026-05-04-zerobounce.md` §4.

#### `valid` — safe to email

| Sub-status | Action |
|---|---|
| (none) | Allow — send |
| `alias_address` | Allow — send (forwarder, valid) |
| `leading_period_removed` | Allow — send normalized address |
| `alternate` | Allow with warning — deprioritize in queue |
| `gold` | Allow — prioritize (high engagement) |
| `role_based_accept_all` | Allow — send |
| `accept_all` | Allow — send |

#### `invalid`

| Sub-status | Action |
|---|---|
| `mailbox_not_found` | Drop → suppress |
| `failed_syntax_check` | Drop → suppress |
| `possible_typo` | Manual review — surface `did_you_mean` for human correction before drop |
| `does_not_accept_mail` | Drop → suppress |
| `no_dns_entries` | Drop → suppress |
| `mailbox_quota_exceeded` | Allow with warning — retry once after 48h, suppress if still invalid |
| `unroutable_ip_address` | Drop → suppress |

#### `catch-all`

| Sub-status | Action |
|---|---|
| (none) | Allow with warning — flag `catch_all` on lead, low priority. If domain-cohort bounce rate >5%, suppress domain. |
| `role_based_catch_all` | Drop → suppress |

#### `spamtrap`

| Sub-status | Action |
|---|---|
| (none) | **Hard drop → suppress immediately** |
| `possible_trap` | Drop → suppress |

#### `abuse`

| Sub-status | Action |
|---|---|
| (none) | **Hard drop → suppress** (known spam complainer) |

#### `do_not_mail`

| Sub-status | Action |
|---|---|
| `role_based` | Drop (info@, sales@, support@) — high complaint risk for cold |
| `disposable` | Drop → suppress |
| `toxic` | **Hard drop → suppress** |
| `global_suppression` | **Hard drop → suppress** (may include litigators) |
| `possible_trap` | Drop → suppress |
| `mx_forward` | Drop |
| `role_based_catch_all` | Drop |

#### `unknown` — DO NOT auto-drop

`unknown` is explicitly ambiguous. ZeroBounce does not charge credits for `unknown` results because the answer is indeterminate. Common cause: corporate servers (finance, legal, healthcare) that block external SMTP probes — these are often valid emails. Sub-status policy:

| Sub-status | Action |
|---|---|
| `greylisted` | Retry ZeroBounce after 24–48h. Do NOT send. Do NOT suppress. |
| `antispam_system` | Allow with warning. Schedule JIT re-validation. Monitor cohort bounce rate. |
| `failed_smtp_connection` | Allow with warning |
| `forcible_disconnect` | Allow with warning |
| `mail_server_did_not_respond` | Allow with warning |
| `mail_server_temporary_error` | Allow with warning |
| `timeout_exceeded` | Allow with warning — increase `timeout` on retry |
| `exception_occurred` | Retry immediately (internal ZeroBounce error, not a signal about the email) |

### Pricing — pay-as-you-go credits, $5–15/mo at v1 volume

Credits never expire. Minimum purchase 2,000.

| Credits | $/credit | Total |
|---:|---:|---:|
| 2,000 | $0.0195 | $39 |
| 5,000 | $0.0138 | ~$69 |
| **10,000** | **$0.0129** | **$129** ← recommended buy size |
| 100,000 | $0.00649 | $649 |

**Recommended purchasing strategy:** buy 10,000-credit blocks. At v1 volume (300–500/day with JIT re-validation on ~3.8% of pipeline daily) = ~1,800–3,600 credits/month. One block lasts 3+ months.

ZeroBounce ONE subscription ($79/mo annual) bundles 10K credits + activity data + placement tests + warmup seeds — only worth it if we adopt Phase 3 placement monitoring and bundled features. **For v1 pay-as-you-go is correct.**

Source: `tmp/research/2026-05-04-zerobounce.md` §8.

### Rate limits

| Endpoint | Limit | Block on exceed |
|---|---|---|
| `/v2/validate` (single) | 80,000 / 10s across all regions | 1-min block |
| Bad API key requests | 200 / hour | 1-hour block |
| `/v2/validatebatch` (real-time batch ≤200 emails) | 30 req/min | 10-min block |
| File API (`sendfile`/`filestatus`/`getfile`) | No documented per-min limit | — |

Existing integration validates 5 emails in parallel via `Promise.all` — well within limits. No concurrency changes needed for JIT.

Source: `tmp/research/2026-05-04-zerobounce.md` §7.

### Gotchas

- **`unknown` is NOT a drop.** Most-cited mistake. Suppress only specific `unknown` sub-statuses (`greylisted` is retry, others are allow-with-warning).
- **`mailbox_quota_exceeded` is temporary.** Retry after 48h before suppressing.
- **Greylisting is normal.** Bulk file API auto-pauses 20 min and retries — total processing time inflates by up to 35 min per file, which is expected.
- **No documented SLA.** Treat ZeroBounce failure with circuit-breaker: 3 retries with exponential backoff → if still down, mark batch `zb_status=pending_validation`, refuse sends, alert operator.
- **Result file retention duration not documented.** Files stay until explicitly deleted via `/v2/deletefile` — confirm with support if long-term retention matters.

### Unblock checklist

1. Buy ZeroBounce credits at https://www.zerobounce.net/email-validation-pricing (10K block at $0.0129/credit = $129, covers ~3 months at v1 volume).
2. Capture into `.env`:
   - `ZEROBOUNCE_API_KEY` = key from account dashboard. Note: this var likely already exists in Connect CRM scaffold (`apollo-search` integration); reuse the existing var name and value.
3. (No webhook setup needed — file API supports polling or `return_url` callback at upload time.)

---

## 4. Follow Up Boss — qualified-lead destination CRM

### What it does

Follow Up Boss is **Lazer's primary CRM** — the system their sales reps already live in. Our role is to push only qualified positive replies into it, never raw leads. FUB handles dedup, agent assignment, action plans, and stage transitions. Our CRM is upstream cold-outreach plumbing; FUB is the system of record for warm leads.

### Authentication

- **Method:** HTTP Basic Auth — username = API key, password = blank. Wire format: `Authorization: Basic <base64(api_key:)>`.
- **Plus required headers on every request:**
  - `X-System: lazer-lending-crm` (human-readable system name).
  - `X-System-Key: <secret>` (issued by FUB support after registering the integration).
- **Key generation:** Admin → API panel inside FUB. **The key is shown exactly once at creation.** If lost, regeneration invalidates the old key and breaks any running integrations.
- **Account role:** use an **Owner or Admin API key** — Agent and Lender keys are scope-restricted and the push will fail when the assigned agent doesn't match.
- **X-System-Key registration is a blocking prerequisite.** Without it, rate limits drop to half (125 vs 250 global/10s window). Email FUB support to register `lazer-lending-crm` as a system before Phase 2 starts.

Source: `tmp/research/2026-05-04-followupboss.md` §1.

### CRITICAL: use POST /v1/events, NEVER POST /v1/people

FUB's own Lead Provider Integration Guide states explicitly:

> "Do not use /people endpoint to send new leads into Follow Up Boss, as it won't trigger automations in FUB, can cause duplicates and other adverse effects."

Use **`POST /v1/events`** for all lead pushes. Reasons:

- `/v1/events` automatically deduplicates on phone or email match.
  - HTTP 200 → existing person updated, returns existing person ID.
  - HTTP 201 → new person created.
  - HTTP 204 → FUB archived/ignored the lead flow (e.g., suppression rule matched). **Treat 204 as a failure case** — log + alert.
  - HTTP 404 → person ID supplied but not found.
- `/v1/people` bypasses action plans, agent assignment rules, and notification triggers — single biggest footgun in the FUB integration.

**No GET pre-check is needed** before push. The events endpoint is the atomic dedup+create operation.

Source: `tmp/research/2026-05-04-followupboss.md` §2 + §3.

### Person model + email normalization

Emails are an array of `{type, value}` objects, first = primary:
```json
{
  "person": {
    "firstName": "Jane",
    "lastName": "Borrower",
    "emails": [{ "type": "work", "value": "jane@borrower.com" }],
    "phones": [{ "type": "mobile", "value": "+15555551234" }],
    "stage": "Lead",
    "tags": ["cold-reply", "cold-reply-{campaign_slug}", "lazer-crm"]
  }
}
```

**FUB does not document server-side email normalization.** We must normalize on our side: lowercase, strip plus-tags, trim whitespace. Our `email_normalized` column (per CONNECT-CRM-AUDIT-DELTA.md) is the authoritative key — pass it as `emails[0].value` on push. There is no downside to normalizing on our side regardless of whether FUB does too.

### Tags + stages + pipelines

#### Recommended tagging convention

| Tag | Purpose |
|---|---|
| `cold-reply` | Every push from our system |
| `cold-reply-{campaign_slug}` | Campaign provenance for FUB-side filtering |
| `classified-positive` | Classifier output stored alongside |
| `lazer-crm` | Integration source identifier |

Tags are auto-created if they don't already exist — no pre-registration needed.

#### Stages
Stages are pipeline-scoped. Default if unset = "Lead", which may or may not be in Lazer's desired pipeline. Confirm target stage and pipeline names against the live FUB account via `GET /v1/stages` and `GET /v1/pipelines` during Phase 0.5 client kickoff. Pass stage as a string (stage name, not ID): `"stage": "Lead"`. Per-campaign overrides are possible (e.g., refinance campaigns → "Refi Prospect", purchase campaigns → "Buyer Prospect").

Source: `tmp/research/2026-05-04-followupboss.md` §4 + §5.

### Notes — sanitized, no raw reply body, with link back to our CRM

After event push succeeds, attach a note via `POST /v1/notes`:
```json
{
  "personId": <fub_person_id>,
  "subject": "Cold reply classified POSITIVE — Lazer CRM",
  "body": "Campaign: <name>\nMailbox: <alias>@<burner>\nClassified: POSITIVE (confidence: 0.91)\nFirst sentence (redacted): \"<truncated>\"\nView full reply: https://crm.lazerlending.com/replies/<reply_id>\nClassified by: Lazer CRM on <iso_timestamp>"
}
```

**Do NOT include raw reply body** — PII and retention policy concerns (D15). First sentence redacted to ~100 chars + link to our CRM. Source: `tmp/research/2026-05-04-followupboss.md` §6.

### Rate limits

Sliding 10-second window. With valid `X-System-Key`:

| Context | Limit / 10s |
|---|---|
| `POST.events` | **Unlimited** |
| `events` (GET) | 20 |
| `global` | 250 |
| `PUT.people` | 25 |
| **`notes`** | **10** ← binding constraint |

Without `X-System-Key`, global drops to 125 and events GET to 10.

**The 10/10s notes limit is the binding constraint.** Events POST is unlimited so a 50-positive-reply burst can push events immediately, but the matching 50 notes must space at ~1.1s/note (or 10 per 11s burst). At v1 volume (≤50 positive replies/day), a sequential loop with token-bucket pacing handles it trivially.

429 responses include `Retry-After` header in seconds — request is NOT processed on 429 and must be retried in full.

Source: `tmp/research/2026-05-04-followupboss.md` §7.

### Webhooks back from FUB

FUB can push events back to us when reps update records:

| Event | Trigger |
|---|---|
| `peopleStageUpdated` | Rep moves a person to a different stage (most useful — closes the cold-reply → meeting-scheduled feedback loop) |
| `peopleUpdated` | Any person field change |
| `peopleTagsCreated` | Tag added |
| `peopleCreated` / `peopleDeleted` / `peopleRelationship*` | Self-explanatory |

Webhook payload includes `eventId` (UUID for idempotency), `event` (type), `resourceIds`, `uri`, and `data`. Signed with `FUB-Signature` header (SHA256 of base64-encoded JSON keyed with our `X-System-Key`). Verify on receipt to prevent spoofing.

Configure via `POST /v1/webhooks` (API only — not the FUB admin UI). Max 2 webhooks per event type per system. Retries at 1m / 5m / 5m / 10m / 30m (5 retries total).

Not required for v1, but plumbing cost is low — register `peopleStageUpdated` during Phase 2 setup to feed classifier improvement data later. Source: `tmp/research/2026-05-04-followupboss.md` §8.

### Pricing — API tier confirmation needed with client

| Plan | Annual $/mo | Users | Notes |
|---|---:|---:|---|
| Grow | $58/user | per-seat | API access not explicitly documented |
| Pro | $416 | 10 | API access TBC |
| Platform | $833 | 30 | Third-party sources cite API access here |

FUB's pricing page does not list API access as a per-tier feature. Help center positions API as openly available. Third-party analysis (Rollout, CloudTalk) suggests Platform is the API tier — but this is unconfirmed. **Confirm with Lazer's FUB account rep before Phase 2 starts.** If Lazer is on Grow or Pro and the API key generates successfully in Admin → API, no upgrade is needed. If blocked, Platform is the path.

Source: `tmp/research/2026-05-04-followupboss.md` §9.

### Gotchas

1. **P1 — Use `/v1/events`, never `/v1/people` for lead creation.** Bypasses automations, creates duplicates.
2. **P2 — API key shown exactly once.** Capture immediately or regenerate (which breaks running integrations).
3. **P3 — Missing `X-System-Key` halves rate limits.** Register before Phase 2.
4. **P4 — Events with `occurredAt` >24h in the past are treated as historical and do not fire automations.** Always set `occurredAt` to the classification time, not the original cold send time.
5. **P5 — Custom fields use machine names, not display names.** A field labeled "Closing Date" might be `customClosingDate`. Look up via `GET /v1/customFields`. Hardcoding display names will silently fail to set the field if a Lazer admin renames it.
6. **P6 — Webhook limit 2 per event per system.** A third registration has undefined behavior.
7. **P7 — HTTP 204 on events = silently ignored by FUB.** No person created or updated. Log + alert so Lazer reps can investigate suppressed pushes.
8. **P8 — Email normalization is our responsibility.** No documented server-side normalization — pass `email_normalized`.
9. **P9 — Default stage = "Lead", not pipeline-gated.** Confirm target stage maps to the right pipeline.

Source: `tmp/research/2026-05-04-followupboss.md` §10.

### Unblock checklist

1. Confirm API access on Lazer's FUB plan (call Lazer's account rep at FUB).
2. Generate Owner or Admin API key in Admin → API panel. **Capture immediately — shown only once.**
3. Email FUB support to register `lazer-lending-crm` as a system → receive `X-System-Key` (one-time setup, blocking for Phase 2).
4. Confirm target pipeline + stage with `GET /v1/pipelines` and `GET /v1/stages` against Lazer's account.
5. Confirm any Lazer-specific custom fields with `GET /v1/customFields` to capture machine names (P5).
6. Capture into `.env`:
   - `FUB_API_KEY` = key from step 2.
   - `FUB_X_SYSTEM=lazer-lending-crm`
   - `FUB_X_SYSTEM_KEY` = key from step 3.
   - `FUB_DEFAULT_STAGE_NAME` = stage NAME (string, NOT id) from step 4. The `POST /v1/events` payload references stages by name.
   - `FUB_DEFAULT_SOURCE_LABEL=Lazer Lending CRM Cold Outreach`
7. Optional Phase 2.5+: register `peopleStageUpdated` webhook for feedback loop.

---

## 5. Resend — transactional only (NOT cold)

### What it does

Resend handles internal-only transactional email:
- Reply notifications to assigned Lazer team members ("New positive cold-reply on campaign X").
- Watchdog pause alerts ("Mailbox alias@burner.com paused — Wilson lower-bound complaint exceeded 0.10%").
- Daily/weekly ops digests.
- Bounce-cascade notifications.
- FUB-push confirmations / failures.
- System alerts (auth events, integration outages).

**Recipients are internal Lazer staff only.** Resend never sends to a prospect. The cold-outbound flow exits exclusively through Smartlead.

### Why retained

The Connect CRM scaffold already integrates Resend (`supabase/functions/send-email/index.ts` and `process-campaigns/index.ts`). Refactoring to transactional-only is cheap — change the from-domain constant and remove the cold batch-send path from `process-campaigns`. See CONNECT-CRM-AUDIT-DELTA.md §"Resend integration scope" for exact code locations.

### From-domain — `notify.lazerlending.com`, NEVER `lazerlending.com` root

- All Resend sends from `notify.lazerlending.com`.
- `lazerlending.com` (root brand) **never** sends any email — preserves brand reputation.
- DNS records (SPF, DKIM, DMARC) live on `notify.lazerlending.com` subdomain. Add an explicit `_dmarc.notify.lazerlending.com` TXT record to decouple subdomain DMARC policy from any future root-domain DMARC.
- If the root domain ever gets a DMARC record, the subdomain inherits it unless an explicit subdomain record is set — explicit record lets subdomain advance independently.

Source: `tmp/research/2026-05-04-resend-compliance.md` §1.6.

### AUP ceiling — 0.08% complaint rate

Resend's AUP enforces:

| Signal | Threshold | Consequence |
|---|---|---|
| Complaint rate | **<0.08%** | Account shutdown without warning |
| Bounce rate | **<4%** | Account shutdown without warning |

The 0.08% ceiling is **stricter than Gmail's 0.10% target** and stricter than our Smartlead-side watchdog at 0.10%. Since recipients are internal Lazer staff (not prospects), complaint rate stays effectively zero. This is why transactional-only is safe.

**Edge case to avoid:** never put a prospect's email address in the Resend "To:" field. All Resend messages route to internal Lazer addresses only. This is the load-bearing rule that keeps us inside Resend's AUP.

Source: `tmp/research/2026-05-04-resend-compliance.md` §1.2 + §1.4.

### What we changed in send-email

CONNECT-CRM-AUDIT-DELTA.md notes the existing scaffold:
- `supabase/functions/send-email/index.ts:8` hard-codes `EMAIL_DOMAIN = 'integrateapi.ai'`.
- `supabase/functions/process-campaigns/index.ts:7-8` hard-codes both `'integrateapi.ai'` and `'mail.integrateapi.ai'`.

**Required Phase 1 changes:**
1. Convert `EMAIL_DOMAIN` constants to env-var driven (`RESEND_TRANSACTIONAL_DOMAIN`).
2. `send-email` continues handling internal compose/reply (keep behavior, change domain).
3. Remove Resend-batch path from `process-campaigns` for cold campaigns — gate behind `campaign.provider === 'resend'`. Cold campaigns (`campaign.provider === 'smartlead'`) bypass Resend entirely.
4. `email-events` (Resend webhook receiver) continues to handle transactional inbound only — cold replies come via the new `smartlead-events` function.

### Free tier (3K/mo) covers v1 transactional volume

| Plan | $/mo | Monthly cap | Daily cap | Domains |
|---|---:|---:|---:|---:|
| **Free** | **$0** | **3,000** | **100/day** | **1** |
| Pro 50K | $20 | 50,000 | none | 10 |
| Pro 100K | $35 | 100,000 | none | 10 |

Estimate for a 500/day cold operation: 10–50 internal alerts/day → well inside free tier. Upgrade trigger: if Lazer ever adds customer-facing transactional emails (lead-confirmation receipts, etc.) through the same account, move to Pro 50K.

Source: `tmp/research/2026-05-04-resend-compliance.md` §1.5.

### Unblock checklist

1. Confirm Lazer's existing Resend account access OR sign up at https://resend.com (free tier OK for v1).
2. Add `notify.lazerlending.com` as a Resend domain in the dashboard.
3. Configure DNS for `notify.lazerlending.com` (NOT for `lazerlending.com` root):
   - SPF: per Resend dashboard (uses SES infra under the hood — exact record value comes from Resend).
   - DKIM: CNAME records auto-provided by Resend.
   - DMARC: add manually:
     ```
     TXT _dmarc.notify.lazerlending.com
     v=DMARC1; p=none; rua=mailto:dmarc-reports@lazerlending.com; ruf=mailto:dmarc-forensics@lazerlending.com; fo=1;
     ```
   - Start at `p=none` for 14+ days, then advance to `p=quarantine` after confirming all legitimate sends are DKIM-aligning.
4. Set up Postmaster Tools for `notify.lazerlending.com` on day 1 (data populates after consistent volume).
5. Capture into `.env`:
   - `RESEND_API_KEY` = key from Resend dashboard.
   - `RESEND_TRANSACTIONAL_DOMAIN=notify.lazerlending.com`
   - `RESEND_FROM_DEFAULT=alerts@notify.lazerlending.com` (or per-team-member alias scheme).

---

## 6. LLM classifier — provider TBD

### Why

Cold replies are classified into one of five categories: **positive / neutral / OOO / unsubscribe / negative**. Classification drives routing:
- `positive` → push to FUB via `POST /v1/events`.
- `negative` / `unsubscribe` → suppression-list insert + stop-on-reply across all campaigns.
- `OOO` → never push to FUB; auto-snooze if return-date is parseable (D5 pending OQ5).
- `neutral` → wait for human tag (D4 pending OQ4).

### Two-stage architecture

| Stage | Handles | Cost |
|---|---|---|
| **Keyword pre-classifier** | ~70% of replies (clear unsubs, obvious OOO autoresponders, one-word negatives) | $0 — runs in our edge function |
| **LLM classifier** | Ambiguous ~30% with redacted body | ~$0.001–0.005 per call |

The keyword stage is built in our function and trims LLM cost dramatically. Only the ambiguous tail (mixed signals, conditional positives, sarcasm, ESL replies) reaches the LLM.

### Provider requirements — no-train DPA REQUIRED

Reply bodies contain PII (borrower contact info, financial details). The LLM provider's data-processing addendum must explicitly state that submitted prompts are not used to train models.

| Provider | No-train DPA? | Notes |
|---|---|---|
| **Anthropic API (default)** | Yes — standard ToS includes no-train | Default option per CLAUDE.local.md OQ9 |
| **OpenAI Enterprise** | Yes — Enterprise tier only | Standard OpenAI API does NOT have no-train; requires Enterprise contract |
| OpenAI standard | **No** — disqualified | Do not use under any circumstances |
| Other (Cohere, Mistral, etc.) | Vary — verify per-vendor before adoption | Not pre-cleared |

Lazer's compliance team must approve the chosen provider. Anthropic API is the default; OpenAI Enterprise is the alternate if Lazer has an existing enterprise relationship.

### PII redaction before LLM input

Before sending the reply body to the LLM:
1. Strip email headers and signatures (regex on common patterns).
2. Mask explicit PII: phone numbers, SSN, full street addresses, dollar amounts, account numbers.
3. Truncate to first 3 sentences or 500 chars.
4. Pass only the redacted body + minimal context (campaign name, campaign topic).

The LLM sees enough to classify but never sees enough to be a meaningful PII surface even if the provider's no-train commitment fails.

### Unblock checklist

1. Client picks Anthropic API or OpenAI Enterprise (Lazer compliance must approve — OQ9 closes here).
2. Generate API key on chosen platform.
3. Confirm DPA in writing (file in `tmp/contracts/llm-dpa-{vendor}-{date}.pdf`).
4. Capture into `.env`:
   - `CLASSIFIER_PROVIDER=anthropic` (or `openai-enterprise`).
   - `CLASSIFIER_MODEL=claude-3-5-sonnet-latest` (or chosen GPT-4-class model).
   - `CLASSIFIER_API_KEY` = key from step 2.

---

## 7. DMARC RUA aggregator

### Purpose

DMARC `rua=` (aggregate report) emails arrive daily from receiving providers (Gmail, Yahoo, Microsoft) summarizing how our domain's mail authenticated. The aggregator parses the XML reports and surfaces signals like:
- "Are 95%+ of legitimate sends DKIM-aligning?" → required gate before advancing `p=none → p=quarantine` (D7).
- "Is anyone spoofing our burner domain?" → uncommon at our scale but the aggregate report is the only way to know.
- Per-domain reputation drift over the 4–6 week ramp window.

This is the data that makes the DMARC ramp signal-driven rather than calendar-driven.

### Recommendation — Cloudflare DMARC Management (free tier)

Per CLAUDE.local.md tool state: `DMARC_RUA_PROVIDER=cloudflare` is the default. Cloudflare DMARC Management is a free service that ingests RUA reports, parses them, and presents a dashboard.

Alternatives (paid, more sophisticated): dmarcian, Valimail, EasyDMARC, Postmark's DMARC Digests. None are needed at v1 volume.

### Configuration

For each burner domain, the DMARC TXT record's `rua=` field must point to the aggregator's intake address:
```
TXT _dmarc.<burner-domain>
v=DMARC1; p=none; rua=mailto:<aggregator-intake>@dmarc.cloudflare.net; fo=1;
```

The exact intake address comes from Cloudflare's setup wizard (Cloudflare gives a unique address per account).

### Unblock checklist

1. Sign up for Cloudflare DMARC Management (free) at https://dash.cloudflare.com/?to=/:account/email/dmarc.
2. Configure RUA mailbox in Cloudflare dashboard → copy the aggregator intake address.
3. Set `rua=mailto:<intake>@dmarc.cloudflare.net` on every burner domain's `_dmarc` TXT record (Zapmail handles the actual DNS write — provide the value during domain provisioning).
4. Capture into `.env`:
   - `DMARC_RUA_PROVIDER=cloudflare`
   - `DMARC_RUA_ENDPOINT` = (only set if self-hosting an aggregator, which we are not).

---

## Cross-vendor cost summary at 300–500/day v1

| Vendor | Tier | $/mo |
|---|---|---:|
| Smartlead | Pro (annual) | $78 |
| Zapmail | Starter (300/day) or Growth (500/day) | $39–99 |
| Burner domains (4–6 × $13/yr ÷ 12) | — | $4–7 |
| ZeroBounce | Pay-as-you-go credits | $5–15 |
| Resend | Free tier | $0 |
| LLM classifier (Anthropic/OpenAI Enterprise) | API usage | $5–20 |
| DMARC RUA (Cloudflare DMARC Mgmt) | Free | $0 |
| Follow Up Boss | Lazer's existing seat | $0 (already paid) |
| **Total realistic v1** | | **~$130–220/mo** |

The earlier $90–120/mo figure in CLAUDE.local.md assumed Mailforge at $1.67/mbx — which research invalidated. Honest range at 300–500/day with real GWS via Zapmail is **$200–300/mo realistic infrastructure** when LLM classification volume and contingency are included. This is still well below the original $400–600/mo "ceiling case" architecture the user pushed back on.

---

## What still needs Lazer client input

Several items remain blocked on the Phase 0.5 client kickoff to close the 13 Open Questions in `PLAN.md`. Most-relevant to vendor onboarding:

- **OQ1** — Burner-domain naming + legal ownership (Lazer or IntegrateAPI?). Blocks Zapmail domain registration.
- **OQ2** — Reply forwarding default address(es). Blocks Resend internal-alert recipient list.
- **OQ3** — Forwarder mode (IMAP redirect default vs Resend forward). Affects Resend volume estimation.
- **OQ4–OQ5** — Neutral and OOO routing rules. Affects classifier output → routing logic.
- **OQ6** — Compliance footer text (state-specific lending disclosures, NMLS, licensing). Affects every Smartlead campaign sequence step body.
- **OQ7** — Lazer's existing `lazerlending.com` Workspace tenant — does it already exist? Affects whether `notify.lazerlending.com` shares records or runs independently.
- **OQ8** — DMARC ramp policy timeline acceptance.
- **OQ9** — LLM provider with no-train DPA — Anthropic API or OpenAI Enterprise.
- **OQ10** — Reply body retention window (default 18 months then redact).

Track these in a `BLOCKED-AWAITING-CLIENT.md` document (to be created in Phase 0.5) so the implementer knows what cannot move until kickoff lands.

---

## Source files cited

- `tmp/research/2026-05-04-smartlead.md` — Smartlead API + webhooks + pricing
- `tmp/research/2026-05-04-mailforge-workspace.md` — Zapmail / Maildoso / Mailforge comparison + GWS context
- `tmp/research/2026-05-04-zerobounce.md` — ZeroBounce sub-status policy + pricing
- `tmp/research/2026-05-04-followupboss.md` — FUB API + auth + rate limits + gotchas
- `tmp/research/2026-05-04-resend-compliance.md` — Resend AUP + RFC 8058 + Gmail/Outlook/Yahoo enforcement
- `docs/lazer-lending/CONNECT-CRM-AUDIT-DELTA.md` — actual scaffold state (Resend integration scope, EMAIL_DOMAIN constants, existing functions to extend)
