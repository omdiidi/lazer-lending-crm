# Plan: Team Management — Invite Tokens, Signup, Delete Members

**Confidence: 9/10** — 3 new Edge Functions, 1 new DB table, 2 page modifications. All reviewer feedback incorporated (security, atomicity, FK safety).

## Goal

Admins can invite new team members by generating a token. New members sign up with the token + a password. Admins can delete members. The invite pre-configures the member's name, email, and role.

## Files Being Changed

```
supabase/
├── functions/
│   ├── create-invite/
│   │   └── index.ts                    ← NEW (Edge Function — generate invite token)
│   ├── signup-with-token/
│   │   └── index.ts                    ← NEW (Edge Function — validate token, create auth user)
│   └── delete-member/
│       └── index.ts                    ← NEW (Edge Function — delete auth user + profile)
src/
├── lib/
│   └── api/
│       └── team.ts                     ← NEW (client functions for invite/signup/delete)
├── hooks/
│   └── use-profiles.ts                 ← MODIFIED (add deleteProfile mutation)
├── pages/
│   ├── SettingsPage.tsx                ← MODIFIED (invite dialog, delete handler)
│   └── LoginPage.tsx                   ← MODIFIED (add signup tab)
├── contexts/
│   └── AuthContext.tsx                 ← MODIFIED (add signup function)
docs/
├── schema.md                           ← MODIFIED (invites table, new Edge Functions)
├── settings.md                         ← MODIFIED (team management now functional)
├── authentication.md                   ← MODIFIED (signup flow documented)
├── OVERVIEW.md                         ← MODIFIED (major changes log)
```

---

## Architecture Overview

### Invite Flow
```
Admin clicks "+ Add Team Member"
  → Dialog: Name, Email, Role (Admin/Employee)
  → "Generate Invite" button
    → supabase.functions.invoke('create-invite', { name, email, role })
      → Edge Function (requires admin JWT):
        1. Verify caller is admin
        2. Check email not already in use
        3. Generate random token (e.g., INV-a3f8b2c1)
        4. Insert into invites table (token, name, email, role, expires_at = now+72h)
        5. Return { token }
    → Dialog shows token for admin to copy
```

### Signup Flow
```
New member on Login page → clicks "Sign Up"
  → Form: Invite Token, Password
  → "Create Account" button
    → supabase.functions.invoke('signup-with-token', { token, password })
      → Edge Function (no auth required):
        1. Look up invite by token
        2. Validate: exists, not expired, not used
        3. Create auth user via supabase.auth.admin.createUser({
             email: invite.email,
             password,
             user_metadata: { name: invite.name, role: invite.role }
           })
        4. Update profile: set sending_email = email
        5. Mark invite as used
        6. Return { success: true, email: invite.email }
    → Frontend auto-logs in with the email + password
```

### Delete Flow
```
Admin clicks Trash icon on team member
  → Confirmation dialog: "Remove [name] from team?"
  → "Delete" button
    → supabase.functions.invoke('delete-member', { userId })
      → Edge Function (requires admin JWT):
        1. Verify caller is admin
        2. Verify target is not the caller (can't delete yourself)
        3. Delete auth user via supabase.auth.admin.deleteUser(userId)
        4. Profile cascade-deletes via FK (profiles.id → auth.users.id ON DELETE CASCADE)
        5. Return { success: true }
    → Toast "Member removed"
    → Refresh profiles list
```

---

## DB Migration

```sql
CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'employee')) DEFAULT 'employee',
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can manage invites" ON invites;
CREATE POLICY "Admins can manage invites" ON invites FOR ALL USING (is_admin());
```

---

## Key Pseudocode

### create-invite Edge Function

