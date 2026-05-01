# Plan: Campaign AI — Wire CampaignAIChat to DeepSeek V3.2 via OpenRouter

**Confidence: 9/10** — Clear scope (4 new files, 1 modified), well-defined interfaces, all reviewer feedback incorporated.

## Goal

Replace the keyword-matching `parsePrompt()` in `CampaignAIChat.tsx` with a real LLM call to DeepSeek V3.2 via OpenRouter, proxied through a Supabase Edge Function. The AI should intelligently parse campaign descriptions, select matching leads, and generate professional email content with merge fields.

## Why

- The current "AI" campaign chat is fake — `parsePrompt()` does regex keyword matching and generates templated emails
- Users expect intelligent behavior: understanding nuanced prompts, generating varied/relevant email copy, smart lead filtering
- DeepSeek V3.2 supports enforced JSON schema output, ensuring reliable structured responses
- Edge Function keeps the API key server-side (not exposed in browser)

## What

### User-Visible Behavior

The Campaign AI chat tab works exactly as before from a UI perspective:
1. User describes a campaign in natural language
2. Chat shows "thinking" state
3. Bot responds with a summary of what it did (filters applied, recipient count)
4. The compose card auto-fills with AI-generated subject, body, and selected recipients
5. User can refine by sending follow-up messages

**What changes:** The AI actually understands the prompt. It generates unique, contextual email copy instead of templates. It intelligently filters leads based on semantic understanding, not just keyword matching.

### Success Criteria

- [ ] Campaign AI chat calls Edge Function instead of local `parsePrompt()`
- [ ] Edge Function proxies to OpenRouter with DeepSeek V3.2
- [ ] LLM returns structured JSON matching `CampaignAIResponse` interface
- [ ] Generated email subject/body are contextual to the prompt (not templated)
- [ ] Lead filtering works based on LLM understanding of the prompt
- [ ] Error states handled gracefully (LLM timeout, bad response, network error)
- [ ] `npm run build` passes with zero errors
- [ ] All changes documented in relevant `.md` files

---

## Files Being Changed

```
supabase/
├── functions/
│   ├── _shared/
│   │   └── cors.ts                     ← NEW (shared CORS headers for all Edge Functions)
│   └── campaign-ai/
│       └── index.ts                    ← NEW (Edge Function — OpenRouter proxy)
src/
├── components/
│   └── outreach/
│       └── CampaignAIChat.tsx          ← MODIFIED (replace parsePrompt with Edge Function call)
├── lib/
│   └── api/
│       └── campaign-ai.ts             ← NEW (client function + shared types)
docs/
├── OVERVIEW.md                         ← MODIFIED (major changes log)
├── outreach.md                         ← MODIFIED (update Campaign AI section + changelog)
├── architecture.md                     ← MODIFIED (note Edge Functions addition + changelog)
├── schema.md                           ← MODIFIED (note Edge Functions section + changelog)
.env.example                            ← MODIFIED (add clarifying comment)
```

---

## Architecture Overview

### Before
```
User types prompt
  → CampaignAIChat.handleSend()
    → parsePrompt() — local keyword matching
      → regex scans for "cold", "warm", industry names
      → filters leads array client-side
      → generates template subject/body
    → onApplyResult(result) — fills compose card
```

### After
```
User types prompt
  → CampaignAIChat.handleSend()
    → generateCampaignCopy() — calls Edge Function
      → supabase.functions.invoke('campaign-ai', { body: { prompt, leads, industries } })
        → Edge Function reads OPENROUTER_API_KEY from Deno.env
          → POST openrouter.ai/api/v1/chat/completions (DeepSeek V3.2)
            → Enforced JSON schema response
          → Validate response, parse JSON, return
      → Frontend receives CampaignAIResponse
    → onApplyResult(result) — fills compose card (unchanged)
```

### Key Design Decisions

