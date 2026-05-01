# Plan: Require Phone Number Filter in Lead Generator

## Goal

Add a "Require phone" toggle to the Lead Generator that filters Apollo search results to only enrich contacts with confirmed phone numbers (`has_direct_phone === "Yes"`), saving credits by skipping contacts without phones before the paid enrichment step.

## Why

- Phone reveals cost ~8 mobile credits each — enriching contacts without phones wastes credits
- Apollo People Search is free and returns `has_direct_phone` on each result
- Filtering between the free search and paid enrichment saves credits with zero downside
- Users who need phone numbers for cold calling shouldn't pay for leads that lack them

## What

- Toggle in the input bar (next to quantity selector): "Require phone" with a Switch component
- When enabled, only contacts where Apollo reports `has_direct_phone === "Yes"` are sent to bulk enrichment
- The LLM confirmation message mentions "with verified phone numbers" when the filter is active
- If filtering reduces results below the requested count, over-fetch from Apollo search to compensate

### Success Criteria

- [ ] Toggle visible in LeadGeneratorPage input bar, defaults to off
- [ ] `requirePhone` boolean passed through client API to edge function
- [ ] Edge function filters search results by `has_direct_phone` before enrichment
- [ ] Over-fetches from Apollo search when filter is on to fill requested count
- [ ] LLM confirmation message reflects phone requirement
- [ ] No type errors: `npm run typecheck`
- [ ] No lint errors: `npm run lint`

## Files Being Changed

```
src/pages/LeadGeneratorPage.tsx          ← MODIFIED (add toggle UI + state + pass to API)
src/lib/api/lead-gen-chat.ts             ← MODIFIED (add requirePhone param)
supabase/functions/lead-gen-chat/index.ts ← MODIFIED (filter by has_direct_phone, over-fetch, update prompt)
```

## Architecture Overview

The change touches three layers in a straight pipeline:

```
UI Toggle (LeadGeneratorPage)
  → Client API (lead-gen-chat.ts) adds requirePhone to request body
    → Edge Function (lead-gen-chat/index.ts):
        1. LLM reads requirePhone, mentions it in confirmation
        2. Free Apollo search returns people with has_direct_phone field
        3. NEW: Filter to has_direct_phone === "Yes" when requirePhone is true
        4. Existing dedup by apollo_id (unchanged)
        5. Bulk enrichment on filtered set (credits saved)
```

No new files. No database changes. No new dependencies.

## All Needed Context

### Documentation & References

```yaml
- file: supabase/functions/lead-gen-chat/index.ts
  why: Contains the full Apollo pipeline — search body builder (line 70), dedup (line 97), enrichment (line 120), system prompt (line 258)

- file: src/pages/LeadGeneratorPage.tsx
  why: Input bar JSX at lines 299-322, state declarations at lines 33-37, handleSend at line 84

- file: src/lib/api/lead-gen-chat.ts
  why: sendLeadGenMessage function signature and body payload

- file: src/components/ui/switch.tsx
  why: shadcn Switch component — already exists, import from @/components/ui/switch
```

### Known Gotchas

1. **Apollo `has_direct_phone` field format**: The "Maybe" value is actually the full string `"Maybe: please request direct dial via people/bulk_match"` — do NOT check for exact string `"Maybe"`. Only check for `"Yes"` exactly.

2. **Over-fetching pagination**: Apollo search `per_page` max is 100. When `requirePhone` is on, request more results from the free search (e.g., 3x the requested count) since many results won't have phones. Use pagination (`page` param) if first page doesn't yield enough.

3. **The `people` array from Apollo search**: Each person object has an `id` field and potentially a `has_direct_phone` field. The field may be absent on some records — treat absent as "No".

4. **Edge function request body parsing**: Currently at line 256: `const { message, chatHistory, perPage } = await req.json()` — add `requirePhone` to destructuring. Then normalize: `const phoneFilter = requirePhone === true` since JSON omits `undefined` fields, making the destructured value `undefined` not `false`.

