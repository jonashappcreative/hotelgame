// =============================================================================
// account — profile + game history (per authenticated user)
// =============================================================================

import { query } from '../lib/db';
import { verifyAuth } from '../lib/auth';
import { getCorsHeaders, jsonResponse } from '../lib/cors';
import { serverError } from '../lib/errors';

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
        // Reads game_result_players (Epic 16), not game_history. game_history
        // never had a writer and its ON DELETE CASCADE against game_rooms meant
        // any row would have been deleted by cleanup-rooms within ~10 minutes
        // of the game ending — this page has been empty since it shipped.
        // Field names are unchanged so src/pages/GameHistory.tsx needs no edit;
        // room_id is aliased from source_room_id, which is a bare UUID here
        // (the room itself is long gone).
        const rows = await query(
          `SELECT p.id,
                  r.source_room_id AS room_id,
                  p.final_cash,
                  p.final_stock_value,
                  p.final_total,
                  p.placement,
                  r.ended_at AS played_at
             FROM game_result_players p
             JOIN game_results r ON r.id = p.result_id
            WHERE p.user_id = $1
            ORDER BY r.ended_at DESC
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
