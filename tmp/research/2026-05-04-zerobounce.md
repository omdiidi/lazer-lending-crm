# ZeroBounce Email Validation API — Research Summary

**Date:** 2026-05-04
**Scope:** Integration for Lazer Lending CRM — bulk upload validation + JIT re-validation before send.
**Existing partial integration:** `supabase/functions/apollo-search/index.ts` lines 327–353 (single-email, query-param auth, only checks `status === 'invalid'`, non-fatal on failure).

---

## 1. API Authentication

**Method:** Query parameter — `api_key=<key>` appended to every request URL.
**No HTTP header form is documented.** All official examples use query string.

**Endpoint base variants:**
- Default: `https://api.zerobounce.net/v2/`
- USA region: `https://api-us.zerobounce.net/v2/`
- EU region: `https://api-eu.zerobounce.net/v2/`
- Bulk file API: `https://bulkapi.zerobounce.net/v2/`

**Key management:** Up to 5 API keys per account, all scoped to the account (not per-key permissions). Found in the account dashboard under "API."

**Sources:**
- https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-validate-emails
- https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-batch-validate-emails

---

## 2. Single-Email Validation (Synchronous)

### Endpoint

```
GET https://api.zerobounce.net/v2/validate
    ?api_key={key}
    &email={email}
    [&ip_address={signup_ip}]
    [&timeout={3–60}]
    [&activity_data=true]
    [&verify_plus=true]
```

HTTP method: GET. SSL required.

### Request Parameters

| Parameter | Required | Notes |
|---|---|---|
| `api_key` | Yes | Query param |
| `email` | Yes | URL-encode before appending |
| `ip_address` | No | Signup IP for geolocation fields |
| `timeout` | No | Seconds 3–60; default ~30; greylisted domains return `unknown/greylisted` if threshold reached |
| `activity_data` | No | `true` appends `active_in_days` to response |
| `verify_plus` | No | Overrides account-level Verify+ setting for this call |

### Response Shape (all fields)

```json
{
  "address":        "valid@example.com",
  "status":         "valid",
  "sub_status":     "alias_address",
  "account":        "valid",
  "domain":         "example.com",
  "did_you_mean":   null,
  "domain_age_days": "9692",
  "active_in_days": "180",
  "free_email":     false,
  "mx_found":       "true",
  "mx_record":      "mx.example.com",
  "smtp_provider":  "google",
  "firstname":      "John",
  "lastname":       "Doe",
  "gender":         "male",
  "city":           "New York",
  "region":         "New York",
  "zipcode":        "10001",
  "country":        "United States",
  "processed_at":   "2026-05-04 10:30:00.000"
}
```

**Field notes:**
- `status`: top-level verdict — `valid`, `invalid`, `catch-all`, `unknown`, `spamtrap`, `abuse`, `do_not_mail`
- `sub_status`: granular reason (see Section 4)
- `account`: local-part of the email address
- `domain`: domain portion
- `did_you_mean`: suggested correction if `possible_typo` detected (e.g., `"gmial.com"` → `"gmail.com"`)
- `free_email`: boolean — true for Gmail, Yahoo, Outlook, etc.
- `mx_found`: string `"true"` or `"false"` — not a JSON boolean
- `smtp_provider`: detected mail provider (e.g., `"google"`, `"microsoft"`)
- `domain_age_days`: age of domain in days (string)
- `active_in_days`: populated only when `activity_data=true` — values: `"30"`, `"60"`, `"90"`, `"180"`, `"365"`, `"365+"`, or `null`

**Credit behavior:** No credit consumed for `unknown` results.

### Latency

- Documented: "between one second and 30 seconds"
- Practical: 96–98% of domains respond within 1–5 seconds; major ISPs (Gmail, Outlook, Yahoo) typically 1–3 seconds
- Slow path: greylisted or anti-spam-blocked domains can take up to the configured `timeout`
- p50 estimate: ~1–2s (UNVERIFIED — ZeroBounce does not publish percentile latency)
- p99 estimate: up to 30s (UNVERIFIED)

