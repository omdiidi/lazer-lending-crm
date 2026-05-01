# Plan: Phase B — Dashboard Real Data + Supabase Realtime

**Confidence: 9/10** — Dashboard is replacing hardcoded arrays with computed values. Realtime is adding useEffect subscriptions to existing hooks. No new APIs or Edge Functions.

## Goal

Replace hardcoded dashboard chart data with real computed metrics. Add Supabase Realtime listeners to core hooks so multi-user changes appear instantly.

## Files Being Changed

```
src/
├── pages/
│   └── DashboardPage.tsx               ← MODIFIED (replace hardcoded charts with real data)
├── hooks/
│   ├── use-leads.ts                    ← MODIFIED (add Realtime subscription)
│   ├── use-deals.ts                    ← MODIFIED (add Realtime subscription)
│   ├── use-emails.ts                   ← MODIFIED (add Realtime subscription)
│   └── use-activities.ts              ← MODIFIED (add Realtime subscription)
docs/
├── dashboard.md                        ← MODIFIED
├── state-management.md                 ← MODIFIED
├── OVERVIEW.md                         ← MODIFIED
```

---

## Architecture Overview

### Dashboard Charts — What Changes

| Chart | Before (hardcoded) | After (computed) |
|-------|-------------------|-----------------|
| Weekly Activity bar chart | Fixed Mon-Fri with hardcoded call/email counts | Computed from activities in the last 7 days, grouped by day |
| Revenue Pipeline line chart | Oct-Feb hardcoded, only March dynamic | All months computed from deals.createdAt, grouped by month |

Everything else on the dashboard is already using real data (KPI cards, lead funnel, team leaderboard).

### Supabase Realtime Pattern

```typescript
// Add to each hook's useEffect:
useEffect(() => {
  const channel = supabase
    .channel('leads-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}, [queryClient]);
```

When any user inserts/updates/deletes a row, all connected clients' React Query cache invalidates and refetches. Simple, no manual state merging.

---

## Key Pseudocode

### Dashboard — Weekly Activity (replace hardcoded)

```typescript
// Compute from activities in the last 7 days
const weeklyActivity = useMemo(() => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const recentActivities = activities.filter(a =>
    new Date(a.timestamp) >= weekAgo
  );

  return days.map((day, i) => {
    // Get the date for this day of the week
    const dayDate = new Date(weekAgo);
    dayDate.setDate(dayDate.getDate() + i);
    const dayStr = dayDate.toISOString().split('T')[0];

    const dayActivities = recentActivities.filter(a =>
      a.timestamp.startsWith(dayStr)
    );

    return {
      day,
      calls: dayActivities.filter(a => a.type === 'call').length,
      emails: dayActivities.filter(a => a.type === 'email_sent').length,
    };
  });
}, [activities]);
```

### Dashboard — Revenue Pipeline (replace hardcoded)

```typescript
// Compute from deals, grouped by month
const revenueData = useMemo(() => {
  const months: { month: string; value: number }[] = [];
  const now = new Date();

  // Last 6 months
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStr = d.toLocaleString('en-US', { month: 'short' });
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);

    const monthDeals = deals.filter(deal => {
      const created = new Date(deal.createdAt);
      return created >= monthStart && created <= monthEnd &&
        deal.stage !== 'closed_lost';
    });

    const value = monthDeals.reduce((sum, d) => sum + d.value, 0);
    months.push({ month: monthStr, value });
  }

  return months;
}, [deals]);
```

### Realtime Subscription (same pattern for all 4 hooks)

```typescript
// In each hook, add after the useQuery:
useEffect(() => {
  const channel = supabase
    .channel('TABLE-changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'TABLE' },
      () => { queryClient.invalidateQueries({ queryKey: ['QUERY_KEY'] }); }
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}, [queryClient]);
```

Tables and keys:
- `leads` → `['leads']`
- `deals` → `['deals']`
- `emails` → `['emails']`
- `activities` → `['activities']`

---

## Task Execution Order

### Task 1: Update DashboardPage — replace hardcoded charts
- Replace `weeklyActivity` hardcoded array with computed from activities (last 7 days)
- Replace `revenueData` hardcoded months with computed from deals (last 6 months)
- Import `useActivities` if not already imported

### Task 2: Add Realtime to use-leads.ts
- Import `supabase` from `@/lib/supabase`
- Add `useEffect` with channel subscription on `leads` table
- Invalidate `['leads']` on any change

### Task 3: Add Realtime to use-deals.ts
- Same pattern: subscribe to `deals` table changes

### Task 4: Add Realtime to use-emails.ts
- Same pattern: subscribe to `emails` table changes

### Task 5: Add Realtime to use-activities.ts
- Same pattern: subscribe to `activities` table changes

### Task 6: Update documentation

---

## Validation Gates

1. `npm run build` passes
2. Dashboard: Weekly Activity chart shows data from real activities (or empty if no recent activities)
3. Dashboard: Revenue Pipeline shows real deal values by month
4. Realtime: open app in 2 browser tabs, create a lead in tab 1 → appears in tab 2 without refresh
5. All docs updated

---

## Known Gotchas

```
1. Realtime subscriptions use channel names that must be unique per hook instance.
   Use descriptive names: 'leads-realtime', 'deals-realtime', etc.

2. The cleanup function (return () => supabase.removeChannel(channel)) prevents
   memory leaks when components unmount.

3. We invalidate the entire query key on ANY change (insert, update, delete).
   This causes a full refetch. For a small CRM this is fine — no need for
   granular cache updates.

4. Weekly activity: if there are no activities in the last 7 days, the chart
   shows all zeros. This is correct behavior.

5. Revenue chart: deals without createdAt (shouldn't happen, but guard) are excluded.

6. Realtime requires the tables to be in the supabase_realtime publication.
   This was already set up in the initial schema (leads, deals, activities, emails).
```

---

## Deprecated Code (to remove)

| Code | File | Reason |
|------|------|--------|
| Hardcoded `weeklyActivity` array | DashboardPage.tsx | Replaced with computed from real activities |
| Hardcoded `revenueData` months (Oct-Feb) | DashboardPage.tsx | Replaced with computed from real deals |
