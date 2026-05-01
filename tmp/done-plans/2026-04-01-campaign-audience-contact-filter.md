# Plan: Campaign audience contact filter

## Goal

When building a campaign, show only leads who have **never been contacted** by default. Add a "Hide contacted" toggle so the user can opt into seeing previously-contacted leads too. Leads currently queued in an active campaign (pending enrollment, email not yet sent) are always visible but show a warning badge.

## Why

Without this, users accidentally include leads they've already pitched in new campaigns. The current AudienceSelector has no awareness of email history.

## Success Criteria

- [ ] AudienceSelector defaults to hiding contacted leads
- [ ] "Hide contacted" toggle is visible and functional
- [ ] A lead is "contacted" if they have any outbound email in the `emails` table OR any `campaign_enrollments` row with status other than `pending`
- [ ] Leads with `pending` enrollments always appear regardless of toggle, with an "In Campaign" badge
- [ ] Contacted leads (when toggle is OFF) show a "Contacted" badge
- [ ] Lead counts in the header update to reflect the current filter state
- [ ] No filter is applied until contact history has loaded (no flicker)
- [ ] No schema changes required

## All Needed Context

### AudienceSelector — current full file (`src/components/campaigns/AudienceSelector.tsx`)

```typescript
interface AudienceSelectorProps {
  leads: Lead[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  unsubscribedEmails?: Set<string>;  // default: new Set()
}
```

Filtering logic (lines 27-38) — this is what we extend:
```typescript
const filtered = useMemo(() => {
  return leads.filter(l => {
    if (unsubscribedEmails.has(l.email)) return false;
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
    if (industryFilter !== 'all' && l.industry !== industryFilter) return false;
    if (search) { ... }
    return true;
  });
}, [leads, statusFilter, industryFilter, search, unsubscribedEmails]);
```

**IMPORTANT**: `colSpan={5}` is hardcoded at lines 105 and 108 (empty-state and overflow rows). After adding the History column, update BOTH to `colSpan={6}`.

Filter bar (lines 57-78): [search input] [Status select] [Industry select]. New toggle goes at the end of this row.

Table columns (lines 86-91): checkbox, Name, Company, Industry, Status. Add "History" as 6th column.

`Switch` component exists at `src/components/ui/switch.tsx` — use it directly.

### CampaignBuilderPage — relevant current state (`src/pages/CampaignBuilderPage.tsx`)

```typescript
// line 42-44
const { user } = useAuth();
const { leads, addLeads } = useLeads();
```

`supabase` is imported at line 7. The existing warmup `useEffect` (lines 72-80) uses supabase directly — follow same pattern.

**Current `<AudienceSelector>` call (no `unsubscribedEmails` prop):**
```tsx
<AudienceSelector
  leads={emailSafeLeads}
  selectedIds={selectedLeadIds}
  onSelectionChange={setSelectedLeadIds}
/>
```
Task 2d adds the three new props to this exact call — do NOT add `unsubscribedEmails` (it was never passed).

### Existing API patterns (`src/lib/api/campaigns.ts`, `src/lib/api/emails.ts`)

All functions import and use `supabase` from `@/lib/supabase` directly. No ORM. Pattern:
```typescript
const { data, error } = await supabase.from('table').select('col').eq('col', value);
if (error) throw error;
return data ?? [];
```

`getEmails(userId?)` already accepts an optional userId and filters with `.eq('user_id', userId)` — follow this pattern for the new emails query.

For enrollment scoping: `campaign_enrollments` does not have a direct `user_id` column — scope to the current user by joining through the `campaigns` table (`campaigns.user_id = currentUserId`). Use a subquery: `.in('campaign_id', supabase.from('campaigns').select('id').eq('user_id', userId))` — but Supabase JS v2 does not support subquery syntax this way. Instead, fetch the user's campaign IDs first and use `.in('campaign_id', campaignIds)`.

## Files Being Changed

```
src/
  lib/
    api/
      campaigns.ts          ← MODIFIED (replace getContactedLeadIds + getPendingEnrollmentLeadIds with single getEnrollmentLeadIdsByStatus; scope to user's campaigns)
      emails.ts             ← MODIFIED (add getOutboundEmailAddresses(userId))
  pages/
    CampaignBuilderPage.tsx ← MODIFIED (fetch contact history, pass new props to AudienceSelector)
  components/
    campaigns/
      AudienceSelector.tsx  ← MODIFIED (hideContacted toggle, filter logic, history badges, colSpan fix)
```

## Architecture Overview

