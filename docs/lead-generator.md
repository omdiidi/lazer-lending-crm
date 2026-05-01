# Lead Generator

> Chat-based AI interface for discovering and importing leads into the CRM.

**Status:** Active
**Last Updated:** 2026-03-24
**Related Docs:** [OVERVIEW.md](./OVERVIEW.md) | [leads.md](./leads.md) | [state-management.md](./state-management.md)

---

## Overview

The Lead Generator (`/generator`) provides a conversational chat interface where users describe their ideal customer profile. A GPT-4.1-mini conversation layer (via the `lead-gen-chat` Edge Function) manages the dialog: it confirms the intended search with the user before running it, handles zero-result responses with refinement suggestions, and renders clickable action buttons directly in bot messages. Once confirmed, the full Apollo search pipeline (previously in `apollo-search`) runs inline within `lead-gen-chat` — parsing the prompt, searching Apollo.io's People Search API, bulk-enriching results, and scoring leads by contact quality. Users can import discovered leads into the CRM. The previous `AlertDialog` confirmation modal has been replaced by in-chat confirmation.

---

## File Map

| File | Purpose |
|------|---------|
| `src/pages/LeadGeneratorPage.tsx` | Entire feature — conversational chat UI, import logic, search history restore, action buttons |
| `supabase/functions/lead-gen-chat/index.ts` | Edge Function — GPT-4.1-mini conversation manager: confirms before searching, suggests refinements on zero results, handles dialog turns; Apollo search pipeline inlined here |
| `supabase/functions/apollo-search/index.ts` | Edge Function — LLM prompt parsing, Apollo search + enrichment, credit tracking (standalone, also called by lead-gen-chat) |
| `supabase/functions/apollo-phone-webhook/index.ts` | Edge Function — receives async phone reveal webhooks from Apollo, matches lead by apolloId, updates phone field |
| `src/lib/api/apollo.ts` | Frontend API client — invokes apollo-search Edge Function, maps results |
| `src/lib/api/lead-gen-chat.ts` | Frontend API client — invokes lead-gen-chat Edge Function, maps conversation responses |
| `src/lib/api/search-history.ts` | API client — reads and writes rows to `lead_search_history` |

---

## Detailed Behavior

### User Flow

```
1. Page loads → Bot sends initial prompt:
   "Describe your ideal customer profile and I'll generate a lead list
    from Apollo.io. For example: 'CTOs at SaaS companies, 50-200
    employees, based in Austin'"

2. User types a description → clicks Send (or presses Enter)

3. User message appears in chat (right-aligned, primary bg)

4. lead-gen-chat Edge Function called — GPT-4.1-mini receives the
   message and the full conversation history. The model responds with
   a confirmation summary of the intended search and asks the user to
   confirm or refine. Bot message rendered with clickable action
   buttons (e.g. "Yes, search now", "Refine criteria").

5. User clicks an action button or types a reply to confirm or adjust.
   No AlertDialog is shown — confirmation happens entirely in the chat.

6. Once confirmed, loading state shown:
   "Searching Apollo.io for matching contacts..."
   while the Apollo pipeline runs inside lead-gen-chat.

7. Apollo search pipeline (inlined in lead-gen-chat):
   a. LLM (GPT-4.1-mini via OpenRouter) parses the confirmed prompt
      into structured Apollo filters (title, industry, company size,
      location, keywords)
   b. Apollo People Search API called with extracted filters
   c. Bulk enrichment run on returned contacts for verified emails
      and phone numbers
   d. Results scored by contact quality (verified email, phone
      availability, profile completeness)
   e. Filtered and ranked results returned (max 50)

8a. Results found — Bot responds with:
    - Text: "Found N contacts matching your criteria. Here's the list:"
    - Table: Name, Title, Company, Location, Email, Contact Score
    - Leads already in the CRM are shown with an "Already in CRM" badge
      in the search results table (matched by apollo_id pre-enrichment,
      then by email post-enrichment)
    - Import button: "Import N as Cold Leads"
    - Search results are immediately persisted to `lead_search_history`
      in Supabase before the user takes any action

8b. Zero results — GPT-4.1-mini generates a bot message explaining why
    no results were found and suggests 2–3 refinements as clickable
    action buttons (e.g. "Broaden to 10–500 employees",
    "Remove location filter").

9. User clicks "Import N as Cold Leads"
   → Leads assigned to current user
   → Persisted to Supabase via addLeads() mutation
   → Button changes to "Imported to CRM" (disabled)
   → The corresponding `lead_search_history` row is marked imported

10. User can continue chatting to generate more batches

11. On page navigation away and back, the full chat history is restored
    from `lead_search_history`. Un-imported result sets are restored
    with their "Import N as Cold Leads" button still active — results
    remain importable across navigations.
```

