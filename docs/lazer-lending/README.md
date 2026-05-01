# Lazer Lending CRM — Documentation Index

This directory contains the **planning, architecture, and decision artifacts**
for the Lazer Lending CRM build. The codebase at the repo root is
**Connect CRM** (the agreed-upon scaffold), into which the Lazer-specific
sending/replies/FUB layer will be built per the plan below.

> **Implementation status:** No code changes have been written yet. Connect
> CRM is checked in as the starting state. The build can begin from this
> documentation.

## Read-this-first order

1. **`PRD.md`** — original outcome spec for Lazer Lending. Treat as
   contract for *what* we ship; the email-layer architecture has been
   revised (see brief).
2. **`BRIEF-email-architecture.md`** — outcome of the architecture
   discussion. Settles the email/deliverability layer:
   - **Smartlead Pro** as the cold sending engine (headless API)
   - **Mailforge** for Workspace mailbox + DNS inventory
   - **Burner domains** (e.g. `lazer-loans.com`) — never `lazerlending.com`
     for cold
   - **Resend** for transactional only on `notify.lazerlending.com`
   - **100–300/day** v1 target; documented scale path to 1,000/day
3. **`PLAN.md`** — full implementation plan (v2.1 — incorporates two
   plan-reviewer passes plus post-clone Connect-CRM audit).
4. **`PLAN-REVIEW-NOTES.md`** — merged findings from two parallel
   `plan-reviewer` agents and how each was resolved. Useful for an
   implementer to see what was considered and why.
5. **`CONNECT-CRM-AUDIT-DELTA.md`** — to be written in Phase 0, capturing
   any drift between `CODEBASE_ANALYSIS.md` and the live code.
6. **`VENDOR-CONTRACTS.md`** — to be written in Phase 0.3, capturing
   Smartlead/Mailforge/ZeroBounce/FUB/Resend webhook + retry + idempotency
   contracts.

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
│       ├── BRIEF-email-architecture.md
│       ├── PLAN.md
│       └── PLAN-REVIEW-NOTES.md
├── tmp/
│   ├── briefs/                       ← /discussion working dir
│   ├── ready-plans/                  ← /plan working dir
│   ├── done-plans/
│   └── review-notes/                 ← /plan-reviewer outputs
└── README.md
```

## How to start the build

The plan's Phase 0 includes the steps. In short:

```bash
bun install
bun run dev          # verify the scaffold runs
# then read docs/lazer-lending/PLAN.md and start Phase 0
```

## Provenance

This directory was created in a single `/discussion → /plan → /plan-reviewer`
session on 2026-04-30. The original session-state files live in `tmp/`
(briefs, ready-plans, review-notes). The copies under `docs/lazer-lending/`
are the canonical versions for an implementer; the `tmp/` versions are
preserved for workflow continuity (Claude Code's `/plan` and related
commands look there).
