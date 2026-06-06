// POST /api/auth/login  { email, password }
// Verifies credentials and returns a 7-day JWT.

import bcrypt from 'bcryptjs';
import { query } from './_shared/db';
import { signToken } from './_shared/auth';
import { getCorsHeaders, jsonResponse } from './_shared/cors';

export default async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, cors);

  try {
    const { email, password } = await req.json();
    if (typeof email !== 'string' || typeof password !== 'string') {
      return jsonResponse({ error: 'Email and password are required' }, 400, cors);
    }

    const rows = await query<{ id: string; password_hash: string | null }>(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()],
    );

    // Use a generic message and always run a hash comparison shape to avoid
    // leaking which emails exist / timing differences.
    const user = rows[0];
    const hash = user?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !user.password_hash || !ok) {
      return jsonResponse({ error: 'Invalid email or password' }, 401, cors);
    }

    const token = await signToken(user.id, { expiresIn: '7d' });
    return jsonResponse({ token, userId: user.id, email: email.toLowerCase(), isAnonymous: false }, 200, cors);
  } catch (err) {
    console.error('auth-login error:', err);
    return jsonResponse({ error: 'An internal error occurred' }, 500, cors);
  }
};
