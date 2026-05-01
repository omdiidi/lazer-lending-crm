# Plan: Apollo Search Edge Function + Email Status + Profile Sending Email

**Confidence: 9/10** — Large scope (1 Edge Function, 2 DB migrations, type updates, settings page edit, campaign filter logic) but each piece is well-defined. The Edge Function is the most complex part — it chains LLM + Apollo Search + Apollo Enrichment + ZeroBounce in one request.

## Goal

Complete the Apollo integration by building the missing `apollo-search` Edge Function, add `email_status` to leads for bounce protection, add `sending_email` to profiles so users can set their CRM sending address, and make the Settings profile card editable.

## Why

- The Lead Generator page is fully built (UI + client API) but **doesn't work** because the `apollo-search` Edge Function doesn't exist
- `email_status` on leads is needed to filter sends — Apollo provides this data but the schema doesn't capture it yet
- `sending_email` on profiles is needed as the "from" address when the Resend email integration is built
- Profile editing is currently a placeholder (read-only fields) — making it editable completes a basic feature and lets users set their sending email

## What

### User-Visible Behavior

1. **Lead Generator works end-to-end:** User types a prompt → gets real leads from Apollo with verified contact info → imports them into CRM
2. **Settings page is editable:** Users can update their name and set their CRM sending email address (e.g., `sarah@mail.integrateapi.ai`)
3. **Imported leads show email verification status** — the `contactBadge` in the Lead Generator table already indicates contact quality; the data is now real
4. **Campaigns auto-filter invalid emails** — leads with `email_status` of `guessed`, `unverified`, or `invalid` are excluded from campaign recipient selection

### Success Criteria

- [ ] Lead Generator: search returns real Apollo results
- [ ] Lead Generator: enrichment provides verified emails + phones
- [ ] Lead Generator: ZeroBounce validates emails before returning to frontend
- [ ] Lead Generator: imported leads have `email_status` populated
- [ ] Lead Generator: credit usage logged to `apollo_usage` table
- [ ] Settings: profile name and sending email are editable with save button
- [ ] Campaigns: recipient selection filters out leads with non-verified emails
- [ ] `npm run build` passes with zero errors
- [ ] All changes documented in relevant `.md` files

---

## Files Being Changed

```
supabase/
├── functions/
│   └── apollo-search/
│       └── index.ts                        ← NEW (Edge Function — LLM + Apollo + ZeroBounce pipeline)
src/
├── types/
│   ├── crm.ts                              ← MODIFIED (add emailStatus to Lead, sendingEmail to User)
│   └── database.ts                         ← MODIFIED (add email_status to leads, sending_email to profiles)
├── lib/
│   └── api/
│       └── profiles.ts                     ← MODIFIED (add updateProfile with sendingEmail support)
├── hooks/
│   └── use-profiles.ts                     ← MODIFIED (add updateProfile mutation)
├── contexts/
│   └── AuthContext.tsx                     ← MODIFIED (add refreshUser function + update AuthContextType)
├── pages/
│   ├── SettingsPage.tsx                     ← MODIFIED (editable profile + sending email field + call refreshUser)
│   └── OutreachPage.tsx                    ← MODIFIED (emailSafeLeads filter on campaigns, AI mode, AND compose tab)
docs/
├── OVERVIEW.md                             ← MODIFIED (major changes log)
├── lead-generator.md                       ← MODIFIED (changelog)
├── settings.md                             ← MODIFIED (full rewrite: profile editing, sending email, status change)
├── schema.md                               ← MODIFIED (email_status column, sending_email column, apollo_usage table)
├── state-management.md                     ← MODIFIED (useProfiles mutation + AuthContext refreshUser)
├── data-model.md                           ← MODIFIED (Lead + User type updates)
├── outreach.md                             ← MODIFIED (email_status campaign filter + changelog)
├── authentication.md                       ← MODIFIED (refreshUser function + changelog)
```

---

## Architecture Overview

### Apollo Search Pipeline (Edge Function)

