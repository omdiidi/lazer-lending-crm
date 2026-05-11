# Build Readiness — Lazer Lending CRM

**Date:** 2026-05-04
**Purpose:** honest accounting of what's documented vs what's missing before Phase 1 coding can start. The docs are complete. The real-world prerequisites are not.

---

## ✅ What we have (build-ready in docs)

| Area | Status | Source |
|---|:---:|---|
| 13-doc set, 5,612 lines, cross-checked across 4 review passes | ✅ | `docs/lazer-lending/` |
| Plan v2.5 with 10 pseudocode correctness fixes applied | ✅ | `PLAN.md` §Implementation Blueprint |
| Federal + 10-state compliance bible (54 citations) | ✅ | `COMPLIANCE.md` |
| Vendor webhook + retry + idempotency contracts (Phase 0.3 verify markers where unconfirmed) | ✅ | `VENDOR-CONTRACTS.md` |
| 10-incident operational runbook | ✅ | `OPS-RUNBOOK.md` |
| End-to-end email-flow explainer | ✅ | `EMAIL-FLOW.md` |
| Connect CRM scaffold reality (Supabase wired, 22 edge functions, 8 migrations) | ✅ | `CONNECT-CRM-AUDIT-DELTA.md` |
| 9 new tables + compliance columns on Lead/Send/Campaign/Mailbox/users | ✅ | `PLAN.md` §Delta Design |
| Architecture decisions (Edge Function vs background worker, sync/async webhook split, two-phase dispatcher, auth+RBAC) | ✅ | `PLAN.md` §Architecture Overview |
| Pricing structure ($95k build / $2,200/mo / $28k v2) + termination clause + SLA | ✅ | `CHARGE-ABILITY.md` |
| Per-state compliance footer template (10 states + federal floor) | ✅ | `COMPLIANCE.md` §8 |
| 80+ external research citations (Smartlead AUP, Mailforge risk, NMLS, CCPA, market pricing) | ✅ | `tmp/research/2026-05-01-feasibility-validation.md` |

A fresh implementer (or fresh Claude session) can read these docs and have everything they need to write code. **The docs are not the bottleneck.**

---

## 🔴 What we don't have (blocks Phase 1 start)

These are real-world prerequisites — coordination, signatures, vendor accounts, legal engagement. Documentation cannot solve them.

### Tier 1: Hard blockers (Phase 1 cannot start)

| # | Item | Owner | Realistic time | Notes |
|---|---|---|---|---|
| 1 | **Lazer signs `PRD-AMENDMENT.md`** | Lazer | 1 meeting | Architecture replacement (subdomains→burners, Resend→Smartlead) needs written client acknowledgment. Without this, building locks in a different system than the contract. |
| 2 | **Engagement letter signed** | Both parties | 1–2 weeks | $95k build + $2,200/mo retainer + termination clause + SLA terms (all drafted in `CHARGE-ABILITY.md`; needs lawyer review + signature). |
| 3 | **Phase 0.5 client kickoff completed** | Lazer + IntegrateAPI | 3–6 weeks calendar | Closes 13 Open Questions (see PLAN.md §Open Questions). Critical items: per-state footer text approval, reply-forwarding default address, OOO rule, DMARC ramp acceptance, neutral-reply rule, LLM provider DPA choice, retention windows. **OQ6 (compliance footer text) alone can stall Phase 1 indefinitely** if Lazer's compliance/legal can't supply the per-state strings. |
| 4 | **California mortgage-compliance counsel engaged** | IntegrateAPI / Lazer | 2–4 weeks | D20 mandatory before first send. CA § 17529.5 ($1,000/email strict-liability private right of action) is the highest-probability enforcement vector. Counsel reviews: email templates, per-state footer matrix, list-procurement contract, fair-lending list audit, incident-response playbook. |
| 5 | **Smartlead Pro account with verified webhook signing scheme** | IntegrateAPI | 1 week + Phase 0.3 verify | Account signup is fast; capturing real signed webhook payloads (Phase 0.3) blocks Task 1.8. |
| 6 | **Mailforge inventory provisioned + tenant isolation question answered** | IntegrateAPI / Mailforge | 1 week + DNS propagation | Critical question per VENDOR-CONTRACTS §2: are mailboxes in isolated Workspace accounts or a shared reseller tenant? Determines blast radius if Google flags one mailbox. |
| 7 | **Burner domains registered + 4-week warmup runway** | IntegrateAPI / Mailforge | **5+ weeks real-time floor** | This is the longest-pole single item. Domain registration 1 day; SPF/DKIM/DMARC propagation 24–72h; Smartlead bundled warmup 4 weeks before live cold sends are safe. Cannot be parallelized away. |
| 8 | **Supabase project provisioned for Lazer** (separate from current Connect CRM project) | IntegrateAPI | 1 day | Phase 0.2 task. Provides the database the new migrations land in. |
| 9 | **Suppression list seed-imported from Lazer's existing FUB/legacy** | Lazer + IntegrateAPI | 1–2 weeks | Phase 0 Task 0.10. Without this, v1's first cold campaign mails people who already unsubscribed via FUB. Immediate complaint-rate spike. **Hard launch gate.** |