### Chat Message Types

```typescript
interface ChatMessage {
  role: 'user' | 'bot';
  content: string;       // Message text
  leads?: Lead[];        // Only on bot messages with generated leads
}
```

- **User messages:** Right-aligned, primary background, user icon
- **Bot messages:** Left-aligned, muted background, Bot icon
- **Bot messages with leads:** Include a table + import button below the text

### Apollo Search & Enrichment

The Apollo search pipeline now runs server-side inside the `lead-gen-chat` Edge Function (previously in `apollo-search`). `apollo-search` still exists as a standalone function. The pipeline steps are:

1. **LLM parsing** — GPT-4.1-mini extracts structured filters from the confirmed prompt: job title keywords, seniority level, industries, company size range, and location.
2. **Apollo People Search** — Filters passed to Apollo's `/mixed_people/search` endpoint. Up to 50 contacts returned.
3. **Bulk enrichment** — Apollo's `/people/bulk_match` called on the search results to surface verified emails. The request is sent with `reveal_phone_number=true` so Apollo triggers an async phone reveal via webhook rather than returning the number inline.
4. **Contact scoring** — Each result scored 0–100 based on: verified email present (+40), phone present (+30), LinkedIn URL (+15), complete name (+15).
5. **Credit tracking** — Search and enrichment credit usage written to `apollo_usage` table for circuit breaker enforcement.

**Phone number reveal (async):**

