# Post-smoke-test polish — 7 recommendations from 2026-05-06 testing

**Status:** Ready
**Source:** Recommendations 1, 2, 3, 5, 6, 7, 9 from the 2026-05-06 test report (CSV upload deferred — handled upstream in Connect CRM).
**Confidence score: 9/10** for one-pass implementation.

---

## Goal

Ship 7 small UX/correctness improvements found during local smoke testing of the Lazer Lending CRM. None require new Edge Functions or migrations. All are scoped to existing files and follow patterns already in the codebase.

## Why these 7

After the 2026-05-06 smoke pass, the app was usable but had rough edges that would confuse a Lazer admin:

1. The hidden Apollo Lead Generator page is still reachable by deep link and pitches Apollo lead-sourcing, which Lazer doesn't use.
2. Campaign Builder Step 1 still says "Search Apollo.io for matching contacts" — wrong product framing.
3. Outreach Inbox vs the new Replies page have overlapping mental models with no signposting.
4. Mailbox rows are read-only after creation; Smartlead `account_id` has to be UPDATEd via SQL once Smartlead provisions the connection.
5. `paused_reason` renders as raw enum (`bounce_threshold` instead of "Bounce threshold").
6. Domains UI doesn't expose the actual DNS records to add at the registrar.
7. `process-campaigns` defaults `provider='resend'` at the migration level, so a Lazer admin building a campaign without flipping the toggle would accidentally use Resend for cold mail (Resend AUP forbids cold).

---

## Files Being Changed

```
supabase/functions/process-campaigns/index.ts                ← MODIFIED  (#7 audit + comment)
src/pages/LeadGeneratorPage.tsx                              ← MODIFIED  (#1 disabled-banner)
src/pages/CampaignBuilderPage.tsx                            ← MODIFIED  (#2 copy + #7 default flip)
src/pages/OutreachPage.tsx                                   ← MODIFIED  (#3 subtitle + Replies link)
src/pages/MailboxesPage.tsx                                  ← MODIFIED  (#4 Edit menu + #5 paused-reason label)
src/pages/DomainsPage.tsx                                    ← MODIFIED  (#6 View DNS Records dialog)
src/lib/api/mailboxes.ts                                     ← MODIFIED  (#4 updateMailbox API)
src/hooks/use-mailboxes.ts                                   ← MODIFIED  (#4 updateMailbox mutation)
```

No new files. No new migrations. No new Edge Functions. Only `process-campaigns` needs redeploy because Edge Function code changes don't ride Vite HMR.

---

## Architecture Overview

These are independent UI polish items + one tiny backend doc/comment change. There is no shared abstraction to introduce. Each item is locally scoped to one or two files.

The single non-trivial cross-file item is **#4 (Mailbox edit menu)**, which mirrors the existing Add-Mailbox flow exactly: API method → hook mutation → dialog state in page → dialog JSX. The pattern was already established by `createMailbox` (added in commit `ba4f7f1`); we extend it 1:1 for `updateMailbox`.

For **#7**, the existing `provider === 'smartlead'` gating in `process-campaigns/index.ts:123` already handles the routing correctly. The fix is shifting the *default* in two places (CampaignBuilder UI initial state + a code comment in process-campaigns) so a new Lazer campaign starts as `smartlead`, not `resend`. We're **not** changing the migration's column default (that would break Connect CRM regression — Connect CRM campaigns should still default to resend). We're changing the *UI default* only.

---

## Key Pseudocode

### #1 — LeadGeneratorPage disabled banner

```tsx
// At the top of LeadGeneratorPage component body, before any other JSX:
const apolloDisabled = !import.meta.env.VITE_APOLLO_AVAILABLE;
//                       ^ vite-time check. We could also try fetching once
//                         and gating on 401, but env-time is cheaper.
//
// If we want runtime-only check, store apollo_enabled in a settings table.
// For now: vite env flag, default to disabled (since Apollo is removed for Lazer).

if (apolloDisabled) {
  return (
    <div className="p-6 max-w-3xl">
      <Alert variant="default">
        <AlertTitle>Lead Generator is disabled for this deployment</AlertTitle>
        <AlertDescription>
          Lazer Lending sources leads via CSV upload + ZeroBounce validation,
          not Apollo's database. Upload a CSV from the Leads page (coming soon),
          or add a single lead via Leads → Add Lead.
        </AlertDescription>
      </Alert>
    </div>
  );
}
```

### #2 — CampaignBuilder Step 1 copy + provider default

