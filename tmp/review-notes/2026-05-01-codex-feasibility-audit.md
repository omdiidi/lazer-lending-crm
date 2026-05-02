# Codex-Review: Lazer Lending CRM Plan v2.1 — Feasibility & Failure-Mode Audit

**Date:** 2026-05-01
**Engine:** 4× Claude Opus lens agents (Depth, Breadth, Adversary, Gaps) + meta-review. Codex CLI unavailable on this machine; falling back to Claude-only is the documented behavior for plan/conceptual reviews. *No code paths verified — this is a planning-doc audit.*
**Inputs reviewed:** `docs/lazer-lending/PRD.md`, `docs/lazer-lending/BRIEF-email-architecture.md`, `docs/lazer-lending/PLAN.md`, `docs/lazer-lending/PLAN-REVIEW-NOTES.md`, plus `CODEBASE_ANALYSIS.md`.

---

## Top-line summary

The architecture is sound. The schedule, the contract, and the regulatory posture are not. **Plan v2.1 silently replaced 3 of the PRD's 7 v1 ship criteria** without a written client amendment, **the Phase 0 → v1 timeline is roughly 14–20 dev-weeks not the implied single quarter**, **8–10 named correctness bugs in the pseudocode** will become production incidents if not fixed before Phase 1 starts, and the **NMLS/state-licensing footer is punted to "Lazer compliance will supply"** which is the single failure mode most likely to either block launch indefinitely or expose Lazer to state-AG enforcement on day 1. Defensible commercial structure: **$85k–$110k fixed-bid for v1 (Phase 0–2)** + **$1,800/mo flat retainer** that bundles vendor passthroughs + own-the-code clause for Lazer + termination/export deliverable.

**Verdict per phase:**

| Phase | Verdict | Reasoning |
|---|---|---|
| Phase 0 | **CLARIFY** | Real duration is 5–10 days, not 1–3. Client kickoff to close 13 OQs realistically takes 3–6 weeks calendar. Get the client to sign off on the architecture-replacement BEFORE starting. |
| Phase 1 | **GO with hard gates** | Architecture is right but 8 correctness bugs need pseudocode fixes before any code is written. Add hard gate: NO production sends until List-Unsub + watchdog + DMARC RUA + state-licensing footer all green. Realistic effort 8–12 weeks. |
| Phase 2 | **GO with effort correction** | Plan treats classifier as one task; realistic 3–5 weeks including eval-set authoring, prompt iteration, redactor testing, IMAP-forward integration. |
| Phase 3 (v2) | **DEFER until Phase 1 ships clean** | Spam-placement check was originally PRD v1; confirm with client it can stay v2. |
| Phase 4 (v2) | **DEFER** | Auto-rotation only matters at scale; v1 manual rotation is correct. |

---

## 1. This will not work as written (Critical / must fix before code is written)

These are correctness bugs in the pseudocode the implementer is going to copy. Every one is a 1–3 day fix.

