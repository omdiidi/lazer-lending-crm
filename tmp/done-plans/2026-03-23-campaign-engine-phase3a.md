# Plan: Campaign Engine Phase 3a — A/B Testing + Apollo Auto-Gen Pipeline

**Confidence: 8/10** — A/B testing has DB columns ready, needs UI + scheduler split logic + analytics. Apollo auto-gen reuses existing infrastructure.

## Goal

Execute A/B tests (full body variants, 50/50 split, per-variant analytics with AI analysis). Add Apollo lead auto-generation directly from the campaign builder with credit confirmation.

## What — Phase 3a Scope

### A/B Testing
1. **Builder: A/B toggle** in step 2 — enable A/B test, enter variant B subject + body
2. **Scheduler: split sending** — deterministically assign A or B to each enrollment (hash-based 50/50)
3. **Analytics: per-variant stats** — open rate, click rate, bounce rate per variant
4. **AI winner analysis** — GPT-4.1-mini analyzes which variant won and why

### Apollo Auto-Gen Pipeline
1. **Builder: "Generate Leads" option** in step 1 (audience selection)
2. **Describe ideal customer** → Apollo searches + enriches → leads imported to CRM + added to campaign
3. **Credit confirmation** — shows estimated Apollo credits before generating
4. **Reuses existing `apollo-search` Edge Function** — same pipeline as Lead Generator

---

## Files Being Changed

```
supabase/
├── functions/
│   └── process-campaigns/
│       └── index.ts                    ← MODIFIED (A/B split logic in send path)
src/
├── pages/
│   ├── CampaignBuilderPage.tsx         ← MODIFIED (A/B toggle + Apollo auto-gen in step 1)
│   └── CampaignDetailPage.tsx          ← MODIFIED (per-variant analytics display)
├── components/
│   └── campaigns/
│       ├── CampaignAnalytics.tsx       ← MODIFIED (variant A/B split view)
│       └── ABVariantEditor.tsx         ← NEW (variant B subject + body editor)
├── lib/
│   └── api/
│       └── campaigns.ts               ← MODIFIED (analytics per variant)
├── types/
│   └── database.ts                    ← MODIFIED (ab_variant on enrollments)
docs/
├── campaigns.md                        ← MODIFIED
├── OVERVIEW.md                         ← MODIFIED
```

---

## Architecture Overview

### A/B Testing Flow
```
Builder Step 2: User enables A/B test
  → Enters variant A subject/body (existing TemplateEditor)
  → Enters variant B subject/body (ABVariantEditor)
  → Both stored on campaign record

On send (immediate or scheduled):
  → Enrollments created with ab_variant = NULL
  → Scheduler assigns variant: enrollment.id hash % 2 → 'A' or 'B'
  → Variant A recipients get campaign.subject + campaign.body
  → Variant B recipients get campaign.variant_b_subject + campaign.variant_b_body
  → ab_variant column updated on each enrollment

Campaign Detail Page:
  → Analytics split: "Variant A: 45% open rate" vs "Variant B: 52% open rate"
  → AI analysis: "Variant B performed better — the curiosity-based subject line drove 15% higher opens"
```

### Apollo Auto-Gen Flow
```
Builder Step 1: User clicks "Auto-Generate Leads"
  → Modal: describe ideal customer profile + select count (10/25/50)
  → Credit confirmation: "This will use ~50 Apollo credits. Proceed?"
  → Calls existing apollo-search Edge Function
  → Returns leads → auto-added to CRM + selected as campaign recipients
  → User can also manually add/remove from the audience selector
```

---

## DB Migration

```sql
-- Add ab_variant column to campaign_enrollments
ALTER TABLE campaign_enrollments ADD COLUMN IF NOT EXISTS ab_variant text;
```

---

## Key Pseudocode

### A/B Split in process-campaigns Scheduler

