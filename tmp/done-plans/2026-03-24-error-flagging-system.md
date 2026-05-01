# Plan: Error Flagging System

## Goal

Build a system that catches API errors from all edge functions, stores them in a `system_alerts` table, and displays them as a real-time banner in the app. Catch errors from Apollo, Resend, ZeroBounce, and OpenRouter. Fix silent campaign failures.

## Why

- API errors (credit exhaustion, services down) are currently silent — only logged to console
- Campaign email failures silently skip enrollments that stay `'pending'` forever
- Users have no visibility into system health

## What

- `system_alerts` table with Realtime subscription
- Shared `writeAlert()` helper for edge functions
- Alert banner component in App.tsx (only shows when issues exist)
- 7 edge functions instrumented with error capture
- Campaign enrollments marked `'failed'` on Resend errors

### Success Criteria

- [ ] `system_alerts` table created
- [ ] Alert banner appears when there are unresolved alerts
- [ ] Dismissing an alert marks it resolved
- [ ] All 7 edge functions write alerts on API failures
- [ ] Failed campaign enrollments marked `'failed'`
- [ ] 5-minute dedup prevents alert spam

## Files Being Changed

```
supabase/functions/_shared/alerts.ts                   ← NEW (writeAlert helper)
src/components/AlertBanner.tsx                          ← NEW (banner component)
src/hooks/use-alerts.ts                                ← NEW (Realtime subscription hook)
src/types/database.ts                                  ← MODIFIED (add system_alerts type)
src/layouts/AppLayout.tsx                               ← MODIFIED (add AlertBanner)
src/types/crm.ts                                       ← MODIFIED (add 'failed' to enrollment status)
supabase/functions/process-campaigns/index.ts          ← MODIFIED (add alerts + mark failed)
supabase/functions/lead-gen-chat/index.ts              ← MODIFIED (add alerts)
supabase/functions/apollo-search/index.ts              ← MODIFIED (add alerts)
supabase/functions/send-email/index.ts                 ← MODIFIED (add alerts)
supabase/functions/generate-template/index.ts          ← MODIFIED (add alerts)
supabase/functions/campaign-ai/index.ts                ← MODIFIED (add alerts)
supabase/functions/apollo-phone-webhook/index.ts       ← MODIFIED (add alerts)
```

## Architecture Overview

```
Edge Function hits API error
  → writeAlert(supabaseAdmin, { type, source, message, details })
    → Dedup check (5 min window)
    → INSERT into system_alerts

system_alerts table (Supabase Realtime enabled)
  → useAlerts() hook subscribes to INSERT events
    → AlertBanner component renders unresolved alerts
      → User clicks dismiss → UPDATE resolved = true
```

## All Needed Context

### Shared Alert Writer Pattern

Every edge function already creates a `supabaseAdmin` client. The `writeAlert` helper uses it:

```typescript
// supabase/functions/_shared/alerts.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export async function writeAlert(
  supabaseAdmin: ReturnType<typeof createClient>,
  alert: { type: 'error' | 'warning'; source: string; message: string; details?: Record<string, unknown> }
) {
  try {
    // Dedup: skip if same source has unresolved alert within 5 minutes
    const { data: existing } = await supabaseAdmin
      .from('system_alerts')
      .select('id')
      .eq('source', alert.source)
      .eq('message', alert.message)
      .eq('resolved', false)
      .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .limit(1)

    if (existing && existing.length > 0) return

    // Service role bypasses RLS — no INSERT policy needed for authenticated users
    await supabaseAdmin.from('system_alerts').insert({
      type: alert.type,
      source: alert.source,
      message: alert.message,
      details: alert.details || {},
    })
  } catch (e) {
    console.error('Failed to write alert:', e)
  }
}
```

### Realtime Pattern (from existing hooks)

The existing `use-leads.ts` and `use-emails.ts` hooks use this Realtime pattern:
```typescript
const channel = supabase.channel('table-changes')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'system_alerts' }, payload => {
    // Add to local state
  })
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'system_alerts' }, payload => {
    // Update resolved status in local state
  })
  .subscribe()
```

### App.tsx Layout (lines 56-78)

```tsx
const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          {/* AlertBanner goes here, before Routes */}
          <Routes>...
```

### Error Source Labels