Phone numbers are delivered asynchronously by Apollo via the `apollo-phone-webhook` Edge Function. The search results store `apollo_id` on each lead (mapped from Apollo's `person.id`) so that when the webhook fires, the matching lead can be located and its `phone` field updated. In the search results table, phone shows as "pending..." until the webhook delivers the number and Supabase Realtime propagates the update to the frontend.

**Imported lead properties:**
- IDs: generated by the database (UUIDs)
- Status: `cold`
- AssignedTo: current user (assigned on import)
- Tags: `['apollo', 'generated']`
- Notes: `Generated from: "[user's prompt]"`
- CreatedAt: current timestamp
- LastContactedAt: `null`
- ApolloId: Apollo's `person.id` — stored on the lead for matching incoming phone reveal webhooks

### Import Logic

```typescript
const handleImport = (leads: Lead[], msgIndex: number) => {
  const assignedLeads = leads.map(l => ({ ...l, assignedTo: user!.id }));
  addLeads(assignedLeads);
  setImportedSets(prev => new Set([...prev, msgIndex]));
};
```

- Assigns all leads to the current user
- Adds to CRM via `addLeads()`
- **Deduplication runs at two layers before import:**
  1. **Pre-enrichment (by `apollo_id`)** — contacts whose `apollo_id` already exists in the CRM are flagged immediately after the Apollo People Search, before bulk enrichment is called. This avoids spending enrichment credits on leads the team already has.
  2. **Post-enrichment (by email)** — after bulk enrichment runs and verified emails are available, any remaining contacts whose email matches an existing lead are also flagged.
  - Flagged duplicates are shown in the search results table with an "Already in CRM" badge but are excluded from the import count and silently skipped when the user clicks the import button.
- Tracks which message batches have been imported via `importedSets` Set
- Import button shows "Imported to CRM" and is disabled after import
- Each chat message's import is independent (can import from multiple responses)

### UI Layout

- Full-height layout: `calc(100vh - 3.5rem)` (viewport minus header)
- Max width: 900px, centered
- Header: "Lead Generator" with Sparkles icon
- Chat card fills remaining vertical space
- Input at bottom with form submit (Send button or Enter key)

---

## Component & Function Reference

### LeadGeneratorPage (default export)

**Hooks:** `useLeads()`, `useAuth()`

**State:**
| State | Type | Purpose |
|-------|------|---------|
| `messages` | `ChatMessage[]` | Chat history (initialized with bot welcome, then restored from DB on mount) |
| `input` | `string` | Current input field value |
| `loading` | `boolean` | Shows loading indicator during search |
| `importedSets` | `Set<number>` | Message indices that have been imported |

**Functions:**
- `handleSend()` — adds user message, calls `lead-gen-chat` Edge Function with full conversation history, renders bot response (may include action buttons or a leads table), persists results to `lead_search_history` when a search completes
- `handleActionButton(action)` — injects the action label as a user message and calls `handleSend()`, used by clickable suggestion buttons in bot messages
- `handleImport(leads, msgIndex)` — assigns leads to user, adds to CRM, marks search history row as imported, marks message as imported

**On mount:** Loads prior search history rows for the current user from `lead_search_history`, ordered by `created_at` ascending, and reconstructs the chat message list. Un-imported rows restore with an active import button.

### Hook Mutations Used
- `addLeads(leads)` — persists imported leads to Supabase

### API Clients Used
- `src/lib/api/lead-gen-chat.ts` — `sendChatMessage(messages)` — calls the `lead-gen-chat` Edge Function with the full conversation history, returns a bot response that may carry leads, action buttons, or plain text
- `src/lib/api/apollo.ts` — `searchLeadsViaApollo(prompt)` — calls the `apollo-search` Edge Function directly (used for non-conversational or legacy search paths)
- `src/lib/api/search-history.ts` — `saveSearchHistory(row)`, `getSearchHistory(userId)`, `markSearchHistoryImported(id)` — reads and writes `lead_search_history` rows

---

## Data Dependencies

| Data | Source | Used For |
|------|--------|----------|
| Current User | `useAuth().user` | Lead assignment on import |
| addLeads | `useLeads().addLeads` | Importing leads into Supabase |
| Apollo search + enrichment | `src/lib/api/apollo.ts` → `apollo-search` Edge Function | Real lead discovery |
| Search history (read) | `src/lib/api/search-history.ts` → `lead_search_history` table | Restoring chat on page navigation |
| Search history (write) | `src/lib/api/search-history.ts` → `lead_search_history` table | Persisting results immediately on return from Apollo |

---

## Known Limitations & TODOs

- Result count capped at 50
- ~~No deduplication against existing leads~~ — deduplication is now implemented (see Import Logic)
- LLM parsing may occasionally misinterpret ambiguous prompts
- Cannot customize which fields to import
- Cannot preview/edit leads before import
- No undo after import
- No pagination or "load more" for results

---

## Future Considerations

- ~~Add lead deduplication against existing CRM leads~~ — completed
- Add ability to select individual leads before importing (checkbox on each row)
- Add richer enrichment data (funding, revenue, tech stack, social profiles)
- Consider streaming Edge Function responses for real-time feel
- Support multiple lead sources beyond Apollo.io
- Expose circuit breaker status in the UI so users know remaining credits

---

## Changelog

| Date | Change | Files Affected |
|------|--------|----------------|
| 2026-03-22 | Initial documentation created | — |
| 2026-03-23 | Imported leads persist to Supabase database | `LeadGeneratorPage.tsx` |
| 2026-03-23 | Apollo.io integration: real search, enrichment, contact scoring, circuit breakers | `LeadGeneratorPage.tsx`, `apollo.ts`, Edge Function |
| 2026-03-23 | apollo-search Edge Function implemented — real Apollo search, enrichment, ZeroBounce validation, credit logging | Edge Function, apollo.ts |
| 2026-03-23 | Phone number reveal: async webhook from Apollo, apolloId tracking, pending indicator | apollo-search, apollo-phone-webhook, LeadGeneratorPage |
| 2026-03-24 | Search history persistence: results saved to DB immediately, chat restores on navigation | `LeadGeneratorPage.tsx`, `search-history.ts` |
| 2026-03-24 | Conversational lead generator: GPT-4.1-mini manages dialog, confirms before searching, suggests refinements, clickable action buttons | `lead-gen-chat`, `LeadGeneratorPage`, `lead-gen-chat.ts` |
| 2026-03-24 | Lead deduplication: pre-enrichment by apollo_id (saves credits), post-enrichment by email, "In CRM" badge, import skips duplicates | `lead-gen-chat`, `LeadGeneratorPage` |
