# Follow Up Boss API Research

**Date:** 2026-05-04
**Researcher:** Claude (technical research agent)
**Purpose:** Lazer Lending CRM — FUB push layer for qualified warm leads (Phase 2 Task 2.5–2.7)
**Confidence:** High on core behavior; medium on pricing tier detail (FUB does not publish API access restrictions on their pricing page)

---

## 1. Authentication

### API Key (Primary Method for Server-to-Server)

Every FUB user has a unique API key. Location: Admin → API in the FUB admin panel.

**Critical caveat:** The key is shown exactly once at creation time. Copy it immediately — FUB will not display it again.

Authentication uses HTTP Basic Auth over HTTPS:
- Username: `<api_key>`
- Password: leave blank (or any value if your HTTP client requires one)
- Wire format: `Authorization: Basic <base64(api_key:)>`

**Account role scoping:**
- Owner/Admin API key: full account access
- Agent API key: scoped to assigned contacts and collaborators only
- Lender API key: even more restricted than Agent

For the Lazer Lending push integration, use an **Owner or Admin API key** to ensure the push succeeds regardless of agent assignment at creation time.

### OAuth 2.0

FUB supports Authorization Code Grant Flow for integration partners. Use `Bearer <access_token>` header after token exchange. Short-lived access tokens with refresh support. Redirect to `https://app.followupboss.com/oauth/authorize`, exchange code at `https://app.followupboss.com/oauth/token`.

**Recommendation for Lazer:** Use API key (Basic Auth), not OAuth. OAuth is for multi-tenant integrations where you act on behalf of different FUB accounts. For a single-account server-to-server push, API key is simpler and FUB's own docs recommend it for this pattern.

### X-System and X-System-Key Headers

Every request must also include two additional headers that identify the integration:
- `X-System`: a human-readable name for your system (e.g., `lazer-lending-crm`)
- `X-System-Key`: a secret key issued to your registered system

These are required on top of the API key. Without a valid `X-System-Key`, rate limits drop to half (125 global vs 250 global per 10-second window). You register a system by contacting FUB — this is a one-time setup step.

**Sources:**
- https://docs.followupboss.com/reference/authentication
- https://docs.followupboss.com/docs/oauth-authentication-and-authorization
- https://docs.followupboss.com/docs/start-here-brand-new-integration

### Sandbox / Test Environment

No dedicated sandbox API endpoint exists. FUB provides a **free 14-day trial account** at `https://app.followupboss.com/signup` for development. You can request an extension from FUB support for ongoing dev/QA access. Use this trial account as your test target during Phase 2 development.

**Source:** https://docs.followupboss.com/docs/start-here-brand-new-integration

---

## 2. Person Model

### Do Not Use POST /v1/people to Push New Leads

FUB's own Lead Provider Integration Guide states explicitly:

> "Do not use /people endpoint to send new leads into Follow Up Boss, as it won't trigger automations in FUB, can cause duplicates and other adverse effects."

Use **POST /v1/events** instead. This is how all lead ingestion should work. The /people endpoint is for direct record CRUD (updates to existing, lookups), not for initial lead creation.

**Source:** https://docs.followupboss.com/docs/lead-provider-integration-guide

### Email Field Structure

Emails are an **array of objects**, not a string. Each object:
```json
{
  "type": "work",   // or "personal", "other"
  "value": "borrower@example.com"
}
```
The first email in the array becomes the primary email. Multiple emails per person are supported.

**Source:** https://docs.followupboss.com/reference/people-post

### Available Fields on a Person

| Field | Type | Notes |
|---|---|---|
| `firstName` | string | Primary identifier |
| `lastName` | string | Primary identifier |
| `emails` | array of `{type, value}` | First = primary |
| `phones` | array of `{type, value}` | First = primary |
| `addresses` | array | Address objects |
| `stage` | string | Defaults to "Lead" on create |
| `source` | string | Lead source label |
| `sourceUrl` | string | Link back to origin system |
| `tags` | array of strings | See §5 |
| `assignedTo` | string | Username of assigned agent |
| `assignedUserId` | int | ID of assigned agent |
| `assignedPondId` | int | ID of assigned pond |
| `assignedLenderId` | int | ID of assigned lender |
| `collaborators` | array of user IDs | |
| `background` | string | Free-text background note |
| `contacted` | boolean | |
| `price` | int | |
| `customXxx` | any | Custom field, prefixed `custom` + field name |

**Source:** https://docs.followupboss.com/reference/people-post

### Email Normalization

