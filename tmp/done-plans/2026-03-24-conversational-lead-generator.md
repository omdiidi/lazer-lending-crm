# Plan: Conversational Lead Generator Bot

**Confidence: 8/10** — New Edge Function + significant LeadGeneratorPage rewrite. The conversational LLM logic is the most complex piece.

## Goal

Transform the Lead Generator from a one-shot search into an intelligent conversational assistant. The bot always confirms before searching, suggests refinements after results, and offers clickable alternatives on zero results.

## Files Being Changed

```
supabase/
├── functions/
│   └── lead-gen-chat/
│       └── index.ts                    ← NEW (conversational agent — GPT-4.1-mini)
src/
├── pages/
│   └── LeadGeneratorPage.tsx           ← MODIFIED (multi-turn chat, action buttons, remove AlertDialog)
├── lib/
│   └── api/
│       └── lead-gen-chat.ts            ← NEW (client function for conversational Edge Function)
docs/
├── lead-generator.md                   ← MODIFIED
├── schema.md                           ← MODIFIED
├── OVERVIEW.md                         ← MODIFIED
```

---

## Architecture Overview

### Before
```
User types prompt → AlertDialog confirms → searchApollo() → results or nothing
```

### After
```
User types message
  → sendLeadGenMessage({ message, chatHistory })
    → lead-gen-chat Edge Function (GPT-4.1-mini):

      Turn 1 (user describes what they want):
        LLM analyzes → returns confirmation message with parsed filters
        "I'll search for [title] at [industry] in [location]. ~X credits. Shall I proceed?"
        Actions: [Yes, search] [Modify search]

      Turn 2 (user confirms):
        Edge Function calls apollo-search internally
        If results > 0: returns results + refinement suggestions
          "Found 15 results. Want me to also check Director roles?"
          Actions: [Also search Directors] [Narrow by company size] [Good, I'm done]
        If results == 0: returns alternative suggestions
          "No results found. Apollo's database is strongest for tech/B2B. Try:"
          Actions: [Broader industry] [Wider location] [Different titles]

      Turn 3+ (user refines):
        LLM adjusts filters based on conversation → confirms → searches again
```

### Edge Function Internal Flow

```typescript
// The lead-gen-chat Edge Function decides what to do based on conversation state:

1. Parse the latest message + chat history
2. Determine intent:
   a) New search request → extract filters → return confirmation (don't search yet)
   b) User confirms ("yes", "search", "go ahead") → call Apollo → return results + suggestions
   c) User wants to modify → ask what to change
   d) User clicks a suggestion button → adjust filters → return new confirmation
   e) Follow-up after results → adjust and confirm new search
3. Return: { response, actions?, leads?, filters? }
```

---

## Key Pseudocode

### lead-gen-chat Edge Function

```typescript
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface ChatTurn { role: 'user' | 'assistant'; content: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')
    const APOLLO_API_KEY = Deno.env.get('APOLLO_API_KEY')
    const ZEROBOUNCE_API_KEY = Deno.env.get('ZEROBOUNCE_API_KEY')
    const authHeader = req.headers.get('Authorization')!

    const { message, chatHistory, perPage } = await req.json()

    // System prompt for the conversational agent
    const systemPrompt = `You are an intelligent lead generation assistant for IntegrateAPI CRM. You help users find business contacts via Apollo.io.

YOUR BEHAVIOR:
1. When the user describes who they're looking for, ALWAYS confirm before searching:
   - Parse their request into filters: titles, locations, industries, company sizes, seniorities
   - Show what you understood: "I'll search for [titles] at [industry] companies in [location]"
   - Estimate credits: approximately (perPage × 2) credits
   - Ask: "Shall I proceed with this search?"
   - Include actions: [{"label":"Yes, search","prompt":"yes search"},{"label":"Modify search","prompt":"I want to change the search"}]

2. When the user confirms (says "yes", "go ahead", "search", etc.), respond with:
   - Set shouldSearch to true
   - Include the parsed filters object

