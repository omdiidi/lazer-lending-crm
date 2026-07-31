# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Lazer Lending CRM — a cold-outreach CRM for a residential mortgage broker, built by IntegrateAPI on top of the **Connect CRM** full-stack scaffold. The core job is to send cold email safely at volume from disposable "burner" domains (never the brand domain), classify replies, and push only qualified warm leads into Follow Up Boss.

**Read `HANDOFF.md` first** for project status, blockers, and live ops commands. Design/ops docs live in `docs/lazer-lending/` (PRD.md, PLAN.md ~1100 lines is canonical, BRIEF-email-architecture.md, EMAIL-FLOW.md, COMPLIANCE.md, OPS-RUNBOOK.md).

## Commands

```bash
npm run dev          # Vite dev server → http://localhost:8080
npm run build        # production build
npm run build:dev    # development-mode build
npm run lint         # eslint
npm run test         # vitest run (single pass)
npm run test:watch   # vitest watch mode
npx vitest run src/test/foo.test.ts   # run a single test file
```

Live backend (Supabase project ref `cmubrsnhsxbrqxsjhxnx`):
```bash
supabase secrets set KEY=value --project-ref cmubrsnhsxbrqxsjhxnx   # push vendor key to edge functions
supabase functions deploy <name> --project-ref cmubrsnhsxbrqxsjhxnx # deploy one edge function
supabase db push --linked                                           # apply new migration (no Docker)
```

## Architecture

Two halves: a **React/Vite frontend** and a **Supabase backend** (Postgres + RLS + Edge Functions + pg_cron). They share the same database; the frontend talks to it via the JS client, edge functions handle privileged work and vendor webhooks.

### Frontend (`src/`)
- React 18 + TypeScript + Vite (SWC) + Tailwind + shadcn/ui. Path alias `@/` → `src/`.
- **Routing** in `src/App.tsx`: `AuthGate` gates all routes behind Supabase Auth (`src/contexts/AuthContext.tsx`). Authed routes render inside `AppLayout`. `/unsubscribe/:token` is public.
- **Data layer is layered, do not skip layers:**
  - `src/lib/api/*.ts` — typed Supabase query functions (one file per entity: leads, campaigns, mailboxes, domains, replies, etc.).
  - `src/hooks/use-*.ts` — React Query hooks wrapping the api layer. **Components fetch via these hooks, never call Supabase directly.** Mutations auto-invalidate cache; many hooks subscribe to Supabase Realtime for live multi-user updates.
  - `src/pages/*` — route components; derive filtered data with `useMemo`.
- `src/lib/supabase.ts` is the singleton client (reads `VITE_SUPABASE_*` env vars).
- `src/lib/transforms.ts` maps snake_case DB rows ↔ camelCase app types. Types in `src/types/` (`database.ts` is generated from schema; regenerate after migrations).

### Backend (`supabase/`)
- `migrations/` — applied in order. `20260101000000_connect_crm_base.sql` is the inherited scaffold; the `2026050500000X_lazer_*` migrations add the cold-email layer (domains, mailboxes, sending_pools, pool_memberships, webhook_events, replies, suppressions, slot reservations, RPC functions, pg_cron jobs, realtime publications).
- `functions/` — 34 Deno Edge Functions. Shared helpers in `functions/_shared/` (`auth.ts` resolves a user from either a JWT or a `crm_`-prefixed API key; `cors.ts`, `classifier.ts`, `fub.ts`, `list-unsub-token.ts`, `bounce-cascade.ts`). Key functions: `process-campaigns` (cron dispatcher), `send-email`, `classify-reply`, `smartlead-events`/`email-events`/`fub-events` (webhooks), `mailbox-watchdog`, `smartlead-reconcile`. The `api-*` functions back the MCP server.
- **pg_cron** drives the pipeline: `process-campaigns` runs every 5 min to enroll due sends; plus cap-reset, dns-health-check, webhook-replay, smartlead-reconcile.

### Email pipeline (the heart of the system)
Outbound: operator launches campaign → sends enqueued → cron dispatcher atomically claims a mailbox slot from the campaign's sending pool (`FOR UPDATE SKIP LOCKED` + daily-cap check, two-phase reservation) → POSTs to **Smartlead**, which sends from real Google Workspace mailboxes on burner domains via OAuth. Inbound: Smartlead webhook → fast 200 + `webhook_events` insert (idempotent) → async worker classifies the reply (regex unsubscribe pre-filter, then Claude with PII redacted) → suppress/stop-on-reply → forward to team → push to FUB only if positive. See `docs/lazer-lending/EMAIL-FLOW.md` for the full diagram and rationale.

Vendors: **Smartlead** (cold engine), **Zapmail/Mailforge** (burner-domain mailboxes), **Resend** (transactional only, on `notify.lazerlending.com`), **ZeroBounce** (validation), **Claude/OpenRouter** (classifier), **Follow Up Boss** (downstream CRM).

### MCP server (`mcp-server/`)
Local Node MCP server exposing CRM tools to Claude Code agents, authed via a `crm_` API key, hitting the same live Supabase DB as the web app (no sync layer). See `mcp-server/README.md`.

## Conventions

- Data fetching only through React Query hooks; never call `supabase` directly from a component.
- Never pass `id` to create/insert functions — the DB generates UUIDs.
- Role-based scoping (admin vs employee) is enforced by **RLS at the database level** — do not filter client-side by role.
- Tailwind utility classes only; colors via HSL CSS custom properties in `index.css`. Icons from `lucide-react` exclusively.
- New list items prepend (newest first): `[newItem, ...prev]`.
- The repo is **public** on GitHub — `.env` is gitignored; never commit secrets. Never push without explicit approval.

## Doc-sync expectation

`docs/OVERVIEW.md` is a documentation index with a file-to-doc map and changelog. When changing source files that map to a feature doc, update that doc and add a changelog entry (per the convention in `docs/OVERVIEW.md`). Note: parts of `docs/` describe the inherited Connect CRM scaffold (e.g. "frontend-only", "mock users") and predate the Lazer backend — treat `docs/lazer-lending/` and `HANDOFF.md` as authoritative for current state.


## Custom Skills & Shortcuts

Whenever the user types `/dive`, perform a thorough, high-level architectural review of this project. Focus on providing a 30,000-foot mental model with easy analogies, mapping the codebase domains (Brain, Nervous System, Boundaries), identifying the main entry points, and tracking a primary data lifecycle without using dense technical jargon.