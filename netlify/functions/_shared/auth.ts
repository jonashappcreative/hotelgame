// JWT signing/verification using `jose` (replaces Supabase Auth).
// Both anonymous and registered sessions are HS256 tokens whose `sub` is the
// user's UUID from the `users` table.

import { SignJWT, jwtVerify } from 'jose';

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return new TextEncoder().encode(secret);
}

export interface SignOptions {
  /** jose expiry string, e.g. '48h', '7d'. Defaults to 48h (anonymous). */
  expiresIn?: string;
  /** Extra claims to embed (e.g. { anon: true }). */
  claims?: Record<string, unknown>;
}

export async function signToken(sub: string, opts: SignOptions = {}): Promise<string> {
  const { expiresIn = '48h', claims = {} } = opts;
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey());
}

/**
 * Verify the Bearer token on a request and return the user id (`sub`),
 * or null if missing/invalid.
 */
export async function verifyAuth(req: Request): Promise<string | null> {
  const header = req.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length);
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
