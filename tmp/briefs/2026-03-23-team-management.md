# Brief: Team Management — Invite tokens, signup, delete members

## Why
The "Add Team Member" and delete buttons on the Settings page are non-functional placeholders. Admins need to onboard new team members and remove them. The current system has 3 hardcoded seed users with no way to add more.

## Context
- File: `src/pages/SettingsPage.tsx` — Add/Delete buttons have no onClick handlers
- File: `src/pages/LoginPage.tsx` — no signup flow, login only
- File: `src/contexts/AuthContext.tsx` — handles login/logout, no signup
- Auth: Supabase Auth with email/password
- Profile trigger: `handle_new_user` on `auth.users` INSERT creates a `profiles` row using `raw_user_meta_data` for name/role
- RLS: already enforces employee scoping (assigned_to = auth.uid()), admin sees all
- Profiles table: has name, email, role, sending_email, avatar
- Employee lead visibility: RLS handles this — employees see only assigned leads, admins see all
- Lead Generator: sets `assignedTo = user.id` on import — generated leads visible to both the employee and admin

## Decisions

### Invite Flow
- **Admin creates invite** via Settings page dialog: enters Name, Email (e.g., `marcus@mail.integrateapi.ai`), Role (Admin/Employee)
- **Edge Function generates a unique invite token** and stores it in a new `invites` table with name, email, role, token, expires_at (72 hours), used (boolean)
- **Token displayed to admin** — they copy and share it with the new member
- **The email IS the auth login email AND the sending email** — one email for everything, on the `mail.integrateapi.ai` domain

### Signup Flow
- **Login page gets a "Sign Up" tab/button**
- **Sign Up form: Invite Token + Password** (that's it — email/name/role come from the invite)
- **Edge Function validates token** (exists, not expired, not used), creates Supabase auth user with the invite's email + provided password + user_meta_data (name, role)
- **Profile auto-created by existing `handle_new_user` trigger** using the metadata
- **Edge Function sets `sending_email`** on the profile to match the email
- **Token marked as used**
- **User is automatically logged in** after signup

### Delete Flow
- **Admin clicks Trash icon** → confirmation dialog ("Remove [name] from team?")
- **Edge Function deletes the auth user** (Supabase Admin API) → cascade deletes profile (FK)
- **Leads assigned to deleted user remain** — admin can reassign them later
- **Soft-delete on profile** alternatively, to preserve audit trail — set a `deactivated_at` timestamp

### New DB Table: `invites`
```
invites:
  id: uuid PK
  email: text NOT NULL
  name: text NOT NULL
  role: text NOT NULL (admin/employee)
  token: text NOT NULL UNIQUE
  expires_at: timestamptz NOT NULL
  used: boolean NOT NULL DEFAULT false
  created_by: uuid FK → profiles(id)
  created_at: timestamptz DEFAULT now()
```

### Edge Functions Needed
- `create-invite` — admin creates an invite (requires admin JWT)
- `signup-with-token` — new member signs up with token + password (no auth required)
- `delete-member` — admin deletes a team member (requires admin JWT)

## Rejected Alternatives
- **Email-based invite links** — adds complexity (email templates, redirect URLs). Token copy-paste is simpler for a small team CRM.
- **Let new member choose their own email** — admin wants to control the branded email address
- **Single Edge Function for all team ops** — cleaner to have separate functions per operation

## Direction
Build three Edge Functions (create-invite, signup-with-token, delete-member), a new `invites` DB table, update SettingsPage with invite dialog + delete confirmation, and add a Sign Up tab to LoginPage that accepts token + password.
