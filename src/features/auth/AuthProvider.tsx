import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

interface AuthState {
  session: Session | null;
  isLoading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  isSigningOut: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ session: null, isLoading: true, error: null });
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    let authChanged = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // getSession handles initial restoration and its errors below.
      if (!active || event === 'INITIAL_SESSION') return;
      authChanged = true;
      setAuth({ session, isLoading: false, error: null });
    });

    function restorationFailed() {
      if (!active || authChanged) return;
      setAuth({
        session: null,
        isLoading: false,
        error: 'Your session could not be restored. Please sign in again.',
      });
    }

    void supabase.auth.getSession().then(({ data, error }) => {
      // A newer sign-in, sign-out, or token refresh must win over this read.
      if (!active || authChanged) return;
      if (error) restorationFailed();
      else setAuth({ session: data.session, isLoading: false, error: null });
    }).catch(restorationFailed);

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setAuth((current) => ({ ...current, error: null }));
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
    } catch {
      // Local logout can clear the session before server revocation completes.
      // Keep its result in the provider so it survives the route redirect.
      setAuth((current) => ({
        ...current,
        error: current.session
          ? 'Unable to log out. Please check your connection and try again.'
          : 'You are signed out on this device, but server logout could not be confirmed. Please check your connection.',
      }));
    } finally {
      setIsSigningOut(false);
    }
  }

  return <AuthContext value={{ ...auth, isSigningOut, signOut }}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used within AuthProvider');
  return auth;
}