**Source:** https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-validate-emails

---

## 3. Bulk Validation (Asynchronous — File Management API)

Two distinct bulk options:

### Option A: Real-Time Batch (up to ~200 emails, synchronous)

```
POST https://api.zerobounce.net/v2/validatebatch
Content-Type: application/json

{
  "api_key": "...",
  "email_batch": [
    { "email_address": "a@example.com", "ip_address": "1.2.3.4" },
    { "email_address": "b@example.com" }
  ],
  "timeout": 30,
  "activity_data": true
}
```

- Response time up to 70 seconds
- Rate limit: 30 requests/minute on `bulkapi.zerobounce.net/v2/validatebatch`; exceeding triggers 10-minute block
- **Recommended for lists ≤200 addresses** per ZeroBounce guidance

### Option B: File Upload (asynchronous, any size)

#### Step 1 — Upload

```
POST https://bulkapi.zerobounce.net/v2/sendfile
Content-Type: multipart/form-data

api_key=...
file=<CSV or TXT file, header: text/csv>
email_address_column=1          (1-based column index)
has_header_row=true
remove_duplicate=true           (default: true)
allow_phase_2=false             (enables catch-all SMTP probing when >=10 catch-alls detected)
return_url=https://...          (optional webhook callback — POSTed on completion)
first_name_column=2             (optional)
last_name_column=3              (optional)
gender_column=4                 (optional)
ip_address_column=5             (optional)
```

**File limits:** ZeroBounce states "no restriction on file size, number of emails, or number of files" as long as sufficient credits exist. In practice, the upload must succeed as a single HTTP multipart upload.

**On success:**
```json
{ "success": true, "message": "File Accepted", "file_name": "...", "file_id": "uuid" }
```

#### Step 2 — Poll for completion

```
GET https://bulkapi.zerobounce.net/v2/filestatus
    ?api_key={key}&file_id={file_id}
```

Response:
```json
{
  "success": true,
  "file_id": "uuid",
  "file_name": "...",
  "upload_date": "2026-05-04T10:00:00Z",
  "file_status": "Complete",
  "file_phase_2_status": "Complete",
  "complete_percentage": "100%",
  "return_url": "https://..."
}
```

`file_status` progression: `Queued` → `Processing` → `CatchAllProcessing` (if Phase 2 enabled) → `Complete`

**Polling vs webhook:** Both supported. If `return_url` provided, ZeroBounce POSTs `{ file_id, file_name, upload_date }` to your endpoint when complete. Otherwise, poll `filestatus` — no documented minimum interval, but polling every 30s is reasonable for large files.

**Processing speed:** ~45–60 minutes per 100,000 contacts (from ZeroBounce docs/FAQ).

#### Step 3 — Download

```
GET https://bulkapi.zerobounce.net/v2/getfile
    ?api_key={key}&file_id={file_id}
```

Returns the processed CSV with appended result columns. Column headers match the input plus: `ZB Status`, `ZB Sub Status`, `ZB Account`, `ZB Domain`, `ZB First Name`, `ZB Last Name`, `ZB Gender`, `ZB Free Email`, `ZB MX Found`, `ZB MX Record`, `ZB SMTP Provider`, `ZB Did You Mean`.

#### Step 4 — Delete (optional cleanup)

```
DELETE https://bulkapi.zerobounce.net/v2/deletefile
    ?api_key={key}&file_id={file_id}
```

**Result retention:** Duration not specified in documentation. [UNVERIFIED — contact ZeroBounce support for exact retention window.] Files are accessible until explicitly deleted or the account expires.

**Credits per row:** 1 credit per email processed. Duplicate removal (`remove_duplicate=true`) means duplicates are dropped before credit consumption. `unknown` results are not charged.

**Greylisting handling:** When a greylisted response (SMTP 421) is detected, ZeroBounce pauses that file up to 35 minutes, waits 20 minutes, then retries those specific addresses. This inflates total processing time but reduces the `unknown` rate.

