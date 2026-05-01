# Leads Management

> Lead list table with search, filter, and bulk actions; lead detail view with contact info, AI suggestions, and activity timeline.

**Status:** Active
**Last Updated:** 2026-03-23
**Related Docs:** [OVERVIEW.md](./OVERVIEW.md) | [state-management.md](./state-management.md) | [data-model.md](./data-model.md) | [outreach.md](./outreach.md) | [pipeline.md](./pipeline.md)

---

## Overview

Leads Management spans two pages: a searchable/filterable list view (`/leads`) and a detail view (`/leads/:id`). The list supports bulk status changes, inline call/email actions, and role-based filtering. The detail view shows full contact information, AI-generated suggestions, a note-adding form, and a chronological activity timeline.

---

## File Map

| File | Purpose |
|------|---------|
| `src/pages/LeadsPage.tsx` | Lead list table with search, filter, bulk actions |
| `src/pages/LeadDetailPage.tsx` | Individual lead detail with contact card, AI suggestions, activity timeline |

---

## Detailed Behavior

### LeadsPage — List View (`/leads`)

#### Table Columns

| Column | Content | Notes |
|--------|---------|-------|
| Checkbox | Multi-select for bulk actions | Select-all in header |
| Name | `firstName lastName` | Clickable — navigates to detail |
| Company | `company` + `companySize` employees | — |
| Job Title | `jobTitle` | — |
| Status | Badge with color | Color-coded: blue/amber/orange/red |
| Engagement | Numeric score badge | `opens×1 + clicks×3 + replies×5`; hidden when score is 0 |
| Phone | Phone button | Triggers `tel:` + logs activity |
| Email | Email button | Triggers `mailto:` + logs activity |
| Assigned Rep | User name | **Admin only** column |
| Last Contact | `lastContactedAt` formatted | Shows "Never" if null |

#### Search
- Real-time text filter
- Searches across: `firstName lastName`, `company`, `email`
- Case-insensitive

#### Status Filter
- Dropdown: All, Cold, Lukewarm, Warm, Dead
- Combined with search (both filters apply simultaneously)

#### Role-Based Filtering
- **Admin:** Sees all 22 leads
- **Employee:** Sees only leads where `assignedTo === user.id`

#### Bulk Actions
- Appear when 1+ leads are selected
- **"Mark Warm"** — updates all selected leads to `status: 'warm'`
- **"Mark Dead"** — updates all selected leads to `status: 'dead'`
- Clears selection after bulk action

#### Inline Actions
Both actions use `event.stopPropagation()` to prevent row navigation.

**Phone button:**
1. Creates `call` activity with description "Outbound call initiated"
2. Updates lead's `lastContactedAt` to current timestamp
3. Opens `tel:` link

**Email button:**
1. Creates `email_sent` activity with description "Email initiated"
2. Updates lead's `lastContactedAt` to current timestamp
3. Opens `mailto:` link

#### Row Navigation
- Clicking anywhere on the row (except action buttons) navigates to `/leads/:id`

---

### LeadDetailPage — Detail View (`/leads/:id`)

#### Layout
3-column grid on large screens (`lg:grid-cols-3`), stacks on mobile:
- **Column 1 (1/3):** Contact card + AI suggestions
- **Columns 2–3 (2/3):** Add note + activity timeline

#### Contact Card (Left Column)

**Header:**
- Lead name (`firstName lastName`)
- Job title
- Status dropdown (Select component) — changing status triggers:
- **Edit / Save / Cancel buttons** — toggling Edit mode makes all contact fields (name, company, job title, phone, email, location, etc.) editable inline; Save persists via `updateLead()`; Cancel discards changes
  1. `updateLead(id, { status })` — updates the lead
  2. `addActivity()` — creates `status_change` activity with description "Status changed to [Label]"

**Contact Info:**
- Company + employee count (Building2 icon)
- Location (MapPin icon)
- Timezone (Globe icon) — shown when `timezone` is populated; sourced from Apollo import
- Phone (clickable — triggers call action + activity logging)
- Email (clickable — triggers email action + activity logging)
- LinkedIn profile link (if `linkedinUrl` exists, external link)

**Footer:**
- "Assigned to [UserName]"
- Tags displayed as secondary badges

#### AI Suggestions Card (Left Column, below contact card)

- **Only rendered** if there are undismissed suggestions for this lead
- Header: "AI Action Items" with Sparkles icon
- Each suggestion shows:
  - Suggestion text
  - Dismiss button (X icon) — calls `dismissSuggestion(id)`
- Styled with primary/5 background, primary/20 border

#### Add Note (Right Column, top)