5. **Over-fetch is the primary mechanism, pagination is the fallback**: The initial 3x over-fetch on page 1 handles most cases. The pagination loop only kicks in when the over-fetched page still doesn't have enough phone-qualified results (e.g., very low phone density in the target population). Both use `searchBody` which contains the over-fetched `per_page` — this is intentional.

6. **Dedup runs after phone filter — final count may be lower than requested**: Phone filter → dedup by apollo_id → enrichment. If dedup removes entries after the phone filter already trimmed, the final count could be below `perPage`. This is acceptable and matches current dedup behavior. Do NOT try to compensate for this.

7. **Toggle state is read at call time, not closure time**: `handleAction` calls `handleSend(prompt)`, which reads `requirePhone` from current component state. If the user toggles between the confirmation message and clicking "Yes, search", the current toggle value is used. This is correct — the user's latest intent wins.

## Key Pseudocode

### Edge Function: Phone filter in `runApolloSearch`

```typescript
// Current signature:
async function runApolloSearch(filters, perPage, apolloApiKey, zeroBounceApiKey, supabaseAdmin?)

// NEW signature — add requirePhone:
async function runApolloSearch(filters, perPage, apolloApiKey, zeroBounceApiKey, supabaseAdmin?, requirePhone = false)

// After Apollo search returns people (line 92):
const people = searchData.people || []

// NEW: Filter by has_direct_phone when requirePhone is true
let filteredPeople = people
if (requirePhone) {
  filteredPeople = people.filter(p => p.has_direct_phone === 'Yes')
  console.log(`Phone filter: ${filteredPeople.length} of ${people.length} have confirmed phones`)
}

// FALLBACK: If initial over-fetched page didn't yield enough, paginate.
// Uses per_page: 50 on extra pages to limit latency. Max 3 extra pages.
if (requirePhone && filteredPeople.length < perPage) {
  let page = 2
  const maxPages = 4 // page 2, 3, 4 = 3 extra pages max
  while (filteredPeople.length < perPage && page <= maxPages) {
    const moreSearchBody = { ...searchBody, per_page: 50, page }
    const moreRes = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', { ... })
    if (!moreRes.ok) break
    const moreData = await moreRes.json()
    const morePeople = moreData.people || []
    if (morePeople.length === 0) break
    const moreWithPhone = morePeople.filter(p => p.has_direct_phone === 'Yes')
    filteredPeople.push(...moreWithPhone)
    page++
  }
  // Trim to requested count
  filteredPeople = filteredPeople.slice(0, perPage)
}

// Then continue with existing dedup on filteredPeople instead of people
```

### Edge Function: Over-fetch on initial search

```typescript
// When requirePhone is true, request more results from the free search
// to account for filtering. Request 3x the perPage.
const searchPerPage = requirePhone ? Math.min(perPage * 3, 100) : Math.min(perPage, 100)
const searchBody = { per_page: searchPerPage, page: 1 }
```

### Edge Function: System prompt update

Add to the system prompt after the existing FILTER RULES section:

```
PHONE FILTER:
The user has ${requirePhone ? 'ENABLED' : 'DISABLED'} the "Require phone" filter.
${requirePhone ? 'When confirming a search, mention that results will only include contacts with verified phone numbers on file. Adjust your credit estimate — not all search results will have phones, so actual enrichment count may be lower than requested.' : ''}
```

### UI: Toggle in input bar

```tsx
// New state
const [requirePhone, setRequirePhone] = useState(false);

// In the form, between Input and Select:
<div className="flex items-center gap-1.5">
  <Switch
    id="require-phone"
    checked={requirePhone}
    onCheckedChange={setRequirePhone}
  />
  <label htmlFor="require-phone" className="text-xs text-muted-foreground whitespace-nowrap cursor-pointer">
    <Phone className="h-3 w-3 inline mr-0.5" />Phone
  </label>
</div>
```

## Tasks (in implementation order)

### Task 1: Update client API function signature

**MODIFY `src/lib/api/lead-gen-chat.ts`**:
- Add `requirePhone?: boolean` as 4th parameter to `sendLeadGenMessage()`
- Include it in the `body` object passed to `supabase.functions.invoke`

