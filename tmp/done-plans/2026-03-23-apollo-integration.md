# Plan: Apollo.io Integration — Lead Generator

**Confidence: 8/10** — Clear API specs, well-defined pipeline. Main risk: Supabase Edge Function secrets setup is a manual step.

## Files Being Changed

```
supabase/
└── functions/
    └── apollo-search/
        └── index.ts                    ← NEW (Edge Function: LLM parse → search → enrich → filter)
src/
├── pages/
│   └── LeadGeneratorPage.tsx           ← MODIFIED (real API call, result count selector, confirmation dialog, enriched table)
├── lib/api/
│   └── apollo.ts                       ← NEW (frontend helper to invoke the Edge Function)
docs/
├── lead-generator.md                   ← MODIFIED (document Apollo integration)
├── OVERVIEW.md                         ← MODIFIED (changelog, status update)
└── schema.md                           ← MODIFIED (apollo_usage table)
```

**Manual Step Required:** Set Supabase project secrets (`APOLLO_API_KEY`, `OPENROUTER_API_KEY`) in Dashboard → Project Settings → Edge Functions → Secrets.

---

## Architecture Overview

```
User types prompt + selects result count (max 50)
    ↓
Confirmation dialog: "This will use ~50 Apollo credits. Proceed?"
    ↓ (user confirms)
Frontend calls: supabase.functions.invoke('apollo-search', { body: { prompt, perPage } })
    ↓
┌─ Supabase Edge Function: apollo-search ──────────────────────┐
│                                                                │
│  0. AUTHENTICATION                                            │
│     → verify_jwt: true (Supabase validates JWT automatically) │
│     → Extract user ID from JWT, not from request body         │
│                                                                │
│  1. KILL SWITCH                                               │
│     → Check Deno.env.get("APOLLO_ENRICHMENT_ENABLED")         │
│     → If "false" → return error, don't proceed                │
│                                                                │
│  2. PER-USER RATE LIMIT                                       │
│     → Count rows in apollo_usage for this user in last minute │
│     → If >= 10 → return error                                 │
│                                                                │
│  3. HOURLY CIRCUIT BREAKER                                    │
│     → SUM(credits_used) from apollo_usage in last hour        │
│     → If >= 200 → return error, don't proceed                 │
│                                                                │
│  4. LLM PARSE (OpenRouter → Qwen3.5-Flash)                   │
│     → Send prompt to Qwen with system prompt                  │
│     → Get back structured Apollo filters as JSON              │
│     → If JSON invalid → retry with DeepSeek fallback          │
│     → If both fail → return error (0 Apollo credits burned)   │
│     → 10 second timeout per model                             │
│                                                                │
│  5. APOLLO SEARCH (free, no credits)                          │
│     → POST /v1/mixed_people/search                            │
│     → Request 2x results (user wants 25 → fetch 50)          │
│     → Hard cap: never more than 100                           │
│     → Returns people WITH Apollo IDs, WITHOUT contact info    │
│     → If 0 results → return "no matches" (no enrichment)     │
│     → If 429 → return rate limit error                        │
│                                                                │
│  6. APOLLO ENRICHMENT (costs credits)                         │
│     → POST /v1/people/bulk_match (batches of 10)             │
│     → Pass Apollo person IDs for deterministic matching       │
│     → reveal_personal_emails: false                           │
│     → reveal_phone_number: false (phones are async/webhook)   │
│     → Emails come back synchronously                          │
│     → phone_numbers[] may have data from prior enrichments    │
│     → Track credits_consumed from each batch response         │
│     → If batch 429s → stop, return what we have               │
│     → If batch errors → skip, continue to next batch          │
│     → Max 50 enrichments per request (hard cap)               │
│                                                                │
│  7. SCORE & FILTER                                            │
│     → Score 2: has verified email AND phone                   │
│     → Score 1: has verified email OR phone                    │
│     → Score 0: neither → discard                              │
│     → Sort by score desc, take requested count                │
│                                                                │
│  8. LOG USAGE                                                  │
│     → Insert row into apollo_usage (using service role)       │
│     → user_id from JWT, credits from enrichment response      │
│                                                                │
│  9. RETURN                                                     │
│     → { leads[], totalFound, creditsUsed, filtersUsed }       │
│                                                                │
└────────────────────────────────────────────────────────────────┘
    ↓
Frontend displays enriched leads in table (name, title, company, location, email, phone)
    ↓
User clicks "Import X as Cold Leads" → addLeads() → persists to Supabase
```

