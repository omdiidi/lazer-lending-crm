# Brief: Conversational Lead Generator Bot

## Why
The current Lead Generator is a one-shot search: user types → LLM extracts → Apollo runs → results or nothing. When niche searches return 0 results, users have no guidance. The bot should be an intelligent assistant that confirms, suggests, and refines.

## Context

### Files Directly Affected
- `src/pages/LeadGeneratorPage.tsx` (307 lines) — complete rewrite of the chat interaction logic
  - ChatMessage interface: `{ role: 'user' | 'bot'; content: string; leads?: Lead[] }` — needs extending for action buttons
  - `showConfirm` + AlertDialog popup — will be replaced by in-chat confirmation
  - `executeSearch()` — currently calls searchApollo directly, will instead call conversational Edge Function
  - `handleSend()` — currently stores prompt and opens dialog, will become multi-turn message handler
  - `historyIds` state — maps message indices to search history DB IDs
  - Search history mount load (lines 47-83) — rebuilds chat from history

- `src/lib/api/apollo.ts` (24 lines) — keep as-is, but add a new `sendLeadGenMessage()` function for the conversational layer
- `supabase/functions/apollo-search/index.ts` (430 lines) — UNCHANGED (the conversational layer calls it)
- `src/lib/api/search-history.ts` (60 lines) — extend to save conversation sessions, not just individual searches

### Reference Pattern (CampaignAIChat)
- `src/components/outreach/CampaignAIChat.tsx` uses the exact multi-turn pattern we need:
  - Maintains message history with IDs
  - Snapshots messages before adding new user message
  - Builds `chatHistory: { role, content }[]` from message state
  - Passes full history to Edge Function on each turn
  - Appends assistant response to messages
- `src/lib/api/campaign-ai.ts` shows the client calling pattern: `supabase.functions.invoke('function-name', { body: { prompt, chatHistory } })`

### New Files Needed
- `supabase/functions/lead-gen-chat/index.ts` — NEW Edge Function: conversational agent that decides when to ask vs search
  - Uses GPT-4.1-mini for conversation management
  - Has a `search_apollo` tool it can invoke (calls the existing apollo-search Edge Function internally OR calls Apollo directly)
  - Returns either: conversation response (question/confirmation/suggestion) OR search results
- `src/lib/api/lead-gen-chat.ts` — NEW client function to invoke the conversational Edge Function

## Decisions

### ChatMessage Interface Extension
```typescript
interface ChatMessage {
  role: 'user' | 'bot';
  content: string;
  leads?: Lead[];
  actions?: { label: string; prompt: string }[];  // Clickable suggestion buttons
  type?: 'message' | 'confirmation' | 'results';  // Message type for rendering
}
```
- `actions` array: bot can suggest alternatives as clickable buttons
- `type` field: helps render differently (confirmation cards, result tables, etc.)
- Clicking an action button sends `action.prompt` as the next user message

### Always Confirm Before Searching
- Bot ALWAYS shows a confirmation before running Apollo search
- "I'll search for [parsed filters]. This will use ~X credits. Shall I proceed?"
- Rendered as a confirmation-type message with [Yes, search] / [Modify search] action buttons
- Replaces the current AlertDialog popup — more natural, in the chat flow
- `showConfirm` state + AlertDialog component removed entirely

### Follow-up After Results
- After successful results: bot proactively suggests refinements as action buttons
- After 0 results: bot suggests alternatives as clickable buttons
- Clicking a button auto-sends it as the next user message

### Conversational Agent Edge Function
- New `lead-gen-chat` Edge Function using GPT-4.1-mini
- Receives: `{ message, chatHistory, userId }`
- Returns: `{ response: string, actions?: { label, prompt }[], searchResults?: ApolloSearchResult, shouldSearch?: boolean, filters?: ApolloFilters }`
- The LLM decides the flow:
  - Vague prompt → return questions (no search)
  - Clear prompt → return confirmation with parsed filters (no search yet)
  - User confirms → call apollo-search, return results + follow-up suggestions
  - 0 results → return alternative suggestions as actions
- This is a SINGLE Edge Function that handles the entire conversation — not two separate functions

### Search History Persistence
- Extend `lead_search_history` to also store the conversation context
- Each search still gets its own row, but the conversation history is preserved
- On mount: load history, rebuild full conversation including bot questions/confirmations

## Rejected Alternatives
- **Always search immediately (current)** — wastes credits on bad searches, no recovery for 0 results
- **Always ask questions before searching** — annoying for clear queries, adds unnecessary latency
- **Client-side conversation only** — need server-side LLM for smart suggestions
- **Modify apollo-search Edge Function** — keep it clean as a pure search executor, add conversation layer on top

## Direction
Build a new `lead-gen-chat` Edge Function using GPT-4.1-mini that manages multi-turn conversation. It always confirms before searching, suggests refinements after results, and offers clickable alternatives on zero results. The existing `apollo-search` Edge Function stays unchanged — the conversational layer calls it internally when the user confirms a search. Extend ChatMessage interface to support action buttons. Replace the AlertDialog confirmation with in-chat confirmation cards.