FUB does not document server-side email normalization (lowercase, plus-tag stripping) in any public-facing API doc. The safe assumption is: **we must normalize before pushing**. Our CRM already stores `email_normalized` (lowercase, plus-tag stripped per plan). Pass `email_normalized` as the `value` in the emails array when pushing to FUB.

---

## 3. Dedup Behavior on POST

### Via POST /v1/events (Recommended)

The events endpoint **automatically deduplicates** on phone or email match:
- Match found → updates existing person, returns `200`
- No match → creates new person, returns `201`
- `204` → lead flow archived/ignored (no body returned)
- `404` → a person ID was supplied but not found

Response status 200 vs 201 is how you detect whether a new record was created. This is the correct dedup surface — no need to pre-check.

**Source:** https://docs.followupboss.com/reference/events-post

### Via POST /v1/people (Not Recommended for Lead Push)

By default, `/people` creates duplicates with no dedup. Optional query param `?deduplicate=true` enables dedup: returns existing person with `200` if match found, otherwise creates with `201`.

Since we use `/v1/events` for all lead pushes, this is moot. The `?deduplicate=true` param on `/v1/people` is only relevant if you ever need to do a direct upsert outside the events flow.

### Lookup by Email (for Pre-Check or Reconciliation)

```
GET /v1/people?email=borrower%40example.com
```
URL-encode the `@` symbol. Returns matching person(s) or empty array. Use this for reconciliation jobs, not as a pre-push check (the events endpoint handles dedup automatically).

**Source:** https://docs.followupboss.com/reference/searching

### Recommended Push Pattern for Lazer Lending

```
POST /v1/events
  Body: { source, type, person: {firstName, lastName, emails, phones, tags}, message }

  HTTP 201 → new lead created → store FUB person ID in our DB
  HTTP 200 → existing lead updated → log event ID, update our DB record
  HTTP 204 → FUB ignored/archived the lead flow → log and alert
  HTTP 4xx → handle per §7
```

No GET pre-check needed before push. The events endpoint is the atomic dedup+create operation.

---

## 4. Pipelines and Stages

### Listing Stages

```
GET /v1/stages
```
Parameters: `limit` (default 10, max 100), `offset`, `sort` (orderWeight | id | name)

Separate `/v1/pipelines` endpoint exists for pipeline-level listing. Stages belong to pipelines; each stage has a `pipelineId` field.

**Source:** https://docs.followupboss.com/reference/stages-get

### Setting Stage on a New Person

Pass `stage` as a string (stage name, not ID) on the person object within the event payload. Default if omitted is "Lead".

For the events-based push, pass the stage name directly:
```json
{
  "person": {
    "stage": "Lead"
  }
}
```

### Per-Campaign Pipeline Override

Yes — since `stage` is a free field on the person object and the events payload includes `source`, you can route different campaigns to different stages or pipelines by varying the `stage` value on push. Example: a "refinance inquiry" campaign pushes to stage "Refi Prospect" while a "purchase inquiry" campaign pushes to "Buyer Prospect". Confirm actual stage names against the client's FUB account (use `GET /v1/stages` during onboarding).

**Source:** https://docs.followupboss.com/reference/stages-get, https://docs.followupboss.com/reference/people-post

---

## 5. Tags

### Tag Syntax on Create (via Events)

Tags are passed as an array of strings on the person object inside the event payload:
```json
{
  "person": {
    "tags": ["cold-reply", "cold-reply-refis-2026-q2", "lazer-crm"]
  }
}
```

Tags are created automatically if they don't already exist in FUB. No pre-registration required.

### Recommended Tagging Convention for Lazer

| Tag | Purpose |
|---|---|
| `cold-reply` | All pushes from our system |
| `cold-reply-{campaign_id or slug}` | Campaign provenance for FUB-side filtering |
| `classified-positive` | Classifier output stored in FUB |
| `lazer-crm` | Integration source identifier for easy filtering |

This lets FUB-side agents filter their pipeline by `cold-reply-{campaign}` to know the exact cold sequence that generated a lead.

**Source:** https://docs.followupboss.com/reference/people-post, https://docs.followupboss.com/docs/lead-provider-integration-guide

---

## 6. Notes and Activities

### Attaching a Note to a Person

```
POST /v1/notes
Body:
{
  "personId": 12345,           // required (int32)
  "subject": "Cold reply classified as Positive",  // optional
  "body": "...",               // optional, note content
  "isHtml": false              // optional, renders HTML in FUB UI if true
}
```

`personId` is the FUB person ID returned in the response from `POST /v1/events`.

### Note Rate Limit

