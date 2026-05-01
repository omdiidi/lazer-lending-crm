# Plan: Campaign Engine Phase 1a — Database Schema, Campaign List, Analytics, Unsubscribe

**Confidence: 9/10** — Focused scope: all DB migrations, campaign list with analytics, unsubscribe infrastructure. No complex builder UI (that's Phase 1b). All reviewer feedback incorporated.

**SPLIT NOTE:** The original Phase 1 was too large. This is **Phase 1a** (foundation + analytics + unsubscribe). **Phase 1b** (campaign builder, templates, AI integration) follows in the next session.

## Goal

Build the database foundation for the entire campaign engine (all 3 phases), add a campaign management list with per-campaign analytics, implement unsubscribe infrastructure, and enable campaign cloning. Phase 1b will add the multi-step builder and template library on top of this foundation.

## Why

- Current campaigns tab is a chatbot + manual mode — not scalable for real sales workflows
- No analytics, no template reuse, no unsubscribe handling, no campaign management
- Salespeople need to see campaign performance at a glance and manage multiple campaigns

## What — Phase 1a Scope

### User-Visible Features
1. **Campaign Management list** — in the Campaigns tab, replaces old history. Shows all campaigns with status badges (draft/active/completed) and per-campaign analytics (sent/opened/clicked/bounced/unsubscribed)
2. **Campaign Detail page** — view a single campaign with full analytics and recipient list
3. **Campaign Cloning** — duplicate a campaign (copies name/subject/body/variants, not recipients)
4. **Unsubscribe Page** — `/unsubscribe/:token` route, public opt-out confirmation
5. **`{{unsubscribeLink}}`** — auto-injected in every campaign email via send-email Edge Function
6. **Unsubscribed leads excluded** — audience selector and campaign sends skip unsubscribed leads

### NOT in Phase 1a (deferred to Phase 1b)
- Campaign builder multi-step form
- Template library
- AI template generation
- AudienceSelector component
- TemplateEditor component

### Success Criteria
- [ ] All database tables created (campaigns expanded, emails.campaign_id, campaign_templates, campaign_sequences, campaign_steps, unsubscribes)
- [ ] Campaign management list with status badges + analytics
- [ ] Campaign detail page with per-campaign stats
- [ ] Campaign cloning works
- [ ] Unsubscribe page functional at `/unsubscribe/:token`
- [ ] Campaign emails include `{{unsubscribeLink}}` replaced with real URL
- [ ] Unsubscribed leads filtered from campaign sends
- [ ] `npm run build` passes
- [ ] All docs updated

---

## Files Being Changed

```
supabase/
├── functions/
│   ├── unsubscribe/
│   │   └── index.ts                    ← NEW (Edge Function — token lookup + insert, no auth)
│   └── send-email/
│       └── index.ts                    ← MODIFIED (inject {{unsubscribeLink}}, pass campaign_id)
src/
├── pages/
│   ├── OutreachPage.tsx                ← MODIFIED (campaigns tab → CampaignList component)
│   ├── CampaignDetailPage.tsx          ← NEW (single campaign analytics + recipient list)
│   └── UnsubscribePage.tsx             ← NEW (public unsubscribe page)
├── components/
│   └── campaigns/
│       ├── CampaignList.tsx            ← NEW (campaign management list with analytics)
│       └── CampaignAnalytics.tsx       ← NEW (analytics cards)
├── hooks/
│   └── use-campaigns.ts               ← MODIFIED (add analytics, clone, status update)
├── lib/
│   └── api/
│       └── campaigns.ts               ← MODIFIED (add getCampaign, cloneCampaign, analytics queries)
├── types/
│   ├── crm.ts                         ← MODIFIED (expand Campaign interface)
│   └── database.ts                    ← MODIFIED (all new tables + campaign_id on emails)
├── App.tsx                             ← MODIFIED (add /unsubscribe/:token and /outreach/campaign/:id routes)
docs/
├── schema.md                           ← MODIFIED
├── outreach.md                         ← MODIFIED
├── OVERVIEW.md                         ← MODIFIED
├── campaigns.md                        ← NEW (dedicated campaign engine doc)
```

---

## Architecture Overview

### Current
```
OutreachPage → Campaigns Tab
  ├── AI Mode: CampaignAIChat → generates subject/body/recipients → send
  └── Manual Mode: filter leads → select → compose → send
  └── Campaign History: flat list of past campaigns
```

### After Phase 1
```
OutreachPage → Campaigns Tab
  ├── Campaign Management List (CampaignList component)
  │   ├── Status badges: Draft, Active, Paused, Completed
  │   ├── Per-campaign analytics: sent/opened/clicked/bounced
  │   ├── Actions: View, Clone, Pause/Resume, Delete
  │   └── "+ New Campaign" button → CampaignBuilderPage
  │
  ├── CampaignBuilderPage (/outreach/campaign/new or /outreach/campaign/:id/edit)
  │   ├── Step 1: Audience (AudienceSelector) — filter by status/industry/tags/location
  │   ├── Step 2: Template (TemplateEditor) — AI generate, paste+cleanup, or pick from library
  │   ├── Step 3: Preview — see email with sample lead data, A/B variant toggle
  │   └── Step 4: Send — confirm recipient count, send now or save as draft
  │
  ├── CampaignDetailPage (/outreach/campaign/:id)
  │   ├── Campaign analytics (CampaignAnalytics) — charts + numbers
  │   ├── Recipient list with per-recipient status
  │   └── Actions: Clone, Pause/Resume, Edit
  │
  └── Template Library (TemplateLibrary) — save/browse/delete templates

UnsubscribePage (/unsubscribe/:token) — public, no auth required
```

### Key Design Decisions

1. **Campaign builder is a separate page** (not inline in the tab) — gives room for multi-step form, preview, AI assist without cramming into the existing 700-line OutreachPage
2. **Campaign list replaces the old history section** — same tab, better UI
3. **AI chatbot becomes a helper in the TemplateEditor** — user can type a description, AI fills subject+body, user refines
4. **Analytics computed from emails table** — count emails WHERE campaign thread pattern matches, join with open/click/bounce data. No separate analytics table for Phase 1 (computed on the fly from emails + webhooks)
5. **Unsubscribe uses a unique token per lead** — stored in `unsubscribes` table, URL is `/unsubscribe/:token`

---

## Database Migrations (ALL phases — built now)

```sql
-- 1. Expand campaigns table
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
-- Backfill existing campaigns as completed (they were already sent)
UPDATE campaigns SET status = 'completed' WHERE sent_at IS NOT NULL AND status = 'draft';

-- 1b. Add campaign_id to emails table (for analytics linking)
ALTER TABLE emails ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS drip_config jsonb;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS variant_b_subject text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS variant_b_body text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ab_test_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sequence_id uuid;

-- 2. Create campaign_templates
CREATE TABLE IF NOT EXISTS campaign_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE campaign_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can manage templates" ON campaign_templates;
CREATE POLICY "Authenticated users can manage templates" ON campaign_templates FOR ALL USING (auth.uid() IS NOT NULL);

-- 3. Create campaign_sequences (for Phase 2 execution)
CREATE TABLE IF NOT EXISTS campaign_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE campaign_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can manage sequences" ON campaign_sequences;
CREATE POLICY "Authenticated users can manage sequences" ON campaign_sequences FOR ALL USING (auth.uid() IS NOT NULL);

-- 4. Create campaign_steps (for Phase 2 execution)
CREATE TABLE IF NOT EXISTS campaign_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES campaign_sequences(id) ON DELETE CASCADE,
  step_order integer NOT NULL DEFAULT 0,
  delay_days integer NOT NULL DEFAULT 0,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  variant_b_subject text,
  variant_b_body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE campaign_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can manage steps" ON campaign_steps;
CREATE POLICY "Authenticated users can manage steps" ON campaign_steps FOR ALL USING (auth.uid() IS NOT NULL);

-- 5. Create unsubscribes
CREATE TABLE IF NOT EXISTS unsubscribes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  unsubscribed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE unsubscribes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read unsubscribes" ON unsubscribes;
CREATE POLICY "Authenticated users can read unsubscribes" ON unsubscribes FOR SELECT USING (auth.uid() IS NOT NULL);
-- NO public INSERT policy — all unsubscribe writes go through Edge Function with service key
-- This prevents table poisoning by unauthenticated callers

CREATE INDEX IF NOT EXISTS unsubscribes_lead_id_idx ON unsubscribes(lead_id);
CREATE INDEX IF NOT EXISTS unsubscribes_email_idx ON unsubscribes(email);
```

---

## Key Pseudocode

### Campaign List Component (`CampaignList.tsx`)

```tsx
// Fetches all campaigns with computed analytics
// For each campaign, compute stats from the emails table:
// - sent: emails WHERE direction='outbound' AND thread_id LIKE 't-camp-%' AND campaign matches
// - opened: emails WHERE opened_at IS NOT NULL
// - clicked: emails WHERE clicked_at IS NOT NULL
// - bounced: emails WHERE bounced_at IS NOT NULL

// Display as a table/card list:
// | Name | Status | Recipients | Sent | Opened | Clicked | Bounced | Date | Actions |
// Each row has: View, Clone, Delete buttons
// "+ New Campaign" button at top
```

### Campaign Builder (`CampaignBuilderPage.tsx`)

```tsx
// Multi-step form with state:
const [step, setStep] = useState(1); // 1=audience, 2=template, 3=preview, 4=confirm
const [campaignName, setCampaignName] = useState('');
const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
const [subject, setSubject] = useState('');
const [body, setBody] = useState('');
const [variantBSubject, setVariantBSubject] = useState('');
const [variantBBody, setVariantBBody] = useState('');
const [abTestEnabled, setAbTestEnabled] = useState(false);

// Step 1: AudienceSelector — filter leads, select recipients
// Step 2: TemplateEditor — write/AI-generate/load from library
// Step 3: Preview — show email with sample lead, toggle A/B variants
// Step 4: Confirm — show summary, "Send Now" or "Save as Draft"
```

### Template Editor (`TemplateEditor.tsx`)

```tsx
// Three modes:
// 1. Manual: type subject + body directly
// 2. AI Generate: describe what you want → AI fills subject + body
// 3. AI Cleanup: paste existing template → AI suggests improvements
// 4. Load from Library: browse saved templates

// AI integration: calls campaign-ai Edge Function (extended to handle template generation + cleanup)
// Save to Library: creates a campaign_template row
```

### Unsubscribe Page (`UnsubscribePage.tsx`)

```tsx
// Public route: /unsubscribe/:token
// No auth required
// On mount: look up token in unsubscribes table
// If already unsubscribed: show "You're already unsubscribed"
// If new: insert into unsubscribes, show "You've been unsubscribed"
// Simple, clean UI — no navigation, just a centered card
```

### Unsubscribe Link Injection

```tsx
// In send-email Edge Function (or handleSendCampaign):
// For each recipient, generate a unique unsubscribe token
// Insert into unsubscribes table (lead_id, email, token)
// Replace {{unsubscribeLink}} in body with:
// https://<domain>/unsubscribe/<token>
// For now, use the Netlify URL: https://quiet-sprite-7a58d5.netlify.app/unsubscribe/<token>
```

---

## Task Execution Order

### Task 1: Database Migrations
Run all migration blocks via Supabase MCP:
- Expand campaigns table (status, name, scheduled_at, drip_config, A/B fields, sequence_id)
- Add campaign_id to emails table
- Create campaign_templates table
- Create campaign_sequences table
- Create campaign_steps table
- Create unsubscribes table (with indexes, NO public INSERT policy)

### Task 2: Update TypeScript Types
- `src/types/crm.ts` — expand Campaign interface (add name, status, variantBSubject, variantBBody, abTestEnabled, scheduledAt), add CampaignTemplate interface, add Unsubscribe interface
- `src/types/database.ts` — add all new tables + campaign_id on emails + update campaigns

### Task 3: Expand Campaign API + Hook
- `src/lib/api/campaigns.ts` — add getCampaign, updateCampaign, cloneCampaign (name/subject/body/variants only, not recipients), getCampaignAnalytics (query emails by campaign_id)
- `src/hooks/use-campaigns.ts` — add mutations for update, clone, delete; add analytics query

### Task 4: Create Unsubscribe Edge Function + Page
- `supabase/functions/unsubscribe/index.ts` — handles token lookup + insert via service key (no auth, no direct table access from frontend)
- `src/pages/UnsubscribePage.tsx` — calls Edge Function, shows confirmation
- Deploy with `--no-verify-jwt`

### Task 5: Update send-email Edge Function
- For batch sends: accept `campaignId` parameter
- Insert `campaign_id` on each email row
- Generate unsubscribe token per recipient, insert into unsubscribes table
- Replace `{{unsubscribeLink}}` in body with `${SITE_URL}/unsubscribe/${token}`
- Read `SITE_URL` from env var (set to `https://quiet-sprite-7a58d5.netlify.app`)

### Task 6: Create Campaign Components
- `src/components/campaigns/CampaignList.tsx` — campaign list with status badges + analytics summary
- `src/components/campaigns/CampaignAnalytics.tsx` — detailed analytics (sent/opened/clicked/bounced/unsubscribed)

### Task 7: Create Campaign Detail Page
- `src/pages/CampaignDetailPage.tsx` — single campaign view with full analytics + recipient list + clone button

### Task 8: Restructure OutreachPage Campaigns Tab
- Replace old campaign history + manual/AI mode UI with CampaignList component
- Keep existing handleSendCampaign flow working (pass campaign_id to sendBulkEmails)
- Old manual/AI mode stays functional for now — Phase 1b replaces with builder

### Task 9: Update App.tsx Routes
- Add `/outreach/campaign/:id` → CampaignDetailPage (INSIDE AppLayout)
- Add `/unsubscribe/:token` → UnsubscribePage (OUTSIDE AuthGate — public route)

### Task 10: Update OutreachPage handleSendCampaign
- After creating campaign record, pass campaign.id to sendBulkEmails
- Update sendBulkEmails client to accept campaignId parameter
- Exclude unsubscribed leads from recipient list

### Task 11: Deploy Edge Functions + Set Secrets
- Deploy unsubscribe function with `--no-verify-jwt`
- Redeploy send-email
- Set `SITE_URL` secret on Supabase

### Task 12: Update Documentation
- Create `docs/campaigns.md` — new dedicated campaign engine doc
- Update `docs/schema.md` — all new tables + campaign_id on emails
- Update `docs/outreach.md` — campaigns tab restructured
- Update `docs/OVERVIEW.md` — major changes log

---

## Validation Gates

1. `npm run build` passes
2. Campaign list shows all campaigns with status badges + analytics
3. "+ New Campaign" opens multi-step builder
4. Step 1: filter and select leads
5. Step 2: write template manually OR use AI to generate
6. Step 3: preview email with sample lead data
7. Step 4: send campaign → emails delivered via Resend
8. Save as draft → campaign appears in list as "Draft"
9. Clone campaign → pre-filled builder with existing data
10. Template library: save template → browse → load into builder
11. Unsubscribe page: visit `/unsubscribe/:token` → shows opt-out confirmation
12. Campaign emails contain `{{unsubscribeLink}}` replaced with real URL
13. All docs updated

---

## Deprecated Code (to remove)

| Code | File | Reason |
|------|------|--------|
| Old campaign history section (lines ~894-940) | OutreachPage.tsx | Replaced by CampaignList component |
| Old manual mode recipient selection (lines ~783-862) | OutreachPage.tsx | Moved to AudienceSelector component |
| Old manual mode compose step (lines ~864-892) | OutreachPage.tsx | Moved to CampaignBuilderPage |
| Campaign mode toggle (manual/ai) (lines ~711-731) | OutreachPage.tsx | Replaced by unified builder |

---

## Known Gotchas

```
1. Campaign analytics use emails.campaign_id for linking — NOT thread_id patterns.
   The send-email Edge Function populates campaign_id on every batch-sent email.

2. The unsubscribe page must be OUTSIDE the AuthGate in App.tsx — public route.
   It calls an Edge Function (not direct table access) for security.

3. Unsubscribe tokens generated per-lead in send-email Edge Function, inserted
   into unsubscribes table via service key, BEFORE sending the email.

4. {{unsubscribeLink}} URL reads from SITE_URL env var (not hardcoded).
   Set to https://quiet-sprite-7a58d5.netlify.app for now. Update when custom domain added.

5. Campaign status: draft → active (on send) → completed. Pause/resume is Phase 2.

6. A/B fields stored but not executed in Phase 1a — sends only variant A.

7. emailSafeLeads filter still applies + unsubscribed leads are excluded.

8. Campaign cloning copies name/subject/body/variants ONLY — not recipient_ids.
   User must re-select audience for the cloned campaign.

9. All unsubscribe writes go through Edge Function with service key — no public
   INSERT RLS policy on the unsubscribes table. Prevents table poisoning.

10. UnsubscribePage calls the unsubscribe Edge Function, NOT direct Supabase queries.

11. Campaign detail/list routes are INSIDE AppLayout so sidebar stays visible.

12. Templates API (Phase 1b) should filter by created_by for user scoping.
```