---

## Key Pseudocode

### Edge Function: `apollo-search/index.ts`

```typescript
/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />
import { createClient } from "jsr:@supabase/supabase-js@2";

const APOLLO_API_KEY = Deno.env.get("APOLLO_API_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HOURLY_CREDIT_CAP = 200;
const PER_USER_PER_MINUTE_CAP = 10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, message: string) {
  return jsonResponse({ error: message }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // --- AUTH: Extract user ID from JWT (not from request body) ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse(401, "Missing authorization");
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: authUser }, error: authError } = await createClient(
      SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!
    ).auth.getUser(token);
    if (authError || !authUser) return errorResponse(401, "Invalid token");
    const userId = authUser.id;

    const { prompt, perPage = 25 } = await req.json();
    const cappedPerPage = Math.min(perPage, 50); // Max 50 requested results

    // --- KILL SWITCH ---
    if (Deno.env.get("APOLLO_ENRICHMENT_ENABLED") === "false") {
      return errorResponse(503, "Apollo enrichment is temporarily disabled.");
    }

    // --- PER-USER RATE LIMIT: max 10 searches per user per minute ---
    const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
    const { count: userMinuteCount } = await supabase
      .from("apollo_usage")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", oneMinuteAgo);
    if ((userMinuteCount ?? 0) >= PER_USER_PER_MINUTE_CAP) {
      return errorResponse(429, "Too many searches. Please wait a minute.");
    }

    // --- HOURLY CIRCUIT BREAKER: sum credits_used in last hour ---
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { data: usageData } = await supabase
      .from("apollo_usage")
      .select("credits_used")
      .gte("created_at", oneHourAgo);
    const hourlyCredits = (usageData || []).reduce(
      (sum: number, row: { credits_used: number }) => sum + row.credits_used, 0
    );
    if (hourlyCredits >= HOURLY_CREDIT_CAP) {
      return errorResponse(429, "Hourly enrichment credit limit reached. Try again later.");
    }

    // --- STEP 1: LLM Parse prompt → structured filters ---
    let filters;
    try {
      filters = await parsePromptWithLLM(prompt);
    } catch {
      return errorResponse(422, "Could not understand your search criteria. Try rephrasing.");
    }

    // --- STEP 2: Apollo Search (free, no credits) ---
    const fetchCount = Math.min(cappedPerPage * 2, 100);
    let searchResults;
    try {
      searchResults = await apolloSearch(filters, fetchCount);
    } catch (e) {
      return errorResponse(502, `Apollo search failed: ${e.message}`);
    }

    if (searchResults.people.length === 0) {
      return jsonResponse({ leads: [], totalFound: 0, creditsUsed: 0, filtersUsed: filters });
    }

    // --- STEP 3: Bulk Enrich (costs credits) ---
    const enriched = await bulkEnrich(searchResults.people);

    // --- STEP 4: Score & Filter by contact info ---
    const scored = enriched.matches
      .map((person: ApolloPerson) => ({
        ...mapToLead(person),
        _score: contactScore(person),
      }))
      .filter((p: { _score: number }) => p._score > 0)
      .sort((a: { _score: number }, b: { _score: number }) => b._score - a._score)
      .slice(0, cappedPerPage);

    const leads = scored.map(({ _score, ...lead }: { _score: number;[key: string]: unknown }) => lead);

    // --- STEP 5: Log usage (service role bypasses RLS) ---
    await supabase.from("apollo_usage").insert({
      user_id: userId,
      action: "search_and_enrich",
      credits_used: enriched.creditsConsumed,
      search_count: searchResults.people.length,
      enrichment_count: enriched.matches.length,
      results_returned: leads.length,
      prompt,
    });

    return jsonResponse({
      leads,
      totalFound: searchResults.pagination.total_entries,
      creditsUsed: enriched.creditsConsumed,
      filtersUsed: filters,
    });
  } catch (e) {
    return errorResponse(500, `Unexpected error: ${e.message}`);
  }
});
```

### LLM Prompt Parsing

