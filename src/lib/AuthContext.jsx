import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { queryClientInstance } from '@/lib/query-client';
import { supabase } from '@/lib/supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!mounted) return;
      setSession(initialSession);
      setUser(initialSession?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async ({ email, password }) => {
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signUp({ email: normalizedEmail, password });

    console.log("SIGNUP RESULT", data, error);

    if (error) {
      return { user: null, session: null, error, needsEmailConfirmation: false };
    }

    if (data.session) {
      return { user: data.user, session: data.session, error: null, needsEmailConfirmation: false };
    }

    return { user: data.user, session: null, error: null, needsEmailConfirmation: true };
  }, []);

  const signIn = useCallback(async ({ email, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    console.log("LOGIN RESULT", data, error);

    if (error) {
      const message =
        error.message === 'Invalid login credentials'
          ? 'Email or password is incorrect'
          : error.message;
      return { user: null, session: null, error: { ...error, message } };
    }

    return { user: data.user, session: data.session, error: null };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    queryClientInstance.clear();
    if (error) return { error };
    return { error: null };
  }, []);

  const value = {
    user,
    session,
    loading,
    isAuthenticated: !!user,
    signUp,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}