```typescript
export async function sendLeadGenMessage(
  message: string,
  chatHistory: { role: 'user' | 'assistant'; content: string }[],
  perPage?: number,
  requirePhone?: boolean,
): Promise<LeadGenChatResponse> {
  const { data, error } = await supabase.functions.invoke('lead-gen-chat', {
    body: { message, chatHistory, perPage, requirePhone },
  });
  // ... rest unchanged
}
```

### Task 2: Update edge function to accept and use `requirePhone`

**MODIFY `supabase/functions/lead-gen-chat/index.ts`**:

**2a. Parse and normalize `requirePhone` from request body (line 256)**:
```typescript
const { message, chatHistory, perPage, requirePhone } = await req.json()
const phoneFilter = requirePhone === true  // normalize undefined → false
```
Use `phoneFilter` (not raw `requirePhone`) everywhere downstream.

**2b. Update `runApolloSearch` function signature (line 62)**:
Add `requirePhone = false` parameter.

**2c. Over-fetch when `requirePhone` is true (line 70)**:
Change the initial `per_page` calculation:
```typescript
const searchPerPage = requirePhone ? Math.min((perPage || 25) * 3, 100) : Math.min(perPage, 100)
const searchBody: Record<string, unknown> = { per_page: searchPerPage, page: 1 }
```

**2d. Filter search results by `has_direct_phone` (after line 95, before dedup)**:
Insert phone filtering after getting `people` from search but before the apollo_id dedup.
- When `requirePhone` is true, filter to `has_direct_phone === 'Yes'`
- If filtered count < perPage, fetch additional pages (up to 3 extra, with per_page: 50) from Apollo search, filtering each page
- Trim final list to perPage
- Log the filtering stats

**2e. Pass `requirePhone` when calling `runApolloSearch` (find the call site)**:
Pass the parsed `requirePhone` value.

**2f. Update system prompt (line 258-302)**:
Add after FILTER RULES section:
```
PHONE FILTER:
The user has ${requirePhone ? 'ENABLED' : 'DISABLED'} the "Require phone" filter.
${requirePhone ? 'When confirming a search, mention that results will only include contacts with verified phone numbers. Note this in your credit estimate.' : ''}
```

### Task 3: Update LeadGeneratorPage UI

**MODIFY `src/pages/LeadGeneratorPage.tsx`**:

**3a. Add imports**:
- Import `Switch` from `@/components/ui/switch`
- `Phone` icon is already imported (line 13)

**3b. Add state (near line 36)**:
```typescript
const [requirePhone, setRequirePhone] = useState(false);
```

**3c. Update `handleSend` to pass `requirePhone` (line 102)**:
```typescript
const result = await sendLeadGenMessage(text, chatHistory, selectedCount, requirePhone);
```

**3d. Add toggle to input form (between Input and Select, ~line 307)**:
Add a `<div>` containing the Switch and a label with the Phone icon. Keep it compact to fit the input bar layout.

### Task 4: Deploy edge function

After code changes, deploy:
```bash
supabase functions deploy lead-gen-chat --no-verify-jwt
```

## Validation Loop

```bash
npm run typecheck    # No type errors
npm run lint         # No lint errors
```

Then manually test:
1. Toggle off → search works as before (no phone filtering)
2. Toggle on → search only returns contacts with phones
3. Check edge function logs for phone filter stats

## Deprecated Code

None — this is purely additive.

## Anti-Patterns to Avoid

- Don't add the phone filter as a search body parameter to Apollo API — `has_direct_phone` is a response field, not a request filter
- Don't filter on the client side — must filter server-side before enrichment to save credits
- Don't check for `"Maybe"` string — only `"Yes"` exactly
- Don't request more than 100 per_page from Apollo (API limit)
- Don't forget the pagination loop safety limit (max 3 extra pages) to prevent infinite fetching
- Don't use raw `requirePhone` from request body — always normalize with `=== true` first

## Confidence Score: 9/10

Straightforward feature with clear data flow. The only minor risk is the Apollo `has_direct_phone` field behavior in practice — but the filtering logic is simple and the fallback (fewer results than requested) is acceptable.
