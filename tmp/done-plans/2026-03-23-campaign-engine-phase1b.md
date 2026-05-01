# Plan: Campaign Engine Phase 1b — Builder, Templates, AI Generation

**Confidence: 9/10** — Focused scope: 1 Edge Function, 5 components, 2 pages, 2 hooks/APIs. All DB tables already exist from Phase 1a.

## Goal

Build the multi-step campaign builder, template library with save/load, and AI template generation. Replace the old manual campaign mode in OutreachPage with the new builder. Keep the AI chatbot as supplemental (fills form fields).

## LLM Model Decision

- **Template generation + cleanup:** `openai/gpt-4.1-mini` via OpenRouter
  - Best creative writing quality at its price point ($0.40/$1.60 per M tokens)
  - Native `structured_outputs` support — existing `json_schema` pattern works
  - Temperature: `0.7` for generation (creative), `0.5` for cleanup (balanced)
- **Campaign AI targeting (unchanged):** `deepseek/deepseek-v3.2`
  - Keep for lead selection + filtering — it's good at structured reasoning
  - Temperature: `0.4` (unchanged)

---

## Files Being Changed

```
supabase/
├── functions/
│   └── generate-template/
│       └── index.ts                    ← NEW (AI template generation via GPT-4.1-mini)
src/
├── pages/
│   ├── CampaignBuilderPage.tsx         ← NEW (multi-step builder: audience → template → preview → send)
│   └── OutreachPage.tsx                ← MODIFIED (replace manual mode with "New Campaign" → builder)
├── components/
│   └── campaigns/
│       ├── AudienceSelector.tsx        ← NEW (lead filtering + selection)
│       ├── TemplateEditor.tsx          ← NEW (write/AI-generate/AI-cleanup)
│       └── TemplateLibrary.tsx         ← NEW (browse/select/delete saved templates)
├── hooks/
│   └── use-templates.ts               ← NEW (template CRUD hook)
├── lib/
│   └── api/
│       └── templates.ts               ← NEW (template CRUD)
├── App.tsx                             ← MODIFIED (add /outreach/campaign/new route)
docs/
├── campaigns.md                        ← MODIFIED (Phase 1b complete)
├── outreach.md                         ← MODIFIED (changelog)
├── OVERVIEW.md                         ← MODIFIED (changelog)
```

---

## Architecture Overview

### Campaign Builder Flow
```
OutreachPage → Campaigns tab → "+ New Campaign" button
  → Navigates to /outreach/campaign/new (CampaignBuilderPage)
    → Step 1: Campaign Name + Audience Selection (AudienceSelector)
    → Step 2: Template (TemplateEditor — manual, AI generate, AI cleanup, or load from library)
    → Step 3: Preview (see email with sample lead data, check merge fields)
    → Step 4: Confirm + Send (recipient count, send now or save as draft)
  → On send: creates campaign record + calls sendBulkEmails
  → Redirects back to /outreach with CampaignList showing the new campaign
```

### Template Library Flow
```
TemplateEditor has a "Load Template" button
  → Opens TemplateLibrary panel
    → Shows saved templates (from campaign_templates table)
    → Click one → fills subject + body in the editor
  → "Save as Template" button in editor
    → Prompts for template name → saves to campaign_templates
```

### AI Template Generation Flow
```
TemplateEditor → "AI Generate" button
  → Shows prompt textarea: "Describe the email you want..."
  → Click "Generate" → calls generate-template Edge Function
    → Edge Function calls GPT-4.1-mini via OpenRouter
    → Returns { subject, body }
  → Fills subject + body in the editor

TemplateEditor → "AI Improve" button
  → Takes current subject + body
  → Calls generate-template Edge Function with mode='cleanup'
  → Returns improved { subject, body }
  → Replaces in editor
```

---

## Key Pseudocode

### generate-template Edge Function

