# Plan: Merge Field Dropdown & Expanded Template Variables

## Goal

Add an "Add Field" dropdown button to all email template editors that inserts merge tags at the cursor position. Expand supported merge fields from 3 to 10. Wire up all new fields in the campaign pipeline so they actually substitute correctly when emails send.

## Why

- Users currently type `{{firstName}}` manually — error-prone and undiscoverable
- Only 3 of 10+ available Lead fields are usable as merge fields
- New fields (jobTitle, industry, location, etc.) are valuable for personalized outreach

## What

- "Add Field" dropdown in TemplateEditor, SequenceEditor, ABVariantEditor
- 10 merge fields: firstName, lastName, fullName, jobTitle, company, industry, location, phone, email, unsubscribeLink
- All fields substitute correctly in campaign sends (bulk + drip) and preview

### Success Criteria

- [ ] "Add Field" dropdown visible in all 3 editors
- [ ] Clicking a field inserts the tag at textarea cursor position
- [ ] Preview shows substituted values for all fields
- [ ] Campaign sends (bulk + drip) substitute all fields
- [ ] Empty fields replace to empty string (no raw tags in sent emails)

## Files Being Changed

```
src/lib/merge-fields.ts                        ← NEW (shared MERGE_FIELDS constant + applyMergeFields helper)
src/components/campaigns/TemplateEditor.tsx    ← MODIFIED (add dropdown, insert at cursor)
src/components/campaigns/SequenceEditor.tsx    ← MODIFIED (add dropdown to intro + follow-ups)
src/components/campaigns/ABVariantEditor.tsx   ← MODIFIED (add dropdown)
src/pages/CampaignBuilderPage.tsx              ← MODIFIED (expand preview + send replacements)
supabase/functions/process-campaigns/index.ts  ← MODIFIED (expand field fetch + replacements)
```

## Architecture Overview

```
MERGE_FIELDS constant (shared definition)
  ├── TemplateEditor → "Add Field" dropdown → inserts at cursor in body textarea
  ├── SequenceEditor → same dropdown for intro + follow-up textareas
  ├── ABVariantEditor → same dropdown for variant B textarea
  ├── CampaignBuilderPage → preview substitution + immediate send substitution
  └── process-campaigns → bulk + drip path substitution
```

