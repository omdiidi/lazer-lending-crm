# Plan v3 Review — Cycle 1 (2026-05-04)

3 parallel `plan-reviewer` agents. 42 findings total. Convergence: 1 finding flagged by all 3 (slot-claim semantics), 1 flagged by 2 (suppressions/unsubscribes consolidation).

## Resolution legend
- **Applied** — fix made in plan v3.
- **Applied (deferred to v2)** — task removed from v1; documented as v2.
- **Applied (note)** — fix made; specifics in plan.
- **Deferred to cycle 2+** — small/cosmetic; bigger picture first.
- **Out of scope** — not a plan issue, or anti-pattern of fixing.

## High-impact (apply in cycle 1 fix pass)

| # | Reviewers | Finding | Resolution |
|---|---|---|---|
| 1 | R1#1 + R2#1 + R3#12 (3-way) | `claimMailboxSlotForEnrollment` increments `today_sent_count` at enrollment, but Smartlead dispatches asynchronously. Slots consumed before sends happen → drift. Especially bad on day 1 when same leads block re-enrollment next day. | **Applied.** Separate `today_enrolled_count` (incremented at enrollment, resets at midnight) gates enrollment; `today_sent_count` driven only by confirmed `EMAIL_SENT` webhook. Pseudocode + data model + cap-reset job updated. |
| 2 | R1#12 + R3#7 (2-way) | `suppressions` (new) duplicates existing `unsubscribes` (which has UUID tokens already). Suppression checks would need to query both. Audit-delta itself flagged "or extend". | **Applied.** Extend existing `unsubscribes` table with `reason` enum + `email_normalized` + `source_event_id`. Drop new `suppressions` migration. Single source of truth. |
| 3 | R1#11 | Stop-on-reply only cancels local `sends` rows. Smartlead dispatches autonomously and will still send step 2/3/N to that lead. Need to call Smartlead API to stop progression. | **Applied.** Plan documents `PATCH /campaigns/{id}/leads/{id}` (or `LEAD_CATEGORY_UPDATED` mark) as required. Sandbox verification item added. Task 2.7 DoD updated. |
| 4 | R1#2 + R2#10 | No rollback path for partial Smartlead enrollment failure (G2 silent drops + activation mid-flight). | **Applied.** Capture `smartlead_lead_id` per send from add-leads response; null = silent drop → mark `sends.status='smartlead_rejected'` + alert. Wrap activation step with rollback path if mid-launch failure. |
| 5 | R1#3 | Keyword classifier first-match misses dual-signal replies (e.g., "not interested but remove me"). | **Applied.** On multi-label hits, return null (route to LLM). Documented priority + scan-all-then-decide pattern. |
| 6 | R1#5 | Watchdog double-pauses on single complaint (Wilson check fires AND hard-rule fires). | **Applied.** Restructured: hard-rule check first with `continue`; Wilson block only when hard-rule clean. |
| 7 | R2#2 | `EMAIL_ACCOUNT_DISCONNECTED` uses `eventType` (camelCase) not `event` (snake_case). Current `dispatchByEvent(req.body.event)` would silently miss it. | **Applied.** Normalize on receipt: `const eventName = req.body.event ?? req.body.eventType`. Add explicit branch + P1 alert. |
| 8 | R2#3 + R1#15 | FUB `stage` is name string, not ID. Hardcoded `FUB_DEFAULT_STAGE_ID` will silently misroute. + env var name mismatch (`FUB_X_SYSTEM_KEY` vs `FUB_SYSTEM_KEY` across docs). | **Applied.** Replace with `FUB_DEFAULT_STAGE_NAME`. Standardize on `FUB_X_SYSTEM_KEY` everywhere. Phase 2.4 onboarding step calls `GET /v1/stages` against client's account. |
| 9 | R2#7 | Connection method ambiguity — Zapmail GWS mailboxes should connect to Smartlead via SMTP/IMAP **app passwords** (scriptable), not OAuth (UI-only recovery per Smartlead G7). | **Applied.** Lock SMTP/IMAP app passwords. Rename `oauth_status` → `connection_status`. Domain FSM `oauth_pending` → `connection_pending`. |
| 10 | R2#15 | FUB `occurredAt` must be classification timestamp, not Smartlead receipt — >24h gap (possible with Smartlead reply-polling latency) silently suppresses FUB automations (P4). | **Applied.** Push `occurredAt = replies.notified_at`. Anti-pattern added. |

## V1-scope cuts (apply now — reduces critical path)

