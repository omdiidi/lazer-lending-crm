# Brief: Email UI Redesign — Gmail-style messages + flexible To field

## Why
The conversation view looks like a text messaging app (chat bubbles, right/left aligned). It should look like a professional email client. The compose To field requires selecting a lead — users need to be able to type any email address directly.

## Context
- File: `src/pages/OutreachPage.tsx` (~650 lines)
- Current message rendering: outbound = right-aligned blue bubble, inbound = left-aligned gray bubble, max-width 85%, rounded corners — chat/iMessage style
- Current compose To field: search dropdown only, requires `toLeadId` to be set, no raw email input
- Thread list (left panel): fine as-is, no changes needed
- Reply area: currently a plain textarea at bottom of conversation — needs Gmail-style toolbar
- Tracking indicators (opened/clicked/bounced) already exist on outbound messages — keep these

## Decisions
- **Message layout: full-width email cards** — Each message is a full-width card with From/To header, timestamp, and body. No chat bubbles, no left/right alignment. Both outbound and inbound use the same card layout, just subtle background color difference.
- **From line shows both** — "Sarah Chen <sarah@mail.integrateapi.ai>" format
- **Thread list unchanged** — left panel stays as-is
- **Reply/compose area: Gmail-style toolbar** — bold, italic, link, bullet list buttons above the textarea. Simple formatting toolbar, not a full rich text editor. Just visual buttons (actual formatting can be plain text for now since Resend sends as text — the toolbar is for UX feel).
- **To field: dual-mode** — typing triggers lead search dropdown (existing behavior), BUT if the typed text is a valid email address and user presses Enter or clicks Send, it's accepted directly without requiring a lead match. `leadId` is null for non-lead recipients.
- **Keep all existing functionality** — sendingEmail guard, emailSafeLeads filtering, tracking indicators, reply threading, campaign mode — nothing removed

## Rejected Alternatives
- **Full rich text editor (Quill, TipTap)** — over-engineering for now. Resend sends plain text. A visual toolbar with basic buttons gives the Gmail feel without the complexity.
- **Separate compose page** — keep compose as a tab within Outreach, not a separate route

## Direction
Restyle the conversation view messages from chat bubbles to full-width email cards with From/To/Date headers. Add a Gmail-style formatting toolbar to the reply and compose areas. Make the compose To field accept both lead search and raw email addresses.
