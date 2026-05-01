# Plan: Email UI Redesign — Gmail-style Messages + Flexible To Field

**Confidence: 9/10** — Pure UI changes in one file. The main complexity is the message card redesign (many JSX elements to replace) and the To field dual-mode logic.

## Goal

Restyle the Outreach conversation view from chat bubbles to Gmail-style email cards. Add a formatting toolbar to reply/compose areas. Make the To field accept raw email addresses without requiring a lead match.

## Files Being Changed

```
src/
├── pages/
│   └── OutreachPage.tsx              ← MODIFIED (message cards, reply toolbar, compose To field)
docs/
├── outreach.md                       ← MODIFIED (changelog)
├── OVERVIEW.md                       ← MODIFIED (changelog)
```

---

## Architecture Overview

No architecture changes. Purely visual redesign of three sections within OutreachPage.tsx:

1. **Conversation view messages** (lines ~471-513) — chat bubbles → full-width email cards
2. **Reply area** (lines ~517-555) — plain textarea → textarea with formatting toolbar
3. **Compose tab To field** (lines ~570-615) — search-only → dual-mode (lead search + raw email)
4. **Compose tab body** — plain textarea → textarea with formatting toolbar (same as reply)

---

## Key Pseudocode

### 1. Message Card (replaces chat bubble)

```tsx
// REPLACE the entire message rendering block
{selectedThread.messages.map(msg => {
  const isSent = msg.direction === 'outbound';
  return (
    <div key={msg.id} className={`rounded-lg border ${isSent ? 'bg-background' : 'bg-muted/30'}`}>
      {/* Email header */}
      <div className="px-4 py-2.5 border-b bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="text-xs">
            <span className="text-muted-foreground">From: </span>
            <span className="font-medium text-foreground">
              {isSent ? `${user?.name ?? ''} <${user?.sendingEmail ?? msg.from}>`.trim() : msg.from}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {new Date(msg.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
        <div className="text-xs mt-0.5">
          <span className="text-muted-foreground">To: </span>
          <span className="text-foreground">{msg.to || '—'}</span>
        </div>
      </div>
      {/* Email body */}
      <div className="px-4 py-3">
        <p className="text-sm whitespace-pre-line leading-relaxed text-foreground">
          {msg.body}
        </p>
      </div>
      {/* Tracking indicators (outbound only) */}
      {msg.direction === 'outbound' && (msg.openedAt || msg.clickedAt || msg.bouncedAt) && (
        <div className="px-4 pb-2.5 flex items-center gap-3">
          {msg.openedAt && (
            <span className="flex items-center gap-0.5 text-[10px] text-emerald-600" title={`Opened ${new Date(msg.openedAt).toLocaleString()}`}>
              <Eye className="h-3 w-3" /> Opened
            </span>
          )}
          {msg.clickedAt && (
            <span className="flex items-center gap-0.5 text-[10px] text-blue-600" title={`Clicked ${new Date(msg.clickedAt).toLocaleString()}`}>
              <MousePointerClick className="h-3 w-3" /> Clicked
            </span>
          )}
          {msg.bouncedAt && (
            <span className="flex items-center gap-0.5 text-[10px] text-red-500" title={`Bounced ${new Date(msg.bouncedAt).toLocaleString()}`}>
              <AlertTriangle className="h-3 w-3" /> Bounced
            </span>
          )}
        </div>
      )}
    </div>
  );
})}
```

### 2. Formatting Toolbar (used by both reply and compose)

A simple row of icon buttons above the textarea. These are visual-only for now (Resend sends plain text), but give the Gmail feel. When we add HTML email support later, these will become functional.

```tsx
// Toolbar component — inline, no separate file needed
<div className="flex items-center gap-0.5 px-1 py-1 border rounded-t-md bg-muted/30 border-b-0">
  <Button variant="ghost" size="icon" className="h-7 w-7" title="Bold">
    <Bold className="h-3.5 w-3.5" />
  </Button>
  <Button variant="ghost" size="icon" className="h-7 w-7" title="Italic">
    <Italic className="h-3.5 w-3.5" />
  </Button>
  <Button variant="ghost" size="icon" className="h-7 w-7" title="Link">
    <Link2 className="h-3.5 w-3.5" />
  </Button>
  <Button variant="ghost" size="icon" className="h-7 w-7" title="Bullet List">
    <List className="h-3.5 w-3.5" />
  </Button>
</div>
<Textarea
  className="min-h-[100px] rounded-t-none"
  ...existing props
/>
```

Import: `Bold`, `Italic`, `Link2`, `List` from lucide-react.
(Verify `Link2` exists in installed lucide-react version — if not, use `Link` instead.)

IMPORTANT for toolbar buttons:
- Add `type="button"` to prevent form submission
- Add `onMouseDown={e => e.preventDefault()}` to preserve textarea focus
- These buttons are visual-only for now but must not break UX

### 3. Compose To Field — Dual Mode