**Sources:**
- https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-file-management-api
- https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-batch-validate-emails
- https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-send-file
- https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-file-status
- https://www.zerobounce.net/docs/frequently-asked-questions/potential-issues/why-is-my-file-taking-so-long-to-process

---

## 4. Sub-Statuses — Complete Reference + Dispatcher Policy

**Source:** https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-status-codes

### Top-Level: `valid`
"Safe to email — bounce rates under 2% for these addresses."

| Sub-status | Meaning | Dispatcher policy |
|---|---|---|
| *(no sub-status)* | Clean, standard valid address | **Allow — send** |
| `alias_address` | Forwarder/alias that redirects to real inbox | **Allow — send** (treat as valid) |
| `leading_period_removed` | Gmail address starting with `.`, auto-corrected (e.g. `.john@gmail.com` → `john@gmail.com`) | **Allow — send normalized address** |
| `alternate` | Secondary address with numbers/special characters; lower engagement expected | **Allow with warning** — lower priority in send queue; deprioritize in sequence step ordering |
| `gold` | High-engagement contact (consistent opens, clicks) | **Allow — send, prioritize** |
| `role_based_accept_all` | Role-based email on ZeroBounce's vetted accept-all domain list (historically delivers) | **Allow — send** |
| `accept_all` | On ZeroBounce's vetted accept-all list | **Allow — send** |

### Top-Level: `invalid`
"Unsuitable for mailing."

| Sub-status | Meaning | Dispatcher policy |
|---|---|---|
| `mailbox_not_found` | Syntactically valid but mailbox does not exist | **Drop** — insert into suppressions |
| `failed_syntax_check` | RFC syntax violation | **Drop** — insert into suppressions |
| `possible_typo` | Commonly misspelled domain (check `did_you_mean` field) | **Manual review** — surface `did_you_mean` in UI for human correction before drop |
| `does_not_accept_mail` | Domain is send-only (no inbound MX) | **Drop** — insert into suppressions |
| `no_dns_entries` | No or incomplete DNS records | **Drop** — insert into suppressions |
| `mailbox_quota_exceeded` | Temporarily over storage limit | **Allow with warning** — retry once after 48h; drop if still invalid |
| `unroutable_ip_address` | Domain's MX points to unroutable IP | **Drop** — insert into suppressions |

### Top-Level: `catch-all`
"Impossible to validate without sending a real email — server accepts all addresses regardless of validity."

| Sub-status | Meaning | Dispatcher policy |
|---|---|---|
| *(no sub-status)* | Domain accepts everything; unknown if mailbox actually exists | **Allow with warning** — flag as `catch_all` in leads table; accept at low volume in v1; do NOT bulk-send catch-alls as first priority. Monitor bounce rate on catch-all cohort separately. If bounce rate >5% for this domain cohort, suppress domain. |
| `role_based_catch_all` | Role-based email (e.g. info@) on a catch-all domain — worst of both worlds | **Drop** (covered under `do_not_mail` in some API versions; treat as drop regardless) |

Note: ZeroBounce offers `allow_phase_2=true` on bulk uploads to SMTP-probe catch-alls more aggressively. At v1 volume (100–300/day), enabling Phase 2 is recommended for the upload flow but adds processing time.

### Top-Level: `spamtrap`
"Believed to be spam trap addresses — avoid to protect sender reputation."

| Sub-status | Meaning | Dispatcher policy |
|---|---|---|
| *(no sub-status)* | Known or probable spam trap | **Hard drop — insert into suppressions immediately** — hitting a spam trap is a severe deliverability event |
| `possible_trap` | Contains spam-trap-related keywords | **Drop** — insert into suppressions |

### Top-Level: `abuse`
"Known complainers — people who click the spam/bulk/report button."

| Sub-status | Meaning | Dispatcher policy |
|---|---|---|
| *(no sub-status)* | Known spam complainer | **Hard drop — insert into suppressions** — these addresses will inflate your complaint rate |

### Top-Level: `do_not_mail`
"Valid-syntax addresses that should not receive mail due to risk factors."

