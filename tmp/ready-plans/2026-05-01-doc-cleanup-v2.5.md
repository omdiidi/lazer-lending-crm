# Plan: Documentation Cleanup v2.5 — Lazer Lending CRM

**Date:** 2026-05-01
**Author:** Claude (driving on behalf of IntegrateAPI/Nick Pardon)
**Trigger:** Codex-review feasibility audit (`tmp/review-notes/2026-05-01-codex-feasibility-audit.md`) + research validation (`tmp/research/2026-05-01-feasibility-validation.md`)
**Status:** Approved (user explicit "do what is truly best, keep it realistic and honest")
**Goal:** Every line of `docs/lazer-lending/` verifiable from PRD outcome contract, audit findings, or research citations. No aspirational claims. No pseudocode that doesn't work. No costs that aren't sourced. End state: a fresh Claude session can rebuild from these docs with no other context.

---

## Source of truth hierarchy

When two docs disagree, this is the resolution order:

1. **`docs/lazer-lending/PRD.md`** — original outcome contract. Cannot be rewritten retroactively. Where reality contradicts PRD, the resolution is `docs/lazer-lending/PRD-AMENDMENT.md` for client signoff (new doc).
2. **`tmp/research/2026-05-01-feasibility-validation.md`** — externally verified facts (~80 sources, mostly 2024–2026). Authoritative on AUP, pricing, compliance specifics, vendor reliability.
3. **`tmp/review-notes/2026-05-01-codex-feasibility-audit.md`** — internal audit findings (4 lens agents). Authoritative on plan correctness bugs and scope drift.
4. **`CODEBASE_ANALYSIS.md`** — Connect CRM's own self-audit. Authoritative on what code exists in the scaffold today.
5. **First-principles reasoning** — last resort, only when no source above answers and the claim is necessary.

Any sentence in `docs/lazer-lending/*.md` that can't be traced to one of the above must either be removed or marked as `[TODO: needs verification]`.

## Scope

### Files to update (existing)

| File | Lines today | Change scope |
|---|---|---|
| `docs/lazer-lending/PLAN.md` | 1,775 | ~25 surgical edits + new sections |
| `docs/lazer-lending/BRIEF-email-architecture.md` | 229 | 4 decision updates + table refreshes |
| `docs/lazer-lending/PLAN-REVIEW-NOTES.md` | 99 | Append v2 review findings |
| `docs/lazer-lending/README.md` | 76 | Update index, add new docs |

### Files to create (new)

| File | Purpose |
|---|---|
| `docs/lazer-lending/PRD-AMENDMENT.md` | Redlined PRD changes for Lazer signoff (subdomain→burner, Resend→Smartlead, etc.) |
| `docs/lazer-lending/COMPLIANCE.md` | Federal + state compliance bible. Per-state footer table. CA § 17529.5 risk. CCPA delete flow. NMLS specifics. Attorney engagement. |
| `docs/lazer-lending/CHARGE-ABILITY.md` | Pricing structure, termination clause, SLA, engagement letter terms |
| `docs/lazer-lending/VENDOR-CONTRACTS.md` | Vendor webhook signing, retry, idempotency, rate limits — filled where research has answers, flagged Phase 0.3 where not |
| `docs/lazer-lending/OPS-RUNBOOK.md` | Skeleton incident-response runbook for the 10 most likely production incidents |
| `docs/lazer-lending/WARMUP-CAPABILITY-MAP.md` | PRD §5.2 expectations → Smartlead capabilities (table) |
| `docs/lazer-lending/CONNECT-CRM-AUDIT-DELTA.md` | Phase 0.1 deliverable: walk Connect CRM scaffold vs CODEBASE_ANALYSIS.md, document drift, list concrete file-path anchors |

### Files NOT to touch

- `docs/lazer-lending/PRD.md` — historical contract artifact. Corrections live in PRD-AMENDMENT.md.
- `CODEBASE_ANALYSIS.md` (root) — Connect CRM's own audit. Reference only.
- All Connect CRM legacy docs in `docs/` (`OVERVIEW.md`, `architecture.md`, `campaigns.md`, etc.) — not Lazer-specific. Reconcile in Phase 0 separately.

---

## File-by-file change spec

### 1. PLAN.md surgery

#### Header / status (lines 1–10)
- Bump status to **v2.5** (incorporates 4-lens audit + research validation, May 2026).
- Add re-review gate: "v2.5 audit complete; another `plan-reviewer` pass required only if vendor-contract questions surface new architecture changes."
- Add line: "Source of truth hierarchy defined in `tmp/ready-plans/2026-05-01-doc-cleanup-v2.5.md`."

#### §Stack — Mailforge pricing fix (lines 12–20)
- Line ~17 (Mailforge mention): change "~$1.67/inbox" to "**$3/inbox** standard tier ($1.67 is volume-discount tier, not applicable at v1 inventory)." Source: research §Q2 finding.

#### §Critical finding (lines 22–26)
- Keep core finding (Connect CRM is mock-only). Add: "Connect CRM's `CRMContext` swap from mock-array reads to async Supabase queries is itself a Phase 1 task (Task 1.0 below) — not 'build the backend' handwave." Source: audit Gaps lens.

