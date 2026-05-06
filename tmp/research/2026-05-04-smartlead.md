# Smartlead.ai API Research

**Research date:** 2026-05-04
**Researcher:** Technical research agent (claude-sonnet-4-6)
**Purpose:** Headless cold-email CRM integration — Smartlead Pro as send engine, no UI usage
**Confidence key:** [CONFIRMED] = in official docs/direct fetch | [OPERATOR-REPORT] = from third-party practitioners | [UNVERIFIED] = could not find in docs

---

## 1. Authentication

### Method
Smartlead uses **API key authentication only** — no OAuth, no Bearer tokens.

- **Parameter name:** `api_key` (query parameter appended to every request URL)
- **Header format:** None for the API key itself. It is NOT passed as `Authorization: Bearer` or `X-API-Key`. It is a URL query parameter exclusively.

**Example:**
```
GET https://server.smartlead.ai/api/v1/campaigns/?api_key=YOUR_API_KEY
```
Source: https://api.smartlead.ai/reference/authentication

### Per-account vs per-workspace (client-level) keys
Smartlead supports two key types:

| Type | Scope | Rate limit |
|---|---|---|
| Account-level key | Main Smartlead account; all campaigns/mailboxes | 60 req/min (Standard) or 120 req/min (Pro) |
| Client-level key | Scoped to a single client under white-label setup | 60 req/min default; adjustable |

Client-level keys are created at **Settings > API Key Management**. Each key is shown only once at creation. The `client_id` query parameter is used alongside the main account key to scope requests to a specific client.

Source: https://helpcenter.smartlead.ai/en/articles/430-how-client-level-api-keys-work-in-smartlead

### Security note
Because the API key is a URL query parameter, it will appear in server access logs on any HTTP intermediary. Always use HTTPS (enforced by Smartlead's base URL) and treat the key as a credential.

---

## 2. Send Endpoint

### Critical architectural finding — there is NO transactional send endpoint
[CONFIRMED] Smartlead does **not** have a point-and-send endpoint that dispatches a single email through a named mailbox. **All email dispatch is campaign-based.**

The correct mental model: our CRM does not call "send this email now from mailbox X." Instead, it:
1. Creates a campaign (`POST /api/v1/campaigns/create`)
2. Adds email sequence steps (`POST /api/v1/campaigns/{campaign_id}/sequences`) — subject, HTML body, delay between steps
3. Adds leads to the campaign in batches (`POST /api/v1/campaigns/{campaign_id}/leads`, max 100 per request per one source; up to 400 per request per another source — **[UNVERIFIED — verify limit in sandbox]**)
4. Connects email accounts to the campaign (`POST /api/v1/campaigns/{campaign_id}/email-accounts`)
5. Configures schedule/settings (`POST /api/v1/campaigns/{campaign_id}/settings`)
6. Activates the campaign (`PATCH /api/v1/campaigns/{campaign_id}/status` with status `ACTIVE`)

Once active, Smartlead's own scheduler reads the connected mailbox caps, warmup settings, and time-window config and dispatches autonomously.

Sources:
- https://api.smartlead.ai/core/campaigns
- https://www.octavehq.com/post/smartlead-api-guide-build-custom-workflows

### Sequence step payload fields (documented)
When adding sequence steps, the documented fields include:
- `seq_number` — step position in sequence
- `subject` — email subject (supports Smartlead variables like `{{first_name}}`)
- `email_body` — HTML or plain text body
- `reply_to_id` — references the prior step for threading replies correctly
- `delay_in_days` — days to wait before this step

**`from_account_id` field:** [UNVERIFIED — verify in sandbox] The campaigns/sequences model means the "from" mailbox is set at the campaign-account-connection level, not per individual send. Whether a `from_account_id` can be specified per lead or per step is not confirmed in documentation.

### Custom headers (List-Unsubscribe / RFC 8058)
[UNVERIFIED] No API endpoint for injecting arbitrary custom SMTP headers per message or per campaign step was found in any official documentation. What Smartlead does document:

- A campaign-level toggle: "Add unsubscribe message in all emails" — when enabled, Smartlead **automatically adds an Unsubscribe Header Tag** that provides one-click unsubscribe compliance with Google's requirements.
- The unsubscribe text appended to email body is customizable via `unsubscribe_text` in campaign settings.
- Whether the generated header is a proper RFC 8058 `List-Unsubscribe: <https://...>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` pair is **[UNVERIFIED — inspect raw MIME on first sandbox send to confirm]**.

**Risk for our build:** If Smartlead's auto-generated List-Unsubscribe URL is not under our control (i.e., it points to Smartlead's own unsubscribe endpoint, not our `LIST_UNSUB_TOKEN_SECRET`-signed endpoint), we cannot enforce our own suppression-list insert logic via HMAC-verified POST. We will need to either:
  - (a) Accept Smartlead's endpoint and rely on the `EMAIL_UNSUBSCRIBED` / `LEAD_UNSUBSCRIBED` webhook to trigger our suppression insert (latency risk), OR
  - (b) Verify whether a custom unsubscribe URL can be injected as a campaign setting.