The `/v1/notes` endpoint is rate-limited at **10 requests per 10-second window** (see §7). For a burst of 50 positive replies, space note creation over 50 seconds minimum, or batch-queue with jitter.

### What to Include in the Note (Lazer Lending Pattern)

Do NOT include raw reply body (PII). Include:
```
Subject: Cold reply — classified POSITIVE
Body:
  Campaign: {campaign_name}
  Mailbox: {mailbox_alias}@{burner_domain}
  Classified: POSITIVE (confidence: 0.91)
  First sentence (redacted): "{first_sentence_truncated}"
  View full reply: https://crm.lazerlending.com/replies/{reply_id}
  Classified by: Lazer CRM on {iso_timestamp}
```

This pattern preserves the audit trail without pushing PII into FUB.

**Source:** https://docs.followupboss.com/reference/notes-post

---

## 7. Rate Limits

### Rate Limit Window

Sliding **10-second window** (not per-minute or per-hour).

### Default Limits with Valid X-System-Key

| Context | Limit per 10s | Applies To |
|---|---|---|
| `POST.events` | Unlimited | POST /v1/events |
| `events` | 20 | GET /v1/events |
| `global` | 250 | All other endpoints |
| `PUT.people` | 25 | PUT /v1/people |
| `notes` | 10 | /v1/notes |

Without a valid `X-System-Key`, global drops to 125 and events GET to 10.

### 429 Behavior

Response: `429 Too Many Requests`
Header: `Retry-After: <seconds>`

The request is NOT processed on 429 — must be retried in full.

You may also receive a 429 even with remaining quota if FUB experiences momentary capacity reduction. Treat all 429s identically regardless of cause.

### Response Headers on Every Response

```
X-RateLimit-Limit: 250
X-RateLimit-Remaining: 249
X-RateLimit-Window: 10
X-RateLimit-Context: global
```

### Retry Strategy for 50-Positive-Reply Burst

At 50 pushes (events + notes each):
- Events POST: unlimited → fire all 50 immediately, no rate concern
- Notes POST: limit 10/10s → max 10 notes per 10s

**Implementation:** Events push can be immediate. Notes must be queued with a token-bucket or simple delay: post 10, wait 11s, post next 10, repeat. For a 50-note burst that means ~50s total. At current Lazer volumes (≤50 positive replies/day in v1), this is trivial — a sequential loop with 1.1s delay per note handles it comfortably.

Rate limit increases are available by emailing FUB support with use-case details.

**Source:** https://docs.followupboss.com/reference/rate-limiting

---

## 8. Webhooks Back from FUB

### Does FUB Notify Us When a Rep Updates a Person?

Yes. FUB supports outbound webhooks including `peopleUpdated`.

### Available Person-Related Webhook Events

| Event | Trigger |
|---|---|
| `peopleCreated` | New person record created |
| `peopleUpdated` | Fields changed: name, emails, phones, address, assigned agent/lender, stage, source, tags, custom fields |
| `peopleDeleted` | Person deleted |
| `peopleTagsCreated` | Tag added to person |
| `peopleStageUpdated` | Stage changed on person |
| `peopleRelationshipCreated` | Relationship added |
| `peopleRelationshipUpdated` | Relationship updated |
| `peopleRelationshipDeleted` | Relationship deleted |

### Webhook Payload Structure

```json
{
  "eventId": "unique-uuid",
  "eventCreated": "2026-05-04T15:00:00+00:00",
  "event": "peopleStageUpdated",
  "resourceIds": [12345],
  "uri": "https://api.followupboss.com/v1/people?id=12345",
  "data": { ... }
}
```

The `data` field contains event-specific context (e.g., old/new stage name for `peopleStageUpdated`).

### Webhook Configuration

Webhooks are configured **via API only** (not FUB admin UI). Only the account owner can create/update/delete webhooks. Max 2 webhooks per event type per system.

```
POST /v1/webhooks
Body: { "event": "peopleStageUpdated", "url": "https://crm.lazerlending.com/webhooks/fub" }
```

### Signature Verification

FUB includes a `FUB-Signature` header: SHA256 of the base64-encoded JSON payload, keyed with your `X-System-Key`. Verify on receipt to prevent spoofed events.

### Retry Behavior

Non-2XX response triggers retries at 1m, 5m, 5m, 10m, 30m intervals (5 retries total).

### Practical Use for Lazer

Subscribing to `peopleStageUpdated` lets us know when a Lazer rep moves a FUB contact from "Lead" → "Meeting Scheduled" or "Closed". This closes the feedback loop and could eventually feed classifier improvement data. Not needed for v1 but the plumbing cost is low if we register it during Phase 2 setup.

