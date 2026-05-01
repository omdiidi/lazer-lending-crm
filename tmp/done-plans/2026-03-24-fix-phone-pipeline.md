# Plan: Fix Phone Number Delivery Pipeline

## Goal

Fix the broken phone number pipeline so phone data actually reaches users. Currently phones NEVER appear in Lead Generator results because Apollo delivers them asynchronously via webhook, but the webhook can't find leads that haven't been imported yet. Create a buffer table to capture webhook data, and merge it at every opportunity.

## Why

- Phone numbers have never worked in Lead Generator search results — 0% delivery rate
- Apollo credits are being spent on phone reveals (`reveal_phone_number: true`) with zero return
- The webhook receives phone data but discards it because leads aren't in the DB yet
- Users who need phone numbers for cold calling see "—" on every single lead

## What

- Create a `phone_reveals` buffer table to capture async webhook phone data
- Webhook writes to buffer (upsert), then also tries updating leads table
- After enrichment, check buffer for phones from prior searches
- On lead import, merge phone data from buffer into new lead records
- Search results show phones when available, "Pending" when enrichment was triggered but phones haven't arrived yet

### Success Criteria

- [ ] `phone_reveals` table created with migration
- [ ] Webhook writes to buffer on every delivery
- [ ] Search results show phones for previously-enriched contacts
- [ ] Imported leads get phone data merged from buffer
- [ ] UI distinguishes between "no phone" (—) and "phone pending" (Pending)
- [ ] No type errors: `npm run typecheck`

## Files Being Changed

```
supabase/functions/apollo-phone-webhook/index.ts  ← MODIFIED (write to buffer + leads)
supabase/functions/lead-gen-chat/index.ts          ← MODIFIED (check buffer after enrichment)
src/pages/LeadGeneratorPage.tsx                    ← MODIFIED (show Pending vs —, fromHistory flag)
src/hooks/use-leads.ts                             ← MODIFIED (merge buffer on import)
src/lib/api/leads.ts                               ← MODIFIED (add mergePhoneReveals function)
src/types/database.ts                              ← MODIFIED (add phone_reveals table type)
```

## Architecture Overview

```
Apollo bulk_match (sync response) ──► enrichment data (emails, names, NO phones)
         │
         └──► Apollo webhook (async, minutes later)
                  │
                  ▼
         phone_reveals table (NEW buffer)
                  │
                  ├──► Merged into search results (if available from prior search)
                  ├──► Merged on lead import
                  └──► Also updates leads table directly (for already-imported leads)
```

The buffer table is the key new component. It captures ALL phone webhook deliveries and makes them available at multiple merge points.

## All Needed Context

### Apollo API Behavior (Confirmed by Research)

1. `bulk_match` with `reveal_phone_number: true` + `webhook_url`: sync response has NO `phone_numbers` field. Phones delivered async to webhook.
2. `bulk_match` sync response MAY contain `phone_numbers` for contacts that were previously enriched by anyone on Apollo — this is cached data, not from the current enrichment.
3. `webhook_url` is MANDATORY when `reveal_phone_number: true`. Removing it would error.
4. Webhook payload structure: `{ people: [{ id, phone_numbers: [{ sanitized_number, raw_number, status_cd, confidence_cd }] }] }`
5. Webhook delivery takes "several minutes" — no SLA.

### Current Code (What's Broken)

**`lead-gen-chat/index.ts` line 226**: Reads `phone_numbers` from enrichment response. Works for previously-enriched contacts (cached), fails for fresh enrichments (empty).

**`apollo-phone-webhook/index.ts` line 36-38**: Updates `leads` table by `apollo_id`. Fails when leads haven't been imported yet (0 rows matched). Phone data is discarded.

**`LeadGeneratorPage.tsx` line 229**: Shows "—" for empty phone. No distinction between "no phone exists" and "phone is being fetched".

### Documentation

```yaml
- url: https://docs.apollo.io/reference/bulk-people-enrichment
  why: Confirms phone_numbers NOT in sync response, webhook required

- url: https://docs.apollo.io/docs/retrieve-mobile-phone-numbers-for-contacts
  why: Webhook payload structure for phone data
```

### Known Gotchas

1. **The enrichment response CAN have phone_numbers for previously-enriched contacts** — the existing code at line 226 isn't totally dead. It works for contacts Apollo already has phone data for (from prior enrichments by any Apollo user). Don't remove this code.

2. **Webhook may fire before or after the edge function returns** — usually after (minutes), but design for both cases.

3. **The buffer must use UPSERT** — the same apollo_id could get webhook deliveries from multiple enrichment calls (e.g., user searches twice for same person).

