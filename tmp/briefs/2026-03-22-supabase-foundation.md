# Brief: Supabase Foundation Pass

## Why
The CRM app is 100% mock data — nothing persists, no real auth, no database. Every feature depends on a persistence and identity layer. This foundation pass sets up the database schema, auth, RLS, client wiring, seed data, and API layer so we can start converting features one by one.

## Context
- App: React 18 + TypeScript + Vite + shadcn/ui
- Supabase project: `onthjkzdgsfvmgyhrorw` (CRM, us-east-1, ACTIVE_HEALTHY)
- Existing types in `src/types/crm.ts` define 9 entities: User, Lead, Activity, EmailMessage, Deal, EmailSequence, SequenceStep, AISuggestion, Campaign
- Mock data in `src/data/mockData.ts`: 3 users, 22 leads, 15 activities, 18 emails, 10 deals, 8 suggestions, 2 sequences, 2 campaigns
- State managed via `AuthContext` + `CRMContext` (React Context, useState, in-memory)
- Role-based access: admin sees all, employee sees assigned-only
- Existing mock credentials: sarah@integrateapi.ai/admin123, marcus@integrateapi.ai/employee123, aisha@integrateapi.ai/employee123

## Decisions
- **Campaign recipients as array** — use Postgres `text[]` on campaigns table. Simpler than a junction table; normalize later if query patterns demand it.
- **Profile auto-creation via trigger** — database trigger on `auth.users` insert creates matching `profiles` row. Supports future self-registration.
- **Snake case in DB** — Postgres convention. Add a transform/mapping utility in the frontend to convert between snake_case (DB) and camelCase (TypeScript).
- **Timestamps on all tables** — `created_at` (default now()) and `updated_at` (auto-updated via trigger) on every table.
- **Soft deletes** — `deleted_at` column on leads, deals, campaigns, emails. Null = active, timestamp = deleted.
- **Flat email threading** — keep `thread_id`/`reply_to_id` on emails table. No separate threads table. Refactor when real email provider is integrated.
- **API layer scaffold** — create `src/lib/api/` with one file per entity (leads.ts, deals.ts, emails.ts, etc.) exporting typed query functions. Components will import from here, not call Supabase directly.
- **Real-time enabled** — enable Supabase Realtime on leads, deals, activities, emails tables. Schema uses simple primary keys (UUIDs) to support this cleanly.
- **RLS policies** — admin role gets full access. Employee role scoped to assigned_to = auth.uid() for leads/deals, unrestricted read for shared data (emails, campaigns). Role checked via profiles table.

## Rejected Alternatives
- **Junction table for campaign recipients** — over-engineering for current simple "list recipients" usage
- **CamelCase in DB** — goes against Postgres conventions, causes issues with Supabase tooling and raw SQL
- **Manual profile creation (no trigger)** — user wanted trigger for future extensibility
- **Separate email_threads table** — premature; don't know what real email integration will look like yet
- **Skip API layer** — would lead to Supabase calls scattered across components, harder to maintain

## Direction
Build the complete Supabase foundation in one pass: schema (all tables with FKs, indexes, timestamps, soft deletes), RLS policies (admin/employee pattern), auth (email/password + profile trigger), frontend wiring (supabase client + env vars), API layer scaffold (src/lib/api/), seed data (migrate all mock data), and real-time enabled on key tables. Document everything in docs/schema.md with cross-references from other doc files.