All replacements use a shared `applyMergeFields(text, leadData)` helper from `src/lib/merge-fields.ts` (frontend) and an inlined copy in the edge function (Deno can't import from src/).

## All Needed Context

### Merge Fields Definition

```typescript
const MERGE_FIELDS = [
  { label: 'First Name', tag: '{{firstName}}' },
  { label: 'Last Name', tag: '{{lastName}}' },
  { label: 'Full Name', tag: '{{fullName}}' },
  { label: 'Job Title', tag: '{{jobTitle}}' },
  { label: 'Company', tag: '{{company}}' },
  { label: 'Industry', tag: '{{industry}}' },
  { label: 'Location', tag: '{{location}}' },
  { label: 'Phone', tag: '{{phone}}' },
  { label: 'Email', tag: '{{email}}' },
  { label: 'Unsubscribe Link', tag: '{{unsubscribeLink}}' },
] as const
```

### Insert at Cursor Pattern

```typescript
const insertAtCursor = (textarea: HTMLTextAreaElement, text: string, currentValue: string, onChange: (v: string) => void) => {
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const newValue = currentValue.slice(0, start) + text + currentValue.slice(end)
  onChange(newValue)
  // Refocus and set cursor after inserted text
  requestAnimationFrame(() => {
    textarea.focus()
    textarea.setSelectionRange(start + text.length, start + text.length)
  })
}
```

### Replacement Helper (for edge function)

```typescript
function applyMergeFields(text: string, data: {
  first_name?: string; last_name?: string; company?: string;
  job_title?: string; industry?: string; location?: string;
  phone?: string; email?: string;
}): string {
  return text
    .replace(/\{\{firstName\}\}/g, data.first_name || '')
    .replace(/\{\{lastName\}\}/g, data.last_name || '')
    .replace(/\{\{fullName\}\}/g, [data.first_name, data.last_name].filter(Boolean).join(' '))
    .replace(/\{\{jobTitle\}\}/g, data.job_title || '')
    .replace(/\{\{company\}\}/g, data.company || '')
    .replace(/\{\{industry\}\}/g, data.industry || '')
    .replace(/\{\{location\}\}/g, data.location || '')
    .replace(/\{\{phone\}\}/g, data.phone || '')
    .replace(/\{\{email\}\}/g, data.email || '')
}
```

### Current TemplateEditor Toolbar (lines 136-141)

```tsx
<div className="flex items-center gap-0.5 px-2 py-1.5 border rounded-t-md bg-muted/30 border-b-0">
  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Bold" onMouseDown={e => e.preventDefault()}>...
  <!-- non-functional placeholder buttons -->
</div>
```

The "Add Field" dropdown goes here, after the existing toolbar buttons. Use shadcn `DropdownMenu` component.

### SequenceEditor Structure

- **Intro email** (line 52-63): has subject Input + body Textarea + merge field hint text
- **Follow-up steps** (lines 66-98): each has subject Input + body Textarea, NO merge field hint
- Both need the dropdown

### ABVariantEditor Structure

- Single subject Input (line 26) + body Textarea (line 30) + merge field hint (line 32)

### shadcn DropdownMenu

Already available at `@/components/ui/dropdown-menu`. Uses:
```tsx
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
```

## Known Gotchas

1. **Textarea ref needed for cursor position** — need a `useRef<HTMLTextAreaElement>` to access `selectionStart`. The shadcn `Textarea` forwards refs.

2. **SequenceEditor has multiple textareas** — intro body + N follow-up bodies. Need refs for each. Use a Map or array of refs.

3. **CampaignBuilderPage immediate send** (line 150-151) uses non-regex `.replace('{{firstName}}', ...)` which only replaces the first occurrence. Change to regex `/\{\{firstName\}\}/g` for consistency.

4. **process-campaigns currently fetches** `id, first_name, company, timezone, email_status` — needs to also fetch `last_name, job_title, industry, location, phone, email`.

5. **`{{unsubscribeLink}}` replacement is handled separately** in process-campaigns and send-email because it generates a unique token per recipient. Don't include it in the generic `applyMergeFields` helper.

## Tasks (in implementation order)

### Task 0: Create shared merge-fields module

**CREATE `src/lib/merge-fields.ts`**

```typescript
export const MERGE_FIELDS = [
  { label: 'First Name', tag: '{{firstName}}' },
  { label: 'Last Name', tag: '{{lastName}}' },
  { label: 'Full Name', tag: '{{fullName}}' },
  { label: 'Job Title', tag: '{{jobTitle}}' },
  { label: 'Company', tag: '{{company}}' },
  { label: 'Industry', tag: '{{industry}}' },
  { label: 'Location', tag: '{{location}}' },
  { label: 'Phone', tag: '{{phone}}' },
  { label: 'Email', tag: '{{email}}' },
  { label: 'Unsubscribe Link', tag: '{{unsubscribeLink}}' },
] as const

export function applyMergeFields(text: string, data: {
  firstName?: string; lastName?: string; jobTitle?: string; company?: string;
  industry?: string; location?: string; phone?: string; email?: string;
}): string {
  return text
    .replace(/\{\{firstName\}\}/g, data.firstName || '')
    .replace(/\{\{lastName\}\}/g, data.lastName || '')
    .replace(/\{\{fullName\}\}/g, [data.firstName, data.lastName].filter(Boolean).join(' '))
    .replace(/\{\{jobTitle\}\}/g, data.jobTitle || '')
    .replace(/\{\{company\}\}/g, data.company || '')
    .replace(/\{\{industry\}\}/g, data.industry || '')
    .replace(/\{\{location\}\}/g, data.location || '')
    .replace(/\{\{phone\}\}/g, data.phone || '')
    .replace(/\{\{email\}\}/g, data.email || '')
}
```

Note: `applyMergeFields` uses camelCase keys to match the frontend `Lead` type. The edge function will have its own copy with snake_case keys. Does NOT handle `{{unsubscribeLink}}` — that's generated per-recipient elsewhere.

### Task 1: TemplateEditor — add "Add Field" dropdown

**MODIFY `src/components/campaigns/TemplateEditor.tsx`**

1a. Add imports: `DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger` from `@/components/ui/dropdown-menu`, `ChevronDown` from `lucide-react`, `useRef`. Import `MERGE_FIELDS` from `@/lib/merge-fields`.

1c. Add a `bodyRef = useRef<HTMLTextAreaElement>(null)` for the body textarea.

1d. Add the ref to the Textarea at line 142: `<Textarea ref={bodyRef} ...`

1e. Add an `insertField` function that inserts a tag at the cursor position using `bodyRef.current`.

1f. In the toolbar div (line 136-141), add the "Add Field" DropdownMenu after the existing placeholder buttons:
```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1" onMouseDown={e => e.preventDefault()}>
      Add Field <ChevronDown className="h-3 w-3" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="start">
    {MERGE_FIELDS.map(field => (
      <DropdownMenuItem key={field.tag} onSelect={() => insertField(field.tag)}>
        {field.label} <span className="ml-auto text-xs text-muted-foreground">{field.tag}</span>
      </DropdownMenuItem>
    ))}
  </DropdownMenuContent>
</DropdownMenu>
```

1g. Remove the static merge field hint text at line 143. The dropdown replaces it.

### Task 2: ABVariantEditor — add same dropdown

**MODIFY `src/components/campaigns/ABVariantEditor.tsx`**

2a. Add imports: DropdownMenu components, Button, ChevronDown, useRef. Import `MERGE_FIELDS` from `@/lib/merge-fields`.

2b. Add `bodyRef` and `insertField` function (same pattern as TemplateEditor).

2c. Add a toolbar div between the Body Label and Textarea, matching TemplateEditor's pattern:
```tsx
<div className="flex items-center gap-0.5 px-2 py-1.5 border rounded-t-md bg-muted/30 border-b-0">
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1">
        Add Field <ChevronDown className="h-3 w-3" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      {MERGE_FIELDS.map(field => (
        <DropdownMenuItem key={field.tag} onSelect={() => insertField(field.tag)}>
          {field.label} <span className="ml-auto text-xs text-muted-foreground">{field.tag}</span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
</div>
```
Add `rounded-t-none` to the Textarea class, and add `ref={bodyRef}` to it.

2d. Remove the static merge field hint text at line 32.

### Task 3: SequenceEditor — add dropdown to intro + follow-ups

**MODIFY `src/components/campaigns/SequenceEditor.tsx`**

3a. Add imports: DropdownMenu components, Button, ChevronDown, useRef. Import `MERGE_FIELDS` from `@/lib/merge-fields`.

3b. Add `introBodyRef = useRef<HTMLTextAreaElement>(null)` for the intro textarea.

3c. Add `followUpBodyRefs = useRef<(HTMLTextAreaElement | null)[]>([])` for follow-up textareas. Assign via callback ref: `ref={el => { followUpBodyRefs.current[i] = el }}`.

3d. Add an `insertField(ref: React.RefObject<HTMLTextAreaElement> | HTMLTextAreaElement | null, tag: string, currentValue: string, onChange: (v: string) => void)` function that handles both ref types.

3e. For the intro body textarea (line 59): add `ref={introBodyRef}`, add the toolbar div with "Add Field" dropdown above it (same pattern as TemplateEditor).

3f. For each follow-up body textarea (line 95): add the callback ref, add the toolbar div with dropdown above it. The dropdown's `onSelect` calls `insertField` with the correct ref element.

3g. Remove the static merge field hint text at line 61.

**IMPORTANT:** Do NOT use `useRef` inside the `.map()` callback — that violates rules of hooks. Use the array ref pattern: `followUpBodyRefs.current[i]`.

### Task 4: CampaignBuilderPage — expand preview + send replacements

**MODIFY `src/pages/CampaignBuilderPage.tsx`**

4a. Update the preview substitution (lines 68-73) to include all new fields. Use the sampleLead object which already has all Lead fields:
```typescript
const previewSubject = sampleLead
  ? subject
    .replace(/\{\{firstName\}\}/g, sampleLead.firstName)
    .replace(/\{\{lastName\}\}/g, sampleLead.lastName)
    .replace(/\{\{fullName\}\}/g, `${sampleLead.firstName} ${sampleLead.lastName}`.trim())
    .replace(/\{\{jobTitle\}\}/g, sampleLead.jobTitle || '')
    .replace(/\{\{company\}\}/g, sampleLead.company)
    .replace(/\{\{industry\}\}/g, sampleLead.industry || '')
    .replace(/\{\{location\}\}/g, sampleLead.location || '')
    .replace(/\{\{phone\}\}/g, sampleLead.phone || '')
    .replace(/\{\{email\}\}/g, sampleLead.email || '')
  : subject;
```
Same for previewBody, plus keep the existing `{{unsubscribeLink}}` → `#unsubscribe` replacement.

4b. Update the immediate send substitution (lines 150-151) with the same expanded replacements using `applyMergeFields(text, lead)`. Import `applyMergeFields` from `@/lib/merge-fields`. Change from single `.replace()` to the helper.

**IMPORTANT: Do NOT add `{{unsubscribeLink}}` replacement in the send path.** The `send-email` edge function handles it per-recipient with unique tokens. Only replace it in `previewBody` (with `#unsubscribe`).

### Task 5: process-campaigns — expand field fetch + replacements

**MODIFY `supabase/functions/process-campaigns/index.ts`**

5a. **Add `applyMergeFields` helper function** at the top of the file (after imports). Does NOT handle `{{unsubscribeLink}}` — that's still handled separately.

5b. **Bulk path — expand leads fetch** (line 96):
```typescript
.select('id, first_name, last_name, email, phone, job_title, company, industry, location, company_size, timezone, email_status')
```

5c. **Bulk path — expand leadMap type and storage** (lines 99-102):
```typescript
const leadMap = new Map<string, {
  first_name: string; last_name: string; email: string; phone: string;
  job_title: string; company: string; industry: string; location: string;
  company_size: string; timezone: string | null; email_status: string | null;
}>()
for (const l of leadsData || []) {
  leadMap.set(l.id, {
    first_name: l.first_name, last_name: l.last_name || '', email: l.email || '',
    phone: l.phone || '', job_title: l.job_title || '', company: l.company,
    industry: l.industry || '', location: l.location || '',
    company_size: l.company_size || '', timezone: l.timezone ?? null,
    email_status: l.email_status ?? null,
  })
}
```

5d. **Bulk path — replace the inline `.replace()` chains** (lines 163-168) with `applyMergeFields()` calls:
```typescript
let emailBody = applyMergeFields(templateBody, lead || {})
const emailSubject = applyMergeFields(templateSubject, lead || {})
```
Keep the `{{unsubscribeLink}}` replacement block as-is (lines 171-175).

5e. **Drip path — expand lead fetch** (around line 289):
```typescript
.select('first_name, last_name, email, phone, job_title, company, industry, location')
```

5f. **Drip path — replace inline `.replace()` chains** (around lines 322-323) with `applyMergeFields()`:
```typescript
const leadData = lead || { first_name: '', last_name: '', company: '', job_title: '', industry: '', location: '', phone: '', email: '' }
const emailSubject = applyMergeFields(step.subject, leadData)
let emailBody = applyMergeFields(step.body, leadData)
```
Keep `{{unsubscribeLink}}` handling as-is.

### Task 6: Deploy process-campaigns

```bash
supabase functions deploy process-campaigns --no-verify-jwt
```

## Validation Loop

```bash
npm run lint
```

Check:
1. "Add Field" dropdown visible in TemplateEditor, SequenceEditor, ABVariantEditor
2. Clicking a field inserts the tag at cursor
3. Preview shows substituted values
4. No raw `{{tags}}` in sent emails

## Deprecated Code

- Remove static merge field hint text from TemplateEditor (line 143), SequenceEditor (line 61), ABVariantEditor (line 32)
- Replace placeholder toolbar buttons in TemplateEditor (Bold, Italic, Link, List) — KEEP them, they're harmless UI placeholders

## Confidence Score: 8/10

Straightforward feature. The main complexity is handling refs across multiple textareas in SequenceEditor. All other changes are simple string replacement expansions.