4. **RLS on phone_reveals** — this table is only written by the webhook (service role) and read by edge functions (service role). No RLS needed, but disable it explicitly.

## Key Pseudocode

### Migration: phone_reveals table

```sql
CREATE TABLE IF NOT EXISTS phone_reveals (
  apollo_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,  -- webhook guard ensures non-empty before upsert
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS enabled with authenticated-only read access
ALTER TABLE phone_reveals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read" ON phone_reveals FOR SELECT TO authenticated USING (true);
-- Webhook writes via service role (bypasses RLS), no INSERT/UPDATE policy needed for anon
```

### Webhook: Write to buffer + leads

```typescript
// For each person in webhook payload:
// 1. Upsert into phone_reveals buffer
await supabaseAdmin.from('phone_reveals').upsert({
  apollo_id: apolloId,
  phone: phone,
  raw_data: { phone_numbers: phoneNumbers },
  updated_at: new Date().toISOString(),
}, { onConflict: 'apollo_id' })

// 2. Also try updating leads table (works if already imported)
await supabaseAdmin.from('leads')
  .update({ phone })
  .eq('apollo_id', apolloId)
```

### Edge Function: Check buffer after enrichment

```typescript
// After enrichment returns (line ~214 in lead-gen-chat/index.ts),
// before transforming leads, check phone_reveals for any cached phones

if (supabaseAdmin) {
  const enrichedApolloIds = enriched
    .map((p: Record<string, unknown>) => p.id as string)
    .filter(Boolean)

  if (enrichedApolloIds.length > 0) {
    const { data: reveals } = await supabaseAdmin
      .from('phone_reveals')
      .select('apollo_id, phone')
      .in('apollo_id', enrichedApolloIds)

    if (reveals && reveals.length > 0) {
      const phoneMap = new Map(reveals.map(r => [r.apollo_id, r.phone]))
      for (const person of enriched) {
        const p = person as Record<string, unknown>
        const bufferedPhone = phoneMap.get(p.id as string)
        if (bufferedPhone && !((p.phone_numbers as Array<{sanitized_number?: string}> | undefined)?.[0]?.sanitized_number)) {
          // Inject buffered phone into the enrichment object so existing transform picks it up
          p.phone_numbers = [{ sanitized_number: bufferedPhone }]
        }
      }
    }
  }
}
```

### Lead Import: Merge buffer data

```typescript
// In the addLeads path (use-leads.ts or leads.ts API),
// before inserting leads, check phone_reveals for any matching apollo_ids

export async function mergePhoneReveals(leads: Array<{ apolloId?: string | null; phone?: string }>): Promise<void> {
  const apolloIds = leads.map(l => l.apolloId).filter(Boolean) as string[]
  if (apolloIds.length === 0) return

  const { data: reveals } = await supabase
    .from('phone_reveals')
    .select('apollo_id, phone')
    .in('apollo_id', apolloIds)

  if (!reveals || reveals.length === 0) return

  const phoneMap = new Map(reveals.map(r => [r.apollo_id, r.phone]))
  for (const lead of leads) {
    if (lead.apolloId && !lead.phone && phoneMap.has(lead.apolloId)) {
      lead.phone = phoneMap.get(lead.apolloId)!
    }
  }
}
```

### UI: Pending vs empty, with fromHistory flag

Add `fromHistory?: boolean` to the `ChatMessage` interface. Set it to `true` on messages restored from `loadSearchHistory` in the useEffect. Fresh bot messages from `handleSend` leave it undefined/false.

```tsx
// ChatMessage interface update:
interface ChatMessage {
  role: 'user' | 'bot';
  content: string;
  leads?: SearchLead[];
  actions?: { label: string; prompt: string }[];
  fromHistory?: boolean;  // NEW
}

// In the history restoration useEffect, set fromHistory on bot messages:
restoredMessages.push({
  role: 'bot',
  content: botContent,
  leads: ...,
  actions: ...,
  fromHistory: true,  // NEW
});

// Phone cell logic — pass msg.fromHistory to determine display:
<TableCell className="text-xs">
  {l.phone ? (
    <span className="flex items-center gap-1"><Phone className="h-3 w-3 text-muted-foreground" />{l.phone}</span>
  ) : msg.fromHistory ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className="text-[10px] text-muted-foreground italic">Pending</span>
  )}
</TableCell>
```

"Pending" = fresh search, phones may be in transit from webhook.
"—" = historical result, phones that were going to arrive already have.

## Tasks (in implementation order)

### Task 1: Create phone_reveals migration + types

