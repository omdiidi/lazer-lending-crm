# Lazer Lending CRM — Operational Runbook

**Last updated:** 2026-05-01
**Version:** v1 (skeleton; finalized in Phase 1)
**Status:** Living document. Each incident response gets refined with operating data.

## How to use this runbook

When an alert fires, find the matching incident below. Each section follows the same structure:

- **Symptom**: what the operator sees
- **Detection**: which alert fires, what dashboard shows the issue
- **Immediate action (first 5 minutes)**: stop-the-bleed steps
- **Diagnosis (next 30 minutes)**: confirm root cause
- **Resolution**: path to fix
- **Postmortem**: what to log for learning

If the incident is not listed, contact IntegrateAPI per the SLA defined in `CHARGE-ABILITY.md` (response targets in §SLA — currently 1 business-day acknowledgement for non-P0; 4-hour acknowledgement for sending-stop conditions).

Vendor contact paths and escalation are in `VENDOR-CONTRACTS.md`. Compliance and subpoena response live in `COMPLIANCE.md`. State-AG record obligations are in `COMPLIANCE.md` §9 subpoena-record table.

This is a skeleton. Once we have 90 days of operational data the responses will tighten. Until then, when in doubt, page IntegrateAPI.

---

## Incident 1 — Single mailbox single-complaint pause

**Symptom.** A mailbox shows `paused` state on the Mailboxes page with reason `complaint_hard_rule` and zero queued sends.

**Detection.**
- Watchdog alert: `mailbox.<id>.complaint_hard_rule_triggered` fires within 1 hour of complaint receipt.
- Operator dashboard widget "Paused mailboxes (24h)" increments by 1.
- Email to ops alert distribution list: subject `[Lazer CRM] Hard-rule pause — mailbox <id>`.

**Immediate action (first 5 minutes).**
1. Open the Mailboxes page; click into the paused row.
2. Confirm the complaint event is real — open the linked `webhook_events` row, verify `event_type=complaint`, verify Smartlead signature passed.
3. Do NOT re-enable the mailbox. Hard rule = manual review required by design.

**Diagnosis (next 30 minutes).**
- Pull the most recent 50 sends from this mailbox (Mailbox detail → Sends tab). Look for: same-recipient repeats, sequence step 3+, sends to known suppression-list recipients.
- Check the recipient's prior interaction history (Leads → search by email). Was this recipient on a previous list? Did they reply negatively before?
- Determine: legitimate complaint (we annoyed a real person), bot/auto-mark (unlikely with 1 hard rule but possible), or sabotage (competitor signup — see the Resolution block below for the sabotage response path).

**Resolution.**
- Legitimate: keep mailbox paused. Add recipient to suppression list (auto-handled if the complaint webhook also triggered an `unsubscribe` classification). Pull the campaign step + template that triggered. Review with sender for tone/list quality.
- Bot/auto-mark: rare; if confirmed (recipient never opened, complaint within 30s of delivery), still keep paused 7 days, then re-enable with reduced cap (15/day for 14 days).
- Sabotage: document the recipient's domain, add to bot-flag list, escalate to IntegrateAPI for complainant-weighting upgrade (post-v1 feature).

**Postmortem.**
- Log to `docs/lazer-lending/incidents/YYYY-MM-DD-<incident-name>.md`: mailbox id, complaint timestamp, sends in prior 24h, recipient details (PII-redacted), root cause, resolution, time to manual review close.
- Update `OPS-RUNBOOK.md` if the response pattern needs adjustment.

---

## Incident 2 — Smartlead 429 rate limit

**Symptom.** Sends from a specific mailbox stop. Dispatcher logs show `Smartlead 429 Too Many Requests`. Mailbox auto-paused with reason `provider_rate_limit`.

**Detection.**
- Dispatcher alert: `dispatcher.smartlead.429_rate` >0 within a 10-minute window.
- Mailbox state machine flips to `paused` with `pause_reason=provider_rate_limit`.