```typescript
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Verify caller is admin
    const authHeader = req.headers.get('Authorization')!
    const jwt = authHeader.replace('Bearer ', '')
    const { data: { user: authUser } } = await supabaseAdmin.auth.getUser(jwt)
    if (!authUser) return error(401, 'Unauthorized')

    const { data: profile } = await supabaseAdmin.from('profiles')
      .select('role').eq('id', authUser.id).single()
    if (profile?.role !== 'admin') return error(403, 'Admin only')

    const { name, email, role } = await req.json()

    // Check email not already in use
    const { data: existing } = await supabaseAdmin.from('profiles')
      .select('id').eq('email', email).maybeSingle()
    if (existing) return error(409, 'Email already in use')

    // Generate token: 128 bits of entropy (32 hex chars) — NOT brute-forceable
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('')

    // Insert invite (expires in 72 hours)
    const expires_at = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
    await supabaseAdmin.from('invites').insert({
      email, name, role, token, expires_at, created_by: authUser.id,
    })

    return new Response(JSON.stringify({ token }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) { /* error handling */ }
})
```

### signup-with-token Edge Function

```typescript
Deno.serve(async (req) => {
  // NO auth required — this is for unauthenticated users
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { token, password } = await req.json()

    // Validate password strength
    if (!password || password.length < 8) {
      return error(400, 'Password must be at least 8 characters')
    }

    // Atomically claim the invite: mark used BEFORE creating user
    // This prevents race conditions with concurrent signup attempts
    const { data: invite, error: claimErr } = await supabaseAdmin.from('invites')
      .update({ used: true })
      .eq('token', token)
      .eq('used', false)
      .select('*')
      .single()

    if (claimErr || !invite) return error(404, 'Invalid or already used invite token')
    if (new Date(invite.expires_at) < new Date()) {
      // Expired — un-claim it (restore for visibility, it's expired anyway)
      await supabaseAdmin.from('invites').update({ used: false }).eq('id', invite.id)
      return error(410, 'Invite token has expired')
    }

    // Create auth user with metadata
    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: invite.email,
      password,
      email_confirm: true,  // Skip email verification
      user_metadata: { name: invite.name, role: invite.role },
    })
    if (createErr) {
      // Rollback: un-claim the invite
      await supabaseAdmin.from('invites').update({ used: false }).eq('id', invite.id)
      return error(500, createErr.message)
    }

    // Set sending_email on profile (trigger is synchronous — profile exists by now)
    // Retry once if trigger hasn't fired yet
    let updated = await supabaseAdmin.from('profiles')
      .update({ sending_email: invite.email })
      .eq('id', newUser.user.id)
    if (updated.error) {
      await new Promise(r => setTimeout(r, 500))
      await supabaseAdmin.from('profiles')
        .update({ sending_email: invite.email })
        .eq('id', newUser.user.id)
    }

    return new Response(JSON.stringify({
      success: true,
      email: invite.email,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) { /* error handling */ }
})
```

### delete-member Edge Function

```typescript
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Verify caller is admin
    const authHeader = req.headers.get('Authorization')!
    const jwt = authHeader.replace('Bearer ', '')
    const { data: { user: authUser } } = await supabaseAdmin.auth.getUser(jwt)
    if (!authUser) return error(401, 'Unauthorized')

    const { data: profile } = await supabaseAdmin.from('profiles')
      .select('role').eq('id', authUser.id).single()
    if (profile?.role !== 'admin') return error(403, 'Admin only')

    const { userId } = await req.json()

    // Can't delete yourself
    if (userId === authUser.id) return error(400, 'Cannot delete your own account')

    // Delete auth user — profile cascade-deletes via FK
    const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (deleteErr) return error(500, deleteErr.message)

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) { /* error handling */ }
})
```

### Client API (`src/lib/api/team.ts`)

```typescript
import { supabase } from '@/lib/supabase';

export async function createInvite(name: string, email: string, role: string) {
  const { data, error } = await supabase.functions.invoke('create-invite', {
    body: { name, email, role },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { token: string };
}

export async function signupWithToken(token: string, password: string) {
  const { data, error } = await supabase.functions.invoke('signup-with-token', {
    body: { token, password },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { success: boolean; email: string };
}

export async function deleteMember(userId: string) {
  const { data, error } = await supabase.functions.invoke('delete-member', {
    body: { userId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { success: boolean };
}
```