#### §Goal (lines 30–38)
- Add bullet: "Per-recipient-state compliance footer assembled dynamically (10+ variants)." Source: research §Q3 NMLS findings.
- Add bullet: "CCPA right-to-delete flow over prospect records (GLBA exemption is data-level not entity-level)." Source: research §Q3 CCPA findings.

#### §Summary (lines 40–55)
- Add to the summary list: "(9) hot-standby mailbox provisioning ($25–85/mo for 5 pre-warmed accounts) converting Mailforge-failure recovery from 7–10 weeks cold to 24–72 hours; (10) auth + RBAC layer for the operator UI (mock AuthContext is currently unimplemented for production); (11) suppression-list seed-import from Lazer's existing FUB/legacy data before campaign #1." Source: audit Gaps lens.

#### §Locked Decisions — add D17–D24 (after line 299)
| # | Decision | Source |
|---|---|---|
| D17 | **Per-state compliance footer is required**, not optional. Minimum 10 state variants (CA, NY, FL, NJ, TX, MA, MD, IL, AZ, CT) plus federal floor. Footer assembled dynamically per recipient state. | Research §Q3 |
| D18 | **Hot-standby mailbox inventory required** at v1 launch: 5 pre-warmed mailboxes from Litemail/EmailAstra/Infraforge ($25–85/mo total). Converts disaster-recovery from 7–10 weeks (cold) to 24–72 hours. | Research §Q2 |
| D19 | **Per-mailbox daily cap is 15–25/day** (down from 20–40/day in original plan). Post-Oct-2025 Google crackdown consensus; reduces trigger probability for tenant-wide suspension. | Research §Q2 |
| D20 | **California mortgage-compliance counsel retained before first send.** § 17529.5 strict-liability ($1k/email private right of action) is the single highest-probability enforcement vector. | Research §Q3 |
| D21 | **Classifier regex pre-filter** for unambiguous opt-out language ("stop", "remove", "unsubscribe", "do not contact", "cease") forces `unsubscribe` classification before LLM call. Each missed opt-out is a potential $53,088 CAN-SPAM violation. | Audit §1 + Research §Q3 |
| D22 | **Stop-on-reply fires on ALL replies at v1**, not just non-low-confidence-negative. The plan's exception was premature optimization; classifier mis-class of positive→neg-low-conf hammers leads. Optimize only after operating data accumulates. | Audit §1 |
| D23 | **Webhook receiver returns 200 immediately after idempotency-INSERT**; LLM classifier + forwarder + FUB push run in deferred async job. Smartlead's at-least-once delivery semantics + 10–30s retry windows make synchronous handlers unsafe. | Audit §1 + Research §Q1 (Smartlead docs require it) |
| D24 | **Smartlead-failover vendor pre-onboarded BEFORE launch**, not "in 2–4 weeks if Smartlead suspends." Saleshandy is the candidate but webhook-signing capability requires direct vendor confirmation. Instantly is disqualified for lending (custom-account approval gate). | Research §Q1 |

#### §Locked Decision 15 — update per-mailbox cap range
- Change "Per-mailbox daily cap range is 20–40, default 30" → "**15–25/day, default 20**" per D19. Same source.

#### §Pseudocode fixes (lines 944–1100)

**Fix 1: `claimSendSlot` slot-leak on Smartlead error** — add a compensating decrement in caller code, OR refactor to two-phase: claim slot as "reserved" → POST to Smartlead → on success update to "sent", on error rollback. Add comment block explaining the race. Source: audit §1.

**Fix 2: `claimSendSlot` ORDER BY (random())** — note that Postgres can reorder `random()` evaluation; document the actual semantics rather than the intended one. Source: audit §1.

**Fix 3: `runMailboxWatchdog` else-if chain** — restructure so the hard-complaint rule fires INDEPENDENTLY of the rate path:
```typescript
// Rate path (Wilson lower-bound)
if (bounceLower > bounceThreshold) {
  await pauseMailbox(r.mailbox_id, { reason: 'bounce_threshold', bounceLower });
  await sendOpsAlert(...);
} else if (complaintLower > complaintThreshold) {
  await pauseMailbox(r.mailbox_id, { reason: 'complaint_threshold', complaintLower });
  await sendOpsAlert(...);
}

// Hard rule — fires INDEPENDENTLY, even if rate path already paused.
if (r.complained >= 1) {
  await flagMailboxForReview(r.mailbox_id, { reason: 'single_complaint_review' });
  await sendOpsAlert({ kind: 'mailbox_complaint_review', ... });
}
```
Source: audit §1.

**Fix 4: `runMailboxWatchdog` add explicit dormancy comment** — at v1 volume of 20/mailbox/day with `min_attempted=10`, the Wilson rate path effectively requires ~400 sends/24h to fire. Document this honestly: "Until ~400 sends/mailbox/24h, the rate path is mathematically dormant; the hard-complaint rule is the primary signal." Source: audit §1.

**Fix 5: `classifyReply` — add regex pre-filter** before LLM call:
```typescript
const OPT_OUT_PATTERNS = /\b(stop|remove|unsubscribe|do not (contact|email)|cease|opt[\s-]?out)\b/i;
if (OPT_OUT_PATTERNS.test(reply.body_text)) {
  return {
    label: 'unsubscribe',
    confidence: 1.0,
    rationale: 'regex_optout_match',
    language: lang,
    requires_human_review: false,
  };
}
// ... existing LLM call follows
```
Source: audit §1, D21.