**Action:** In Phase 0.6 sandbox test, inspect raw MIME headers on a sent message and contact Smartlead support to confirm whether custom List-Unsubscribe URLs are supported.

Sources:
- https://helpcenter.smartlead.ai/en/articles/27-how-does-unsubscribing-work-in-smartlead-manage-unsubscribed-leads-effectively
- https://support.google.com/a/answer/14229414

### Sync response format for campaign activation
[CONFIRMED] The API returns standard HTTP 200/201 responses with JSON body. The `status` PATCH returns immediately. However, there is **no per-email message ID returned at dispatch time** — because dispatch is asynchronous and Smartlead-driven after activation. The `message_id` only appears later in webhook payloads when Smartlead fires the `EMAIL_SENT` event (or in reply webhooks as the replying message's ID).

---

## 3. Mailbox / Email Account Management

### List connected mailboxes
```
GET https://server.smartlead.ai/api/v1/email-accounts/?api_key=YOUR_KEY
```
Returns all connected email accounts with their configuration.

### Create / add a new mailbox
```
POST https://server.smartlead.ai/api/v1/email-accounts/save
```
Two connection methods:
- **SMTP/IMAP (programmatic):** Provide `smtp_host`, `smtp_port`, `smtp_username`, `smtp_password`, `imap_host`, `imap_port` — fully API-driven.
- **Gmail / Outlook OAuth:** Connection is completed via OAuth flow in the Smartlead UI. **[UNVERIFIED — confirm whether API-initiated OAuth is possible without UI visit]**. For our headless integration, SMTP/IMAP credentials are the safe path for new mailboxes. Mailforge-provisioned Google Workspace mailboxes support app passwords for SMTP.

Source: https://api.smartlead.ai/core/email-accounts

### Warmup status
No dedicated `warmup_ready` boolean or `warmup_status` enum was found in docs. The documented fields on an email account object:
- `warmup_enabled` (boolean) — whether warmup is active
- `total_warmup_per_day` (integer) — max warmup emails/day
- `daily_rampup` (integer) — warmup volume added per day
- `reply_rate_percentage` (integer) — simulated reply rate during warmup
- `max_email_per_day` (integer) — total cap (warmup + campaign) per day

**Warmup stats endpoint:**
```
GET https://server.smartlead.ai/api/v1/email-accounts/{email_account_id}/warmup-stats
```
Returns last 7 days of warmup statistics. [UNVERIFIED — confirm exact response fields in sandbox]

**Implication for our `mailbox_state` machine:** There is no API-provided `warmup_ready` boolean. Our CRM will need to implement its own readiness gate — e.g., "warmup has run for N days and warmup reputation score >= 80%" — by reading the warmup-stats endpoint on a schedule and comparing against our own threshold policy.

Source: https://api.smartlead.ai/guides/email-warmup

### Today's sent count
[UNVERIFIED] No documented field for real-time "sent today" count per mailbox was found. Campaign-level analytics are available by date range but per-mailbox daily-sent tracking requires verification. Our daily-cap enforcement logic (`claimSendSlot`) will need to maintain its own local counter and reconcile against Smartlead stats periodically.

---

## 4. Webhooks — Critical Section

### Event types (confirmed exact names)
Two sources give slightly different lists; taking the union:

| Event name | Description |
|---|---|
| `EMAIL_SENT` | Email dispatched from mailbox |
| `EMAIL_OPENED` | Tracking pixel fired |
| `EMAIL_CLICKED` | Link click tracked |
| `EMAIL_REPLIED` | Reply received in mailbox |
| `EMAIL_BOUNCED` | Hard or soft bounce |
| `EMAIL_UNSUBSCRIBED` | Lead clicked unsubscribe link |
| `LEAD_UNSUBSCRIBED` | [alternate name seen in one source] |
| `LEAD_CATEGORY_UPDATED` | Lead status/category changed |
| `EMAIL_ACCOUNT_DISCONNECTED` | Mailbox auth failure |
| `CAMPAIGN_BOUNCE_THRESHOLD_BREACHED` | [seen in sample payload doc] |

**[UNVERIFIED — verify exact canonical event name strings against sandbox webhook deliveries]** The two docs consulted are slightly inconsistent: one shows `EMAIL_UNSUBSCRIBED`, another shows `LEAD_UNSUBSCRIBED`. Both may exist as separate events or be aliases.

Sources:
- https://api.smartlead.ai/core/webhooks
- https://api.smartlead.ai/guides/webhook-integration

### Payload schema

**Base fields (all events):**
```json
{
  "event": "EVENT_NAME",
  "timestamp": "2024-11-25T11:00:00Z",
  "campaign_id": 123,
  "campaign_name": "Q1 Outreach",
  "lead_id": 789,
  "email_account_id": 456,
  "sequence_number": 1,
  "lead": {
    "email": "lead@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "company_name": "Acme Corp",
    "custom_fields": {}
  }
}
```

**EMAIL_REPLIED — additional fields:**
```json
{
  "reply": {
    "subject": "Re: Quick question",
    "body": "Thanks for reaching out. I'm interested...",
    "received_at": "2024-11-25T11:00:00Z",
    "message_id": "reply-abc123"
  }
}
```
Reply body IS included in the webhook payload. [CONFIRMED]

**Threading headers (In-Reply-To, References):** [UNVERIFIED — not documented, not found in any payload sample]  
The `message_id` in the reply object is the incoming reply message's ID, not the original sent message's ID. Whether the original send's message ID is cross-referenced is [UNVERIFIED].

**EMAIL_OPENED — additional fields:**
```json
{
  "opened_count": 2,
  "first_opened_at": "...",
  "last_opened_at": "..."
}
```

**EMAIL_CLICKED — additional fields:**
```json
{
  "link": {
    "url": "https://...",
    "clicked_at": "..."
  }
}
```

**EMAIL_ACCOUNT_DISCONNECTED payload:**
```json
{
  "eventType": "EMAIL_ACCOUNT_DISCONNECTED",
  "accountId": 139919,
  "email": "sender@burner.com",
  "error": "SMTP Failure - Host unavailable",
  "appUrl": "https://app.smartlead.ai/...",
  "title": "...",
  "message": "..."
}
```
Note: this event type uses `eventType` (camelCase) not `event` — inconsistency with other events. [UNVERIFIED — verify field name consistency in sandbox]

Sources:
- https://api.smartlead.ai/reference/email-reply-webhooks
- https://helpcenter.smartlead.ai/en/articles/88-emailsocial-platform-disconnect-payload

### Signing scheme
[CONFIRMED] Smartlead signs webhook payloads using **HMAC-SHA256**.

- **Signature header:** `X-Smartlead-Signature`
- **Format:** `sha256=<hex_digest>`
- **Algorithm:** HMAC-SHA256 over the raw request body using the webhook secret configured at registration time
- **Verification:** Use constant-time comparison (`hmac.compare_digest()` in Python equivalent) to prevent timing attacks.

**[UNVERIFIED — confirm whether timestamp is also mixed into the HMAC, or whether it is body-only]**

**Idempotency header:** `X-Request-Id` — a unique ID per event delivery, present on every webhook POST. Use this as the deduplication key in our `webhook_events` table's `(provider, external_event_id)` unique constraint.

**Webhook level header:** `X-Webhook-Level` — values: `user`, `client`, `campaign`. Indicates which association scope fired the webhook.

Source: https://helpcenter.smartlead.ai/en/articles/403-quick-tips-for-testing-with-sample-webhook-payloads

### Retry behavior
Two sources give partially conflicting counts:

| Source | Retry count | Intervals |
|---|---|---|
| `api.smartlead.ai/core/webhooks` | 5 retries | 1 min, 5 min, 15 min, 1 hr, 6 hr |
| `api.smartlead.ai/guides/webhook-integration` | 3 retries | 1 min, 5 min, 30 min |

**After maximum retries, the webhook is disabled.** Re-enablement mechanism: [UNVERIFIED — check webhook management dashboard or re-registration endpoint].

**Critical:** Our handler must return HTTP 200 **within 30 seconds** or Smartlead counts the delivery as failed and schedules a retry. Process webhook payload asynchronously (enqueue to Supabase job queue) and return 200 immediately.

**Total retry window (worst case, 5-retry model):** ~7 hours. Events that cannot be delivered within this window are permanently lost — no dead-letter queue is documented.

Sources:
- https://api.smartlead.ai/core/webhooks
- https://api.smartlead.ai/guides/webhook-integration
- https://helpcenter.smartlead.ai/en/articles/417-how-to-resolve-webhook-failures

### Webhook registration
```
POST https://server.smartlead.ai/api/v1/webhooks
```
Required fields:
- `webhook_url` — HTTPS endpoint (HTTP rejected)
- `email_campaign_id` — campaign to associate
- `association_type` — `1` (user), `2` (client), `3` (campaign)
- `event_type_map` — boolean flags object for each event type

**Webhook level precedence:** User-level webhooks take priority over client-level, which take priority over campaign-level. If a user-level webhook is registered, it exclusively receives all events — campaign-level webhooks will NOT fire.

**Implication:** For our headless integration, register a single user-level webhook to capture all events globally. Do not mix levels.

Source: https://helpcenter.smartlead.ai/en/articles/417-how-to-resolve-webhook-failures

### Reply ingestion latency
[OPERATOR-REPORT] Replies may be delayed **up to 2 hours** before the webhook fires, especially for Outlook-connected mailboxes. This is due to Smartlead's polling interval for reading new emails from connected mailboxes (Gmail API / IMAP polling, not push).

**Implication:** Our `classifyReply` pipeline should not assume real-time reply notification. FUB push SLAs should be measured from webhook receipt, not from actual reply time. Do not surface "instant" FUB push as a user-facing guarantee.

Source: https://helpcenter.smartlead.ai/en/articles/417-how-to-resolve-webhook-failures (community context surfaced in search)

---

## 5. Rate Limits

### Per-API-key limits (not per-mailbox)
All rate limiting is enforced on the **API key** level across all endpoints combined, not per endpoint or per mailbox.

| Tier | Requests/minute | Requests/hour | Burst |
|---|---|---|---|
| Standard (Base plan) | 60 | 1,000 | 10 req/sec |
| Pro | 120 | 3,000 | 20 req/sec |
| Enterprise | Custom | Custom | Custom |

One source also mentioned "10 requests per 2 seconds" as a secondary constraint — [UNVERIFIED — may be an older limit or burst cap]. Treat this conservatively and design for ≤60 req/min on Pro.

Source: https://api.smartlead.ai/guides/rate-limits

### 429 response shape
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please retry after 30 seconds.",
    "retry_after": 30
  }
}
```

### Rate limit headers
Present on all responses:
- `X-RateLimit-Limit` — window max
- `X-RateLimit-Remaining` — remaining requests
- `X-RateLimit-Reset` — Unix timestamp for window reset
- `Retry-After` — seconds to wait (on 429 responses only)

### Retry strategy
Use `Retry-After` header value when present. Fall back to exponential backoff starting at 1 second (1, 2, 4, 8, 16 seconds). Our `SendProvider` client wrapper must implement this.

### Per-mailbox dispatch limits
Smartlead enforces its own per-mailbox daily cap based on each account's `max_email_per_day` setting. This is a Smartlead-internal queue control, not an API rate limit. Our CRM's `claimSendSlot` job enforces the additional daily ceiling we set; Smartlead will also refuse to queue beyond its own cap. There is no documented 429 for per-mailbox cap — Smartlead simply stops dispatching from that mailbox for the day.

Source: https://api.smartlead.ai/guides/rate-limits

---

## 6. Reply Ingestion

### How it works (confirmed)
Replies land in the **real Google Workspace mailbox** (not intercepted by Smartlead at the SMTP layer). Smartlead polls connected mailboxes via Gmail API (for OAuth-connected accounts) or IMAP (for SMTP-connected accounts) and fires the `EMAIL_REPLIED` webhook when it detects a new reply thread.

This is the correct architecture: real mailbox + Smartlead polling = Gmail conversational signal preserved, no Resend inbound-parse exposure.

Source: https://api.smartlead.ai/reference/email-reply-webhooks

### Reply polling latency
[OPERATOR-REPORT] Up to **2 hours** for Outlook, faster for Gmail (typically <15 minutes in operator reports). Exact polling interval is not documented.

**[UNVERIFIED — confirm polling interval with Smartlead support or by timing a sandbox reply]**

### Threading headers in webhook payload
[UNVERIFIED] `In-Reply-To` and `References` SMTP headers are **not present** in the documented webhook payload. The payload includes `reply.message_id` (the reply's own message ID) but not the original sent message's `Message-ID`. If our FUB push needs to correlate the reply to the specific sequence step that triggered the conversation, we must do this via `campaign_id` + `lead_id` + `sequence_number` matching in our local `sends` table.

---

## 7. Stats / Reconciliation API

### Campaign-level statistics (confirmed endpoints)
```
GET https://server.smartlead.ai/api/v1/campaigns/{campaign_id}/statistics
GET https://server.smartlead.ai/api/v1/campaigns/{campaign_id}/analytics
GET https://server.smartlead.ai/api/v1/campaigns/{campaign_id}/analytics-by-date?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
GET https://server.smartlead.ai/api/v1/analytics/overview
```

Fields returned (campaign level): `open_count`, `unique_open_count`, `unique_sent_count`, `click_count`, `unique_click_count`, `reply_count`, `bounce_count`, `unsubscribed_count`, `sequence_count`, `total_count`, `campaign_lead_stats` (interested, notStarted, inprogress, completed, blocked, paused, unsubscribed_count, stopped).

Date range: max 30-day span per query.

### Per-mailbox / per-email-account breakdown
[PARTIALLY VERIFIED] The SmartDelivery API suite provides a sender account report:

```
GET https://smartdelivery.smartlead.ai/api/v1/spam-test/report/{spamTestId}/sender-account-wise
```

Response includes per-mailbox: `avg_bounce_rate`, `avg_inbox_rate`, `avg_spam_rate`, `reputation_score`, `last_test_date`.

**However:** This endpoint is tied to a specific `spamTestId` (a scheduled placement test), not a date range query over actual send activity. For general per-mailbox sent/bounce/replied counts by date, **no dedicated endpoint was confirmed**.

For our daily reconcile job, the best available approach is:
1. Query `GET /campaigns/{id}/analytics-by-date` for each active campaign with yesterday's date range.
2. Cross-reference our local `sends` table counts against returned `unique_sent_count` and `bounce_count`.
3. Flag discrepancies for manual review.

**[UNVERIFIED — contact Smartlead support about a per-mailbox/per-date stats endpoint before Phase 1. The `warmup-stats` endpoint may return 7-day rolling metrics that include campaign sends.]**

Source:
- https://api.smartlead.ai/api-reference/smart-delivery/sender-report
- https://helpcenter.smartlead.ai/en/articles/122-how-to-replicate-the-ui-campaign-analytics-using-the-api

### Lead-level statistics
```
GET https://server.smartlead.ai/api/v1/campaigns/{campaign_id}/leads-statistics?api_key=...&limit=100&offset=0&event_time_gt=YYYY-MM-DD
```
Returns per-lead event data. The `event_time_gt` filter enables incremental reconcile (only leads with events since a given date).

Source: https://api.smartlead.ai/reference/lead-statistics

---

## 8. Pricing (as of May 2026)

### Current plans (official pricing page)

| Plan | Monthly | Annual (≈17% off) | Active leads | Monthly emails | Verified emails |
|---|---|---|---|---|---|
| Base | $39 | $32.50 | 2,000 | 6,000 | 2,000 |
| **Pro** | **$94** | **$78.30** | **30,000** | **90,000** | **30,000** |
| Unlimited Smart | $174 | $144.50 | Unlimited | 150,000 | 50,000 |
| Unlimited Prime | $379 | $314.60 | Unlimited | 500,000 | 170,000 |

Source: https://www.smartlead.ai/pricing

### Mailbox limits
[CONFIRMED] **Unlimited mailboxes on all plans.** "No. All Smartlead plans include unlimited email accounts at no extra cost." This is a key architectural advantage — we can add as many Mailforge burner mailboxes as needed without per-mailbox fees.

### Feature gating
- **API access + webhooks:** Gated to **Pro plan and above** — NOT available on Base ($39) plan.
- **Custom CRM integration:** Pro and above.
- **Global block list:** Pro and above.
- **Private infrastructure, dedicated manager, private Slack, 3+ client workspaces:** Unlimited Prime only.

**For our build, Pro ($78.30/mo annual) is the minimum viable tier.** All required features (API, webhooks, stats, custom scheduling) are available on Pro.

Source: https://www.smartlead.ai/pricing, https://www.octavehq.com/post/smartlead-api-guide-build-custom-workflows

### Tier-gating of specific features
[CONFIRMED] No tier-gating of webhook events, stats API endpoints, or custom-header capability was found within Pro vs higher plans. SmartDelivery sender report may require contacting support for access regardless of plan.

---

## 9. Gotchas

### G1 — No transactional send endpoint (architectural)
Smartlead is a **campaign engine, not a message-dispatch API**. There is no `POST /send` endpoint. Every email must go through the campaign > sequence > leads > activate flow. Our `SendProvider` interface must encapsulate this entire flow, not a single send call. For one-off reply forwarding or transactional messages, use Resend (as already planned — `notify.lazerlending.com`).

### G2 — Batch lead upload silent partial failures
[OPERATOR-REPORT] `POST /campaigns/{id}/leads` returns HTTP 200 even when some leads in the batch fail validation (e.g., malformed email addresses). Failed leads are silently dropped. Always validate with ZeroBounce before upload and implement response parsing to check for partial failure indicators in the response body.

Source: https://www.octavehq.com/post/smartlead-api-guide-build-custom-workflows

### G3 — Variable substitution fails silently
Template variables like `{{first_name}}` that have no value for a given lead produce blank substitutions without error or warning. Implement pre-upload variable completeness checks.

### G4 — Webhook level precedence overrides lower scopes
A user-level webhook silently suppresses all client-level and campaign-level webhooks. Register at user level only and never mix levels. If webhooks stop firing, check whether a competing webhook at a different level was registered.

Source: https://helpcenter.smartlead.ai/en/articles/417-how-to-resolve-webhook-failures

### G5 — Webhook auto-disable after retry exhaustion
After 3–5 failed delivery attempts (conflicting sources), Smartlead **disables the webhook**. This means a CRM deployment outage lasting more than ~7 hours could result in the webhook being silently disabled. Implement Smartlead webhook health monitoring (check via API or alert on gap in webhook traffic) and a re-registration mechanism.

Source: https://api.smartlead.ai/core/webhooks

### G6 — Reply latency up to 2 hours (especially Outlook)
Do not build any real-time SLA around reply-to-FUB latency. The polling lag is inherent to Smartlead's architecture. Outlook mailboxes are notably slower than Gmail.

### G7 — OAuth reconnection requires UI
For Gmail and Outlook mailboxes connected via OAuth, **token refresh failures require re-authentication via the Smartlead UI**. The `EMAIL_ACCOUNT_DISCONNECTED` webhook fires with error `"SMTP Failure"` or OAuth-related message. Our monitoring job must treat this event as a P1 alert — sends from that mailbox silently stop until reconnected.

Mitigation: Use SMTP/IMAP app passwords for Mailforge-provisioned Google Workspace mailboxes instead of OAuth, so reconnection can be scripted without UI access.

### G8 — Daily cap reset timing
[UNVERIFIED] The exact UTC time at which Smartlead resets its per-mailbox daily sent counter is not documented. Our own daily-cap reset uses mailbox-local TZ (default `America/Phoenix` per plan D12) but Smartlead's internal reset may differ. Over-counting or under-counting near midnight is possible. **Verify via sandbox observation.**

### G9 — Pro plan monthly email cap (90,000/month)
At 300 emails/day × 30 days = 9,000/month — well within Pro's 90,000 cap. At 1,000/day × 30 = 30,000 — still within cap. The limit becomes a constraint only at ~3,000/day sustained. Monitor `unique_sent_count` on the analytics endpoint to track consumption.

### G10 — Google Nov 2025 / Outlook Q1 2025 sender requirements
[CONFIRMED] Google has been enforcing one-click unsubscribe (RFC 8058) for bulk senders (>5,000/day to Gmail) since Feb 2024, with continued enforcement ramp into Nov 2025. Smartlead's auto-injected unsubscribe header tag is designed to satisfy this.

**Action items:**
- Verify the Smartlead-generated header is proper `List-Unsubscribe: <https://...>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (inspect raw MIME in Phase 0.6 sandbox test).
- Lazer's volume (100–300/day) is below the 5,000/day Gmail threshold for mandatory one-click unsubscribe, but implementing it from day one is best practice and required for Outlook compliance.
- DMARC `p=none` for first 4–6 weeks per plan D7 is unaffected by Smartlead's API behavior.

