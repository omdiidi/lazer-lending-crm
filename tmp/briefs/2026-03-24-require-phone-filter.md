# Brief: Require Phone Number Filter in Lead Generator

## Why
Users want to avoid wasting Apollo credits on leads that don't have phone numbers. Phone reveals cost ~8 mobile credits each, and enriching contacts without phones is a waste. A simple toggle lets users guarantee every returned lead has a phone number on file.

## Context
- Apollo People Search (`/v1/mixed_people/api_search`) is **free** (0 credits) and returns `has_direct_phone` on each result: `"Yes"`, `"Maybe: please request direct dial via people/bulk_match"`, or absent/`"No"`
- Bulk Enrichment (`/v1/people/bulk_match`) costs 1 export credit + up to 8 mobile credits per phone reveal
- Current pipeline in `lead-gen-chat/index.ts`: search (free) → dedup by apollo_id → bulk enrich (costs credits) → dedup by email → return results
- `LeadGeneratorPage.tsx` has a quantity selector (10/25/50) at line 308-317, the toggle goes next to it
- The `selectedCount` state is passed to `sendLeadGenMessage()` as `perPage`
- The edge function builds `searchBody` at ~line 69 with no phone filtering currently
- Phone numbers extracted from enrichment response at ~line 187: `person.phone_numbers[0].sanitized_number`

## Decisions

### UI: Simple toggle next to quantity selector
- On/off toggle labeled "Require phone" next to the existing count dropdown
- Default: off (current behavior, no filtering)
- When on: only contacts with confirmed phone numbers are enriched
- Pass as `requirePhone: boolean` to the edge function

### Filter logic: Post-search, pre-enrichment by `has_direct_phone`
- After the free Apollo search returns results, check `has_direct_phone` on each person
- When `requirePhone` is true: only send people with `has_direct_phone === "Yes"` to bulk enrichment
- This saves credits because filtering happens BETWEEN the free search and the paid enrichment
- If filtering reduces results below the requested count, search for more pages to compensate (fetch extra from Apollo search to fill the quota)

### "Maybe" contacts are excluded
- `has_direct_phone: "Maybe"` means Apollo has a weak signal — needs waterfall enrichment to confirm
- No published hit rate, but estimated well below 50%
- At 8 mobile credits per reveal, "Maybe" is not worth the gamble
- Only `"Yes"` contacts pass the filter

### Edge function receives `requirePhone` param
- `sendLeadGenMessage(text, chatHistory, selectedCount)` → add `requirePhone` as 4th param
- Edge function `lead-gen-chat/index.ts` reads it from request body
- Filter applied after search results return, before enrichment batch is built
- The LLM confirmation message should mention "with verified phone numbers" when the filter is active

### Credit estimation update
- When `requirePhone` is on, credit estimate should reflect that fewer people may be enriched
- Confirmation message: "I'll search for [filters] with verified phone numbers. This will use ~X credits."

## Rejected Alternatives
- **Apollo API search-level phone filter** — no such parameter exists in the public API; `has_direct_phone` is a response field, not a request filter
- **Include "Maybe" contacts** — too risky at 8 credits per reveal with sub-50% hit rate; defeats the purpose of the filter
- **Dropdown (Yes/Maybe/No) instead of toggle** — over-engineered for the use case; simple on/off is cleaner
- **Client-side only filtering** — doesn't save credits since enrichment happens server-side; must filter before enrichment call

## Direction
Add a "Require phone" toggle to LeadGeneratorPage.tsx next to the quantity selector. Pass `requirePhone` boolean to the `lead-gen-chat` edge function. After the free Apollo search, filter results to only `has_direct_phone === "Yes"` before sending to bulk enrichment. This ensures zero credits are spent on contacts without phone numbers. If the filtered set is smaller than requested, fetch additional search pages to compensate.
