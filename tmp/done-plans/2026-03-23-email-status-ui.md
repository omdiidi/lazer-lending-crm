# Plan: Email Status & Tracking UI Indicators

**Confidence: 9/10** — Pure frontend display changes. No backend work. Data already exists in DB.

## Goal

Show email verification status on leads and email tracking data (opened/clicked/bounced) in the inbox. Users need to see at a glance which leads have verified emails and whether sent emails were opened.

## Files Being Changed

```
src/
├── pages/
│   ├── OutreachPage.tsx              ← MODIFIED (add tracking indicators to inbox messages)
│   ├── LeadsPage.tsx                 ← MODIFIED (add emailStatus badge to leads table)
│   └── LeadDetailPage.tsx            ← MODIFIED (add emailStatus badge to contact card)
docs/
├── outreach.md                       ← MODIFIED (changelog)
├── leads.md                          ← MODIFIED (changelog)
├── OVERVIEW.md                       ← MODIFIED (changelog)
```

---

## Architecture Overview

No architecture changes. All data already flows:
- `Lead.emailStatus` is fetched via `useLeads()` and available in all lead-rendering pages
- `EmailMessage.openedAt`, `clickedAt`, `bouncedAt` are fetched via `useEmails()` and available in OutreachPage

We just need to render visual indicators for these fields.

---

## Key Pseudocode

### 1. LeadsPage — emailStatus badge in table

Add a new column to the leads table between "Email" and "Assigned Rep":

```tsx
// In the table header:
<TableHead className="text-xs">Email Status</TableHead>

// In the table row:
<TableCell className="text-xs">
  {l.emailStatus === 'verified' && (
    <Badge variant="secondary" className="text-[10px] bg-emerald-50 text-emerald-700">Verified</Badge>
  )}
  {l.emailStatus === 'likely_to_engage' && (
    <Badge variant="secondary" className="text-[10px] bg-emerald-50 text-emerald-700">Verified</Badge>
  )}
  {l.emailStatus === 'guessed' && (
    <Badge variant="secondary" className="text-[10px] bg-amber-50 text-amber-700">Guessed</Badge>
  )}
  {l.emailStatus === 'unverified' && (
    <Badge variant="secondary" className="text-[10px] bg-slate-50 text-slate-500">Unverified</Badge>
  )}
  {l.emailStatus === 'invalid' && (
    <Badge variant="secondary" className="text-[10px] bg-red-50 text-red-700">Invalid</Badge>
  )}
  {l.emailStatus === 'extrapolated' && (
    <Badge variant="secondary" className="text-[10px] bg-amber-50 text-amber-700">Guessed</Badge>
  )}
  {!l.emailStatus && (
    <Badge variant="secondary" className="text-[10px] bg-slate-50 text-slate-500">Unknown</Badge>
  )}
</TableCell>
```

Better — create a reusable helper function:

```tsx
function emailStatusBadge(status?: string) {
  switch (status) {
    case 'verified':
    case 'likely_to_engage':
      return <Badge variant="secondary" className="text-[10px] bg-emerald-50 text-emerald-700">Verified</Badge>;
    case 'guessed':
    case 'extrapolated':
      return <Badge variant="secondary" className="text-[10px] bg-amber-50 text-amber-700">Guessed</Badge>;
    case 'invalid':
      return <Badge variant="secondary" className="text-[10px] bg-red-50 text-red-700">Invalid</Badge>;
    case 'unverified':
      return <Badge variant="secondary" className="text-[10px] bg-slate-50 text-slate-500">Unverified</Badge>;
    default:
      return <Badge variant="secondary" className="text-[10px] bg-slate-50 text-slate-500">Unknown</Badge>;
  }
}
```

### 2. LeadDetailPage — emailStatus badge next to email

In the contact card where the email is displayed, add the badge after the email address:

```tsx
<span className="flex items-center gap-2">
  <a href={`mailto:${lead.email}`}>{lead.email}</a>
  {emailStatusBadge(lead.emailStatus)}
</span>
```

### 3. OutreachPage — tracking indicators on sent emails

In the conversation view where individual messages are rendered, add small icons below outbound messages:

```tsx
// Only for outbound messages — show tracking status
{msg.direction === 'outbound' && (
  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
    {msg.openedAt && (
      <span className="flex items-center gap-0.5" title={`Opened ${new Date(msg.openedAt).toLocaleString()}`}>
        <Eye className="h-3 w-3" /> Opened
      </span>
    )}
    {msg.clickedAt && (
      <span className="flex items-center gap-0.5" title={`Clicked ${new Date(msg.clickedAt).toLocaleString()}`}>
        <MousePointerClick className="h-3 w-3" /> Clicked
      </span>
    )}
    {msg.bouncedAt && (
      <span className="flex items-center gap-0.5 text-red-500" title={`Bounced ${new Date(msg.bouncedAt).toLocaleString()}`}>
        <AlertTriangle className="h-3 w-3" /> Bounced
      </span>
    )}
  </div>
)}
```

Also in the thread list (left panel), add a small indicator if the latest outbound in the thread was opened:

```tsx
// In thread list entry, after the timestamp
{thread.messages.some(m => m.direction === 'outbound' && m.openedAt) && (
  <Eye className="h-3 w-3 text-emerald-500" title="Opened" />
)}
```

---

## Task Execution Order

### Task 1: Add emailStatus badge to LeadsPage

- Add `emailStatusBadge()` helper function
- Add "Email Status" column header to the table
- Add badge cell to each row using the helper
- Import `Badge` if not already imported

### Task 2: Add emailStatus badge to LeadDetailPage

- Add the same `emailStatusBadge()` helper (or copy it — it's small)
- Find the email display in the contact card
- Add the badge next to the email address

### Task 3: Add tracking indicators to OutreachPage

- Import `Eye`, `MousePointerClick`, `AlertTriangle` from lucide-react
- In the conversation view message rendering, add tracking indicators below outbound messages
- In the thread list, add a small "opened" indicator if any outbound in the thread was opened

### Task 4: Update documentation

- `docs/leads.md`: changelog for emailStatus badge
- `docs/outreach.md`: changelog for tracking indicators
- `docs/OVERVIEW.md`: changelog

---

## Validation Gates

1. `npm run build` passes
2. Leads page table shows emailStatus badges (Verified/Guessed/Unverified/Invalid)
3. Lead detail page shows emailStatus badge next to email
4. Outreach inbox: sent emails show "Opened" / "Clicked" / "Bounced" indicators when applicable
5. Thread list shows opened indicator for threads with opened emails

---

## Deprecated Code (to remove)

None — purely additive.
