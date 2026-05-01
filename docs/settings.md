# Settings

> User profile display, admin team management, and integration placeholders.

**Status:** Active
**Last Updated:** 2026-03-23
**Related Docs:** [OVERVIEW.md](./OVERVIEW.md) | [authentication.md](./authentication.md) | [state-management.md](./state-management.md)

---

## Overview

The Settings page (`/settings`) provides three sections: an editable user profile card, an admin-only team management panel, and a list of integrations. Profile name and sending email are now editable — changes are persisted to Supabase via `updateProfile` and the AuthContext user state is refreshed immediately. Team management supports inviting new members via a token-based invite flow and removing existing members with a confirmation dialog. Integrations reflect current connection status.

---

## File Map

| File | Purpose |
|------|---------|
| `src/pages/SettingsPage.tsx` | Entire settings page — profile, team, integrations |

---

## Detailed Behavior

### Profile Card

- **Name:** Editable `Input` pre-filled with `user.name` — bound to `editName` state
- **Email:** Read-only `Input` pre-filled with `user.email` — this is the Supabase Auth email and cannot be changed here
- **Sending Email:** Editable `Input` for the CRM outbound address used when sending emails — bound to `editEmailPrefix` state. Separate from the auth email. **This field is required before users can send any email** (compose, reply, or campaign). If `emailPrefix` is not set on the user's profile, send actions are blocked and an error message is shown prompting the user to configure it in Settings first.
- **Role:** `Badge` showing capitalized role (admin/employee)
- **Save Changes button:** Calls `handleSave()`, shows a loading state (`saving`) while the Supabase write is in flight. On success, calls `refreshUser()` so the header and rest of the UI reflect the updated name immediately.

### Team Management Card (Admin Only)

Only rendered when `isAdmin === true`.

**Team member list:**
- Iterates over profiles fetched via `useProfiles()` from Supabase
- Each row shows:
  - Avatar circle with initials (e.g., "SC" for Sarah Chen)
  - Full name
  - Email
  - Role badge (secondary variant, capitalized)
  - Delete button (Trash2 icon) — **only shown for non-admin users**

**"+ Add Team Member" button:**
- Outline variant, small size
- Opens the **invite dialog** on click

**Invite flow:**
1. Admin clicks "+ Add Team Member" — an invite dialog opens
2. Dialog contains three fields: Name, Email, and Role (admin / employee)
3. Admin fills in the fields and clicks "Send Invite"
4. The form calls the `create-invite` Edge Function with `{ name, email, role }`
5. The Edge Function generates a secure token, stores the invite in the `invites` table, and returns an invite link
6. The invite link is displayed to the admin (e.g. copy-to-clipboard) so they can share it with the new member out-of-band
7. The new member visits the link, which opens the login page in Sign Up mode pre-filled with their email, and they set their password to complete signup

**Delete button behavior:**
- Shows `text-muted-foreground` normally, `hover:text-destructive` on hover
- Clicking opens a **confirmation dialog** — "Are you sure you want to remove [name] from the team?"
- On confirm, calls the `delete-member` Edge Function with `{ userId }`
- The member is removed from `auth.users` (cascades to `profiles`)
- Their leads and deals are preserved — `assigned_to` is set to NULL via `ON DELETE SET NULL`
- The profiles list is refreshed automatically after deletion

**Delete flow summary:**
1. Admin clicks Trash icon on a team member row
2. Confirmation dialog appears with the member's name
3. Admin confirms → `delete-member` Edge Function is called
4. Member is removed; their CRM records remain unassigned

### Integrations Card

Available to all users (both admin and employee).

| Integration | Description | Status |
|-------------|-------------|--------|
| Apollo.io | Lead generation and enrichment | Connected |
| Email Provider | Outbound email via Resend (email_prefix configurable in profile) | Setting Up |
| Slack | Get notifications in your Slack workspace | Coming Soon |

Each integration row shows:
- Icon square (first letter of integration name)
- Name and description
- Status badge (outline variant)

No connection/configuration flow exists.

---

## Component & Function Reference

### SettingsPage (default export)

**Hooks:** `useAuth()`, `useProfiles()`