```
CampaignBuilderPage (on mount)
  ├── fetch user's outbound email addresses (filtered by user.id) → Set<string>
  ├── fetch user's campaign enrollments → split into contacted Set + pending Set
  └── set contactHistoryLoaded = true when done
       ↓ all passed as new props
AudienceSelector
  ├── hideContacted state (default: true)
  ├── only applies filter when contactHistoryLoaded = true (no flicker)
  ├── isContacted(lead) = contactedEmails.has(lead.email) || enrolledLeadIds.has(lead.id)
  ├── isPending(lead) = pendingLeadIds.has(lead.id)
  ├── filtered memo: if (hideContacted && loaded && isContacted(l) && !isPending(l)) return false
  ├── toggle UI in filter bar
  └── History column: "In Campaign" | "Contacted" badges
```

## Key Pseudocode

### New API functions

```typescript
// src/lib/api/emails.ts
export async function getOutboundEmailAddresses(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('emails')
    .select('to')
    .eq('direction', 'outbound')
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (error) throw error;
  return new Set((data ?? []).map(e => e.to));
}

// src/lib/api/campaigns.ts
// Single query replacing two — fetches all enrollment lead_ids for the current user's
// campaigns and splits into contacted (non-pending) vs pending Sets.
export async function getEnrollmentLeadIdsByStatus(
  userId: string
): Promise<{ contacted: Set<string>; pending: Set<string> }> {
  // Step 1: get the current user's campaign IDs
  const { data: campaignRows, error: campErr } = await supabase
    .from('campaigns')
    .select('id')
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (campErr) throw campErr;

  const campaignIds = (campaignRows ?? []).map(c => c.id);
  if (campaignIds.length === 0) {
    return { contacted: new Set(), pending: new Set() };
  }

  // Step 2: fetch all enrollments for those campaigns
  const { data, error } = await supabase
    .from('campaign_enrollments')
    .select('lead_id, status')
    .in('campaign_id', campaignIds)
    .not('lead_id', 'is', null);
  if (error) throw error;

  const contacted = new Set<string>();
  const pending = new Set<string>();
  for (const row of data ?? []) {
    if (!row.lead_id) continue;
    if (row.status === 'pending') {
      pending.add(row.lead_id);
    } else {
      contacted.add(row.lead_id);
    }
  }
  return { contacted, pending };
}
```

### CampaignBuilderPage — new state + useEffect

```typescript
// New state (add after existing state declarations)
const [contactedEmails, setContactedEmails] = useState<Set<string>>(new Set());
const [enrolledLeadIds, setEnrolledLeadIds] = useState<Set<string>>(new Set());
const [pendingLeadIds, setPendingLeadIds] = useState<Set<string>>(new Set());
const [contactHistoryLoaded, setContactHistoryLoaded] = useState(false);

// New useEffect (add after warmup useEffect)
useEffect(() => {
  if (!user?.id) return;
  Promise.all([
    getOutboundEmailAddresses(user.id),
    getEnrollmentLeadIdsByStatus(user.id),
  ]).then(([outboundEmails, { contacted, pending }]) => {
    setContactedEmails(outboundEmails);
    setEnrolledLeadIds(contacted);
    setPendingLeadIds(pending);
    setContactHistoryLoaded(true);
  }).catch(() => {
    setContactHistoryLoaded(true); // fail open — show all leads
  });
}, [user?.id]);
```

### Updated `<AudienceSelector>` call in CampaignBuilderPage JSX

```tsx
<AudienceSelector
  leads={emailSafeLeads}
  selectedIds={selectedLeadIds}
  onSelectionChange={setSelectedLeadIds}
  contactedEmails={contactedEmails}
  enrolledLeadIds={enrolledLeadIds}
  pendingLeadIds={pendingLeadIds}
  contactHistoryLoaded={contactHistoryLoaded}
/>
```

### AudienceSelector — updated interface

```typescript
interface AudienceSelectorProps {
  leads: Lead[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  unsubscribedEmails?: Set<string>;
  contactedEmails?: Set<string>;
  enrolledLeadIds?: Set<string>;
  pendingLeadIds?: Set<string>;
  contactHistoryLoaded?: boolean;
}
```

### AudienceSelector — updated filtered memo

Helpers defined **inside** the memo to avoid stale closures:

```typescript
const [hideContacted, setHideContacted] = useState(true);

const filtered = useMemo(() => {
  const isContacted = (l: Lead) =>
    (contactedEmails?.has(l.email) ?? false) || (enrolledLeadIds?.has(l.id) ?? false);
  const isPending = (l: Lead) => pendingLeadIds?.has(l.id) ?? false;

  return leads.filter(l => {
    if (unsubscribedEmails.has(l.email)) return false;
    // Only apply contact filter after data has loaded (prevents flicker)
    if (contactHistoryLoaded && hideContacted && isContacted(l) && !isPending(l)) return false;
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
    if (industryFilter !== 'all' && l.industry !== industryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return l.firstName.toLowerCase().includes(q) || l.lastName.toLowerCase().includes(q)
        || l.company.toLowerCase().includes(q) || l.email.toLowerCase().includes(q);
    }
    return true;
  });
}, [leads, statusFilter, industryFilter, search, unsubscribedEmails,
    hideContacted, contactedEmails, enrolledLeadIds, pendingLeadIds, contactHistoryLoaded]);
```

