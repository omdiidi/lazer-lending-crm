# Lazer Lending CRM — Documentation Index

This directory contains the **planning, architecture, and decision artifacts**
for the Lazer Lending CRM build. The codebase at the repo root is
**Connect CRM** (the agreed-upon scaffold), into which the Lazer-specific
sending/replies/FUB layer will be built per the plan below.

> **Implementation status:** No code changes have been written yet. Connect
> CRM is checked in as the starting state. The build can begin from this
> documentation.
>
> **v2.5 incorporates audit + research validation findings (May 2026).**
> See `PLAN-REVIEW-NOTES.md` for the change log.

## Read-this-first order

1. **`PRD.md`** — original outcome contract for Lazer Lending. Historical
   document — treat as the locked statement of *what* we ship; the email-layer
   and several v1 ship criteria have been amended (see PRD-AMENDMENT).
2. **`PRD-AMENDMENT.md`** — what's actually being built. Redlined PRD changes
   (subdomain rotation → burner pool, Resend cold sends → Smartlead, etc.).
   **Lazer must sign this** before Phase 1 begins.
3. **`EMAIL-FLOW.md`** — **start here for the email layer.** ~10-min read
   that explains how a cold email moves end-to-end: send path, reply path,
   why burner domains, why each vendor, where the failure recovery sits.
   Self-contained. Read this before BRIEF or PLAN if you just want to
   understand how email works.
4. **`BRIEF-email-architecture.md`** — locked email-layer decisions
   (D1–D10): Smartlead Pro headless API, Mailforge bulk Workspace,
   burner-domain pool, Resend transactional only, hot-standby mailbox
   inventory, per-state compliance footer engine, CA counsel pre-launch.
5. **`PLAN.md`** — implementer-ready plan v2.5 (4-lens audit + research
   validation applied; 21 edits over v2.1).
6. **`COMPLIANCE.md`** — federal + state compliance bible. **Read before
   first send.** CA § 17529.5 strict liability, per-state footer table,
   CCPA right-to-delete, NMLS specifics, attorney engagement.
7. **`CHARGE-ABILITY.md`** — pricing structure, termination clause, SLA,
   engagement letter terms. What IntegrateAPI charges and why.
8. **`VENDOR-CONTRACTS.md`** — webhook signing, retry semantics,
   idempotency contracts, rate limits per vendor (Smartlead, Mailforge,
   ZeroBounce, FUB, Resend, Anthropic). Filled where research has
   answers; flagged for Phase 0.3 verification where not.
9. **`WARMUP-CAPABILITY-MAP.md`** — table of PRD §5.2 warmup expectations
   mapped to Smartlead's actual capabilities, with verification source
   per row.
10. **`CONNECT-CRM-AUDIT-DELTA.md`** — Phase 0.1 deliverable: walks the
    Connect CRM scaffold against `CODEBASE_ANALYSIS.md`, fills in
    concrete file paths for every PLAN.md `[path TBD]` anchor.
11. **`OPS-RUNBOOK.md`** — incident-response runbook for the 10 most
    likely production incidents (single-mailbox complaint pause,
    Smartlead 429, Mailforge tenant deplatform, Anthropic API outage,
    DMARC RUA silent failure, state AG subpoena, etc.).
12. **`PLAN-REVIEW-NOTES.md`** — review history. v1 (2026-04-30, two
    `plan-reviewer` agents). v2 (2026-05-01, 4-lens audit + research
    validation). Useful to see what was considered and why.

## Repo layout

```
lazer-lending-crm/
├── (Connect CRM root files: package.json, src/, supabase/, etc.)
├── CODEBASE_ANALYSIS.md             ← Connect CRM's own self-audit
├── docs/
│   ├── (Connect CRM's existing docs: OVERVIEW.md, leads.md, ...)
│   └── lazer-lending/                ← all Lazer-specific planning artifacts
│       ├── README.md                 ← this file
│       ├── PRD.md
│       ├── PRD-AMENDMENT.md
│       ├── EMAIL-FLOW.md
│       ├── BRIEF-email-architecture.md
│       ├── PLAN.md
│       ├── COMPLIANCE.md
│       ├── CHARGE-ABILITY.md
│       ├── VENDOR-CONTRACTS.md
│       ├── WARMUP-CAPABILITY-MAP.md
│       ├── CONNECT-CRM-AUDIT-DELTA.md
│       ├── OPS-RUNBOOK.md
│       └── PLAN-REVIEW-NOTES.md
├── tmp/
│   ├── briefs/                       ← /discussion working dir
│   ├── ready-plans/                  ← /plan working dir
│   ├── done-plans/
│   ├── research/                     ← external validation research
│   └── review-notes/                 ← /plan-reviewer + audit outputs
└── README.md
```

## How to start the build

In order:

1. **Get Lazer's signature on `PRD-AMENDMENT.md`.** The architecture
   replacement (subdomain rotation → burner pool, Resend cold → Smartlead,
   etc.) is meaningful enough that the original PRD's seven outcomes are
   preserved but the *how* changed. No build begins without signoff.
2. **Review `COMPLIANCE.md`.** Engage California mortgage-compliance
   counsel before any send. Confirm per-state footer requirements with
   counsel. Confirm NMLS / SAFE Act baseline.
3. **Run Phase 0.5 client kickoff** (per `PLAN.md`) to close the
   Open Questions blocking Phase 1.
4. **Smoke-test the scaffold:**

   ```bash
   bun install
   bun run dev          # verify Connect CRM scaffold runs on port 8080
   ```

5. Then read `PLAN.md` Phase 0 in full and execute Tasks 0.1–0.10 in order.

## Provenance

- 2026-04-30 — `/discussion → /plan → /plan-reviewer` session: PRD review,
  email-architecture brief, plan v1 + v2 (two reviewer passes merged),
  Connect CRM clone + initial commit. Original session-state files in
  `tmp/briefs/`, `tmp/ready-plans/`, `tmp/review-notes/`.
- 2026-05-01 — 4-lens audit (`tmp/review-notes/2026-05-01-codex-feasibility-audit.md`)
  + research validation (`tmp/research/2026-05-01-feasibility-validation.md`)
  produced v2.5 doc cleanup. Plan re-mathed, three new locked decisions
  (D8/D9/D10), seven new docs created, all corrections traced to source.
