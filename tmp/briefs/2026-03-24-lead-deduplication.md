# Brief: Lead Deduplication in Lead Generator

## Why
Users can import the same lead multiple times, wasting Apollo credits and creating duplicate records. Once a lead is in the CRM (imported by any user), it should never be enriched or imported again.

## Context
- `leads.apollo_id` — stores Apollo person ID on every imported lead (added in phone reveal feature)
- `leads.email` — unique-ish identifier (not enforced as UNIQUE in DB, but practically unique per person)
- Apollo search returns person IDs before enrichment (0 credits)
- Apollo enrichment costs 1 credit per person + ~8 for phone reveal
- `lead-gen-chat` Edge Function runs the full Apollo pipeline inline
- `LeadGeneratorPage.tsx` displays results and handles import

## Decisions

### Layer 1: Pre-enrichment dedup by apollo_id (saves credits)
- After Apollo People Search returns person IDs (before enrichment)
- Query `leads.apollo_id` for all returned IDs
- Remove matches from the enrichment batch — don't spend credits on them
- This is the PRIMARY credit-saving mechanism

### Layer 2: Post-enrichment dedup by email (catches remaining duplicates)
- After enrichment returns emails
- Query `leads.email` for all returned emails
- Mark matches as "Already in CRM" in the results
- These leads ARE shown in results but with a badge and disabled import button
- This catches leads that were manually created or imported before apollo_id existed

### UI Indicators
- Duplicate leads in search results show "Already in CRM" badge
- Import button skips duplicates — only imports new leads
- Count displayed: "Found X contacts (Y already in CRM)"

### Import Protection
- `handleImport` also does a final email check before inserting
- Prevents race conditions where another user imports the same lead between search and import

## Rejected Alternatives
- **Unique constraint on leads.email** — too aggressive, would block legitimate updates and manual corrections
- **Client-side only dedup** — doesn't save credits since enrichment happens server-side
- **Skip showing duplicates entirely** — user should know the lead exists, just can't re-import

## Direction
Add dedup checks at two points in the lead-gen-chat Edge Function: (1) pre-enrichment by apollo_id to save credits, (2) post-enrichment by email to catch remaining duplicates. Mark duplicates in results with "Already in CRM" badge. Import skips duplicates automatically.
