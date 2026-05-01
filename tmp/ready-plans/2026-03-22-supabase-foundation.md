# Plan: Supabase Foundation Pass

**Confidence: 9/10** — Well-defined data model, clear decisions from brief, straightforward Supabase setup.

## Files Being Changed

```
connect-crm/
├── .env                                ← NEW (Supabase URL + anon key)
├── .env.example                        ← NEW (template without secrets)
├── .gitignore                          ← MODIFIED (add .env)
├── package.json                        ← MODIFIED (add @supabase/supabase-js)
├── src/
│   ├── lib/
│   │   ├── supabase.ts                 ← NEW (Supabase client singleton)
│   │   └── transforms.ts              ← NEW (snake_case ↔ camelCase utils)
│   ├── lib/api/
│   │   ├── profiles.ts                ← NEW (profile query functions)
│   │   ├── leads.ts                   ← NEW (lead CRUD functions)
│   │   ├── activities.ts              ← NEW (activity query/create functions)
│   │   ├── emails.ts                  ← NEW (email CRUD functions)
│   │   ├── deals.ts                   ← NEW (deal CRUD functions)
│   │   ├── suggestions.ts            ← NEW (suggestion query/dismiss functions)
│   │   ├── campaigns.ts              ← NEW (campaign CRUD functions)
│   │   └── sequences.ts              ← NEW (sequence query functions)
│   └── types/
│       └── database.ts                ← NEW (Supabase-generated types)
├── docs/
│   ├── OVERVIEW.md                    ← MODIFIED (add schema.md to index + major changes)
│   ├── architecture.md                ← MODIFIED (add Supabase to tech stack)
│   ├── data-model.md                  ← MODIFIED (point to schema.md)
│   ├── state-management.md            ← MODIFIED (note supabase client)
│   └── schema.md                      ← NEW (full DB documentation)
└── supabase/
    └── seed.sql                        ← NEW (seed data for reference)
```

---

## Architecture Overview

### Current State
```
React App → AuthContext (mock) → CRMContext (useState + mockData) → Pages
```

### After This Pass
```
React App → AuthContext (mock, unchanged) → CRMContext (mock, unchanged) → Pages
                                                        ↓ (ready for next pass)
Supabase DB ← src/lib/api/*.ts ← src/lib/supabase.ts ← .env
     ↕
  RLS Policies (role from profiles table)
     ↕
  Supabase Auth (3 seed users)
```

**Key point:** This pass does NOT swap any features. The mock contexts remain active. We are laying the complete foundation so that when we swap features one-by-one, every piece is in place.

### Data flow (after feature swap, for reference):
```
Page Component
  → calls src/lib/api/leads.ts::getLeads()
    → calls supabase.from('leads').select()
      → Supabase applies RLS (checks auth.uid() + role from profiles)
        → Returns snake_case rows
    → transforms.toCamelCase() converts to TypeScript interface
  → Returns Lead[]
```

---

## Task 1: Database Schema Migration

Create all tables via Supabase MCP `apply_migration`.

### Migration: `001_initial_schema`