```
User prompt ("CTOs at SaaS companies, 50-200 employees, Austin")
  │
  ▼
Step 1: LLM Parsing (DeepSeek V3.2 via OpenRouter)
  → Extracts structured filters: { person_titles, person_locations,
    organization_num_employees_ranges, q_keywords, person_seniorities }
  │
  ▼
Step 2: Apollo People Search (0 credits)
  POST /v1/mixed_people/api_search
  → Returns up to perPage person stubs (no emails/phones)
  → Get Apollo person IDs
  │
  ▼
Step 3: Apollo Bulk Enrichment (1 credit per person, batches of 10)
  POST /v1/people/bulk_match
  → Returns email, email_status, phone_numbers, organization details
  → Batch IDs in groups of 10 (API limit)
  │
  ▼
Step 4: ZeroBounce Validation (emails only)
  GET /v2/validate?email=...&api_key=...
  → For each lead with email_status === 'verified' or 'likely to engage'
  → If ZeroBounce says 'invalid', override email_status to 'invalid'
  │
  ▼
Step 5: Score + Transform
  → Score 0-100: verified email (+40), phone (+30), linkedin (+15), name (+15)
  → Map Apollo person objects to CRM Lead format
  → Sort by score descending
  │
  ▼
Step 6: Log Usage
  → Insert into apollo_usage table
  │
  ▼
Return to frontend: { leads, totalFound, creditsUsed, filtersUsed }
```

### DB Migrations Needed

```sql
-- Migration 1: Add email_status to leads
ALTER TABLE leads ADD COLUMN email_status text NOT NULL DEFAULT 'unverified';

-- Migration 2: Add sending_email to profiles
ALTER TABLE profiles ADD COLUMN sending_email text;

-- Migration 3: Create apollo_usage table (if not exists)
CREATE TABLE IF NOT EXISTS apollo_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  action text NOT NULL,
  credits_used integer NOT NULL DEFAULT 0,
  search_count integer NOT NULL DEFAULT 0,
  enrichment_count integer NOT NULL DEFAULT 0,
  results_returned integer NOT NULL DEFAULT 0,
  prompt text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS for apollo_usage (idempotent — safe to re-run)
ALTER TABLE apollo_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can insert own usage" ON apollo_usage;
CREATE POLICY "Users can insert own usage" ON apollo_usage FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Users can read own usage" ON apollo_usage;
CREATE POLICY "Users can read own usage" ON apollo_usage FOR SELECT USING (user_id = auth.uid() OR is_admin());
```

---

## All Needed Context

### Documentation & References

```yaml
- url: https://docs.apollo.io/reference/people-api-search
  why: People Search endpoint — request filters, response schema, 0 credits

- url: https://docs.apollo.io/reference/bulk-people-enrichment
  why: Bulk enrichment — max 10 per batch, 1 credit each, returns email/phone/email_status

- url: https://docs.apollo.io/reference/authentication
  why: Auth via X-Api-Key header

- url: https://www.zerobounce.net/docs/email-validation-api-quickstart/
  why: Single email validation API — GET request with api_key and email params

- file: supabase/functions/campaign-ai/index.ts
  why: Reference pattern for Edge Functions (CORS, error handling, OpenRouter call)

- file: src/lib/api/leads.ts
  why: Pattern for Supabase queries, transforms, createLeads function

- file: src/lib/api/profiles.ts
  why: Current updateProfile — needs sendingEmail support

- file: src/pages/SettingsPage.tsx
  why: Currently read-only profile — needs editing

- file: src/pages/OutreachPage.tsx
  why: Campaign recipient selection — needs email_status filter
```

### Known Gotchas

