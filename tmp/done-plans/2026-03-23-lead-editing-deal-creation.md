# Plan: Phase A — Lead Editing + Deal Creation UI

**Confidence: 9/10** — Both APIs already exist. Pure UI work in 2 files.

## Goal

Make lead fields editable on the detail page (not just status). Add a "New Deal" dialog on the pipeline page.

## Files Being Changed

```
src/
├── pages/
│   ├── LeadDetailPage.tsx              ← MODIFIED (editable fields + save)
│   └── PipelinePage.tsx                ← MODIFIED (add "New Deal" dialog)
docs/
├── leads.md                            ← MODIFIED
├── pipeline.md                         ← MODIFIED
├── OVERVIEW.md                         ← MODIFIED
```

---

## Architecture Overview

### Lead Editing
Currently: read-only display fields (name, company, email, phone, etc.) + status dropdown.
After: all fields become editable with a Save button. Uses existing `updateLead()` mutation.

### Deal Creation
Currently: kanban board with drag-and-drop only, no way to create deals.
After: "+ New Deal" button opens dialog with lead selector, title, value, stage. Uses existing `createDeal()` mutation.

---

## Key Pseudocode

### LeadDetailPage — Editable Fields

```tsx
// Add editing state
const [editing, setEditing] = useState(false);
const [editData, setEditData] = useState({
  firstName: '', lastName: '', email: '', phone: '',
  jobTitle: '', company: '', companySize: '', industry: '',
  location: '', notes: '', linkedinUrl: '',
});

// Initialize editData when lead loads
useEffect(() => {
  if (lead) setEditData({
    firstName: lead.firstName, lastName: lead.lastName, email: lead.email,
    phone: lead.phone, jobTitle: lead.jobTitle, company: lead.company,
    companySize: lead.companySize, industry: lead.industry,
    location: lead.location, notes: lead.notes, linkedinUrl: lead.linkedinUrl || '',
  });
}, [lead]);

// Save handler
const handleSave = async () => {
  await updateLead(lead.id, editData);
  setEditing(false);
  toast.success('Lead updated');
};

// Toggle: "Edit" button switches to editable mode
// In editable mode: Input fields replace static text
// Save + Cancel buttons appear
```

### PipelinePage — New Deal Dialog

```tsx
// State
const [showNewDeal, setShowNewDeal] = useState(false);
const [dealTitle, setDealTitle] = useState('');
const [dealValue, setDealValue] = useState('');
const [dealLeadId, setDealLeadId] = useState('');
const [dealStage, setDealStage] = useState<DealStage>('new');

// Handler
const handleCreateDeal = async () => {
  await createDeal({
    leadId: dealLeadId,
    title: dealTitle.trim(),
    value: parseFloat(dealValue) || 0,
    stage: dealStage,
    assignedTo: user.id,
  });
  setShowNewDeal(false);
  // Reset fields
  toast.success('Deal created');
};

// Dialog: lead search dropdown, title input, value input ($), stage select
// "+ New Deal" button at the top of the pipeline header
```

---

## Task Execution Order

### Task 1: Update LeadDetailPage for editing

Make all lead fields editable:
- Add "Edit" button in the header (pencil icon)
- When editing: fields become Input components with values from editData state
- Fields: firstName, lastName, email, phone, jobTitle, company, companySize, industry, location, notes, linkedinUrl
- Save button calls `updateLead()` with the changed fields
- Cancel button reverts to read-only mode
- Status dropdown stays as-is (already works)
- Toast notification on save

### Task 2: Update PipelinePage with New Deal dialog

Add deal creation:
- "+ New Deal" button in the pipeline header (next to the title/metrics)
- Dialog with fields: Lead (search dropdown from leads list), Title, Value ($), Stage (dropdown with all 7 stages)
- Create button calls `createDeal()` from `useDeals()`
- Dialog closes on success, pipeline refreshes automatically (React Query invalidation)
- Lead selector searches by firstName, lastName, company

### Task 3: Update documentation
- `docs/leads.md` — lead editing now works
- `docs/pipeline.md` — deal creation dialog added
- `docs/OVERVIEW.md` — changelog

---

## Validation Gates

1. `npm run build` passes
2. Lead detail: click Edit → fields become editable → change name → Save → refreshes with new name
3. Lead detail: Cancel reverts changes
4. Pipeline: click "+ New Deal" → dialog opens → fill fields → Create → deal appears in correct stage column
5. All docs updated

---

## Known Gotchas

```
1. updateLead strips id, createdAt, updatedAt before sending to Supabase.
   Only send the fields that actually changed.

2. createDeal needs leadId, title, value, stage, assignedTo.
   assignedTo should default to the current user.

3. The lead selector in the deal dialog should search emailSafeLeads or
   all leads? Use all leads — deals can exist for any lead regardless of
   email status.

4. Deal value is stored as number (numeric(12,2) in DB). Parse from string
   input with parseFloat.

5. After creating a deal, React Query invalidates ['deals'] automatically
   via the mutation's onSuccess callback.
```

---

## Deprecated Code (to remove)

None — adds new UI to existing pages.