**Fix 6: `applyClassification` — stop-on-reply fires on ALL replies at v1**:
```typescript
async function applyClassification(reply: Reply, c: Classification | null) {
  // ... existing unsubscribe handling ...

  // v1: stop on ANY reply except confirmed unsubscribe-already-suppressed.
  // Optimize after we have operating data showing classifier accuracy.
  await stopOnReply.cancelFutureSteps(reply.lead_id, reply.campaign_id);
}
```
Source: audit §1, D22.

**Fix 7: Webhook receiver — split sync from async**. Document the new architecture in §Webhook Idempotency:
1. Sync path: signature verify → idempotency INSERT (`processing` state) → 200 OK to Smartlead.
2. Async job (Supabase Edge Function via `pg_cron` polling new `webhook_events` rows): persist reply → redact PII → classify (LLM, 5s timeout) → suppression insert → stop-on-reply → forwarder → FUB push → mark `processed_at`.
Source: audit §1, D23.

**Fix 8: `verifyUnsubToken` — add timing-safe compare + previous-secret support**:
```typescript
import { timingSafeEqual } from 'node:crypto';

function verifyUnsubToken(token: string): UnsubPayload | null {
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const expectedSig = hmac(LIST_UNSUB_TOKEN_SECRET, payloadB64);
  if (timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) {
    /* current secret matched */
  } else if (LIST_UNSUB_TOKEN_SECRET_PREVIOUS) {
    const prevSig = hmac(LIST_UNSUB_TOKEN_SECRET_PREVIOUS, payloadB64);
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(prevSig, 'hex'))) return null;
  } else {
    return null;
  }

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  if (payload.expiry_unix < Date.now() / 1000) return null;
  return payload;
}
```
Add `LIST_UNSUB_TOKEN_SECRET_PREVIOUS` to env vars. Document rotation procedure: set PREVIOUS to the current secret, generate new SECRET, deploy, leave PREVIOUS in place for at least 180 days (current TTL). Source: audit §1.

**Fix 9: `email_normalized` domain-conditional Gmail-dot rule**:
```typescript
function normalizeEmail(email: string): string {
  const [local, domain] = email.toLowerCase().split('@');
  let normalizedLocal = local.split('+')[0]; // strip plus-tag for all
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    normalizedLocal = normalizedLocal.replace(/\./g, ''); // dot-collapse Gmail only
  }
  return `${normalizedLocal}@${domain}`;
}
```
Source: audit §1, multiple agents flagged.

**Fix 10: Daily-cap reset — single hourly job pattern**. Replace per-mailbox-TZ cron with one hourly job that resets any mailbox where `local_midnight > last_reset_at`. Add health check: alert if any mailbox `last_reset_at < (now - 25h in mailbox local TZ)`. Source: audit §1.

#### §Compliance & Data Retention (lines 600–640)
- Replace existing content with: "**Compliance is governed by `docs/lazer-lending/COMPLIANCE.md`** as source of truth. The bullets below are pointers; the doc is authoritative."
- Keep brief pointers to: federal CAN-SPAM, Reg Z trigger terms, Reg N record retention 24mo, Reg B 25mo for prescreened materials, NMLS/SAFE Act, per-state requirements, CCPA right-to-delete, California § 17529.5 top risk.
- Remove: any TCPA-applies-to-email assertion (corrected per research §Q3 — TCPA is calls/texts only).
- Remove: GLBA-blanket-exempts-CCPA assertion (corrected — data-level exemption only).

#### §Webhook Idempotency Strategy (lines 641–670)
- Replace synchronous-handler description with the deferred-processing pattern from Fix 7 above.
- Cite Smartlead's own help-center article requiring idempotency: https://helpcenter.smartlead.ai/en/articles/417-how-to-resolve-webhook-failures.

#### §Pacing & Concurrency (lines 672–690)
- Update per-mailbox cap to 15–25/day per D19.
- Add: "Wilson watchdog rate path is mathematically dormant below ~400 sends/mailbox/24h; the hard-complaint rule is the primary signal at v1 volume. Documented honestly per audit §1."

#### §Domain & Mailbox State Machines (lines 692–736)
- Add `standby` state to mailbox state machine: `provisioning → dns_pending → oauth_pending → verifying → ready → standby`. Standby = warmed but not assigned to live pool; activated within 24–72h on Mailforge failure.
- Update domain state machine to track `expires_at` field with 30-day expiry alarm.

#### §Phase 0 task list (lines 1234–1278)

Update existing tasks:
- **0.1**: change DoD — `CONNECT-CRM-AUDIT-DELTA.md` is now produced as part of the v2.5 doc cleanup; Phase 0 task becomes verifying it against live code.
- **0.3**: change DoD — `VENDOR-CONTRACTS.md` is scaffolded in v2.5 doc cleanup; Phase 0 task is verifying webhook signing schemes by sending real test events. Also add: ask Mailforge directly about Workspace tenant isolation (research §Q2 open question).
- **0.5**: update list of OQs to close (the original 13 were superseded by the audit; new list in Open Questions section).