1. **Edge Function as proxy** — API key stays server-side. Frontend calls via `supabase.functions.invoke()` which auto-attaches the user's auth token.
2. **Send lead summaries, not full objects** — The LLM doesn't need all lead fields. Send only `{ id, firstName, lastName, company, industry, status, jobTitle, location }` to reduce token usage and avoid leaking sensitive data (no emails, phone numbers).
3. **JSON schema enforcement** — Use OpenRouter's `response_format: { type: "json_schema" }` to guarantee valid structured output. Also enable the `response-healing` plugin as a safety net.
4. **Conversation history** — Send the full chat history to the LLM so follow-up messages like "make it shorter" or "also include warm leads" work naturally. Chat history is snapshotted BEFORE adding the current user message to avoid duplication (the current prompt is sent separately).
5. **Graceful fallback** — If the Edge Function fails, show an error message in the chat. Don't crash the UI.
6. **Empty `matchedLeadIds` means "all leads"** — When the user says "email all my leads" or doesn't specify filters, the LLM returns `matchedLeadIds: []`. The frontend interprets `[]` as "select all leads" and populates `selectedLeadIds` with every lead ID. This avoids bloating the response with potentially thousands of IDs.
7. **Single type source** — `CampaignAIResponse` is defined in `src/lib/api/campaign-ai.ts` and imported by `CampaignAIChat.tsx`. No duplicate `AIResult` interface.
8. **`statusFilter`/`industryFilter` convention** — The JSON schema requires these as strings (never undefined). Empty string `""` means "no filter". The frontend maps `"" → undefined` before passing to `onApplyResult`. This is documented in code comments.

---

## All Needed Context

### Documentation & References

```yaml
- url: https://openrouter.ai/docs/quickstart
  why: API endpoint, headers, request format

- url: https://openrouter.ai/docs/guides/features/structured-outputs
  why: response_format with json_schema — how to enforce structured output

- url: https://openrouter.ai/docs/guides/features/plugins/response-healing
  why: Auto-repairs malformed JSON — add as safety net

- url: https://supabase.com/docs/guides/functions/quickstart
  why: How to create and deploy Edge Functions

- url: https://supabase.com/docs/reference/javascript/functions-invoke
  why: How to call Edge Functions from the frontend client

- file: src/components/outreach/CampaignAIChat.tsx
  why: The component being modified — contains parsePrompt, handleSend, chat UI

- file: src/pages/OutreachPage.tsx (lines 572-585)
  why: Shows how onApplyResult callback consumes the result — sets selectedLeadIds, fills subject/body, sets filters

- file: src/lib/supabase.ts
  why: Supabase client singleton — used for functions.invoke()
```

### Known Gotchas

```
1. CORS: Supabase Edge Functions need explicit CORS headers when called from
   a browser. Create _shared/cors.ts with Access-Control-Allow-Origin: '*'
   and the required Supabase headers (authorization, x-client-info, apikey,
   content-type).

2. Auth: supabase.functions.invoke() automatically attaches the user's JWT.
   The Edge Function can read it via req.headers.get('Authorization') if needed,
   but for this feature we don't need to — it just proves the user is authenticated.

3. Edge Function secrets: Set via `supabase secrets set OPENROUTER_API_KEY=...`
   (NOT via .env — Edge Functions have their own secret store on Supabase's infra).
   Read in code via `Deno.env.get('OPENROUTER_API_KEY')`.
   The OPENROUTER_API_KEY in .env is for local reference only — Vite won't expose
   it because it lacks the VITE_ prefix, but it should NEVER be added with VITE_.

4. OpenRouter requires either HTTP-Referer or X-Title header for attribution.
   Set X-Title to "IntegrateAPI CRM".

5. DeepSeek V3.2 model ID on OpenRouter: "deepseek/deepseek-v3.2"

6. The response_format json_schema requires additionalProperties: false on all
   object types in the schema.

7. Lead data sent to LLM should be minimal — only fields needed for filtering
   and context. Never send email addresses or phone numbers to external APIs.

8. Chat history deduplication: snapshot `messages` state BEFORE calling
   setMessages() with the new user message, so chatHistory doesn't include
   the current turn's prompt (which is sent separately as `prompt`).

9. Enter key guard: The Input's onKeyDown handler must also check `isThinking`
   to prevent duplicate submissions (matching the Button's disabled logic).
```

---

## Key Pseudocode

### Shared CORS Helper (`supabase/functions/_shared/cors.ts`)

```typescript
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
```

### Edge Function (`supabase/functions/campaign-ai/index.ts`)