```typescript
// Model: openai/gpt-4.1-mini via OpenRouter
// Temperature: 0.7 for generation, 0.5 for cleanup
// JSON schema: { subject: string, body: string }

const { mode, prompt, existingSubject, existingBody } = await req.json()

const temperature = mode === 'cleanup' ? 0.5 : 0.7

const systemPrompt = mode === 'cleanup'
  ? 'You are a sales email copywriting expert. Improve the email template: make it more professional, concise, persuasive. Keep merge fields {{firstName}} and {{company}} intact. Vary sentence structure and use compelling hooks.'
  : 'You are a sales email copywriting expert. Generate a professional outreach email based on the description. Use {{firstName}} and {{company}} merge fields. 3-5 sentences, conversational but professional. Create a compelling subject line under 80 chars.'

// Call OpenRouter with GPT-4.1-mini
fetch('https://openrouter.ai/api/v1/chat/completions', {
  model: 'openai/gpt-4.1-mini',
  messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
  response_format: { type: 'json_schema', json_schema: { name: 'email_template', strict: true, schema: { type: 'object', properties: { subject: { type: 'string' }, body: { type: 'string' } }, required: ['subject', 'body'], additionalProperties: false } } },
  temperature,
})
```

### CampaignBuilderPage

```tsx
// Multi-step form
const [step, setStep] = useState(1) // 1=name+audience, 2=template, 3=preview, 4=confirm
const [campaignName, setCampaignName] = useState('')
const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set())
const [subject, setSubject] = useState('')
const [body, setBody] = useState('')

// Step 1: Name input + AudienceSelector component
// Step 2: TemplateEditor component (with AI generate/cleanup + library)
// Step 3: Preview card showing email with sample lead's data substituted
// Step 4: Summary + "Send Campaign" or "Save as Draft" buttons

// On send: same flow as existing handleSendCampaign but creates campaign with name
// On draft: creates campaign with status='draft', no emails sent
```

### AudienceSelector

```tsx
// Props: leads, selectedIds, onSelectionChange
// Filters: search, status (cold/lukewarm/warm), industry
// Table: checkbox + name + company + industry + status
// Select all / deselect all
// Shows: "X leads found" + "Y selected"
// Excludes unsubscribed leads (check unsubscribes table)
```

### TemplateEditor

```tsx
// Props: subject, body, onSubjectChange, onBodyChange
// AI Generate panel: describe → GPT-4.1-mini generates subject+body
// AI Improve button: sends current subject+body → GPT-4.1-mini improves
// Manual: subject input + body textarea with formatting toolbar
// Load from Library: opens TemplateLibrary panel
// Save as Template: prompts for name, saves to campaign_templates
```

---

## Task Execution Order

### Task 1: Create generate-template Edge Function
- `supabase/functions/generate-template/index.ts`
- Uses `openai/gpt-4.1-mini` via OpenRouter
- Two modes: `generate` (from description) and `cleanup` (improve existing)
- Temperature: 0.7 for generate, 0.5 for cleanup
- Deploy with `--no-verify-jwt`

### Task 2: Create template API + hook
- `src/lib/api/templates.ts` — getTemplates, createTemplate, deleteTemplate
- `src/hooks/use-templates.ts` — React Query hook with mutations

### Task 3: Create AudienceSelector component
- `src/components/campaigns/AudienceSelector.tsx`
- Lead filtering (search, status, industry) + checkbox selection
- Exclude unsubscribed leads

### Task 4: Create TemplateEditor component
- `src/components/campaigns/TemplateEditor.tsx`
- AI Generate (GPT-4.1-mini), AI Improve, manual edit, formatting toolbar
- Save to Library button

### Task 5: Create TemplateLibrary component
- `src/components/campaigns/TemplateLibrary.tsx`
- Browse saved templates, click to load, delete

### Task 6: Create CampaignBuilderPage
- `src/pages/CampaignBuilderPage.tsx`
- 4-step form: Name+Audience → Template → Preview → Send/Draft
- Uses AudienceSelector, TemplateEditor, TemplateLibrary
- On send: creates campaign + sends via sendBulkEmails
- On draft: creates campaign with status='draft'