```sql
-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  role text not null default 'employee' check (role in ('admin', 'employee')),
  avatar text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- LEADS
-- ============================================================
create table public.leads (
  id uuid primary key default uuid_generate_v4(),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null default '',
  job_title text not null default '',
  company text not null default '',
  company_size text not null default '',
  industry text not null default '',
  location text not null default '',
  status text not null default 'cold' check (status in ('cold', 'lukewarm', 'warm', 'dead')),
  assigned_to uuid not null references public.profiles(id),
  last_contacted_at timestamptz,
  notes text not null default '',
  tags text[] not null default '{}',
  linkedin_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index idx_leads_assigned_to on public.leads(assigned_to);
create index idx_leads_status on public.leads(status);
create index idx_leads_industry on public.leads(industry);
create index idx_leads_deleted_at on public.leads(deleted_at) where deleted_at is null;

-- ============================================================
-- ACTIVITIES
-- ============================================================
create table public.activities (
  id uuid primary key default uuid_generate_v4(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  type text not null check (type in ('call', 'email_sent', 'email_received', 'note', 'status_change', 'meeting')),
  description text not null default '',
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_activities_lead_id on public.activities(lead_id);
create index idx_activities_user_id on public.activities(user_id);
create index idx_activities_type on public.activities(type);

-- ============================================================
-- EMAILS
-- ============================================================
create table public.emails (
  id uuid primary key default uuid_generate_v4(),
  lead_id uuid references public.leads(id) on delete set null,
  "from" text not null,
  "to" text not null,
  subject text not null default '',
  body text not null default '',
  sent_at timestamptz not null default now(),
  read boolean not null default false,
  direction text not null check (direction in ('inbound', 'outbound')),
  thread_id text,
  reply_to_id uuid references public.emails(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index idx_emails_lead_id on public.emails(lead_id);
create index idx_emails_thread_id on public.emails(thread_id);
create index idx_emails_direction on public.emails(direction);
create index idx_emails_deleted_at on public.emails(deleted_at) where deleted_at is null;

-- ============================================================
-- DEALS
-- ============================================================
create table public.deals (
  id uuid primary key default uuid_generate_v4(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  title text not null,
  value numeric(12,2) not null default 0,
  stage text not null default 'new' check (stage in ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost')),
  assigned_to uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index idx_deals_lead_id on public.deals(lead_id);
create index idx_deals_assigned_to on public.deals(assigned_to);
create index idx_deals_stage on public.deals(stage);
create index idx_deals_deleted_at on public.deals(deleted_at) where deleted_at is null;

-- ============================================================
-- AI SUGGESTIONS
-- ============================================================
create table public.ai_suggestions (
  id uuid primary key default uuid_generate_v4(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  suggestion text not null,
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_ai_suggestions_lead_id on public.ai_suggestions(lead_id);
create index idx_ai_suggestions_dismissed on public.ai_suggestions(dismissed) where dismissed = false;

-- ============================================================
-- CAMPAIGNS
-- ============================================================
create table public.campaigns (
  id uuid primary key default uuid_generate_v4(),
  subject text not null,
  body text not null,
  recipient_ids uuid[] not null default '{}',
  sent_at timestamptz not null default now(),
  sent_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index idx_campaigns_sent_by on public.campaigns(sent_by);
create index idx_campaigns_deleted_at on public.campaigns(deleted_at) where deleted_at is null;

-- ============================================================
-- EMAIL SEQUENCES
-- ============================================================
create table public.email_sequences (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_by uuid not null references public.profiles(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- SEQUENCE STEPS
-- ============================================================
create table public.sequence_steps (
  id uuid primary key default uuid_generate_v4(),
  sequence_id uuid not null references public.email_sequences(id) on delete cascade,
  "order" integer not null,
  subject text not null default '',
  body text not null default '',
  delay_days integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_sequence_steps_sequence_id on public.sequence_steps(sequence_id);
```

### Migration: `002_updated_at_trigger`

```sql
-- Auto-update updated_at on any row change
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply to all tables
create trigger set_updated_at before update on public.profiles
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.leads
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.activities
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.emails
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.deals
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.ai_suggestions
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.campaigns
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.email_sequences
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.sequence_steps
  for each row execute function public.handle_updated_at();
```

### Migration: `003_profile_trigger`

```sql
-- Auto-create profile when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'employee')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

---

## Task 2: Row Level Security

### Migration: `004_rls_policies`

```sql
-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.activities enable row level security;
alter table public.emails enable row level security;
alter table public.deals enable row level security;
alter table public.ai_suggestions enable row level security;
alter table public.campaigns enable row level security;
alter table public.email_sequences enable row level security;
alter table public.sequence_steps enable row level security;

-- Helper: check if current user is admin
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

-- ============================================================
-- PROFILES: everyone reads all profiles, update own only
-- ============================================================
create policy "profiles_select" on public.profiles
  for select using (true);
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