```
1. Apollo Search returns NO emails or phones — only person stubs with IDs.
   You MUST call bulk_match to get contact info. This is a two-step process.

2. Apollo bulk_match has a MAX BATCH SIZE of 10. For 50 leads, you need 5 batch
   calls. Add a small delay between batches to avoid 429s.

3. Apollo authentication uses X-Api-Key header (NOT Authorization: Bearer).

4. Apollo search endpoint is /v1/mixed_people/api_search (NOT /v1/mixed_people/search).
   The docs reference both but api_search is the correct one.

5. ZeroBounce single validation is a GET request:
   GET https://api.zerobounce.net/v2/validate?api_key=KEY&email=EMAIL
   Response has a "status" field: "valid", "invalid", "catch-all", "unknown", etc.

6. The Edge Function needs BOTH APOLLO_API_KEY and ZEROBOUNCE_API_KEY as secrets.
   Also needs OPENROUTER_API_KEY for the LLM parsing step.

7. Edge Function needs to create a Supabase client with the service role key
   to insert into apollo_usage (bypasses RLS). Use:
   Deno.env.get('SUPABASE_URL') and Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
   These are automatically available to all Supabase Edge Functions.

8. The LLM for prompt parsing should use a fast, cheap model. The docs mention
   Qwen 3.5 Flash but DeepSeek V3.2 (already configured) works fine. Use the
   same model to keep it simple — one fewer secret to manage.

9. profiles.sending_email should allow NULL (not set yet). The RLS update_own
   policy has a WITH CHECK that prevents role changes — make sure sending_email
   is allowed in that policy.

10. Campaign recipient filtering: In OutreachPage.tsx, filter leads BEFORE
    passing to both the manual recipient table AND the CampaignAIChat component.
    Create an `emailSafeLeads` variable and use it everywhere leads are used
    for sending. Include null/undefined emailStatus for legacy leads.

11. Apollo returns email_status as 'likely to engage' (with space). Normalize
    to 'likely_to_engage' (with underscore) in the Edge Function before returning.
    This must be consistent everywhere: DB, TypeScript types, and filter logic.

12. After profile save in Settings, call refreshUser() from AuthContext to
    update the user object in state. Otherwise the header shows stale name.

13. updateProfile in profiles.ts uses manual field mapping (not toSnakeCase).
    Map sendingEmail → sending_email explicitly to match the existing pattern.

14. refreshUser must be added to AuthContextType interface AND the Provider
    value prop. Use supabase.auth.getSession() to get the current user ID
    (not the stale user.id from component state) to avoid race conditions.

15. emailSafeLeads must be applied to THREE places in OutreachPage:
    a. Manual campaign recipient table (filteredLeads base)
    b. CampaignAIChat leads prop
    c. Compose tab lead search dropdown (filteredComposeLeads base)
    Also rebase the `industries` memo on emailSafeLeads so the industry
    dropdown doesn't show industries with zero sendable leads.

16. handleSendCampaign must filter selectedLeadIds against emailSafeLeads
    at send time — stale IDs from prior AI results could reference
    leads that are no longer in the safe set.

17. apollo_usage migrations: use DROP POLICY IF EXISTS before CREATE POLICY
    to make the migration idempotent. The table may already exist from
    a prior agent's work.

18. Verify the profiles_update_own RLS WITH CHECK clause does NOT block
    sending_email updates. The current policy only constrains the role
    column, so sending_email should be allowed. Confirm via Supabase MCP
    before running the migration.

19. settings.md needs a full rewrite of Profile Card section, Status field,
    Component Reference, and Data Dependencies — not just a changelog entry.
    The doc currently says "read-only" and "no mutations" throughout.

20. authentication.md needs a changelog entry for the new refreshUser function
    since AuthContext.tsx is mapped to both state-management.md AND
    authentication.md in the file-to-documentation map.

21. Unverified leads are intentionally blocked from campaigns. This is correct
    behavior — Apollo-imported leads have real email_status values, and
    manually-added leads default to 'unverified' until validated. The UI
    should show a note explaining why some leads are excluded.
```

---

## Key Pseudocode

### Edge Function (`supabase/functions/apollo-search/index.ts`)

