# Plan v3 Review — Cycles 2 & 3 (2026-05-04 / 2026-05-05)

Convergence trend: cycle 1 → 42 findings, cycle 2 → 10 findings, cycle 3 → 7 findings.
Cycle 3 reviewer assessment: *"The plan is substantively converged — none of these are architectural rethinks."*

## Cycle 2 fixes (10 findings, all applied)

| # | Finding | Resolution |
|---|---|---|
| 1 | Mailbox FSM diagram still said `oauth_pending` | Renamed to `connection_pending`; added `connection_status` enum + new `paused_reason` values |
| 2 | Architecture diagram still said "OAuth to mailboxes" | Replaced with "SMTP/IMAP app password" |
| 3 | Migration FK order documented as `1→3→2→4` (impossible with lex sort) | Reordered files to `_001 send-layer → _002 extend-existing → _003 reply-layer → _004 v2-seed` |
| 4 | Stale `routingRules` reference in `notifyTeamOfReply` pseudocode | Replaced with `campaign.team_email ?? env default` |
| 5 | Midnight race in `EMAIL_SENT` webhook | Added same-day check using `mailbox.last_reset_at AT TIME ZONE m.timezone` |
| 6 | Reconcile job DoD ambiguous on which counter to compare | Clarified: compares `sends WHERE status='sent'` vs Smartlead `unique_sent_count`; does NOT touch `today_enrolled_count` |
| 7 | Legacy `unsubscribes` rows have NULL `email_normalized` | Added one-shot backfill in `_002` migration |
| 8 | `team_email` had no UI edit path | Added to `CampaignBuilderPage.tsx` extension scope |
| 9 | `BLOCKED-AWAITING-CLIENT.md` stale FUB env vars | Updated to `FUB_X_SYSTEM` / `FUB_X_SYSTEM_KEY` / `FUB_DEFAULT_STAGE_NAME` |
| 10 | Architecture cron list still showed deferred jobs | Removed v2 jobs from cron list; added "Deferred to v2:" footer |

## Cycle 3 fixes (7 findings, all applied)

| # | Finding | Severity | Resolution |
|---|---|---|---|
| C3-1 | INSERT into `webhook_events` omits `payload_raw` → sweeper crashes on `JSON.parse(null)` | High | Added `payload_raw` column to INSERT + bind param |
| C3-2 | Task 1.11 referenced `_006` migration but file list only has 4 | High | Updated reference to point at `_003_lazer_reply_layer.sql` |
| C3-3 | Task 2.3 DoD said `routing_rule_id` (cycle 1 dropped it) | High | Changed to `campaigns.team_email` |
| C3-4 | `_002` backfill safe under concurrent writes? | Medium | Added `BEFORE INSERT` trigger that auto-populates `email_normalized` on new rows |
| C3-5 | ZeroBounce JIT inside `FOR UPDATE SKIP LOCKED` holds row lock during HTTP call | Medium | Moved JIT validation BEFORE the slot-claim transaction |
| C3-6 | `fub_person_id` column missing from `replies` schema | Medium | Storage clarified: `leads.fub_id` (canonical person link) + new `replies.fub_event_id` (per-reply audit) |
| C3-7 | Phase 2 task ordering: 2.5b/2.7/2.8 confusing | Low | Added implementation-order note: 2.7 must land before 2.8 goes live |

## Net plan size

- Cycle 1: 923 lines (initial v3) → ~1080 after fixes
- Cycle 2: ~1088 after fixes
- Cycle 3: similar (point-fixes don't grow the plan materially)

## Convergence assessment

By cycle 3 the plan is substantively converged. Remaining findings are mostly cosmetic regressions from earlier fix passes. Cycles 4 and 5 should produce ≤5 findings each, mostly low-severity. If cycle 4 produces a clean (0–2 finding) report, we can short-circuit cycle 5.
