# State Management

> AuthContext, React Query hooks, and all CRUD operations available to the application.

**Status:** Active
**Last Updated:** 2026-03-23
**Related Docs:** [OVERVIEW.md](./OVERVIEW.md) | [data-model.md](./data-model.md) | [architecture.md](./architecture.md)

---

## Overview

All application state is managed through one React Context provider and a set of React Query hooks:
- **AuthContext** — user identity, login/logout, role checks
- **React Query hooks** — all CRM business data (leads, activities, deals, emails, suggestions, campaigns, sequences, profiles) fetched from Supabase and cached by React Query

**AuthContext** uses Supabase Auth for real session persistence — login state survives page refresh. **CRM data** is fetched from Supabase via 8 entity-specific React Query hooks — data persists across page refreshes. `QueryClientProvider` (in `App.tsx`) replaces the former `CRMProvider`.

Additionally, two custom hooks provide utility functionality: `useToast` (notifications) and `useIsMobile` (responsive breakpoint).

---

## File Map

| File | Purpose |
|------|---------|
| `src/contexts/AuthContext.tsx` | Authentication provider and `useAuth()` hook |
| `src/hooks/use-leads.ts` | Leads query and mutations |
| `src/hooks/use-activities.ts` | Activities query and mutations |
| `src/hooks/use-deals.ts` | Deals query and mutations |
| `src/hooks/use-emails.ts` | Emails query and mutations |
| `src/hooks/use-suggestions.ts` | AI suggestions query and mutations |
| `src/hooks/use-campaigns.ts` | Campaigns query and mutations |
| `src/hooks/use-sequences.ts` | Sequences query |
| `src/hooks/use-profiles.ts` | User profiles query |
| `src/hooks/use-toast.ts` | Toast notification system (reducer-based) |
| `src/hooks/use-mobile.tsx` | Mobile viewport detection hook |

---

## AuthContext

### Provider: `AuthProvider`

Wraps the app in `App.tsx`, outside `BrowserRouter`. Available to all components including `LoginPage`.

### Hook: `useAuth()`

```typescript
interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  isAdmin: boolean;
  refreshUser: () => Promise<void>;
}
```

### State

| Field | Type | Initial Value | Description |
|-------|------|---------------|-------------|
| `user` | `User \| null` | `null` | Currently logged-in user object |
| `loading` | `boolean` | `true` | `true` while Supabase checks for an existing session on mount; set to `false` once the session check completes (regardless of result) |

### Methods

**`login(email, password) → Promise<boolean>`**
- Calls `supabase.auth.signInWithPassword({ email, password })`
- On success: returns `true` (the `onAuthStateChange` listener handles setting `user` state)
- On error: returns `false`
- The `onAuthStateChange` listener is the single source of truth — it fires the `SIGNED_IN` event, then fetches the user profile from the `profiles` table and sets `user` state

**`logout() → Promise<void>`**
- Immediately clears `user` state to `null` (synchronous, so the UI responds instantly)
- Calls `supabase.auth.signOut()` to invalidate the session on Supabase's side
- `onAuthStateChange` fires the `SIGNED_OUT` event, confirming the state clear

**`refreshUser() → Promise<void>`**
- Re-fetches the current user's profile from Supabase and updates the `user` state
- Uses `supabase.auth.getSession()` to obtain the session-based user ID, then queries the `profiles` table
- Called after profile edits in the Settings page so the UI (e.g., sidebar name display) reflects changes immediately without requiring a full page reload

### Session Listener

`onAuthStateChange` is registered once on mount (inside a `useEffect`). It is the **single source of truth** for auth state:

| Event | Action |
|-------|--------|
| `SIGNED_IN` | Fetches profile from `profiles` table, sets `user` state, sets `loading` to `false` |
| `SIGNED_OUT` | Sets `user` to `null` |
| `INITIAL_SESSION` | Handles the session restoration check on page load; sets `loading` to `false` when complete |