### Tier 2: Phase 0.3 vendor smoke-tests (parallelizable; block specific Phase 1 tasks)

These run in parallel with Tier 1 above. Each is ~1 day of work but only after the relevant vendor account exists.

| Verification | Blocks Phase 1 task | Output |
|---|---|---|
| Smartlead webhook signing scheme (send real test event, capture payload + signature header) | Task 1.8 (webhook receiver) | Add documented scheme to `VENDOR-CONTRACTS.md` §1 |
| Mailforge tenant isolation answer (ask Mailforge in writing) | Task 1.3 (Mailforge integration) | Add answer to `VENDOR-CONTRACTS.md` §2 |
| FUB API rate-limit + pipeline/stage discovery (live API call against sandbox) | Task 2.4 (FUB client) | Documented limits + pipeline-stage-fetch pattern |
| IMAP forwarder feasibility on Mailforge-managed Workspace mailboxes | Task 2.3 (reply forwarder) | Confirms or rules out IMAP redirect approach (fallback: Resend forward) |
| ZeroBounce bulk async polling latency + rate limits | Task 1.6 (validation client) | Documented behavior under load |
| Anthropic DPA confirmed for prospect-reply data flow | Task 2.2 (classifier) | Signed DPA addendum from Anthropic |

### Tier 3: Soft prerequisites (nice to have before Phase 1, not blocking)

| Item | Owner | Why useful |
|---|---|---|
| Initial cold-email template library (5–10 vetted compliant templates) | Lazer | Phase 1 demo needs real content; Lazer's marketing/sales likely owns. Footer engine can be tested with placeholders if not ready. |
| Hot-standby vendor account provisioned (Litemail / EmailAstra / Infraforge — pick one) | IntegrateAPI | $25–85/mo for 5 pre-warmed mailboxes. Converts disaster recovery from 7–10 weeks to 24–72 hours. Can be deferred to mid-Phase-1 if budget-sensitive. |
| Lazer's existing `lazerlending.com` Workspace tenant identified (OQ7) | Lazer | Affects whether `notify.lazerlending.com` Resend records share that tenant or are independent. |
| Lazer team email distribution list architecture confirmed (OQ2/OQ3) | Lazer | Reply forwarding needs to land somewhere that doesn't quarantine third-party-domain mail. M365 distribution lists with anti-spoofing are a gotcha. |

---

## 📅 Realistic critical path

