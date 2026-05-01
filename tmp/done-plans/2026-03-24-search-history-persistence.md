# Plan: Lead Generator Search History Persistence

**Confidence: 9/10** — New DB table, save on search, load on mount. Simple and focused.

## Goal

Save Apollo search results to the database immediately when they're returned (before user imports). If the user navigates away and comes back, their search history and un-imported results are still there.

## Files Being Changed

```
src/
├── pages/
│   └── LeadGeneratorPage.tsx           ← MODIFIED (save results to DB, load on mount)
├── lib/
│   └── api/
│       └── search-history.ts           ← NEW (CRUD for search history)
├── types/
│   ├── crm.ts                         ← MODIFIED (add SearchHistory type)
│   └── database.ts                    ← MODIFIED (add lead_search_history table)
docs/
├── lead-generator.md                   ← MODIFIED
├── schema.md                           ← MODIFIED
├── OVERVIEW.md                         ← MODIFIED
```

---

## Architecture Overview

```
User searches in Lead Generator:
  → apollo-search Edge Function returns leads
  → IMMEDIATELY save results to lead_search_history table
  → Display in chat (existing behavior)
  → User navigates away → state is destroyed

User returns to Lead Generator:
  → On mount: load search history from DB
  → Rebuild chat messages from history
  → Un-imported results show "Import" button (still active)
  → Previously imported results show "Imported to CRM" (disabled)
```

---

## DB Migration

```sql
CREATE TABLE IF NOT EXISTS lead_search_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  leads jsonb NOT NULL DEFAULT '[]',
  filters jsonb,
  total_found integer NOT NULL DEFAULT 0,
  credits_used integer NOT NULL DEFAULT 0,
  imported boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lead_search_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own search history" ON lead_search_history;
CREATE POLICY "Users can manage own search history" ON lead_search_history
  FOR ALL USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS lead_search_history_user_id_idx ON lead_search_history(user_id);
```

---

## Key Pseudocode

### Save search result immediately after Apollo returns

```typescript
// In LeadGeneratorPage, after searchApollo returns:
const result = await searchApollo(prompt, selectedCount);

// Save to DB immediately
await saveSearchHistory({
  userId: user.id,
  prompt,
  leads: result.leads,
  filters: result.filtersUsed,
  totalFound: result.totalFound,
  creditsUsed: result.creditsUsed,
});

// Then display in chat as before
```

### Load history on mount

```typescript
// On component mount, load recent search history
useEffect(() => {
  loadSearchHistory(user.id).then(history => {
    // Rebuild chat messages from history
    const restoredMessages: ChatMessage[] = [
      { role: 'bot', content: 'Welcome...' }, // initial bot message
    ];
    for (const entry of history) {
      restoredMessages.push({ role: 'user', content: entry.prompt });
      restoredMessages.push({
        role: 'bot',
        content: entry.leads.length > 0
          ? `Found ${entry.totalFound} matches. Showing ${entry.leads.length} enriched contacts.`
          : 'No matching contacts found.',
        leads: entry.leads.length > 0 ? entry.leads : undefined,
      });
    }
    setMessages(restoredMessages);

    // Mark which ones were already imported
    const importedIndices = new Set<number>();
    history.forEach((entry, i) => {
      if (entry.imported) importedIndices.add(i * 2 + 2); // bot message index for this entry
    });
    setImportedSets(importedIndices);
  });
}, [user]);
```

### Mark as imported when user clicks Import

```typescript
// In handleImport, after addLeads:
await markSearchImported(historyEntryId);
```

### API Functions

```typescript
// search-history.ts
export async function saveSearchHistory(entry: {
  userId: string;
  prompt: string;
  leads: Lead[];
  filters: Record<string, unknown>;
  totalFound: number;
  creditsUsed: number;
}): Promise<string> {
  const { data, error } = await supabase.from('lead_search_history').insert({
    user_id: entry.userId,
    prompt: entry.prompt,
    leads: entry.leads,
    filters: entry.filters,
    total_found: entry.totalFound,
    credits_used: entry.creditsUsed,
  }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function loadSearchHistory(userId: string) {
  const { data, error } = await supabase.from('lead_search_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(20); // Last 20 searches
  if (error) throw error;
  return data;
}

export async function markSearchImported(id: string) {
  const { error } = await supabase.from('lead_search_history')
    .update({ imported: true })
    .eq('id', id);
  if (error) throw error;
}
```

---

## Task Execution Order

### Task 1: DB Migration
Create `lead_search_history` table with RLS.

### Task 2: Update types
Add `SearchHistory` type to crm.ts. Add table to database.ts.

### Task 3: Create search-history API
`src/lib/api/search-history.ts` — save, load, markImported.

### Task 4: Update LeadGeneratorPage
- On search complete: save results to DB
- On mount: load history and rebuild chat
- On import: mark entry as imported
- Track history entry IDs alongside chat messages

### Task 5: Deploy + test + docs

---

## Validation Gates

1. `npm run build` passes
2. Search for leads → results saved to DB immediately
3. Navigate away from Lead Generator → come back → search history restored
4. Un-imported results show "Import" button
5. Previously imported results show "Imported to CRM" (disabled)
6. Multiple searches stack in history

---

## Known Gotchas

```
1. Leads are stored as JSONB in the history table — not normalized.
   This is intentional: search results are ephemeral snapshots, not
   the canonical lead data. The actual leads are created in the leads
   table only when the user clicks Import.

2. History is limited to last 20 searches per user to prevent bloat.

3. The imported flag is per-search-entry, not per-lead. If a user
   imports some leads from a search and not others, the whole entry
   is marked as imported. This matches the current UI behavior where
   Import imports the entire batch.

4. RLS scopes history to the current user — employees only see their
   own searches, admins only see their own (not other users').

5. On mount, the chat rebuilds from history. The welcome message is
   always the first message. Then each search adds a user + bot message pair.
```

---

## Deprecated Code (to remove)

None — enhances existing functionality.