-- ============================================================
-- LEADS: admin = all, employee = assigned only
-- ============================================================
create policy "leads_select" on public.leads
  for select using (
    public.is_admin() or assigned_to = auth.uid()
  );
create policy "leads_insert" on public.leads
  for insert with check (true);
create policy "leads_update" on public.leads
  for update using (
    public.is_admin() or assigned_to = auth.uid()
  );
create policy "leads_delete" on public.leads
  for delete using (public.is_admin());

-- ============================================================
-- ACTIVITIES: read if you can see the lead, insert freely
-- ============================================================
create policy "activities_select" on public.activities
  for select using (
    public.is_admin() or user_id = auth.uid()
    or exists (
      select 1 from public.leads
      where leads.id = activities.lead_id and leads.assigned_to = auth.uid()
    )
  );
create policy "activities_insert" on public.activities
  for insert with check (true);

-- ============================================================
-- EMAILS: all authenticated users can read/write
-- ============================================================
create policy "emails_select" on public.emails
  for select using (auth.uid() is not null);
create policy "emails_insert" on public.emails
  for insert with check (auth.uid() is not null);
create policy "emails_update" on public.emails
  for update using (auth.uid() is not null);

-- ============================================================
-- DEALS: admin = all, employee = assigned only
-- ============================================================
create policy "deals_select" on public.deals
  for select using (
    public.is_admin() or assigned_to = auth.uid()
  );
create policy "deals_insert" on public.deals
  for insert with check (true);
create policy "deals_update" on public.deals
  for update using (
    public.is_admin() or assigned_to = auth.uid()
  );

-- ============================================================
-- AI SUGGESTIONS: same as leads (tied to lead ownership)
-- ============================================================
create policy "suggestions_select" on public.ai_suggestions
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.leads
      where leads.id = ai_suggestions.lead_id and leads.assigned_to = auth.uid()
    )
  );
create policy "suggestions_update" on public.ai_suggestions
  for update using (
    public.is_admin()
    or exists (
      select 1 from public.leads
      where leads.id = ai_suggestions.lead_id and leads.assigned_to = auth.uid()
    )
  );

-- ============================================================
-- CAMPAIGNS: all authenticated can read/write
-- ============================================================
create policy "campaigns_select" on public.campaigns
  for select using (auth.uid() is not null);
create policy "campaigns_insert" on public.campaigns
  for insert with check (auth.uid() is not null);

-- ============================================================
-- SEQUENCES + STEPS: all authenticated can read
-- ============================================================
create policy "sequences_select" on public.email_sequences
  for select using (auth.uid() is not null);
create policy "sequences_insert" on public.email_sequences
  for insert with check (auth.uid() is not null);
create policy "steps_select" on public.sequence_steps
  for select using (auth.uid() is not null);
create policy "steps_insert" on public.sequence_steps
  for insert with check (auth.uid() is not null);
```

---

## Task 3: Enable Realtime

### Migration: `005_enable_realtime`

```sql
-- Enable realtime on key tables
alter publication supabase_realtime add table public.leads;
alter publication supabase_realtime add table public.deals;
alter publication supabase_realtime add table public.activities;
alter publication supabase_realtime add table public.emails;
```

---

## Task 4: Create Auth Users + Seed Data

### 4a: Create Auth Users

Use Supabase's `execute_sql` to create auth users with known passwords. We need the resulting UUIDs to seed all other data.

**Approach:** Use `auth.users` insert via service role (execute_sql has service role). Store the UUIDs in variables for the seed data.

```sql
-- Create auth users with specific UUIDs for predictable seeding
-- We'll use generate deterministic UUIDs based on the email
-- This makes the seed data repeatable

-- Sarah Chen (admin)
insert into auth.users (
  id, instance_id, email, encrypted_password,
  email_confirmed_at, raw_user_meta_data, role, aud,
  created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'sarah@integrateapi.ai',
  crypt('admin123', gen_salt('bf')),
  now(),
  '{"name": "Sarah Chen", "role": "admin"}'::jsonb,
  'authenticated', 'authenticated',
  now(), now()
);