| Sub-status | Meaning | Dispatcher policy |
|---|---|---|
| `role_based` | Group/role emails (sales@, info@, support@) — high spam-complaint correlation | **Drop** for cold outreach. Role-based addresses are inappropriate for personalized cold email and elevate complaint risk. |
| `disposable` | Temporary addresses — will become invalid | **Drop** — insert into suppressions |
| `toxic` | Known for abuse and spam; bot-created or abusive | **Hard drop — insert into suppressions** |
| `global_suppression` | On popular suppression lists (ISP complainers, litigators, unsubscribers) | **Hard drop — insert into suppressions** — these may include litigators who sue senders |
| `possible_trap` | Spam-trap keyword detected | **Drop** — insert into suppressions |
| `mx_forward` | Domain forwards MX to another provider; similar behavior to disposable domains | **Drop** |
| `role_based_catch_all` | Role-based email on catch-all domain | **Drop** |

### Top-Level: `unknown`
"Unable to validate — server offline, anti-spam, timeout, etc."

| Sub-status | Meaning | Dispatcher policy |
|---|---|---|
| `greylisted` | Server issued temporary rejection (SMTP 421/451) — often succeeds on retry | **Retry** after 24–48h using JIT re-validation; do NOT suppress; do NOT send until resolved |
| `antispam_system` | Anti-spam firewall blocked ZeroBounce's probes — email may be valid | **Allow with warning** — schedule JIT re-validation; accept for sending if no other negative signals; flag in leads table |
| `failed_smtp_connection` | Server refused SMTP connection | **Allow with warning** — same treatment as `antispam_system` |
| `forcible_disconnect` | Server disconnects immediately | **Allow with warning** — schedule JIT re-validation |
| `mail_server_did_not_respond` | Server unresponsive | **Allow with warning** — schedule JIT re-validation |
| `mail_server_temporary_error` | Server returning temp errors | **Allow with warning** — schedule JIT re-validation |
| `timeout_exceeded` | Slow server exceeded timeout | **Allow with warning** — increase `timeout` parameter on retry |
| `exception_occurred` | Internal ZeroBounce error during validation | **Retry immediately** — not a signal about the email |

**Key nuance for `unknown`:** ZeroBounce explicitly does NOT charge credits for `unknown` results. The status is ambiguous — it does NOT mean the email is definitively bad. The most common cause is corporate email servers that block external SMTP probes for security (finance, healthcare, legal). These are often valid emails. For cold outreach to mortgage leads (US residential), this cohort warrants JIT re-validation attempts before suppression, not immediate drops.

---

## 5. Activity Data API

**Endpoint:**
```
GET https://api.zerobounce.net/v2/activity
    ?api_key={key}
    &email={email}
```

Regional variants: `api-us.zerobounce.net`, `api-eu.zerobounce.net`

**Authentication:** Query parameter `api_key`, same as validate endpoint.

**What it returns:** Whether the email inbox has been active (opened, clicked, forwarded, or unsubscribed from an email) in the past:
- 30 days
- 60 days
- 90 days
- 180 days
- 365 days
- 365+ days (or null — no activity on record)

The `active_in_days` field in the validate response (when `activity_data=true`) returns the same window value as a string (e.g., `"180"`).

**Alternative access:** Add `activity_data=true` to any `/v2/validate` or `/v2/validatebatch` call — this appends `active_in_days` to those responses without a separate API call.

**AI Scoring (separate feature):** ZeroBounce offers a distinct "A.I. Scoring API" that returns a 0–10 engagement score per email, factoring in verification status, activity data, domain reputation. This costs 1 credit per email scored (same as validation). It is a separate API call from validation.

**Pricing for Activity Data API:** [UNVERIFIED from official docs] — Search results indicate Activity Data is bundled with ZeroBounce ONE subscription, and the A.I. Scoring API costs 1 credit per email scored. Whether the standalone activity endpoint consumes a credit is not explicitly documented on the public docs page. Recommend confirming with ZeroBounce support.

