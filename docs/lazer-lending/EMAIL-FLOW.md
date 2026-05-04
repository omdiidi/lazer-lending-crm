# How Email Works — Lazer Lending CRM

**Date:** 2026-05-02
**Audience:** anyone who needs to understand the email layer without reading the full PLAN.md
**Reading time:** ~10 minutes

This doc explains **how a cold email actually moves through the system** — from the operator clicking Launch to a recipient hitting Reply, all the way to a qualified lead landing in Follow Up Boss. No decisions or pricing here; for those see `BRIEF-email-architecture.md` and `CHARGE-ABILITY.md`. For pseudocode see `PLAN.md` §Implementation Blueprint.

---

## The problem in one paragraph

Lazer is a residential mortgage broker doing **cold outreach** as their primary lead channel. In 2026 you cannot just send 100 cold emails a day from `lazerlending.com` through a transactional ESP without burning the brand domain, getting the ESP account suspended for AUP violations, or hitting Gmail's automated rejection (5,000+/day senders need DMARC alignment, RFC 8058 unsubscribe, and complaint rate <0.3% or messages get bounced at the SMTP layer, not just spam-foldered). The system has to send cold mail from disposable infrastructure, classify replies fast, and protect the brand domain forever — without becoming an email-infrastructure company itself.

---

## The solution at a glance

Four vendors do specialized jobs. The CRM orchestrates them.

```
┌──────────────────────────────────────────────────────────┐
│                  Lazer Lending CRM                       │
│  (this codebase: React/Vite + Supabase + edge functions) │
└────┬──────────────────┬───────────────────────────┬──────┘
     │                  │                           │
     │ COLD outbound    │ TRANSACTIONAL outbound    │ Lead validation
     ▼                  ▼                           ▼
 ┌───────────┐    ┌──────────┐                ┌────────────┐
 │ Smartlead │    │  Resend  │                │ ZeroBounce │
 │    Pro    │    │          │                │            │
 └─────┬─────┘    └────┬─────┘                └────────────┘
       │ via OAuth     │ from notify.lazerlending.com
       ▼               ▼
 ┌─────────────┐   (internal alerts only)
 │  Burner-    │
 │  domain     │
 │  Workspace  │
 │  mailboxes  │
 │             │
 │ provisioned │
 │ via         │
 │ Mailforge   │
 └──────┬──────┘
        │
        ▼ real cold sends (lazer-loans.com, etc.)
   [ Recipient inbox ]
        │
        ▼ reply lands back in real Workspace mailbox
 ┌─────────────┐
 │  Smartlead  │
 │   webhook   │
 └──────┬──────┘
        │
        ▼ POST to /api/webhooks/smartlead
 ┌─────────────────────────────────────────────────┐
 │  CRM: classify → forward → push to FUB if +     │
 └─────────────────────────────────────────────────┘
```

**Read this twice.** Every other section in this doc maps to one piece of this diagram.

---

## Sending: the full path

What happens when an operator clicks **Launch** on a 100-email campaign:

```
1. Operator clicks Launch
        │
        ▼
2. CRM enqueues sends (one row per recipient in `sends` table, status='queued')
        │
        ▼
3. Cron-triggered dispatcher runs every minute (Supabase pg_cron → background worker)
        │
        ▼
4. For each queued send:
   a. Atomic claim of a mailbox slot from the campaign's sending pool
      (FOR UPDATE SKIP LOCKED + check today's count < daily_cap)
   b. Inside the same transaction: check suppression list (CAN-SPAM)
   c. JIT ZeroBounce re-validation if lead not validated in last 60 days
   d. Mark slot as 'reserved' (two-phase pattern; rollback on Smartlead error)
        │
        ▼
5. POST to Smartlead API:
   {
     "mailbox_id": "<warmed Workspace mailbox>",
     "to": "<recipient>",
     "subject": "...",
     "body": "<MIME with List-Unsubscribe headers + per-state footer>",
     "campaign_id": "<smartlead campaign id>"
   }
        │
        ▼
6. Smartlead enqueues internally, sends from the real Workspace mailbox
   via OAuth (NOT via SMTP/API relay — this is critical for deliverability)
        │
        ▼
7. Recipient receives email from sam@lazer-loans.com
   (a burner domain, NOT lazerlending.com)
        │
        ▼
8. Smartlead fires webhook 'email_sent' to /api/webhooks/smartlead
   - Receiver verifies signature
   - INSERT into webhook_events (idempotency key: provider + external_event_id)
   - Returns 200 OK in <200ms
   - Async worker picks up the row → updates `sends.status='sent'`
   - Marks slot as 'confirmed' (two-phase commit complete)
```