The listener is cleaned up via the subscription's `unsubscribe()` on unmount.

### Derived Values

**`isAdmin`**
- Computed: `user?.role === 'admin'`
- Used throughout the app for role-based view filtering

### Usage Pattern
```typescript
const { user, login, logout, isAdmin } = useAuth();

// Role-based data filtering (used in every page)
const myData = isAdmin ? allData : allData.filter(d => d.assignedTo === user?.id);
```

---

## React Query Hooks

`QueryClientProvider` (in `App.tsx`) is the single provider that enables React Query for the entire app. It replaces the former `CRMProvider`. There is no `CRMContext` or `useCRM()` hook — each page imports only the hooks it needs.

### Cache Invalidation Pattern

After a successful mutation, hooks call `queryClient.invalidateQueries({ queryKey: [entityKey] })` to refetch the affected entity. Loading and error states are per-entity, not global.

### Supabase Realtime Subscriptions

The four core hooks — `useLeads`, `useDeals`, `useEmails`, and `useActivities` — each establish a **Supabase Realtime channel** on mount (inside a `useEffect` that runs alongside the initial `useQuery`). The channel subscribes to all `postgres_changes` events (`INSERT`, `UPDATE`, `DELETE`) on the corresponding table. On any incoming event the hook calls `queryClient.invalidateQueries({ queryKey: [entityKey] })`, which causes React Query to refetch the data and update every component that consumes that hook.

This means:
- Changes made by any user (or by Edge Functions / background jobs) are automatically reflected in the UI without a page refresh.
- No manual polling is required.
- The subscription is torn down via the channel's `unsubscribe()` in the `useEffect` cleanup, preventing leaks on unmount.

Only the four core hooks carry Realtime subscriptions. The remaining hooks (`useSuggestions`, `useCampaigns`, `useSequences`, `useProfiles`) rely on the standard mutation-triggered invalidation pattern.

### Hook Reference

| Hook | Query Key | Data Returned | Mutations |
|------|-----------|---------------|-----------|
| `useLeads()` | `['leads']` | `Lead[]` | `addLeads`, `updateLead`, `deleteLead` |
| `useActivities()` | `['activities']` | `Activity[]` | `addActivity` |
| `useDeals()` | `['deals']` | `Deal[]` | `updateDeal` |
| `useEmails()` | `['emails']` | `EmailMessage[]` | `addEmail`, `markEmailRead`, `updateEmail` |
| `useSuggestions()` | `['suggestions']` | `AISuggestion[]` | `dismissSuggestion` |
| `useCampaigns()` | `['campaigns']` | `Campaign[]` | `addCampaign` |
| `useSequences()` | `['sequences']` | `Sequence[]` | — (read-only) |
| `useProfiles()` | `['profiles']` | `Profile[]` | `updateProfile` |

### Loading & Error States

Every hook exposes React Query's standard `isLoading` and `error` values. Components receive per-entity loading state rather than a single global loading flag.

### Role-Based Filtering

Client-side `isAdmin` role filtering has been removed. Row-Level Security (RLS) in Supabase handles data scoping at the database level — employees automatically receive only their assigned records.

### ID Generation

Client-generated IDs (`Date.now().toString()`, template strings) have been removed. The database now generates UUIDs for all new records.

---

## Custom Hooks

### `useToast()` — `src/hooks/use-toast.ts`

Toast notification system using a custom reducer pattern with external subscriber listeners.

```typescript
function useToast(): {
  toasts: ToasterToast[];
  toast: (props: Toast) => { id: string; dismiss: () => void; update: (props: ToasterToast) => void };
  dismiss: (toastId?: string) => void;
}
```

**Configuration:**
- `TOAST_LIMIT`: 1 (only 1 toast visible at a time)
- `TOAST_REMOVE_DELAY`: 1,000,000ms (~16 minutes before dismissed toasts are removed from DOM)

