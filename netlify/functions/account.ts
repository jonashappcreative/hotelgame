// =============================================================================
// account — Netlify Function: profile + game history (per authenticated user)
// =============================================================================

import { query } from './_shared/db';
import { verifyAuth } from './_shared/auth';
import { getCorsHeaders, jsonResponse } from './_shared/cors';
import { serverError } from './_shared/errors';

export default async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, cors);

  const userId = await verifyAuth(req);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401, cors);

  try {
    const body = await req.json() as any;
    const op = body?.op as string;

    switch (op) {
      case 'get_profile': {
        const rows = await query(
          'SELECT id, user_id, display_name FROM profiles WHERE user_id = $1',
          [userId],
        );
        return jsonResponse({ profile: rows[0] ?? null }, 200, cors);
      }

      case 'set_display_name': {
        const displayName = String(body.displayName || '').trim();
        if (!displayName) return jsonResponse({ error: 'displayName required' }, 400, cors);
        const rows = await query(
          `INSERT INTO profiles (user_id, display_name)
           VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
           RETURNING id, user_id, display_name`,
          [userId, displayName],
        );
        return jsonResponse({ profile: rows[0] }, 200, cors);
      }

      case 'list_history': {
        const rows = await query(
          `SELECT id, room_id, final_cash, final_stock_value, final_total, placement, played_at
             FROM game_history
            WHERE user_id = $1
            ORDER BY played_at DESC
            LIMIT 50`,
          [userId],
        );
        return jsonResponse({ history: rows }, 200, cors);
      }

      default:
        return jsonResponse({ error: `Unknown op: ${op}` }, 400, cors);
    }
  } catch (err) {
    return serverError('account error', err, cors);
  }
};
