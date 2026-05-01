# IntegrateAPI CRM — Codebase Analysis

> Feature-by-feature analysis of the connect-crm codebase.
> Prepared as groundwork for scaffold structure documentation.

---

## 1. Tech Stack & Build System

**Purpose:** Frontend-only sales CRM built with modern React tooling.

**Files:** `package.json`, `vite.config.ts`, `tailwind.config.ts`, `components.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`

**How it works:**
- **Framework:** React 18 + TypeScript + Vite (SWC compiler via `@vitejs/plugin-react-swc`)
- **Styling:** Tailwind CSS 3 with CSS custom properties (HSL colors), dark mode via `.dark` class
- **UI Library:** shadcn/ui (48 components) built on Radix UI primitives
- **Routing:** React Router v6 (BrowserRouter)
- **State:** React Context API + `@tanstack/react-query` (QueryClient instantiated but not actively used for data fetching)
- **Charts:** Recharts (PieChart, BarChart, LineChart)
- **Forms:** react-hook-form + zod (available but not heavily used — most forms are simple controlled inputs)
- **Notifications:** Sonner + shadcn Toaster (dual toast system)
- **Path alias:** `@` maps to `./src`
- **Dev server:** Port 8080, HMR overlay disabled
- **Testing:** Vitest + Testing Library + Playwright (minimal test coverage — `src/test/example.test.ts`)
- **Origin:** Scaffolded as a Vite + React + TypeScript SPA

**Current limitations:**
- No backend, no API calls, no database — 100% client-side with mock data
- React Query client exists but is unused (no `useQuery`/`useMutation` calls)
- `App.css` contains unused Vite template styles

---

## 2. Data Model / Type System

**Purpose:** Defines all CRM entities and their relationships.

**Files:** `src/types/crm.ts`

**How it works:**

| Entity | Key Fields | Relationships |
|--------|-----------|---------------|
| `User` | id, name, email, role (`admin` \| `employee`), avatar? | Central identity |
| `Lead` | id, firstName, lastName, email, phone, jobTitle, company, companySize, industry, location, status, assignedTo, createdAt, lastContactedAt, notes, tags[], linkedinUrl? | `assignedTo` → User.id |
| `Activity` | id, leadId, userId, type, description, timestamp, metadata? | `leadId` → Lead.id, `userId` → User.id |
| `EmailMessage` | id, leadId?, from, to, subject, body, sentAt, read, direction (`inbound` \| `outbound`), threadId?, replyToId? | `leadId` → Lead.id (optional) |
| `Deal` | id, leadId, title, value, stage, assignedTo, createdAt, updatedAt | `leadId` → Lead.id, `assignedTo` → User.id |
| `EmailSequence` | id, name, steps[], createdBy, active | `createdBy` → User.id |
| `SequenceStep` | id, order, subject, body, delayDays | Nested in EmailSequence |
| `AISuggestion` | id, leadId, suggestion, priority, createdAt, dismissed | `leadId` → Lead.id |
| `Campaign` | id, subject, body, recipientIds[], sentAt, sentBy | `recipientIds` → Lead.id[], `sentBy` → User.id |

**Key details:**
- `LeadStatus`: `cold` | `lukewarm` | `warm` | `dead`
- `DealStage`: `new` | `contacted` | `qualified` | `proposal` | `negotiation` | `closed_won` | `closed_lost`
- `ActivityType`: `call` | `email_sent` | `email_received` | `note` | `status_change` | `meeting`
- Lead is the central entity — Deals, Activities, Emails, and Suggestions all reference it

**Current limitations:**
- No `deletedAt` / soft delete on any entity
- No `Deal` create/delete operations exposed in context
- No `Lead` delete operation
- `EmailSequence` is read-only (no CRUD in context)

---

## 3. Mock Data Layer

**Purpose:** Seeds the app with realistic sample data for all entities.

**Files:** `src/data/mockData.ts`

**How it works:**
All data is hardcoded arrays, imported by contexts on mount.

