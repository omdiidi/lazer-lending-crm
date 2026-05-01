# Brief: Campaign Content Editing After Publish

## Why
Users need to edit campaign email content (subject/body) after a campaign has been published, without having to clone and recreate. The backend already reads content from the DB at send time, so updating the content mid-campaign is safe — only the UI is missing.

## Context
- `CampaignDetailPage.tsx` renders subject/body as read-only `<p>` tags (~lines 218-232)
- `process-campaigns/index.ts` reads `campaign.subject` and `campaign.body` live from DB at send time (lines 259-260), so any DB update is picked up by the next batch
- A/B variant fields (`variant_b_subject`, `variant_b_body`) also exist and should be editable
- `campaigns` table Update type already accepts subject/body/variant fields
- `updateCampaign` mutation already exists (used for pause/resume) — can reuse for content updates
- Available actions on detail page: Pause, Resume, Clone. No edit currently.

## Decisions
- **Inline editing on CampaignDetailPage** — click to toggle subject/body from display to input, save button writes to campaigns table
- **Only available for campaigns with pending sends** — status `active`, `paused`, or `scheduled`. Completed campaigns stay read-only.
- **No separate edit page or modal** — keep it simple, edit in place
- **Covers A/B variants too** — if `ab_test_enabled`, both variant A and B fields are editable

## Rejected Alternatives
- **Separate CampaignEditPage** — unnecessary complexity, inline editing is sufficient
- **Edit modal/overlay** — extra UI layer for no benefit
- **Edit for all statuses** — completed campaigns have no pending sends, editing is meaningless

## Direction
Add inline edit capability to CampaignDetailPage for subject and body fields. Show an Edit button when campaign status is active/paused/scheduled. Toggle fields to inputs, save via existing `updateCampaign` mutation. No new routes or pages needed.
