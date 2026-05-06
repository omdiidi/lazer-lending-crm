# Plan v3 Review — Cycles 4 & 5 (2026-05-05)

Final two cycles of the 5-cycle review pass. Convergence trend: cycle 1 → 42, cycle 2 → 10, cycle 3 → 7, cycle 4 → 3, cycle 5 → 3.

## Cycle 4 fixes (3 findings — 1 medium bug, 2 stale references)

| # | Finding | Severity | Resolution |
|---|---|---|---|
| C4-1 | `classifyReplyWithCircuit` compared `circuit.open_at` (Postgres timestamp) directly to `Date.now()` — silently produces NaN, circuit never opens | Med | Wrapped with `new Date(circuit.open_at).getTime()` |
| C4-2 | v1.SC1 still said `oauth_pending` (cycle 2 renamed to `connection_pending`) | Low | Updated SC1 |
| C4-3 | v1.SC2 + codebase-anchors said `suppressions` (cycle 1 dropped that table) | Low | Updated to `unsubscribes` (with `reason='zerobounce'`) |

## Cycle 5 fixes (3 findings — 1 production-outage path, 1 schema drop, 1 checklist)

| # | Finding | Severity | Resolution |
|---|---|---|---|
| C5-1 | Slot leak on Smartlead API failure — `today_enrolled_count` already incremented before `addLeadToCampaign` call; if Smartlead 5xx/network errors, slot permanently leaked | Production-outage path | Wrapped post-slot-claim work in inner try/catch; on failure, decrement `today_enrolled_count` and continue (don't abort batch). Outer catch logs error, doesn't propagate |
| C5-2 | `sends.create` calls omitted `campaign_step_id` despite schema requiring it; Task 2.1 reply-to-send matching breaks without it | Med | Added `campaign_step_id: enrollment.campaign_step_id` to both `sends.create` calls |
| C5-3 | Final checklist said "auto-reregistration deployed" but cycle 1 deferred that to v2 | Low | Changed to "Smartlead webhook gap-alert deployed (auto-reregistration deferred to v2)" |

## Convergence assessment

5 cycles of plan-reviewer complete. Trend is monotonic-decreasing in finding severity:
- Cycle 1: 42 findings (architectural rethinks)
- Cycle 2: 10 findings (doc regressions + 2 substantive)
- Cycle 3: 7 findings (point fixes; reviewer said "substantively converged")
- Cycle 4: 3 findings (1 bug, 2 stale refs; reviewer said "nearly converged")
- Cycle 5: 3 findings (1 production-outage path caught — worth the cycle)

**Final state:** 1091 lines. All show-stoppers caught. Ready for Phase E (re-sync supporting docs) → Phase F (`/implement`).

The plan now has:
- Real codebase grounding (CONNECT-CRM-AUDIT-DELTA cited throughout)
- Correct Smartlead campaign-engine semantics (claim → enroll, not synchronous send)
- Single-source-of-truth `unsubscribes` table with backfill + trigger
- Two-stage classifier with multi-label routing
- Webhook idempotency + sweeper for self-healing
- Watchdog with hard-rule-first restructure
- `today_enrolled_count` ≠ `today_sent_count` separation, with same-day guard
- Slot release on enrollment failure (cycle 5 fix)
- Store-and-notify forwarder via `campaign.team_email`
- FUB push via `/v1/events` with `email_normalized` + stage NAME + `occurredAt = notified_at`
- Connection method = SMTP/IMAP app passwords (scriptable recovery)
- 4 consolidated migrations in lex-order
- 9 settings panels (4 cuts to env-only)
- 3 v2-deferred Edge Functions (dmarc-ramp-evaluator, zerobounce-revalidate, webhook-health-monitor)
- 16 numbered blockers in BLOCKED-AWAITING-CLIENT.md tracking client-input dependencies

Confidence: 8/10 ready for /implement. Climbs to 9/10 after Phase 0.5 client kickoff resolves Phase-1-blocker items in BLOCKED-AWAITING-CLIENT.md.