| Dataset | Count | Notes |
|---------|-------|-------|
| `mockUsers` | 3 | Sarah Chen (admin), Marcus Rivera (employee), Aisha Patel (employee) |
| `mockCredentials` | 3 | Maps email → password → userId. Passwords: `admin123`, `employee123` |
| `mockLeads` | 22 | Mix of statuses, 20+ industries, assigned to u2/u3 only |
| `mockActivities` | 15 | Types: call, email_sent, email_received, note, status_change |
| `mockEmails` | 18 | 8 threads (t1–t8), inbound/outbound, threading via threadId/replyToId |
| `mockDeals` | 10 | Values $12k–$72k, all 7 stages represented |
| `mockSuggestions` | 8 | AI action items, high/medium/low priority |
| `mockSequences` | 2 | "Cold Outreach — SaaS CTOs" (3 steps), "Demo Follow-up" (2 steps) |
| `mockCampaigns` | 2 | Bulk emails with template variables `{{firstName}}`, `{{company}}` |

**Key details:**
- Company name is "IntegrateAPI" — all user emails use `@integrateapi.ai`
- Leads span dates Nov 2025 – Mar 2026
- No admin user has leads assigned to them (admins see all via aggregation)

---

## 4. State Management

**Purpose:** Provides global auth and CRM data to all components via React Context.

**Files:** `src/contexts/AuthContext.tsx`, `src/contexts/CRMContext.tsx`

### AuthContext
**State:** `user: User | null`
**Methods:**
- `login(email, password) → boolean` — validates against `mockCredentials`, looks up `mockUsers`
- `logout()` — clears user state
- `isAdmin` — derived: `user.role === 'admin'`

### CRMContext
**State:** `leads`, `activities`, `deals`, `emails`, `suggestions`, `campaigns` — all initialized from mock data arrays.

**Methods (all `useCallback`-memoized):**

| Method | Operation |
|--------|-----------|
| `updateLead(id, partial)` | Shallow merge into lead |
| `addLead(lead)` | Prepend single lead |
| `addLeads(leads)` | Prepend multiple leads |
| `addActivity(activity)` | Prepend activity |
| `updateDeal(id, partial)` | Shallow merge into deal |
| `addEmail(email)` | Prepend email |
| `markEmailRead(id, read?)` | Toggle read status |
| `updateEmail(id, partial)` | Shallow merge into email |
| `dismissSuggestion(id)` | Set `dismissed: true` |
| `addCampaign(campaign)` | Prepend campaign |

**Key details:**
- All mutations use functional state updates (`setPrev(prev => ...)`)
- New items always prepended (newest-first ordering)
- No delete operations for any entity
- No validation, async operations, or side effects
- No persistence — all state resets on page refresh

**Current limitations:**
- No loading/error states
- No optimistic updates
- No undo/redo
- State resets on refresh (no localStorage/sessionStorage)

---

## 5. App Shell & Layout

**Purpose:** Authentication gating, provider hierarchy, sidebar navigation, and page layout.

**Files:** `src/main.tsx`, `src/App.tsx`, `src/components/AppLayout.tsx`, `src/components/AppSidebar.tsx`, `src/components/NavLink.tsx`

**How it works:**

**Provider stack (outermost → innermost):**
```
QueryClientProvider → TooltipProvider → Toaster + Sonner → AuthProvider → BrowserRouter → AuthGate → CRMProvider → Routes → AppLayout → Page
```

**AuthGate pattern:** If no user in AuthContext, render `LoginPage`. Otherwise, wrap all routes in `CRMProvider` and render inside `AppLayout`.

**AppLayout structure:**
```
SidebarProvider
  ├── AppSidebar (collapsible, icon-only when collapsed)
  └── Main area
      ├── Header (h-14, sticky — sidebar trigger + user avatar initials)
      └── <Outlet /> (page content, independently scrollable)
```

**Navigation items:** Dashboard (`/`), Leads (`/leads`), Lead Generator (`/generator`), Outreach (`/outreach`), Pipeline (`/pipeline`), Settings (`/settings`)

**NavLink component:** Wraps React Router's `NavLink` with `activeClassName` support and Tailwind class merging via `cn()`.

**Key details:**
- Sidebar uses shadcn's `Sidebar` component with `collapsible="icon"` mode
- Footer shows user name/role + logout button (hidden when collapsed)
- Branding: blue "I" logo + "IntegrateAPI" text

---

## 6. Authentication / Login

**Purpose:** Mock login flow with role-based access control.

**Files:** `src/pages/LoginPage.tsx`, `src/contexts/AuthContext.tsx`

**How it works:**
- Centered card UI with email + password fields
- Validates against `mockCredentials` array (simple equality check)
- On success: sets `user` in AuthContext → `AuthGate` re-renders → app routes shown
- On failure: displays "Invalid email or password" error message
- Demo credentials displayed on login page for convenience