-- Marcus Rivera (employee)
insert into auth.users (
  id, instance_id, email, encrypted_password,
  email_confirmed_at, raw_user_meta_data, role, aud,
  created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'marcus@integrateapi.ai',
  crypt('employee123', gen_salt('bf')),
  now(),
  '{"name": "Marcus Rivera", "role": "employee"}'::jsonb,
  'authenticated', 'authenticated',
  now(), now()
);

-- Aisha Patel (employee)
insert into auth.users (
  id, instance_id, email, encrypted_password,
  email_confirmed_at, raw_user_meta_data, role, aud,
  created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'aisha@integrateapi.ai',
  crypt('employee123', gen_salt('bf')),
  now(),
  '{"name": "Aisha Patel", "role": "employee"}'::jsonb,
  'authenticated', 'authenticated',
  now(), now()
);
```

The profile trigger (`handle_new_user`) will auto-create profiles rows from the `raw_user_meta_data`.

**UUID mapping (used throughout seed data):**
- `u1` (Sarah) → `00000000-0000-0000-0000-000000000001`
- `u2` (Marcus) → `00000000-0000-0000-0000-000000000002`
- `u3` (Aisha) → `00000000-0000-0000-0000-000000000003`

### 4b: Seed CRM Data

Insert all mock data with the auth UUIDs. The seed SQL will:
1. Insert 22 leads (with UUID PKs, referencing profile UUIDs for assigned_to)
2. Insert 15 activities
3. Insert 18 emails
4. Insert 10 deals
5. Insert 8 AI suggestions
6. Insert 2 email sequences + 5 sequence steps
7. Insert 2 campaigns

**Lead UUID mapping pattern:** `'10000000-0000-0000-0000-00000000000' || N` for lead IDs (l1→...0001, l22→...0022)

The full seed SQL will be generated from mockData.ts, translating:
- camelCase field names → snake_case column names
- Mock IDs (l1, a1, e1, d1, etc.) → deterministic UUIDs
- Mock user IDs (u1, u2, u3) → auth user UUIDs

This will be saved as `supabase/seed.sql` for reference and re-seeding.

---

## Task 5: Frontend Wiring

### 5a: Install Supabase Client

```bash
npm install @supabase/supabase-js
```

### 5b: Environment Variables

**`.env`:**
```
VITE_SUPABASE_URL=https://onthjkzdgsfvmgyhrorw.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9udGhqa3pkZ3Nmdm1neWhyb3J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzk0MTQsImV4cCI6MjA4OTgxNTQxNH0.b0Sd3thLMdQZ_oIJU4n4lA3Gr_BOK5dOMNVTCH52b2Y
```

**`.env.example`:**
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 5c: Supabase Client — `src/lib/supabase.ts`

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

### 5d: Transform Utils — `src/lib/transforms.ts`

```typescript
// snake_case → camelCase
export function toCamelCase<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key in obj) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const value = obj[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      result[camelKey] = toCamelCase(value as Record<string, unknown>);
    } else {
      result[camelKey] = value;
    }
  }
  return result;
}

// camelCase → snake_case
export function toSnakeCase<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key in obj) {
    const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    result[snakeKey] = obj[key];
  }
  return result;
}

// Transform array of rows
export function transformRows<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map(row => toCamelCase(row) as T);
}
```

### 5e: Database Types — `src/types/database.ts`

Generate via Supabase MCP `generate_typescript_types`. This gives us the raw DB types. Our existing `src/types/crm.ts` types (camelCase) remain as the app-facing interfaces.

---

## Task 6: API Layer — `src/lib/api/`

Each file exports typed async functions. Pattern:

```typescript
// src/lib/api/leads.ts
import { supabase } from '@/lib/supabase';
import { transformRows, toSnakeCase } from '@/lib/transforms';
import type { Lead } from '@/types/crm';

export async function getLeads(userId?: string, isAdmin = false) {
  let query = supabase
    .from('leads')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  // RLS handles filtering, but we can also filter client-side for clarity
  const { data, error } = await query;
  if (error) throw error;
  return transformRows<Lead>(data || []);
}

