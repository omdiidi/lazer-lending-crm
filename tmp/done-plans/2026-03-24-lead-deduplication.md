# Plan: Lead Deduplication in Lead Generator

**Confidence: 9/10** — Two dedup checks added to the existing Edge Function + UI badges. Focused scope.

## Goal

Prevent duplicate leads from being enriched (saves Apollo credits) or imported (prevents duplicate CRM records). Mark existing leads in search results as "Already in CRM".

## Files Being Changed

```
supabase/
├── functions/
│   └── lead-gen-chat/
│       └── index.ts                    ← MODIFIED (pre-enrichment + post-enrichment dedup)
src/
├── pages/
│   └── LeadGeneratorPage.tsx           ← MODIFIED (duplicate badge + skip on import)
docs/
├── lead-generator.md                   ← MODIFIED
├── OVERVIEW.md                         ← MODIFIED
```

---

## Architecture Overview

```
Apollo Search returns 25 person stubs (IDs only, 0 credits)
  │
  ▼ DEDUP LAYER 1: Check apollo_id against leads table
  Filter out 5 people already in CRM → 20 remain
  │
  ▼ Enrich only the 20 new ones (saves 5 credits + 40 phone credits)
  │
  ▼ DEDUP LAYER 2: Check emails against leads table
  Mark 2 more as "Already in CRM" (manually-created leads without apollo_id)
  │
  ▼ Return to frontend:
  18 new leads (importable)
  + 7 flagged as duplicates (shown with badge, import disabled)
```

---

## Key Pseudocode

### lead-gen-chat Edge Function — Pre-enrichment dedup

```typescript
// AFTER Apollo People Search returns person IDs, BEFORE enrichment:

// Get all apollo_ids already in our leads table
const supabaseAdmin = createClient(...)
const apolloPersonIds = people.map((p: { id: string }) => p.id)

const { data: existingByApolloId } = await supabaseAdmin
  .from('leads')
  .select('apollo_id')
  .in('apollo_id', apolloPersonIds)
  .not('apollo_id', 'is', null)

const existingApolloIds = new Set((existingByApolloId || []).map(r => r.apollo_id))

// Split: new people to enrich vs already-existing (skip enrichment)
const newPeople = people.filter((p: { id: string }) => !existingApolloIds.has(p.id))
const duplicatePeople = people.filter((p: { id: string }) => existingApolloIds.has(p.id))

console.log(`Dedup: ${duplicatePeople.length} of ${people.length} already in CRM, skipping enrichment`)

// Only enrich newPeople (saves credits)
```

### lead-gen-chat Edge Function — Post-enrichment dedup by email

```typescript
// AFTER enrichment + scoring, BEFORE returning results:

// Check emails of enriched leads against existing leads
const enrichedEmails = leads.map(l => l.email).filter(Boolean)
const { data: existingByEmail } = await supabaseAdmin
  .from('leads')
  .select('email')
  .in('email', enrichedEmails)

const existingEmails = new Set((existingByEmail || []).map(r => r.email))

// Mark duplicates on each lead
const leadsWithDedupFlag = leads.map(l => ({
  ...l,
  isDuplicate: existingEmails.has(l.email),
}))
```

### Return format — include duplicate info

```typescript
return {
  response: `Found ${newCount} new contacts and ${dupCount} already in your CRM (${creditsUsed} credits used).`,
  leads: leadsWithDedupFlag, // includes isDuplicate flag
  ...
}
```

### LeadGeneratorPage — Show duplicate badge + skip on import

```tsx
// In the results table, add a badge for duplicates:
{l.isDuplicate && (
  <Badge variant="secondary" className="text-[10px] bg-slate-100 text-slate-600">
    Already in CRM
  </Badge>
)}

// In handleImport, filter out duplicates:
const handleImport = (leads: Lead[], msgIndex: number) => {
  const newLeads = leads.filter(l => !l.isDuplicate);
  if (newLeads.length === 0) {
    toast.error('All leads are already in your CRM');
    return;
  }
  const cleanedLeads = newLeads.map(({ id, createdAt, isDuplicate, ...rest }) => ({
    ...rest,
    assignedTo: user!.id,
  }));
  addLeads(cleanedLeads);
  // ...
};

// Update import button text:
// "Import X new leads" (not including duplicates)
const newCount = msg.leads.filter(l => !l.isDuplicate).length;
<Button disabled={importedSets.has(i) || newCount === 0}>
  {importedSets.has(i) ? 'Imported to CRM' : `Import ${newCount} new leads`}
</Button>
```

---

## Task Execution Order

### Task 1: Update lead-gen-chat Edge Function

In `runApolloSearch()`:
- Accept `supabaseAdmin` as a parameter
- After Apollo People Search returns IDs, query `leads.apollo_id` to find existing ones
- Filter out existing from enrichment batch (save credits)
- After enrichment + scoring, query `leads.email` for remaining leads
- Add `isDuplicate: boolean` to each returned lead

### Task 2: Update LeadGeneratorPage

- Handle `isDuplicate` flag on leads from the API response
- Show "Already in CRM" badge in results table
- Filter duplicates from import
- Update import button text to show new leads count only
- Add `isDuplicate` to the Lead-like type used in ChatMessage

### Task 3: Deploy + test + docs

---

## Validation Gates

1. `npm run build` passes
2. Search for leads already in CRM → marked as "Already in CRM"
3. Import button shows correct count (excluding duplicates)
4. Duplicate leads are NOT enriched (credits saved)
5. Import skips duplicates — only new leads inserted
6. Leads without apollo_id caught by email check (Layer 2)

---

## Known Gotchas

```
1. The apollo_id check runs BEFORE enrichment — this is the credit-saving check.
   The email check runs AFTER enrichment — catches leads without apollo_id.

2. isDuplicate is a transient flag on the API response, not stored in the DB.
   It's computed fresh on each search.

3. The leads.apollo_id column already has an index (from the phone reveal plan).
   The email check uses leads.email which should be indexed for performance.
   Consider adding an index if not present.

4. The Supabase .in() query has a max of ~1000 items. For searches returning
   more than 100 leads (our max is 100), this is fine.

5. Duplicate leads from pre-enrichment dedup are NOT shown in results
   (they were never enriched, so we don't have their full data).
   Only post-enrichment duplicates get the "Already in CRM" badge.

   Actually — we should show ALL duplicates including pre-enrichment ones.
   For pre-enrichment dupes, we have basic info from the search stub
   (name, title, company from Apollo Search — not email/phone). Show them
   with the badge but minimal info.
```

---

## Deprecated Code

None — modifies existing functions only.