```typescript
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const APOLLO_API_KEY = Deno.env.get('APOLLO_API_KEY')
    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')
    const ZEROBOUNCE_API_KEY = Deno.env.get('ZEROBOUNCE_API_KEY')
    // Guard all three keys

    const authHeader = req.headers.get('Authorization')!
    const { prompt, perPage } = await req.json()

    // Step 1: LLM parsing — extract Apollo filters from natural language
    const filters = await parsePromptWithLLM(prompt, OPENROUTER_API_KEY)
    // filters = { person_titles, person_locations, organization_num_employees_ranges,
    //             q_keywords, person_seniorities }

    // Step 2: Apollo People Search (0 credits)
    const searchRes = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
      method: 'POST',
      headers: { 'X-Api-Key': APOLLO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...filters,
        per_page: Math.min(perPage, 100),
        page: 1,
      }),
    })
    const searchData = await searchRes.json()
    const people = searchData.people || []
    const totalFound = searchData.pagination?.total_entries || 0

    // Step 3: Bulk enrichment in batches of 10 (1 credit each)
    const enriched = []
    const ids = people.map(p => ({ id: p.id }))
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10)
      const enrichRes = await fetch('https://api.apollo.io/api/v1/people/bulk_match', {
        method: 'POST',
        headers: { 'X-Api-Key': APOLLO_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ details: batch, reveal_personal_emails: false }),
      })
      if (!enrichRes.ok) {
        console.error('Apollo enrichment batch failed:', enrichRes.status)
        continue // Skip failed batch, don't crash the whole request
      }
      const enrichData = await enrichRes.json()
      enriched.push(...(enrichData.matches || []))
      // Small delay between batches to avoid 429s
      if (i + 10 < ids.length) await new Promise(r => setTimeout(r, 200))
    }

    // Step 3.5: Normalize Apollo email_status values (spaces → underscores)
    for (const person of enriched) {
      if (person.email_status === 'likely to engage') {
        person.email_status = 'likely_to_engage'
      }
    }

    // Step 4: ZeroBounce validation (concurrent, cap at 5 in-flight)
    // Only validate leads that Apollo says are verified/likely_to_engage
    const toValidate = enriched.filter(p =>
      p.email && ['verified', 'likely_to_engage'].includes(p.email_status)
    )
    // Run in batches of 5 concurrent requests to avoid timeout
    for (let i = 0; i < toValidate.length; i += 5) {
      const batch = toValidate.slice(i, i + 5)
      await Promise.all(batch.map(async (person) => {
        try {
          const zbRes = await fetch(
            `https://api.zerobounce.net/v2/validate?api_key=${ZEROBOUNCE_API_KEY}&email=${encodeURIComponent(person.email)}`
          )
          const zbData = await zbRes.json()
          if (zbData.status === 'invalid') {
            person.email_status = 'invalid'
          }
        } catch { /* ZeroBounce failure is non-fatal — keep Apollo's status */ }
      }))
    }

    // Step 5: Score and transform to Lead format
    const leads = enriched
      .filter(p => p.email) // Must have an email
      .map(person => ({
        firstName: person.first_name || '',
        lastName: person.last_name || '',
        email: person.email || '',
        emailStatus: person.email_status || 'unverified',
        phone: person.phone_numbers?.[0]?.sanitized_number || '',
        jobTitle: person.title || '',
        company: person.organization?.name || '',
        companySize: mapEmployeeCount(person.organization?.estimated_num_employees),
        industry: person.organization?.industry || '',
        location: [person.city, person.state, person.country].filter(Boolean).join(', '),
        status: 'cold',
        assignedTo: '',  // Set by frontend on import
        lastContactedAt: null,
        notes: `Generated from: "${prompt}"`,
        tags: ['apollo', 'generated'],
        linkedinUrl: person.linkedin_url || undefined,
      }))
      .map(lead => ({ ...lead, score: scoreLead(lead) }))
      .sort((a, b) => b.score - a.score)
      .map(({ score, ...lead }) => lead)

    // Step 6: Log usage
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    // Extract user ID from JWT
    const jwt = authHeader.replace('Bearer ', '')
    const { data: { user } } = await supabaseAdmin.auth.getUser(jwt)
    if (user) {
      await supabaseAdmin.from('apollo_usage').insert({
        user_id: user.id,
        action: 'search_and_enrich',
        credits_used: enriched.length,
        search_count: people.length,
        enrichment_count: enriched.length,
        results_returned: leads.length,
        prompt,
      })
    }

    return new Response(JSON.stringify({
      leads,
      totalFound,
      creditsUsed: enriched.length,
      filtersUsed: filters,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('apollo-search error:', err)
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
```

### LLM Prompt Parsing Function

```typescript
async function parsePromptWithLLM(prompt: string, apiKey: string) {
  // Use DeepSeek V3.2 with JSON schema enforcement
  // System prompt: "Extract Apollo.io search filters from this lead search description"
  // JSON schema for response:
  {
    person_titles: string[],       // e.g., ["CTO", "VP Engineering"]
    person_locations: string[],    // e.g., ["Austin, TX", "California, US"]
    organization_num_employees_ranges: string[], // e.g., ["51-200", "201-500"]
    q_keywords: string,            // free-text keywords
    person_seniorities: string[],  // e.g., ["c_suite", "vp", "director"]
  }
}
```

### Settings Page Profile Editing

```typescript
// Add state for editing
const [editName, setEditName] = useState(user?.name || '');
const [editSendingEmail, setEditSendingEmail] = useState(user?.sendingEmail || '');
const [saving, setSaving] = useState(false);

const handleSave = async () => {
  setSaving(true);
  await updateProfile(user!.id, { name: editName, sendingEmail: editSendingEmail });
  await refreshUser(); // Re-fetch profile so header updates immediately
  setSaving(false);
  toast({ title: 'Profile updated' });
};

// Fields become editable Input components with a Save button
```

### Campaign Email Status Filter (OutreachPage.tsx)

```typescript
// Filter leads for email-safe sending — used by campaigns, AI mode, AND compose
const emailSafeLeads = useMemo(() =>
  leads.filter(l =>
    l.emailStatus === 'verified' || l.emailStatus === 'likely_to_engage'
  ),
  [leads]
);

// Apply emailSafeLeads to:
// 1. filteredLeads base (manual campaign recipient table)
// 2. CampaignAIChat leads prop: <CampaignAIChat leads={emailSafeLeads} ... />
// 3. filteredComposeLeads base (compose tab lead search dropdown)
// 4. industries memo (rebase on emailSafeLeads so dropdown matches)

// Guard at send time in handleSendCampaign:
const safeIds = new Set(emailSafeLeads.map(l => l.id));
const recipientIds = Array.from(selectedLeadIds).filter(id => safeIds.has(id));

// Show a note in campaign UI:
// "Showing {emailSafeLeads.length} of {leads.length} leads with verified emails"
```

---

## Task Execution Order

### Task 1: Database Migrations

Run 3 migrations via Supabase MCP or dashboard:

1. Add `email_status` column to `leads` table
2. Add `sending_email` column to `profiles` table + update RLS policy
3. Create `apollo_usage` table with RLS

### Task 2: Update TypeScript Types

**`src/types/crm.ts`:**
- Add `emailStatus?: string` to `Lead` interface
- Add `sendingEmail?: string` to `User` interface

**`src/types/database.ts`:**
- Add `email_status: string` to leads Row/Insert/Update
- Add `sending_email: string | null` to profiles Row/Insert/Update

### Task 3: Create the Apollo Search Edge Function

Create `supabase/functions/apollo-search/index.ts` following the pseudocode above:
- LLM prompt parsing (DeepSeek V3.2)
- Apollo People Search
- Apollo Bulk Enrichment (batches of 10)
- ZeroBounce validation
- Contact scoring
- Usage logging
- Full error handling

### Task 4: Deploy Edge Function and Set Secrets

```bash
# Verify OPENROUTER_API_KEY is already set from campaign-ai deployment
npx supabase secrets list --project-ref onthjkzdgsfvmgyhrorw

npx supabase functions deploy apollo-search --project-ref onthjkzdgsfvmgyhrorw
npx supabase secrets set APOLLO_API_KEY=<from .env> ZEROBOUNCE_API_KEY=<from .env> --project-ref onthjkzdgsfvmgyhrorw
```

Smoke test with curl.

### Task 5: Update Profile API and Hook

**`src/lib/api/profiles.ts`:**
- Update `updateProfile` to accept `sendingEmail` field

**`src/hooks/use-profiles.ts`:**
- Add `updateProfile` mutation with cache invalidation

### Task 6: Update Settings Page

**`src/pages/SettingsPage.tsx`:**
- Make name field editable (controlled input)
- Add sending email field
- Add Save button with loading state
- Show success toast on save

### Task 7: Update OutreachPage Campaign Filter

**`src/pages/OutreachPage.tsx`:**
- Filter campaign recipients to only include leads with verified/likely_to_engage email status
- Show a note in the campaign UI about email-safe filtering
- Apply to both manual and AI campaign modes

### Task 8: Verify LeadGeneratorPage import flow (no code changes needed)

**`src/pages/LeadGeneratorPage.tsx`:**
- The `handleImport` function strips `id` and `createdAt` before calling `addLeads()`
- `emailStatus` should NOT be stripped — it flows through `toSnakeCase()` in `createLeads()` which converts it to `email_status` for the DB insert
- Just verify the import works end-to-end with the new field

### Task 8b: Add `refreshUser` to AuthContext

**`src/contexts/AuthContext.tsx`:**
- Add `refreshUser: () => Promise<void>` to the `AuthContextType` interface
- Implement: call `supabase.auth.getSession()` to get the current session's user ID (NOT from stale `user` state), then `getProfile(session.user.id)`, then `setUser(profile)`
- Add `refreshUser` to the Provider `value` prop
- Export it via the context so Settings page can destructure it from `useAuth()`

```typescript
const refreshUser = useCallback(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    const profile = await getProfile(session.user.id);
    setUser(profile);
  }
}, []);
```

### Task 9: Update Documentation (comprehensive)

**`docs/schema.md`:** Add email_status column to leads table, sending_email column to profiles table, apollo_usage table section, Edge Functions section update (add apollo-search), update changelog

**`docs/lead-generator.md`:** Note Edge Function is now real (not documented as "missing"), ZeroBounce validation added, update changelog

**`docs/settings.md`:** FULL REWRITE needed — not just changelog:
- Change Status from "Placeholder" to "Active"
- Rewrite Overview paragraph (remove "read-only", "non-functional")
- Rewrite Profile Card section: name is editable, sending email field added, save button with loading state
- Rewrite Component Reference: add useState hooks (editName, editSendingEmail, saving), add updateProfile mutation, add refreshUser call
- Update Data Dependencies: add useProfiles().updateProfile, useAuth().refreshUser
- Remove "Profile is completely read-only" from Known Limitations
- Update changelog

**`docs/data-model.md`:** Add Lead.emailStatus (string, values: verified, likely_to_engage, guessed, unverified, invalid), User.sendingEmail (string, optional), update changelog

**`docs/state-management.md`:**
- Update useProfiles() row in Hook Reference table: add `updateProfile` under Mutations
- Update AuthContext section: add `refreshUser: () => Promise<void>` to AuthContextType interface block
- Update changelog

**`docs/outreach.md`:** Note campaign recipients filtered by email_status, compose tab also filtered, add changelog entry

**`docs/authentication.md`:** Add refreshUser to AuthContext methods section, note it re-fetches profile from Supabase, update changelog

**`docs/OVERVIEW.md`:**
- Major Changes Log: entry for Apollo Edge Function + email_status + profile editing
- File-to-Documentation Map: add `supabase/functions/apollo-search/index.ts` → lead-generator.md (if not already present)
- Update Feature Index: Settings status from "Placeholder" to "Active", Lead Generator confirm "Active"

---

## Validation Gates

1. `npm run build` passes with zero errors
2. Edge Function deploys successfully
3. Smoke test: curl the apollo-search function with a test prompt → returns real leads from Apollo
4. Lead Generator page: type "CTOs at SaaS companies" → real results appear with email/phone
5. Import leads → navigate to Leads page → imported leads show with email_status populated
6. Settings page: edit name + sending email → save → refresh → changes persist
7. Outreach → Campaigns → Manual mode → recipient list only shows leads with verified emails
8. Outreach → Campaigns → AI mode → selected recipients filtered by email status

---

## Deprecated Code (to remove)

None — this plan adds new functionality, doesn't replace existing code. The `LeadGeneratorPage.tsx` was already updated by the Apollo agent to call `searchApollo()`.

---

## System Prompt Design (LLM Filter Extraction)

```
You are a search filter extraction assistant. Given a natural language description of an ideal customer profile, extract structured search filters for the Apollo.io People Search API.

AVAILABLE FILTERS:
- person_titles: Array of job title keywords (e.g., ["CTO", "VP Engineering", "Director of Sales"])
- person_locations: Array of locations (e.g., ["California, US", "Austin, TX", "New York, US"])
- organization_num_employees_ranges: Array of company size brackets. Valid values: "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"
- q_keywords: Free-text keywords to search across profiles (e.g., "SaaS B2B")
- person_seniorities: Array of seniority levels. Valid values: "c_suite", "founder", "owner", "partner", "vp", "director", "manager", "senior", "entry"

RULES:
- Extract as many filters as the prompt implies. Leave arrays empty [] if the prompt doesn't mention that filter.
- For company size, map descriptions to brackets: "small" → ["1-10", "11-50"], "medium" → ["51-200", "201-500"], "large" → ["501-1000", "1001-5000", "5001-10000", "10001+"], "50-200 employees" → ["51-200"]
- For seniority, infer from titles: "CTO" → "c_suite", "VP" → "vp", "Director" → "director", etc.
- q_keywords should capture industry or topic terms not covered by other filters (e.g., "SaaS", "fintech", "healthcare")
- Be generous with title variations — "CTO" should also include "Chief Technology Officer"
```
