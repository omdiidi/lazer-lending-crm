# Brief: Merge Field Dropdown Button for Email Templates

## Why
Users currently have to manually type `{{firstName}}`, `{{company}}`, etc. into email templates. Only 3 merge fields are supported. Most Lead fields (lastName, jobTitle, industry, location, etc.) are available in the database but not wired up as merge fields. Need a clean "Add Field" dropdown that inserts tags at the cursor and ensures all fields actually substitute correctly when emails are sent.

## Context

### Current State
- 3 merge fields supported: `{{firstName}}`, `{{company}}`, `{{unsubscribeLink}}`
- Text hint shown at bottom of TemplateEditor, SequenceEditor, ABVariantEditor
- Replacement happens via regex `.replace()` in multiple places
- Toolbar buttons (Bold, Italic, etc.) in TemplateEditor are non-functional placeholders

### Files That Need Merge Field Changes
- `src/components/campaigns/TemplateEditor.tsx` — main template editor, add dropdown button
- `src/components/campaigns/SequenceEditor.tsx` — drip step editor, add same dropdown
- `src/components/campaigns/ABVariantEditor.tsx` — variant B editor, add same dropdown
- `src/pages/CampaignBuilderPage.tsx` — preview rendering (lines 68-72), add new field replacements
- `supabase/functions/process-campaigns/index.ts` — bulk path (lines 163-168) + drip path (lines 322-329), add new field replacements + fetch new fields from DB
- `supabase/functions/send-email/index.ts` — only handles `{{unsubscribeLink}}`, no other merge fields needed here (substitution happens before send)

### Lead Fields Available (from src/types/crm.ts)
`firstName`, `lastName`, `email`, `phone`, `jobTitle`, `company`, `companySize`, `industry`, `location`, `linkedinUrl`

### Replacement Points
1. **process-campaigns bulk path** — fetches `id, first_name, company, timezone, email_status` from leads table. Needs to also fetch `last_name, job_title, industry, location, company_size, phone, email`.
2. **process-campaigns drip path** — fetches `first_name, company, email_status` from leads table. Same expansion needed.
3. **CampaignBuilderPage preview** — uses sampleLead object which already has all Lead fields in memory. Just add `.replace()` calls.

## Decisions

### Merge fields to support (10 total)
| Label | Tag | Source Field | New? |
|---|---|---|---|
| First Name | `{{firstName}}` | first_name | Existing |
| Last Name | `{{lastName}}` | last_name | New |
| Full Name | `{{fullName}}` | first_name + ' ' + last_name | New (composite) |
| Job Title | `{{jobTitle}}` | job_title | New |
| Company | `{{company}}` | company | Existing |
| Industry | `{{industry}}` | industry | New |
| Location | `{{location}}` | location | New |
| Phone | `{{phone}}` | phone | New |
| Email | `{{email}}` | email | New |
| Unsubscribe Link | `{{unsubscribeLink}}` | generated per-send | Existing |

### UI: "Add Field" dropdown button
- Popover or DropdownMenu component (shadcn) with the field list
- Clicking a field inserts the tag at the current cursor position in the textarea
- Replace the static text hint with the button
- Same button appears in TemplateEditor, SequenceEditor, and ABVariantEditor

### Insert at cursor position
- Use `textarea.selectionStart` / `textarea.selectionEnd` to get cursor position
- Insert the tag text at that position
- Update the state value
- Refocus the textarea after insertion

### Replacement must work end-to-end
- All new fields must be replaced in process-campaigns (both bulk and drip paths)
- All new fields must be replaced in CampaignBuilderPage preview
- Fields with no value should replace to empty string (not leave the tag visible)

## Rejected Alternatives
- **Rich text editor (Tiptap/Slate)** — overkill for now, emails are text-only via Resend
- **Inline autocomplete (type {{ to trigger)** — nice but complex, dropdown is simpler and more discoverable
- **Conditional merge fields (if/else)** — too complex for current needs

## Direction
Add an "Add Field" dropdown button to TemplateEditor, SequenceEditor, and ABVariantEditor that inserts merge tags at the cursor position. Expand supported merge fields from 3 to 10 (adding lastName, fullName, jobTitle, industry, location, phone, email). Wire up all new fields in process-campaigns (both bulk and drip paths) and CampaignBuilderPage preview. Ensure empty fields replace to empty string.