### AudienceSelector — toggle UI

Add at the end of the filter bar `<div className="flex items-center gap-3">`, after the Industry `<Select>`:

```tsx
import { Switch } from '@/components/ui/switch';

<div className="flex items-center gap-2">
  <Switch
    id="hide-contacted"
    checked={hideContacted}
    onCheckedChange={setHideContacted}
  />
  <label htmlFor="hide-contacted" className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
    Hide contacted
  </label>
</div>
```

### AudienceSelector — History column + colSpan fix

Add 6th header:
```tsx
<TableHead className="text-xs">History</TableHead>
```

Add to each row after the Status cell (helpers defined inline using the props):
```tsx
<TableCell>
  {(pendingLeadIds?.has(l.id)) ? (
    <Badge variant="outline" className="text-[10px] text-yellow-600 border-yellow-400">In Campaign</Badge>
  ) : (contactedEmails?.has(l.email) || enrolledLeadIds?.has(l.id)) ? (
    <Badge variant="outline" className="text-[10px] text-muted-foreground">Contacted</Badge>
  ) : null}
</TableCell>
```

**Update both `colSpan={5}` instances to `colSpan={6}`** (lines 105 and 108).

## Tasks (in order)

### Task 1 — API functions

**1a. MODIFY `src/lib/api/emails.ts`**: Add `getOutboundEmailAddresses(userId: string): Promise<Set<string>>` after the existing `getEmails` function. Full implementation in Key Pseudocode above.

**1b. MODIFY `src/lib/api/campaigns.ts`**: Add `getEnrollmentLeadIdsByStatus(userId: string): Promise<{ contacted: Set<string>; pending: Set<string> }>` after the existing `getEnrollments` function. Full implementation in Key Pseudocode above.

### Task 2 — CampaignBuilderPage

MODIFY `src/pages/CampaignBuilderPage.tsx`:

**2a.** Add imports:
```typescript
import { getEnrollmentLeadIdsByStatus } from '@/lib/api/campaigns';
import { getOutboundEmailAddresses } from '@/lib/api/emails';
```

**2b.** Add four state variables after the existing state block:
```typescript
const [contactedEmails, setContactedEmails] = useState<Set<string>>(new Set());
const [enrolledLeadIds, setEnrolledLeadIds] = useState<Set<string>>(new Set());
const [pendingLeadIds, setPendingLeadIds] = useState<Set<string>>(new Set());
const [contactHistoryLoaded, setContactHistoryLoaded] = useState(false);
```

**2c.** Add `useEffect` after the warmup `useEffect`. Full implementation in Key Pseudocode above.

**2d.** Find the `<AudienceSelector` JSX element and update to pass the four new props. Do NOT add `unsubscribedEmails` — it was never passed. Just add the four new ones as shown in Key Pseudocode.

### Task 3 — AudienceSelector

MODIFY `src/components/campaigns/AudienceSelector.tsx`:

**3a.** Add `import { Switch } from '@/components/ui/switch'` to imports.

**3b.** Update `AudienceSelectorProps` interface with the four new optional props.

**3c.** Destructure the new props in the function signature with defaults (`new Set()` for Sets, `false` for `contactHistoryLoaded`).

**3d.** Add `const [hideContacted, setHideContacted] = useState(true)` after the existing `useState` declarations.

**3e.** Replace the existing `filtered` useMemo with the updated version (helpers defined inside, new filter conditions, updated dep array).

**3f.** Add the "Hide contacted" Switch + label to the filter bar div (after the Industry Select).

**3g.** Add 6th `<TableHead>` for "History". Add the History `<TableCell>` to each row after the Status cell.

**3h.** Change BOTH `colSpan={5}` instances to `colSpan={6}` (empty state row and overflow row).

## Validation

```bash
cd /Users/nicholaspardon/Downloads/connect-crm
npx tsc --noEmit 2>&1 | head -40
```

All new props are optional with defaults — no existing callers break. Verify:
- Campaign builder opens, shows only fresh leads by default
- Toggle off → shows all leads with "Contacted" / "In Campaign" badges
- "In Campaign" leads appear regardless of toggle state

## Do NOT

- Do NOT add `unsubscribedEmails` to the `<AudienceSelector>` call — it is not currently passed
- Do NOT define `isContacted`/`isPending` outside the `useMemo` (stale closure)
- Do NOT apply the contact filter before `contactHistoryLoaded` is true
- Do NOT add schema changes or migrations
- Do NOT add time-window logic — "contacted" means ever

## Deprecated Code

None — this is additive only.
