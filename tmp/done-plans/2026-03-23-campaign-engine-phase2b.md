# Plan: Campaign Engine Phase 2b — Drip Sequences

**Confidence: 9/10** — All DB tables exist, scheduler exists, enrollment tracking exists. This is wiring + UI only.

## Goal

Add multi-step drip sequences to campaigns. Users define up to 5 email steps with configurable delays. The scheduler sends each step at the right time. Unsubscribes and replies stop the sequence for that lead.

## What — Phase 2b Scope

### Features
1. **Sequence builder in campaign builder** — toggle between "Single Email" and "Multi-Step Sequence" in step 2
2. **Up to 5 steps** — intro email + 4 follow-ups, each with delay_days, subject, body
3. **Scheduler processes drip steps** — process-campaigns checks enrollments where next_send_at is due
4. **Stop conditions** — unsubscribe stops sequence. Reply stops for that specific lead. Opens/clicks do NOT stop.
5. **Sequence progress visible** — campaign detail page shows which step each recipient is on

---

## Files Being Changed

```
supabase/
├── functions/
│   └── process-campaigns/
│       └── index.ts                    ← MODIFIED (add drip step processing)
src/
├── pages/
│   ├── CampaignBuilderPage.tsx         ← MODIFIED (add sequence toggle + step editor)
│   └── CampaignDetailPage.tsx          ← MODIFIED (show sequence progress per recipient)
├── components/
│   └── campaigns/
│       └── SequenceEditor.tsx          ← NEW (multi-step sequence builder UI)
├── lib/
│   └── api/
│       └── campaigns.ts               ← MODIFIED (add createSequence, createSteps)
├── hooks/
│   └── use-campaigns.ts               ← MODIFIED (expose sequence functions)
docs/
├── campaigns.md                        ← MODIFIED
├── schema.md                           ← MODIFIED
├── OVERVIEW.md                         ← MODIFIED
```

---

## Architecture Overview

### Drip Sequence Flow
```
User creates campaign with sequence (5 steps):
  Step 0 (intro): Send immediately (or at scheduled_at)
  Step 1: delay 2 days, follow-up subject/body
  Step 2: delay 3 days, second follow-up
  Step 3: delay 5 days, third follow-up
  Step 4: delay 7 days, breakup email

On campaign send/schedule:
  1. Create campaign_sequences row
  2. Create 5 campaign_steps rows (order 0-4, delay_days)
  3. Create enrollment per recipient: current_step=0, next_send_at=now (or scheduled_at)
  4. Status: scheduled or active

Scheduler (every 5 min):
  1. Existing: process scheduled campaigns (Step 0 — intro email)
  2. NEW: query enrollments WHERE status='pending' AND next_send_at <= now()
     For each:
       a. Fetch the campaign_step for current_step
       b. Send the email (with merge fields)
       c. If more steps remain: increment current_step, set next_send_at = now + delay_days
       d. If last step: mark enrollment as 'sent' (sequence complete)
       e. If lead unsubscribed or replied: skip (stop condition)
```

### Stop Conditions
```
Before sending each step, check:
  1. Is enrollment status 'unsubscribed'? → skip, don't send
  2. Is enrollment status 'replied'? → skip, don't send (reply detection from Phase 2a)
  3. Is enrollment status 'bounced'? → skip, don't send
  4. Is enrollment status 'opened' or 'sent'? → SEND (opens/clicks don't stop)
  5. Is enrollment status 'pending'? → SEND
```

---

## Key Pseudocode

### SequenceEditor Component

```tsx
interface SequenceStep {
  subject: string;
  body: string;
  delayDays: number;
}

interface SequenceEditorProps {
  steps: SequenceStep[];
  onStepsChange: (steps: SequenceStep[]) => void;
}

// Renders a list of step cards
// Step 0: "Intro Email" (no delay, always first)
// Steps 1-4: "Follow-up N" with delay_days input + subject + body
// "Add Step" button (up to 5 max)
// "Remove Step" button on each step (except intro)
// Each step has a mini TemplateEditor (subject + body) without the AI panel
```

### process-campaigns Drip Processing (NEW section)

```typescript
// AFTER the existing scheduled/active campaign processing, ADD:

// Step 3: Process drip sequence enrollments
const { data: dueEnrollments } = await supabaseAdmin
  .from('campaign_enrollments')
  .select('*, campaigns!inner(sequence_id, sent_by, status)')
  .eq('status', 'pending')
  .lte('next_send_at', new Date().toISOString())
  .not('next_send_at', 'is', null)
  .limit(50) // Process in chunks

for (const enrollment of dueEnrollments || []) {
  const campaign = enrollment.campaigns

  // Skip if campaign is paused or completed
  if (campaign.status === 'paused' || campaign.status === 'completed') continue

  // Skip if no sequence
  if (!campaign.sequence_id) continue

  // Fetch the step for current_step
  const { data: step } = await supabaseAdmin
    .from('campaign_steps')
    .select('*')
    .eq('sequence_id', campaign.sequence_id)
    .eq('step_order', enrollment.current_step)
    .single()

  if (!step) {
    // No more steps — mark enrollment complete
    await supabaseAdmin.from('campaign_enrollments')
      .update({ status: 'sent' }) // 'sent' = sequence complete
      .eq('id', enrollment.id)
    continue
  }

  // Check stop conditions
  const { data: unsub } = await supabaseAdmin.from('unsubscribes')
    .select('id').eq('email', enrollment.email).maybeSingle()
  if (unsub) {
    await supabaseAdmin.from('campaign_enrollments')
      .update({ status: 'unsubscribed' }).eq('id', enrollment.id)
    continue
  }

  // Fetch lead data for merge fields
  const lead = enrollment.lead_id ? ... : null // bulk fetch pattern

  // Build + send email (same pattern as existing campaign send)
  // Subject/body come from the STEP, not the campaign

  // After send: check if more steps exist
  const { data: nextStep } = await supabaseAdmin
    .from('campaign_steps')
    .select('delay_days')
    .eq('sequence_id', campaign.sequence_id)
    .eq('step_order', enrollment.current_step + 1)
    .maybeSingle()

  if (nextStep) {
    // More steps: increment and set next_send_at
    const nextSendAt = new Date(Date.now() + nextStep.delay_days * 24 * 60 * 60 * 1000)
    await supabaseAdmin.from('campaign_enrollments')
      .update({
        current_step: enrollment.current_step + 1,
        next_send_at: nextSendAt.toISOString(),
        sent_at: new Date().toISOString(),
      })
      .eq('id', enrollment.id)
  } else {
    // Last step: mark complete
    await supabaseAdmin.from('campaign_enrollments')
      .update({ status: 'sent', sent_at: new Date().toISOString(), next_send_at: null })
      .eq('id', enrollment.id)
  }
}
```