**Subscription requirement:** Activity Data features are noted as available with ZeroBounce ONE subscription (as of research date). May not be available on pure pay-as-you-go accounts.

**Use case for Lazer Lending:** Prioritize sequences for contacts with `active_in_days` of 30 or 60 — these are the most engaged inboxes and most likely to produce deliverable, opened mail. Contacts with `active_in_days` of 365+ should be lowest priority or excluded at v1.

**Sources:**
- https://www.zerobounce.net/docs/activity-data-api/
- https://www.zerobounce.net/services/activity-data

---

## 6. Caching / Re-Validation Policy

### ZeroBounce's own guidance

ZeroBounce recommends validating your email list **once per quarter** (approximately 90 days). They cite an email decay rate of **~22–23% per year** — meaning roughly 1.9% of your list goes bad per month.

**Source:** https://www.zerobounce.net/docs/email-list-validation/the-zb-guarantee and search results citing ZeroBounce FAQ.

### Our PRD policy (60 days)

The Lazer Lending PRD specifies JIT re-validation for any contact unverified for >60 days before send. This is **more conservative than ZeroBounce's own 90-day recommendation**, which is a sensible choice for cold outreach (higher reputation stakes than newsletter sending).

**Mathematical basis:** At 23%/year decay, 60 days = ~3.8% decay expected — comfortably within the 5% "stale" threshold before deliverability risk grows meaningfully.

**ZeroBounce guarantee:** They offer an accuracy guarantee — if a `valid` result bounces within their guarantee window, they may refund the credit. This window is not publicly specified in detail; see https://www.zerobounce.net/docs/email-list-validation/the-zb-guarantee.

### Practical implementation note

Store `zb_validated_at` (timestamp) and `zb_status` on the `leads` table. Before the dispatcher calls `claimSendSlot`, check: if `NOW() - zb_validated_at > INTERVAL '60 days'`, call ZeroBounce single-email validate, update the row, then proceed. This is the JIT re-validation path. The 60-day cadence is tighter than ZeroBounce's recommendation, which protects against the portion of email churn that happens in the 60–90 day window.

---

## 7. Rate Limits

### Single-email API (`/v2/validate`)
- **80,000 validations per 10 seconds** across all three regional endpoints combined
- Exceeding limit triggers a **1-minute temporary block** on your key
- 200 bad API key requests per hour triggers a **1-hour block**

### Batch API (`/v2/validatebatch`)
- **30 requests per minute** on the bulk API endpoint
- Exceeding triggers **10-minute block**

### Bulk file API (`/v2/sendfile`, `/v2/filestatus`, `/v2/getfile`)
- No documented per-minute rate limit on the file management endpoints
- Concurrency: [UNVERIFIED — no explicit simultaneous upload limit documented]

### Existing integration context

The current `apollo-search/index.ts` validates 5 emails in parallel at a time using `Promise.all` batches of 5. This is well within rate limits (80,000/10s = 8,000/s). No changes needed to the concurrency model for JIT re-validation.

**Source:** https://www.zerobounce.net/docs/api-dashboard/api-rate-limits

---

## 8. Pricing — Current as of May 2026

### Pay-As-You-Go

Credits never expire. Minimum purchase: 2,000 credits.

| Credits purchased | Price per credit | Total cost |
|---|---|---|
| 2,000 | $0.0195 | $39.00 |
| 5,000 | $0.0138 | ~$69 |
| 10,000 | $0.0129 | $129.00 |
| 100,000 | $0.00649 | $649.00 |
| 250,000 | $0.005196 | ~$1,299 |
| 500,000 | $0.004398 | ~$2,199 |
| 1,000,000 | $0.003199 | ~$3,199 |
| 1,000,000+ | Custom/enterprise | Contact sales |

Note: Third-party pricing aggregator (usebouncer.com) cites $20 for 2,000 while ZeroBounce FAQ cites $39 for 2,000 — likely a tier change or sourcing discrepancy. Use the ZeroBounce pricing page as authoritative: https://www.zerobounce.net/email-validation-pricing.