Add new tasks:
- **0.8: California mortgage-compliance counsel engagement.** DoD: signed engagement letter with CA counsel; first review of cold-mail templates booked. Per D20.
- **0.9: Hot-standby mailbox provisioning.** DoD: 5 pre-warmed mailboxes provisioned with at least 4 weeks of warmup, ready to OAuth into Smartlead within 24–72h. Per D18.
- **0.10: Suppression-list seed import.** DoD: import of Lazer's existing FUB/legacy unsubscribe + complaint records into `suppressions` table BEFORE first campaign. Per audit Gaps lens.

#### §Phase 1 task list (lines 1280–1387)

Add new tasks at the start:
- **1.0: Authentication + RBAC.** Build Supabase Auth integration replacing Connect CRM's mock AuthContext; add roles `admin`, `operator`, `viewer`. DoD: real sign-in, password reset, role-based access enforced via Supabase RLS on PII-bearing tables (`replies`, `audit_log`, `suppressions`).
- **1.0a: Mock-data → real-data migration in `CRMContext`.** Swap mock-array reads to async Supabase queries; adopt `@tanstack/react-query` (already installed). DoD: Connect CRM's existing screens load from Supabase; loading + error states; no `mockData.ts` reads in production paths.
- **1.0b: CCPA right-to-delete flow.** Operator can locate-and-delete a recipient's data across `leads`, `sends`, `replies`, `conversations`, `webhook_events`, `audit_log`. 45-day SLA. DoD: end-to-end test of a deletion request including audit-log preservation of the deletion event.
- **1.0c: Per-state compliance footer engine.** Footer assembly per recipient state with 10+ variants (CA, NY, FL, NJ, TX, MA, MD, IL, AZ, CT) + federal floor. Reads state from Lead.address_state. Compliance review flag on every campaign before send. DoD: outbound MIME inspection confirms correct per-recipient-state footer; CA recipients receive DRE/DFPI license disclosure; TX recipients receive 12pt-minimum NMLS ID; NY recipients receive "Registered Mortgage Broker — NYS DFS" legend.
- **1.0d: System health dashboard.** Operator-facing aggregated view: dispatcher backlog depth, classifier failure rate, webhook receiver uptime, cron last-run age, FUB push error rate, ZeroBounce credit balance, Smartlead 4xx/5xx error rate, DMARC RUA last-received age per burner.
- **1.0e: Campaign preview / dry-run flow.** Operator sees pre-send: total emails, mailboxes used, time-to-complete, footer preview, List-Unsub URL preview, raw-MIME preview of one outbound message — all before clicking Launch.
- **1.0f: Hot-standby activation procedure.** Operational runbook + test drill: simulate Mailforge failure, OAuth standby mailboxes into Smartlead, switch active sending pool. Documented in OPS-RUNBOOK.md.

Update existing tasks:
- **1.5**: Restate dispatcher with the corrected pseudocode from Fix 1 + Fix 2.
- **1.8**: Restate webhook receiver with deferred-processing pattern (Fix 7).
- **1.9**: List-Unsub correctness (Fix 8 — timing-safe compare + previous-secret rotation support).
- **1.11**: Watchdog — restate with Fix 3 (independent hard rule) + Fix 4 (dormancy comment).

Update **Phase 1 acceptance**: explicitly include v1.SC1–SC11 PLUS new acceptance: (a) auth + RBAC enforced, (b) per-state footer verified by raw MIME on outbound message to each of CA/NY/TX/NJ/FL test recipients, (c) suppression seed-imported and first campaign cross-checked against existing FUB unsubscribes, (d) hot-standby mailboxes provisioned and warmup-ready, (e) CCPA delete-flow tested end-to-end.

Add **Hard launch gate** subsection: "NO production sends until ALL of the following are green: Tasks 1.0 (auth), 1.0c (per-state footer with `legal_approved=true` per template), 1.9 (List-Unsub headers verified by raw MIME), 1.11 (watchdog tested), 1.12a (DMARC RUA flowing), and Task 0.10 (suppression seed-imported). Compliance-counsel sign-off on copy + footers before each new campaign template."

#### §Phase 2 task list (lines 1389–1426)

Add new tasks:
- **2.1a: Author classifier eval set.** 100+ labeled lending replies covering positive/neutral/OOO/unsubscribe/negative + Spanish + edge cases. Owned by Lazer team in Phase 0.5; the eval set checked into the repo under `tests/classifier-eval/`. Required before Task 2.2 acceptance.
- **2.3: Verify IMAP forwarder feasibility BEFORE locking** — Smartlead may not expose IMAP credentials for managed Workspace mailboxes (Workspace typically uses OAuth). Smoke-test in Phase 0.3 (vendor contracts). If infeasible, fallback to Resend forwarder with PII-redaction caveat.

Update existing tasks:
- **2.2**: Add the regex pre-filter (Fix 5) as part of the classifier flow.
- **2.7**: Restate stop-on-reply per Fix 6 — fires on ALL replies at v1.

#### §Settings Panel Scope (lines 1480–1508)
- Add: per-state footer editor (10+ variants, by ISO state code).
- Add: RBAC roles UI (admin/operator/viewer assignment).
- Add: CCPA delete-flow trigger (operator can run a delete against an email or lead_id).
- Add: hot-standby pool view (read-only — show standby mailbox count + warmup progress).
- Add: campaign preview / dry-run toggle.
- Add: compliance-counsel approval status per campaign template.

