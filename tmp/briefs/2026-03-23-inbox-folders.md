# Brief: Inbox Folders — Gmail-style sidebar with Inbox/Sent/All Mail

## Why
The Outreach inbox currently shows all emails in one undifferentiated list. Users can't distinguish between conversations they need to respond to (inbound) vs ones they've sent. A "Sent" folder is expected in any email client.

## Context
- File: `src/pages/OutreachPage.tsx`
- Current inbox: single thread list, no filtering by direction
- Threads are built by grouping emails by `threadId` — each thread has messages with `direction: 'inbound' | 'outbound'`
- The Outreach page already has a tab bar (Inbox, Compose, Campaigns, Sequences) — the "Inbox" tab is where this change happens
- The thread list is on the left (360px), conversation view on the right

## Decisions
- **Add a mini-sidebar/sub-nav within the Inbox tab** — vertical buttons: Inbox, Sent, All Mail. Placed to the left of the thread list or as a compact vertical strip.
- **Inbox folder** — shows threads that have at least one `direction: 'inbound'` message (conversations where someone has replied or emailed you)
- **Sent folder** — shows threads that have at least one `direction: 'outbound'` message (conversations you've participated in)
- **All Mail folder** — shows all threads (current behavior, no filter)
- **Threaded view for all folders** — every folder shows threads, not individual emails. Consistent UX across all views.
- **Gmail-style layout** — compact sidebar icons/labels on the far left, thread list next to it, conversation view on the right
- **Extensible** — structure allows adding Drafts, Starred, Spam, Labels later

## Rejected Alternatives
- **Filter pills/tabs at top of thread list** — works but not Gmail-style, less extensible
- **Flat list for Sent (individual emails, not threads)** — inconsistent with inbox behavior, loses conversation context

## Direction
Add a compact vertical folder sidebar within the Inbox tab of OutreachPage. Three folders: Inbox (threads with inbound), Sent (threads with outbound), All Mail (all threads). Thread list filters based on selected folder. Conversation view unchanged.
