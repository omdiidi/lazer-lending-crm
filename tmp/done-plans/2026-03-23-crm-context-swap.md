# Plan: CRM Context Swap — Mock to Supabase via React Query

**Confidence: 8/10** — Large scope (17 files) but each change is mechanical. The pattern is consistent across all files.

## Files Being Changed

```
src/
├── contexts/
│   └── CRMContext.tsx              ← DELETED (replaced by React Query hooks)
├── data/
│   └── mockData.ts                 ← DELETED (no longer imported anywhere)
├── hooks/
│   ├── use-leads.ts                ← NEW (React Query hook for leads)
│   ├── use-activities.ts           ← NEW (React Query hook for activities)
│   ├── use-deals.ts                ← NEW (React Query hook for deals)
│   ├── use-emails.ts               ← NEW (React Query hook for emails)
│   ├── use-suggestions.ts          ← NEW (React Query hook for suggestions)
│   ├── use-campaigns.ts            ← NEW (React Query hook for campaigns)
│   ├── use-sequences.ts            ← NEW (React Query hook for sequences)
│   └── use-profiles.ts             ← NEW (React Query hook for profiles)
├── lib/api/
│   └── leads.ts                    ← MODIFIED (add createLeads bulk function)
├── pages/
│   ├── DashboardPage.tsx           ← MODIFIED (hooks + dynamic leaderboard)
│   ├── LeadsPage.tsx               ← MODIFIED (hooks, remove role filter)
│   ├── LeadDetailPage.tsx          ← MODIFIED (hooks, remove mockUsers)
│   ├── LeadGeneratorPage.tsx       ← MODIFIED (useLeads hook)
│   ├── OutreachPage.tsx            ← MODIFIED (hooks, remove mockUsers/mockSequences)
│   ├── PipelinePage.tsx            ← MODIFIED (hooks, remove role filter + mockUsers)
│   └── SettingsPage.tsx            ← MODIFIED (useProfiles, remove mockUsers)
├── App.tsx                         ← MODIFIED (remove CRMProvider wrapper)
docs/
├── OVERVIEW.md                     ← MODIFIED (changelog)
├── state-management.md             ← MODIFIED (rewrite CRMContext → hooks section)
├── dashboard.md                    ← MODIFIED (note dynamic leaderboard)
└── leads.md, outreach.md, pipeline.md, settings.md  ← MODIFIED (changelogs)
```

---

## Architecture Overview

### Before
```
App.tsx
  └─ CRMProvider (6 useState arrays from mockData, 10 mutation callbacks)
       └─ Pages call useCRM() → get ALL data + ALL mutations
            └─ Client-side role filtering: isAdmin ? all : filtered
```

### After
```
App.tsx
  └─ QueryClientProvider (already exists, now actively used)
       └─ Pages call specific hooks: useLeads(), useDeals(), etc.
            └─ Each hook: useQuery (fetch from Supabase) + useMutation (write to Supabase)
                 └─ RLS handles role filtering at the database level
```

### Data Flow (per hook)
```
Page component
  → useLeads() hook
    → useQuery({ queryKey: ['leads'], queryFn: getLeads })
      → src/lib/api/leads.ts → supabase.from('leads').select() → RLS filters → rows
      → transforms.ts toCamelCase → Lead[]
    → useMutation → src/lib/api/leads.ts → supabase.from('leads').update()
      → onSuccess: invalidateQueries(['leads']) → automatic refetch
```

### Key Architectural Wins
1. **No more CRMContext** — no single provider re-rendering all consumers on any change
2. **RLS replaces client-side filtering** — `isAdmin ? all : filtered` patterns removed
3. **React Query manages caching** — stale-while-revalidate, background refetch, deduplication
4. **Loading/error states per entity** — leads can load while deals are still fetching
5. **Mutations auto-invalidate** — update a lead → leads list automatically refetches
6. **mockData.ts fully deleted** — zero mock code remains

---

## Key Pseudocode

### Hook Pattern (same for all 8 hooks)

```typescript
// src/hooks/use-leads.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api/leads';
import type { Lead } from '@/types/crm';

export function useLeads() {
  const queryClient = useQueryClient();

  const { data: leads = [], isLoading, error } = useQuery({
    queryKey: ['leads'],
    queryFn: api.getLeads,
  });

  const updateLeadMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Lead> }) =>
      api.updateLead(id, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  });

  const addLeadsMutation = useMutation({
    mutationFn: (leads: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>[]) =>
      api.createLeads(leads),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  });

  return {
    leads,
    isLoading,
    error,
    updateLead: (id: string, updates: Partial<Lead>) =>
      updateLeadMutation.mutate({ id, updates }),
    addLeads: (leads: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>[]) =>
      addLeadsMutation.mutate(leads),
  };
}
```

