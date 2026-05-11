# Lazer Lending CRM — Documentation Index

This directory holds the **planning, architecture, and decision artifacts** for the Lazer Lending CRM build. The codebase is **Connect CRM** extended with the Lazer-specific cold-outreach + reply-classification + FUB push layer. Connect CRM is a working full-stack CRM with a wired Supabase backend, RLS, deployed Edge Functions, working warmup logic, and a Resend-based send engine.

**New to the project?** Start at `/HANDOFF.md` at the repo root, not here.

## Read-this-first order

1. **`PRD.md`** — outcome contract for Lazer Lending. What we ship.
2. **`CONNECT-CRM-AUDIT-DELTA.md`** — real state of the Connect CRM scaffold; what exists vs. what gets built on top.
3. **`BRIEF-email-architecture.md`** — locked architecture decisions (D1–D10).
4. **`PLAN.md`** — full implementation plan (canonical, v3).
5. **`VENDOR-CONTRACTS.md`** — per-vendor auth, rate limits, webhook signing, gotchas.
6. **`CREDENTIALS.md`** — paste-and-go credential checklist.
7. **`BLOCKED-AWAITING-CLIENT.md`** — what cannot complete without Lazer client input.
8. **`COMPLIANCE.md`** — CAN-SPAM, NMLS, CFPB retention.
9. **`EMAIL-FLOW.md`** — outbound + inbound pipeline diagrams.
10. **`OPS-RUNBOOK.md`** — incident response, vendor breakage recovery.
11. **`WARMUP-CAPABILITY-MAP.md`** — per-mailbox warmup state machine.
12. **`incidents/`** — incident postmortems.

Archived v2.5-era docs live under `_archive/` for historical context only.

## Architecture summary

**Send layer.** Cold mail exits through **Smartlead campaigns** (Smartlead is a campaign engine — we enroll leads, Smartlead dispatches). Mailboxes are real **Google Workspace** seats provisioned through **Zapmail** on burner domains (e.g. `lazer-loans.com`); `lazerlending.com` never sends cold mail. **Resend** stays for transactional only on `notify.lazerlending.com`.

**Reply layer — store-and-notify.** Replies land in the real Workspace mailbox, Smartlead's reply webhook fires the CRM, replies live only in the CRM. Team gets a Resend notification with classification + first sentence + CRM link.

**Classifier — two-stage.** Keyword pre-classifier handles ~70% of replies; LLM (OpenRouter → `anthropic/claude-sonnet-4.6`) handles the ambiguous ~30% with PII redacted.

**Compliance.** RFC 8058 List-Unsubscribe with HMAC tokens. Signal-based DMARC ramp (14 days clean DKIM + ≥500 sends → `p=quarantine`). Wilson lower-bound watchdog at 95% conf for bounce/complaint.

## Volume target

**v1: 300–500/day** across ~10–15 mailboxes on 4–5 burner domains, 30/day per warmed mailbox. Scale path to 1,000/day documented; not pre-built.

## Provenance

- **2026-04-30** — `/discussion → /plan → /plan-reviewer` produced v1 brief + plan.
- **2026-05-04** — Second-pass research: Smartlead campaign-engine model, Zapmail pivot, Resend AUP under Gmail Nov 2025 enforcement. PLAN regenerated to v3.
- **2026-05-06** — Lazer Supabase project `cmubrsnhsxbrqxsjhxnx` provisioned, 10 migrations applied, 34 Edge Functions deployed, first admin user bootstrapped, DevTools-driven smoke test + 7-bug-fix pass + polish pass.
- **2026-05-11** — Repo cleanup; partner handoff.