export async function getLead(id: string) { ... }
export async function createLead(lead: Partial<Lead>) { ... }
export async function updateLead(id: string, updates: Partial<Lead>) { ... }
export async function deleteLead(id: string) { ... } // soft delete
```

**Files to create:**

| File | Functions |
|------|-----------|
| `profiles.ts` | `getProfiles`, `getProfile`, `updateProfile` |
| `leads.ts` | `getLeads`, `getLead`, `createLead`, `updateLead`, `deleteLead` |
| `activities.ts` | `getActivities`, `getActivitiesByLead`, `createActivity` |
| `emails.ts` | `getEmails`, `getEmail`, `createEmail`, `updateEmail`, `deleteEmail` |
| `deals.ts` | `getDeals`, `getDeal`, `createDeal`, `updateDeal`, `deleteDeal` |
| `suggestions.ts` | `getSuggestions`, `getSuggestionsByLead`, `dismissSuggestion` |
| `campaigns.ts` | `getCampaigns`, `createCampaign` |
| `sequences.ts` | `getSequences`, `getSequenceWithSteps` |

Each function:
1. Calls supabase client
2. Handles errors (throw on error)
3. Transforms snake_case response → camelCase via `transformRows()`
4. Transforms camelCase input → snake_case via `toSnakeCase()` on writes

---

## Task 7: Documentation

### New: `docs/schema.md`

Full DB reference including:
- Table definitions (columns, types, constraints, defaults)
- Indexes
- RLS policies summary
- Triggers (updated_at, profile creation)
- Realtime-enabled tables
- UUID mapping strategy
- snake↔camel convention
- Changelog

### Updates to existing docs:

**`docs/OVERVIEW.md`:**
- Add `schema.md` to Feature Index
- Add new source files to File-to-Documentation Map (`src/lib/supabase.ts`, `src/lib/transforms.ts`, `src/lib/api/*.ts`, `src/types/database.ts`, `.env`)
- Add Major Changes Log entry: "Supabase foundation: database schema, RLS, auth, API layer"

**`docs/architecture.md`:**
- Add Supabase to tech stack table
- Add `.env` to file map
- Add `src/lib/supabase.ts` and `src/lib/api/` to file map
- Note snake_case transform convention

**`docs/data-model.md`:**
- Add note that types map to real database tables
- Point to `schema.md` for DB column details
- Document UUID mapping for seed data

**`docs/state-management.md`:**
- Note `src/lib/supabase.ts` client exists
- Note `src/lib/api/` layer exists
- Note these are not yet wired to contexts (next phase)

---

## Task Execution Order

1. **Apply migration 001** — Create all tables
2. **Apply migration 002** — updated_at triggers
3. **Apply migration 003** — profile auto-creation trigger
4. **Apply migration 004** — RLS policies
5. **Apply migration 005** — Enable realtime
6. **Create auth users** — 3 users with deterministic UUIDs
7. **Seed data** — Insert all mock data with UUID references
8. **Install supabase-js** — npm install
9. **Create .env + .env.example** — Environment variables
10. **Update .gitignore** — Add .env
11. **Create src/lib/supabase.ts** — Client singleton
12. **Create src/lib/transforms.ts** — snake↔camel utils
13. **Generate src/types/database.ts** — Supabase types
14. **Create src/lib/api/*.ts** — All 8 API files
15. **Create docs/schema.md** — Full DB documentation
16. **Update docs/** — OVERVIEW, architecture, data-model, state-management
17. **Verify** — Query the database through the API layer to confirm everything works

---

## Deprecated Code (to remove)

**Nothing removed in this pass.** The mock data files and contexts remain active. They will be deprecated one-by-one as features are swapped to use the API layer in subsequent passes.

---

## Validation Gates

1. `mcp__supabase__list_tables` returns all 9 tables
2. Auth users can be queried from profiles table
3. `npm run build` succeeds (no TypeScript errors)
4. `npm run dev` starts without errors
5. Supabase client connects (no env var errors)
