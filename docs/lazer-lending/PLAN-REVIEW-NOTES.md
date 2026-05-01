# Plan Review — Merged Findings (2026-04-30)

Two independent `plan-reviewer` sub-agents reviewed
`tmp/ready-plans/2026-04-30-lazer-lending-crm-build.md`. This file merges
their findings, deduplicates by topic, and tracks how each was resolved
in the plan. `(both)` = both reviewers raised the issue independently
(higher confidence). `(R1)` / `(R2)` = single-reviewer finding.

## Resolution legend

- **Applied** — change made to the plan.
- **Applied (note)** — change made; specifics noted.
- **Deferred to OQ** — added to Open Questions for client/operator decision.
- **Deferred to Phase 0** — implementer must resolve in Phase 0 before Phase 1.
- **Out of scope** — not changed; rationale below.

## High-impact findings

| # | Finding | Where | Resolution |
|---|---|---|---|
| 1 | `today_sent_count` daily reset is undefined — without a reset job, throttle becomes a lifetime cap. (both) | Dispatcher pseudocode + Mailbox shape + Phase 1 | **Applied.** New `jobs/daily-cap-reset.[ext]` task added; Mailbox gains `timezone` field; reset semantics locked to mailbox-local midnight. |
| 2 | Watchdog math: min-attempted floor of 30 cannot detect a single complaint at 0.1% threshold (1/30 = 3.3% > threshold; 0/30 = 0%). Needs Wilson lower-bound or Bayesian smoothing + "any single hard complaint → human review" escape hatch. (both) | Watchdog pseudocode + Task 1.11 | **Applied.** Min-floor lowered to 10; added Wilson lower-bound formula; added "any 1 spam complaint = mandatory human review queue" rule independent of rate. |
| 3 | `claimSendSlot` race condition — SELECT then UPDATE has TOCTOU gap. Use `SELECT FOR UPDATE SKIP LOCKED` or atomic UPDATE. (both) | Dispatcher pseudocode | **Applied.** Pseudocode rewritten as single atomic UPDATE...RETURNING. |
| 4 | `claimSendSlot` ordering by `today_sent_count ASC` greedily fills lowest-count, not round-robin. Worse during warmup. Need utilization ratio + jitter, or delegate pacing to Smartlead. (both) | Dispatcher pseudocode | **Applied.** Selection uses `today_sent_count::float / daily_cap` (utilization) with random jitter. Inter-send pacing delegated to Smartlead. |
| 5 | Inter-send pacing missing — daily cap alone is insufficient; bursting 30 sends in 60s is a strong spam signal. (both) | Dispatcher / control flow | **Applied.** Locked Decision: pacing is owned by Smartlead per its account configuration; CRM only enforces daily ceiling and concurrency limits. |
| 6 | Suppression check at "claim-slot time" alone leaks queued sends to just-unsubscribed recipients. Check at enqueue AND inside the claim transaction. (both) | Task 1.9, dispatcher | **Applied.** Dispatcher pseudocode now checks suppression inside the same transaction as the slot claim; enqueue-time check added as Task 1.9 sub-step. |
| 7 | List-Unsubscribe one-click `consume(token)` is single-use; Gmail prefetchers POST multiple times → 404 on legitimate retries. Make idempotent. (both) | List-unsub pseudocode + Task 1.9 | **Applied.** Endpoint rewritten as idempotent: re-submits on already-suppressed return 200. |
| 8 | List-Unsubscribe token construction undefined (HMAC vs row); plan must pick one. (both) | List-unsub + Task 1.9 | **Applied.** Locked: stateless HMAC over `(lead_id, campaign_id, mailbox_id, expiry)` keyed with `LIST_UNSUB_TOKEN_SECRET`. No DB row needed. |
| 9 | RFC 8058 dual-header ownership undefined — verify Smartlead emits both `<https://...>` and `<mailto:...>` plus `List-Unsubscribe-Post`. (both) | Gotchas + Task 1.9 | **Applied.** Task 1.9 DoD now requires raw-MIME inspection of an actual Smartlead-dispatched message confirming both headers present. Fallback: inject via Smartlead per-campaign custom-header support. |
| 10 | List-Unsubscribe endpoint must bypass framework CSRF and be unauthenticated. (R2) | List-unsub | **Applied.** Note added to Task 1.9 + pseudocode comment. |
| 11 | Webhook idempotency mechanism undefined → classifier double-runs, double forwards, double FUB pushes. Need `webhook_events` table or per-record `external_event_id` unique constraint. (both) | Tasks 1.8, 3.1, 3.2 | **Applied.** New `webhook_events(provider, external_event_id, processed_at)` table with unique constraint; receiver short-circuits duplicates. New Task 1.8a. |
| 12 | Smartlead webhook signing scheme is critical-path but only listed as "verify before launch." Promote to Phase 0 deliverable. (both) | Phase 0 Task 0.3 | **Applied.** Task 0.3 DoD now includes "document Smartlead webhook signing scheme + retry/idempotency contract" as a smoke-test gate. |
| 13 | Phase 0 audit must include job runner / queue / scheduler / locking / transaction primitives. (both) | Task 0.1 DoD | **Applied.** DoD list extended with these explicit items. |
| 14 | Hard bounce should suppress the address globally and cancel all future-step sends to that lead. (R1) | Reply / dispatch flow | **Applied.** Task 1.8b added: bounce-cascade behavior. |
| 15 | Sequence steps not modeled. Reply→stop-on-future-steps not specified. (R1) | Data Models + Execution flow | **Applied.** New `campaign_steps` table; `Send.step_number` FK; locked: any reply (except `negative` low-conf) cancels queued future-step sends to that lead. |
| 16 | Reply ↔ Send linkage missing — `reply.in_reply_to_send_id` not modeled. (both) | Data Models | **Applied.** Reply gains `in_reply_to_send_id` (nullable, derived from `In-Reply-To`/`References` headers; falls back to most-recent send to that lead). |
| 17 | Conversation/thread state — multiple sends + replies on same lead/mailbox need a thread anchor. (R1) | Data Models | **Applied.** New `conversations(id, lead_id, mailbox_id, thread_id, started_at)` table. Sends and replies link to it. |
| 18 | DMARC aggregate-report (`rua`) receiver not provisioned; ramp from `p=none` to `p=quarantine` is blind without it. (both) | Locked Decisions, Task 1.12 | **Applied.** Domain shape gains `dmarc_rua` field. New Task 1.12a: provision DMARC aggregator (Cloudflare DMARC Management free tier or self-host). Locked Decision D7 explicit ramp policy: `p=none` → 4–6 weeks clean reports → `p=quarantine`. |
| 19 | FUB email dedup must normalize (lowercase, strip plus-tag, Gmail dot-insensitivity). (R2) | Task 3.5 + Lead shape | **Applied.** Lead gains `email_normalized`. FUB lookup uses normalized form. |
| 20 | Classifier failover — on timeout/error, mark `classification=null + classifier_error`, surface in inbox, never auto-push to FUB. (R1) | Classifier pseudocode + Task 3.2 | **Applied.** Pseudocode and DoD updated. |
| 21 | Classifier — "remove me" / "stop calling" text must add to suppression list (currently only RFC 8058 endpoint adds). Spanish-language replies need handling. (R2) | Classifier + Task 3.2 | **Applied.** `classification=unsubscribe` triggers suppression-list insert. Spanish detection added; if non-English and non-Spanish, route to human queue regardless of confidence. |
| 22 | Reply-forward via Resend on `notify.lazerlending.com` creates AUP grey area: prospect reply text travels through Resend domain. Hostile replies could spike Resend complaint rate. (R2) | Phase 3 Task 3.3 | **Deferred to OQ.** Added OQ: "Forward replies via Resend, or via the originating Workspace mailbox's IMAP redirect/forward?" Default to IMAP redirect (avoids Resend AUP exposure). |
| 23 | `sending_pools.mailbox_ids[]` array column → use join table `pool_memberships`. (R1) | Data Models | **Applied.** |
| 24 | Bounce/complaint counters from webhook can drift if events delayed/dropped — need daily reconcile against Smartlead stats API. (R2) | Phase 1 | **Applied.** New Task 1.13: daily reconcile job. |
| 25 | Smartlead 429 / over-limit handling task missing. (R2) | Phase 1 | **Applied.** New Task 1.5a: Smartlead rate-limit handler. |
| 26 | Mailforge provisioning failure/rollback states undefined. (R2) | Task 1.3 | **Applied.** Domain/Mailbox state machines explicit: `provisioning → dns_pending → oauth_pending → verifying → ready` + `failed`. Manual-retry button. |
| 27 | Phase 0 must register 1 burner end-to-end via Mailforge as smoke test. (R1) | Phase 0 | **Applied.** New Task 0.6. |
| 28 | Phase 0 client kickoff — close all OQs blocking Phase 1 ship. (R2) | Phase 0 | **Applied.** New Task 0.5. |
| 29 | Reply table reuse-vs-standalone — Connect CRM may have a messages store. (R1) | Phase 0 | **Deferred to Phase 0.** Audit deliverable already covers data model; explicit note added that replies should reuse existing message store if present. |
| 30 | Auto-rotation domain breach formula undefined. (R2) | Phase 5 | **Applied.** Locked: domain enters cooldown if (a) ≥50% of its mailboxes are paused within 24h, OR (b) aggregate domain complaint rate >0.1% over 7d. |
| 31 | Seed-inbox check timing 2–3 min is too aggressive — placement settles 10–15 min. (R2) | User-visible behavior + Task 4.2 | **Applied.** Latency budget changed to 10–15 min initial check + 30-min retry. |
| 32 | DB engine not locked — watchdog SQL uses Postgres-specific syntax with string interpolation. (R2) | Phase 0 | **Applied.** Task 0.1 DoD requires DB engine identification; pseudocode updated to use parameterized intervals (no string interpolation). |
| 33 | PII / data retention for reply bodies in lending vertical (SSN fragments, income, addresses). LLM provider DPA / no-train. (R2) | Plan | **Applied.** New top-level section "Compliance & Data Retention" added with retention windows, redaction rules, and LLM-provider DPA requirement. |
| 34 | Open Questions should be tagged by gating phase. (R2) | Open Questions | **Applied.** Each OQ tagged `[Phase 1 blocker]` / `[Phase 4 blocker]` / `[post-launch]`. |
| 35 | Phase 2 (3 tasks, all small) collapses into Phase 1. SC1 requires warmup gating which is Phase 2 work. (both) | Phasing | **Applied.** Phase 2 tasks merged into Phase 1 (1.14, 1.15, 1.16). Renumbered remaining phases. |
| 36 | Confidence score: convert "8/10 after Phase 0" into an explicit re-review gate before Phase 1. (R2) | Confidence Score | **Applied.** New gate: "After Phase 0 audit, plan must be re-reviewed by `plan-reviewer` before Phase 1 begins." |
| 37 | Anti-pattern "async/await + callbacks" is stack-specific; Connect CRM stack TBD. (R2) | Anti-Patterns | **Applied.** Phrased as stack-agnostic. |