3. When search returns results, suggest refinements:
   - "Found X results! Want me to refine?"
   - Suggest related titles, broader/narrower locations, different company sizes
   - Include actions as clickable suggestions

4. When search returns 0 results, explain why and suggest alternatives:
   - Note that Apollo is strongest for tech/B2B contacts
   - Suggest broader industry terms, wider geography, or different titles
   - Include 2-3 specific alternatives as actions

5. For vague requests ("find me some leads"), ask clarifying questions:
   - What industry or type of business?
   - What job titles or roles?
   - What location?

RESPONSE FORMAT (JSON):
{
  "response": "Your message to the user",
  "actions": [{"label": "Button text", "prompt": "What gets sent when clicked"}],
  "shouldSearch": false,
  "filters": null
}

When shouldSearch is true, include filters:
{
  "response": "Searching now...",
  "shouldSearch": true,
  "filters": {
    "person_titles": ["CTO"],
    "person_locations": ["Austin, TX"],
    "organization_num_employees_ranges": ["51-200"],
    "q_keywords": "SaaS",
    "person_seniorities": ["c_suite"]
  }
}

FILTER RULES:
- person_titles: job title keywords
- person_locations: "City, State" format
- organization_num_employees_ranges: "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"
- q_keywords: industry/topic keywords
- person_seniorities: "c_suite", "founder", "owner", "partner", "vp", "director", "manager", "senior", "entry"
- Be generous with title variations (CTO → also "Chief Technology Officer")
- Empty arrays = no filter for that field`

    // Call GPT-4.1-mini for conversation management
    const llmMessages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.map((m: ChatTurn) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ]

    const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'IntegrateAPI CRM',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4.1-mini',
        messages: llmMessages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'lead_gen_response',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                response: { type: 'string' },
                actions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      prompt: { type: 'string' },
                    },
                    required: ['label', 'prompt'],
                    additionalProperties: false,
                  },
                },
                shouldSearch: { type: 'boolean' },
                filters: {
                  type: ['object', 'null'],
                  properties: {
                    person_titles: { type: 'array', items: { type: 'string' } },
                    person_locations: { type: 'array', items: { type: 'string' } },
                    organization_num_employees_ranges: { type: 'array', items: { type: 'string' } },
                    q_keywords: { type: 'string' },
                    person_seniorities: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['person_titles', 'person_locations', 'organization_num_employees_ranges', 'q_keywords', 'person_seniorities'],
                  additionalProperties: false,
                },
              },
              required: ['response', 'actions', 'shouldSearch', 'filters'],
              additionalProperties: false,
            },
          },
        },
        temperature: 0.4,
      }),
    })

    if (!llmRes.ok) { /* error handling */ }
    const llmData = await llmRes.json()
    const parsed = JSON.parse(llmData.choices[0].message.content)

    // If LLM says to search, call Apollo
    if (parsed.shouldSearch && parsed.filters) {
      // Call apollo-search Edge Function internally via Supabase
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )

      // Reuse the same apollo-search pipeline but call it server-side
      // Actually simpler: inline the Apollo search + enrichment logic here
      // OR call the Edge Function via HTTP
      const apolloRes = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/apollo-search`,
        {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: JSON.stringify(parsed.filters), // Pass pre-parsed filters as prompt
            perPage: perPage || 25,
          }),
        }
      )
      const searchResults = await apolloRes.json()

      // Generate follow-up message based on results
      const resultCount = searchResults.leads?.length || 0
      let followUpResponse: string
      let followUpActions: { label: string; prompt: string }[] = []

      if (resultCount > 0) {
        followUpResponse = `Found ${resultCount} contacts matching your criteria (${searchResults.creditsUsed} credits used). Here are the results:`
        followUpActions = [
          { label: 'Also check Director-level roles', prompt: 'Also search for Director-level roles with the same criteria' },
          { label: 'Expand to nearby locations', prompt: 'Expand the search to nearby locations' },
          { label: 'Narrow by company size', prompt: 'I want to narrow by company size' },
        ]
      } else {
        followUpResponse = `No matching contacts found. Apollo's database is strongest for tech and B2B companies. Would you like to try a broader search?`
        followUpActions = [
          { label: 'Broader industry terms', prompt: 'Try broader industry keywords and related industries' },
          { label: 'Wider location', prompt: 'Expand to the entire state or region' },
          { label: 'Different titles', prompt: 'Try related job titles and seniority levels' },
        ]
      }

      return new Response(JSON.stringify({
        response: followUpResponse,
        actions: followUpActions,
        leads: searchResults.leads || [],
        filters: parsed.filters,
        creditsUsed: searchResults.creditsUsed || 0,
        totalFound: searchResults.totalFound || 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // No search — just conversation
    return new Response(JSON.stringify({
      response: parsed.response,
      actions: parsed.actions || [],
      leads: [],
      filters: parsed.filters,
      creditsUsed: 0,
      totalFound: 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('lead-gen-chat error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
```

### Client API Function

```typescript
// src/lib/api/lead-gen-chat.ts
import { supabase } from '@/lib/supabase';
import type { Lead } from '@/types/crm';

export interface LeadGenChatResponse {
  response: string;
  actions: { label: string; prompt: string }[];
  leads: Lead[];
  filters: Record<string, unknown> | null;
  creditsUsed: number;
  totalFound: number;
}

export async function sendLeadGenMessage(
  message: string,
  chatHistory: { role: 'user' | 'assistant'; content: string }[],
  perPage?: number,
): Promise<LeadGenChatResponse> {
  const { data, error } = await supabase.functions.invoke('lead-gen-chat', {
    body: { message, chatHistory, perPage },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as LeadGenChatResponse;
}
```

### LeadGeneratorPage — Updated Chat Flow

```typescript
// Extended ChatMessage interface
interface ChatMessage {
  role: 'user' | 'bot';
  content: string;
  leads?: Lead[];
  actions?: { label: string; prompt: string }[];
}

// handleSend — now just sends a message (no AlertDialog)
const handleSend = async (text?: string) => {
  const msg = (text || input).trim();
  if (!msg || loading) return;

  const currentMessages = [...messages];
  const userMsg: ChatMessage = { role: 'user', content: msg };
  setMessages(prev => [...prev, userMsg]);
  setInput('');
  setLoading(true);

  try {
    const chatHistory = currentMessages
      .filter(m => m.content !== welcomeMessage)
      .map(m => ({ role: m.role === 'bot' ? 'assistant' as const : 'user' as const, content: m.content }));

    const result = await sendLeadGenMessage(msg, chatHistory, selectedCount);

    const botMsg: ChatMessage = {
      role: 'bot',
      content: result.response,
      leads: result.leads.length > 0 ? result.leads : undefined,
      actions: result.actions.length > 0 ? result.actions : undefined,
    };
    setMessages(prev => [...prev, botMsg]);

    // If leads returned, save to search history
    if (result.leads.length > 0) {
      const historyId = await saveSearchHistory({
        userId: user!.id,
        prompt: msg,
        leads: result.leads,
        filters: result.filters || {},
        totalFound: result.totalFound,
        creditsUsed: result.creditsUsed,
      });
      // Track for import
      const botIndex = messages.length + 1;
      setHistoryIds(prev => { const n = new Map(prev); n.set(botIndex, historyId); return n; });
    }
  } catch (err) {
    setMessages(prev => [...prev, { role: 'bot', content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}` }]);
  } finally {
    setLoading(false);
  }
};

// Action button click handler
const handleAction = (prompt: string) => {
  handleSend(prompt);
};

// Render action buttons in bot messages
{msg.actions && msg.actions.length > 0 && (
  <div className="flex flex-wrap gap-2 mt-2">
    {msg.actions.map((action, j) => (
      <Button key={j} variant="outline" size="sm" className="text-xs"
        onClick={() => handleAction(action.prompt)}
        disabled={loading}
      >
        {action.label}
      </Button>
    ))}
  </div>
)}
```

---

## Task Execution Order

### Task 1: Create lead-gen-chat Edge Function
- `supabase/functions/lead-gen-chat/index.ts`
- GPT-4.1-mini conversational agent with JSON schema response
- Calls apollo-search internally when shouldSearch=true
- Returns response + actions + optional leads

### Task 2: Create client API function
- `src/lib/api/lead-gen-chat.ts`
- `sendLeadGenMessage()` — invokes the Edge Function

### Task 3: Rewrite LeadGeneratorPage
- Extend ChatMessage interface with `actions` field
- Replace `handleSend` → calls `sendLeadGenMessage` instead of opening AlertDialog
- Remove AlertDialog, `showConfirm`, `pendingPrompt` state
- Add action button rendering in bot messages
- Add `handleAction` for button clicks
- Keep search history save + import flow
- Keep batch size selector (passed to Edge Function)

### Task 4: Deploy + test

### Task 5: Update documentation

---

## Validation Gates

1. `npm run build` passes
2. Type "Find me CTOs at SaaS companies in Austin" → bot confirms with filters + [Yes, search] button
3. Click [Yes, search] → real Apollo results returned
4. After results: bot suggests refinements with clickable buttons
5. Type a vague query → bot asks clarifying questions
6. Search returns 0 → bot suggests alternatives with buttons
7. Click a suggestion button → new conversation turn with adjusted query
8. Search history still saves results
9. Import still works

---

## Known Gotchas

```
1. INLINE Apollo search logic directly in lead-gen-chat — do NOT call
   apollo-search Edge Function. This avoids redundant LLM parsing and
   saves 1-3 seconds per search. Copy the Apollo API calls (search +
   enrichment + ZeroBounce + scoring) from apollo-search into lead-gen-chat.
   The lead-gen-chat LLM already produces structured filters.

2. filters field in JSON schema: ALWAYS return as object with empty arrays
   (never null). OpenAI strict mode does NOT support type: ['object', 'null'].
   Use shouldSearch=false to signal non-actionable filters.

3. The welcome message should NOT be sent in chatHistory to the LLM.
   Filter it out by content or by index.

4. Action buttons should be disabled while loading (prevent double-sends).

5. Search history: only save when leads are returned, not on every
   conversation turn. Non-search turns are ephemeral.

6. The AlertDialog import and all related state/JSX can be fully removed.
   The batch size selector (Select component) stays.

7. botIndex calculation: use a variable captured INSIDE the setMessages
   updater function or compute from the snapshot length, not the stale
   closure value. Or use a ref to track the latest index.

8. Search history restoration: attach standard post-result action buttons
   when restoring bot messages that contain leads. Use a fixed set:
   [Also search Directors] [Expand location] [Narrow by company size].

9. authHeader: add null guard. If Authorization header is missing,
   return 401 immediately. Don't use non-null assertion (!).

10. The Edge Function is LARGE because it inlines the Apollo pipeline.
    This is intentional — avoids the double-LLM-call problem. The function
    may approach the 150s timeout on large searches. Use the same 100-lead
    batch + 200ms delay pattern from apollo-search.
```

---

## Deprecated Code (to remove)

| Code | File | Reason |
|------|------|--------|
| AlertDialog import + component | LeadGeneratorPage.tsx | Replaced by in-chat confirmation |
| `showConfirm` state | LeadGeneratorPage.tsx | No more popup |
| `pendingPrompt` state | LeadGeneratorPage.tsx | Messages sent directly |
| `executeSearch()` function | LeadGeneratorPage.tsx | Replaced by `handleSend()` calling lead-gen-chat |
| `searchApollo` import | LeadGeneratorPage.tsx | Not called directly anymore (Edge Function calls it) |
