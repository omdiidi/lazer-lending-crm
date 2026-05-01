# IntegrateAPI CRM — Project Documentation

> **IMPORTANT: This file MUST be read before making any code changes.**
> It serves as the master index for all project documentation, tracks major changes, and provides the source-file-to-doc mapping agents need to keep documentation in sync.

---

## Agent Instructions

### Before Making Code Changes
1. Read this file to understand the current state of the project
2. Identify which feature(s) your change affects using the [File-to-Documentation Map](#file-to-documentation-map)
3. Read the relevant feature doc(s) for detailed context

### After Making Code Changes
1. Update the relevant feature doc(s) to reflect your changes
2. Add an entry to the **Changelog** table at the bottom of each affected feature doc
3. If the change is a **major change** (new feature, architectural shift, breaking change, new page/route, new context/provider), also add an entry to the [Major Changes Log](#major-changes-log) in this file
4. If you added new files, update the [File-to-Documentation Map](#file-to-documentation-map)
5. If you added a new feature that doesn't fit an existing doc, create a new doc following the template in any existing feature file, and add it to the [Feature Index](#feature-index)

### Changelog Entry Format
When adding changelog entries, use this format:
```
| YYYY-MM-DD | Brief description of what changed | `file1.tsx`, `file2.tsx` |
```

---

## Application Summary

**IntegrateAPI CRM** is a frontend-only sales CRM application for managing leads, email outreach, deal pipelines, and AI-assisted lead generation. It is built with React 18 + TypeScript + Vite and uses shadcn/ui for its component library.

**Current state:** Authentication is wired to Supabase Auth (real login, session persistence). All CRM data is fetched from and persisted to Supabase via 8 React Query hooks. CRM data survives page refreshes. Role-based data scoping is enforced by RLS at the database level.

**Users:** 3 mock users — 1 admin (Sarah Chen), 2 employees (Marcus Rivera, Aisha Patel). Admin sees all data; employees see only their assigned items.

**Routes:**
| Path | Page | Feature Doc |
|------|------|-------------|
| `/` | Dashboard | [dashboard.md](./dashboard.md) |
| `/leads` | Lead List | [leads.md](./leads.md) |
| `/leads/:id` | Lead Detail | [leads.md](./leads.md) |
| `/generator` | Lead Generator | [lead-generator.md](./lead-generator.md) |
| `/outreach` | Outreach (Inbox/Compose/Campaigns/Sequences) | [outreach.md](./outreach.md) |
| `/outreach/campaign/new` | Campaign Builder | [campaigns.md](./campaigns.md) |
| `/outreach/campaign/:id` | Campaign Detail | [campaigns.md](./campaigns.md) |
| `/unsubscribe/:token` | Unsubscribe (public, no auth) | [campaigns.md](./campaigns.md) |
| `/pipeline` | Pipeline Board | [pipeline.md](./pipeline.md) |
| `/settings` | Settings | [settings.md](./settings.md) |

---

## Feature Index

| # | Feature | Doc | Status | Description |
|---|---------|-----|--------|-------------|
| 1 | Architecture & Build | [architecture.md](./architecture.md) | Active | Tech stack, Vite config, Tailwind, project structure, provider hierarchy |
| 2 | Data Model | [data-model.md](./data-model.md) | Active | TypeScript types, entity relationships, mock data inventory |
| 3 | State Management | [state-management.md](./state-management.md) | Active | AuthContext, React Query hooks, all CRUD operations |
| 4 | Authentication | [authentication.md](./authentication.md) | Active | Login UI, role-based access, auth gating, Supabase Auth |
| 5 | Dashboard | [dashboard.md](./dashboard.md) | Active | KPI stats, charts (all real data), team leaderboard |
| 6 | Leads Management | [leads.md](./leads.md) | Active | Lead list with search/filter/bulk, detail view with timeline |
| 7 | Lead Generator | [lead-generator.md](./lead-generator.md) | Active | Chat-based lead discovery via Apollo.io with enrichment |
| 8 | Outreach & Email | [outreach.md](./outreach.md) | Active | Gmail-style inbox, compose, campaigns (AI + manual), sequences (display-only) |
| 9 | Pipeline & Deals | [pipeline.md](./pipeline.md) | Active | Kanban board with drag-and-drop, 7 deal stages |
| 10 | Settings | [settings.md](./settings.md) | Active | Profile editing (name + sending email), team management (invite new members, delete members), integrations status |
| 11 | UI Components | [ui-components.md](./ui-components.md) | Active | shadcn/ui library, layout shell, custom components |
| 12 | Database Schema | [schema.md](./schema.md) | Active | Supabase PostgreSQL schema, RLS policies, triggers, API layer |
| 13 | Campaign Engine | [campaigns.md](./campaigns.md) | Complete | Campaign management dashboard, analytics, unsubscribe infrastructure, cloning, builder, template library, AI generation, scheduled sends, pause/resume, enrollment tracking, reply detection, multi-step drip sequences, stop conditions, A/B testing, Apollo auto-gen pipeline, smart send timing, lead engagement scoring |

**Status definitions:**
- **Active** — Feature is functional with working interactions
- **Partial** — Feature works but relies on some hardcoded/mock data
- **Mock** — Feature UI exists but core logic is simulated
- **Placeholder** — Feature is UI-only with no functional handlers

---

## File-to-Documentation Map

When you modify a source file, update the corresponding documentation file(s):

### Pages
| Source File | Documentation |
|-------------|---------------|
| `src/pages/LoginPage.tsx` | [authentication.md](./authentication.md) |
| `src/pages/DashboardPage.tsx` | [dashboard.md](./dashboard.md) |
| `src/pages/LeadsPage.tsx` | [leads.md](./leads.md) |
| `src/pages/LeadDetailPage.tsx` | [leads.md](./leads.md) |
| `src/pages/LeadGeneratorPage.tsx` | [lead-generator.md](./lead-generator.md) |
| `src/pages/OutreachPage.tsx` | [outreach.md](./outreach.md) |
| `src/pages/CampaignBuilderPage.tsx` | [campaigns.md](./campaigns.md) |
| `src/pages/CampaignDetailPage.tsx` | [campaigns.md](./campaigns.md), [outreach.md](./outreach.md) |
| `src/pages/UnsubscribePage.tsx` | [campaigns.md](./campaigns.md) |
| `src/pages/PipelinePage.tsx` | [pipeline.md](./pipeline.md) |
| `src/pages/SettingsPage.tsx` | [settings.md](./settings.md) |
| `src/pages/Index.tsx` | [architecture.md](./architecture.md) |
| `src/pages/NotFound.tsx` | [architecture.md](./architecture.md) |

### State & Data
| Source File | Documentation |
|-------------|---------------|
| `src/contexts/AuthContext.tsx` | [state-management.md](./state-management.md), [authentication.md](./authentication.md) |
| `src/types/crm.ts` | [data-model.md](./data-model.md) |

### Components
| Source File | Documentation |
|-------------|---------------|
| `src/components/AppLayout.tsx` | [ui-components.md](./ui-components.md) |
| `src/components/AppSidebar.tsx` | [ui-components.md](./ui-components.md) |
| `src/components/NavLink.tsx` | [ui-components.md](./ui-components.md) |
| `src/components/outreach/CampaignAIChat.tsx` | [outreach.md](./outreach.md) |
| `src/components/outreach/CampaignList.tsx` | [campaigns.md](./campaigns.md), [outreach.md](./outreach.md) |
| `src/components/outreach/CampaignAnalytics.tsx` | [campaigns.md](./campaigns.md) |
| `src/components/ui/*.tsx` | [ui-components.md](./ui-components.md) |

### Database & API
| Source File | Documentation |
|-------------|---------------|
| `src/lib/supabase.ts` | [schema.md](./schema.md), [architecture.md](./architecture.md) |
| `src/lib/transforms.ts` | [schema.md](./schema.md) |
| `src/lib/api/*.ts` | [schema.md](./schema.md) |
| `src/lib/api/campaign-ai.ts` | [outreach.md](./outreach.md) |
| `src/lib/api/apollo.ts` | [lead-generator.md](./lead-generator.md) |
| `src/lib/api/search-history.ts` | [lead-generator.md](./lead-generator.md), [schema.md](./schema.md) |
| `supabase/functions/apollo-search/index.ts` | [lead-generator.md](./lead-generator.md) |
| `src/types/database.ts` | [schema.md](./schema.md), [data-model.md](./data-model.md) |
| `.env` | [architecture.md](./architecture.md) |

### Config & Infra
| Source File | Documentation |
|-------------|---------------|
| `src/App.tsx` | [architecture.md](./architecture.md) |
| `src/main.tsx` | [architecture.md](./architecture.md) |
| `src/index.css` | [architecture.md](./architecture.md), [ui-components.md](./ui-components.md) |
| `vite.config.ts` | [architecture.md](./architecture.md) |
| `tailwind.config.ts` | [architecture.md](./architecture.md) |
| `package.json` | [architecture.md](./architecture.md) |

### Hooks
| Source File | Documentation |
|-------------|---------------|
| `src/hooks/use-leads.ts` | [state-management.md](./state-management.md) |
| `src/hooks/use-activities.ts` | [state-management.md](./state-management.md) |
| `src/hooks/use-deals.ts` | [state-management.md](./state-management.md) |
| `src/hooks/use-emails.ts` | [state-management.md](./state-management.md) |
| `src/hooks/use-suggestions.ts` | [state-management.md](./state-management.md) |
| `src/hooks/use-campaigns.ts` | [state-management.md](./state-management.md) |
| `src/hooks/use-sequences.ts` | [state-management.md](./state-management.md) |
| `src/hooks/use-profiles.ts` | [state-management.md](./state-management.md) |
| `src/hooks/use-toast.ts` | [state-management.md](./state-management.md) |
| `src/hooks/use-mobile.tsx` | [state-management.md](./state-management.md) |

---

## Project Structure

```
connect-crm/
├── docs/                          # Documentation (this directory)
│   ├── OVERVIEW.md                # This file — master index
│   ├── architecture.md            # Tech stack, build, providers
│   ├── data-model.md              # Types, entities, mock data
│   ├── state-management.md        # Contexts, hooks, CRUD
│   ├── authentication.md          # Login, roles, auth flow
│   ├── dashboard.md               # KPIs, charts
│   ├── leads.md                   # Lead list + detail
│   ├── lead-generator.md          # AI lead generation
│   ├── outreach.md                # Email inbox, campaigns, sequences
│   ├── campaigns.md               # Campaign engine, analytics, unsubscribe
│   ├── pipeline.md                # Deal kanban
│   ├── settings.md                # Profile, team, integrations
│   ├── ui-components.md           # UI library, layout, custom components
│   └── schema.md                  # Supabase database schema, RLS, API layer
├── public/                        # Static assets
├── src/
│   ├── components/
│   │   ├── ui/                    # shadcn/ui primitives (48 components)
│   │   ├── outreach/              # Feature-specific components
│   │   ├── AppLayout.tsx          # Main layout shell
│   │   ├── AppSidebar.tsx         # Navigation sidebar
│   │   └── NavLink.tsx            # Active-aware nav link wrapper
│   ├── contexts/
│   │   └── AuthContext.tsx        # Authentication state
│   ├── hooks/
│   │   ├── use-leads.ts           # Leads query + mutations
│   │   ├── use-activities.ts      # Activities query + mutations
│   │   ├── use-deals.ts           # Deals query + mutations
│   │   ├── use-emails.ts          # Emails query + mutations
│   │   ├── use-suggestions.ts     # AI suggestions query + mutations
│   │   ├── use-campaigns.ts       # Campaigns query + mutations
│   │   ├── use-sequences.ts       # Sequences query (read-only)
│   │   ├── use-profiles.ts        # Profiles query (read-only)
│   │   ├── use-mobile.tsx         # Responsive breakpoint hook
│   │   └── use-toast.ts           # Toast notification hook
│   ├── lib/
│   │   ├── api/
│   │   │   └── ...                    # Typed database query + AI functions
│   │   └── utils.ts               # cn() utility
│   ├── pages/                     # Route page components
│   ├── test/                      # Test files
│   ├── types/
│   │   └── crm.ts                 # All TypeScript interfaces
│   ├── App.tsx                    # Root component, providers, routes
│   ├── main.tsx                   # Entry point
│   └── index.css                  # Global styles, CSS variables
├── supabase/
│   └── functions/                  # Supabase Edge Functions
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── components.json                # shadcn/ui CLI config
└── CODEBASE_ANALYSIS.md           # Raw analysis (reference only)
```

---

## Conventions & Patterns

These conventions are used throughout the codebase. Follow them when making changes:

- **Path alias:** `@/` resolves to `src/`
- **Styling:** Tailwind utility classes only (no CSS modules, no inline styles except `calc()`)
- **Icons:** Lucide React exclusively — import from `lucide-react`
- **ID generation:** Database generates UUIDs for all new records — never pass `id` to create/insert functions
- **Data fetching:** Use React Query hooks (`useLeads()`, `useDeals()`, etc.) — never call Supabase directly from components
- **Mutations:** Use hook mutation functions — they auto-invalidate the cache on success
- **Filtered data:** Derive with `useMemo` in page components
- **Role-based filtering:** Handled by RLS at the database level — do not filter client-side by `isAdmin`
- **Activity logging:** Every user action that touches a lead should create an Activity record
- **New items:** Prepend to arrays (newest first): `[newItem, ...prev]`
- **Colors:** Use CSS custom properties via HSL (defined in `index.css`)
- **Status colors:** Consistent mapping across all pages — blue (cold), amber (lukewarm), orange (warm), red (dead)

---

## Major Changes Log

Track all significant changes here: new features, architectural shifts, new routes, new providers, breaking changes.

| Date | Change | Affected Features | Details |
|------|--------|-------------------|---------|
| 2026-03-22 | Initial project documentation created | All | Created docs/ directory with 12 documentation files |
| 2026-03-22 | Gmail-style inbox implemented | Outreach | Thread-based email inbox with split pane, reply/forward, read tracking |
| 2026-03-22 | Supabase foundation: database schema, auth, RLS, API layer, seed data | All | 9 tables, 3 auth users, complete seed data, typed API functions in src/lib/api/ |
| 2026-03-22 | Auth wired to Supabase — real login with session persistence | Authentication | AuthContext rewritten, LoginPage async, AuthGate loading state |
| 2026-03-23 | CRM Context swap — mock data replaced with Supabase via React Query | All | CRMContext deleted, mockData deleted, 8 React Query hooks, all pages updated |
| 2026-03-23 | Campaign AI wired to real LLM via Supabase Edge Function | Outreach | CampaignAIChat calls DeepSeek V3.2 via OpenRouter, replaces keyword matching |
| 2026-03-23 | Apollo.io integration — real lead search + enrichment in Lead Generator | Lead Generator | Edge Function, LLM parsing, circuit breakers, enriched results table |
| 2026-03-23 | Apollo search Edge Function, email_status on leads, profile editing with sending email, campaign email filtering | Lead Generator, Settings, Outreach | Real Apollo search/enrichment/ZeroBounce, profile name+email editable, campaigns filtered by email verification |
| 2026-03-23 | Resend email integration — real email delivery for compose/reply/campaigns, bounce/open/click tracking webhooks | Outreach | Emails sent via Resend API, tracking via webhooks, emailPrefix required on profiles |
| 2026-03-23 | Inbound email receiving — replies appear in CRM inbox via Resend webhook | Outreach | email-events handles email.received, thread matching via In-Reply-To, lead matching, activity logging |
| 2026-03-23 | Email status badges on leads + email tracking indicators in inbox | Leads, Outreach | Leads table/detail show verification status, inbox shows open/click/bounce tracking |
| 2026-03-23 | Email UI redesign — Gmail-style message cards, formatting toolbar, flexible To field | Outreach | Messages display as email cards with From/To headers, compose accepts raw email addresses |
| 2026-03-23 | Inbox folder sidebar — Inbox, Sent, All Mail folders for email filtering | Outreach | Gmail-style folder navigation within the inbox tab |
| 2026-03-23 | Team management: invite tokens, signup flow, member deletion | Authentication, Settings, Schema | Admin generates invite link via create-invite Edge Function; new member signs up with token + password via signup-with-token Edge Function (auto-login on success); admin can delete members via delete-member Edge Function; leads/deals preserved unassigned on member deletion (ON DELETE SET NULL); login page now has Sign In / Sign Up toggle |
| 2026-03-23 | Campaign Engine Phase 1a: campaign management dashboard, analytics, detail page, cloning, unsubscribe infrastructure | Outreach, Schema | CampaignList replaces old history cards; CampaignDetailPage at /outreach/campaign/:id; analytics from emails.campaign_id FK; token-based unsubscribe at /unsubscribe/:token; new DB tables (unsubscribes, campaign_templates, campaign_sequences, campaign_steps); expanded campaigns schema |
| 2026-03-23 | Campaign Engine Phase 1b: multi-step builder, template library, AI generation (GPT-4.1-mini), audience selector | Campaigns, Outreach | New campaign builder page, TemplateEditor with AI assist, template save/load, AudienceSelector component |
| 2026-03-23 | Campaign Engine Phase 2a: scheduled sends, pause/resume, enrollment tracking, reply detection, pg_cron | Campaigns | Scheduler infrastructure, per-recipient tracking, auto-warm on reply |
| 2026-03-23 | Campaign Engine Phase 2b: drip sequences with up to 5 steps, delay-based follow-ups, stop conditions | Campaigns | SequenceEditor component, scheduler processes drip steps, sequence progress in campaign detail |
| 2026-03-23 | Campaign Engine Phase 3a: A/B testing (full body variants, 50/50 split, per-variant analytics, winner comparison), Apollo auto-gen pipeline from campaign builder with credit confirmation | Campaigns | CampaignBuilderPage, CampaignDetailPage, CampaignAnalytics, send-email |
| 2026-03-23 | Campaign Engine Phase 3b (FINAL): Smart send timing (9 AM local via lead timezone, smart_send on campaigns), lead engagement scoring (opens×1 + clicks×3 + replies×5, badge in leads table, Dashboard "Hottest Leads" leaderboard); Campaign Engine now fully complete | Campaigns, Leads, Dashboard, Schema | process-campaigns, CampaignBuilderPage, LeadsPage, LeadDetailPage, DashboardPage, leads table, campaigns table |
| 2026-03-23 | Lead editing + deal creation UI | Leads, Pipeline | Lead detail fields editable, pipeline has New Deal dialog |
| 2026-03-23 | Phase B: real dashboard charts + Supabase Realtime on all core hooks | Dashboard, State Management | Weekly activity + revenue computed from real data, multi-user live updates via Realtime |
| 2026-03-23 | Apollo phone reveal: async webhook delivery, apolloId tracking on leads | Lead Generator | Phone numbers delivered asynchronously via webhook, auto-update leads via Realtime |
| 2026-03-24 | Search history persistence in Lead Generator | Lead Generator, Schema | Apollo search results written to `lead_search_history` immediately on return; chat history (including un-imported result sets) restores on page navigation; new `search-history.ts` API client |
| 2026-03-24 | Conversational lead generator | Lead Generator, Schema | Lead Generator is now fully conversational: new `lead-gen-chat` Edge Function uses GPT-4.1-mini to manage multi-turn dialog, confirms intended search before running it, handles zero results with refinement suggestions, and renders clickable action buttons in bot messages. Apollo search pipeline inlined in `lead-gen-chat`. AlertDialog confirmation modal removed — confirmation happens in-chat. |
| 2026-03-24 | Lead deduplication in Lead Generator | Lead Generator | Two-layer deduplication: pre-enrichment match by `apollo_id` (prevents spending enrichment credits on existing leads), post-enrichment match by email (catches remaining duplicates). Duplicates shown with "Already in CRM" badge in search results; import silently skips them. |