**Key details:**
- Two roles: `admin` (sees all data, team management) and `employee` (sees only assigned data)
- No session persistence — logging out or refreshing returns to login
- No password hashing, no tokens, no real security

**Current limitations:**
- No registration flow
- No password reset
- No session management
- No remember-me functionality

---

## 7. Dashboard

**Purpose:** KPI overview with charts and team performance metrics.

**Files:** `src/pages/DashboardPage.tsx`

**How it works:**
- **5 KPI stat cards:** Total Leads, Calls Made, Emails Sent, Conversion Rate, Pipeline Value
  - Each shows hardcoded % change indicators (decorative, not computed)
  - Conversion rate = `(warm leads / total leads) * 100`
  - Pipeline value excludes `closed_lost` deals
- **3 charts (Recharts):**
  - Lead Funnel — donut chart, segments by lead status (cold/lukewarm/warm/dead)
  - Weekly Activity — bar chart, hardcoded Mon-Fri call/email sample data
  - Revenue Pipeline — line chart, historical months + current pipeline value
- **Team Leaderboard (admin only):** Shows Marcus Rivera and Aisha Patel with hardcoded call/email counts, dynamic lead counts

**Key details:**
- Role-based filtering: admins see all data, employees see only their assigned items
- Title changes: "Team Dashboard" (admin) vs "Welcome back, [FirstName]" (employee)
- Status colors defined as HSL constants matching the design system

**Current limitations:**
- Weekly activity chart data is hardcoded (not derived from actual activities)
- Leaderboard call/email counts are hardcoded
- % change indicators are decorative (not computed from historical data)
- Revenue data for months prior to March is hardcoded

---

## 8. Leads Management

**Purpose:** Lead list table with search/filter/bulk actions, and individual lead detail view with activity timeline.

**Files:** `src/pages/LeadsPage.tsx`, `src/pages/LeadDetailPage.tsx`

### LeadsPage (List View)
**How it works:**
- **Table columns:** Name, Company (+size), Job Title, Status (badge), Phone, Email, Assigned Rep (admin only), Last Contact
- **Search:** Real-time filter across name, company, email
- **Status filter:** Dropdown — All, Cold, Lukewarm, Warm, Dead
- **Bulk selection:** Checkboxes + select-all → "Mark Warm" / "Mark Dead" bulk buttons
- **Inline actions:** Phone button (opens `tel:`, logs call activity), Email button (opens `mailto:`, logs email activity)
- **Row click:** Navigates to `/leads/:id` detail page
- Role filtering: employees only see their assigned leads

### LeadDetailPage (Detail View)
**How it works:**
- **3-column layout** (1+2 split on large screens)
- **Left column — Contact card:**
  - Name, title, status (dropdown to change — logs `status_change` activity)
  - Company + size, location
  - Phone (click to call), Email (click to email), LinkedIn (external link)
  - Tags display, assigned user
- **Left column — AI Suggestions card** (if any undismissed suggestions exist):
  - Shows AI-generated action items with dismiss buttons
- **Right column — Add Note:**
  - Textarea + "Add" button → creates `note` activity
- **Right column — Activity Timeline:**
  - Vertical timeline with connector lines
  - Each activity shows: icon (by type), description, timestamp, user name
  - Sorted newest first
  - Activity types mapped to icons: call→PhoneCall, email_sent→MailOpen, email_received→Mail, note→MessageSquare, status_change→Tag, meeting→Users

**Key details:**
- Activity IDs use `Date.now()` for uniqueness
- Phone/email actions update `lastContactedAt` timestamp
- Status changes automatically create activity records

**Current limitations:**
- No lead editing (name, company, etc.) — only status can be changed
- No lead deletion
- No deal view on the detail page
- No email history on the detail page (emails are in Outreach)

---

## 9. Lead Generator (AI)

**Purpose:** Chat-based interface for AI-assisted lead discovery and import.

**Files:** `src/pages/LeadGeneratorPage.tsx`

**How it works:**
1. Bot sends initial prompt asking user to describe ideal customer profile
2. User types a description (e.g., "CTOs at SaaS companies, 50-200 employees, Austin")
3. After 1.5s simulated delay ("Searching Apollo.io..."), bot returns 5 hardcoded leads in a table
4. Table shows: Name, Title, Company, Location
5. "Import X as Cold Leads" button assigns leads to current user and adds to CRM via `addLeads()`
6. Button disables after import ("Imported to CRM")
7. User can continue chatting to generate more batches