- [definite] **BUG — Atomic dispatcher leaks slots on Smartlead 5xx/429.** `claimSendSlot` increments `today_sent_count` *before* the Smartlead POST. If Smartlead errors, the slot is consumed and not refunded. At 30/day per mailbox, ~5–10 leaked slots/day per mailbox is meaningful. Need a compensating decrement in the error path, or move the increment into a DB-level "reserved" → "sent" two-phase model. — `PLAN.md` §claimSendSlot ~948–992 + Task 1.5a.
- [definite] **BUG — Watchdog hard-complaint rule is dead code via `else if` chain ordering.** `runMailboxWatchdog` checks rate threshold first, then guards the single-complaint branch on `complaintLower <= complaintThreshold`. A mailbox with 5 complaints in 50 sends pauses with reason `complaint_threshold` and never enters the manual-review queue the brief required. Hard rule must be independent of rate, not gated by it. — `PLAN.md` ~1029–1041.
- [definite] **BUG — FUB email normalizer over-merges Outlook/Yahoo.** Plan says "lowercase + plus-tag stripped + Gmail dot-insensitive" applied globally. Gmail collapses dots; Outlook/Yahoo/Proton/etc. do NOT. Applying dot-insensitivity globally collides distinct mailboxes (`john.doe@outlook.com` ≠ `johndoe@outlook.com` at Outlook). The `UNIQUE INDEX(email_normalized)` will create false dedup that cross-contaminates FUB pushes. Fix: domain-conditional normalizer (`gmail.com` and `googlemail.com` only). — `PLAN.md` Task 2.5, Lead.email_normalized.
- [definite] **BUG — Webhook idempotency has a TOCTOU gap.** Plan inserts the idempotency row in step 2 and updates `processed_at` in step 6. A webhook retry arriving in the milliseconds between steps 2 and 6 sees the row, short-circuits 200 OK — but the original processing may still be in-flight or about to fail. If processing then errors, the event is permanently lost (idempotency row exists, processed_at never set). Needs `processing` state or a re-check on `processed_at IS NULL`. — `PLAN.md` §Webhook Idempotency Strategy.
- [definite] **BUG — Webhook ordering races. `bounce` arrives before `email_sent`.** Smartlead's webhook stream is not strictly ordered. The bounce-cascade flow assumes a `sends` row exists. Out-of-order arrival creates an orphan bounce: handler crashes, silently drops, or inserts a phantom row. Also: late webhook (24h+ retry) arriving after reconcile has corrected the row will overwrite the corrected state because reconcile writes don't pass through `webhook_events` idempotency. — `PLAN.md` §Webhook Idempotency Strategy + Task 1.13.
- [definite] **LOGIC — Stop-on-reply exception will hammer mis-classified positives.** Rule: any reply except `negative` low-confidence cancels future steps. Classifier accuracy at 88–92% means ~10% of positives mis-classified as low-conf negative — those leads keep getting hit by step 2/3/4 of the sequence. They flag as spam. One mis-class kills the mailbox. **At v1 volume, the right rule is: stop on ANY reply, let humans manually re-enable.** Premature optimization. — `PLAN.md` §Pacing & Concurrency.
- [definite] **LOGIC — Classifier missing regex backstop for unambiguous opt-out language.** "stop calling," "remove me," "unsubscribe," "do not contact," "cease communication" must FORCE `unsubscribe` classification. Delegating to LLM at 88–92% accuracy means ~10% of true unsubscribes get re-mailed. Each re-mail to an unsubscribed recipient is per-message CAN-SPAM exposure (~$51k statutory damages cap as of 2024). Add a regex pre-filter that bypasses the LLM for these substrings. — `PLAN.md` §classifyReply.
- [definite] **LOGIC — Wilson watchdog is dormant at v1 volume.** Min-attempted floor 10 + complaint threshold 0.001 means the rate path can't fire below ~400 sends/24h per mailbox. At 20/mailbox/day, **the watchdog runs entirely on the hard-complaint hatch** until ~20× scale-up. Plan presents Wilson as the primary signal. It isn't, at v1. Document this honestly. — `PLAN.md` §runMailboxWatchdog.
- [definite] **SECURITY — HMAC unsubscribe token has no revocation, no rotation story.** Stateless HMAC means a leaked token works for `LIST_UNSUB_TOKEN_TTL_DAYS=180` regardless. Rotating `LIST_UNSUB_TOKEN_SECRET` invalidates every in-flight unsubscribe link → recipients get 401 → flag as spam. Need (a) constant-time HMAC compare (`crypto.timingSafeEqual`), (b) `LIST_UNSUB_TOKEN_SECRET_PREVIOUS` for dual-verify rotation window, (c) consider bumping TTL down to 30 days. — `PLAN.md` §Locked Decision 13.
- [definite] **ARCHITECTURE — Webhook handler does too much work inline vs Smartlead retry windows.** Reply handler does signature → idempotency → persist → **5s LLM call** → suppression → stop-on-reply → router → forwarder → FUB push, all before returning 200. Smartlead retries on slow webhooks (typical 10–30s timeout). On a slow LLM the handler exceeds, Smartlead retries, idempotency catches the dupe — but the original handler is still running and the second handler might double-process. Industry pattern: webhook returns 200 immediately after idempotency-INSERT, then enqueues the work. Plan doesn't separate these. — `PLAN.md` §Reply flow + §Webhook Idempotency.
- [definite] **COMPLIANCE — No NMLS / state-licensing footer default.** OQ6 punts to "Lazer compliance/legal supplies exact strings." If they don't, Phase 1 cannot ship. If implementer ships *any* footer to meet a deadline without legal sign-off, every send is a state lending-advertising violation. Need: (a) hard gate that no campaign sends without a footer marked `legal_approved=true`; (b) default template that fails closed with NMLS placeholder requiring fill-in; (c) campaign-level footer override. — `PLAN.md` OQ6, §Settings.
- [definite] **COMPLIANCE — No source-of-list / consent tracking on Lead model.** Cold lending in MA, MD, FL, IN and several other states requires either prior business relationship documentation or a specific exemption. Plan stores ZeroBounce status (validates address exists, NOT consent). Add `lead.source_list_id` + `lead.source_acquired_at` + `lead.consent_basis` enum (`prior_relationship` | `purchased_list` | `public_data` | etc.). Without this, regulator subpoena gets shrugs. — `PLAN.md` §Data Models > Lead.
- [definite] **OPERATIONAL — Domain rotation button doesn't recall Smartlead's in-flight queue.** v1.SC6 says "sends stop on rotated domain's mailboxes within 60s" — but Smartlead may have hours of queued sends per mailbox. Marking the mailbox `paused` in our DB doesn't recall what's already in Smartlead's queue. Need to call Smartlead's pause-campaign or cancel-queued-sends API. — `PLAN.md` §v1.SC6.
- [likely] **BUG — Daily-cap reset failure is silent.** A missed reset means `today_sent_count` never zeroes, so the mailbox is permanently capped at its previous day's count. Reset-job failure produces a silent reputation cliff. Need a watchdog: "alert if any mailbox's `last_reset_at < local_midnight - 1h`." — `PLAN.md` Task 1.17.
- [likely] **ARCHITECTURE — Supabase Edge Functions can't run all the jobs.** Edge Functions are Deno, max ~150s per invocation, and pg_cron can only invoke SQL (needs `pg_net` or HTTP wrapper). Watchdog (per-mailbox loop with HTTP forwards + LLM) and daily reconcile (paginate Smartlead stats) don't fit cleanly. A separate worker host (Render/Fly background worker) is needed and adds ~1 week of setup not in the plan. — `PLAN.md` ~326–332.
- [likely] **LOGIC — IMAP forwarder default may be technically impossible.** OQ3 default = IMAP redirect. Smartlead typically uses OAuth not IMAP for managed Workspace mailboxes; IMAP requires per-mailbox enablement that Workspace admins must allow. May not work without extra Mailforge/Smartlead setup. Smoke-test in Phase 0 before locking. — `PLAN.md` OQ3, Task 2.3.