#### §Environment Variables (lines 1509–1565)
Add:
```
LIST_UNSUB_TOKEN_SECRET_PREVIOUS=  # for rotation; previous secret accepted during transition window
COMPLIANCE_FOOTER_VERSION=v1       # bump on per-state footer template changes; logged in audit_log per send
HOT_STANDBY_VENDOR=litemail        # litemail | emailastra | infraforge
HOT_STANDBY_API_KEY=
HOT_STANDBY_OAUTH_CALLBACK=
RBAC_DEFAULT_ROLE=viewer           # safe default
CCPA_DELETE_SLA_DAYS=45            # CA Civ Code § 1798.105
```

#### §Final Validation Checklist (lines 1683–1719)
Replace + expand:
- [ ] Phase 0 audit completed and PLAN.md updated with concrete Connect CRM paths from CONNECT-CRM-AUDIT-DELTA.md.
- [ ] No `[path TBD]` markers remain after Phase 0.
- [ ] Plan re-reviewed by `plan-reviewer` after Phase 0 completes (only required if vendor-contract findings change architecture).
- [ ] All Phase-1-blocker Open Questions answered before Phase 1.
- [ ] All v1 success criteria verified manually before declaring v1 done.
- [ ] **CA mortgage-compliance counsel engaged before first send.**
- [ ] **Suppression-list seed-imported from FUB/legacy before first campaign.**
- [ ] **Auth + RBAC enforced on all PII-bearing tables (`replies`, `audit_log`, `suppressions`, `leads`).**
- [ ] **CCPA delete-flow tested end-to-end against a known recipient.**
- [ ] Resend transactional sends originate only from `notify.lazerlending.com`.
- [ ] No cold campaign send originates from `lazerlending.com` (root or any brand-root subdomain).
- [ ] List-Unsubscribe `<https://...>` AND `<mailto:...>` AND `List-Unsubscribe-Post: List-Unsubscribe=One-Click` confirmed by raw-MIME inspection.
- [ ] List-Unsubscribe endpoint idempotent + uses `crypto.timingSafeEqual` for HMAC verify + supports `LIST_UNSUB_TOKEN_SECRET_PREVIOUS` rotation.
- [ ] List-Unsubscribe endpoint bypasses CSRF and is unauthenticated.
- [ ] **Per-state compliance footer assembled dynamically; raw-MIME inspection confirms correct license disclosure for CA/NY/TX/NJ/FL test recipients.**
- [ ] DMARC `p=none` + `rua` configured on every burner at launch; aggregate-report aggregator receiving reports + alert on `0 reports in 7d`.
- [ ] `dmarc-ramp-evaluator` job functional.
- [ ] All vendor API keys are in `.env`, never in code or fixtures.
- [ ] Smartlead webhook signature verification rejects unsigned payloads + alert on `0 events accepted in 60min during business hours`.
- [ ] **Webhook receiver uses deferred-processing pattern: 200 OK after idempotency INSERT, work in async job.**
- [ ] Webhook idempotency by `(provider, external_event_id)` enforced.
- [ ] Suppression list checked at enqueue AND inside dispatcher claim transaction.
- [ ] Daily-cap reset job runs hourly (not per-TZ-cron) and zeroes `today_sent_count` when local-midnight has passed.
- [ ] Watchdog uses Wilson lower-bound + **independent** hard-complaint escape hatch.
- [ ] Daily reconcile job runs and corrects vs Smartlead truth.
- [ ] `email_normalized` populated and unique-indexed; **Gmail dot-collapse applied only when domain ∈ {gmail.com, googlemail.com}.**
- [ ] Hard bounce → global suppression + future-step cancellation verified.
- [ ] **Stop-on-reply fires on ALL replies at v1 (not just non-low-conf-negative).**
- [ ] Classifier failover (timeout/error → null + flag) verified.
- [ ] **Classifier regex pre-filter for opt-out language tested before LLM call.**
- [ ] Non-English/Spanish replies routed to human review (not auto-FUB).
- [ ] LLM provider has no-train DPA (per OQ9).
- [ ] PII redactor runs before LLM input + has its own eval set.
- [ ] Reply body retention window enforced by background job.
- [ ] **Hot-standby mailboxes provisioned and warmup-ready before launch.**
- [ ] **System health dashboard live and showing all 9+ metrics.**
- [ ] **Campaign preview / dry-run mandatory before launching any new campaign.**

#### §Deprecated / Removed Code (lines 1720–1728)
- Remove: "Connect CRM's Resend-as-cold-sender code path (if present) is removed" — confirmed by audit Gaps lens that this path doesn't exist; line is misleading.
- Remove: "Connect CRM's existing warmup module is removed" — same; doesn't exist per CODEBASE_ANALYSIS.md.
- Keep: "subdomain-rotation-on-`lazerlending.com` plumbing (if present)" — still appropriate caveat.

