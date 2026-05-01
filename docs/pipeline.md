# Pipeline & Deals

> Kanban board for managing deals through 7 sales stages with drag-and-drop.

**Status:** Active
**Last Updated:** 2026-03-23
**Related Docs:** [OVERVIEW.md](./OVERVIEW.md) | [state-management.md](./state-management.md) | [data-model.md](./data-model.md) | [leads.md](./leads.md)

---

## Overview

The Pipeline page (`/pipeline`) displays all deals in a horizontal Kanban board with 7 columns representing sales stages. Deals can be moved between stages via drag-and-drop. The header shows total deal count and active pipeline value. Data is filtered by role — employees see only their assigned deals.

---

## File Map

| File | Purpose |
|------|---------|
| `src/pages/PipelinePage.tsx` | Entire pipeline UI and drag-and-drop logic |

---

## Detailed Behavior

### Pipeline Stages

| Order | Key | Label | Column Color |
|-------|-----|-------|-------------|
| 1 | `new` | New | `bg-slate-100` |
| 2 | `contacted` | Contacted | `bg-blue-50` |
| 3 | `qualified` | Qualified | `bg-amber-50` |
| 4 | `proposal` | Proposal | `bg-orange-50` |
| 5 | `negotiation` | Negotiation | `bg-purple-50` |
| 6 | `closed_won` | Closed Won | `bg-emerald-50` |
| 7 | `closed_lost` | Closed Lost | `bg-red-50` |

### Page Header
- Title: "Pipeline"
- Subtitle: `[N] deals · $[X] active pipeline`
- Active pipeline value = sum of all deal values **excluding** `closed_won` and `closed_lost` stages
- **"+ New Deal" button** — opens a dialog with fields: lead selector (dropdown of all leads), title, value, and stage; on submit calls `createDeal()` and closes the dialog

### Column Layout
- Fixed-width columns: 240px each
- Horizontal scroll container (`overflow-x-auto`)
- Each column has min-height 400px (ensures drop zone even when empty)
- Columns are laid out in a `flex` row with 12px gap

### Column Header
- Stage label (uppercase, extra-small, semi-bold)
- Deal count badge (secondary variant)
- Total dollar value for that stage

### Deal Cards

Each deal is rendered as a `Card` component:

| Field | Display |
|-------|---------|
| Title | `deal.title` (semi-bold) |
| Lead Name | Looked up from `leads` array via `deal.leadId` |
| Value | `$[deal.value.toLocaleString()]` with DollarSign icon |
| Assigned Rep | **Admin only** — first name of assigned user (from `mockUsers`) |

Cards have: `cursor-grab` (idle), `cursor-grabbing` (while dragging), border + shadow styling

### Drag-and-Drop

Uses native HTML5 Drag and Drop API:

```typescript
// On card
draggable={true}
onDragStart={() => handleDragStart(deal.id)}  // Sets draggedDeal state
onDragEnd={handleDragEnd}                      // Clears draggedDeal state

// On column
onDragOver={e => e.preventDefault()}           // Allow drop
onDrop={() => handleDrop(stage.key)}           // Update deal stage
```

**`handleDrop(stage)`:**
1. Calls `updateDeal(draggedDeal, { stage, updatedAt: new Date().toISOString() })`
2. Clears `draggedDeal` state

### Role-Based Filtering
- **Admin:** Sees all deals, shows assigned rep on each card
- **Employee:** Sees only deals where `assignedTo === user.id`, no rep name shown

---

## Component & Function Reference

### PipelinePage (default export)

**Hooks:** `useDeals()`, `useLeads()`, `useProfiles()`, `useAuth()`, `useState`

**State:**
| State | Type | Purpose |
|-------|------|---------|
| `draggedDeal` | `string \| null` | ID of deal currently being dragged |
| `newDealOpen` | `boolean` | Controls "+ New Deal" dialog visibility |
| `newDeal` | object | Form state for the new deal dialog (leadId, title, value, stage) |

**Functions:**
- `handleDragStart(dealId)` — stores deal ID in state
- `handleDragEnd()` — clears dragged deal state
- `handleDrop(stage)` — updates deal's stage and updatedAt via `updateDeal()`
- `getLeadName(leadId)` — looks up lead name from leads array
- `handleCreateDeal()` — validates new deal form and calls `createDeal()`, then closes dialog

**Constants:**
- `stages` — array of `{ key: DealStage, label: string, color: string }` defining column order and styling

### Hook Mutations Used
- `updateDeal(id, { stage, updatedAt })` — on drag-and-drop
- `createDeal(data)` — on New Deal dialog submit

---

## Data Dependencies

| Data | Source | Used For |
|------|--------|----------|
| Deals | `useDeals()` | Card rendering, stage grouping |
| Leads | `useLeads()` | Lead name lookup for deal cards |
| Profiles | `useProfiles()` | Assigned rep name (admin view) |
| Current User | `useAuth().user` | — |
| isAdmin | `useAuth().isAdmin` | Rep name visibility |

---

## Known Limitations & TODOs

- Deal creation is available via the "+ New Deal" dialog (lead selector, title, value, stage)
- No deal editing beyond stage changes (no value, title, or assignment editing)
- No deal deletion
- No deal detail view / modal
- No drag-and-drop visual feedback (no highlight on valid drop zones)
- No deal reordering within a stage (only between stages)
- No probability/weighting by stage
- No expected close dates
- No win/loss reason tracking
- No deal notes or activity timeline
- No deal value editing
- No deal-to-lead navigation (clicking a card does nothing)
- No mobile-friendly alternative to drag-and-drop (touch devices)

---

## Future Considerations

- Add deal creation modal/form
- Add deal detail view (modal or page at `/pipeline/:id`)
- Add drag-and-drop visual feedback (highlight target column on hover)
- Add deal-to-lead linking (click deal → navigate to lead detail)
- Add probability percentages by stage for weighted pipeline value
- Add expected close dates with overdue indicators
- Consider using a library like `@hello-pangea/dnd` for richer DnD experience
- Add deal filters (by value range, assigned rep, date)
- Add mobile touch-friendly stage selector as alternative to DnD

---

## Changelog

| Date | Change | Files Affected |
|------|--------|----------------|
| 2026-03-22 | Initial documentation created | — |
| 2026-03-23 | Data from Supabase, role filtering via RLS, mockUsers replaced | `PipelinePage.tsx` |
| 2026-03-23 | Deal creation: New Deal dialog with lead selector, title, value, stage | PipelinePage.tsx |
