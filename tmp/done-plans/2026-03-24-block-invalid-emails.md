# Plan: Block Invalid Emails from Being Sent

## Goal

Prevent emails from being sent to leads with `email_status: 'invalid'` across the entire CRM. Disable email actions on LeadsPage and LeadDetailPage, and add a server-side check in the campaign scheduler.

## Why

- Invalid emails waste Resend credits and increase bounce rates
- Hurts sender domain reputation (mail.integrateapi.ai)
- 9 leads currently have invalid status but are still fully emailable
- Campaign drip sequences keep sending to leads that bounced mid-sequence

## What

- Disable/grey out email links on LeadsPage for invalid leads
- Disable email button on LeadDetailPage for invalid leads
- Add email_status recheck in process-campaigns before sending
- Leave manual Outreach compose unrestricted (intentional user choice)

### Success Criteria

- [ ] Invalid email links are visually disabled and non-clickable on LeadsPage
- [ ] Invalid email button is disabled on LeadDetailPage
- [ ] process-campaigns skips enrollments where lead email is now invalid
- [ ] No type errors

## Files Being Changed

```
src/pages/LeadsPage.tsx                            ← MODIFIED (disable email for invalid leads)
src/pages/LeadDetailPage.tsx                       ← MODIFIED (disable email button for invalid leads)
supabase/functions/process-campaigns/index.ts      ← MODIFIED (recheck email_status before sending)
```

## Architecture Overview

Simple three-point change — no new files, no new tables, no new dependencies.

```
LeadsPage email cell ─── if invalid → grey text, no click handler, strikethrough
LeadDetailPage email button ─── if invalid → disabled button, tooltip text
process-campaigns ─── before building email batch → fetch email_status → skip invalid
```

## Known Gotchas

1. **LeadsPage email cell is always a `<button>`** — currently at line 228, it's always clickable. Change to conditional: `<button>` when valid, `<span>` when invalid.

2. **LeadDetailPage email button** — at line 272, it's a `<button>` with onClick. Disable it and change styling when invalid.

3. **process-campaigns already bulk-fetches leads** — at line 95-97, it fetches `id, first_name, company, timezone`. Just add `email_status` to the select and filter before building the email batch.

4. **`emailStatus` field on Lead type** — the frontend `Lead` type uses camelCase `emailStatus`, the database uses snake_case `email_status`. The existing `emailStatusBadge` function handles display.

## Key Pseudocode

### LeadsPage: Conditional email cell

```tsx
<TableCell>
  {lead.emailStatus === 'invalid' ? (
    <span className="inline-flex items-center gap-1 text-muted-foreground line-through text-sm cursor-not-allowed">
      <Mail className="h-3.5 w-3.5 flex-shrink-0" />
      {lead.email}
    </span>
  ) : (
    <button onClick={e => handleEmail(e, lead.id, lead.email)} className="inline-flex items-center gap-1 text-primary hover:underline text-sm truncate max-w-[180px]">
      <Mail className="h-3.5 w-3.5 flex-shrink-0" />
      {lead.email}
    </button>
  )}
</TableCell>
```

### LeadDetailPage: Conditional email button

```tsx
{lead.emailStatus === 'invalid' ? (
  <div className="flex items-center gap-2 text-muted-foreground cursor-not-allowed w-full min-w-0">
    <Mail className="h-4 w-4 flex-shrink-0" />
    <span className="truncate flex-1 line-through">{lead.email}</span>
    {emailStatusBadge(lead.emailStatus)}
  </div>
) : (
  <button onClick={handleEmailClick} className="flex items-center gap-2 text-primary hover:underline w-full min-w-0">
    <Mail className="h-4 w-4 flex-shrink-0" />
    <span className="truncate flex-1">{lead.email}</span>
    {emailStatusBadge(lead.emailStatus)}
  </button>
)}
```

### process-campaigns: Filter invalid before sending

```typescript
// In the leads bulk-fetch, add email_status:
const { data: leadsData } = await supabaseAdmin.from('leads')
  .select('id, first_name, company, timezone, email_status')
  .in('id', leadIds)

// Store email_status in the map:
const leadMap = new Map<string, { first_name: string; company: string; timezone: string | null; email_status: string | null }>()

// Before building resendEmails, filter out invalid:
enrollments = enrollments.filter(e => {
  if (!e.lead_id) return true  // non-lead enrollment, keep
  const lead = leadMap.get(e.lead_id)
  if (lead?.email_status === 'invalid') {
    console.log(`Skipping enrollment ${e.id}: lead ${e.lead_id} has invalid email`)
    return false
  }
  return true
})

if (enrollments.length === 0) continue
```