- Textarea with placeholder "Add a note..."
- "Add" button (disabled when textarea is empty)
- On submit: creates `note` activity with the textarea content as description, clears textarea

#### Activity Timeline (Right Column, below note)

- Header: "Activity Timeline"
- Empty state: "No activity recorded yet"
- Activities filtered by `leadId` and sorted newest-first
- Each activity entry shows:
  - **Icon** (in a circle, connected by vertical line to next entry):
    - call → PhoneCall
    - email_sent → MailOpen
    - email_received → Mail
    - note → MessageSquare
    - status_change → Tag
    - meeting → Users
  - **Description** text
  - **Timestamp** + user name (Clock icon)
- Vertical connector line between entries (absolute positioned, `bg-border`)

---

## Component & Function Reference

### LeadsPage

**Hooks:** `useLeads()`, `useActivities()`, `useSuggestions()`, `useProfiles()`, `useAuth()`, `useNavigate()`

**State:**
- `search: string` — search query
- `statusFilter: string` — 'all' | LeadStatus
- `selected: Set<string>` — selected lead IDs for bulk actions

**Key computed value:**
```typescript
const visibleLeads = useMemo(() => {
  let filtered = isAdmin ? leads : leads.filter(l => l.assignedTo === user?.id);
  if (statusFilter !== 'all') filtered = filtered.filter(l => l.status === statusFilter);
  if (search) filtered = filtered.filter(/* name, company, email match */);
  return filtered;
}, [leads, isAdmin, user, statusFilter, search]);
```

**Constants:** `statusConfig` — maps LeadStatus to `{ label, className }` for badge styling

### LeadDetailPage

**Hooks:** `useLeads()`, `useActivities()`, `useSuggestions()`, `useProfiles()`, `useAuth()`, `useParams()`, `useNavigate()`

**State:**
- `newNote: string` — note textarea content

**Key functions:**
- `handleStatusChange(status)` — updates lead status + creates activity
- `handleAddNote()` — creates note activity from textarea
- `handleCall()` — creates call activity + updates lastContactedAt + opens tel:
- `handleEmailClick()` — creates email_sent activity + updates lastContactedAt + opens mailto:

**Constants:**
- `statusConfig` — same badge styling map as LeadsPage
- `activityIcons` — maps ActivityType to Lucide icon component

---

## Data Dependencies

| Data | Source | Used In |
|------|--------|---------|
| Leads | `useLeads()` | Both pages |
| Activities | `useActivities()` | Detail page (timeline) |
| Suggestions | `useSuggestions()` | Detail page (AI card) |
| Profiles | `useProfiles()` | Detail page (assigned user name, activity user names) |
| Current User | `useAuth().user` | Both pages (activity creation) |
| isAdmin | `useAuth().isAdmin` | Both pages (column visibility) |

### Hook Mutations Used
- `updateLead()` — status changes, lastContactedAt updates
- `addActivity()` — call/email/note/status_change logging
- `dismissSuggestion()` — AI suggestion dismissal

---

## Known Limitations & TODOs

- Lead field editing is available on the detail page (Edit/Save/Cancel buttons); only status can be changed from the list view
- No lead creation UI (leads only come from Lead Generator import or mock data)
- No lead deletion
- No sorting on table columns
- No pagination (all leads rendered at once)
- No deal information shown on detail page
- No email history on detail page (emails are in Outreach)
- No lead merge/deduplication
- No export (CSV, etc.)
- Bulk actions only support Mark Warm / Mark Dead (no assign, no delete, no tag)

---

## Future Considerations

- Add inline editing for lead fields on detail page
- Add lead creation form/modal
- Add deal section to detail page showing associated deals
- Add email history section to detail page
- Add pagination or virtual scrolling for large lead lists
- Add column sorting (by name, company, status, date)
- Add more bulk actions (assign, tag, delete)

---

## Changelog

| Date | Change | Files Affected |
|------|--------|----------------|
| 2026-03-22 | Initial documentation created | — |
| 2026-03-23 | Data from Supabase, role filtering via RLS, mockUsers replaced | `LeadsPage.tsx`, `LeadDetailPage.tsx` |
| 2026-03-23 | Email status badge added to leads table (Verified/Guessed/Unverified/Invalid) | LeadsPage.tsx, LeadDetailPage.tsx |
| 2026-03-23 | Engagement score badge added to leads table and detail page (opens×1 + clicks×3 + replies×5); `timezone` field added to lead contact card (sourced from Apollo import, used by Smart Send Timing) | LeadsPage.tsx, LeadDetailPage.tsx |
| 2026-03-23 | Lead editing: all fields editable on detail page with Edit/Save/Cancel | LeadDetailPage.tsx |
