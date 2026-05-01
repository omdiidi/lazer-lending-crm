# Lazer Lending CRM

A Lazer-branded cold-outreach CRM for **Lazer Lending**, built by
**IntegrateAPI** on top of the **Connect CRM** scaffold.

> **Status: documentation only.** No Lazer-specific code has been written
> yet. The repo currently contains Connect CRM as the starting state plus
> a complete implementation plan. Build is deferred until the plan is
> approved to proceed.

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

Start here: **[`docs/lazer-lending/`](docs/lazer-lending/)**

In particular:

- [`docs/lazer-lending/PRD.md`](docs/lazer-lending/PRD.md) — outcome spec
- [`docs/lazer-lending/BRIEF-email-architecture.md`](docs/lazer-lending/BRIEF-email-architecture.md) — locked email/deliverability decisions
- [`docs/lazer-lending/PLAN.md`](docs/lazer-lending/PLAN.md) — implementation plan
- [`docs/lazer-lending/PLAN-REVIEW-NOTES.md`](docs/lazer-lending/PLAN-REVIEW-NOTES.md) — reviewer pass

## Architecture summary (the build, when it happens)

```
Lazer CRM (extends Connect CRM scaffold; React + Vite + Supabase)
  ├─ cold engine  →  Smartlead Pro API (headless)
  │                    └─ Mailforge: Google Workspace mailboxes
  │                       on burner domains (lazer-loans.com, etc.)
  └─ transactional →  Resend (free tier)
                        on notify.lazerlending.com
```

- **`lazerlending.com` never sends cold mail.** Brand domain stays clean.
- **Smartlead** runs the MTA, warmup, and webhook layer; we own the CRM,
  reply classifier, and FUB sync.
- **Mailforge** supplies the Workspace mailbox and DNS inventory.
- **Volume:** 100–300/day v1, scale path to ~1,000/day documented.

## Stack (inherited from Connect CRM)

- React 18 + TypeScript + Vite (SWC) + Tailwind + shadcn/ui
- React Router v6, React Context for state
- Supabase (configured; not yet wired into the React app)
- Bun (package manager)
- Vitest + Playwright (testing)
- Netlify (deployment)

## Provenance

- **Connect CRM** scaffold: <https://github.com/nkpardon8-prog/connect-crm>
  (cloned in 2026-04-30; preserved at repo root).
- **PRD authored by** Nick Pardon (IntegrateAPI), in conversation with
  Lazer Lending.
- **Plan + brief + review notes** generated through a Claude Code
  `/discussion → /plan → /plan-reviewer` session on 2026-04-30; see
  `docs/lazer-lending/` for the full record.

## License

TBD with Lazer Lending and IntegrateAPI before any production deployment.