**State:**
| State | Type | Purpose |
|-------|------|---------|
| `editName` | `string` | Controlled value for the Name input, initialized from `user.name` |
| `editEmailPrefix` | `string` | Controlled value for the Sending Email input, initialized from `user.emailPrefix` |
| `saving` | `boolean` | `true` while the Supabase updateProfile write is in flight |
| `inviteOpen` | `boolean` | Controls visibility of the invite dialog |
| `inviteName` | `string` | Controlled value for the Name field in the invite dialog |
| `inviteEmail` | `string` | Controlled value for the Email field in the invite dialog |
| `inviteRole` | `string` | Controlled value for the Role selector in the invite dialog |
| `inviteLink` | `string \| null` | Invite link returned by `create-invite` Edge Function, displayed for copy |
| `inviting` | `boolean` | `true` while the `create-invite` call is in flight |
| `deleteTarget` | `Profile \| null` | Profile staged for deletion; controls visibility of the confirmation dialog |
| `deleting` | `boolean` | `true` while the `delete-member` call is in flight |

**Functions:**
- `handleSave()` — sets `saving` to `true`, calls `updateProfile({ name: editName, emailPrefix: editEmailPrefix })`, then calls `refreshUser()` so the global user state reflects the change, then sets `saving` to `false`
- `handleInvite()` — calls the `create-invite` Edge Function with `{ name: inviteName, email: inviteEmail, role: inviteRole }`, stores the returned invite link in `inviteLink` state for the admin to copy
- `handleDeleteConfirm()` — calls the `delete-member` Edge Function with `{ userId: deleteTarget.id }`, then clears `deleteTarget` and triggers a profiles refetch

**Mutations used:**
- `updateProfile` from `useProfiles()` — persists name and sending email changes to Supabase
- `refreshUser` from `useAuth()` — re-fetches the user profile after save so the UI updates immediately

**Edge Functions called:**
- `create-invite` — generates invite token and returns invite link
- `delete-member` — hard-deletes user from auth.users

**UI Components:** `Card`, `CardContent`, `CardHeader`, `CardTitle`, `CardDescription`, `Badge`, `Button`, `Input`, `Label`, `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter`, `Select` (from shadcn/ui); `User`, `Shield`, `Plug`, `Trash2`, `UserPlus` (from lucide-react)

---

## Data Dependencies

| Data | Source | Used For |
|------|--------|----------|
| Current User | `useAuth().user` | Profile display and edit initialization |
| isAdmin | `useAuth().isAdmin` | Team management visibility |
| refreshUser | `useAuth().refreshUser` | Re-fetch user after profile save |
| Profiles | `useProfiles()` | Team member list |
| updateProfile | `useProfiles().updateProfile` | Persist profile name and sending email changes |

---

## Known Limitations & TODOs

- No profile photo upload
- No integration connection/configuration flow
- No notification preferences
- No theme/appearance settings (dark mode toggle, etc.)
- No data export/import functionality
- No account deletion
- No password change
- No API key management
- Invite link is displayed in-app for copy — no automated email delivery of the invite link

---

## Future Considerations

- Add profile photo upload
- Send invite link via email automatically (currently admin must copy and share manually)
- Build integration connection flows (OAuth for Gmail, API key for Apollo.io, webhook for Slack)
- Add notification preferences (email, in-app, Slack)
- Add theme toggle (dark/light mode)
- Add data export (CSV/JSON export of leads, deals, activities)
- Add API key management for programmatic access
- Consider moving integrations to a dedicated page if they become complex

---

## Changelog

| Date | Change | Files Affected |
|------|--------|----------------|
| 2026-03-22 | Initial documentation created | — |
| 2026-03-23 | Team management uses real profiles from Supabase | `SettingsPage.tsx` |
| 2026-03-23 | Profile editing: name and sending email are now editable with save | `SettingsPage.tsx` |
| 2026-03-23 | emailPrefix required for email sending — users must set it before compose/reply/campaign | `SettingsPage.tsx` |
| 2026-03-23 | Team management: "+ Add Team Member" opens invite dialog; Trash button opens confirmation dialog and calls delete-member Edge Function | `SettingsPage.tsx` |