**Key details:**
- `fakeGeneratedLeads()` always returns the same 5 leads with unique IDs (using `Date.now()`)
- Generated leads are tagged `['generated']` and notes include the original prompt
- All generated leads start as `cold` status
- Leads are assigned to the current user on import
- Full-height chat layout using `calc(100vh - 3.5rem)`

**Current limitations:**
- No real Apollo.io integration — leads are hardcoded regardless of prompt
- Same 5 leads every time (different IDs)
- No deduplication if user imports multiple times across sessions
- No prompt parsing or filtering logic

---

## 10. Outreach / Email System

**Purpose:** Gmail-style email inbox, compose, bulk campaigns (manual + AI), and email sequences.

**Files:** `src/pages/OutreachPage.tsx`, `src/components/outreach/CampaignAIChat.tsx`

### Tab: Inbox
**How it works:**
- Split pane: thread list (left, 360px) + conversation view (right)
- **Thread building:** Groups emails by `threadId`, sorts chronologically within threads, dedupes subjects (strips `Re:/Fwd:` prefixes)
- **Thread list:** Unread indicator (blue dot), contact name, relative timestamp, subject, message preview, count badge
- **Search:** Filters across subjects, participants, and body content
- **Conversation view:** Messages styled by direction (outbound = right/primary, inbound = left/muted), shows sender, timestamp, body
- **Reply/Forward:** Opens reply textarea, creates new email with `threadId` and `replyToId` linking, logs `email_sent` activity
- **Read tracking:** Marks all thread messages as read when thread is selected

### Tab: Compose
- Lead search dropdown (autocomplete by name/email/company, max 10 results)
- Subject + body fields
- On send: creates `EmailMessage`, logs `email_sent` activity, clears form

### Tab: Campaigns
**Two modes:**
- **AI Mode** (`CampaignAIChat` component):
  - Chat interface where user describes campaign intent
  - `parsePrompt()` extracts: status keywords (cold/warm/etc.), industry names, topic
  - Auto-generates subject and body with merge fields `{{firstName}}`, `{{company}}`
  - Returns `AIResult`: matchedLeadIds, subject, body, filters
  - Parent page shows compose card with recipient count + send button
- **Manual Mode** (two-step):
  - Step 1 — Select Recipients: search, filter by status/industry, checkboxes, select-all
  - Step 2 — Compose: subject + body with merge field docs, send button
- **Bulk send logic:** Creates individual `EmailMessage` for each recipient with template variable replacement (`{{firstName}}` → lead name, `{{company}}` → lead company)
- **Campaign History:** Lists all sent campaigns, expandable to show recipient details

### Tab: Sequences
- Displays `mockSequences` as read-only cards
- Shows: sequence name, step count, creator, active/paused status
- Each step: order number, subject, delay in days
- Note: "Sequence execution will be powered by email API integration"

**Key details:**
- Email threading is computed client-side from flat `EmailMessage[]` array
- Thread participants extracted via `Set` deduplication of from/to fields
- Campaign AI chat has no real AI — it's keyword matching + template generation
- Merge fields: `{{firstName}}`, `{{company}}` — replaced via regex on send

**Current limitations:**
- No real email sending/receiving
- No SMTP/Gmail/Outlook integration
- Sequences are display-only (no execution engine)
- AI campaign chat is simple keyword extraction, not LLM-powered
- No email templates library
- No scheduling (send later)
- No tracking (opens, clicks)

---

## 11. Pipeline / Deals

**Purpose:** Kanban board for managing deals through sales stages.

**Files:** `src/pages/PipelinePage.tsx`

**How it works:**
- **7 columns** representing deal stages: New → Contacted → Qualified → Proposal → Negotiation → Closed Won → Closed Lost
- Each column shows: stage name, deal count badge, total dollar value
- **Deal cards** show: title, lead name (looked up from `leadId`), value with $ icon, assigned rep (admin only)
- **Drag and drop:** Native HTML5 drag events (`draggable`, `onDragStart`, `onDragOver`, `onDrop`)
  - Dropping updates `deal.stage` and `deal.updatedAt`
  - Cursor changes to grab/grabbing
- **Header metrics:** Total deal count + active pipeline value (excludes closed_won and closed_lost)
- Role filtering: employees see only their assigned deals

**Key details:**
- Columns are fixed-width (240px) with horizontal scroll
- Min-height 400px per column ensures drop zone even when empty
- Stage colors: slate, blue, amber, orange, purple, emerald, red (pastel backgrounds)
- Pipeline value calculation: `deals.filter(not closed).reduce(sum values)`

