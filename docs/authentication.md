# Authentication

> Login flow, role-based access control, and auth gating.

**Status:** Active
**Last Updated:** 2026-03-22
**Related Docs:** [OVERVIEW.md](./OVERVIEW.md) | [state-management.md](./state-management.md) | [architecture.md](./architecture.md)

---

## Overview

Authentication is a Supabase Auth implementation using email/password authentication with session persistence. The login page calls `supabase.auth.signInWithPassword()` via the AuthContext, which validates credentials and returns a JWT. Sessions are persisted across page refreshes via Supabase's built-in session management. There are two roles — `admin` and `employee` — which control data visibility and feature access throughout the app. New members join via a token-based invite flow: an admin generates an invite link, the new member visits it and sets a password, and the `signup-with-token` Edge Function creates their account and returns a session for immediate auto-login.

---

## File Map

| File | Purpose |
|------|---------|
| `src/pages/LoginPage.tsx` | Login form UI with Sign In / Sign Up toggle, async submit and loading state |
| `src/contexts/AuthContext.tsx` | Auth state, Supabase login/logout logic, session management, role derivation |
| `src/App.tsx` | `AuthGate` component — loading state check, then user check |
| `src/lib/supabase.ts` | Supabase client used by AuthContext |

---

## Detailed Behavior

### Login Flow

```
User enters email + password
    │
    ▼
LoginPage calls login(email, password) [async, with loading state]
    │
    ▼
AuthContext calls supabase.auth.signInWithPassword()
    │
    ├── Error → returns false → LoginPage shows error message
    │
    └── Success → Supabase validates credentials, returns JWT
                          │
                          ▼
                    onAuthStateChange fires SIGNED_IN event
                          │
                          ▼
                    AuthContext fetches profile from profiles table
                          │
                          ▼
                    Sets user state → AuthGate re-renders
                          │
                          ▼
                    CRMProvider + Routes rendered → Dashboard shown
```

### Login Page UI

- Centered card on muted background
- "IntegrateAPI" branding (blue "I" icon)
- **Sign In / Sign Up toggle** — tabs or button pair at the top of the card switch between login mode and signup mode
- Email input (required, type="email") — pre-filled from invite token when arriving via invite link
- Password input (required, type="password")
- "Sign in" / "Sign up" button (full width, label changes with mode)
- Loading state on submit button (disabled + contextual loading text)
- Error message display (red text, shown on failed login or invalid token)
- try/catch/finally for network error handling
- Demo credentials section showing test accounts (Sign In mode only)

### Demo Credentials

| Account | Email | Password |
|---------|-------|----------|
| Admin | sarah@integrateapi.ai | admin123 |
| Employee | marcus@integrateapi.ai | employee123 |
| Employee | aisha@integrateapi.ai | employee123 |

### Signup Flow (Invite Token)

New members can only join via an admin-generated invite link. Self-registration without a token is not supported.

```
Admin generates invite in Settings
    │
    ▼
create-invite Edge Function returns invite link
(e.g. https://<app>/login?token=<token>&email=<email>)
    │
    ▼
Admin shares link with new member out-of-band
    │
    ▼
New member opens link → LoginPage mounts in Sign Up mode
    │  (token + email pre-filled from URL query params)
    │
    ▼
New member enters their password and submits
    │
    ▼
LoginPage calls signup-with-token Edge Function
with { token, password }
    │
    ├── Token invalid / expired / already used
    │       → Edge Function returns error
    │       → LoginPage shows error message
    │
    └── Token valid
            │
            ▼
        Edge Function validates invite (exists, not used, not expired)
            │
            ▼
        supabase.auth.admin.createUser called with
        email + password + raw_user_meta_data: { name, role }
            │
            ▼
        handle_new_user trigger fires → profiles row created
            │
            ▼
        Invite marked used = true
            │
            ▼
        Edge Function returns session (access + refresh tokens)
            │
            ▼
        LoginPage calls supabase.auth.setSession()
            │
            ▼
        onAuthStateChange fires SIGNED_IN event
            │
            ▼
        AuthContext fetches profile → sets user state
            │
            ▼
        AuthGate re-renders → Dashboard shown
```