**Immediate action (first 5 minutes).**
1. Confirm the 429 came from the Smartlead per-mailbox send endpoint (not the campaign-create endpoint). The code path that hit is in PLAN.md Task 1.5a.
2. Verify `today_sent_count` for the affected mailbox. If it is at the daily cap (default 20, configurable 15–25 per PLAN.D19), this is expected end-of-day exhaustion, not a rate-limit incident. Wait for next-day reset.
3. If under cap: check whether multiple mailboxes hit 429 simultaneously — that points at account-level rate limiting, not per-mailbox.

**Diagnosis (next 30 minutes).**
- Pull the dispatcher request log for the past hour. Were sends fired at high frequency (>1/sec to Smartlead)? The plan's `claimSendSlot` should serialize per-mailbox to concurrency=1 — if multiple in-flight requests are visible per mailbox, the lock contract is broken.
- Check Smartlead account status page (third-party StatusGator: https://statusgator.com/services/smartlead) — Smartlead does not publish an official status page.
- Check Smartlead support ticket queue — if multiple Lazer mailboxes are throttled, account-level enforcement is plausible.

**Resolution.**
- Per-mailbox cap exhaustion: confirm next-day reset clears it. No action.
- Dispatcher race (concurrency >1 per mailbox): IntegrateAPI must investigate `claimSendSlot` lock; this is the dispatcher correctness bug from `PLAN-REVIEW-NOTES.md`. Stop sending until fixed.
- Account-level enforcement: open Smartlead support ticket; back off all sends to 50% volume until acknowledged.

**Postmortem.**
- Log incident with timestamp, affected mailboxes, dispatcher request rate, resolution path. If lock contract was broken, link to the fix PR.

---

## Incident 3 — Smartlead account suspension

**Symptom.** All sends across all mailboxes return Smartlead errors (4xx with "account suspended" or similar). Dashboard shows zero sends in the past hour.

**Detection.**
- Dispatcher alert: `dispatcher.smartlead.4xx_rate` >50% over 10 minutes.
- Webhook health check: zero `email_sent` events in 30 minutes during business hours.
- Smartlead-side: account email from `support@smartlead.ai` to the registered admin address.

**Immediate action (first 5 minutes).**
1. Confirm suspension by logging into the Smartlead web UI. Look for an account banner, suspended-status email, or campaign-pause indicator on every campaign.
2. Stop the dispatcher: in the Settings page, flip global `sending_enabled=false`. This prevents the system from continuing to hammer the suspended account and racking up 4xx noise.
3. Notify IntegrateAPI immediately. This is a P0 — sending pipeline fully stopped.

**Diagnosis (next 30 minutes).**
- Pull the suspension reason from Smartlead's email or support response. Common causes: AUP violation (complaint-rate spike, list-quality concern, payment failure).
- If billing-related: resolve and request reactivation; typical recovery 24–48 hours.
- If AUP-related: this is the contingency the `SendProvider` interface was built for. Recovery path: activate Saleshandy failover.

**Resolution.**

**Path A — Suspension lifted (billing or false positive):**
- Smartlead reactivates the account.
- Resume sends with reduced cap (50% of normal) for 7 days while reputation rebuilds.

**Path B — Saleshandy failover:**
- Pre-condition: Saleshandy account must be pre-onboarded with API key in `SALESHANDY_API_KEY` env var (currently NOT set; this is a Phase 0 hardening task — see PLAN.md OQ12 / Task 0.9 (provisioning) and Task 1.0f (activation procedure)).
- If Saleshandy is pre-onboarded with mailboxes already OAuth-connected: 24–72 hours to switch the active `SendProvider` and resume sends at 50% cap.
- If Saleshandy is NOT pre-onboarded: 2–4 weeks of fresh-mailbox warmup before any sends. **Pipeline goes to zero during this window.** Notify Lazer immediately so they can adjust expectations and other channels.

**Postmortem.**
- Document suspension reason, timeline to restore, lessons for AUP guardrails.
- If Saleshandy was not pre-onboarded, escalate hot-standby provisioning as a hard requirement (PLAN.md Task 0.9 (provisioning) and Task 1.0f (activation procedure) capture this).

**First call:** IntegrateAPI engineering. This is not an operator-resolvable incident.

---

## Incident 4 — Mailforge tenant suspension / deplatform

**Symptom.** All burner mailboxes return SMTP authentication errors. OAuth tokens fail to refresh. Sends stop across every burner domain simultaneously.

**Detection.**
- Dispatcher alert: `dispatcher.send.auth_failure_rate` >80% across multiple mailboxes within 30 minutes.
- Webhook health check: zero `email_sent` events from any burner mailbox for 30 minutes.
- Mailforge-side: account email or in-app banner indicating Workspace tenant suspension.

**Immediate action (first 5 minutes).**
1. Log into Mailforge admin console. Confirm tenant status.
2. Stop the dispatcher (Settings → `sending_enabled=false`).
3. Notify IntegrateAPI — this is a P0.
4. Notify Lazer — pipeline is fully stopped; sending recovery is days-to-weeks.

**Diagnosis (next 30 minutes).**
- Determine scope. Is it (a) tenant-level Mailforge suspension, (b) Google Workspace tenant suspension affecting Mailforge customers, or (c) Mailforge business failure (e.g., service outage, company shutdown)?
- For (b), reference the late-2025 Google crackdown documented in `tmp/research/2026-05-01-feasibility-validation.md` Q2 — Google has executed tenant-wide suspensions specifically targeting Workspace mailboxes integrated with Smartlead/Instantly/Zapmail. The Smartlead+Workspace pairing is named as an elevated-risk configuration.
- For (c), check Mailforge status (third-party only — no Mailforge public status page) and HackerNews/IndieHackers/Reddit for outage chatter.

**Resolution.**

**Hot-standby path (REQUIRED — verify before assuming this path):**
- Pre-condition: Phase 0 Task 0.9 / Task 1.0f hot-standby procedure must have been completed. This means: a parallel inventory of warmed mailboxes on a different reseller (e.g., Maildoso, Inframail) or direct Workspace, OAuth-connected to Smartlead, kept on minimum-volume warmup.
- **CONFIRM HOT-STANDBY EXISTS BEFORE ASSUMING THIS PATH.** As of 2026-05-01, the standby procedure is documented but NOT yet executed. If it has not been run, jump to the cold-recovery path.
- If standby exists: switch the active sending pool to standby mailboxes via the Domains page. Sends resume in 24–72 hours at 50% cap.

**Cold-recovery path:**
- Provision new Workspace mailboxes through an alternate reseller or directly. Per research (see `tmp/research/2026-05-01-feasibility-validation.md` Q2), realistic cold-start is 7–10 weeks (24–48h DNS + per-domain DKIM/SPF/DMARC + 6–8 weeks warmup + OAuth re-provisioning).
- During this window, pipeline is zero. Lazer must be notified at the start, not at the end.

**Postmortem.**
- Document tenant model in use (was Lazer in a shared Mailforge Workspace tenant or isolated?). This is the unresolved question from `tmp/research/2026-05-01-feasibility-validation.md` Q2 — it determines blast radius.
- If hot-standby was not in place, this incident becomes the forcing function to provision it before resuming any sends.

**First call:** IntegrateAPI engineering. Operator role is to confirm scope and notify Lazer.

---

## Incident 5 — Anthropic API outage > 1 hour

**Symptom.** Replies arrive but are not classified. Reply queue depth grows. The Replies page shows pending classification on every new entry.

**Detection.**
- Reply-pipeline alert: `replies.pending_classification > 50`.
- Classifier alert: `classifier.api.5xx_rate` >50% over 10 minutes.
- Anthropic status page: https://status.anthropic.com/

**Immediate action (first 5 minutes).**
1. Confirm the outage on https://status.anthropic.com/.
2. The classifier's failover behavior (per PLAN.md §classifyReply) sets `classification=null` + `requires_human_review=true`. Replies are not lost; they just queue.
3. Open the Replies page and filter for `requires_human_review=true`. This is the manual triage queue.

**Diagnosis (next 30 minutes).**
- Estimate outage duration from Anthropic's status updates.
- Watch reply queue depth. If it grows past ~50, manual triage cannot keep pace and hot leads will go cold.
- Verify the regex backstop for unambiguous opt-out language (PLAN.md §classifyReply with the regex pre-filter from `PLAN-REVIEW-NOTES.md`) is still firing — `unsubscribe`, `stop calling`, `remove me` should still be classified locally without the LLM. If those are queueing, it is a code bug, not an Anthropic outage.

**Resolution.**
- Outage <1 hour: wait it out. Manual operator triage on the Replies page. Use UI button "Mark positive / negative / OOO / unsubscribe."
- Outage 1–4 hours: same; assign two operators if queue grows past 30.
- Outage >4 hours: route forward via secondary path. Default secondary path is to forward all `requires_human_review=true` replies to the configured operator address with subject prefix `[MANUAL-CLASSIFY]`. Operators classify in their inbox; classification syncs back via reply-thread tooling. Define the exact rule in OQ resolution before this becomes operational.

**Postmortem.**
- Log queue peak depth, time to drain, mis-classifications caught during manual triage.
- If outages exceed 4 hours twice in a quarter, evaluate adding OpenAI as a classifier failover.

---

## Incident 6 — FUB API breakage (4xx/5xx persistent)

**Symptom.** Positive-classified replies are not appearing in Follow Up Boss. The Replies page shows them as `forwarded_to_fub=false` even hours later.

**Detection.**
- FUB-push alert: `fub.push.error_rate` >20% over 30 minutes.
- Audit log: persistent `fub_push_failed` entries.

**Immediate action (first 5 minutes).**
1. Try a single manual FUB push from the Replies page → the "Force push to FUB" button. Capture the exact error (4xx with body, 5xx with status).
2. Verify the FUB API key is still valid by curling `GET https://api.followupboss.com/v1/identity` with the key.
3. Confirm whether ALL FUB pushes are failing or only a subset (e.g., specific lead types).

**Diagnosis (next 30 minutes).**
- 401/403: API key rotated or revoked. Coordinate with Lazer to issue a new key; update `FUB_API_KEY` env var.
- 422: payload validation failed. FUB may have changed its lead schema. Capture the response body and escalate to IntegrateAPI.
- 429: rate limit. The push queue should respect FUB's documented limits; if it does not, escalate to IntegrateAPI for backoff tuning.
- 5xx persistent: FUB-side outage. Check FUB status (no public page; chat support).

**Resolution.**
- API key issue: rotate, redeploy, retry queued pushes from the Replies page.
- Schema change: requires IntegrateAPI engineering. The plan stores the original payload, so retry after fix is safe.
- Rate limit: tune backoff.
- FUB outage: pushes queue locally; the retry job (PLAN.md Task 2.7 backoff schedule) eventually drains. Monitor queue depth and ETA.

**Postmortem.**
- If FUB schema changed, add a contract test that runs against FUB's sandbox before deploys.
- Log queue peak, drain time, business impact (delayed warm-lead handoff).

**First call:** IntegrateAPI for anything beyond key rotation.

---

## Incident 7 — DMARC RUA aggregator silent failure

**Symptom.** No DMARC RUA reports received in 7 days. The DNS Health page shows last-report timestamp older than 7 days for one or more burner domains.

**Detection.**
- DNS-health alert: `dmarc.rua.report_age > 7d` for any active burner.
- This is a silent failure — no alert from the aggregator itself, just absence of inbound reports. Detection depends on the liveness check.

**Immediate action (first 5 minutes).**
1. Verify the alert is real. Open the DNS Health page and confirm the report-age field for the affected burner.
2. Check the aggregator dashboard (default: Cloudflare DMARC Management free tier, configured via `DMARC_RUA_PROVIDER=cloudflare` env var).
3. Spot-check the DNS TXT record for `_dmarc.<burner-domain>` to verify the RUA address is still pointed at the aggregator's ingest address.

**Diagnosis (next 30 minutes).**
- Cloudflare may have dropped the free tier — check Cloudflare's product announcements and account status.
- The TXT record may have been overwritten by a Mailforge automation.
- Receivers (Gmail, Yahoo, Microsoft) may have stopped sending RUA for the domain because volume is too low — at <100 sends/day, RUA reports may be sparse but should never be zero for 7 days.

**Resolution.**
- Aggregator dropped free tier: switch to a self-hosted parser (e.g., parsedmarc on a small VM) or to a paid alternative (URIports, dmarcian, Postmark DMARC Digests). Update the TXT record. Allow 24h DNS propagation + 24–48h before reports start flowing.
- TXT record corrupted: restore via DNS provider; allow 24h DNS propagation.
- Genuinely low volume: verify by checking sent counts. If <50 sends/day, sparse reporting is normal. Lower the alert threshold to 14 days for that burner.

**Postmortem.**
- Document the aggregator decision in `VENDOR-CONTRACTS.md` if it changed.
- If self-hosted parser became necessary, add monitoring for the parser itself.

---

## Incident 8 — Burner domain expiry

**Symptom.** All sends from one burner domain bounce. SMTP errors include "550 sender domain does not exist" or DKIM-related failures.

**Detection.**
- Domain-expiry pre-alert: `domain.expires_at - now < 30d` (expected, gives time to renew).
- Domain-expired alert: `domain.expires_at < now` (incident).
- Bounce-rate spike on the affected domain.

**Immediate action (first 5 minutes).**
1. Stop all sends from the affected burner: Domains page → click Retire on the expired burner. This pauses all child mailboxes.
2. Verify the domain is actually expired: `whois <burner-domain>` or check the registrar dashboard.
3. Check whether DNS records (SPF/DKIM/DMARC TXT) still resolve. If they have evaporated, the damage is done — bounces have already happened.

**Diagnosis (next 30 minutes).**
- Confirm renewal path: was the domain registered through Mailforge (renewal handled there) or independently? The 30-day pre-alert should have been actioned already; if it was missed, identify the process gap.
- Estimate sent volume during the lapsed period. Every send during the lapse is a hard bounce against the Smartlead+Workspace mailbox reputation — this damages mailboxes, not just the domain.

**Resolution.**
- Through Mailforge: renew via Mailforge dashboard (typically auto-renew if billing is current; if billing failed, fix billing first).
- Independent registration: renew through the registrar; allow 24h DNS propagation before resuming sends.
- After renewal: keep the burner retired for 7 days. The mailboxes attached to the burner need warmup re-do because their reputation took a hit during the lapse. Plan on 4–6 weeks of warmup before resuming live volume.

**Postmortem.**
- Identify the failure: was the 30-day alarm not configured, not delivered, or ignored? Document the fix.
- Add the burner's renewal date to the operator calendar.

---

## Incident 9 — ZeroBounce credit exhaustion

**Symptom.** Bulk lead validation jobs fail. JIT (just-in-time) validation at send time fails. Dispatcher gates sends because validation cannot complete.

**Detection.**
- ZeroBounce-side: account email indicating low/zero credits.
- Dispatcher alert: `validation.zerobounce.error_rate` >50%.
- Bulk validation job log: `insufficient_credits`.

**Immediate action (first 5 minutes).**
1. Log into ZeroBounce and confirm credit balance.
2. Top up credits — ZeroBounce sells credit packs; the smallest pack typically buys days of headroom.
3. Verify validation resumes after top-up by re-running a single failed validation.

**Diagnosis (next 30 minutes).**
- Why did it run out? Expected burn rate is `(daily new leads + JIT validations) × ZeroBounce cost-per-validation`. Compare against actual.
- Was a list import unexpectedly large?

**Resolution.**
- Top-up: immediate fix.
- Manual decision (not pre-wired): switch to a fallback validator. NeverBounce, Bouncer, and Hunter are commonly compared. This is operator-driven, not automatic — IntegrateAPI must approve.

**Postmortem.**
- Document burn rate and set a low-balance alarm at 20% remaining.
- If exhaustion recurs, evaluate auto-top-up settings or move to a higher monthly tier.

---

## Incident 10 — State AG subpoena response

**Symptom.** Lazer receives a subpoena, civil investigative demand (CID), or formal records request from a state attorney general. Most likely from California (BPC § 17529.5 is the highest-probability enforcement vector per `tmp/research/2026-05-01-feasibility-validation.md` Q3) but possible from any state where Lazer has sent.

**Detection.**
- This is not a system alert. It arrives by certified mail or email to Lazer's compliance contact.
- The operator role is reactive — engineering and operations support legal counsel, do not own the response.

**Immediate action (first 5 minutes).**
1. **Stop. Read this section before doing anything technical.**
2. Notify Lazer's compliance counsel immediately. The operator does NOT communicate with the AG's office.
3. **Do not delete, modify, or "tidy up" any records.** Preserve everything as-is. Spoliation is a worse problem than the underlying issue.
4. Notify IntegrateAPI engineering — they will be needed for record extraction.

**Diagnosis (next 30 minutes).**
- Read the subpoena scope carefully. State AGs typically demand: complete sent log w/ timestamps + IPs + headers, source-list provenance + data-broker contracts + selection criteria, opt-out log + 10-day-honor evidence, per-state license disclosure proof in headers/body, SPF/DKIM/DMARC config snapshots, prior-consent docs, campaign-approval records, bounce data + suppression confirmations, campaign-level templates + targeting criteria + volume, FCRA prescreening compliance.
- The full subpoena-record table is in `COMPLIANCE.md` §9.
- Identify which records the subpoena touches; confirm the retention windows still hold them. Reg N (24 months), Reg B (25 months), Reg Z (24 months) are the controlling clocks.

**Resolution.**
- Counsel-driven. Operator role is to extract records per counsel's exact specification, in the exact format requested.
- Engineering produces the exports. Operator preserves audit-log immutability throughout.
- Do not opine on legality. Do not draft cover letters. Do not interpret the subpoena's scope.

**Postmortem.**
- Document the request and the response. This becomes part of the regulatory file.
- Identify any gap (e.g., a record class the subpoena demanded that was not retained or not extractable) and feed it back into `COMPLIANCE.md` and the data model.
- Subpoena-readiness is a live deliverable, not a feature. Update `COMPLIANCE.md` §9 if the subpoena revealed a gap.

**First call:** Lazer's compliance counsel, then IntegrateAPI engineering. Not an operator-resolvable incident.

---

## Closing notes

This runbook is a skeleton. Every incident response will be refined as Lazer accumulates 90 days of operational data. Until then:

- When in doubt, page IntegrateAPI per the `CHARGE-ABILITY.md` SLA.
- When in real doubt, stop sends. The cost of a 24-hour pause is small. The cost of damaging burner reputation or shipping a state AG violation is catastrophic.
- Every incident gets a postmortem entry under `docs/lazer-lending/incidents/`. Even small ones. Pattern recognition compounds.

**Cross-references.**
- Vendor escalation paths: `VENDOR-CONTRACTS.md`
- Compliance and subpoena response: `COMPLIANCE.md`
- SLA and response targets: `CHARGE-ABILITY.md`
- Architecture and data model: `PLAN.md`
- Open feasibility findings: `tmp/research/2026-05-01-feasibility-validation.md`, `tmp/review-notes/2026-05-01-codex-feasibility-audit.md`