**Actions:** `ADD_TOAST`, `UPDATE_TOAST`, `DISMISS_TOAST`, `REMOVE_TOAST`

**Pattern:** State is held in a module-level variable (not in React state). Listeners are notified on dispatch. This allows toast to be called from outside React components.

### `useIsMobile()` — `src/hooks/use-mobile.tsx`

Responsive breakpoint detection hook.

```typescript
function useIsMobile(): boolean
```

- Returns `true` when viewport width < 768px
- Uses `window.matchMedia("(max-width: 767px)")`
- Listens for resize events via `addEventListener("change", ...)`
- Breakpoint: 768px (standard tablet boundary)

---

## Data Flow Diagram

```
Supabase (PostgreSQL + RLS)
    │
    ▼ (useQuery — fetched on mount, cached by React Query)
Entity Hooks (useLeads, useDeals, etc.)
    │
    ├──► Pages read data via entity-specific hooks
    │       │
    │       ├── RLS enforces role-based scoping at DB level
    │       ├── Derive computed values (useMemo)
    │       └── Render UI
    │
    └──◄ Pages call mutation functions
            │
            ├── addActivity() — logged on every user action
            ├── updateLead() — status changes, lastContactedAt
            ├── addEmail() — on compose/reply
            ├── addCampaign() — on campaign send (async/try-catch)
            ├── updateDeal() — drag-and-drop stage changes
            └── queryClient.invalidateQueries() — refetch after mutation
```

---

## Supabase Integration

**Auth:** `AuthContext` is fully wired to Supabase Auth. Login, logout, and session restoration all go through Supabase.

**CRM data:** All 8 React Query hooks are fully wired to Supabase via the typed API layer in `src/lib/api/`. All CRM data persists in the database and survives page refreshes.

**Client:** `src/lib/supabase.ts` — singleton Supabase client, initialized from `.env` vars
**Transforms:** `src/lib/transforms.ts` — `toCamelCase()`, `toSnakeCase()`, `transformRows()` for DB ↔ TypeScript conversion
**API Layer:** `src/lib/api/` — typed async functions for each entity (profiles, leads, activities, emails, deals, suggestions, campaigns, sequences)

See [schema.md](./schema.md) for full database documentation.

---

## Known Limitations & TODOs

- No validation on any CRM mutation (e.g., can set invalid status)
- No optimistic updates or rollback
- No undo/redo capability
- No batch update mechanism (each update triggers re-render)
- No event system or side effects (e.g., no auto-notification on new activity)
- Realtime subscriptions are on the four core hooks only; `useSuggestions`, `useCampaigns`, `useSequences`, and `useProfiles` still require a manual page action or refresh to pick up external changes

---

## Future Considerations

- Extend Supabase Realtime subscriptions to the remaining hooks (`useSuggestions`, `useCampaigns`, `useSequences`, `useProfiles`)
- Add optimistic updates for mutations to improve perceived performance
- Add per-entity error boundaries to isolate failures gracefully

---

## Changelog

| Date | Change | Files Affected |
|------|--------|----------------|
| 2026-03-22 | Initial documentation created | — |
| 2026-03-22 | Supabase client and API layer installed (not yet wired to contexts) | `supabase.ts`, `transforms.ts`, `api/*.ts` |
| 2026-03-22 | AuthContext rewritten for Supabase Auth (async login/logout, session persistence, loading state) | `AuthContext.tsx` |
| 2026-03-23 | CRMContext replaced by 8 React Query hooks, mockData.ts deleted | All hooks, all pages |
| 2026-03-23 | useProfiles: added updateProfile mutation. AuthContext: added refreshUser function | `use-profiles.ts`, `AuthContext.tsx` |
| 2026-03-23 | Supabase Realtime: leads, deals, emails, activities hooks auto-refresh on DB changes | `use-leads.ts`, `use-deals.ts`, `use-emails.ts`, `use-activities.ts` |
