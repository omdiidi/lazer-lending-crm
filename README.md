# Lazer Lending CRM

A Lazer-branded cold-outreach CRM for **Lazer Lending**, built by
**IntegrateAPI** by extending the **Connect CRM** working full-stack
scaffold.

> **Status (2026-05-11):** Backend fully deployed on Supabase project
> `cmubrsnhsxbrqxsjhxnx` — 10 migrations applied, 34 Edge Functions live,
> 5 pg_cron jobs scheduled, first admin user provisioned. Frontend runs
> on localhost. **Vendor credentials pending** — no live mail traffic yet.
>
> **New partner onboarding? Start at [`HANDOFF.md`](HANDOFF.md).**

## What this project is

A second CRM for Lazer Lending, dedicated to:

1. Running cold email campaigns safely at meaningful volume
2. Uploading, cleaning, and validating leads
3. Sending emails without damaging domain reputation
4. Capturing, classifying, and routing replies
5. Forwarding qualified replies to the right Lazer team member
6. Pushing only qualified warm leads into Follow Up Boss
7. Protecting deliverability aggressively

## Read-this-first

Start here, in order:

1. [`docs/lazer-lending/CONNECT-CRM-AUDIT-DELTA.md`](docs/lazer-lending/CONNECT-CRM-AUDIT-DELTA.md) — what Connect CRM actually is today (auth + RLS + 17 Edge Functions wired)
2. [`docs/lazer-lending/PRD.md`](docs/lazer-lending/PRD.md) — outcome spec
3. [`docs/lazer-lending/BRIEF-email-architecture.md`](docs/lazer-lending/BRIEF-email-architecture.md) — locked email/deliverability decisions
4. [`docs/lazer-lending/PLAN.md`](docs/lazer-lending/PLAN.md) — implementation plan
5. [`docs/lazer-lending/PLAN-REVIEW-NOTES.md`](docs/lazer-lending/PLAN-REVIEW-NOTES.md) — reviewer pass

## Architecture summary (the build, when it happens)

```
Lazer CRM (extends Connect CRM full-stack scaffold)
  │  React + Vite frontend ─── Supabase (Auth + Postgres + RLS + 17 Edge Functions)
  │
  ├─ cold engine    →  Smartlead Pro (campaign engine, NOT a transactional API)
  │                      └─ Zapmail: real Google Workspace mailboxes,
  │                         provisioning API, on burner domains
  │                         (lazer-loans.com, etc.).
  │                         Maildoso = fallback (shared SMTP); Mailforge
  │                         deprioritized (no provisioning API + 63%
  │                         inbox-placement headwind).
  │
  └─ transactional  →  Resend on notify.lazerlending.com
                         (already wired in Connect CRM's send-email
                          Edge Function — repointed for Lazer).
```

- **`lazerlending.com` never sends cold mail.** Brand domain stays clean.
- **Smartlead is a campaign engine** — sequences, warmup, reply webhook
  fan-out — not a per-message transactional API. The dispatcher in
  `process-campaigns` enrolls leads into Smartlead campaigns; Smartlead
  owns inter-send pacing.
- **Zapmail** supplies real Google Workspace mailboxes with a
  provisioning API for the burner-domain inventory.
- **Volume:** 300–500/day v1, scale path to ~1,000/day documented.

## Stack (Connect CRM, today)

- React 18 + TypeScript + Vite (SWC) + Tailwind + shadcn/ui
- React Router v6, React Query for data fetching across all entities
- Supabase Auth (real login), Postgres + RLS, 17 deployed Edge Functions
- pg_cron at every-5-minutes drives `process-campaigns` dispatcher
- Working warmup system (`warmup_state`, `claim_daily_send_budget`,
  per-tier daily caps) and Resend-based send engine already in place
- MCP server (`mcp-server/`) exposing CRM tools via API key auth
- Bun (package manager) · Vitest + Playwright (testing) · Netlify (deploy)

## Provenance

- **Connect CRM** scaffold: <https://github.com/nkpardon8-prog/connect-crm>
  (cloned 2026-04-30; preserved at repo root).
- **PRD authored by** Nick Pardon (IntegrateAPI), in conversation with
  Lazer Lending.
- **Plan + brief + review notes** generated through Claude Code
  `/discussion → /plan → /plan-reviewer` on 2026-04-30, refined by
  Phase A audit + 5 vendor-research passes on 2026-05-04. See
  `docs/lazer-lending/` for the full record.

## License

TBD with Lazer Lending and IntegrateAPI before any production deployment.