### CampaignBuilderPage — Sequence Toggle

```tsx
// Add state:
const [useSequence, setUseSequence] = useState(false);
const [steps, setSteps] = useState<{ subject: string; body: string; delayDays: number }[]>([]);

// In Step 2, add toggle above TemplateEditor:
<div className="flex gap-2 mb-4">
  <Button variant={!useSequence ? 'default' : 'outline'} size="sm" onClick={() => setUseSequence(false)}>
    Single Email
  </Button>
  <Button variant={useSequence ? 'default' : 'outline'} size="sm" onClick={() => setUseSequence(true)}>
    Multi-Step Sequence
  </Button>
</div>

// If single: show TemplateEditor (existing)
// If sequence: show SequenceEditor (step 0 uses the main subject/body, steps 1+ are follow-ups)

// On send/schedule with sequence:
// 1. Create campaign_sequences row
// 2. Create campaign_steps rows (one per step)
// 3. Set campaign.sequence_id
// 4. Create enrollments with current_step=0, next_send_at = now or scheduled_at
```

---

## Task Execution Order

### Task 1: Create SequenceEditor component
- `src/components/campaigns/SequenceEditor.tsx`
- Up to 5 steps, each with delay_days + subject + body
- Add/remove step buttons

### Task 2: Update campaigns API
- Add `createSequenceWithSteps(campaignId, steps)` — creates sequence + step rows, returns sequence_id
- Add `getSequenceSteps(sequenceId)` — fetches steps for display

### Task 3: Update CampaignBuilderPage
- Add single/sequence toggle in step 2
- When sequence: show SequenceEditor
- On send: create sequence + steps, set campaign.sequence_id, create enrollments with next_send_at

### Task 4: Update process-campaigns scheduler
- Add drip step processing after existing campaign processing
- Query enrollments with `next_send_at <= now()` and `status = 'pending'`
- Fetch step content, send email, increment step or mark complete
- Check stop conditions (unsubscribed, replied, bounced)

### Task 5: Update CampaignDetailPage
- Show sequence progress per recipient (which step they're on)
- Show step content for the campaign's sequence

### Task 6: Deploy + test

### Task 7: Update documentation

---

## Validation Gates

1. `npm run build` passes
2. Builder: toggle to "Multi-Step Sequence" → add 3 steps with delays
3. Send campaign with sequence → step 0 sends immediately
4. After delay_days (testable by setting delay to 0): step 1 sends on next scheduler tick
5. Lead replies → sequence stops for that lead (status='replied')
6. Lead unsubscribes → sequence stops (status='unsubscribed')
7. Campaign detail shows step progress per recipient
8. Pause campaign → drip stops. Resume → drip continues.

---

## Known Gotchas

```
1. Step 0 (intro) sends immediately or at scheduled_at. Steps 1+ use delay_days
   calculated from when the PREVIOUS step was sent (not from campaign start).

2. The scheduler processes 50 drip enrollments per run.

3. For testing, set delay_days to 0 — next step sends on next scheduler tick.

4. Stop conditions: unsubscribe/reply/bounce = stop. Opens/clicks = continue.

5. COLUMN NAME: campaign_steps uses 'order' NOT 'step_order'. Use .eq('order', ...).

6. RELATIONSHIP DIRECTION: campaigns.sequence_id → campaign_sequences.id.
   Create sequence first, then update campaign.sequence_id. There is NO
   campaign_id on campaign_sequences.

7. EXISTING SCHEDULER CONFLICT: The existing enrollment processing loop must
   add .is('next_send_at', null) to avoid picking up future drip enrollments.
   Step 0 enrollments have next_send_at=NULL (send immediately).
   Steps 1+ have next_send_at set to a future date.

8. DRIP QUERY: Do NOT use embedded Supabase joins like campaigns!inner(...).
   Use separate queries for reliability. Fetch campaign data separately.

9. createEnrollments MUST be extended to accept optional nextSendAt and
   currentStep params. For drip: step 0 gets next_send_at=NULL, current_step=0.

10. When last step sent: status='sent', next_send_at=NULL.
```

---

## Deprecated Code (to remove)

None — this adds sequence support alongside existing single-email campaigns.
