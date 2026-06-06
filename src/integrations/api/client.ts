// =============================================================================
// API client — thin fetch wrappers around the Netlify Functions.
// Replaces the Supabase JS client. The auth token (JWT) lives in localStorage
// and is attached as a Bearer header on every request.
// =============================================================================

const TOKEN_KEY = 'acquire_auth_token';
const API_BASE = '/api';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

interface JwtPayload {
  sub?: string;
  exp?: number;
  anon?: boolean;
  [k: string]: unknown;
}

/** Decode (without verifying) a JWT payload. Returns null if malformed. */
export function decodeToken(token: string): JwtPayload | null {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

/** Current user id (`sub`) from a non-expired token, else null. */
export function getUserIdFromToken(): string | null {
  const token = getToken();
  if (!token) return null;
  const payload = decodeToken(token);
  if (!payload?.sub) return null;
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    clearToken();
    return null;
  }
  return payload.sub;
}

/** True if the stored session is an anonymous one. */
export function isAnonymousToken(): boolean {
  const token = getToken();
  if (!token) return false;
  return decodeToken(token)?.anon === true;
}

export interface ApiResult<T = any> {
  ok: boolean;
  error: string | null;
  data: T | null;
}

interface ApiOptions {
  /** Keep the request alive across page unload (for disconnect beacons). */
  keepalive?: boolean;
}

export async function apiFetch<T = any>(
  path: string,
  body?: unknown,
  opts: ApiOptions = {},
): Promise<ApiResult<T>> {
  const token = getToken();
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
      keepalive: opts.keepalive,
    });

    let data: any = null;
    try { data = await res.json(); } catch { /* empty/non-JSON body */ }

    if (!res.ok) {
      return { ok: false, error: data?.error || `Request failed (${res.status})`, data: null };
    }
    return { ok: true, error: null, data };
  } catch (err) {
    console.error(`apiFetch ${path} failed:`, err);
    return { ok: false, error: 'Network error', data: null };
  }
}

// ---- Auth -------------------------------------------------------------------

/** Create (or reuse) an anonymous session. Returns the user id, or null. */
export async function signInAnonymous(): Promise<string | null> {
  const r = await apiFetch<{ token: string; userId: string }>('/auth/anonymous');
  if (r.ok && r.data?.token) {
    setToken(r.data.token);
    return r.data.userId;
  }
  return null;
}

export async function signUpUser(email: string, password: string, displayName: string) {
  const r = await apiFetch<{ token: string; userId: string; email: string }>(
    '/auth/signup', { email, password, displayName },
  );
  if (r.ok && r.data?.token) setToken(r.data.token);
  return r;
}

export async function loginUser(email: string, password: string) {
  const r = await apiFetch<{ token: string; userId: string; email: string }>(
    '/auth/login', { email, password },
  );
  if (r.ok && r.data?.token) setToken(r.data.token);
  return r;
}
