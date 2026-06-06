// POST /api/auth/signup  { email, password, displayName? }
// Creates a registered user (bcrypt-hashed password) and returns a 7-day JWT.

import bcrypt from 'bcryptjs';
import { query } from './_shared/db';
import { signToken } from './_shared/auth';
import { getCorsHeaders, jsonResponse } from './_shared/cors';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, cors);

  try {
    const { email, password, displayName } = await req.json();

    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return jsonResponse({ error: 'A valid email is required' }, 400, cors);
    }
    if (typeof password !== 'string' || password.length < 8) {
      return jsonResponse({ error: 'Password must be at least 8 characters' }, 400, cors);
    }

    const normalizedEmail = email.toLowerCase();

    const existing = await query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail],
    );
    if (existing.length > 0) {
      return jsonResponse({ error: 'An account with this email already exists' }, 409, cors);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const rows = await query<{ id: string }>(
      'INSERT INTO users (email, password_hash, is_anonymous) VALUES ($1, $2, false) RETURNING id',
      [normalizedEmail, passwordHash],
    );
    const userId = rows[0].id;

    if (typeof displayName === 'string' && displayName.trim().length > 0) {
      await query(
        'INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)',
        [userId, displayName.trim()],
      );
    }

    const token = await signToken(userId, { expiresIn: '7d' });
    return jsonResponse({ token, userId, email: normalizedEmail, isAnonymous: false }, 200, cors);
  } catch (err) {
    console.error('auth-signup error:', err);
    return jsonResponse({ error: 'An internal error occurred' }, 500, cors);
  }
};