### Task 7: Update OutreachPage
- Replace old manual mode UI with a simple "+ New Campaign" button
- Keep AI chatbot in AI mode (it still fills form fields — now for the builder)
- Actually: simplify campaigns tab to just CampaignList + "+ New Campaign" button
- The old manual recipient selection + compose steps are now in the builder

### Task 8: Update App.tsx
- Add `/outreach/campaign/new` route → CampaignBuilderPage (inside AppLayout)

### Task 9: Deploy + Test
- Deploy generate-template Edge Function
- Test AI generation
- Test full builder flow: name → audience → template → preview → send

### Task 10: Update Documentation
- `docs/campaigns.md` — Phase 1b complete
- `docs/outreach.md` — campaigns tab simplified
- `docs/OVERVIEW.md` — changelog

---

## Validation Gates

1. `npm run build` passes
2. generate-template Edge Function deploys and returns valid JSON
3. Smoke test: AI generate a template → valid subject + body returned
4. Smoke test: AI cleanup an existing template → improved version returned
5. Builder Step 1: name + audience selection works
6. Builder Step 2: AI generate fills template, manual edit works, load from library works
7. Builder Step 3: preview shows email with sample lead data
8. Builder Step 4: send campaign → emails delivered, campaign appears in list
9. Save as draft → campaign saved with status 'draft', no emails sent
10. Template library: save template → browse → load → delete

---

## Deprecated Code (to remove)

| Code | File | Reason |
|------|------|--------|
| Manual mode recipient selection (lines ~783-893) | OutreachPage.tsx | Moved to CampaignBuilderPage via AudienceSelector |
| Manual mode compose step | OutreachPage.tsx | Moved to CampaignBuilderPage via TemplateEditor |
| Campaign mode toggle (manual/ai) | OutreachPage.tsx | Builder replaces manual mode entirely |
| handleSendCampaign function | OutreachPage.tsx | Moved to CampaignBuilderPage |

Note: CampaignAIChat is REMOVED from OutreachPage and integrated INTO the CampaignBuilderPage's Step 2 (TemplateEditor). It fills the template fields directly in the builder context. The old manual/AI mode toggle in OutreachPage is fully replaced by the "+ New Campaign" → builder flow.

---

## Known Gotchas

```
1. GPT-4.1-mini on OpenRouter — VERIFY the exact model slug before hardcoding.
   Check https://openrouter.ai/openai/gpt-4.1-mini exists. If not, use
   'openai/gpt-4o-mini' as fallback. Log raw OpenRouter error body on non-200.

2. Temperature 0.7 for generation, 0.5 for cleanup, 0.4 for campaign AI targeting.

3. Campaign send flow: create with status='draft' FIRST → send emails → update
   status to 'active' ONLY on success. If send fails, campaign stays as draft
   so user can retry. Never leave a campaign in 'active' with no emails sent.

4. Template library: getTemplates MUST filter by created_by = current user's ID.
   Pass userId from the hook (via useAuth). createTemplate MUST include
   createdBy: user.id in the payload — the DB column is NOT NULL.

5. Route ordering in App.tsx: /outreach/campaign/new MUST be placed BEFORE
   /outreach/campaign/:id — otherwise React Router matches 'new' as an :id param.

6. CampaignAIChat is MOVED from OutreachPage INTO CampaignBuilderPage Step 2.
   It fills the template fields in the builder context. Remove it from OutreachPage.

4. Preview step should substitute {{firstName}} and {{company}} with the FIRST
   selected lead's actual data for a realistic preview.

5. The AudienceSelector should exclude leads that are in the unsubscribes table.
   Check by joining on email or lead_id.

6. Template library filter: show only templates created by the current user
   (WHERE created_by = auth.uid()) for privacy.

7. The "+ New Campaign" button navigates to /outreach/campaign/new.
   The back button in the builder navigates to /outreach.

8. Draft campaigns can be edited later — the builder should support loading
   an existing draft campaign by ID (stretch goal, not required for Phase 1b).
```