```tsx
// State addition needed:
const [toEmail, setToEmail] = useState('');  // raw email for non-lead recipients

// New To field logic:
<Input
  placeholder="Search leads or type an email address..."
  value={toLeadId
    ? `${leads.find(l => l.id === toLeadId)?.firstName} ${leads.find(l => l.id === toLeadId)?.lastName} — ${leads.find(l => l.id === toLeadId)?.email}`
    : (toEmail && !toSearch) ? toEmail  // Show selected raw email
    : toSearch}
  onChange={e => {
    setToSearch(e.target.value);
    setToLeadId('');
    setToEmail('');
    // If it matches a valid email pattern, store it
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.target.value.trim())) {
      setToEmail(e.target.value.trim());
    }
  }}
  onFocus={() => { if (toLeadId) { setToSearch(''); setToLeadId(''); setToEmail(''); } }}
/>

// Dropdown: show leads AND a "Send to this email" option
{!toLeadId && toSearch && (
  <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-background border rounded-md shadow-lg max-h-[200px] overflow-y-auto">
    {/* If typed text is a valid email, show direct send option */}
    {toEmail && (
      <div
        className="px-3 py-2 text-sm cursor-pointer hover:bg-accent transition-colors border-b"
        onClick={() => { setToEmail(toSearch.trim()); setToSearch(''); }}
      >
        <span className="font-medium text-foreground">Send to: </span>
        <span className="text-primary">{toSearch.trim()}</span>
      </div>
    )}
    {/* Lead search results */}
    {filteredComposeLeads.map(l => (
      // ...existing lead dropdown items
    ))}
    {filteredComposeLeads.length === 0 && !toEmail && (
      <div className="px-3 py-2 text-sm text-muted-foreground">No leads found</div>
    )}
  </div>
)}

// Send button: enable if lead OR raw email is set
<Button
  onClick={handleSendEmail}
  disabled={(!toLeadId && !toEmail) || !subject.trim() || !body.trim()}
  className="gap-1.5"
>
  <Send className="h-4 w-4" /> Send Email
</Button>
```

### 4. Update handleSendEmail for raw email mode

```tsx
const handleSendEmail = async () => {
  const recipientEmail = toLeadId
    ? leads.find(l => l.id === toLeadId)?.email
    : toEmail;
  if (!recipientEmail || !subject.trim() || !body.trim()) return;
  if (!user?.sendingEmail) {
    toast.error('Set your sending email in Settings before sending');
    return;
  }

  try {
    await sendEmail({
      leadId: toLeadId || undefined,  // null for non-lead recipients
      from: user.sendingEmail,
      fromName: user.name,
      to: recipientEmail,
      subject: subject.trim(),
      body: body.trim(),
      threadId: `t-${Date.now()}`,
    });
    // ...existing activity logging (only if toLeadId)
    if (toLeadId) {
      addActivity({ ... });
    }
    queryClient.invalidateQueries({ queryKey: ['emails'] });
    setToSearch('');
    setToLeadId('');
    setToEmail('');
    setSubject('');
    setBody('');
    toast.success('Email sent');
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to send email');
  }
};
```

---

## Task Execution Order

### Task 1: Add new state + imports

- Add `toEmail` state variable (for raw email input)
- Add `Bold`, `Italic`, `Link2`, `List` to lucide-react imports

### Task 2: Replace message bubbles with email cards

Replace the message rendering block (lines ~471-513) with full-width email cards:
- Full width, no left/right alignment
- Border + rounded card style
- From/To header with divider
- Timestamp in header row
- Body below
- Tracking indicators stay (moved inside card footer)

### Task 3: Add formatting toolbar to reply area

Replace the plain textarea in the reply area (lines ~517-555) with toolbar + textarea:
- Row of icon buttons: Bold, Italic, Link, List
- Textarea with `rounded-t-none` to connect visually
- Keep existing Reply/Forward buttons, Cancel, Send

### Task 4: Add formatting toolbar to compose tab

Same toolbar pattern for the compose body textarea (lines ~605-610):
- Add toolbar above the body textarea
- Same icon buttons

### Task 5: Update To field for dual-mode

Replace the compose To field (lines ~577-601):
- Keep lead search dropdown
- Add "Send to: email" option when typed text is a valid email
- Store raw email in `toEmail` state
- Show visual indicator when a raw email is selected (not a lead)

### Task 6: Update handleSendEmail for raw email

- Accept either `toLeadId` (lead) or `toEmail` (raw) as recipient
- Only log activity if `toLeadId` is set
- Clear `toEmail` on form reset
- Update send button disabled condition

### Task 7: Update documentation

- `docs/outreach.md`: changelog for UI redesign
- `docs/OVERVIEW.md`: changelog

---

## Validation Gates

1. `npm run build` passes
2. Conversation view shows full-width email cards (not chat bubbles)
3. Each message card has From/To headers and timestamp
4. Reply area has formatting toolbar (Bold/Italic/Link/List buttons)
5. Compose area has formatting toolbar
6. Compose To field: type a lead name → dropdown shows leads
7. Compose To field: type `someone@company.com` → "Send to: someone@company.com" option appears
8. Send to raw email works (no lead required)
9. Send to lead still works (existing behavior)
10. All tracking indicators (opened/clicked/bounced) still visible on outbound cards

---

## Deprecated Code (to remove)

| Code | Reason |
|------|--------|
| Chat bubble alignment logic (`items-end`/`items-start`) | Replaced by full-width cards |
| Blue/gray bubble colors (`bg-primary`/`bg-muted`) | Replaced by card border + subtle background |
| `max-w-[85%]` on messages | Messages are now full-width |
| "You" sender label | Replaced by full "Name <email>" format |