```typescript
const SYSTEM_PROMPT = `You extract structured search filters from natural language descriptions of ideal customer profiles.
Return ONLY a valid JSON object with these optional fields:
- person_titles: string[] (job titles like "CTO", "VP of Sales")
- person_seniorities: string[] (values: "owner", "founder", "c_suite", "vp", "director", "manager", "senior", "entry")
- person_locations: string[] (cities/states like "Austin, TX", "New York, NY")
- q_organization_keyword_tags: string[] (industry keywords like "saas", "fintech", "healthcare")
- organization_num_employees_ranges: string[] (ranges like "1,10", "11,50", "51,200", "201,500", "501,1000")
- q_keywords: string (general keywords not fitting above categories)
Only include fields clearly implied by the user's description. Omit fields with no data.`;

async function parsePromptWithLLM(prompt: string): Promise<Record<string, unknown>> {
  const models = ["qwen/qwen3.5-flash-02-23", "deepseek/deepseek-chat-v3-0324"];

  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          temperature: 0,
          max_tokens: 300,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty LLM response");
      return JSON.parse(content);
    } catch (e) {
      clearTimeout(timeout);
      if (model === models[models.length - 1]) throw e;
    }
  }
  throw new Error("All LLM models failed");
}
```

### Apollo Search

```typescript
async function apolloSearch(filters: Record<string, unknown>, perPage: number) {
  const res = await fetch("https://api.apollo.io/v1/mixed_people/search", {
    method: "POST",
    headers: {
      "x-api-key": APOLLO_API_KEY,
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify({ ...filters, per_page: perPage, page: 1 }),
  });

  if (res.status === 429) throw new Error("Apollo rate limit hit. Please try again in a few minutes.");
  if (!res.ok) throw new Error(`Apollo search returned ${res.status}`);
  return await res.json();
}
```

### Bulk Enrichment (batches of 10)

```typescript
function chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
}

async function bulkEnrich(people: ApolloPerson[]) {
  const capped = people.slice(0, 50); // Hard cap: max 50 enrichments
  const batches = chunk(capped, 10);
  let allMatches: ApolloPerson[] = [];
  let totalCredits = 0;

  for (const batch of batches) {
    const res = await fetch("https://api.apollo.io/v1/people/bulk_match", {
      method: "POST",
      headers: {
        "x-api-key": APOLLO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        details: batch.map(p => ({
          id: p.id,
          first_name: p.first_name,
          last_name: p.last_name,
          domain: p.organization?.primary_domain,
        })),
        reveal_personal_emails: false,
        reveal_phone_number: false,
      }),
    });

    if (res.status === 429) break; // Stop enriching, return what we have
    if (!res.ok) continue; // Skip failed batch, try next

    const data = await res.json();
    allMatches = [...allMatches, ...(data.matches || [])];
    totalCredits += data.credits_consumed || 0;
  }

  return { matches: allMatches, creditsConsumed: totalCredits };
}
```

### Contact Score & Lead Mapping

```typescript
interface ApolloPerson {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  email: string | null;
  email_status: string | null;
  city: string;
  state: string;
  country: string;
  linkedin_url: string | null;
  phone_numbers: Array<{ sanitized_number?: string; raw_number?: string }>;
  organization: {
    name: string;
    primary_domain: string;
    industry: string;
    estimated_num_employees: number;
    website_url: string;
  };
}

function contactScore(person: ApolloPerson): number {
  const hasEmail = !!person.email && person.email_status === "verified";
  const hasPhone = (person.phone_numbers?.length ?? 0) > 0 &&
    !!person.phone_numbers?.[0]?.sanitized_number;
  if (hasEmail && hasPhone) return 2;
  if (hasEmail || hasPhone) return 1;
  return 0;
}