## Lower-impact / accepted as-is

| # | Finding | Where | Resolution |
|---|---|---|---|
| 38 | Brief D5 ("25–40/day after warmup") vs plan ("default 30, configurable 20–40") off-by-one. (R1) | Locked Decisions / Tech req | **Applied.** Plan widens to 20–40 (encompasses brief's 25–40); brief's range is a subset of plan's. Note added to Locked Decisions. |
| 39 | Daily reset job timezone choice — UTC vs mailbox-local vs operator-local. (R1) | Mailbox shape | **Applied.** Locked: mailbox-local timezone, default `America/Phoenix` (Lazer's likely TZ). Per-mailbox overridable. |
| 40 | Reply reclassify (`neutral → positive`) by operator: should it auto-trigger FUB push? (R1) | Task 3.6 | **Applied.** Yes — same dedup logic as auto-classify path. Task 3.6 DoD updated. |
| 41 | OQ-7 (Smartlead outage contingency) — pre-wire Saleshandy backup or accept downtime? (R1) | Open Questions | **Deferred to OQ.** Default per plan: accept temporary downtime; `SendProvider` interface justified by future-proofing only, not active dual-vendor. Tagged as `[post-launch]`. |
| 42 | Settings #4 ZeroBounce policy must be consumed by dispatcher, not just uploader. (R2) | Task 1.6 | **Applied.** DoD updated. |
| 43 | Anti-Patterns referenced async/await — moved to stack-agnostic phrasing. (R2) | Anti-Patterns | **Applied** (covered by #37). |
| 44 | Verified Repo Truths is appropriately minimal. No fact-purity violations found. (R1) | n/a | **Out of scope** — no change needed. |
| 45 | DKIM key rotation policy — Mailforge owns rotation; we detect changes. (R1) | Locked Decisions / DNS health | **Applied.** New gotcha: DNS health check verifies "selector currently signing outgoing mail matches published TXT" rather than a static expected value. |

## Reviewer items intentionally NOT applied

None of the reviewer findings were rejected on substance. All findings either
landed in the plan, became Open Questions for client confirmation, or became
Phase 0 deliverables. The reviewers did not relitigate any locked decision
from the brief.

## Net delta to plan

- 9 new tasks in Phase 0 / Phase 1 (kickoff, smoke-test burner, daily reset,
  rate-limit handler, webhook idempotency, bounce cascade, DMARC aggregator,
  reconcile job, three warmup-merge tasks).
- 4 new sections (Compliance & Data Retention, Webhook Idempotency Strategy,
  Pacing & Concurrency, Domain/Mailbox State Machines).
- 5 new tables / shape changes (`webhook_events`, `campaign_steps`,
  `conversations`, `pool_memberships`, lead `email_normalized`, mailbox
  `timezone`, domain `dmarc_rua` / `registrar` / `owner_entity`, reply
  `in_reply_to_send_id`).
- 3 reworked pseudocode blocks (dispatcher, watchdog, list-unsubscribe).
- 4 new Open Questions, plus phase tagging on existing 10.
- Phase 2 collapsed into Phase 1; subsequent phases renumbered.
- Re-review gate added before Phase 1 starts.

## Next actions

1. Plan v2 saved with all changes applied.
2. Push to GitHub at `https://github.com/omdiidi/lazer-lending-crm`.
3. Implementation deferred per user's instruction; doc-only delivery.
