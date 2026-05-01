# Brief: Apollo.io Integration — Lead Generator

## Why
The Lead Generator page currently returns 5 hardcoded fake leads regardless of user input. We need to wire it to Apollo.io's real People Search + Enrichment APIs so users can discover and import real contacts with verified contact information.

## Context
- Lead Generator page: `src/pages/LeadGeneratorPage.tsx` — chat UI with `fakeGeneratedLeads()` function
- Apollo API key in `.env` as `APOLLO_API_KEY`
- OpenRouter API key in `.env` as `OPENROUTER_API_KEY`
- Apollo MCP connected (9 tools available for dev-time testing)
- Import flow already works: `addLeads()` persists to Supabase via React Query hook
- `handleImport` already strips `id`/`createdAt` before insert
- Supabase Edge Functions used for server-side API calls (keeps keys secure)

## Decisions
- **LLM for prompt parsing: `qwen/qwen3.5-flash-02-23`** via OpenRouter — cheapest capable Chinese model with confirmed JSON structured output ($0.065/$0.26 per million tokens, ~$0.00002/query). Fallback to `deepseek/deepseek-chat-v3-0324` on JSON parse failure.
- **Auto-enrichment on search** — every search result is bulk-enriched before display. Users only see leads with verified contact info.
- **2x over-fetch** — if user wants 25, search for 50, enrich, filter by contact info, return top 25. Ensures enough quality leads after filtering.
- **Contact info priority** — Score 2: both email+phone. Score 1: email or phone. Score 0: discard entirely. Sort by score, return requested count.
- **User-specified result count** — dropdown in UI (10, 25, 50, 100). Maps to Apollo's `per_page` parameter (doubled for over-fetch).
- **No Claude/Anthropic API** — only Chinese models via OpenRouter as instructed.

## Circuit Breakers (5 layers)
1. **LLM layer:** Qwen → DeepSeek fallback → error (no Apollo credits burned if parsing fails). 10s timeout.
2. **Apollo Search:** Hard cap 100 results per search. 429 → error, no enrichment. 0 results → "no matches", no enrichment.
3. **Apollo Enrichment:** Max 50 enrichments per batch. Only enrich people with name+company. Partial failure → return successes only.
4. **User-facing:** Result count capped at 100. Rate limit 10 searches/user/minute.
5. **Global kill switch:** `APOLLO_ENRICHMENT_ENABLED` env var. Monthly credit tracking table in Supabase — configurable threshold.

## Rejected Alternatives
- **Simple keyword extraction** — user specifically requested smart NLP that understands natural language
- **Claude/Anthropic API** — user specified Chinese models only via OpenRouter
- **Client-side Apollo calls** — would expose API key in browser bundle
- **No enrichment** — user wants auto-enrichment with contact info validation
- **DeepSeek as primary** — 3x more expensive than Qwen for the same task quality

## Direction
Build a Supabase Edge Function that: (1) sends user prompt to Qwen3.5-Flash via OpenRouter for structured filter extraction, (2) calls Apollo People Search with those filters (2x over-fetch), (3) bulk enriches results to get verified emails/phones, (4) filters and scores by contact info availability, (5) returns clean leads to the frontend. Update LeadGeneratorPage with result count selector, contact info columns, and credit usage display. Add circuit breakers at every layer.