## Tasks (in implementation order)

### Task 1: LeadsPage — disable email for invalid leads

**MODIFY `src/pages/LeadsPage.tsx`**

Replace the email `<TableCell>` at lines 227-232. Currently it's always a clickable button. Change to:
- If `lead.emailStatus === 'invalid'`: render a `<span>` with `text-muted-foreground`, `line-through`, and `cursor-not-allowed`. No onClick.
- Otherwise: keep the existing clickable `<button>`.

### Task 2: LeadDetailPage — disable email button for invalid leads

**MODIFY `src/pages/LeadDetailPage.tsx`**

Replace the email button at lines 272-276. Currently always a clickable button. Change to:
- If `lead.emailStatus === 'invalid'`: render a `<div>` with `text-muted-foreground`, `line-through`, `cursor-not-allowed`. No onClick. Keep the emailStatusBadge.
- Otherwise: keep the existing clickable `<button>`.

### Task 3: process-campaigns — skip invalid emails (bulk + drip)

**MODIFY `supabase/functions/process-campaigns/index.ts`**

**3a. Bulk campaign path — add email_status to leads fetch (line 96):**
```typescript
.select('id, first_name, company, timezone, email_status')
```

**3b. Update the leadMap type (line 99-102) to include `email_status`:**
```typescript
{ first_name: string; company: string; timezone: string | null; email_status: string | null }
```
And store it: `leadMap.set(l.id, { first_name: l.first_name, company: l.company, timezone: l.timezone ?? null, email_status: l.email_status ?? null })`

**3c. Bulk path — filter invalid enrollments (after line 123, before "Build email batch"):**
```typescript
// Skip leads with invalid email
const preFilterCount = enrollments.length
enrollments = enrollments.filter(e => {
  if (!e.lead_id) return true  // bare-email enrollment, no lead to check — allow through
  const lead = leadMap.get(e.lead_id)
  if (lead?.email_status === 'invalid') {
    console.log(`Skipping enrollment ${e.id}: lead ${e.lead_id} has invalid email`)
    return false
  }
  return true
})

// Mark skipped enrollments as bounced so they don't re-process
if (enrollments.length < preFilterCount) {
  const skippedIds = (enrollments_before_filter)  // need to track these
  // Actually: collect IDs of invalid enrollments separately
}
```

Better approach — collect invalid IDs and batch-update to 'bounced':
```typescript
const invalidEnrollmentIds: string[] = []
enrollments = enrollments.filter(e => {
  if (!e.lead_id) return true
  const lead = leadMap.get(e.lead_id)
  if (lead?.email_status === 'invalid') {
    invalidEnrollmentIds.push(e.id)
    return false
  }
  return true
})

if (invalidEnrollmentIds.length > 0) {
  await supabaseAdmin.from('campaign_enrollments')
    .update({ status: 'bounced' })
    .in('id', invalidEnrollmentIds)
  console.log(`Marked ${invalidEnrollmentIds.length} enrollments as bounced (invalid email)`)
}

if (enrollments.length === 0) continue
```

**3d. Drip sequence path — add email_status check (around line 288-292):**

The drip path fetches lead data at line 289-291:
```typescript
const { data: lead } = await supabaseAdmin.from('leads')
  .select('first_name, company').eq('id', enrollment.lead_id).single()
```

Change to include `email_status` and skip if invalid:
```typescript
const { data: lead } = await supabaseAdmin.from('leads')
  .select('first_name, company, email_status').eq('id', enrollment.lead_id).single()
if (lead?.email_status === 'invalid') {
  await supabaseAdmin.from('campaign_enrollments')
    .update({ status: 'bounced' }).eq('id', enrollment.id)
  console.log(`Drip skip: enrollment ${enrollment.id} lead ${enrollment.lead_id} has invalid email`)
  continue
}
```

### Task 4: Deploy process-campaigns

```bash
supabase functions deploy process-campaigns --no-verify-jwt
```

## Validation Loop

```bash
npm run lint
```

Manual verification:
1. Check LeadsPage — invalid email leads should show greyed-out, strikethrough email
2. Check LeadDetailPage for an invalid lead — email button should be disabled
3. Campaign scheduler should skip invalid leads (check edge function logs)

## Deprecated Code

None.

## Confidence Score: 9/10

Three simple, independent changes with clear before/after. No new abstractions, no data model changes.
