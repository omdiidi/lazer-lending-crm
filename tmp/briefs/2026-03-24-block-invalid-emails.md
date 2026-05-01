# Brief: Block Invalid Emails from Being Sent

## Why
Leads with `email_status: 'invalid'` can still be emailed across the CRM — mailto links are clickable, and the campaign scheduler sends to enrolled leads without rechecking email validity. This wastes Resend credits, hurts sender reputation, and increases bounce rates.

## Context

### Already Protected
- `CampaignBuilderPage.tsx` line 55-59: `emailSafeLeads` filter only shows verified/likely_to_engage leads in audience selector
- `OutreachPage.tsx` line 38-43: same `emailSafeLeads` filter on the lead dropdown for compose

### Needs Fixing
- `LeadsPage.tsx` lines 89-100, 227-232: `handleEmail()` opens mailto: for ANY lead, including invalid. Email status badge is shown but the link is still clickable.
- `LeadDetailPage.tsx` lines 145-155, 272-276: `handleEmailClick()` opens mailto: without checking email_status. Button is always enabled.
- `process-campaigns/index.ts` lines 94-162: Processes enrolled leads without checking email_status. Once a lead is enrolled, it sends regardless. This is the most critical — a lead that bounces mid-drip-sequence keeps getting sent to.

### Not Changing
- `OutreachPage.tsx` manual email input — stays unrestricted. User may intentionally email addresses not in the CRM or want to override.
- `send-email` edge function — trusts client filtering. Adding server-side validation here would be a bonus but not required since we're blocking upstream.

## Decisions
- **Disable email actions on LeadsPage for invalid leads** — grey out the email link, remove click handler, show tooltip or visual indicator that email is invalid
- **Disable email button on LeadDetailPage for invalid leads** — disable the button, show why
- **Add email_status check in process-campaigns** — before sending each enrollment, fetch the lead's current email_status. Skip if invalid. Log the skip.
- **Leave manual Outreach input unrestricted** — intentional user choice
- **Do NOT auto-change lead status to dead** — just block emailing. Lead status is a separate concern.

## Rejected Alternatives
- **Server-side block in send-email edge function** — overkill since we're blocking at all upstream entry points. Could add later as defense-in-depth.
- **Block manual email input in Outreach** — too restrictive, user needs freedom to email anyone
- **Auto-mark leads as dead when email is invalid** — conflates email validity with lead quality. A lead could have an invalid work email but still be reachable by phone.

## Direction
Disable email actions on LeadsPage and LeadDetailPage for leads with `email_status: 'invalid'`. Add an email_status recheck in the `process-campaigns` edge function before sending each enrollment, skipping invalid leads. Leave manual Outreach compose unrestricted.