#### §Anti-Patterns to Avoid (lines 1729–1752)
Add new anti-patterns:
- Trusting GLBA blanket-exemption for CCPA on prospect records (it's data-level only).
- Single global compliance footer (must be per-state).
- Skipping classifier regex pre-filter for opt-out language.
- Treating Wilson watchdog as primary signal at v1 volume (it's dormant; hard-rule is primary).
- Synchronous webhook handlers that include LLM calls (Smartlead retries; double-process risk).
- Per-mailbox-TZ cron job for daily-cap reset (hourly job is simpler and self-recovering).
- HMAC token verification with `===` (must be timing-safe).
- Apply Gmail dot-collapse globally (over-merges Outlook/Yahoo addresses).

#### §Confidence Score (lines 1753+)
- Recalibrate: was 7/10 with "9/10 after Phase 0." Now: **8/10 baseline, but ONLY if v2.5 corrections applied AND realistic 14–20 dev-week timeline accepted AND CA compliance counsel engaged.** Otherwise drop to 5/10.
- Add new section: "**Schedule reality**" — explicit dev-weeks per phase per audit Engineering Effort findings:
  - Phase 0: 5–10 working days
  - Phase 1: 8–12 weeks single FT engineer with Claude assistance
  - Phase 2: 3–5 weeks
  - Total: 14–20 weeks of dev-time + 5-week real-time floor for warmup
  - Phase 3 (v2): not pre-scheduled; 2–3 weeks when triggered
  - Phase 4 (v2): not pre-scheduled; 1–2 weeks when triggered

### 2. BRIEF-email-architecture.md updates

#### D3 — Workspace inventory pricing (~line 110)
- Change "$1.67–$3 retail" → "$3/mailbox/month standard tier ($1.67 is volume-discount tier, requires 50+ mailboxes — not applicable at v1 inventory of 5–10)."

#### Add D8 + D9 + D10 (after D7 ~line 187)
- **D8: Hot-standby mailbox provisioning required.** 5 pre-warmed mailboxes from independent vendor (Litemail/EmailAstra/Infraforge) at $25–85/mo. Converts Mailforge-failure recovery from 7–10 weeks (cold) to 24–72 hours.
- **D9: Per-mailbox cap revised to 15–25/day** (down from 25–40). Post-Oct-2025 Google crackdown consensus.
- **D10: California mortgage-compliance counsel retained before first send.** § 17529.5 strict-liability ($1k/email) is highest-probability enforcement vector.

#### Volume math table (~line 50)
Recompute with cap=20:
- 100/day: 5 mailboxes × 20/day = 100. 2 burner domains × 2.5 mailboxes per (round to 3 burners × 2 mailboxes = 6 mailboxes covers 120/day).
- 300/day: 15 mailboxes (still feasible at 5–7 burners × 2–3 mailboxes).
- 1000/day: ~50 mailboxes across ~17 burners.

#### Cost floor table (~line 60)
- Mailforge: $25–30/mo (5–10 mbx at $3/mbx)
- Hot-standby: $25–85/mo (NEW LINE ITEM)
- Total revised: ~$120–160/mo at v1 (was $90–120).

#### Rejected Alternatives (~line 188)
- Update Instantly entry: "operator-reported reputation degradation post-2024 + **explicit AUP gating of lending behind custom-account approval (verified May 2026 against https://instantly.ai/instantly-sending-policy)**. Disqualified as Smartlead failover for the lending vertical."

#### Direction (~line 218)
- Add to direction paragraph: "Hot-standby mailbox inventory provisioned at launch. Per-state compliance footer engine ships in Phase 1. CA compliance counsel engaged before first send."

### 3. PLAN-REVIEW-NOTES.md updates

Append section:

```
## v2 Review (2026-05-01) — 4-Lens Audit + Research Validation

Driven by `tmp/review-notes/2026-05-01-codex-feasibility-audit.md` + `tmp/research/2026-05-01-feasibility-validation.md`.

[~30 row table: each finding | severity | resolution location in PLAN.md or new doc]
```

### 4. README.md updates

Update the read-this-first order to include all new docs in priority order:

```
1. PRD.md — original outcome contract (historical)
2. PRD-AMENDMENT.md — what's actually being built (LAZER MUST SIGN)
3. BRIEF-email-architecture.md — locked email-layer decisions
4. PLAN.md — implementer-ready plan v2.5
5. COMPLIANCE.md — federal + state compliance specifics (READ BEFORE FIRST SEND)
6. CHARGE-ABILITY.md — pricing structure + termination clause
7. VENDOR-CONTRACTS.md — vendor webhook + retry contracts
8. WARMUP-CAPABILITY-MAP.md — Smartlead warmup capability map
9. CONNECT-CRM-AUDIT-DELTA.md — what Connect CRM has vs what we're adding
10. OPS-RUNBOOK.md — incident response procedures
11. PLAN-REVIEW-NOTES.md — review history (latest: v2 audit)
```

Update repo layout, status note ("v2.5 incorporates audit + research validation"), and "How to start the build" to point at PRD-AMENDMENT signoff and Phase 0.5 client kickoff.

---

## New file specifications

### PRD-AMENDMENT.md

Purpose: redlined PRD changes for client signoff. Layout:

- Header: "**This document amends `PRD.md`**. Lazer Lending and IntegrateAPI sign below to acknowledge the architecture-replacement was made for verified reasons (Gmail Nov 2025 enforcement, vendor-AUP reality, deliverability research) and that the seven core outcomes are preserved."
- Table: Original PRD spec | Replacement | Reasoning + source
  - Subdomain rotation on lazerlending.com → Burner-domain pool (D1)
  - Resend cold sending → Smartlead Pro (D2)
  - Torched-root detection (UI + alert flow) → Routine inventory rotation
  - Specific line: "Lazer can warm 3 subdomains on lazerlending.com" → "Lazer can warm N burner-domain mailboxes (default 5, target 5–10 across 2–4 burner domains)."
  - Specific line: "send a 100-email campaign from a warmed subdomain via Resend" → "send a 100-email campaign through Smartlead-managed warmed mailboxes on burner domains."
  - Etc. for all 7 PRD §3 v1 ship criteria.
- Section: New deliverables added since PRD signing — RFC 8058 List-Unsub, DMARC RUA aggregator, per-state compliance footer engine, hot-standby mailbox inventory, CCPA delete-flow, auth/RBAC. Each with reasoning.
- Section: Pricing — references CHARGE-ABILITY.md.
- Signature block.

### COMPLIANCE.md

Source of truth for federal + state compliance. Structure:

- §1 Executive summary: top risk = California § 17529.5; secondary = state AG redlining; CA counsel must be engaged before first send.
- §2 Federal compliance:
  - CAN-SPAM (with corrected $53,088 penalty + § 5(a)(1) sender-identification analysis)
  - Reg Z trigger terms
  - Reg N / MAP Rule 24-month retention
  - FCRA + HBPPA (narrowed scope: only CRA-sold trigger leads)
  - SAFE Act NMLS baseline
- §3 State-by-state table: CA, NY, FL, NJ, TX, MA, MD, IL, AZ, CT — statute, requirement, penalty, citation. Per-state footer addition.
- §4 California § 17529.5 deep-dive: $1k/email strict liability, plaintiff firm activity, SPF/DKIM/DMARC perfection requirement, mitigation.
- §5 TCPA clarification: covers calls/texts only; risk is multi-channel sequences.
- §6 Reg B / ECOA fair-lending: cold-list demographic risk; documentation requirements.
- §7 CCPA right-to-delete: GLBA exemption is data-level not entity-level; 45-day SLA; what data falls under exemption (post-application) vs not (pre-application prospect).
- §8 Default footer template with per-state additions (the one drafted in research §Q3).
- §9 Records-needed-for-AG-subpoena table (10 items).
- §10 Attorney engagement recommendation: CA counsel pre-launch is non-optional.

Cite the research doc + URLs for every claim.

### CHARGE-ABILITY.md

Pricing + commercial structure. Structure:

- §1 Recommended quote: $95k build / $2,200/mo retainer / $28k v2 (or phased: $80k Phase 0+1 + $18k Phase 2 + $2,200/mo + $28k v2 + $25–85/mo standby + CA counsel separately).
- §2 Pricing reasoning with Clutch + Purrweb + Cleveroad market comps.
- §3 Termination clause: Lazer owns code/prompts/data/FUB tokens; IntegrateAPI owns Smartlead account (transferable on 30-day handoff); Mailforge non-transferable.
- §4 SLA: uptime targets, response times, support hours, change management.
- §5 Engagement letter terms: scope cap on retainer (10 hr/mo), overage at $150/hr, 90-day post-launch warranty.
- §6 Upsell paths: rev-share on closed leads (optional), Phase 3+4 v2 features.

### VENDOR-CONTRACTS.md

Webhook + retry + idempotency contracts per vendor. For each:
- API URL + version
- Auth scheme
- Webhook signing scheme (or "verify in Phase 0.3" with specific test plan)
- Retry behavior (at-least-once / exactly-once / unknown)
- Rate limits
- Known incidents / status page
- Failover plan

Vendors: Smartlead, Mailforge, ZeroBounce, FUB, Resend, Anthropic. Mark each row with `[verified]` or `[Phase 0.3 verify]`.

### OPS-RUNBOOK.md

Skeleton incident-response runbook. For each of 10 incidents:
- Symptom (what the operator sees)
- Detection (which alert fires)
- Immediate action (first 5 minutes)
- Diagnosis (next 30 minutes)
- Resolution (path to fix)
- Postmortem (what to log)

Incidents:
1. Single mailbox single-complaint pause
2. Smartlead 429 rate limit
3. Smartlead account suspension
4. Mailforge tenant suspension/deplatform (USE HOT STANDBY)
5. Anthropic API outage > 1hr
6. FUB API breakage (4xx/5xx persistent)
7. DMARC RUA aggregator silent failure (no reports in 7d)
8. Burner domain expiry (DNS goes dark)
9. ZeroBounce credit exhaustion
10. State AG subpoena response

### WARMUP-CAPABILITY-MAP.md

Table: PRD §5.2 expectation | Smartlead capability | Verification source | Gap (yes/no)

Items from PRD §5.2:
- "Real warmup network (not sending into a void)" → Smartlead's bundled warmup — verified
- "Daily ramp schedule" → Smartlead Auto-warmup — verified
- "Simulated engagement: opens, replies, marking as important, moving out of spam" → Smartlead bundled — partial verification
- "Spam recovery actions" → Smartlead bundled — partial verification
- "Per-subdomain warmup state tracking with hard block" → CRM-side state machine + Smartlead status
- "Ongoing low-volume warmup traffic even after going live" → Smartlead bundled — verified

For each verified-via-Smartlead row, link to Smartlead doc page.

### CONNECT-CRM-AUDIT-DELTA.md

Phase 0.1 deliverable, produced now:
- Walk Connect CRM file tree at root (top-level: package.json, vite.config.ts, src/, supabase/, mcp-server/).
- Compare to CODEBASE_ANALYSIS.md claims.
- For each anchor in PLAN.md that says `[path TBD Phase 0]`, fill in the actual path:
  - Lead model: `src/types/crm.ts` — `Lead` interface
  - Mock data: `src/data/mockData.ts` — `mockLeads`, etc.
  - State management: `src/contexts/CRMContext.tsx`, `src/contexts/AuthContext.tsx`
  - Routing: `src/App.tsx`
  - Pages: `src/pages/`
  - Existing campaign concepts: `src/types/crm.ts` — `Campaign`, `EmailSequence`, `SequenceStep`, `EmailMessage`
  - Existing UI components: `src/components/`
  - Supabase config: `supabase/config.toml`
  - Supabase migrations: `supabase/migrations/`
  - Supabase functions: `supabase/functions/`
  - MCP server: `mcp-server/` (scope decision: **ignore for v1**, document why)
- Decisions: (a) `mcp-server/` is not load-bearing; ignore for v1, (b) Connect CRM's existing `EmailSequence`/`SequenceStep` types are reusable for Lazer campaigns, (c) `mockData.ts` retained as dev fallback per Phase 1 Task 1.0a.

---

## Execution plan

5 parallel implementation agents, then 3 review passes.

### Implementation agents (all spawned in single message for parallelism)

| Agent | Files | Effort estimate |
|---|---|---|
| 1 | PLAN.md surgery (~25 edits) | Heavy |
| 2 | BRIEF.md + PLAN-REVIEW-NOTES.md + README.md updates | Light |
| 3 | COMPLIANCE.md (new, source-of-truth doc) | Heavy |
| 4 | PRD-AMENDMENT.md + CHARGE-ABILITY.md + VENDOR-CONTRACTS.md (new commercial/contract docs) | Medium |
| 5 | OPS-RUNBOOK.md + WARMUP-CAPABILITY-MAP.md + CONNECT-CRM-AUDIT-DELTA.md (new ops/architecture docs) | Medium |

### Review passes

After implementation agents return, spawn 3 reviewer agents in a single message — each reviews ALL the changed/new docs against:
1. The PRD outcome contract (does it still deliver the 7 outcomes?)
2. The audit findings (every audit finding addressed?)
3. The research validation (every research correction reflected?)
4. Internal consistency (no contradictions across docs?)
5. Completeness for "fresh Claude can rebuild from these docs alone"?

If any reviewer flags a deficiency, fix it before declaring done.

### Final acceptance

End state checklist:
- [ ] No `[TBD Phase 0]` markers remain except where Phase 0.3 vendor smoke-tests are genuinely required.
- [ ] Every doc has a date + version + cross-reference to source-of-truth where relevant.
- [ ] All audit findings traced to a doc edit or explicitly deferred with reason.
- [ ] All research corrections applied.
- [ ] No fabricated claims (no statute citations that don't exist, no pricing without source, no vendor capability claims without verification).
- [ ] PRD-AMENDMENT.md ready for client signature.
- [ ] COMPLIANCE.md is self-contained reference for any future engineer + Lazer's compliance counsel.
- [ ] OPS-RUNBOOK.md is detailed enough that a non-engineer can follow it for the 10 most common incidents.
- [ ] CHARGE-ABILITY.md has actionable pricing IntegrateAPI can defend in a sales conversation.
- [ ] All env vars in PLAN.md align with what's referenced in pseudocode.

---

## Out of scope (explicitly NOT in this cleanup)

- Connect CRM's legacy `docs/` files (OVERVIEW.md, etc.) — separate Phase 0 reconciliation.
- Writing actual implementation code — this is a doc cleanup pass.
- Engaging California compliance counsel (decision-flagged in CHARGE-ABILITY.md; user action).
- Asking Mailforge directly about tenant isolation (decision-flagged in VENDOR-CONTRACTS.md; user action).
- Smartlead account-rep conversation about lending vertical enforcement (decision-flagged; user action).

These are documented as required next-actions in the relevant docs, but aren't doc-cleanup work themselves.

---

## Estimated post-cleanup state

- ~1,800 lines in PLAN.md (was 1,775; ~75 new content + ~50 corrections)
- ~250 lines BRIEF (was 229)
- ~150 lines PLAN-REVIEW-NOTES (was 99)
- ~100 lines README (was 76)
- 7 new docs: PRD-AMENDMENT (~250), COMPLIANCE (~600), CHARGE-ABILITY (~200), VENDOR-CONTRACTS (~250), OPS-RUNBOOK (~400), WARMUP-CAPABILITY-MAP (~80), CONNECT-CRM-AUDIT-DELTA (~300)
- Total: ~4,300 lines of verified, cross-referenced documentation

The repo state is then sufficient for: (a) Lazer to sign the PRD amendment, (b) IntegrateAPI to send a defensible engagement letter, (c) a fresh implementer (or fresh Claude session) to start Phase 0 work without needing context from any of the conversations that produced these docs.