```typescript
// In the email-building loop, determine variant per enrollment:
const resendEmails = enrollments.map((e, idx) => {
  const lead = e.lead_id ? leadMap.get(e.lead_id) : null

  // Deterministic A/B assignment based on enrollment ID hash
  let useVariantB = false
  if (campaign.ab_test_enabled && campaign.variant_b_subject && campaign.variant_b_body) {
    // Simple hash: sum of char codes mod 2
    const hash = e.id.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0)
    useVariantB = hash % 2 === 1
  }

  const templateSubject = useVariantB ? campaign.variant_b_subject : campaign.subject
  const templateBody = useVariantB ? campaign.variant_b_body : campaign.body

  let emailBody = templateBody
    .replace(/\{\{firstName\}\}/g, lead?.first_name || '')
    .replace(/\{\{company\}\}/g, lead?.company || '')
  const emailSubject = templateSubject
    .replace(/\{\{firstName\}\}/g, lead?.first_name || '')
    .replace(/\{\{company\}\}/g, lead?.company || '')

  // ... unsubscribe link injection

  // Track variant assignment
  e._variant = useVariantB ? 'B' : 'A'

  return { from, to, subject: emailSubject, text: emailBody }
})

// After send, update enrollments with variant + status in TWO batched calls (not N+1):
const variantAIds = enrollments.filter(e => e._variant === 'A').map(e => e.id)
const variantBIds = enrollments.filter(e => e._variant === 'B').map(e => e.id)
if (variantAIds.length) {
  await supabaseAdmin.from('campaign_enrollments')
    .update({ status: 'sent', sent_at: new Date().toISOString(), ab_variant: 'A' })
    .in('id', variantAIds)
}
if (variantBIds.length) {
  await supabaseAdmin.from('campaign_enrollments')
    .update({ status: 'sent', sent_at: new Date().toISOString(), ab_variant: 'B' })
    .in('id', variantBIds)
}
// This replaces the existing bulk status update — merged into one call per variant
```

### ABVariantEditor Component

```tsx
// Simple: two textareas for variant B subject + body
// Shown when abTestEnabled is true in the builder
interface ABVariantEditorProps {
  subject: string;
  body: string;
  onSubjectChange: (s: string) => void;
  onBodyChange: (b: string) => void;
}
// Renders: Label "Variant B", subject Input, body Textarea with merge field hints
```

### CampaignAnalytics — Per-Variant View

```tsx
// When campaign.abTestEnabled:
// Show two columns: Variant A stats | Variant B stats
// Each has: sent, opened (%), clicked (%), bounced
// Bottom: AI analysis of winner

interface ABAnalyticsProps {
  variantA: { sent: number; opened: number; clicked: number; bounced: number };
  variantB: { sent: number; opened: number; clicked: number; bounced: number };
  aiAnalysis?: string;
}
```

### Analytics Query Per Variant

```typescript
export async function getCampaignABAnalytics(campaignId: string) {
  // Join enrollments (for ab_variant) with emails (for open/click/bounce tracking)
  const { data: enrollments } = await supabase
    .from('campaign_enrollments')
    .select('id, ab_variant, lead_id, email')
    .eq('campaign_id', campaignId)

  const { data: emails } = await supabase
    .from('emails')
    .select('lead_id, opened_at, clicked_at, bounced_at')
    .eq('campaign_id', campaignId)
    .eq('direction', 'outbound')

  // Map email tracking data by lead_id
  const emailMap = new Map<string, { opened: boolean; clicked: boolean; bounced: boolean }>()
  for (const e of emails || []) {
    if (e.lead_id) emailMap.set(e.lead_id, {
      opened: !!e.opened_at, clicked: !!e.clicked_at, bounced: !!e.bounced_at,
    })
  }

  const calcStats = (variant: string) => {
    const group = enrollments?.filter(e => e.ab_variant === variant) || []
    return {
      sent: group.length,
      opened: group.filter(e => e.lead_id && emailMap.get(e.lead_id)?.opened).length,
      clicked: group.filter(e => e.lead_id && emailMap.get(e.lead_id)?.clicked).length,
      bounced: group.filter(e => e.lead_id && emailMap.get(e.lead_id)?.bounced).length,
    }
  }

  return { a: calcStats('A'), b: calcStats('B') }
}
```