```tsx
// CampaignBuilderPage.tsx:69
const [provider, setProvider] = useState<'resend' | 'smartlead'>('smartlead'); // was 'resend'

// Step 1 panel — replace the "Auto-Generate Leads" button with a passive note:
{showApolloGen ? null : (
  <p className="text-xs text-muted-foreground">
    Pick from existing leads below, or add new ones via the Leads page.
  </p>
)}
// Drop the showApolloGen useState + the Apollo dialog entirely (dead code now).
```

### #4 — Mailbox edit dialog

```tsx
// State (mirrors Add-Mailbox pattern):
const [editTarget, setEditTarget] = useState<Mailbox | null>(null);
const [editSmartleadId, setEditSmartleadId] = useState('');
const [editDailyCap, setEditDailyCap] = useState(30);
const [editTimezone, setEditTimezone] = useState('America/Phoenix');

// When opening:
const openEdit = (mb: Mailbox) => {
  setEditTarget(mb);
  setEditSmartleadId(mb.smartleadAccountId ?? '');
  setEditDailyCap(mb.dailyCap);
  setEditTimezone(mb.timezone);
};

// Submit:
await updateMailbox(editTarget.id, {
  smartleadAccountId: editSmartleadId.trim() || null,
  dailyCap: editDailyCap,
  timezone: editTimezone,
});
```

```ts
// src/lib/api/mailboxes.ts — new export:
export interface UpdateMailboxPayload {
  smartleadAccountId?: string | null;
  dailyCap?: number;
  timezone?: string;
}
export async function updateMailbox(id: string, patch: UpdateMailboxPayload): Promise<void> {
  const { error } = await supabase
    .from('mailboxes')
    .update(toSnakeCase(patch as Record<string, unknown>))
    .eq('id', id);
  if (error) throw error;
}
```

### #5 — paused_reason label in row

```tsx
// MailboxesPage.tsx, in the row render — replace the raw `mb.pausedReason ?? '—'` with:
{mb.pausedReason
  ? PAUSE_REASONS.find(r => r.value === mb.pausedReason)?.label ?? mb.pausedReason
  : '—'}
```

### #6 — DNS records dialog

```tsx
// DomainsPage.tsx — new dialog state:
const [dnsTarget, setDnsTarget] = useState<Domain | null>(null);

// Records to display, computed per-domain (template strings — copy buttons next to each):
const records = (d: Domain) => [
  {
    type: 'TXT',
    host: '@',
    value: 'v=spf1 include:_spf.google.com ~all',
    purpose: 'SPF — authorize Google Workspace to send for this domain',
  },
  {
    type: 'TXT',
    host: 'google._domainkey',
    value: d.dkimPublicKey ?? '(pending Zapmail provisioning — Workspace publishes the key after mailbox creation)',
    purpose: 'DKIM — public key for outbound signing',
    pending: !d.dkimPublicKey,
  },
  {
    type: 'TXT',
    host: '_dmarc',
    value: `v=DMARC1; p=${d.dmarcPolicy}; rua=mailto:dmarc@${d.hostname}`,
    purpose: 'DMARC — policy + aggregate report destination',
  },
];

// Dialog body: <Table> with columns Type | Host | Value | [Copy] | Pending? + a copy button.
```

### #7 — process-campaigns audit comment

```ts
// supabase/functions/process-campaigns/index.ts, near line 264 (Step 2: Resend send):
// IMPORTANT: This Resend path runs ONLY for campaign.provider === 'resend'.
// The earlier `if (campaign.provider === 'smartlead')` branch (line ~123) routes
// Lazer cold-outreach to the Smartlead campaign engine and continues, so we never
// reach this block for cold mail. Resend's AUP forbids cold sends — never invoke
// this path for a Lazer campaign. CampaignBuilder defaults provider='smartlead'
// to make the wrong choice impossible by accident.
```

---

## Tasks (in order)

1. **#7 first (lowest risk).** Add the doc comment to `process-campaigns/index.ts`. Flip CampaignBuilder's `useState<'resend'|'smartlead'>('resend')` default to `'smartlead'`. Redeploy `process-campaigns`.

2. **#5.** Patch the row render in `MailboxesPage.tsx` to look up `pausedReason` against the existing `PAUSE_REASONS` map.

3. **#2.** In `CampaignBuilderPage.tsx`:
   - Remove the `Auto-Generate Leads` button (line ~274) and its dialog body.
   - Drop `showApolloGen`, `apolloPrompt`, `apolloCount`, `apolloLoading`, `searchApollo` import, `Zap` icon import.
   - Replace with a small text note: "Pick from existing leads below, or add new ones via the Leads page."

