# Brief: Filter invalid emails from Apollo search results

## Why
Users shouldn't see leads with known-invalid emails. It wastes their time and clutters results. If a lead has no valid contact method at all, it's useless.

## Context
- File: `supabase/functions/apollo-search/index.ts`
- ZeroBounce validation happens in Step 4 of the pipeline, after Apollo enrichment
- After ZeroBounce, leads are scored and returned in Step 5
- Currently, leads with `emailStatus: 'invalid'` are still returned to the frontend — they just get filtered out of campaigns by `emailSafeLeads`

## Decisions
- **Invalid email + no phone → drop entirely** — don't return this lead to the frontend at all
- **Invalid email + has phone → keep but strip email** — return the lead with email cleared and `emailStatus: 'invalid'`, so users can still call them
- **Valid/verified email → pass through** — no change to current behavior
- **This filter happens in the Edge Function** — before results reach the frontend, not in the UI

## Rejected Alternatives
- **Return all leads and let frontend filter** — already doing this, user doesn't want to see invalid leads at all

## Direction
In the `apollo-search` Edge Function, after ZeroBounce validation (Step 4) and before scoring (Step 5), filter out leads with invalid emails and no phone number. For leads with invalid emails but a phone number, clear the email field.