// Returns a complete lead object (not Partial) with safe defaults for all required fields
function mapToLead(person: ApolloPerson) {
  const emp = person.organization;
  const empCount = emp?.estimated_num_employees;
  let companySize = "";
  if (empCount) {
    if (empCount <= 10) companySize = "1-10";
    else if (empCount <= 50) companySize = "11-50";
    else if (empCount <= 200) companySize = "51-200";
    else if (empCount <= 500) companySize = "201-500";
    else if (empCount <= 1000) companySize = "501-1000";
    else if (empCount <= 5000) companySize = "1001-5000";
    else companySize = "5001-10000";
  }

  return {
    id: `apollo-${person.id}`, // Display key only — stripped before DB insert
    firstName: person.first_name || "",
    lastName: person.last_name || "",
    email: person.email || "",
    phone: person.phone_numbers?.[0]?.sanitized_number || "",
    jobTitle: person.title || "",
    company: emp?.name || "",
    companySize,
    industry: emp?.industry || "",
    location: [person.city, person.state].filter(Boolean).join(", "),
    status: "cold" as const,
    assignedTo: "",
    createdAt: new Date().toISOString(),
    lastContactedAt: null,
    notes: "",
    tags: ["apollo", "generated"],
    linkedinUrl: person.linkedin_url || undefined,
  };
}
```

### Frontend: `src/lib/api/apollo.ts`

```typescript
import { supabase } from "@/lib/supabase";
import type { Lead } from "@/types/crm";

export interface ApolloSearchResult {
  leads: Lead[];
  totalFound: number;
  creditsUsed: number;
  filtersUsed: Record<string, unknown>;
  error?: string;
}

export async function searchApollo(
  prompt: string,
  perPage: number
): Promise<ApolloSearchResult> {
  const { data, error } = await supabase.functions.invoke("apollo-search", {
    body: { prompt, perPage },
  });
  if (error) throw new Error(error.message || "Search failed");
  if (data.error) throw new Error(data.error);
  return data;
}
```

### Frontend: Confirmation Dialog & Result Count

```tsx
// State
const [selectedCount, setSelectedCount] = useState(25);
const [showConfirm, setShowConfirm] = useState(false);
const [pendingPrompt, setPendingPrompt] = useState("");

// When user submits: show confirm dialog instead of searching immediately
const handleSend = () => {
  if (!input.trim() || loading) return;
  setPendingPrompt(input.trim());
  setShowConfirm(true);
};

// After user confirms dialog
const executeSearch = async () => {
  setShowConfirm(false);
  const userMsg = { role: "user", content: pendingPrompt };
  setMessages(prev => [...prev, userMsg]);
  setInput("");
  setLoading(true);

  try {
    const result = await searchApollo(pendingPrompt, selectedCount);
    const botMsg = {
      role: "bot",
      content: result.leads.length > 0
        ? `Found ${result.totalFound.toLocaleString()} total matches. Showing ${result.leads.length} enriched contacts (${result.creditsUsed} credits used).`
        : "No matching contacts found. Try broadening your search criteria.",
      leads: result.leads.length > 0 ? result.leads : undefined,
    };
    setMessages(prev => [...prev, botMsg]);
  } catch (e) {
    setMessages(prev => [...prev, { role: "bot", content: `Error: ${e.message}` }]);
  } finally {
    setLoading(false);
  }
};

// Result count selector in the input bar
<Select value={String(selectedCount)} onValueChange={v => setSelectedCount(Number(v))}>
  <SelectTrigger className="w-[80px]">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="10">10</SelectItem>
    <SelectItem value="25">25</SelectItem>
    <SelectItem value="50">50</SelectItem>
  </SelectContent>
</Select>

// Confirmation dialog (using shadcn AlertDialog)
const estimatedCredits = Math.min(selectedCount * 2, 100);

<AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Search Apollo.io</AlertDialogTitle>
      <AlertDialogDescription>
        This will search for ~{selectedCount} leads and enrich up to {estimatedCredits} contacts
        to find verified contact information. Approximately {estimatedCredits} Apollo credits will be used.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={executeSearch}>Search</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>

// Updated results table columns
<TableHead className="text-xs">Name</TableHead>
<TableHead className="text-xs">Title</TableHead>
<TableHead className="text-xs">Company</TableHead>
<TableHead className="text-xs">Email</TableHead>
<TableHead className="text-xs">Phone</TableHead>
<TableHead className="text-xs">Location</TableHead>
```

---

## Task Execution Order

### Task 1: Create `apollo_usage` table in Supabase

Migration via MCP:
```sql
create table public.apollo_usage (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id),
  action text not null,
  credits_used integer not null default 0,
  search_count integer not null default 0,
  enrichment_count integer not null default 0,
  results_returned integer not null default 0,
  prompt text,
  created_at timestamptz not null default now()
);