| Source | Edge Function | API |
|---|---|---|
| `apollo` | lead-gen-chat, apollo-search | Apollo People Search, Bulk Enrichment |
| `resend` | process-campaigns, send-email | Resend Email Send/Batch |
| `zerobounce` | lead-gen-chat, apollo-search | ZeroBounce Email Validation |
| `openrouter` | lead-gen-chat, campaign-ai, generate-template | OpenRouter LLM |
| `system` | apollo-phone-webhook | Internal DB errors |

## Known Gotchas

1. **Edge functions import from `_shared/`** — The existing `cors.ts` pattern shows how: `import { corsHeaders } from '../_shared/cors.ts'`. Same pattern for `alerts.ts`.

2. **supabaseAdmin must exist before writeAlert** — In some functions, supabaseAdmin is created conditionally or late. Ensure it's available where alerts are written.

3. **Realtime requires RLS policy** — The table needs a SELECT policy for authenticated users AND Realtime must be enabled for the table.

4. **Don't block the main response on alert writes** — `writeAlert` is fire-and-forget. Use `await` but in a try-catch so failures don't crash the edge function.

5. **process-campaigns runs on pg_cron** — No user is watching when it runs. Alerts are the only way to surface failures.

6. **Enrollment status union type** — Check `src/types/crm.ts` CampaignEnrollment type. If `'failed'` isn't in the status union, add it.

## Key Pseudocode

### AlertBanner Component

```tsx
export function AlertBanner() {
  const { alerts, dismissAlert } = useAlerts()

  if (alerts.length === 0) return null

  return (
    <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-2">
      <div className="flex items-center gap-2 max-w-[1400px] mx-auto">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        <span className="text-sm text-destructive flex-1">
          {alerts[0].message}
          {alerts.length > 1 && <Badge>+{alerts.length - 1} more</Badge>}
        </span>
        <Button variant="ghost" size="sm" onClick={() => dismissAlert(alerts[0].id)}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}
```