### Subscription: ZeroBounce ONE

- **Monthly:** $99/mo for 10,000 validation credits + 10K Email Finder searches + 100 inbox placement tests + 100 email server tests + 250 warmup seeds + 10 blacklist monitors + 1 DMARC-monitored domain
- **Annual:** $79/mo (billed annually)
- Subscribers receive a **15% discount** on additional credit purchases

### Cost modeling for Lazer Lending

**Upload validation (one-time per lead):**
- Scenario: 5,000 leads uploaded → 5,000 credits at $0.0138/credit = **~$69**
- Scenario: 10,000 leads → 10,000 credits at $0.0129 = **$129**

**JIT re-validation (60-day cadence):**
- At 100 sends/day, assume 20% of the active pipeline (100–300 leads) hits 60-day expiry on any given day = ~20–60 JIT checks/day
- 60 checks/day × 30 days = 1,800 credits/month → at $0.0195 = **~$35/mo** at lowest tier
- At 300 sends/day with a larger pipeline, 3,600 credits/month → **~$47–70/mo**
- Buying 10,000 credits at $0.0129 for $129 covers ~1.5–3 months of JIT re-validation at these volumes

**Recommended purchasing strategy:** Buy 10,000 credit blocks at $0.0129/credit. Credits don't expire, so this is safe. At v1 volume (100–300/day), one 10,000-credit block lasts several months even with re-validation. Total ZeroBounce budget: **$5–15/month at steady state v1** (aligning with the $5–15 line in the project's cost floor estimate).

**Sources:**
- https://www.zerobounce.net/email-validation-pricing
- https://www.zerobounce.net/docs/frequently-asked-questions/billing-and-payments/how-is-pricing-determined-for-email-verification
- https://www.usebouncer.com/zerobounce-pricing/

---

## 9. Failure Modes

### `unknown` — is it definitively bad?

No. `unknown` is explicitly ambiguous. ZeroBounce does NOT charge credits for unknowns precisely because the result is indeterminate. Common causes:
- Corporate servers that block external SMTP probes (common in finance, legal, healthcare)
- Temporary server issues (mail_server_temporary_error, timeout_exceeded)
- Greylisting (retry succeeds in 20–35 min)

**Dispatcher guidance:** Do not suppress `unknown` addresses immediately. The correct handling by sub-status:
- `greylisted` → retry ZeroBounce after 24–48h before deciding
- `antispam_system`, `failed_smtp_connection`, `forcible_disconnect`, `mail_server_did_not_respond`, `mail_server_temporary_error`, `timeout_exceeded` → allow send with warning flag; monitor bounce rate on this cohort post-send; if bounce rate on `unknown`-flagged sends exceeds 3%, tighten to suppress
- `exception_occurred` → retry immediately (internal ZeroBounce error, not a signal about the email)

### Greylisting / soft-fail handling

Greylisting is a deliberate SMTP technique (RFC 6647) where a mail server issues a temporary rejection (421/451) to all first-time senders, expecting legitimate senders to retry. ZeroBounce handles this automatically in the bulk file flow — it pauses validation for the greylisted address for 20 minutes and retries, adding up to 35 minutes to total processing time.

For JIT single-email validation: if you get `status=unknown, sub_status=greylisted`, schedule a re-check in 24–48 hours. Do not send, do not suppress.

### ZeroBounce API downtime

ZeroBounce's SLA is not publicly documented. The existing `apollo-search/index.ts` correctly treats ZeroBounce failure as non-fatal for Apollo enrichment — this is the right pattern. For the upload validation flow, build in a circuit-breaker: if ZeroBounce is unreachable after 3 retries with exponential backoff, mark the batch as `zb_status=pending_validation`, refuse to allow sends to that cohort until validated, and alert the operator. Do not allow unvalidated addresses into the send queue.

### `mailbox_quota_exceeded`

Classified as `invalid` but is actually a temporary condition (full mailbox). The dispatcher should retry JIT re-validation after 48h rather than permanently suppressing. If still `mailbox_quota_exceeded` after second attempt, suppress.

