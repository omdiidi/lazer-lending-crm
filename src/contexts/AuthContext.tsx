import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { getProfile } from '@/lib/api/profiles';
import type { User } from '@/types/crm';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Helper to load profile and set user
    async function loadProfile(userId: string) {
      try {
        const profile = await getProfile(userId);
        if (!mounted) return;
        if (profile) {
          setUser(profile);
        } else {
          // Profile not found (trigger may be slow) — retry once after short delay
          await new Promise(r => setTimeout(r, 500));
          if (!mounted) return;
          const retry = await getProfile(userId);
          if (mounted) setUser(retry);
        }
      } catch {
        if (mounted) setUser(null);
      }
      if (mounted) setLoading(false);
    }

    // IMPORTANT: The onAuthStateChange callback holds an internal Supabase lock.
    // If we `await` inside it (e.g., calling getProfile which queries Supabase),
    // it can deadlock. Instead, extract the user ID and call loadProfile OUTSIDE
    // the callback using setTimeout(0) to break out of the lock context.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        if (session?.user) {
          // Break out of the lock context before making DB calls
          setTimeout(() => {
            if (mounted) loadProfile(session.user.id);
          }, 0);
        } else {
          setUser(null);
          setLoading(false);
        }
      }
    );

    // Safety net: if auth never resolves (network issue, corrupted session),
    // force loading to false after 5 seconds so the login page shows.
    const timeout = setTimeout(() => {
      if (mounted && loading) {
        setLoading(false);
      }
    }, 5000);

    return () => {
      mounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return false;
    // onAuthStateChange will fire SIGNED_IN → loadProfile → setUser
    return true;
  }, []);

  const logout = useCallback(async () => {
    setUser(null); // Clear immediately for instant UI response
    await supabase.auth.signOut();
  }, []);

  const refreshUser = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const profile = await getProfile(session.user.id);
      setUser(profile);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