Source: https://support.google.com/a/answer/14229414

### G11 — `send_as_plain_text` setting disables unsubscribe link
Enabling "Optimize Email Delivery" (plain-text mode) in Smartlead campaign settings removes HTML content including the unsubscribe link. Do not enable this setting when RFC 8058 compliance is required. Plain-text campaigns should include unsubscribe instructions in the body text itself.

Source: https://helpcenter.smartlead.ai/en/articles/27-how-does-unsubscribing-work-in-smartlead-manage-unsubscribed-leads-effectively

---

## Summary Table — Items Requiring Sandbox Verification (Phase 0.6)

| ID | Question | Risk if wrong |
|---|---|---|
| S1 | Is the auto-injected `List-Unsubscribe` header RFC 8058 compliant (HTTPS URI + `List-Unsubscribe-Post`)? | RFC non-compliance, Google filtering |
| S2 | Can a custom unsubscribe URL be configured per-campaign? | Suppression-list logic must rely on webhook instead |
| S3 | Exact per-mailbox daily sent count API field | Our `claimSendSlot` cap enforcement |
| S4 | Exact retry count — 3 or 5 retries? | Webhook dead-letter window sizing |
| S5 | HMAC signing: body-only or body+timestamp? | Signature verification code |
| S6 | `EMAIL_UNSUBSCRIBED` vs `LEAD_UNSUBSCRIBED` — exact event name(s) | Webhook routing logic |
| S7 | Daily cap reset UTC time in Smartlead | Midnight double-send risk |
| S8 | Threading headers (`In-Reply-To`, `References`) in `EMAIL_REPLIED` payload | Reply-to-send correlation |
| S9 | Reply webhook latency for Gmail mailboxes (confirm <15 min) | FUB push latency expectations |
| S10 | Per-mailbox date-range stats endpoint existence | Daily reconcile job design |
| S11 | OAuth Gmail mailbox — API-initiated connection possible? | Headless onboarding flow |