## 2. Scope-drift from PRD (Critical — paperwork problem)

The architecture is right. The signoff is missing. Plan v2.1 silently replaced features Lazer agreed to in the PRD.

- [definite] **CONTRADICTION — PRD §3 v1 Ship Criterion #1: "warm 3 subdomains on lazerlending.com"** is no longer buildable. Brief D1 replaced this with burner domains. Architecturally correct, contractually unsigned.
- [definite] **CONTRADICTION — PRD §3 #2: "send 100-email campaign from a warmed subdomain via Resend"** is gone in two ways (not subdomain, not Resend). The PRD's literal ship gate cannot be passed.
- [definite] **CONTRADICTION — PRD §3 #6: "Manual subdomain rotation works from a single button"** — UX shape preserved as "domain rotation button," but the thing being rotated is invisible burner inventory rather than user-owned subdomains. The button looks like the PRD's button; the meaning differs.
- [definite] **CONTRADICTION — PRD §5.5 Torched Root Detection** is a USER-VISIBLE FEATURE in the PRD (banner alerts, root-buying flow, root history log, DMARC monitoring on the brand). Plan removes this entirely on the premise that the brand root never sends cold. Defensible architecturally; the client asked for a specific UI feature. Mitigation: half-day to add a read-only "brand root health" status card on the dashboard so the feature isn't silently dropped.
- [likely] **CONTRADICTION — PRD §5.2 warmup expectations** are detailed (real warmup network, ramp schedule, simulated engagement, spam recovery, ongoing low-volume traffic). Plan delegates entirely to Smartlead's bundled warmup. Smartlead does cover items 1, 2, 3, 5 — but plan never maps PRD requirements to Smartlead capabilities. Without that map, Lazer reads this as "we became Smartlead resellers." Add `docs/lazer-lending/WARMUP-CAPABILITY-MAP.md` to Phase 0.
- [likely] **MISSING — PRD §5.4 spam-placement check** was a v1 feature in the PRD. Plan deferred to v2 (Phase 3). Confirm acceptable with client before assuming.
- [definite] **CONTRADICTION — PRD §4 inventory model.** PRD: 3–5 subdomains × 300/day = 900/day. Plan: 5–10 mailboxes × 30/day = 300/day. Both reach ~1k/day at scale but the inventory shape is fundamentally different. Lazer should know.
- [definite] **MISSING — RFC 8058 List-Unsubscribe is in plan but not in PRD.** Gmail Nov-2025 enforcement made this mandatory after the PRD was written. ~2 dev days of scope addition not in original signoff. Surface as billable scope addition in client kickoff.