```typescript
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')
    if (!OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'OpenRouter API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { prompt, leads, industries, chatHistory } = await req.json()

    // Build system prompt (see System Prompt Design section below)
    const systemPrompt = buildSystemPrompt(leads, industries)

    // Build messages: system + prior chat history + current user prompt
    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.map((m: { role: string; content: string }) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      { role: 'user', content: prompt },
    ]

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'IntegrateAPI CRM',
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v3.2',
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'campaign_result',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                matchedLeadIds: { type: 'array', items: { type: 'string' } },
                subject: { type: 'string' },
                body: { type: 'string' },
                statusFilter: { type: 'string' },
                industryFilter: { type: 'string' },
                explanation: { type: 'string' },
              },
              required: ['matchedLeadIds', 'subject', 'body', 'statusFilter', 'industryFilter', 'explanation'],
              additionalProperties: false,
            },
          },
        },
        temperature: 0.4,
        plugins: [{ id: 'openrouter#response-healing' }],
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('OpenRouter error:', response.status, errorBody)
      return new Response(
        JSON.stringify({ error: `LLM request failed (${response.status})` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const data = await response.json()

    if (!data.choices?.length || !data.choices[0].message?.content) {
      return new Response(
        JSON.stringify({ error: 'No response from LLM' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const content = JSON.parse(data.choices[0].message.content)

    return new Response(JSON.stringify(content), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('campaign-ai error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
```

### Client API Function (`src/lib/api/campaign-ai.ts`)

```typescript
import { supabase } from '@/lib/supabase'

export interface LeadSummary {
  id: string
  firstName: string
  lastName: string
  company: string
  industry: string
  status: string
  jobTitle: string
  location: string
}

export interface CampaignAIRequest {
  prompt: string
  leads: LeadSummary[]
  industries: string[]
  chatHistory: { role: 'user' | 'assistant'; content: string }[]
}

export interface CampaignAIResponse {
  matchedLeadIds: string[]
  subject: string
  body: string
  statusFilter: string      // empty string = no filter
  industryFilter: string    // empty string = no filter
  explanation: string
}

export async function generateCampaignCopy(
  request: CampaignAIRequest
): Promise<CampaignAIResponse> {
  const { data, error } = await supabase.functions.invoke('campaign-ai', {
    body: request,
  })

  if (error) throw error
  return data as CampaignAIResponse
}
```

### Updated CampaignAIChat Component (key changes only)

```typescript
// REMOVE: parsePrompt(), buildAssistantMessage(), STATUS_KEYWORDS, LeadStatus import
// ADD: import { generateCampaignCopy, type CampaignAIResponse } from '@/lib/api/campaign-ai'

// Remove AIResult interface — use CampaignAIResponse from campaign-ai.ts instead
// Update CampaignAIChatProps to use CampaignAIResponse:
interface CampaignAIChatProps {
  leads: Lead[];
  industries: string[];
  onApplyResult: (result: {
    matchedLeadIds: string[];
    subject: string;
    body: string;
    statusFilter?: string;
    industryFilter?: string;
  }) => void;
}

const handleSend = async () => {  // Make async
  const text = input.trim()
  if (!text || isThinking) return  // Guard against double-submit

  // Snapshot messages BEFORE adding user message to avoid duplication
  const currentMessages = [...messages]

  const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text }
  setMessages(prev => [...prev, userMsg])
  setInput('')
  setIsThinking(true)

  try {
    // Prepare lead summaries (strip sensitive fields — no emails, phones)
    const leadSummaries = leads.map(l => ({
      id: l.id, firstName: l.firstName, lastName: l.lastName,
      company: l.company, industry: l.industry, status: l.status,
      jobTitle: l.jobTitle, location: l.location,
    }))

    // Build chat history from snapshot (exclude welcome message)
    const chatHistory = currentMessages
      .filter(m => m.id !== 'welcome')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    const result = await generateCampaignCopy({
      prompt: text,
      leads: leadSummaries,
      industries,
      chatHistory,
    })

    const assistantMsg: ChatMessage = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: result.explanation,
    }
    setMessages(prev => [...prev, assistantMsg])

    // Map to onApplyResult format:
    // - Empty matchedLeadIds [] means "all leads" → pass all lead IDs
    // - Empty string statusFilter/industryFilter → undefined
    onApplyResult({
      matchedLeadIds: result.matchedLeadIds.length > 0
        ? result.matchedLeadIds
        : leads.map(l => l.id),  // [] convention = all leads
      subject: result.subject,
      body: result.body,
      statusFilter: result.statusFilter || undefined,
      industryFilter: result.industryFilter || undefined,
    })
  } catch (err) {
    const errorMsg: ChatMessage = {
      id: `e-${Date.now()}`,
      role: 'assistant',
      content: 'Sorry, I had trouble generating that campaign. Please try again.',
    }
    setMessages(prev => [...prev, errorMsg])
  } finally {
    setIsThinking(false)
  }
}

// Also update the onKeyDown handler to check isThinking:
// onKeyDown={e => e.key === 'Enter' && !e.shiftKey && !isThinking && handleSend()}
```