```
Week 0       Week 2       Week 4       Week 6       Week 8       Week 12      Week 18      Week 22
│            │            │            │            │            │            │            │
├─ PRD-AMENDMENT signed
├─ Engagement letter ─────►
├─ CA counsel engaged ────────────────►
├─ Vendor signups ──────►
│
│            ├─ Phase 0.5 kickoff (13 OQs) ──────────►
│
│            ├─ Burner domain registration
│                         ├─ DNS propagation 24–72h
│                                       ├─ Smartlead warmup 4 wk ─────────►
│
│                                                    ├─ Phase 0.3 verifies (1–2 wk parallel)
│
│                                                                 ├─ Phase 1 starts ──── 8–12 wk ────►
│                                                                                                    │
│                                                                                       Phase 2 ──── 3–5 wk
│                                                                                                              ▼
│                                                                                                          v1 ship
```

**Earliest realistic v1 ship: ~5 months from today.** The 5-week warmup floor is the longest pole; Phase 1 calendar overlaps with it.

---

## 🎯 Actions for this week

If you want to compress the timeline, three things in parallel **this week**:

1. **Schedule Phase 0.5 kickoff with Lazer.** The 3–6 week OQ-close window is the biggest hidden delay. Earlier it starts, earlier Phase 1 unblocks. Suggested agenda items in PLAN.md §Open Questions.
2. **Start vendor signups in parallel:**
   - Smartlead Pro trial → captures account, lets Phase 0.3 webhook signature verification start
   - Mailforge inquiry email → ask the tenant-isolation question + start the inventory clock
   - FUB sandbox request → start API verification
   - ZeroBounce trial account → API key for Phase 0.3 latency test
   - Anthropic DPA inquiry → contract review takes 1–3 weeks
3. **Initiate California compliance counsel conversation.** Even if engagement isn't immediate, finding the right counsel (mortgage advertising specialist, ideally with NMLS + § 17529.5 experience) takes 1–3 weeks. Start the search now.

---

## 📋 Phase 0 task checklist (operational view)

This consolidates Phase 0 tasks from `PLAN.md` into a single checklist. Order indicates suggested execution order; many can parallelize.

- [ ] **0.0 — Sign PRD-AMENDMENT.md** (not in PLAN.md but precedes everything)
- [ ] **0.1 — Verify CONNECT-CRM-AUDIT-DELTA.md against live code** (already largely done; final pass during Phase 0)
- [ ] **0.2 — Lock Supabase as backend; provision Lazer's Supabase project**
- [ ] **0.3 — Provision sandbox vendor accounts; verify webhook signing schemes** (longest task; runs in parallel)
- [ ] **0.4 — Verify Bun + Vite + Vitest + Playwright dev loop on a fresh checkout**
- [ ] **0.5 — Client kickoff: close 13 Open Questions** (3–6 weeks calendar)
- [ ] **0.6 — Smoke-test 1 burner domain end-to-end via Mailforge** (gates the whole Phase 1 warmup clock)
- [ ] **0.7 — Re-review plan with `plan-reviewer` after concrete vendor paths fill in** (only if vendor contracts surface architecture changes)
- [ ] **0.8 — Engage California mortgage-compliance counsel** (D20 mandatory)
- [ ] **0.9 — Provision 5 hot-standby mailboxes** (4-week pre-warm runway)
- [ ] **0.10 — Suppression-list seed-import from Lazer's FUB/legacy** (hard launch gate)

---

## ❓ How to use this doc

- **Before Phase 1 starts:** every Tier 1 item must be `✅ done` or have a documented exception.
- **During Phase 1:** Tier 2 items are blocking individual tasks; track per the "Blocked by" markers in `PLAN.md`.
- **After v1 ship:** revisit Tier 3 items that were deferred.

This doc is the single source of truth for "are we ready to build?" If something is here and not yet done, Phase 1 isn't ready. If it's not here and someone surfaces a new prerequisite, add it here first before letting it block.

---

**Companion docs:**
- `PRD-AMENDMENT.md` — what Lazer must sign
- `CHARGE-ABILITY.md` — engagement letter terms
- `COMPLIANCE.md` §10 — counsel engagement scope
- `VENDOR-CONTRACTS.md` — Phase 0.3 test plans per vendor
- `PLAN.md` §Phase 0 — task list with full DoDs
- `OPS-RUNBOOK.md` — for after Phase 1 launches