**Why this shape?**

- **Two-phase slot claim** prevents a Smartlead 5xx error from leaking the daily-cap slot. The reaper job releases stale reservations after 5 minutes.
- **Pacing is owned by Smartlead, not by the CRM.** The CRM enforces only the per-mailbox daily ceiling (default 20/day, range 15–25). Smartlead spreads sends across business hours per its internal pacing rules — that's what we pay it to do.
- **Real Workspace mailboxes via OAuth, not SMTP relay.** Gmail and Outlook treat ESP-relayed mail as bulk marketing infrastructure. Mail sent through Smartlead-managed real mailboxes inherits the engagement signature of a human inbox: opens, replies, IMAP behavior, OAuth-signed origin. This is the single biggest deliverability lever in 2026.

---

## Receiving (replies): the full path

What happens when a recipient hits Reply:

```
1. Recipient replies to sam@lazer-loans.com
        │
        ▼
2. Reply lands in the REAL Workspace mailbox (not in Smartlead's infra)
   This is critical — it preserves Gmail's "real human inbox" engagement signal,
   which feeds back into deliverability for future sends.
        │
        ▼
3. Smartlead polls the mailbox via its OAuth/IMAP integration
   (or via Gmail Push notifications, depending on Smartlead setup)
        │
        ▼
4. Smartlead fires 'reply' webhook to /api/webhooks/smartlead
        │
        ▼
5. Webhook receiver (sync path, returns 200 OK fast):
   - Verify HMAC signature
   - INSERT row into webhook_events
   - Return 200 to Smartlead
   - (LLM classification does NOT happen here — would be too slow)
        │
        ▼
6. Async worker (separate background process — NOT Edge Function due to ~150s limit):
   - Persist reply body to `replies` table
   - PII redaction (regex strip SSN, card numbers, phone, etc.)
   - Regex pre-filter: if reply contains "stop", "remove", "unsubscribe",
     "do not contact", "cease" → force classification = 'unsubscribe',
     skip LLM (CAN-SPAM safety backstop)
   - Otherwise call Anthropic Claude with redacted body:
     classify into {positive, neutral, OOO, unsubscribe, negative}
     with confidence + rationale
   - On classifier timeout/error: classification = null,
     requires_human_review = true (NEVER auto-FUB on classifier failure)
        │
        ▼
7. Apply classification:
   - 'unsubscribe' → INSERT into suppressions table (forever)
                  → cancel all queued future-step sends to this lead
   - any reply (even 'negative') → cancel future-step sends in this campaign
     (stop-on-reply applies to ALL replies at v1; safer than over-classifying)
        │
        ▼
8. Routing:
   - Forward the original reply to the campaign's configured team email
     (default: IMAP redirect from the originating Workspace mailbox;
      fallback: Resend forward if IMAP infeasible)
        │
        ▼
9. FUB push (only if classification == 'positive'):
   - Lookup FUB person by email_normalized
     (Gmail-only dot-collapse + plus-tag strip + lowercase)
   - If found: update tags only (no duplicate person)
   - If not found: create person at configured pipeline + stage
   - Audit-log the push with correlation_id linking back to the reply
```

**Why this shape?**

- **Sync webhook + async worker.** Smartlead retries on slow webhook responses (typical timeout 10–30s). LLM classification can take 5+ seconds. If we did everything synchronously, retries would fire, idempotency would short-circuit, and we'd risk double-processing. The split keeps the receiver under 200ms.
- **Regex pre-filter before LLM.** "Stop calling" and "remove me" are unambiguous opt-outs. At ~88–92% LLM classifier accuracy, ~10% of true unsubscribes would otherwise get re-mailed by step 2 of the campaign. Each missed opt-out is a $53,088 CAN-SPAM violation. Cheap to prevent.
- **Stop-on-reply on ALL replies at v1.** If the classifier mis-classifies a positive as low-confidence-negative and the lead keeps getting hammered by step 2/3/4, they flag as spam → mailbox dies. Optimization can come later when we have operating data.
- **Email normalization is Gmail-only for dot-collapse.** Gmail treats `john.doe@gmail.com` and `johndoe@gmail.com` as the same mailbox. Outlook, Yahoo, Proton, and most other providers do not. Applying dot-collapse globally would over-merge distinct recipients.