**Source:** https://docs.followupboss.com/reference/webhooks-guide

---

## 9. Pricing and API Access Tier

### Plan Pricing (as of May 2026)

| Plan | Monthly (billed monthly) | Monthly (billed annually) | Included Users |
|---|---|---|---|
| Grow | $69/user | $58/user | Per-seat |
| Pro | $499 | $416 | 10 users |
| Platform | $1,000 | $833 | 30 users |

### API Access by Tier

FUB's pricing page does not explicitly list API access as a per-tier feature — it advertises "250+ integrations" and "unlimited lead sources" across all plans.

Third-party analysis (Rollout, CloudTalk) suggests the Platform plan ($833/mo annual) is positioned as the tier that "adds API access," but this is not confirmed by FUB's own pricing page. At least one source indicates the API is openly available ("Follow Up Boss Open API") with no plan gate mentioned in official docs.

**Recommendation:** Confirm API access with Lazer's FUB account representative before Phase 2 build. If Lazer is on Grow or Pro, request API key generation in the Admin → API panel — if accessible, no upgrade needed. If blocked, upgrade to Platform is the path.

**Sources:**
- https://www.followupboss.com/pricing
- https://www.cloudtalk.io/blog/follow-up-boss-pricing/
- https://help.followupboss.com/hc/en-us/articles/7787906777751-Follow-Up-Boss-Open-API

---

## 10. Common Pitfalls and Quirks

### P1: Do Not Use /people for Lead Creation

The single biggest footgun. Using `POST /v1/people` bypasses FUB automations (action plans, agent assignment rules, notification triggers). Always use `POST /v1/events` for any new lead ingestion.

**Source:** https://docs.followupboss.com/docs/lead-provider-integration-guide

### P2: API Key Is Shown Once

If the key is not copied at creation time, it cannot be retrieved later — only regenerated. Regeneration invalidates the old key immediately, breaking any running integrations. Store the key in 1Password at generation time.

**Source:** https://docs.followupboss.com/docs/start-here-brand-new-integration

### P3: Missing X-System-Key Halves Rate Limits

Without `X-System-Key`, the global rate limit is 125 instead of 250 per 10s window. Register a system with FUB support before Phase 2 integration starts — this is a one-time step that unlocks full rate headroom and proper attribution in FUB's audit logs.

**Source:** https://docs.followupboss.com/reference/rate-limiting

### P4: Events > 1 Day Old Are Historical and Do Not Trigger Automations

If the `occurredAt` timestamp on the event payload is more than 24 hours in the past, FUB marks it as a historical event and action plans/automations do not fire. Always set `occurredAt` to the actual reply classification time (which is recent), not the original cold send time.

**Source:** https://docs.followupboss.com/reference/events-post

### P5: Custom Fields Require the API Field Name, Not Display Name

Custom fields on a person are accessed as `custom{FieldName}` where `FieldName` is the camelCase machine name returned by `GET /v1/customFields`, not the human-readable label shown in FUB's UI. A field labeled "Closing Date" in the UI might be `customClosingDate` or `customclosingdate` — always look it up programmatically. Hardcoding a display name that later gets renamed by a Lazer admin will silently fail to set the field.

**Source:** https://docs.followupboss.com/discuss/5d823667d2d26e00346aebb1

### P6: Webhook Limit — 2 Per Event Per System

FUB only allows 2 webhook registrations per event type per registered system. If you register a third, behavior is undefined (likely silent rejection or overwrite). Plan webhook registrations carefully in Phase 2.

**Source:** https://docs.followupboss.com/reference/webhooks-guide

### P7: 204 Response on Events = Silently Ignored

A `204` from `POST /v1/events` means FUB archived or ignored the lead flow (e.g., it matched a suppression rule or lead routing rule that routes to an archived flow). No person record was created or updated. Your integration must handle `204` explicitly — it is not a success. Log and alert so Lazer reps can investigate suppressed pushes.

**Source:** https://docs.followupboss.com/reference/events-post

### P8: Email Normalization Is Our Responsibility

FUB does not document server-side normalization of email addresses. Do not assume FUB deduplicates `User+Tag@Example.COM` against `user@example.com`. Our CRM must normalize before pushing: lowercase, strip plus-tags, trim whitespace. The `email_normalized` field in our DB is the authoritative key to use in the FUB payload.

### P9: Person Stage Default Is "Lead" Not Pipeline-Gated