---

## Task Execution Order

### Task 1: Initialize Supabase CLI and Edge Functions directory

The project has no `supabase/` directory yet. Initialize it:

```bash
npx supabase init  # Creates supabase/ directory with config.toml
npx supabase link --project-ref onthjkzdgsfvmgyhrorw
```

Create the shared CORS helper:

**`supabase/functions/_shared/cors.ts`:**
```typescript
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
```

### Task 2: Create the Campaign AI Edge Function

Create `supabase/functions/campaign-ai/index.ts` following the pseudocode above.

Key implementation details:
- Guard: check `OPENROUTER_API_KEY` exists, return 500 if not
- Guard: check `response.ok` after OpenRouter fetch, return 502 if not
- Guard: check `data.choices?.length` before accessing index 0
- Build system prompt using `buildSystemPrompt()` helper function (see System Prompt Design section)
- Wrap entire handler in try/catch, return 500 on unexpected errors

### Task 3: Deploy the Edge Function and set secrets + smoke test

```bash
npx supabase functions deploy campaign-ai --project-ref onthjkzdgsfvmgyhrorw
npx supabase secrets set OPENROUTER_API_KEY=<key-from-.env> --project-ref onthjkzdgsfvmgyhrorw
```

**Smoke test** — Verify the Edge Function works before wiring up the frontend:
```bash
curl -X POST 'https://onthjkzdgsfvmgyhrorw.supabase.co/functions/v1/campaign-ai' \
  -H 'Authorization: Bearer <SUPABASE_ANON_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Send a cold email to SaaS leads about our API platform","leads":[{"id":"test-1","firstName":"Alex","lastName":"Werner","company":"ScaleGrid","industry":"SaaS","status":"cold","jobTitle":"CTO","location":"Austin, TX"}],"industries":["SaaS"],"chatHistory":[]}'
```

Expected: 200 response with JSON containing `matchedLeadIds`, `subject`, `body`, `explanation`.

### Task 4: Create the client API function

Create `src/lib/api/campaign-ai.ts` with exported types and `generateCampaignCopy()` function as shown in pseudocode above.

### Task 5: Update CampaignAIChat.tsx

- **Remove:** `parsePrompt()` function, `buildAssistantMessage()` function, `STATUS_KEYWORDS` constant, `LeadStatus` import from `@/types/crm`
- **Remove:** local `AIResult` interface (replaced by imported `CampaignAIResponse`)
- **Add:** import `generateCampaignCopy` and `CampaignAIResponse` from `@/lib/api/campaign-ai`
- **Change:** `handleSend` to `async`, replace `setTimeout` block with `await generateCampaignCopy()`
- **Add:** try/catch for error handling — show error message in chat on failure
- **Add:** `isThinking` guard in the `handleSend` entry (`if (!text || isThinking) return`)
- **Add:** `!isThinking` check to `onKeyDown` handler
- **Add:** `const currentMessages = [...messages]` snapshot before `setMessages` to prevent chat history duplication
- **Map:** `result.matchedLeadIds` — if empty array, pass `leads.map(l => l.id)` (all leads convention)
- **Map:** `result.statusFilter || undefined` and `result.industryFilter || undefined` (empty string → undefined)
- **Use:** `result.explanation` as the assistant's chat message content

### Task 6: Update `.env.example`

Add a clarifying comment:
```
# Server-side only — set via `supabase secrets set`, NOT used by Vite
OPENROUTER_API_KEY=your_openrouter_api_key
```

### Task 7: Update documentation

Update these docs to reflect all changes:

**`docs/outreach.md`:**
- Update "Tab: Campaigns → AI Mode" section:
  - Note `CampaignAIChat` now calls a Supabase Edge Function which proxies to DeepSeek V3.2 via OpenRouter
  - The LLM parses prompts semantically, generates contextual email copy, and selects matching leads
  - Follow-up messages work via conversation history sent to the LLM
  - Replace description of `parsePrompt()` keyword matching with description of the real LLM flow
- Update "Known Limitations":
  - Remove: "Campaign AI is keyword matching, not LLM-powered" / "AI campaign chat is simple keyword extraction, not LLM-powered"
  - Add: "Campaign AI depends on external LLM service (OpenRouter) — requires internet connectivity and valid API key"
- Add changelog entry: `| 2026-03-23 | Campaign AI wired to real LLM (DeepSeek V3.2 via OpenRouter Edge Function) | CampaignAIChat.tsx, campaign-ai.ts |`

