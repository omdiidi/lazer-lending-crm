# Blocked — Awaiting Lazer Client Input

> Single source of truth for every dependency on Lazer client input. Each item has: severity, current default/workaround, action-on-unblock, and code location of the override point.

This document is the canonical list of "what we cannot complete without Lazer-side input." It supersedes the Open Questions section in `PLAN.md` for the purpose of tracking ship-blockers; PLAN keeps the original numbering for plan continuity, but the authoritative status (HARD BLOCKER / DEFAULT-ABLE / POST-LAUNCH) lives here.

Cross-references:
- PRD §7 Open Questions (`docs/lazer-lending/PRD.md` line 263–298) — original four flagged unknowns
- `docs/lazer-lending/PLAN.md` § Open Questions (line 1646–1682) — the 13-item expansion
- `docs/lazer-lending/CONNECT-CRM-AUDIT-DELTA.md` — the new "which Supabase project?" question + 5 audit-surfaced opens
- `docs/lazer-lending/VENDOR-CONTRACTS.md` — vendor-side unblock checklists

## Severity legend

- **HARD BLOCKER** — code cannot ship live without client answer. Default not safe (regulatory, legal-ownership, account-existence, or correctness gates that no engineering choice can substitute).
- **DEFAULT-ABLE** — implemented with a documented assumption. Safe to ship as-is. Override after client confirms.
- **POST-LAUNCH** — needed for v2 or operational tuning, not v1 ship.

## Status snapshot (2026-05-04)

| Severity | Count | Items |
|---|---:|---|
| HARD BLOCKER | 8 | B1, B2, B3, B4, B9, B11, B12, B13 |
| DEFAULT-ABLE | 5 | B5, B6, B7, B8, B10 |
| POST-LAUNCH | 3 | B14, B15, B16 |

If Lazer accepts every default-able as-is, **8 HARD BLOCKERS still gate v1 live sends.** None can be defaulted away.

## Phase 0 prerequisites (before any code-on-prod-data run)

### B1 — Supabase project: separate or shared with IntegrateAPI? [HARD BLOCKER]