---

## Existing Integration Gap Analysis

File: `supabase/functions/apollo-search/index.ts`

**Current behavior (lines 327–353):**
- Single-email validate via GET query-param — correct
- Only checks `status === 'invalid'` and marks `email_status = 'invalid'` — incomplete
- Does not check `sub_status` at all — misses spamtrap, abuse, do_not_mail, toxic
- Does not use `activity_data=true` — misses engagement signal
- ZEROBOUNCE_API_KEY absence silently skips validation — acceptable for Apollo enrichment flow but not for upload or send flows
- Non-fatal error handling — correct for Apollo enrichment; NOT acceptable for upload validation

**Required extensions:**
1. **Upload-time validation:** New Supabase Edge Function `validate-upload` that accepts a CSV, calls bulk file API (upload → poll/webhook → download), maps all sub-statuses to dispatcher policies, inserts valid leads and suppressions in one transaction.
2. **JIT re-validation:** In `claimSendSlot` (dispatcher), before claiming a slot for a lead, check `zb_validated_at`. If `> 60 days` ago, call single-email validate, update lead row, then apply dispatcher policy. If ZeroBounce times out, use cached status as fallback (do not block the send for timeout).
3. **Sub-status mapping:** Replace the current `status === 'invalid'` check with a full policy table covering all top-level statuses and all relevant sub-statuses as documented in Section 4.
4. **Suppression inserts:** Any `invalid`, `spamtrap`, `abuse`, `do_not_mail` (most sub-statuses) result must insert into the `suppressions` table in the same transaction — not just mark `email_status`.
5. **Activity data:** Add `activity_data=true` to single-email calls for JIT re-validation; store `active_in_days` on the lead; use it to sort/prioritize within send queues.

---

## Gaps / Unverified Items

- **Result file retention period:** Not documented. [UNVERIFIED] — contact ZeroBounce support.
- **Activity Data API credit cost:** Not confirmed whether the `/v2/activity` standalone endpoint consumes a credit separately from validation. Likely bundled with ONE subscription. [UNVERIFIED]
- **Exact p50/p99 latency:** ZeroBounce does not publish percentile latencies publicly. The 1–30s range is the official statement.
- **Simultaneous file upload concurrency limit:** Not documented.
- **ZeroBounce SLA / uptime guarantee:** Not publicly documented.
- **`gold` sub-status availability:** Documented in status codes reference but not confirmed available at all subscription tiers vs. ZeroBounce ONE only.
- **Pricing discrepancy:** $20 vs $39 for 2,000 credits across sources — treat $39 as current authoritative until confirmed on zerobounce.net directly.

---

## Version Information

- ZeroBounce API version: **v2** (v1 deprecated)
- Documentation accessed: 2026-05-04
- ZeroBounce pricing sourced from: zerobounce.net/email-validation-pricing (accessed 2026-05-04 via third-party aggregator — confirm directly)

---

## Sources

- https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-validate-emails
- https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-batch-validate-emails
- https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-file-management-api
- https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-send-file (redirects from file-management-api send section)
- https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-file-status
- https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-status-codes
- https://www.zerobounce.net/docs/activity-data-api/
- https://www.zerobounce.net/services/activity-data
- https://www.zerobounce.net/email-validation-pricing
- https://www.zerobounce.net/docs/frequently-asked-questions/billing-and-payments/how-is-pricing-determined-for-email-verification
- https://www.zerobounce.net/docs/api-dashboard/api-rate-limits
- https://www.zerobounce.net/docs/email-list-validation/the-zb-guarantee
- https://www.zerobounce.net/anti-greylisting
- https://www.zerobounce.net/docs/email-list-validation/greylisting-technologies
- https://www.zerobounce.net/docs/email-list-validation/status_codes
- https://www.zerobounce.net/docs/frequently-asked-questions/potential-issues/why-is-my-file-taking-so-long-to-process
- https://www.usebouncer.com/zerobounce-pricing/
- https://mailmend.io/blogs/zerobounce-pricing
