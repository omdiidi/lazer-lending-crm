# Plan: Campaign Content Editing After Publish

## Goal

Add inline editing of campaign email subject and body on CampaignDetailPage. Only available for campaigns with pending sends (active/paused/scheduled). Uses existing `updateCampaign` mutation — no backend changes needed.

## Why

- Users need to fix typos or tweak content mid-campaign without cloning
- Backend already reads content from DB at send time — UI is the only gap
- `process-campaigns` picks up updated subject/body on the next batch automatically

## What

- Toggle subject/body from read-only text to editable inputs
- Edit button appears only when status is `active`, `paused`, or `scheduled`
- Save writes to campaigns table via existing `updateCampaign`
- A/B variant fields editable when `abTestEnabled`

### Success Criteria

- [ ] Edit button visible on active/paused/scheduled campaigns
- [ ] No edit button on completed/draft campaigns
- [ ] Subject and body toggle to inputs on edit
- [ ] Save persists changes and shows success toast
- [ ] Cancel discards changes and returns to read-only
- [ ] A/B variant subject/body editable when ab_test_enabled

## Files Being Changed

```
src/pages/CampaignDetailPage.tsx    ← MODIFIED (add inline editing)
```

## Architecture Overview

Single-file change. The "Email Content" card (lines 218-232) currently renders subject/body as `<p>` tags. We add:
- `isEditing` state toggle
- `editSubject`, `editBody` (and variant B equivalents) state
- Edit/Save/Cancel buttons
- Conditional render: `<p>` when viewing, `<Input>` / `<Textarea>` when editing

`updateCampaign` already accepts partial updates and is imported via `useCampaigns()` (line 35).

## Tasks

### Task 1: MODIFY `src/pages/CampaignDetailPage.tsx`

**1a. Add imports**

Add `Input` and `Textarea` to existing UI imports:
```typescript
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
```

Add `Pencil, Save, X` to lucide imports (line 20).

**1b. Add state variables** (after line 40)

```typescript
const isEditable = ['active', 'paused', 'scheduled'].includes(campaign?.status ?? '');
const [isEditing, setIsEditing] = useState(false);
const [editSubject, setEditSubject] = useState('');
const [editBody, setEditBody] = useState('');
const [editVariantBSubject, setEditVariantBSubject] = useState('');
const [editVariantBBody, setEditVariantBBody] = useState('');
const [saving, setSaving] = useState(false);
```

Note: `isEditable` must be declared AFTER the early return for `!campaign` (line 63-76). Move it after the early return, or compute it inline. Since `campaign` is used, place these state declarations after line 76 won't work (hooks can't be conditional). Instead, use `campaign?.status` with nullish fallback.

**1c. Add edit handlers**

```typescript
const handleStartEdit = () => {
  setEditSubject(campaign.subject);
  setEditBody(campaign.body);
  setEditVariantBSubject(campaign.variantBSubject || '');
  setEditVariantBBody(campaign.variantBBody || '');
  setIsEditing(true);
};

const handleCancelEdit = () => {
  setIsEditing(false);
};

const handleSaveEdit = async () => {
  if (!editSubject.trim() || !editBody.trim()) {
    toast.error('Subject and body are required');
    return;
  }
  setSaving(true);
  try {
    await updateCampaign(campaign.id, {
      subject: editSubject,
      body: editBody,
      ...(campaign.abTestEnabled && {
        variantBSubject: editVariantBSubject,
        variantBBody: editVariantBBody,
      }),
    });
    setIsEditing(false);
    toast.success('Campaign content updated');
  } catch {
    toast.error('Failed to update');
  } finally {
    setSaving(false);
  }
};
```

**1d. Replace the "Email Content" card** (lines 218-232)

Replace the static card with conditional edit/view rendering:

```tsx
<Card className="border">
  <CardHeader className="pb-2 flex flex-row items-center justify-between">
    <CardTitle className="text-sm">Email Content</CardTitle>
    {isEditable && !isEditing && (
      <Button variant="ghost" size="sm" className="gap-1.5 h-7" onClick={handleStartEdit}>
        <Pencil className="h-3.5 w-3.5" /> Edit
      </Button>
    )}
    {isEditing && (
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" className="gap-1 h-7" onClick={handleCancelEdit}>
          <X className="h-3.5 w-3.5" /> Cancel
        </Button>
        <Button size="sm" className="gap-1 h-7" onClick={handleSaveEdit} disabled={saving}>
          <Save className="h-3.5 w-3.5" /> {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    )}
  </CardHeader>
  <CardContent className="space-y-3">
    {isEditing ? (
      <>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Subject</p>
          <Input value={editSubject} onChange={e => setEditSubject(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Body</p>
          <Textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={6} />
        </div>
        {campaign.abTestEnabled && (
          <>
            <div className="space-y-1.5 pt-2 border-t">
              <p className="text-xs text-muted-foreground">Variant B Subject</p>
              <Input value={editVariantBSubject} onChange={e => setEditVariantBSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Variant B Body</p>
              <Textarea value={editVariantBBody} onChange={e => setEditVariantBBody(e.target.value)} rows={6} />
            </div>
          </>
        )}
      </>
    ) : (
      <>
        <div>
          <p className="text-xs text-muted-foreground">Subject</p>
          <p className="text-sm font-medium">{campaign.subject}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Body</p>
          <p className="text-sm whitespace-pre-line text-foreground">{campaign.body}</p>
        </div>
        {campaign.abTestEnabled && (
          <>
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground">Variant B Subject</p>
              <p className="text-sm font-medium">{campaign.variantBSubject}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Variant B Body</p>
              <p className="text-sm whitespace-pre-line text-foreground">{campaign.variantBBody}</p>
            </div>
          </>
        )}
      </>
    )}
  </CardContent>
</Card>
```

**1e. Check `updateCampaign` supports content fields**

The `updateCampaign` function in `use-campaigns.ts` passes updates through to `api.updateCampaign`. Verify it accepts `subject`, `body`, `variantBSubject`, `variantBBody` in the update payload. The campaigns table Update type in `database.ts` includes all of these, and the API function should map camelCase to snake_case via the transform layer. If it only whitelists specific fields (like just `status`), the API function needs to be updated to pass through content fields too.

## Validation Loop

```bash
npx tsc --noEmit
```

## Confidence: 9/10