**Current limitations:**
- No deal creation UI
- No deal editing (only stage changes via drag)
- No deal deletion
- No deal detail view
- No probability/weighting by stage
- No expected close dates
- Drop zone feedback is minimal (no visual highlight on hover)

---

## 12. Settings

**Purpose:** User profile display, team management, and integration placeholders.

**Files:** `src/pages/SettingsPage.tsx`

**How it works:**
- **Profile card:** Read-only name, email, and role badge
- **Team Management (admin only):**
  - Lists all `mockUsers` with avatar initials, name, email, role badge
  - Delete button for non-admin users (visual only — no handler)
  - "+ Add Team Member" button (visual only — no handler)
- **Integrations card:**
  - Apollo.io — "Coming Soon"
  - Email Provider (Gmail, Outlook, SMTP) — "Coming Soon"
  - Slack — "Coming Soon"

**Current limitations:**
- Profile is completely read-only (no edit functionality)
- Team management delete/add buttons are non-functional
- No integration connection flow
- No notification preferences
- No theme/appearance settings
- No data export/import

---

## 13. UI Component Library (shadcn/ui)

**Purpose:** 48 pre-built accessible UI primitives based on Radix UI.

**Files:** `src/components/ui/*.tsx` (48 files)

**Components installed:**

| Category | Components |
|----------|-----------|
| **Layout** | card, separator, aspect-ratio, resizable, scroll-area |
| **Navigation** | breadcrumb, menubar, navigation-menu, pagination, tabs, sidebar |
| **Forms** | button, checkbox, form, input, input-otp, label, radio-group, select, slider, switch, textarea, toggle, toggle-group |
| **Feedback** | alert, alert-dialog, dialog, drawer, progress, skeleton, toast, toaster, sonner, tooltip |
| **Data Display** | accordion, avatar, badge, calendar, carousel, chart, collapsible, hover-card, popover, table |
| **Overlay** | command, context-menu, dropdown-menu, sheet |

**Key details:**
- All components use `cn()` utility from `src/lib/utils.ts` (clsx + tailwind-merge)
- Custom hooks: `use-toast.ts` (reducer-based toast system, limit 1 toast)
- Colors via CSS variables in HSL format (defined in `src/index.css`)
- Sidebar component has custom dark color scheme distinct from main app
- Toast system has dual setup: shadcn Toaster (reducer-based) + Sonner (simpler)

**Actively used across pages:** card, badge, button, input, textarea, select, tabs, table, checkbox, scroll-area, separator, tooltip, sidebar, avatar, dialog, popover

**Available but not used in current features:** accordion, alert-dialog, alert, aspect-ratio, breadcrumb, calendar, carousel, chart (component — recharts used directly), collapsible, command, context-menu, drawer, form (react-hook-form integration), hover-card, input-otp, menubar, navigation-menu, pagination, progress, radio-group, resizable, sheet, slider, switch, toggle, toggle-group

---

## Cross-Cutting Patterns

### Architecture
- **No backend** — fully client-side with mock data
- **Context-based state** — AuthContext for identity, CRMContext for all business data
- **Role-based views** — admin sees all data + team features; employees see only assigned items
- **Activity logging** — every user action (call, email, note, status change) creates an Activity record

### Data Flow
```
MockData → Context (useState) → Pages (useCRM/useAuth) → UI Components
     ↑                                    |
     └────── mutations (add/update) ──────┘
```

### Conventions
- Path alias: `@/` → `src/`
- Tailwind utility-first styling (no CSS modules)
- Lucide React for all icons
- `Date.now()` for generating unique IDs
- Functional state updates throughout
- `useCallback` on all context methods
- `useMemo` for filtered/computed data in pages

### What's Real vs. Mocked
| Feature | Real | Mocked |
|---------|------|--------|
| UI rendering | Yes | — |
| Routing & navigation | Yes | — |
| State management (CRUD) | Yes | — |
| Authentication | — | Hardcoded credentials |
| Data persistence | — | Resets on refresh |
| Email send/receive | — | In-memory only |
| AI lead generation | — | Hardcoded results |
| AI campaign creation | — | Keyword extraction |
| Apollo.io integration | — | Placeholder |
| Email provider integration | — | Placeholder |
| Slack integration | — | Placeholder |
| Sequences execution | — | Display only |
| Dashboard analytics | Partial | Charts use mix of real + hardcoded data |
