import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  apiFetch,
  clearToken,
  decodeToken,
  getToken,
  isAnonymousToken,
  loginUser,
  signUpUser,
} from '@/integrations/api/client';

interface AppUser {
  id: string;
  email?: string;
}

interface Profile {
  id: string;
  user_id: string;
  display_name: string;
}

interface AuthContextType {
  user: AppUser | null;
  /** Raw JWT for the current registered session, or null. */
  session: string | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// A registered (non-anonymous) user from the stored token, or null.
function registeredUserFromToken(): AppUser | null {
  const token = getToken();
  if (!token || isAnonymousToken()) return null;
  const payload = decodeToken(token);
  if (!payload?.sub) return null;
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return { id: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async () => {
    const { ok, data } = await apiFetch<{ profile: Profile | null }>('/account', { op: 'get_profile' });
    if (ok && data?.profile) setProfile(data.profile);
  };

  useEffect(() => {
    const current = registeredUserFromToken();
    if (current) {
      setUser(current);
      setSession(getToken());
      fetchProfile();
    }
    setLoading(false);
  }, []);

  const signUp = async (email: string, password: string, displayName: string) => {
    const { ok, error } = await signUpUser(email, password, displayName);
    if (!ok) return { error: new Error(error || 'Sign up failed') };

    const current = registeredUserFromToken();
    setUser(current);
    setSession(getToken());
    await fetchProfile();
    return { error: null };
  };

  const signIn = async (email: string, password: string) => {
    const { ok, error } = await loginUser(email, password);
    if (!ok) return { error: new Error(error || 'Sign in failed') };

    const current = registeredUserFromToken();
    setUser(current);
    setSession(getToken());
    await fetchProfile();
    return { error: null };
  };

  const signOut = async () => {
    clearToken();
    setUser(null);
    setSession(null);
    setProfile(null);
  };

  const updateDisplayName = async (displayName: string) => {
    if (!user) return { error: new Error('Not authenticated') };

    const { ok, data, error } = await apiFetch<{ profile: Profile }>(
      '/account', { op: 'set_display_name', displayName },
    );
    if (!ok) return { error: new Error(error || 'Failed to update display name') };

    if (data?.profile) {
      setProfile(data.profile);
    } else {
      setProfile(prev => (prev ? { ...prev, display_name: displayName } : null));
    }
    return { error: null };
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      loading,
      signUp,
      signIn,
      signOut,
      updateDisplayName
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