**`docs/architecture.md`:**
- Add to Tech Stack table: `| Edge Functions | Supabase (Deno) | Managed |`
- Add `supabase/functions/` to Project Structure section
- Add to provider hierarchy notes: Edge Functions as server-side compute layer
- Add changelog entry: `| 2026-03-23 | Added Supabase Edge Functions (campaign-ai) | supabase/functions/ |`

**`docs/schema.md`:**
- Add new section: "## Edge Functions" with table:
  - `campaign-ai` — Proxies to OpenRouter/DeepSeek V3.2 for campaign copy generation. Accepts lead summaries + prompt, returns structured campaign config.
- Add changelog entry: `| 2026-03-23 | Added Edge Functions section documenting campaign-ai | — |`

**`docs/OVERVIEW.md`:**
- Add to Major Changes Log: `| 2026-03-23 | Campaign AI wired to real LLM via Supabase Edge Function | Outreach | CampaignAIChat calls DeepSeek V3.2 via OpenRouter, replaces keyword matching |`
- Update Feature Index row for "Outreach & Email" — status from "Partial" to "Partial" (still no real email send/receive, but AI is now real)
- Update File-to-Documentation Map: add `src/lib/api/campaign-ai.ts` → `outreach.md`

---

## Validation Gates

1. `npm run build` passes with zero TypeScript errors
2. Edge Function deploys successfully via `npx supabase functions deploy`
3. Smoke test via `curl` returns valid JSON with expected fields
4. Login → navigate to Outreach → Campaigns tab → AI mode
5. Type "Send a cold outreach email to all SaaS leads about our API integration platform"
6. AI responds with a meaningful explanation (not the old template text)
7. Compose card fills with contextual subject + body containing `{{firstName}}` and `{{company}}`
8. Selected recipients match the prompt criteria (cold status, SaaS industry)
9. Type a follow-up: "make it shorter and more casual" → AI adjusts the copy
10. Type "also include warm leads" → AI expands the recipient list
11. Error handling: temporarily break the API key → AI shows error message in chat, doesn't crash

---

## Deprecated Code (to remove)

| Code | File | Reason |
|------|------|--------|
| `parsePrompt()` function (lines 30-67) | `CampaignAIChat.tsx` | Replaced by LLM call via Edge Function |
| `buildAssistantMessage()` function (lines 69-89) | `CampaignAIChat.tsx` | Replaced by LLM `explanation` field |
| `STATUS_KEYWORDS` constant (line 28) | `CampaignAIChat.tsx` | Only used by parsePrompt |
| `AIResult` interface (lines 14-20) | `CampaignAIChat.tsx` | Replaced by shared `CampaignAIResponse` from `campaign-ai.ts` |
| `import type { LeadStatus } from '@/types/crm'` (line 6) | `CampaignAIChat.tsx` | Only used by STATUS_KEYWORDS |

---

## System Prompt Design (for the Edge Function)

The `buildSystemPrompt(leads, industries)` function constructs this prompt:

```
You are an AI campaign assistant for IntegrateAPI, a sales CRM. Your job is to help users create email campaigns by:

1. Understanding their campaign intent from natural language
2. Selecting the right leads from their CRM based on filters (status, industry, location, job title, etc.)
3. Generating a professional email subject and body

AVAILABLE LEADS:
| ID | Name | Company | Industry | Status | Title | Location |
[rows from leads array — one per lead]

AVAILABLE FILTERS:
- Status: cold, lukewarm, warm, dead
- Industries: [comma-separated list]

MERGE FIELDS (use these in the email subject and body — they get replaced per-recipient):
- {{firstName}} — recipient's first name
- {{company}} — recipient's company name

RULES:
- matchedLeadIds: Return an array of lead IDs from the table above that match the user's criteria. If the user wants ALL leads or doesn't specify filters, return an EMPTY array [] (the frontend interprets [] as "select all").
- subject: Concise (under 80 chars), professional. Include {{firstName}} when appropriate.
- body: 3-5 sentences, professional but conversational. Always include {{firstName}} and {{company}}.
- statusFilter: The status you filtered by. Empty string "" if no status filter.
- industryFilter: The industry you filtered by. Empty string "" if no industry filter.
- explanation: 1-2 sentences describing what you did, e.g. "Selected 12 cold SaaS leads and drafted an outreach email about your API integration platform."
- For follow-up messages (e.g. "make it shorter", "add warm leads too"), adjust your previous response based on the conversation history.
- Never invent lead IDs — only use IDs from the AVAILABLE LEADS table.
```