### useAlerts Hook (React Query pattern — matches existing hooks)

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export function useAlerts() {
  const queryClient = useQueryClient()

  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      const { data } = await supabase.from('system_alerts')
        .select('*')
        .eq('resolved', false)
        .order('created_at', { ascending: false })
      return data || []
    },
  })

  // Realtime subscription — invalidates query on changes
  useEffect(() => {
    const channel = supabase.channel('system-alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_alerts' }, () => {
        queryClient.invalidateQueries({ queryKey: ['alerts'] })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [queryClient])

  const dismissMutation = useMutation({
    mutationFn: (id: string) => supabase.from('system_alerts').update({ resolved: true }).eq('id', id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  })

  return { alerts, dismissAlert: dismissMutation.mutate }
}
```

### Edge Function Instrumentation (example: process-campaigns Resend batch)

```typescript
// After Resend batch fetch:
if (!res.ok) {
  const errorText = await res.text()
  console.error('Resend batch failed:', res.status, errorText)
  await writeAlert(supabaseAdmin, {
    type: 'error',
    source: 'resend',
    message: `Campaign email batch failed (HTTP ${res.status}). Some emails may not have been sent.`,
    details: { campaign_id: campaign.id, status: res.status, error: errorText },
  })
  // Mark enrollments as failed
  const failedIds = enrollments.map(e => e.id)
  await supabaseAdmin.from('campaign_enrollments')
    .update({ status: 'failed' })
    .in('id', failedIds)
  continue
}
```

## Tasks (in implementation order)

### Task 1: Create system_alerts table + types

**Apply migration via Supabase MCP:**
```sql
CREATE TABLE IF NOT EXISTS system_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('error', 'warning')),
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read" ON system_alerts FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_update" ON system_alerts FOR UPDATE TO authenticated USING (true);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE system_alerts;

-- Index for dedup query performance
CREATE INDEX system_alerts_dedup_idx ON system_alerts (source, message, resolved, created_at DESC);
```

**MODIFY `src/types/database.ts`** — add `system_alerts` table type.

**MODIFY `src/types/crm.ts`** — add `'failed'` to the CampaignEnrollment `status` union type (currently `'pending' | 'sent' | 'opened' | 'replied' | 'bounced' | 'unsubscribed'`).

### Task 2: Create shared alert writer

**CREATE `supabase/functions/_shared/alerts.ts`**

The `writeAlert` function as shown in the pseudocode above. Fire-and-forget with try-catch. 5-minute dedup by source.

### Task 3: Create useAlerts hook

**CREATE `src/hooks/use-alerts.ts`**

Subscribe to Realtime on `system_alerts`. Initial fetch of unresolved alerts. `dismissAlert` function that sets `resolved: true`.

### Task 4: Create AlertBanner component

**CREATE `src/components/AlertBanner.tsx`**

Shows unresolved alerts with dismiss button. Only renders when there are alerts. Color-coded (red for errors, amber for warnings). Shows the most recent alert message with a count badge if multiple.

### Task 5: Add AlertBanner to AppLayout

**MODIFY the layout component that wraps authenticated routes** (find `AppLayout` or the `<Outlet />` wrapper in the routing setup). Add `<AlertBanner />` above the `<Outlet />` so it renders at the top of every authenticated page.

If the layout is in `src/App.tsx` inline, add it there. If it's a separate `AppLayout.tsx`, add it there. The key: it must only render for authenticated users and appear above the page content.

### Task 6: Instrument process-campaigns

**MODIFY `supabase/functions/process-campaigns/index.ts`**

6a. Import `writeAlert` from `../_shared/alerts.ts`

6b. **Bulk Resend batch failure** (after the `if (res.ok)` block): On failure, call `writeAlert` with source `'resend'` and mark all enrollments in the failed batch as `'failed'`.

6c. **Drip Resend send failure** (after the drip send `if (res.ok)` block): On failure, call `writeAlert` with source `'resend'` and mark the enrollment as `'failed'`.

### Task 7: Instrument lead-gen-chat

**MODIFY `supabase/functions/lead-gen-chat/index.ts`**

7a. Import `writeAlert`

7b. **Hoist supabaseAdmin creation** — currently created at line ~450 inside `if (parsed.shouldSearch)`. Move it to the top of the handler (after key validation, before the OpenRouter fetch) so it's available for alert writes at all error points.

7c. **OpenRouter failure** (after `if (!llmRes.ok)`): Write alert with source `'openrouter'`.

7c. **Apollo search failure** (in `runApolloSearch`, after `if (!searchRes.ok)`): Write alert with source `'apollo'`.

7d. **Apollo enrichment batch failure** (in the enrichment loop, after `if (!enrichRes.ok)`): Write alert with source `'apollo'`. Only for the first failure in a batch (dedup handles the rest).

### Task 8: Instrument apollo-search

**MODIFY `supabase/functions/apollo-search/index.ts`**

8a. Import `writeAlert`

8b. **Hoist supabaseAdmin creation** — currently created late in the usage logging block. Move it to the top of the handler so it's available for alert writes at all error points.

8c. **OpenRouter failure**: Write alert with source `'openrouter'`.

8c. **Apollo search failure**: Write alert with source `'apollo'`.

8d. **Apollo enrichment batch failure**: Write alert with source `'apollo'`.

### Task 9: Instrument send-email

**MODIFY `supabase/functions/send-email/index.ts`**

9a. Import `writeAlert`

9b. **Single send Resend failure** (after `if (!resendRes.ok)`): Write alert with source `'resend'`.

9c. **Batch send Resend failure** (in the batch loop, after `if (!resendRes.ok)`): Write alert with source `'resend'`.

### Task 10: Instrument generate-template + campaign-ai

**MODIFY `supabase/functions/generate-template/index.ts`**

10a. Import `writeAlert`. Create `supabaseAdmin` client (this function currently has none). Write alert on OpenRouter failure.

**MODIFY `supabase/functions/campaign-ai/index.ts`**

10b. Import `writeAlert`. Create `supabaseAdmin` client (this function currently has none). Write alert on OpenRouter failure. Also fix the missing `data?.error` check.

### Task 11: Instrument apollo-phone-webhook

**MODIFY `supabase/functions/apollo-phone-webhook/index.ts`**

11a. Import `writeAlert`, write alert on buffer upsert failures (source `'system'`).

### Task 12: Deploy all edge functions

```bash
supabase functions deploy process-campaigns --no-verify-jwt
supabase functions deploy lead-gen-chat --no-verify-jwt
supabase functions deploy apollo-search --no-verify-jwt
supabase functions deploy send-email --no-verify-jwt
supabase functions deploy generate-template --no-verify-jwt
supabase functions deploy campaign-ai --no-verify-jwt
supabase functions deploy apollo-phone-webhook --no-verify-jwt
```

## Validation Loop

```bash
npm run lint
```

Manual test: Trigger an error (e.g., invalid API key) → alert should appear in the app.

## Deprecated Code

None — additive.

## Confidence Score: 7/10

Large surface area (7 edge functions + 4 new frontend files + migration). Each individual change is simple, but the quantity increases risk. The Realtime subscription and dedup logic are the main complexity points.