**Key points:**
- The invite token encodes `name` and `role` — the new member sets only their password
- Tokens expire after 7 days and are single-use
- Auto-login happens immediately after account creation — no separate login step required
- If the token is expired or already used, a clear error is shown and the admin must generate a new invite

### Role-Based Access Control

The `isAdmin` boolean (derived from `user.role === 'admin'`) controls visibility across the app:

| Feature | Admin View | Employee View |
|---------|-----------|---------------|
| Dashboard title | "Team Dashboard" | "Welcome back, [Name]" |
| Dashboard data | All leads/activities/deals | Only assigned items |
| Leads table | All leads + "Assigned Rep" column | Only assigned leads |
| Lead detail | All leads accessible | Only assigned leads |
| Pipeline | All deals + assigned rep display | Only assigned deals |
| Team leaderboard | Visible | Hidden |
| Team management (Settings) | Visible with user list | Hidden |
| Outreach | All emails | All emails (no filtering) |

### Auth Gating (AuthGate Component)

Located in `src/App.tsx`. Checks `loading` first, then `user`:
```typescript
function AuthGate() {
  const { user, loading } = useAuth();
  if (loading) return <BrandedSpinner />;
  if (!user) return <LoginPage />;
  return (
    <CRMProvider>
      <Routes>...</Routes>
    </CRMProvider>
  );
}
```

- `loading` is `true` on initial mount while Supabase restores any existing session — shows a branded spinner to prevent flash of login page
- No route-level guards — entire app is behind a single auth check
- CRMProvider is only rendered when authenticated
- NotFound route is inside the authenticated block (404 only for logged-in users)

### refreshUser()

`refreshUser() → Promise<void>` — Re-fetches the current user's profile from Supabase and updates the user state. Uses `supabase.auth.getSession()` to get the session-based user ID, then queries the `profiles` table directly. Called after profile edits in the Settings page to ensure the UI (sidebar display name, profile card) reflects the saved changes without requiring a page reload.

### Logout

- Triggered by "Sign out" button in sidebar footer (`AppSidebar.tsx`)
- Calls `logout()` from AuthContext, which calls `supabase.auth.signOut()` and immediately clears `user` state
- `onAuthStateChange` fires SIGNED_OUT event, confirming the state clear
- AuthGate re-renders, showing LoginPage

---

## Known Limitations & TODOs

- No "remember me" functionality
- Signup requires an admin-generated invite token — no self-registration
- No password reset / forgot password
- No email verification
- No rate limiting on login attempts
- No account lockout
- NotFound page is inside auth gate — unauthenticated users can't see 404s
- No route-level permissions (admin routes accessible to employees via URL)
- Invite link must be shared manually — no automated email delivery

---

## Future Considerations

- Add protected route wrapper that checks `isAdmin` for admin-only pages
- Consider OAuth/SSO integration (Google, Microsoft) via Supabase Auth providers
- Add session refresh/expiry handling (Supabase handles refresh tokens automatically, but explicit expiry UI may be useful)
- Add password reset flow (Supabase `resetPasswordForEmail` is available)
- Automate invite email delivery so the admin does not need to copy and share the link manually

---

## Changelog

| Date | Change | Files Affected |
|------|--------|----------------|
| 2026-03-22 | Initial documentation created | — |
| 2026-03-22 | Auth wired to Supabase — real login, session persistence, JWT tokens | `AuthContext.tsx`, `LoginPage.tsx`, `App.tsx` |
| 2026-03-23 | Added refreshUser function to AuthContext | `AuthContext.tsx` |
| 2026-03-23 | Signup via invite token: login page gains Sign In / Sign Up toggle; signup-with-token Edge Function validates token, creates account, and auto-logs in new member | `LoginPage.tsx`, `AuthContext.tsx`, `supabase/functions/signup-with-token/` |