### Page Consumer Pattern (example: LeadsPage)

```typescript
// BEFORE:
const { leads, updateLead, addActivity } = useCRM();
const myLeads = isAdmin ? leads : leads.filter(l => l.assignedTo === user?.id);

// AFTER:
const { leads, updateLead } = useLeads();           // RLS filters automatically
const { addActivity } = useActivities();
const { profiles } = useProfiles();                  // Replaces mockUsers
// No role filter needed — leads already scoped by RLS
```

### Mutation Call Pattern (example: adding an activity)

```typescript
// BEFORE:
addActivity({
  id: `a-${Date.now()}`,       // ← client-generated ID
  leadId: lead.id,
  userId: user!.id,
  type: 'call',
  description: 'Outbound call initiated',
  timestamp: new Date().toISOString(),
});

// AFTER:
addActivity({
  leadId: lead.id,              // ← no 'id' field, DB generates UUID
  userId: user!.id,
  type: 'call',
  description: 'Outbound call initiated',
  timestamp: new Date().toISOString(),
});
```

### Dashboard Leaderboard (becomes dynamic)

```typescript
// BEFORE (hardcoded):
[
  { name: 'Marcus Rivera', calls: 8, emails: 12, leads: leads.filter(l => l.assignedTo === 'u2').length },
  { name: 'Aisha Patel', calls: 6, emails: 9, leads: leads.filter(l => l.assignedTo === 'u3').length },
]

// AFTER (dynamic):
const { profiles } = useProfiles();
const employees = profiles.filter(p => p.role === 'employee');
employees.map(emp => ({
  name: emp.name,
  calls: activities.filter(a => a.userId === emp.id && a.type === 'call').length,
  emails: activities.filter(a => a.userId === emp.id && a.type === 'email_sent').length,
  leads: leads.filter(l => l.assignedTo === emp.id).length,
}))
```

### Loading State Pattern

```typescript
// Simple loading check — add to each page that fetches data
const { leads, isLoading: leadsLoading } = useLeads();
const { deals, isLoading: dealsLoading } = useDeals();

if (leadsLoading || dealsLoading) {
  return (
    <div className="p-6 flex items-center justify-center">
      <div className="text-sm text-muted-foreground">Loading...</div>
    </div>
  );
}
```

---

## Task Execution Order

### Task 1: Add `createLeads` bulk function to API layer

Add to `src/lib/api/leads.ts`:
```typescript
export async function createLeads(
  leads: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>[]
): Promise<Lead[]> {
  const snaked = leads.map(l => toSnakeCase(l as unknown as Record<string, unknown>));
  const { data, error } = await supabase
    .from('leads')
    .insert(snaked)
    .select();
  if (error) throw error;
  return transformRows<Lead>(data || []);
}
```

### Task 2: Create all 8 React Query hooks

**src/hooks/use-leads.ts**
- Query: `getLeads()` with key `['leads']`
- Mutations: `updateLead`, `addLeads` (bulk), `deleteLead`
- Invalidates `['leads']` on success

**src/hooks/use-activities.ts**
- Query: `getActivities()` or `getActivitiesByLead(leadId)` depending on arg
- Key: `['activities']` or `['activities', leadId]`
- Mutations: `addActivity`
- Invalidates `['activities']` on success

**src/hooks/use-deals.ts**
- Query: `getDeals()` with key `['deals']`
- Mutations: `updateDeal`, `createDeal`, `deleteDeal`
- Invalidates `['deals']` on success

**src/hooks/use-emails.ts**
- Query: `getEmails()` with key `['emails']`
- Mutations: `addEmail`, `updateEmail`, `markEmailRead`, `deleteEmail`
- Invalidates `['emails']` on success

**src/hooks/use-suggestions.ts**
- Query: `getSuggestions()` or `getSuggestionsByLead(leadId)` depending on arg
- Key: `['suggestions']` or `['suggestions', leadId]`
- Mutations: `dismissSuggestion`
- Invalidates `['suggestions']` on success

**src/hooks/use-campaigns.ts**
- Query: `getCampaigns()` with key `['campaigns']`
- Mutations: `addCampaign`
- Invalidates `['campaigns']` on success

**src/hooks/use-sequences.ts**
- Query: `getSequences()` with key `['sequences']`
- No mutations (read-only for now)

**src/hooks/use-profiles.ts**
- Query: `getProfiles()` with key `['profiles']`
- No mutations exposed (profile update is rare, can add later)