create index idx_apollo_usage_created_at on public.apollo_usage(created_at);
create index idx_apollo_usage_user_created on public.apollo_usage(user_id, created_at);

alter table public.apollo_usage enable row level security;
create policy "apollo_usage_insert" on public.apollo_usage
  for insert with check (auth.uid() = user_id);
create policy "apollo_usage_select" on public.apollo_usage
  for select using (public.is_admin() or user_id = auth.uid());
```

### Task 2: Set Supabase project secrets (MANUAL STEP)

User must set in Supabase Dashboard → Project Settings → Edge Functions → Secrets:
- `APOLLO_API_KEY` = `y2ivMf8grM5UMmiqimhwaA`
- `OPENROUTER_API_KEY` = the OpenRouter key from .env
- `APOLLO_ENRICHMENT_ENABLED` = `true`

### Task 3: Deploy Edge Function `apollo-search`

Deploy via `mcp__supabase__deploy_edge_function` with `verify_jwt: true`.

Full function includes all pseudocode above:
- CORS headers (defined and applied to all responses)
- JWT user extraction (no userId in request body)
- Kill switch (`APOLLO_ENRICHMENT_ENABLED`)
- Per-user rate limit (10/minute)
- Hourly circuit breaker (SUM credits_used, cap 200)
- LLM parsing (Qwen primary, DeepSeek fallback, 10s timeout)
- Apollo search (`/v1/mixed_people/search`, NOT `/api/v1/`)
- Bulk enrichment (`/v1/people/bulk_match`, batches of 10, max 50)
- Contact scoring and filtering
- Usage logging (service role insert)

### Task 4: Create `src/lib/api/apollo.ts`

Frontend helper — does NOT pass userId (Edge Function gets it from JWT).

### Task 5: Rewrite `LeadGeneratorPage.tsx`

- Remove `fakeGeneratedLeads` and `setTimeout`
- Add `selectedCount` state with dropdown (10/25/50 — capped at 50)
- Add confirmation dialog (AlertDialog) with estimated credit usage
- Async `executeSearch` calls `searchApollo()`
- Updated table: Email + Phone columns
- Contact quality badge per lead (both/email-only/phone-only)
- Credits used + total found in bot message content (embedded in string)
- Error messages displayed as bot chat messages
- Import flow unchanged (handleImport already strips id/createdAt)

### Task 6: Update docs

- `docs/lead-generator.md` — full rewrite for Apollo integration
- `docs/OVERVIEW.md` — changelog, Lead Generator status Mock → Active
- `docs/schema.md` — add apollo_usage table

---

## Validation Gates

1. `npm run build` passes
2. Edge Function deploys successfully
3. Type "CTOs at SaaS companies in Austin" → returns real people from Apollo
4. Results show verified emails and/or phone numbers
5. Leads with no contact info are filtered out
6. Confirmation dialog appears before each search
7. Credits used count is displayed in response
8. Hourly circuit breaker: after 200 credits in an hour, returns error
9. Per-user rate limit: 10+ searches in a minute returns error
10. Kill switch: set `APOLLO_ENRICHMENT_ENABLED=false` → returns 503
11. Import works: click import → leads appear in Leads page
12. LLM fallback: if Qwen fails, DeepSeek handles parsing
13. Apollo 429 → user-friendly error, partial results returned if mid-enrichment

---

## Deprecated Code (to remove)

| Code | Location | Reason |
|------|----------|--------|
| `fakeGeneratedLeads()` function | `LeadGeneratorPage.tsx:18-27` | Replaced by real Apollo API |
| `setTimeout(() => { ... }, 1500)` | `LeadGeneratorPage.tsx:46-55` | Replaced by async Edge Function call |

---

## Known Limitations

**Phone numbers:** Apollo's phone reveal is async (webhook). For v1, we don't use `reveal_phone_number: true`. We still check `phone_numbers[]` in enrichment responses — some people have phone data from prior enrichments. Score based on what's available.

**429 mid-enrichment:** If Apollo rate-limits mid-batch, credits for that batch may have been consumed but aren't reflected in our `credits_consumed` counter. This is a known gap — we stop enriching and return what succeeded.

**Result count:** Capped at 50 (2x over-fetch = 100, which is Apollo's per-page max). Selecting 50 may return fewer after contact-quality filtering.