---

## Why burner domains (the key design choice)

This is the single most important architectural decision. Read carefully.

**The naive plan:** rotate sending across subdomains of `lazerlending.com` — `mail.lazerlending.com`, `send.lazerlending.com`, etc.

**Why that fails:** Gmail and Outlook compute reputation primarily at the **organizational domain** level (the registrable root). Cold-outreach abuse signals on `mail.lazerlending.com` leak into the brand root reputation. One bad campaign can take 3–6+ months to recover and damages Lazer's actual business mail in the meantime.

**What we do instead:** send from 2–4 brand-affiliated **burner domains** like `lazer-loans.com`, `getlazerloans.com`, `team-lazer.com`. Each burner is its own organizational-domain reputation universe. If a burner gets too many complaints, retire it and replace with a new one — domain registration is ~$10/year. The brand `lazerlending.com` literally never sends a cold email; it remains Lazer's clean business domain forever.

**The PRD's "torched root detection" emergency** becomes routine inventory rotation under this design. There is no torched-root scenario because the brand root never sends cold mail.

---

## Why each vendor

| Vendor | Job | Why this one |
|---|---|---|
| **Smartlead Pro** | Cold sending engine, mailbox warmup, webhook delivery | Most mature webhook coverage in the cold-email tier ($94/mo). AUP silent on lending vertical (most transactional ESPs explicitly ban cold). Saleshandy is the cheaper alternative but its reply-webhook docs are ambiguous; Instantly explicitly gates lending behind custom-account approval. |
| **Mailforge** | Bulk Google Workspace mailbox + DNS provisioning | $3/mailbox/month vs $7 retail Workspace. Pre-configures SPF/DKIM/DMARC. Gray-area reseller risk is mitigated by hot-standby mailboxes from a second provider. |
| **Resend** | Transactional mail only, on `notify.lazerlending.com` | Best-in-class for transactional. Sends operator alerts (mailbox paused, complaint review needed, daily digest) from a brand-aligned subdomain that NEVER carries cold mail. AUP-clean for this use. |
| **ZeroBounce** | Email validation at upload + just-in-time before send | Industry standard validator. Catches invalid, disposable, catch-all-fail, and spam-trap addresses before they tank deliverability. |
| **Anthropic Claude** | LLM-based reply classifier | Has a no-train DPA (data privacy addendum) for the prospect-reply data flow. PII is regex-redacted before the API call regardless. |
| **Follow Up Boss** | Downstream CRM for warm leads | Lazer's primary CRM (this whole system feeds it). Only positive replies push, deduped by `email_normalized`. |

---

## Why NOT Resend for cold (the rejection)

The original PRD said "all sends through Resend." This was rejected before any code shipped. Reasons:

1. **AUP risk at scale.** Resend's acceptable-use policy is the most cold-tolerant of the major transactional ESPs but still requires <0.08% complaint rate and <4% bounce rate. Lending vertical at 1,000/day is a manual-review trigger.
2. **Filter penalty at Gmail.** Gmail explicitly weights "real mailbox + IMAP behavior + OAuth signature" higher than ESP-relayed mail. Sending cold through Resend underperforms sending the same content through a real Workspace mailbox via Smartlead.
3. **No real mailboxes for warmup or replies.** Cold ESPs send from infrastructure pools, not from inboxes. There's no inbox for a recipient to reply into and no engagement signature for warmup to build.

Resend stays in the architecture — for **transactional only**, on a brand-aligned subdomain (`notify.lazerlending.com`). One tool, one job.

---

## Compliance touch points (built into every send)

Three things every cold send carries — non-negotiable in 2026:

1. **RFC 8058 List-Unsubscribe headers** — both `<https://...>` and `<mailto:...>` URI variants plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Gmail's Nov 2025 enforcement rejects messages that lack this at the SMTP layer, not the spam folder. The unsubscribe URL embeds an HMAC token over `(lead_id, campaign_id, mailbox_id, expiry_unix)` keyed with `LIST_UNSUB_TOKEN_SECRET`. Verification uses `crypto.timingSafeEqual` and supports a previous-secret fallback for rotation.
2. **DMARC alignment** — every burner domain ships with `v=DMARC1; p=none; rua=mailto:dmarc@<aggregator>;`. After 4–6 weeks of clean aggregate reports, the ramp evaluator nominates the domain for `p=quarantine`.
3. **Per-state compliance footer** — assembled dynamically based on `lead.address_state`. Includes: NMLS company ID + individual MLO NMLS ID + state-specific license disclosure (e.g., NY: "Registered Mortgage Broker — NYS DFS"; TX: 12-point font NMLS ID; CA: DRE/DFPI license number) + Equal Housing Opportunity statement + physical address + opt-out URL. See `COMPLIANCE.md` for the full per-state matrix.

---

## Failure recovery (the safety nets)

Three independent backstops protect against the system going wrong:

1. **Per-mailbox watchdog (hourly)** — Wilson lower-bound on bounce + complaint rates over rolling 24h. Pauses the mailbox automatically. Plus a **hard rule** (independent of rate): any single spam complaint sends the mailbox to manual review immediately. This is the primary signal at v1 volume — the rate-based path is statistically dormant until ~400 sends/24h per mailbox.
2. **Hot-standby mailboxes** — 5 pre-warmed mailboxes from a second provider (Litemail/EmailAstra/Infraforge) at $25–85/mo. If Mailforge fails or gets deplatformed (Google's Oct 2025 crackdown specifically targeted cold-email reseller tenants), recovery time drops from 7–10 weeks (cold provisioning + warmup) to 24–72 hours (OAuth standby into Smartlead).
3. **Daily reconcile job** — pulls Smartlead per-mailbox stats once a day and corrects local `sends` rows that drifted from vendor truth (covers webhook drops, late deliveries, async timing skew).

---

## What's already in the codebase vs what changes

The Connect CRM scaffold already has parts of this pipeline. Lazer extends/replaces specific pieces.

| File | Today (Connect CRM) | Lazer change |
|---|---|---|
| `supabase/functions/send-email/index.ts` | Uses Resend, hard-coded `integrateapi.ai` | Swap Resend client for Smartlead client; route through sending pool |
| `supabase/functions/email-events/index.ts` | Resend webhook receiver (svix-signed) | Add Smartlead webhook handler at `/api/webhooks/smartlead`; keep Resend handler for transactional events |
| `supabase/functions/_shared/warmup.ts` | Naive "days since first email → daily cap" tiers | **Remove** — Smartlead's bundled warmup network replaces this entirely (real engagement, not just count tiers) |
| `supabase/functions/process-campaigns/index.ts` | Cron-driven campaign processor, sends via `mail.integrateapi.ai` | Keep cron shape; replace direct Resend call with sending-pool dispatcher (atomic claim → Smartlead POST) |
| `supabase/migrations/` | 8 migrations, no Lazer-specific tables yet | Add: `domains`, `mailboxes`, `sending_pools`, `pool_memberships`, `webhook_events`, `replies`, `suppressions`, `mailbox_slot_reservations`, `ccpa_requests` |
| `src/lib/api/send-email.ts`, `emails.ts` | Direct Resend invocation | Change to enqueue via dispatcher; reads webhook events from new `webhook_events` table |
| `src/types/database.ts` | Auto-generated; current Connect CRM schema | Regenerate after Lazer migrations land |

For the full implementation plan see `PLAN.md` Phase 1 Tasks 1.0–1.17. For per-task DoDs, dependencies, and Phase 0.3 vendor-verification gates see the same.

---

## What this doc isn't

- Not a vendor pricing comparison — see `BRIEF-email-architecture.md` and `CHARGE-ABILITY.md`.
- Not a compliance bible — see `COMPLIANCE.md` for federal + state-by-state.
- Not a runbook — see `OPS-RUNBOOK.md` for what to do when something breaks.
- Not a contract — see `PRD-AMENDMENT.md` for the architecture-substitution Lazer must sign.
- Not implementation pseudocode — see `PLAN.md` §Implementation Blueprint > Key Pseudocode for the actual algorithms.

This doc exists to make the **shape** of the email layer obvious in 10 minutes. Once you have the shape, the other docs fill in the details.