Passing no `stage` field creates the person in the "Lead" stage, which may or may not be in Lazer's desired pipeline. Confirm the target stage and pipeline names against the client's live FUB account via `GET /v1/stages` during Phase 2 onboarding. Do not hardcode "Lead" without confirming it maps to the right pipeline.

**Source:** https://docs.followupboss.com/reference/stages-get

---

## Implementation Recommendations

### Recommended Push Flow (Phase 2)

```
1. Classify reply → POSITIVE
2. Redact PII from reply body (keep first sentence only, up to 100 chars)
3. Normalize email: lowercase + strip plus-tags → email_normalized
4. POST /v1/events with:
     source: "Lazer Lending CRM Cold Outreach"
     type: "General Inquiry"
     occurredAt: <classification_timestamp_ISO8601>
     person: {
       firstName, lastName,
       emails: [{ type: "work", value: email_normalized }],
       phones: [...],
       stage: "Lead",  // confirm stage name with client
       tags: ["cold-reply", "cold-reply-{campaign_slug}", "lazer-crm"]
     }
     message: "Positive cold outreach reply — {first_sentence_redacted}"
     uri: "https://crm.lazerlending.com/replies/{reply_id}"

5. HTTP 201 → store fub_person_id in our replies table
   HTTP 200 → existing person — update fub_person_id if null
   HTTP 204 → alert: lead suppressed by FUB routing rule
   HTTP 4xx/5xx → exponential backoff retry (see §7)

6. After event push succeeds, POST /v1/notes with:
     personId: fub_person_id
     subject: "Cold reply classified POSITIVE — Lazer CRM"
     body: <sanitized note per §6 pattern>

7. Store push result + fub_person_id in our DB for idempotency check
   — do NOT push the same reply_id twice (check fub_push_at IS NOT NULL)
```

### Idempotency for Our Push Queue

Our `replies` table should have a `fub_push_at` timestamp and `fub_person_id` column. Before pushing, check `fub_push_at IS NOT NULL` — if already pushed, skip. This prevents double-push on queue retries.

---

## Version Information

- FUB API version: v1 (only version available as of May 2026)
- Base URL: `https://api.followupboss.com/v1/`
- FUB pricing confirmed as of May 2026 (annual billing): Grow $58/user, Pro $416/10 users, Platform $833/30 users
- All documentation sourced from official FUB docs at `docs.followupboss.com` plus official help center at `help.followupboss.com`

---

## Gaps and Limitations

1. **API tier confirmation unresolved.** FUB does not publicly document which plan includes API access. Must confirm with Lazer's FUB account rep. Confidence: medium.

2. **Custom field machine names unknown.** We do not know which custom fields exist on Lazer's FUB account. Must run `GET /v1/customFields` against their account during Phase 2 onboarding.

3. **Stage and pipeline names unknown.** Must run `GET /v1/stages` and `GET /v1/pipelines` against Lazer's account to confirm the target stage name.

4. **X-System-Key not provisioned.** Must contact FUB support to register "lazer-lending-crm" as a system and obtain the system key. This is a blocking prerequisite for Phase 2 (without it, rate limits are halved).

5. **Sandbox is a trial account.** No isolated sandbox API — dev/QA work targets a trial FUB account. This means push tests create real records. Use a clearly labeled test contact (e.g., tag `test-do-not-contact`) and clean up after each QA run.

6. **Email normalization on FUB side is undocumented.** We assumed FUB does not normalize. If they do normalize server-side, our dedup will still work correctly (we pass a normalized email, they match on normalized email). There is no downside to normalizing on our side regardless.

---

## Sources

- https://docs.followupboss.com/reference/authentication
- https://docs.followupboss.com/docs/oauth-authentication-and-authorization
- https://docs.followupboss.com/docs/start-here-brand-new-integration
- https://docs.followupboss.com/reference/getting-started
- https://docs.followupboss.com/reference/people-post
- https://docs.followupboss.com/reference/events-post
- https://docs.followupboss.com/docs/lead-provider-integration-guide
- https://docs.followupboss.com/reference/searching
- https://docs.followupboss.com/reference/stages-get
- https://docs.followupboss.com/reference/notes-post
- https://docs.followupboss.com/reference/rate-limiting
- https://docs.followupboss.com/reference/webhooks-guide
- https://docs.followupboss.com/discuss/5d823667d2d26e00346aebb1 (custom fields discussion)
- https://help.followupboss.com/hc/en-us/articles/7787906777751-Follow-Up-Boss-Open-API
- https://www.followupboss.com/pricing
- https://www.cloudtalk.io/blog/follow-up-boss-pricing/
- https://rollout.com/integration-guides/follow-up-boss/api-essentials
