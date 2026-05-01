# Plan: Apollo Phone Number Reveal via Async Webhook

**Confidence: 8/10** — New webhook Edge Function + modify enrichment call + update leads when phones arrive. The async nature adds complexity.

## Goal

Enable phone number reveals in Apollo lead searches. Phone numbers are delivered asynchronously via webhook (minutes after the search). When they arrive, update the lead records in the CRM.

## Key Constraint

Phone reveals cost **~8 credits per number**. This is significantly more expensive than email enrichment (1 credit). The user must opt-in to phone reveals, not have them on by default.

## Architecture

```
User searches for leads (existing flow):
  → apollo-search Edge Function
    → Apollo Search (0 credits)
    → Apollo Bulk Enrichment (1 credit/person)
      NOW WITH: reveal_phone_number=true, webhook_url=<our endpoint>
    → Returns leads with emails immediately (phones pending)
    → Stores Apollo person IDs on lead records

Minutes later:
  → Apollo POSTs phone numbers to /functions/v1/apollo-phone-webhook
    → Edge Function receives phone_numbers per person
    → Matches Apollo person ID to our lead record
    → Updates lead.phone in the database
    → Supabase Realtime pushes the update to the UI
```

## Files Being Changed

```
supabase/
├── functions/
│   ├── apollo-search/
│   │   └── index.ts                    ← MODIFIED (add reveal_phone_number + webhook_url + store apollo_id)
│   └── apollo-phone-webhook/
│       └── index.ts                    ← NEW (receives async phone data from Apollo)
src/
├── types/
│   ├── crm.ts                         ← MODIFIED (add apolloId to Lead)
│   └── database.ts                    ← MODIFIED (add apollo_id to leads)
├── pages/
│   └── LeadGeneratorPage.tsx          ← MODIFIED (show phone pending indicator)
docs/
├── lead-generator.md                   ← MODIFIED
├── schema.md                           ← MODIFIED
├── OVERVIEW.md                         ← MODIFIED
```

---

## DB Migration

```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS apollo_id text;
CREATE INDEX IF NOT EXISTS leads_apollo_id_idx ON leads(apollo_id) WHERE apollo_id IS NOT NULL;
```

---

## Key Pseudocode

### Modified apollo-search: add phone reveal

```typescript
// In the bulk enrichment call, add reveal_phone_number + webhook_url
const SITE_URL = Deno.env.get('SUPABASE_URL') // Use Supabase URL for webhook
const webhookUrl = `${SITE_URL}/functions/v1/apollo-phone-webhook`

const enrichRes = await fetch('https://api.apollo.io/api/v1/people/bulk_match', {
  method: 'POST',
  headers: { 'X-Api-Key': APOLLO_API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    details: batch,
    reveal_personal_emails: false,
    reveal_phone_number: true,         // NEW
    webhook_url: webhookUrl,           // NEW — Apollo sends phones here
  }),
})

// Store Apollo person ID on each lead for webhook matching
// In the lead transform, add:
apolloId: (person.id as string) || undefined,
```

### apollo-phone-webhook Edge Function (NEW)

```typescript
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const payload = await req.json()
    const people = payload.people || []

    let updated = 0
    for (const person of people) {
      const apolloId = person.id
      const phoneNumbers = person.phone_numbers || []

      if (!apolloId || phoneNumbers.length === 0) continue

      // Get the best phone number (first valid one)
      const bestPhone = phoneNumbers.find((p: any) => p.sanitized_number) || phoneNumbers[0]
      const phone = bestPhone?.sanitized_number || bestPhone?.raw_number || ''

      if (!phone) continue

      // Update the lead by apollo_id
      const { error } = await supabaseAdmin.from('leads')
        .update({ phone })
        .eq('apollo_id', apolloId)

      if (!error) updated++
      else console.error(`Failed to update phone for apollo_id ${apolloId}:`, error)
    }

    console.log(`Phone webhook: ${updated} of ${people.length} leads updated`)
    return new Response(JSON.stringify({ updated }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('apollo-phone-webhook error:', err)
    return new Response('Internal error', { status: 500 })
  }
})
```

### LeadGeneratorPage — phone pending indicator

```tsx
// In the contact badge, if lead has no phone but has an apolloId,
// show a "Phone pending" indicator instead of nothing
{!l.phone && l.apolloId && (
  <Badge variant="secondary" className="text-[10px] bg-slate-50 text-slate-500">
    Phone pending...
  </Badge>
)}
```

---

## Task Execution Order

### Task 1: DB Migration
Add `apollo_id` column + index to leads table.

### Task 2: Update types
Add `apolloId?: string` to Lead in crm.ts. Add `apollo_id: string | null` to leads in database.ts.

### Task 3: Update apollo-search Edge Function
- Add `reveal_phone_number: true` and `webhook_url` to bulk enrichment call
- Add `apolloId` to LeadResult interface and lead transform
- The webhook URL is the Supabase project URL + `/functions/v1/apollo-phone-webhook`

### Task 4: Create apollo-phone-webhook Edge Function
- Receives POST from Apollo with phone data
- Matches by `person.id` → `leads.apollo_id`
- Updates `leads.phone` with the best phone number
- Deploy with `--no-verify-jwt` (Apollo can't send JWTs)

### Task 5: Update LeadGeneratorPage
- Show "Phone pending..." badge for leads with apolloId but no phone yet
- Supabase Realtime (already wired on leads) will auto-update the UI when phones arrive

### Task 6: Deploy + test + docs

---

## Validation Gates

1. `npm run build` passes
2. apollo-search includes `reveal_phone_number: true` in enrichment calls
3. apollo-phone-webhook deploys and is accessible
4. Search for leads → leads returned with emails, phone shows "pending"
5. Minutes later → phone numbers arrive via webhook → leads updated in DB
6. UI shows phone numbers (via Realtime auto-refresh)
7. Imported leads appear in CRM with apollo_id for future phone matching
8. All docs updated

---

## Known Gotchas

```
1. Phone reveals cost ~8 credits per number. This is ON by default in searches.
   Consider adding a toggle in the future if credits are a concern.

2. Phone delivery takes MINUTES — not instant. Users see "Phone pending..."
   and the numbers populate via Realtime when Apollo delivers them.

3. The webhook URL must be publicly accessible. Supabase Edge Functions are
   public by default — no special config needed.

4. Apollo sends phone data grouped by person ID. We match using apollo_id
   stored on the lead record at import time.

5. If a lead is imported but the phone webhook fires before the lead is in
   the DB (race condition), the update will find no matching apollo_id and
   silently fail. This is unlikely since enrichment takes minutes.

6. The webhook doesn't require authentication from Apollo — it's a simple
   POST. For security, we could validate the payload structure, but Apollo
   doesn't sign webhooks.

7. Testing: use real Apollo searches — the phone numbers will arrive for
   the same leads we search for. Credits will be consumed. Make sure to
   import the leads so they show up in the CRM.
```

---

## Deprecated Code

None — adds new functionality.