---

## Source URLs

| Source | URL |
|---|---|
| Smartlead API intro (llms.txt) | https://api.smartlead.ai/llms.txt |
| Authentication reference | https://api.smartlead.ai/reference/authentication |
| Core: campaigns | https://api.smartlead.ai/core/campaigns |
| Core: email accounts | https://api.smartlead.ai/core/email-accounts |
| Core: webhooks | https://api.smartlead.ai/core/webhooks |
| Guide: webhook integration | https://api.smartlead.ai/guides/webhook-integration |
| Guide: rate limits | https://api.smartlead.ai/guides/rate-limits |
| Guide: email warmup | https://api.smartlead.ai/guides/email-warmup |
| Email reply webhooks reference | https://api.smartlead.ai/reference/email-reply-webhooks |
| Lead statistics reference | https://api.smartlead.ai/reference/lead-statistics |
| SmartDelivery sender report | https://api.smartlead.ai/api-reference/smart-delivery/sender-report |
| SmartDelivery mailbox count | https://api.smartlead.ai/api-reference/smart-delivery/mailbox-count |
| Helpcenter: full API docs | https://helpcenter.smartlead.ai/en/articles/125-full-api-documentation |
| Helpcenter: webhook guide | https://helpcenter.smartlead.ai/en/articles/35-webhook-guide |
| Helpcenter: sample webhook payloads | https://helpcenter.smartlead.ai/en/articles/403-quick-tips-for-testing-with-sample-webhook-payloads |
| Helpcenter: resolve webhook failures | https://helpcenter.smartlead.ai/en/articles/417-how-to-resolve-webhook-failures |
| Helpcenter: unsubscribe handling | https://helpcenter.smartlead.ai/en/articles/27-how-does-unsubscribing-work-in-smartlead-manage-unsubscribed-leads-effectively |
| Helpcenter: client-level API keys | https://helpcenter.smartlead.ai/en/articles/430-how-client-level-api-keys-work-in-smartlead |
| Helpcenter: email account disconnect payload | https://helpcenter.smartlead.ai/en/articles/88-emailsocial-platform-disconnect-payload |
| Helpcenter: replicate UI analytics | https://helpcenter.smartlead.ai/en/articles/122-how-to-replicate-the-ui-campaign-analytics-using-the-api |
| Smartlead pricing page | https://www.smartlead.ai/pricing |
| Operator guide (Octave HQ) | https://www.octavehq.com/post/smartlead-api-guide-build-custom-workflows |
| Google sender guidelines FAQ | https://support.google.com/a/answer/14229414 |