### LoginPage — Signup Tab

```tsx
// Add state:
const [mode, setMode] = useState<'login' | 'signup'>('login');
const [inviteToken, setInviteToken] = useState('');
const [signupPassword, setSignupPassword] = useState('');
const [signupLoading, setSignupLoading] = useState(false);
const [signupError, setSignupError] = useState('');

// Signup handler:
const handleSignup = async (e: React.FormEvent) => {
  e.preventDefault();
  setSignupError('');
  setSignupLoading(true);
  try {
    const result = await signupWithToken(inviteToken, signupPassword);
    // Auto-login with the new credentials
    const success = await login(result.email, signupPassword);
    if (!success) setSignupError('Account created but auto-login failed. Try logging in.');
  } catch (err) {
    setSignupError(err instanceof Error ? err.message : 'Signup failed');
  } finally {
    setSignupLoading(false);
  }
};

// Render toggle between login/signup:
// Login tab: existing form
// Signup tab: token + password fields + "Create Account" button
```

### SettingsPage — Invite Dialog + Delete

```tsx
// Add state:
const [showInviteDialog, setShowInviteDialog] = useState(false);
const [inviteName, setInviteName] = useState('');
const [inviteEmail, setInviteEmail] = useState('');
const [inviteRole, setInviteRole] = useState('employee');
const [generatedToken, setGeneratedToken] = useState('');
const [inviteLoading, setInviteLoading] = useState(false);

const [deleteTarget, setDeleteTarget] = useState<{id: string, name: string} | null>(null);
const [deleteLoading, setDeleteLoading] = useState(false);

// Invite handler:
const handleCreateInvite = async () => {
  setInviteLoading(true);
  try {
    const result = await createInvite(inviteName, inviteEmail, inviteRole);
    setGeneratedToken(result.token);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to create invite');
  } finally {
    setInviteLoading(false);
  }
};

// Delete handler:
const handleDeleteMember = async () => {
  if (!deleteTarget) return;
  setDeleteLoading(true);
  try {
    await deleteMember(deleteTarget.id);
    queryClient.invalidateQueries({ queryKey: ['profiles'] });
    toast.success(`${deleteTarget.name} removed from team`);
    setDeleteTarget(null);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to remove member');
  } finally {
    setDeleteLoading(false);
  }
};
```

---

## Task Execution Order

### Task 1: Database Migration
Create `invites` table with RLS policy (admin-only access).

### Task 2: Create Edge Functions
- `supabase/functions/create-invite/index.ts`
- `supabase/functions/signup-with-token/index.ts`
- `supabase/functions/delete-member/index.ts`

### Task 2b: Add `invites` table to `src/types/database.ts`

### Task 3: Deploy Edge Functions
- `create-invite` and `delete-member`: deploy WITH JWT verification (default)
- `signup-with-token`: deploy with `--no-verify-jwt` (unauthenticated callers)

### Task 3b: FK Migration for safe deletion
Alter FK constraints on tables referencing profiles(id) to allow deletion:
```sql
ALTER TABLE leads ALTER COLUMN assigned_to DROP NOT NULL;
ALTER TABLE leads DROP CONSTRAINT leads_assigned_to_fkey;
ALTER TABLE leads ADD CONSTRAINT leads_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE deals ALTER COLUMN assigned_to DROP NOT NULL;
ALTER TABLE deals DROP CONSTRAINT deals_assigned_to_fkey;
ALTER TABLE deals ADD CONSTRAINT deals_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE activities DROP CONSTRAINT activities_user_id_fkey;
ALTER TABLE activities ADD CONSTRAINT activities_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE activities ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE campaigns DROP CONSTRAINT campaigns_sent_by_fkey;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE campaigns ALTER COLUMN sent_by DROP NOT NULL;

ALTER TABLE email_sequences DROP CONSTRAINT email_sequences_created_by_fkey;
ALTER TABLE email_sequences ADD CONSTRAINT email_sequences_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE email_sequences ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE apollo_usage DROP CONSTRAINT apollo_usage_user_id_fkey;
ALTER TABLE apollo_usage ADD CONSTRAINT apollo_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE apollo_usage ALTER COLUMN user_id DROP NOT NULL;
```