Apply via Supabase MCP:
```sql
CREATE TABLE IF NOT EXISTS phone_reveals (
  apollo_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE phone_reveals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read" ON phone_reveals FOR SELECT TO authenticated USING (true);
```

Also **MODIFY `src/types/database.ts`** — add `phone_reveals` table type to the Tables section:
```typescript
phone_reveals: {
  Row: { apollo_id: string; phone: string; raw_data: Record<string, unknown> | null; created_at: string; updated_at: string }
  Insert: { apollo_id: string; phone: string; raw_data?: Record<string, unknown> | null; created_at?: string; updated_at?: string }
  Update: { apollo_id?: string; phone?: string; raw_data?: Record<string, unknown> | null; updated_at?: string }
}
```

### Task 2: Update apollo-phone-webhook

**MODIFY `supabase/functions/apollo-phone-webhook/index.ts`**:

For each person in the webhook payload:
1. First, upsert into `phone_reveals` buffer table (apollo_id, phone, raw_data). Log error if upsert fails but continue processing remaining people.
2. Then, try updating `leads` table as before (unchanged logic)

The buffer write must happen BEFORE the leads update. If the leads update fails (no matching row), the phone data is still saved in the buffer. Always check the upsert result for errors and log them — don't let a buffer failure silently lose phone data.

### Task 3: Update lead-gen-chat edge function

**MODIFY `supabase/functions/lead-gen-chat/index.ts`**:

**CRITICAL: Insert BEFORE the "Filter invalid + transform" block (before line 206, not after line 214).**

The `_drop` logic at line 206-212 drops contacts with no email AND no phone. If a contact has no email but HAS a buffered phone from a prior search, we need the phone injected BEFORE the `_drop` check so the contact isn't dropped.

After enrichment completes and BEFORE the `_drop`/filter block:
1. Collect all apollo_ids from enriched contacts
2. Query `phone_reveals` for matching apollo_ids (these are phones from PRIOR searches whose webhooks already delivered — NOT from the current search)
3. For each match where the enrichment response doesn't already have phone_numbers, inject the buffered phone as `phone_numbers: [{ sanitized_number: phone }]`

This way the existing `_drop` logic and transform code at line 226 (`phoneNumbers?.[0]?.sanitized_number || ''`) picks up the buffered phone automatically.

### Task 4: Update LeadGeneratorPage UI

**MODIFY `src/pages/LeadGeneratorPage.tsx`**:

4a. Add `fromHistory?: boolean` to the `ChatMessage` interface.

4b. Set `fromHistory: true` on bot messages in the history restoration useEffect (the `for (const entry of history)` loop).

4c. Update the phone cell in the leads table to use `msg.fromHistory` to distinguish:
- Has phone → show phone with icon
- No phone + fromHistory → show "—"
- No phone + fresh search → show "Pending" (italic)

Note: the table cell renders inside `{messages.map((msg, i) => ...}` so `msg` is available as the parent message.

### Task 5: Add phone merge on import

**MODIFY `src/lib/api/leads.ts`**:

Add a `mergePhoneReveals` function that:
1. Takes an array of leads (with apolloId fields)
2. Queries `phone_reveals` for matching apollo_ids
3. Merges phone data into leads that don't have phones

**MODIFY `src/hooks/use-leads.ts`**:

Call `mergePhoneReveals` inside the `mutationFn` of `addLeadsMutation`, BEFORE calling `api.createLeads(newLeads)`. This ensures phone data is merged before the database insert.

### Task 6: Deploy edge functions

```bash
supabase functions deploy apollo-phone-webhook --no-verify-jwt
supabase functions deploy lead-gen-chat --no-verify-jwt
```

## Validation Loop

```bash
npm run typecheck
npm run lint
```

Test flow:
1. Search for leads → results show "Pending" for phones
2. Wait a few minutes → check `phone_reveals` table for data
3. Import leads → leads should have phone data merged from buffer
4. Check Leads page → imported leads should show phone numbers

## Deprecated Code

None — all existing code remains, we're adding the buffer layer on top.

## Anti-Patterns to Avoid

- Don't remove `reveal_phone_number: true` from bulk_match — it's needed to trigger phone enrichment
- Don't remove `webhook_url` — it's mandatory when reveal_phone_number is true
- Don't remove the existing phone_numbers reading from enrichment response (line 226) — it works for previously-enriched contacts
- Don't add polling or delays waiting for webhook data — design for async

## Confidence Score: 8/10

Clear architecture with well-defined integration points. The buffer table pattern is simple and robust. Minor risk around the Supabase MCP migration step and the import-time merge depending on how `addLeads` is structured.
