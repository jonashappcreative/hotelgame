// POST /api/auth/anonymous
// Creates an anonymous user row and returns a short-lived (48h) JWT.
// Mirrors Supabase's signInAnonymously().

import { query } from './_shared/db';
import { signToken } from './_shared/auth';
import { getCorsHeaders, jsonResponse } from './_shared/cors';

export default async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, cors);

  try {
    const rows = await query<{ id: string }>(
      'INSERT INTO users (is_anonymous) VALUES (true) RETURNING id',
    );
    const userId = rows[0].id;
    const token = await signToken(userId, { expiresIn: '48h', claims: { anon: true } });
    return jsonResponse({ token, userId, isAnonymous: true }, 200, cors);
  } catch (err) {
    console.error('auth-anonymous error:', err);
    return jsonResponse({ error: 'An internal error occurred' }, 500, cors);
  }
};