**Action:** Phase 0.5 client kickoff must produce a written PRD-amendment that Lazer signs. Ship the new architecture *with* sign-off, not in spite of it.

## 3. Compliance & regulatory exposure (Project-ending if missed)

Lending is the worst vertical for cold-email mistakes. State AGs are active. The plan does not protect Lazer enough.

- [definite] **No subpoena-ready audit artifact.** State AG subpoenas request "all cold outbound mail to residents of [state] from [date] to [date] with proof of consent." Plan has retention but not the export. Regulator-readiness should be a deliverable, not a feature.
- [definite] **CAN-SPAM §5 sender-identification mismatch unaddressed.** From-name "Sam @ Lazer Lending" sent from `sam@lazer-loans.com` arguably obscures the sender's identity. The whole burner-domain premise is a deliberate brand/sender mismatch. Body must clearly identify Lazer Lending; from-name should too. Plan never reconciles this with §5(a)(1).
- [definite] **No CCPA/GDPR right-to-delete machinery.** Cold lists routinely include California residents (CCPA applies; lending explicitly covered). Recipient emails "delete my data," there's no flow to locate and delete across `leads`/`sends`/`replies`/`webhook_events`/`audit_log`/`conversations`. CAN-SPAM is not enough.
- [likely] **TCPA risk for cold mortgage email is real.** Federal courts have applied TCPA principles to non-phone consumer financial product solicitations in some jurisdictions. Plan has zero TCPA language.
- [likely] **State-level cold-mail statutes beyond CAN-SPAM.** FL §501.059, MD Commercial Law §14-3001, others have stricter requirements. Lending vertical = active state-AG attention. Plan only mentions CAN-SPAM.
- [likely] **Reg B / ECOA fair-lending exposure.** If lead lists are sourced from data brokers using inferred demographics (homeowner status, income proxy, ZIP-code racial composition), even cold outreach can violate fair lending. Plan has zero guidance on list sourcing, no `lead.source` enum, no provenance review.
- [definite] **Suppression list not portable as proof.** "Indefinite retention" but no `suppressions.source_campaign_id`, `suppressions.source_send_id`, no per-sender records. CAN-SPAM enforcement requires per-sender opt-out proof. If Lazer rotates domains/entities, the suppression list isn't legally portable.
- [definite] **PII redaction is hand-waved.** `redactPII()` regex covers SSN-with-dashes, 16-digit cards. Real lending replies leak: ITIN-like 9-digit, SSNs without dashes, dates of birth, addresses, employer names, salary, partial SSNs. Plan calls "no-train DPA" the load-bearing safeguard — DPAs aren't retroactive against breaches. Need a real redactor with eval set + audit trail.

## 4. Production failure modes (Will hit eventually)