**Why:** Connect CRM is wired to Supabase project `onthjkzdgsfvmgyhrorw` (IntegrateAPI's). Lazer's leads, replies, and PII would mix with IntegrateAPI's customers in the same tables under shared RLS policies. This is a tenant-isolation failure for a regulated vertical (mortgage lending → CCPA, GLBA, state-level disclosures). No row-level `tenant_id` retrofit is acceptable here — the blast radius of a single buggy RLS policy or service-role leak crosses the customer boundary.

**Default:** New isolated Supabase project for Lazer. **NOT SAFE TO SHIP** with shared project.

**Action on unblock:**
1. Confirm with IntegrateAPI ops + Lazer security: separate project (recommended) or shared.
2. Provision new Supabase project (`lazer-lending-crm` or similar).
3. Run all existing migrations against new project (357 files in `supabase/migrations/`).
4. Update `.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
5. Update cron migration to point at new URL/key (currently hard-coded).
6. Re-deploy all 17 Edge Functions to new project (`supabase functions deploy --project-ref <new>`).

**Code locations:**
- `src/lib/supabase.ts:6-8` — client init reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- `supabase/migrations/20260326130000_schedule_process_campaigns_cron.sql:19-26` — hard-coded URL + anon key in cron HTTP call
- Every Edge Function: `Deno.env.get('SUPABASE_URL')` / `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` (set per-project at deploy)
- `mcp-server/src/client.ts` — MCP server connects via `SUPABASE_URL`

**Owner:** Lazer security + IntegrateAPI ops (joint).

### B2 — NMLS / state lending compliance footer text [HARD BLOCKER]

**Why:** Cold solicitation in residential mortgage lending requires per-state licensing disclosure (CA DFPI, NY DFS, TX OCCC at minimum). The footer is a legal artifact, not a UI string. Wrong or missing text is a regulatory violation under TILA, RESPA, state UDAP statutes, and individual licensing acts — not a UX bug. The CRM cannot send live campaigns with a placeholder footer.

**Default:** Placeholder string in template renders, but **NO LIVE SENDS** until Lazer compliance/legal supplies real text. Sandbox sends to internal seed inboxes are allowed with `[FOOTER PLACEHOLDER — NOT FOR PRODUCTION]` token.

**Action on unblock:**
1. Lazer compliance/legal supplies state-disclosure footer text per applicable license set, including:
   - NMLS unique identifier
   - Per-state licensing language for every state Lazer operates in
   - CAN-SPAM physical postal address
   - Equal Housing Lender / Equal Housing Opportunity statement (if applicable)
2. Insert into Settings → Compliance → Footer Template.
3. Add Settings-side guard: campaign cannot transition to `active` while footer template contains placeholder token.
4. Verify all live campaigns use the template before activation.

**Code location:**
- `lazer_settings.compliance_footer_template` field (new — Phase 1.16)
- Campaign builder injects at send time inside the Smartlead `body` payload
- Settings page: `src/pages/SettingsPage.tsx` (extend with Compliance tab)

**Owner:** Lazer compliance / legal counsel.

### B3 — Burner domain naming + legal ownership [HARD BLOCKER]

**Why:** Domains must (a) be Lazer-affiliated enough to read as legitimate to recipients (per user constraint: "I'm fine with [burner domains] as long as they're kind of related to his business"), (b) have clear legal ownership for liability and CAN-SPAM physical-address requirements, and (c) be registered to the entity whose name appears in the compliance footer. Mismatch between footer entity and WHOIS owner is a CAN-SPAM falsification flag.

**Default:** Plan suggested `lazer-loans.com`, `getlazerloans.com`, `team-lazer.com`, `trylazerlending.com` as candidate names. **Do not register until client confirms.** Any name typoed or close-enough to existing competitors creates legal exposure.

**Action on unblock:**
1. Lazer marketing/legal approves names (typically 2–4 burners for v1 at 100/day).
2. Confirm legal ownership: registered to **Lazer Lending entity, not IntegrateAPI**. WHOIS contact must match the compliance footer entity from B2.
3. Confirm trademark clearance for each name (USPTO TESS check, plus state registries).
4. Register through Zapmail if using their managed bundle, or external registrar (e.g., Cloudflare, Porkbun) if Lazer prefers in-house DNS control. See `VENDOR-CONTRACTS.md` §2 (pending).
5. Update plan's `domains` table seed list during Phase 1.3.

**Code location:**
- `domains` table — Phase 1 migration (does not exist yet)
- Domain-state-machine seed (`provisioning → dns_pending → oauth_pending → verifying → ready`)
- Per-domain WHOIS metadata captured in Settings → Domains panel

**Owner:** Lazer marketing + Lazer legal.

### B4 — Reply forwarding default email + per-campaign overrides [HARD BLOCKER for v1.SC4]

**Why:** Notifications about positive replies must reach the right Lazer team member. Without a real address, qualified replies go nowhere — v1.SC4 acceptance gate fails ("Reply lands → classified → forwarded per routing rule").

**Default:** Single placeholder email (`replies+placeholder@lazerlending.com`); per-campaign override field is implemented but unset. Sandbox testing allowed; **production activation gated**.

**Action on unblock:**
1. Lazer ops provides default forwarding address (e.g., `replies@lazerlending.com`).
2. Confirm whether per-campaign overrides are needed at v1 (refi vs purchase vs re-engagement queues).
3. If per-campaign: Lazer ops provides per-campaign addresses; configure `routing_rules` table.
4. If shared inbox + assignment downstream in FUB: confirm the FUB owner-id assignment logic (B11 dependency).

**Code location:**
- `lazer_settings.default_reply_forward_email` (env: `DEFAULT_REPLY_FORWARD_EMAIL`)
- `campaigns.routing_rule_id` FK
- `routing_rules` table (Phase 2.4)
- Forwarding logic: `supabase/functions/smartlead-events/index.ts` (new — Phase 2)

**Owner:** Lazer ops.

### B5 — Neutral-reply rule for FUB push [DEFAULT-ABLE]

**Why:** Neutral replies ("not interested right now," "send info next quarter," "remove me from this list but not your firm") could either auto-push to FUB as warm leads or wait for human triage. Either is defensible; the wrong choice for Lazer's process pollutes FUB.

**Default:** Neutral replies wait for human tag in CRM; never auto-push to FUB. Human applies `qualify` tag to trigger push, or explicit `unsubscribe` tag to suppress.

**Action on unblock:** Confirm or override. If override = "auto-push neutral," set `lazer_settings.neutral_auto_push = true` and update routing logic.

**Code location:**
- `replies/router.ts` neutral branch (Phase 2.2 in `supabase/functions/smartlead-events/`)
- `lazer_settings.neutral_auto_push` boolean
- UI: Replies inbox neutral filter

**Owner:** Lazer ops / sales lead.

### B6 — OOO rule [DEFAULT-ABLE]

**Why:** Out-of-office auto-replies are not real positive responses but contain useful intent (return date). Auto-pushing to FUB pollutes pipeline; ignoring entirely loses the snooze opportunity.

**Default:** OOO never pushes to FUB. If return-date is parseable from the body (regex + LLM extraction), auto-snooze the lead until that date plus 1 business day, then resume sequence. If not parseable, snooze 14 days.

**Action on unblock:** Confirm or override.

**Code location:**
- `replies/router.ts` OOO branch
- `lead.snoozed_until` column (extend `leads`)
- LLM classifier output schema includes `ooo_return_date: ISO8601 | null`

**Owner:** Lazer ops.

### B7 — DMARC ramp policy timeline [DEFAULT-ABLE]

**Why:** Google's Nov 2025 enforcement penalizes new senders without DMARC alignment. Going to `p=quarantine` too early on a fresh burner with mid-volume warmup risks legitimate-mail rejection; staying at `p=none` too long invites spoofing exploits and signals "amateur sender" to mailbox providers.

**Default:** Signal-based ramp — `p=none` until **14 consecutive days clean DKIM alignment** AND **≥500 sends per burner** AND **zero DMARC failures in the last 7 days of RUA reports**. Calendar fallback: force ramp to `p=quarantine` at 4 weeks if signal not yet hit (longer means warmup is broken). Final state `p=reject` deferred to v2 — premature `reject` on burners breaks recoverable mail.

**Action on unblock:** Confirm signal-based default, override to fixed-timeline (e.g., "always 4 weeks at `p=none`"), or override to operator-gated (manual transition button per domain).

**Code location:**
- `dmarc-ramp-evaluator` Edge Function (Phase 1.13 in PLAN — pending)
- `domains.dmarc_state` enum: `p_none | p_quarantine | p_reject`
- `domains.dmarc_signal_clean_since` timestamp
- DMARC RUA aggregator integration (`DMARC_RUA_PROVIDER` env)

**Owner:** Lazer ops (with deliverability consult from IntegrateAPI).

### B8 — Lazer's existing Workspace tenant for `lazerlending.com` [DEFAULT-ABLE]

**Why:** `notify.lazerlending.com` Resend records (transactional sends) need to coexist with whatever DNS Lazer already has on the root domain. If Lazer has an existing Workspace tenant, our SPF includes and DKIM keys must not collide. If not, we add records cleanly to whatever registrar holds `lazerlending.com`.

**Default:** Independent — DNS records added at Lazer's registrar without affecting any existing Workspace MX/SPF/DKIM. Resend's domain verification flow tolerates pre-existing SPF if we use `include:` properly.

**Action on unblock:** Confirm. If shared, coordinate DNS with Lazer's existing Workspace admin: ensure SPF stays under the 10-DNS-lookup limit (RFC 7208 §4.6.4) when adding `include:_spf.resend.com`; ensure DKIM selectors do not collide.

**Code location:**
- `supabase/functions/_shared/email.ts` (or equivalent) — `EMAIL_DOMAIN` constant currently `'integrateapi.ai'` at `supabase/functions/send-email/index.ts:8` — must become env var `RESEND_TRANSACTIONAL_DOMAIN` per CONNECT-CRM-AUDIT-DELTA.md §"Resend integration scope"
- DNS records documented in `docs/lazer-lending/VENDOR-CONTRACTS.md` (pending)

**Owner:** Lazer IT / Lazer's Workspace admin.

### B9 — LLM classifier provider — Anthropic vs OpenAI Enterprise [HARD BLOCKER for live classifier]

**Why:** Reply bodies contain prospect PII (names, contact info, financial intent statements). Sending to a provider without a no-train DPA is a data-licensing violation for Lazer's customers. Anthropic API has no-train in standard ToS; OpenAI standard API does **not** (training is opt-out only on standard tier); OpenAI Enterprise does have no-train DPA but requires a signed contract. Wrong choice = silent training violation.

**Default:** Anthropic API (no-train DPA in standard ToS). Sandbox-only until Lazer compliance signs off.

**Action on unblock:**
1. Lazer compliance/legal approves provider choice.
2. Sign DPA (Anthropic Commercial Terms or OpenAI Enterprise agreement).
3. Capture API key in `.env` (`CLASSIFIER_API_KEY`), provider in `CLASSIFIER_PROVIDER`.
4. PII redactor (Phase 2.2) runs **before** any LLM call regardless — redaction is belt-and-suspenders, not a substitute for DPA.

**Code location:**
- `.env` `CLASSIFIER_PROVIDER`, `CLASSIFIER_MODEL`, `CLASSIFIER_API_KEY` (PLAN.md:1538-1540)
- `supabase/functions/smartlead-events/classifier.ts` (new — Phase 2.2)
- PII redactor: `supabase/functions/_shared/redact.ts` (new)

**Owner:** Lazer compliance / legal counsel.

### B10 — Reply body retention window [DEFAULT-ABLE]

**Why:** Lending vertical regulators (state DFPI/DFS equivalents, plus federal CFPB exam scope) typically expect 7-year retention of communications evidencing solicitation and disclosure compliance. Raw reply bodies, however, contain sensitive PII that compounds breach exposure if held forever. Two-tier retention satisfies both.

**Default:** Two-tier:
- Raw reply body: 18 months, then redact (drop body, keep classification + metadata)
- Redacted record + audit metadata: 7 years
- Suppression list: indefinite (CAN-SPAM requires permanent honor)

**Action on unblock:** Lazer compliance/legal confirms windows or sets new ones (e.g., "5yr/3yr" or "always full retention with encryption").

**Code location:**
- Retention enforcement job: `supabase/functions/retention-redactor/` (new — Phase 1.17)
- `replies.redacted_at` timestamp
- `replies.body_raw` / `replies.body_redacted` columns
- Cron schedule via pg_cron (similar to existing `process-campaigns` pattern)

**Owner:** Lazer compliance / legal counsel.

## Phase 1 hard blockers (cannot ship Phase 1 acceptance gates without these)

### B11 — FUB API access on Lazer's plan [HARD BLOCKER for FUB push, v1.SC5]

**Why:** FUB does not document API access by plan tier on its public pricing page. Third-party analysis suggests Platform tier (~$833/mo annual) is the gate; other sources say API is open across all tiers. Without confirmation, Phase 2 build is blind. Additionally, the `X-System-Key` header is required to avoid halved rate limits (125/10s vs 250/10s) and proper FUB audit-log attribution. This is a one-time provisioning step requiring email contact with FUB support — not self-serve.

Source: `tmp/research/2026-05-04-followupboss.md:382-388, 411-413, 506`.

**Default:** Cannot default. v1.SC5 ("Positive → FUB push w/ `email_normalized` dedup") fails without API key.

**Action on unblock:**
1. Lazer's FUB account rep confirms API key is generatable on current plan.
2. If blocked, upgrade FUB plan to Platform tier (~$833/mo annual).
3. Lazer Admin/Owner generates API key in FUB Admin → API panel.
4. **Email FUB support** to register `lazer-lending-crm` as a system → receive `X-System-Key`. (Without this, rate limits are halved.)
5. Capture into `.env`: `FUB_API_KEY`, `FUB_X_SYSTEM=lazer-lending-crm`, `FUB_X_SYSTEM_KEY`.
6. Confirm `FUB_DEFAULT_STAGE_NAME` (string, NOT id — must match `GET /v1/stages` on Lazer's account) and `FUB_DEFAULT_SOURCE_LABEL`. The Phase 2.5b onboarding step prints the live stages list for confirmation.

**Code location:**
- `supabase/functions/fub-push/index.ts` (new — Phase 2.5)
- `.env` keys above (canonical names per PLAN.md env vars section)
- Outbound: `POST /v1/events` (auto-dedup on email, `email_normalized` as key)
- Inbound webhook receiver (Phase 2.6): verify `FUB-Signature` HMAC SHA256 keyed by `X-System-Key`

**Owner:** Lazer ops + Lazer's FUB account rep.

### B12 — All vendor accounts (Smartlead, Zapmail/Mailforge, ZeroBounce, Resend, LLM provider) [HARD BLOCKER for live sends]

**Why:** Every Edge Function in the cold path is written against placeholder env vars. Cannot smoke-test until accounts exist, and cannot pass v1.SC1–SC11 without real provider responses.

**Default:** Cannot default. All env keys in `.env.example` are empty (PLAN.md:1509-1564).

**Action on unblock:** Use the per-vendor unblock checklists in `docs/lazer-lending/VENDOR-CONTRACTS.md` (pending — must be authored as part of Phase 0.3). Required accounts:

| Vendor | Used for | Env keys |
|---|---|---|
| Smartlead Pro | Cold send + warmup + reply webhook | `SMARTLEAD_API_KEY`, `SMARTLEAD_WEBHOOK_SIGNING_SECRET`, `SMARTLEAD_BASE_URL` |
| Mailforge or Zapmail | Burner mailbox provisioning + DNS | `MAILFORGE_API_KEY`, `MAILFORGE_BASE_URL`, `MAILFORGE_DEFAULT_BUNDLE` |
| ZeroBounce | Bulk + JIT email validation | `ZEROBOUNCE_API_KEY`, `ZEROBOUNCE_BASE_URL` |
| Follow Up Boss | Qualified-warm-lead push | `FUB_API_KEY`, `FUB_X_SYSTEM`, `FUB_X_SYSTEM_KEY`, `FUB_DEFAULT_STAGE_NAME`, `FUB_DEFAULT_SOURCE_LABEL` (see B11) |
| Resend | Transactional only on `notify.lazerlending.com` | `RESEND_API_KEY`, `RESEND_TRANSACTIONAL_DOMAIN`, `RESEND_FROM_DEFAULT` |
| LLM provider | Reply classifier (B9) | `CLASSIFIER_PROVIDER`, `CLASSIFIER_MODEL`, `CLASSIFIER_API_KEY` |
| DMARC RUA aggregator | DMARC report aggregation | `DMARC_RUA_PROVIDER`, `DMARC_RUA_ENDPOINT` |

**Note on Mailforge vs Zapmail:** Per `tmp/research/2026-05-04-mailforge-workspace.md:10, 58`, Mailforge has **no public provisioning API** and **shared IP pool** (63% inbox placement vs 82% on real GWS). For Lazer's mortgage-vertical lead value, Zapmail (real pre-warmed GWS, $3.00–3.50/mailbox) is the safer choice despite higher cost. **This is itself a sub-decision Lazer should ratify.** Treat as B12a if escalated.

**Code location:**
- `.env` (PLAN.md:1509-1564)
- Vendor client modules: `supabase/functions/_shared/{smartlead,fub,zerobounce,resend}.ts` (some new, some refactored)

**Owner:** Lazer ops (account creation) + IntegrateAPI (technical configuration).

### B13 — Smartlead List-Unsubscribe URL ownership [HARD BLOCKER for v1.SC3]

**Why:** Research surfaced (`tmp/research/2026-05-04-smartlead.md:70-81, 489`) that Smartlead may auto-inject **its own** `List-Unsubscribe:` URL into outbound MIME, not ours. If so:
- Our HMAC-signed `/api/list-unsubscribe` endpoint is unreachable from the email link
- Suppression must rely on the `LEAD_UNSUBSCRIBED` webhook event from Smartlead (with whatever propagation latency that entails)
- Our `LIST_UNSUB_TOKEN_SECRET` HMAC scheme (Decision D13 in CLAUDE.local.md) is dead code

If Smartlead supports custom List-Unsubscribe URLs (unverified), our HMAC scheme works as designed.

v1.SC3 acceptance requires: "List-Unsub headers (both URI variants + `List-Unsubscribe-Post`) on every send (verified via raw MIME)". Without confirming whose URL is in the header, we cannot complete this gate.

**Default:** Build **both paths** —
- HMAC endpoint at `/api/list-unsubscribe` (works if Smartlead lets us inject custom URL)
- `LEAD_UNSUBSCRIBED` webhook handler that suppresses on event (works if Smartlead injects its own URL)

Both paths terminate in the same `suppressions` table insert, so neither is wasted.

**Action on unblock:**
1. Phase 0.6 sandbox: send a test campaign via Smartlead, inspect raw MIME via `Show Original` in Gmail or `dig +short` equivalent on the test inbox.
2. Confirm whether `List-Unsubscribe:` header points to our domain (`*.lazerlending.com`) or Smartlead's (`smartlead.ai` or similar).
3. If Smartlead's: rely on webhook + document the propagation latency in Settings → Compliance copy. Mark HMAC endpoint deprecated (kept for future provider).
4. If ours: confirm HMAC verification works against the URL Smartlead injects. Document the URL template Smartlead uses.
5. Also verify: body-only HMAC vs body+timestamp for `X-Smartlead-Signature` webhook verification (`tmp/research/2026-05-04-smartlead.md:240, 493` flag this as unverified). This affects the signature-verify code path in `smartlead-events`.

**Code location:**
- `supabase/functions/smartlead-events/index.ts` `LEAD_UNSUBSCRIBED` handler (new)
- `supabase/functions/unsubscribe/index.ts` HMAC path (extend existing — see CONNECT-CRM-AUDIT-DELTA.md §"Phase 2.3 Unsubscribe token migration")
- `suppressions` table insert (new — Phase 1)

**Owner:** IntegrateAPI engineer (Phase 0.6 sandbox test). Lazer is not the bottleneck here, but the test cannot run until B12 (Smartlead account) is unblocked.

## Phase 4 (post-launch) blockers

### B14 — Seed inbox network ownership (v2 spam-placement check) [POST-LAUNCH]

**Why:** Phase 3 spam-placement monitoring (PRD §5.4) requires a panel of seed Gmail/Outlook/Yahoo accounts to receive test sends and verify inbox vs spam folder placement. Owner of these accounts (IntegrateAPI vs Lazer) determines who pays for the seeds, who maintains them, and whose IP they appear under to mailbox providers.

**Default:** Phase 4 work; documented as v2. v1 ships without this.

**Action on unblock:** Lazer or IntegrateAPI provisions seed Gmail/Outlook/Yahoo accounts. If IntegrateAPI: existing seed network reused (cost-shared). If Lazer: new seeds, longer warmup.

**Code location:**
- `seed_inbox_checks` table (Phase 4 — does not exist yet)
- `supabase/functions/seed-inbox-checker/` (new — Phase 4)

**Owner:** Lazer ops + IntegrateAPI ops (joint decision).

### B15 — Volume ramp expectations — when 500/day, when 1000/day? [POST-LAUNCH]

**Why:** v1 starts at 100/day per architecture. Ramp to 300–500/day is a 6-week warmup behavior; ramp to 1000/day requires inventory expansion (more burners, more mailboxes, more Mailforge/Zapmail spend). Lazer's growth expectation drives provisioning timing, not the calendar.

**Default:** v1 = 100/day, ramp to 300/day after 6-week warmup, 500/day after 12-week warmup, 1000/day documented but not pre-built (requires explicit re-plan).

**Action on unblock:** Lazer ops projects volume targets quarterly; IntegrateAPI provisions inventory accordingly.

**Code location:**
- `lazer_settings.global_daily_send_ceiling` (Settings panel)
- Per-mailbox cap: `mailboxes.daily_cap` (default 30, range 20–40 per Decision D15)

**Owner:** Lazer ops / sales lead.

### B16 — Smartlead outage contingency [POST-LAUNCH]

**Why:** Single-vendor dependency on Smartlead means a multi-day outage halts cold sends. The `SendProvider` interface (Phase 1.1) makes a second vendor (Saleshandy) drop-in addable, but pre-wiring it costs 1-2 weeks of dev time that may never pay off.

**Default:** Accept temporary downtime. `SendProvider` interface is built future-proof but not actively dual-vendor. If Smartlead goes down for >24h, manual escalation triggers Saleshandy build (estimate 1 week).

**Action on unblock:** Lazer confirms tolerance for occasional downtime, OR pre-funds Saleshandy build and account.

**Code location:**
- `supabase/functions/_shared/send-provider.ts` (interface — Phase 1.1)
- Saleshandy implementation: deferred

**Owner:** Lazer ops.

## Field-by-field env var checklist (post-unblock)

This table maps each blocker to the env var(s) it unblocks, with current placeholder, real-value source, and the blocker that gates resolution.

| Env var | Current value | Real value source | Blocker gate |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `your_supabase_url` | New Lazer Supabase project dashboard | B1 |
| `VITE_SUPABASE_ANON_KEY` | `your_supabase_anon_key` | New Lazer Supabase project dashboard | B1 |
| `SUPABASE_SERVICE_ROLE_KEY` | `your_supabase_service_role_key` | New Lazer Supabase project dashboard | B1 |
| `SMARTLEAD_API_KEY` | (empty) | Smartlead dashboard → API Settings | B12 |
| `SMARTLEAD_WEBHOOK_SIGNING_SECRET` | (empty) | Smartlead webhook registration UI | B12, B13 |
| `SMARTLEAD_BASE_URL` | `https://server.smartlead.ai/api/v1` | Default — no client input needed | — |
| `MAILFORGE_API_KEY` | (empty) | Mailforge or Zapmail dashboard | B12 (sub: B12a Mailforge vs Zapmail) |
| `MAILFORGE_BASE_URL` | (empty) | Per provider | B12 |
| `MAILFORGE_DEFAULT_BUNDLE` | (empty) | Per provider plan choice | B12 |
| `ZEROBOUNCE_API_KEY` | (empty) | ZeroBounce dashboard | B12 |
| `FUB_API_KEY` | (empty) | Lazer's FUB Admin → API panel | B11 |
| `FUB_X_SYSTEM` | `lazer-lending-crm` | Constant | — |
| `FUB_X_SYSTEM_KEY` | (empty) | Email FUB support to register system | B11 |
| `FUB_DEFAULT_STAGE_NAME` | `Lead` | Confirm via `GET /v1/stages` against Lazer's account (Phase 2.5b onboarding) | B11 |
| `FUB_DEFAULT_SOURCE_LABEL` | `Lazer Lending CRM Cold Outreach` | Constant per FUB integration guide | — |
| `RESEND_API_KEY` | `your_resend_key` | Resend dashboard (Lazer org) | B12 |
| `RESEND_TRANSACTIONAL_DOMAIN` | `notify.lazerlending.com` | Constant per architecture | B8 (depends on Workspace coordination) |
| `RESEND_FROM_DEFAULT` | `Lazer CRM <ops@notify.lazerlending.com>` | Constant per architecture | B8 |
| `CLASSIFIER_PROVIDER` | `anthropic` | Default per Decision D9; Lazer can override | B9 |
| `CLASSIFIER_MODEL` | (empty) | Default `claude-sonnet-4` or per-Lazer choice | B9 |
| `CLASSIFIER_API_KEY` | (empty) | Anthropic Console or OpenAI Enterprise | B9 |
| `DMARC_RUA_PROVIDER` | `cloudflare` | Default; Lazer can override | B7, B12 |
| `DMARC_RUA_ENDPOINT` | (empty) | Per provider | B7 |
| `APP_BASE_URL` | (empty) | Set per deploy environment | — |
| `LIST_UNSUB_TOKEN_SECRET` | (empty) | Generate via `openssl rand -hex 32` | — (operator-internal) |
| `LIST_UNSUB_TOKEN_TTL_DAYS` | `180` | Default | — |
| `OPS_ALERT_EMAIL` | (empty) | Lazer ops contact | B4 (or separate) |
| `DEFAULT_REPLY_FORWARD_EMAIL` | (empty) | Lazer ops | B4 |
| `FORWARDER_MODE` | `imap_redirect` | Default per Decision D8 | — (default safe) |
| `DEFAULT_MAILBOX_TIMEZONE` | `America/Phoenix` | Default per Decision D12 | — (override per mailbox if needed) |
| `WATCHDOG_BOUNCE_THRESHOLD` | `0.02` | Default per Decision D16 | — |
| `WATCHDOG_COMPLAINT_THRESHOLD` | `0.001` | Default per Decision D16 | — |
| `WATCHDOG_MIN_ATTEMPTED` | `10` | Default per Decision D16 | — |
| `DEFAULT_MAILBOX_DAILY_CAP` | `30` | Default per Decision D15 | — |

Secret values are referenced by env var name only. Never echo resolved values.

## What this means for /implement (Phase F)

A `/implement` run today on the existing PLAN can complete:

- **Migrations** — schema for new tables (`domains`, `mailboxes`, `sends`, `replies`, `conversations`, `suppressions`, `webhook_events`, `mailbox_send_log`, `mailbox_warmup_state`, `seed_inbox_checks`, `pool_memberships`, `sending_pools`)
- **TypeScript regen** — `src/types/database.ts` regenerates after migrations
- **React hooks** — `use-domains.ts`, `use-mailboxes.ts`, `use-replies.ts` skeletons calling Supabase
- **UI scaffolding** — Domains, Mailboxes, Replies pages following established `src/pages/*` pattern
- **Edge Function skeletons** — `smartlead-events`, `fub-push`, `dmarc-ramp-evaluator`, `retention-redactor`, `seed-inbox-checker` (signature verification stubs, idempotency check, classifier interface)
- **Settings panel** — Compliance, Domains, Mailboxes, Watchdog Thresholds tabs
- **Send-provider interface** — abstraction at `supabase/functions/_shared/send-provider.ts`
- **Refactor `process-campaigns`** — add `provider = 'smartlead'` branch, add `FOR UPDATE SKIP LOCKED` on enrollment fetch
- **Refactor `unsubscribe`** — add HMAC token path with DB UUID-token fallback
- **Tests** — Vitest unit tests for HMAC, Wilson lower-bound, classifier failover paths

What `/implement` **cannot** complete (gated by client input):

- **Live cold sends** — gated by B1 (Supabase project), B2 (footer), B3 (domains), B12 (vendor accounts), B13 (List-Unsub verification)
- **Live FUB push** — gated by B11 (API key + X-System-Key)
- **Live LLM classification** — gated by B9 (DPA + API key)
- **Reply forwarding to humans** — gated by B4 (forward address)
- **Production DMARC ramp** — gated by B7 default acceptance + B12 (RUA aggregator)
- **v1 acceptance gates SC1–SC11** — every one requires at least one HARD BLOCKER cleared

## Last verified

2026-05-04
