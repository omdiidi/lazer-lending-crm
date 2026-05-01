# Plan: Wire Supabase Auth

**Confidence: 9/10** — Small scope, clear interface, 2 files to change.

## Files Being Changed

```
src/
├── contexts/
│   └── AuthContext.tsx          ← MODIFIED (replace mock auth with Supabase Auth)
├── pages/
│   └── LoginPage.tsx            ← MODIFIED (async login, loading state)
└── App.tsx                      ← MODIFIED (handle auth loading state in AuthGate)
docs/
├── authentication.md            ← MODIFIED (update for real auth)
├── OVERVIEW.md                  ← MODIFIED (changelog entry)
└── state-management.md          ← MODIFIED (update AuthContext docs)
```

---

## Architecture Overview

### Before
```
LoginPage → login(email, pass) → mockCredentials.find() → setUser(mockUser) → sync boolean
AuthGate → checks user !== null → shows LoginPage or App
Refresh → user is null → back to login
```

### After
```
LoginPage → login(email, pass) → supabase.auth.signInWithPassword() → async result
AuthProvider → supabase.auth.onAuthStateChange() → fetches profile → sets user
AuthGate → checks loading first, then user → shows spinner, LoginPage, or App
Refresh → supabase auto-restores session from localStorage → user persists
```

### Consumer Impact
8 pages + 2 components consume `useAuth()`. They only use `user`, `isAdmin`, and `logout`. These keep the same types and behavior — no changes needed in any consumer.

The only interface change is `login()`: sync `boolean` → async `Promise<boolean>`. Only `LoginPage` calls this.

---

## Key Pseudocode

### AuthContext.tsx (complete rewrite)

```typescript
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { getProfile } from '@/lib/api/profiles';
import type { User } from '@/types/crm';

interface AuthContextType {
  user: User | null;
  loading: boolean;              // NEW: true while checking session
  login: (email: string, password: string) => Promise<boolean>;  // CHANGED: async
  logout: () => Promise<void>;   // CHANGED: async
  isAdmin: boolean;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);  // Start true — checking session

  useEffect(() => {
    // 1. Check existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        loadProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // 2. Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          await loadProfile(session.user.id);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(authUserId: string) {
    const profile = await getProfile(authUserId);
    setUser(profile);
    setLoading(false);
  }

  const login = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return false;
    return true;
    // Note: onAuthStateChange fires SIGNED_IN → loadProfile sets user
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    // onAuthStateChange fires SIGNED_OUT → setUser(null)
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}
```

**Key pattern:** Login doesn't set user directly. It calls Supabase Auth, which triggers `onAuthStateChange`, which calls `loadProfile`, which sets user. This ensures the auth state listener is the single source of truth.

### LoginPage.tsx (minimal changes)

```typescript
// Change handleSubmit to async, add loading state
const [loading, setLoading] = useState(false);

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setError('');
  setLoading(true);
  const success = await login(email, password);  // Now async
  if (!success) setError('Invalid email or password');
  setLoading(false);
};

// Button: add disabled={loading}, show "Signing in..." text when loading
<Button type="submit" className="w-full" disabled={loading}>
  {loading ? 'Signing in...' : 'Sign in'}
</Button>
```

### App.tsx AuthGate (add loading state)

```typescript
function AuthGate() {
  const { user, loading } = useAuth();

  // Show nothing (or a spinner) while checking session
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center animate-pulse">
          <span className="text-primary-foreground font-bold text-sm">I</span>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  // ... rest unchanged
}
```

---

## Task Execution Order

### Task 1: Rewrite AuthContext.tsx
- Replace all imports (remove mockUsers, mockCredentials; add supabase, getProfile)
- Add `loading` state (initialized to `true`)
- Add `useEffect` with `getSession()` + `onAuthStateChange()`
- Add `loadProfile()` helper
- Change `login` to async, use `supabase.auth.signInWithPassword()`
- Change `logout` to async, use `supabase.auth.signOut()`
- Export `loading` in context value
- Update `AuthContextType` interface

### Task 2: Update LoginPage.tsx
- Add `loading` state
- Make `handleSubmit` async, add `setLoading(true/false)` around the await
- Update Button to show loading text and be disabled while loading

### Task 3: Update App.tsx AuthGate
- Destructure `loading` from `useAuth()`
- Add loading check before user check (show branded loading indicator)

### Task 4: Update docs
- `docs/authentication.md`: Update login flow, note session persistence, remove "no session management" from limitations, update changelog
- `docs/state-management.md`: Update AuthContext section — new interface with `loading`, async methods, note session auto-restore, update changelog
- `docs/OVERVIEW.md`: Add Major Changes Log entry for auth wiring

---

## Validation Gates

1. `npm run build` passes with no TypeScript errors
2. `npm run dev` starts without errors
3. Login with sarah@integrateapi.ai / admin123 works
4. Page refresh does NOT log you out (session persists)
5. Logout button works (returns to login page)
6. Login with wrong credentials shows error message

---

## Deprecated Code (to remove)

In `AuthContext.tsx`:
- Remove `import { mockUsers, mockCredentials } from '@/data/mockData'` — no longer needed
- The `mockCredentials` and `mockUsers` arrays in `mockData.ts` are NOT removed yet — they're still used by CRMContext for user name lookups. They'll be removed when CRMContext is swapped to real data.