### Task 3: Update App.tsx — remove CRMProvider

```typescript
// BEFORE:
<CRMProvider>
  <Routes>...</Routes>
</CRMProvider>

// AFTER:
<Routes>...</Routes>
```

Remove the `CRMProvider` import. `QueryClientProvider` (already wrapping the entire app) is all React Query needs.

### Task 4: Update DashboardPage.tsx

- Replace `useCRM()` with `useLeads()`, `useActivities()`, `useDeals()`
- Add `useProfiles()` for leaderboard
- Remove role-based filters (`isAdmin ? leads : leads.filter(...)`) — RLS handles it
- Make leaderboard fully dynamic (compute calls/emails from activities)
- Add loading state

### Task 5: Update LeadsPage.tsx

- Replace `useCRM()` with `useLeads()`, `useActivities()`
- Replace `mockUsers` import with `useProfiles()`
- Remove role-based filter — RLS handles it
- Update mutations: drop `id` field from `addActivity` calls
- Update `mockUsers.find()` lookups to `profiles.find()`
- Add loading state

### Task 6: Update LeadDetailPage.tsx

- Replace `useCRM()` with `useLeads()`, `useActivities(leadId)`, `useSuggestions(leadId)`
- Replace `mockUsers` import with `useProfiles()`
- Update mutations: drop `id` field from `addActivity` calls
- Replace `mockUsers.find()` with `profiles.find()`
- Add loading state

### Task 7: Update LeadGeneratorPage.tsx

- Replace `useCRM()` with `useLeads()`
- Update `handleImport`: strip `id`/`createdAt`/`updatedAt` from generated leads before calling `addLeads()`
- Leads no longer need pre-assigned IDs

### Task 8: Update OutreachPage.tsx

- Replace `useCRM()` with `useLeads()`, `useEmails()`, `useCampaigns()`, `useActivities()`
- Replace `mockUsers` import with `useProfiles()`
- Replace `mockSequences` import with `useSequences()`
- Update all mutations: drop `id` fields from addEmail, addActivity, addCampaign calls
- Replace `mockUsers.find()` with `profiles.find()`
- Add loading state

### Task 9: Update PipelinePage.tsx

- Replace `useCRM()` with `useDeals()`, `useLeads()`
- Replace `mockUsers` import with `useProfiles()`
- Remove role-based filter (`isAdmin ? deals : deals.filter(...)`) — RLS handles it
- Replace `mockUsers.find()` with `profiles.find()`
- Add loading state

### Task 10: Update SettingsPage.tsx

- Replace `mockUsers` import with `useProfiles()`
- Replace `mockUsers` references with `profiles`
- Add loading state

### Task 11: Delete CRMContext.tsx and mockData.ts

- Delete `src/contexts/CRMContext.tsx`
- Delete `src/data/mockData.ts`
- Verify no remaining imports reference either file

### Task 12: Verify build + update docs

- `npm run build` must pass
- Update `docs/state-management.md` — rewrite CRMContext section to describe React Query hooks
- Update `docs/OVERVIEW.md` — major changes log entry
- Update `docs/dashboard.md` — note leaderboard is now dynamic
- Update changelogs in all affected feature docs

---

## Validation Gates

1. `npm run build` passes with zero TypeScript errors
2. `npm run dev` starts without errors
3. Login as sarah@integrateapi.ai → Dashboard shows all 22 leads, 10 deals
4. Login as marcus@integrateapi.ai → Dashboard shows only Marcus's assigned leads/deals
5. Navigate to Leads → table populates from database
6. Navigate to Pipeline → deals appear in correct stages
7. Navigate to Outreach → inbox shows threaded emails
8. Click a lead → detail page shows activities + suggestions
9. Add a note on a lead → refresh → note persists
10. Drag a deal to a new stage → refresh → stage persists
11. Lead Generator → import leads → navigate to Leads → imported leads appear

---

## Deprecated Code (to remove)

| File | Action | Reason |
|------|--------|--------|
| `src/contexts/CRMContext.tsx` | DELETE | Replaced by React Query hooks |
| `src/data/mockData.ts` | DELETE | No remaining consumers |
| Role-filter patterns in pages | REMOVE | RLS handles scoping at DB level |
| `mockUsers` imports in 5 pages | REMOVE | Replaced by `useProfiles()` hook |
| `mockSequences` import in OutreachPage | REMOVE | Replaced by `useSequences()` hook |
| Client-generated IDs (`id: 'a-${Date.now()}'`) | REMOVE | DB generates UUIDs |