### Task 4: Create client API
- `src/lib/api/team.ts` — createInvite, signupWithToken, deleteMember

### Task 5: Update LoginPage
- Add login/signup mode toggle
- Signup form: token + password fields
- Auto-login after successful signup

### Task 6: Update SettingsPage
- Wire "+ Add Team Member" button to open invite dialog
- Invite dialog: name, email, role inputs → generate token → show token
- Wire Trash button onClick to confirmation dialog
- Delete confirmation → call deleteMember → refresh profiles

### Task 7: Update use-profiles hook
- Add `deleteProfile` function (calls team.ts deleteMember, invalidates cache)

### Task 8: Update AuthContext
- Add `signup` function that calls signupWithToken then auto-logs in

### Task 9: Update documentation
- `docs/schema.md`: invites table, 3 new Edge Functions
- `docs/settings.md`: team management now functional
- `docs/authentication.md`: signup flow
- `docs/OVERVIEW.md`: major changes log

---

## Known Gotchas

```
1. supabase.auth.admin.createUser() requires the SERVICE_ROLE_KEY — this is
   why we use Edge Functions instead of calling from the frontend.

2. email_confirm: true skips email verification. The admin already verified
   the email by choosing it. The new user proves identity via the invite token.

3. The handle_new_user trigger creates the profile row automatically from
   user_metadata. We just need to update sending_email after (the trigger
   doesn't know about sending_email).

4. Small delay (500ms) between createUser and updating sending_email —
   the trigger is async and may not have fired yet.

5. Profile cascade-deletes when auth user is deleted (FK ON DELETE CASCADE).
   BUT: leads.assigned_to, deals.assigned_to, activities.user_id,
   campaigns.sent_by, email_sequences.created_by, apollo_usage.user_id
   all reference profiles(id) WITHOUT cascade. The delete-member Edge Function
   must ALTER these FKs to SET NULL or reassign records before deleting.
   Migration needed: ALTER FK constraints to ON DELETE SET NULL for all
   columns that reference profiles(id), making them nullable where needed.

6. Token: 32 hex chars (128 bits entropy). NOT brute-forceable.
   No prefix stored — just the raw hex. Display with INV- prefix in UI only.

7. ONLY signup-with-token is deployed with --no-verify-jwt. The other two
   (create-invite, delete-member) are deployed WITH JWT verification for
   an extra security layer.

8. The signup function should auto-login: after signupWithToken returns
   the email, call supabase.auth.signInWithPassword({ email, password }).

9. Password must be at least 8 characters. Validated in the Edge Function.

10. Invite token is atomically claimed (UPDATE WHERE used=false) BEFORE
    creating the user. If createUser fails, the claim is rolled back.

11. Demo credentials on LoginPage must only show in login mode, not signup.

12. Add invites table to src/types/database.ts for type safety.

13. The delete-member function should reassign the deleted user's leads
    to the admin before deleting, so no leads are orphaned.
```

---

## Validation Gates

1. `npm run build` passes
2. All 3 Edge Functions deploy successfully
3. Admin: click "+ Add Team Member" → dialog opens with name/email/role fields
4. Admin: fill in details → "Generate Invite" → token displayed (INV-XXXXXXXX)
5. Logout → Login page shows "Sign Up" option
6. Enter token + password → account created → auto-logged in
7. New member sees their name, can access leads assigned to them
8. Admin sees the new member in Team Management list
9. Admin clicks Trash on a member → confirmation → member deleted
10. Deleted member can no longer log in

---

## Deprecated Code (to remove)

| Code | File | Reason |
|------|------|--------|
| Placeholder `+ Add Team Member` button (no onClick) | SettingsPage.tsx | Replaced with working invite dialog |
| Placeholder Trash button (no onClick) | SettingsPage.tsx | Replaced with working delete handler |