### AI Winner Analysis

```typescript
// Call generate-template Edge Function with mode 'analyze'
// Input: variant A stats + variant B stats
// Output: 2-3 sentence analysis of which won and why
// Use GPT-4.1-mini, temperature 0.3 (analytical, not creative)
```

### Apollo Auto-Gen in Builder Step 1

```tsx
// In AudienceSelector or as a separate panel in Step 1:
<Button onClick={() => setShowApolloGen(true)}>Auto-Generate Leads</Button>

// Modal:
// - Textarea: "Describe your ideal customer..."
// - Select: count (10/25/50)
// - Credit estimate: "~{count * 2} Apollo credits"
// - Confirm button

// On confirm:
// 1. Call searchApollo(prompt, count) — existing function
// 2. Import returned leads to CRM via addLeads()
// 3. Auto-select the imported leads in the audience selector
// 4. Close modal, show "X leads generated and selected"
```

---

## Task Execution Order

### Task 1: DB Migration
Add `ab_variant text` to campaign_enrollments.

### Task 2: Update database.ts
Add `ab_variant` to campaign_enrollments Row/Insert/Update.

### Task 3: Create ABVariantEditor component
Simple variant B subject + body editor.

### Task 4: Update CampaignBuilderPage
- Add A/B toggle in step 2 (below sequence toggle)
- Show ABVariantEditor when enabled
- Pass variant B data to campaign creation
- Add Apollo auto-gen button in step 1 with modal + credit confirmation

### Task 5: Update process-campaigns scheduler
- A/B split logic: hash enrollment ID, assign variant
- Use correct subject/body per variant
- Track variant assignment on enrollment

### Task 6: Update campaigns API
- Add `getCampaignABAnalytics` function
- Extend `generate-template` Edge Function with `analyze` mode for AI winner analysis

### Task 7: Update CampaignDetailPage + CampaignAnalytics
- Show per-variant stats when A/B test enabled
- Add AI analysis section

### Task 8: Deploy + test + docs

---

## Validation Gates

1. `npm run build` passes
2. Builder: enable A/B test → enter variant B → send campaign
3. Scheduler sends ~50% variant A, ~50% variant B
4. Enrollment records have `ab_variant` = 'A' or 'B'
5. Campaign detail shows per-variant analytics
6. AI analysis generates winner insight
7. Apollo auto-gen: describe customers → leads generated → selected in audience
8. Credit confirmation shown before Apollo search

---

## Known Gotchas

```
1. A/B split is deterministic (hash of enrollment ID). Same enrollment always
   gets the same variant — no randomness issues on re-runs.

2. For drip sequences with A/B testing: each step uses the SAME variant
   for a given enrollment. If enrollment is variant B, all 5 steps use
   variant B's subject/body. Don't mix variants within a sequence.

3. The Apollo auto-gen in the builder creates REAL leads in the CRM
   (persisted to DB). They're not temporary — same as Lead Generator import.

4. Apollo credit confirmation: estimate is perPage * 2 (search is free,
   enrichment costs 1 credit per person, ZeroBounce is separate).

5. AI winner analysis should wait until sufficient data — at least 10 sends
   per variant and some opens. Show "Collecting data..." if too early.

6. AI analysis: do NOT add 'analyze' mode to generate-template (schema
   mismatch — it only returns subject/body). Instead, call OpenRouter
   directly from the frontend via a new client function in campaigns.ts
   that invokes generate-template with a SEPARATE schema, OR create a
   dedicated analyze-campaign Edge Function. Simplest: just call the
   generate-template function but with a different json_schema that
   returns { analysis: string }. Add mode-conditional schema in the
   Edge Function.

7. Auth: add JWT validation to the generate-template Edge Function for
   the analyze mode to prevent unauthenticated callers consuming credits.

7. A/B testing is NOT compatible with drip sequences in Phase 3a —
   the variant B fields are on the campaign, not on campaign_steps.
   If useSequence is true, disable the A/B toggle. Phase 3b can add
   per-step variants if needed.
```

---

## Deprecated Code (to remove)

None — adds new functionality.