4. **#1.** In `LeadGeneratorPage.tsx`:
   - Read `import.meta.env.VITE_APOLLO_AVAILABLE` (treat anything other than `'true'` as disabled).
   - When disabled, return an `<Alert>` block with a link to `/leads`.
   - Update `.env.example` and `.env` to add `VITE_APOLLO_AVAILABLE=` (empty by default for Lazer).

5. **#3.** In `OutreachPage.tsx`:
   - Add a one-line subtitle under the page header: "Email threads, drafts, and campaign management. For cold-outreach replies, see [Replies](/replies)."
   - In the Inbox tab content, add a small banner: "This view shows all email — for classified cold-outreach replies, use the Replies page."

6. **#4.** Mailbox edit dialog:
   - `src/lib/api/mailboxes.ts`: add `updateMailbox(id, patch)` + `UpdateMailboxPayload` type.
   - `src/hooks/use-mailboxes.ts`: add `updateMailboxMutation` + expose `updateMailbox` (mutateAsync) + `isUpdatingMailbox`.
   - `src/pages/MailboxesPage.tsx`: add Edit dropdown next to the existing Pause/Resume buttons, dialog body, state, and submit handler.

7. **#6.** Domains DNS records dialog:
   - `src/pages/DomainsPage.tsx`: add `View DNS Records` button on each row + dialog.
   - Dialog body: 3-row table (SPF / DKIM / DMARC) with `<button>` copy-to-clipboard per value cell.
   - DKIM cell: when `dkimPublicKey` is null, show "Pending Zapmail provisioning" + a hint that the value will appear after Workspace publishes the key. (Note: `domains` table has no `dkim_public_key` column today; for now, always show pending. Add a `[NEEDS CLARIFICATION]` marker in this section because adding the column is technically a schema change. **Update at review:** punt — show pending always, no schema change.)

8. **Validation gate:** `npx tsc --noEmit` must exit 0.

9. **Deploy + commit:**
   - `SUPABASE_ACCESS_TOKEN=... npx supabase functions deploy process-campaigns --project-ref cmubrsnhsxbrqxsjhxnx`
   - `git add -A && git commit -m '...' && git push`

---

## Out of scope

- CSV upload UI (handled upstream in Connect CRM).
- Hiding Staff Performance for small orgs (recommendation said "or leave as-is" — leaving as-is).
- Login autocomplete (recommendation said "this is desirable for prod" — leaving as-is).

## Validation

- `npx tsc --noEmit` exits 0.
- Click through all 7 changed surfaces via chrome-devtools MCP after implementation:
  - LeadGeneratorPage shows the disabled banner.
  - CampaignBuilder Step 1 has the new copy and Smartlead-default toggle.
  - OutreachPage Inbox tab has the cross-link to /replies.
  - MailboxesPage row Edit menu opens, saves, persists.
  - MailboxesPage shows "Bounce threshold" (label) instead of `bounce_threshold` (raw).
  - DomainsPage row "View DNS Records" opens a dialog with copyable rows.
  - process-campaigns redeploys cleanly.

## Post-implementation verification (per user ask)

After all 7 items + typecheck pass + push:

**Pass 1 — direct verification of each change:**
- LeadGenerator: navigate to `/generator`, confirm disabled banner visible, no Apollo chat.
- CampaignBuilder: open `/outreach/campaign/new`, Step 1 has new copy + provider toggle defaults to Smartlead.
- Outreach Inbox: subtitle renders, Replies cross-link works.
- Mailboxes: Edit dropdown opens, set smartlead_account_id, persist, reload, verify it stuck.
- Mailboxes paused_reason: pause one row with "bounce_threshold", verify "Bounce threshold" label renders.
- Domains: View DNS Records dialog opens, all 3 rows copyable.
- process-campaigns: spot-check redeployed via dashboard.

**Pass 2 — full app double-check (regression sweep):**
- Walk every sidebar route again, console-error scan per page.
- Add 1 lead, 1 mailbox, 1 domain via UI to confirm Phase 3 flows still work.
- Reload while logged-in to confirm session persistence.
- Verify Realtime still fires (REST update on mailbox → page reflects).

## Deprecated code to remove

- `searchApollo` import in `CampaignBuilderPage.tsx` (line 23). Drops along with #2.
- `Zap` icon import in `CampaignBuilderPage.tsx` if no longer referenced.
- The whole `showApolloGen / apolloPrompt / apolloCount / apolloLoading` state cluster (lines 73-77) and any associated handler functions.

No DB or Edge Function deprecations.