- [definite] **Smartlead AUP tightening or outage = full system stop.** SendProvider interface exists but no second vendor wired. Realistic outage tolerance: weeks until Saleshandy or another vendor onboards. For a primary lead-gen channel, this is unacceptable.
- [definite] **Mailforge deplatform = total outbound death.** All burner mailboxes share one Workspace tenant (Mailforge's reseller org). Google flags one → tenant-level enforcement hits all. Recovery: 2–4 weeks of direct-Workspace provisioning + warmup. During that window Lazer pipeline = zero.
- [definite] **No spare warmed burner inventory.** Auto-rotation puts a domain in 14-day cooldown. If two burners breach simultaneously, capacity halves with no spare. Mailforge new-burner provisioning + warmup is 1–3 weeks. Keep at least 1 spare warmed standby.
- [definite] **Anthropic API outage stalls reply pipeline.** Real incidents have hit 4+ hours. Plan failover sets `classification=null` + `requires_human_review=true` but doesn't define retry SLA, queue depth alarm, or operator visibility ("X replies pending classification"). Hot leads cool while no one watches.
- [definite] **Smartlead webhook signing secret rotation breaks silently.** No health check on signature-pass rate. Symptom: zero webhooks accepted in last hour, no alert. Add liveness check: `0 webhook events in 60min during business hours` → alert.
- [definite] **DMARC RUA aggregator down = ramp evaluator blind.** "4–6 weeks of clean reports" gate has no liveness check that reports are actually arriving. Cloudflare drops free tier silently → "0 auth-failure reports" indefinitely → human flips ramp manually with no actual evidence. Add: alert if `0 RUA reports received in 7 days` for any active burner.
- [definite] **Burner-domain expiry = sends bounce overnight.** Operator forgets renewal. SPF/DKIM/DMARC TXT records evaporate when DNS goes dark. Sends bounce, reputation tanks. Need `domain.expires_at` tracked + 30-day expiry alarm.
- [likely] **Reply-forwarding into Microsoft 365 distribution-list quarantines.** If Lazer's reply-forwarding target is `team@lazer.com` on M365 with anti-spoofing, forwarded mail from third-party `From:` addresses hits quarantine. SPF/DKIM/DMARC on the forward leg is unaddressed.
- [likely] **Recipient sabotage attack.** A bad-faith actor (or competitor) signs up with multiple emails, marks one as spam. Single-complaint hard rule pauses the mailbox. At v1 of 30/day, one hostile actor can pause inventory at will. No bot-flag mitigation, no complainant-identity weighting.
- [likely] **Phase 0.5 client kickoff timeline is fictional.** 13 OQs assume one kickoff call. Lazer is small; compliance/legal is one part-time person. Realistic close: 3–6 weeks across multiple touchpoints. Phase 1 timeline downstream is wrong.

## 5. Engineering effort (Schedule is fictional)

- [definite] **Phase 0 actual duration: 5–10 working days.** Plan implies 1–3. Includes: walk Connect CRM, audit-delta doc, lock Supabase, provision 5 vendor sandbox accounts, document Smartlead webhook signing by sending real test events, verify dev loop, **run client kickoff to close 10 Phase-1-blocking OQs** (multi-week calendar), smoke-test 1 burner end-to-end (DNS propagation 24–72h cannot be parallelized away), re-run plan-review.
- [definite] **Phase 1 actual duration: 8–12 weeks single-engineer with Claude assistance.** Realistic per-task breakdown:
  - Task 1.1 (SendProvider + Smartlead): 3–5d
  - Task 1.2/1.3 (Mailforge + state machines + UIs): 7–10d
  - Task 1.5 (dispatcher with correctness fixes): 5–7d
  - Tasks 1.6/1.7 (ZeroBounce + JIT): 3–5d
  - Tasks 1.8/1.8a/1.8b (webhook + idempotency + bounce cascade with deferred processing): 4–6d
  - Task 1.9 (List-Unsub HMAC + idempotent + raw-MIME verification): 3–4d
  - Task 1.10 (Resend transactional): 1–2d
  - Task 1.11 (watchdog + alert wiring): 2–3d
  - Tasks 1.12/1.12a (DNS health + DMARC RUA aggregator): 5–7d (XML parsing non-trivial)
  - Task 1.13 (reconcile): 2–3d
  - Tasks 1.14–1.16 (warmup integration): 2–3d
  - Task 1.17 (daily-cap reset + cron): 1–2d
  - **Total: 38–57 working days = 8–12 weeks for single FT engineer.**
- [definite] **Phase 2 actual duration: 3–5 weeks.** Classifier has hidden multi-week tail: prompt iteration, eval-set authoring (200+ labeled replies × 5 classes × 2 languages), failover testing, PII redactor accuracy testing.
- [definite] **Total realistic time-to-v1: 14–20 dev-weeks + 5-week real-time floor for warmup.** Plan's confidence score and "1–3 days Phase 0" framing implies a much shorter horizon. The reviewer-pass added 9 tasks and 4 sections; total scope grew but the implicit timeline didn't move.
- [definite] **Plumbing vs hard work**: ~60–70% of Phase 1 is mechanical (FUB CRUD, ZeroBounce client, Resend wrapper, settings UI, domains/mailboxes pages). Genuinely hard, novel work: (1) atomic dispatcher correctness, (2) classifier prompt + eval set + failover, (3) DMARC RUA XML parser, (4) IMAP forwarding integration, (5) Mailforge state-machine integration. The "17 tasks" framing creates a uniform-difficulty illusion.

## 6. Charge-ability — defensible commercial structure

### One-time build fee (Phase 0–2 v1)

- **Floor (cost recovery):** 320 hr × $100/hr offshore senior = **$32k**.
- **Defensible mid (US senior, no agency markup):** 400 hr × $175/hr = **$70k**.
- **Agency-priced fixed bid (with scope-risk markup):** 400 hr × $175/hr × 1.6 = **$112k**.
- **Ceiling (where Lazer says no):** ~$150k. Above this, build-a-CRM consultancies become competitive.

**Recommended quote: $85k–$110k fixed-bid for v1.** Phase 3 + Phase 4 priced separately at $25k–$35k.

**Caveat:** With 13 unanswered OQs at signing, a pure fixed-bid puts 100% of scope risk on IntegrateAPI. Recommend phased structure: Phase 0 + 1 fixed-bid ($75k–$95k), Phase 2 quoted after Phase 1 ships ($15k–$25k). Lets Lazer stop after Phase 1 if they're unhappy AND lets IntegrateAPI re-scope based on what was learned.

### Monthly recurring fee

- **Vendor passthrough actual cost:** $90–120/mo (Smartlead Pro $94 + Mailforge $25 + ZeroBounce $10 + Resend free tier).
- **Defensible managed-service fee on top:** $1,500–$2,500/mo. Includes deliverability incident response, weekly health review, classifier prompt tuning, vendor account management, FUB quirk handling, monthly executive summary.
- **Floor:** $750/mo (covers ~3 hr/wk of senior eng time).
- **Ceiling:** $4,000/mo (above this Lazer rationally hires in-house ops at $60k/yr).

**Recommended quote: $1,800/mo flat retainer, includes vendor passthroughs.** Single line item. Don't itemize — itemizing invites "why am I paying you on top of $94 to Smartlead?" Bundling positions it as managed service. Implicit margin (~$1,680/mo over true vendor cost) pays for ~6–10 hr/mo of deliverability ops.

### Pricing structure

- **Best:** Fixed build fee + flat managed-service retainer + 90-day post-launch warranty included.
- **Reject per-send pricing** — turns IntegrateAPI into a vendor profiting from MORE cold mail, conflicts with "protect deliverability" outcome.
- **Reject per-warmup-mailbox** — invites Lazer to micromanage inventory IntegrateAPI controls.
- **Consider rev-share on FUB-pushed leads ONLY as upsell** ($25–50 per qualified-positive that closes). Aligns incentives but complicates accounting; pitch only if Lazer pushes back on retainer.

### Termination clause (currently missing — major commercial gap)

Recommended default contract terms:

- **Lazer owns:** CRM source code (license-back to IntegrateAPI), Lazer-branded UI, classifier prompts (work-product), prospect data, suppression list, FUB tokens, all configuration.
- **IntegrateAPI owns:** Smartlead account (transferable on termination at 30-day handoff fee), Mailforge inventory (NON-transferable; burner domains revert to retirement), prompt iteration logbook, deliverability runbooks.
- **Why this matters for pricing:** "Owns the code" deal commands ~30% premium over "rents." Better for Lazer (no lock-in panic), better for IntegrateAPI (higher one-time fee).

**Action:** No engagement letter signed without owns-the-code clause + data-export deliverable + 30-day handoff terms.

## 7. Gaps — missing entirely from plan

### Blocks v1 launch

- [definite] **No real authentication.** Connect CRM has mock AuthContext. Plan never builds Supabase Auth, sign-in, password reset, MFA. Every "operator" mention assumes infrastructure that doesn't exist.
- [definite] **No RBAC / role model.** Reply bodies contain SSN fragments + lending PII. Plan never says who in Lazer can read raw replies, change classifier prompts, rotate domains, view audit logs.
- [definite] **No suppression-list seed import.** v1's first cold campaign will mail people who already unsubscribed via FUB or old tools. Immediate complaint-rate spike before watchdog has data.
- [definite] **No GDPR/CCPA right-to-delete machinery.** California residents in cold lists trigger CCPA. No flow to locate-and-delete across all tables.
- [definite] **No data backup / DR plan.** Suppression list especially. Loss = CAN-SPAM violation on next send. Supabase backups not enabled/configured per plan.

### Blocks production operations

- [definite] **No SLA between IntegrateAPI and Lazer.** Uptime, response time, support hours, maintenance windows, change-control. Without this, every outage is a renegotiation.
- [definite] **No support model.** Operator hits a bug at 9am, who do they call? Response-time expectation? On-call? Plan: silent.
- [definite] **No on-call definition.** Watchdog says "manual review queue" but plan never specifies who reviews, escalation, what if no one reviews for 48h.
- [definite] **No OPS-RUNBOOK.** "How to rotate a domain," "how to handle a single-complaint pause," "how to retire a burner," "what to do when Smartlead is down." Lazer's operator needs documentation.
- [definite] **No system health dashboard.** Per-mailbox health is built. No system-level view of: dispatcher backlog, classifier failure rate, webhook receiver uptime, cron last-run age, FUB push errors, ZeroBounce credit balance, Smartlead error rate. Operator finds out about stuck dispatcher when sends stop.
- [definite] **No structured logging strategy.** "Audit log" mentioned 3× without spec: destination, format, retention, who reads. Plan §Compliance prohibits PII in Datadog/Sentry, so destination is load-bearing.
- [definite] **No alerting hierarchy.** Resend ops emails are the only primitive. No severity model, escalation, rate-limit (50 single-complaint reviews at 3am = 50 emails).
- [definite] **No cost/usage tracking.** Lazer never sees Anthropic spend, ZeroBounce credits, Smartlead overages.
- [definite] **No correlation-ID tracing.** Reply arrives, 4h later FUB has no record — no way to trace what happened.

### Spec drift / nice-to-have

- [definite] **No campaign preview / dry run flow.** Operator clicks Launch on 100 sends with no preview of: total emails, mailboxes used, time-to-complete, footer preview, List-Unsub URL preview, raw-MIME of one outbound message. Difference between "noticed the typo" and "oh god I just mailed the wrong list."
- [definite] **No FUB pipeline/stage discovery.** Plan has settings field but never says: hand-typed IDs (config-error vector) vs API-populated dropdown.
- [definite] **No per-campaign reply-routing override UI.** PRD §5.6 specifies, plan §Settings #9 mentions, no Phase 2 task builds it.
- [definite] **No initial email-template library.** Lazer doesn't have cold-mortgage copy yet. 5–10 vetted compliant template starters with placeholders is something Lazer assumes is included. Plan: silent.
- [definite] **No "exclude FUB-active contacts" check at list upload.** Cold-mailing someone already in FUB pipeline = brand-damaging mistake.
- [definite] **No analytics layer.** Reply rate per mailbox/domain/campaign/template. Data is captured; no aggregation.
- [definite] **No A/B testing infrastructure.** Subject line / body / send-time variants. Cold-outreach optimization 101.
- [definite] **No anti-thread-hijack rule.** Reply matching falls back to "most-recent send to lead" — can attach to wrong campaign. Add confidence threshold + manual-review fallback.
- [definite] **Bounce categorization is binary.** No soft bounce, autoresponder-not-OOO (parental leave, role change), MX failure vs mailbox-full.
- [definite] **Mock-data → real-data migration in React app unspecified.** Connect CRM `CRMContext` reads `mockData.ts`; plan never says how it swaps to async Supabase queries (loading/error states, optimistic updates, real-time subscriptions, whether to adopt `@tanstack/react-query`).
- [likely] **No security review / pen-test gate.** Lending vertical with PII calls for at least internal security review before Lazer onboards. Plan: silent.
- [likely] **No webhook-receiver hardening beyond signature.** No rate limiting, no IP allowlist for Smartlead origin, no replay-window enforcement. `/api/list-unsubscribe` is publicly POSTable — bot flood spikes `suppressions` writes.
- [likely] **Audit log immutability unspecified.** "Audit log row for every action" — but who can write, can a Supabase admin DELETE, append-only via DB policy or convention?

## 8. Meta-review notes

- **Multi-source agreement (very high confidence):** Phase 1 timeline fictional (3 lenses); FUB normalizer over-merges (2 lenses); webhook race conditions (2 lenses); NMLS footer punted (2 lenses); watchdog hard-rule chain bug (2 lenses); HMAC token unrevocable (2 lenses); Smartlead/Mailforge SPOF (3 lenses); classifier mis-classification cascade (2 lenses).
- **Codex unavailable** — `codex` CLI not on PATH, fell back to Claude-only per skill design. Plan-doc reviews are Claude-only by default anyway.
- **Confidence calibration:** GAPS lens flagged many things [definite] MISSING that are arguably [likely] (e.g., "no analytics layer" is a v2-after thing, not a v1 blocker). Kept as flagged to be conservative; labelled severity in groupings above.
- **Where the audit might be wrong:** The pricing recommendation assumes Lazer is a typical small lender with cost sensitivity. If Lazer is well-capitalized or has investor pressure to ship fast, the build fee could anchor higher ($120–150k). The "Mailforge deplatform 5–10% probability" is a guess based on Google's reseller-deplatform history; could be lower if Mailforge has a strong reseller agreement. Verify these in /research-web pass.

## 9. Actionable next steps

In order:

1. **Stop everything until client signs PRD-amendment.** Architecture replacement (subdomains→burners, Resend→Smartlead) needs written sign-off. Phase 0.5 kickoff doc must redline the PRD's v1 ship criteria so Lazer knows what changed.
2. **Author 8–10 pseudocode correctness fixes BEFORE writing code.** Listed in §1 above. Each is 1–3 days to fix in plan; cheap. Becomes 1–3 weeks each as production incident.
3. **Add hard launch gate to plan.** No production sends until: List-Unsub headers verified by raw MIME + DMARC RUA flowing + watchdog tested + state-licensing footer with `legal_approved=true` + suppression-list seed imported + auth/RBAC functional.
4. **Add 6 missing Phase 0/1 tasks:** auth + RBAC + suppression-import + CCPA delete-flow + OPS-RUNBOOK + system health dashboard.
5. **Write Termination & SLA addendum** before signing the engagement letter. Owns-the-code clause, data-export deliverable, 30-day handoff terms, support-response SLAs.
6. **Quote phased fixed-bid: $75k–$95k for Phase 0+1, Phase 2 re-quoted after.** Plus $1,800/mo flat retainer including passthroughs. Plus $25k–$35k for v2 (Phase 3+4).
7. **Run `/research-web` to validate:** Smartlead lending TOS history, Mailforge deplatform risk in 2024–2026, NMLS+state cold-mail compliance specifics, FUB API breakage history, custom-build market rates for residential mortgage tooling.

---

*End of audit. Total findings across 4 lenses: ~100. Critical / must-fix-before-code: ~15. Critical / contractual-paperwork: ~8. Compliance/regulatory: ~7. Gaps blocking launch: ~5. Schedule reality: 14–20 dev-weeks vs implicit single quarter.*