| # | Reviewer | Cut | Rationale |
|---|---|---|---|
| 11 | R3#4 | Drop `dmarc-ramp-evaluator` from v1; v2 | Manual DNS edit happens ~4× in v1 lifecycle. `dns-health-check` already alerts on clean signal; operator handles ramp manually until automation is justified. |
| 12 | R3#5 | Drop Task 1.17 (Smartlead webhook health monitor) from v1; v2 | Plan accepts Smartlead outage downtime per global decision. Replace with simple alert when >2h gap in webhook traffic; operator re-registers via Smartlead UI manually. |
| 13 | R3#10 | Drop `zerobounce-revalidate` daily cron from v1; v2 | Inert for first 60 days; JIT path inside dispatcher handles correctness. Daily cron is performance optimization, not v1 correctness. |
| 14 | R3#2 + R3#3 | Drop `conversations` table from v1; store `smartlead_thread_id` directly on `replies`. Extend `warmup_state` and `email_send_log` in place via `mailbox_id` column instead of cloning. | Audit-delta itself said "extend or replace"; extending is simpler. Reduces 4 new migrations to 0 (warmup) + 0 (conversations). |
| 15 | R3#1 | Merge `smartlead-campaign` + `smartlead-enroll` Edge Functions | Same atomic flow. Single function with `{action: 'create'|'enroll'|'activate'}` switch — simpler retry, deploy, test. |
| 16 | R3#6 | Settings panels 6 (Zapmail UI), 10 (Seed inbox v2), 12 (NMLS footer — blocked anyway), 13 (Retention windows) → `.env`-only at v1 | Builds UI for blocked/v2/no-content features. Defer until needed. |
| 17 | R3#8 | Split campaign setup (create + add-steps + connect-mailboxes) from cron-driven enrollment | Setup is one-shot at launch, not per-cron. 5-step drip × 200ms × cron loop = timeout risk. |
| 18 | R3#9 | Consolidate 11 migrations to 4 | Phase 1 has no live data to protect. Logical grouping: send-layer + reply-layer + lead/campaign extensions + warmup extensions. |
| 19 | R3#11 | `routing_rules` table referenced but never defined. Simplify: `campaigns.team_email` column (single override) at v1. | Per-campaign override is a one-column extension, not a normalized table, until v2 needs multiple rules per campaign. |

## Apply later (cycle 2-3 polish)

| # | Reviewer | Finding | Note |
|---|---|---|---|
| 20 | R1#6 | HMAC token rotation migration plan missing | Add note: on secret rotation, copy outstanding HMAC tokens to `unsubscribes` for fallback path. |
| 21 | R1#7 | `claimed_mailbox_id` vs `mailbox_id` distinction | Already implied by #1 fix; document explicitly. |
| 22 | R1#9 | Smartlead `max_email_per_day` vs CRM `daily_cap` sync | Add to `connectMailbox` call. Update on mailbox cap-ramp graduation. |
| 23 | R1#10 | LLM classifier circuit breaker | After 3 timeouts in 5min, open circuit + alert ops + mark all replies `requires_human_review` until reset. |
| 24 | R1#13 | `mailbox-cap-reset` idempotency via `last_reset_at` | Already needed for #1 fix. Document. |
| 25 | R1#14 | Validation scenario 3 keyword regex doesn't actually match "send a calendar link" | Tighten regex; add `calendar` to positive list. |
| 26 | R2#4 | Seed inbox cred encryption (Supabase Vault) | Phase 3 only; defer until Phase 3 starts. |
| 27 | R2#5 | FUB `peopleStageUpdated` webhook back from FUB — cheap if registered at Phase 2 setup | Add Task 2.8 lightweight registration. |
| 28 | R2#6 | Migration FK ordering | Add explicit dependency note in Task 1.1 DoD. |
| 29 | R2#9 | Realtime on `replies` table for live UI | Add to Task 2.6 DoD. |
| 30 | R2#11 | Cost monitoring (Smartlead 90K/mo, ZeroBounce credits, LLM tokens) | Add `cost-monitor` daily cron. |
| 31 | R2#12 | MCP tool inventory shapes | Add subsection: list_domains/get_domain/retire_domain etc. |
| 32 | R2#13 | Staging environment (lazer-staging vs lazer-prod) | Add to Phase 0.2 sub-task. |
| 33 | R2#14 | Tighten keyword classifier (`schedule`, `wrong person` cause false positives) | Already covered by #5 (multi-label routing); apply during Task 2.2. |
| 34 | R1#4 | Webhook idempotency self-healing on `dispatchByEvent` mid-flight failure | Add background sweeper for `webhook_events` rows where `processed_at IS NULL` >10min old. |
| 35 | R1#8 | Domain FSM missing `oauth_pending` | Resolved by #9 (rename to `connection_pending`); state belongs on mailbox not domain. |

## Net delta to plan after cycle 1 fix pass

- 10 high-impact corrections to pseudocode/data model
- 9 v1 scope cuts (5 Edge Functions + 1 table + 4 settings panels removed from v1)
- ~10 minor polish items deferred to cycles 2-3
- Estimated post-cycle-1 plan length: ~900 lines (similar; cuts offset by clarifications)
