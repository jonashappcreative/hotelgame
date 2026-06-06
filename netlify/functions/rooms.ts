// =============================================================================
// rooms — Netlify Function: room + player + game-state data operations
// =============================================================================
// Dispatches on `op`. Replaces all the direct `supabase.from(...)` reads/writes
// the browser used to perform. Every op requires a valid JWT; data returned to
// the browser comes only from the *_public views (tiles / tile_bag stripped),
// except a player's own tiles (served via WHERE user_id = <jwt sub>).
// =============================================================================

import { db, query } from './_shared/db';
import { verifyAuth } from './_shared/auth';
import { getCorsHeaders, jsonResponse } from './_shared/cors';
import { notifyWsServer } from './_shared/ws';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_ACTIVE_ROOMS_PER_USER = 5;

function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

export default async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, cors);

  const userId = await verifyAuth(req);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401, cors);

  try {
    const body = await req.json();
    const op = body?.op as string;
    const roomId = body?.roomId as string | undefined;

    switch (op) {
      // ---- create a room -----------------------------------------------------
      case 'create': {
        const maxPlayers = Math.min(6, Math.max(2, Number(body.maxPlayers) || 4));
        const customRules = body.customRules ?? null;

        // Enforce the active-room limit (was a DB trigger under Supabase).
        const limitRows = await query<{ count: string }>(
          `SELECT COUNT(*)::int AS count
             FROM game_players gp
             JOIN game_rooms gr ON gr.id = gp.room_id
            WHERE gp.user_id = $1 AND gp.player_index = 0
              AND gr.status IN ('waiting', 'playing')`,
          [userId],
        );
        if (Number(limitRows[0]?.count ?? 0) >= MAX_ACTIVE_ROOMS_PER_USER) {
          return jsonResponse(
            { error: `Maximum active rooms limit reached (${MAX_ACTIVE_ROOMS_PER_USER}). Finish or leave existing games first.` },
            429, cors,
          );
        }

        // Insert with a few retries to dodge room_code collisions.
        for (let attempt = 0; attempt < 5; attempt++) {
          const roomCode = generateRoomCode();
          try {
            const rows = await query<{ id: string; room_code: string; max_players: number }>(
              `INSERT INTO game_rooms (room_code, max_players, custom_rules)
               VALUES ($1, $2, $3::jsonb)
               RETURNING id, room_code, max_players`,
              [roomCode, maxPlayers, customRules === null ? null : JSON.stringify(customRules)],
            );
            const room = rows[0];
            return jsonResponse(
              { roomCode: room.room_code, roomId: room.id, maxPlayers: room.max_players },
              200, cors,
            );
          } catch (err: any) {
            if (err?.code === '23505') continue; // duplicate room_code, retry
            throw err;
          }
        }
        return jsonResponse({ error: 'Failed to generate a unique room code' }, 500, cors);
      }

      // ---- room metadata -----------------------------------------------------
      case 'get_room': {
        if (!roomId) return jsonResponse({ error: 'roomId required' }, 400, cors);
        const { data } = await db.from('game_rooms')
          .select('id, room_code, status, max_players, custom_rules')
          .eq('id', roomId).single();
        return jsonResponse({ room: data ?? null }, 200, cors);
      }

      case 'get_rules': {
        if (!roomId) return jsonResponse({ error: 'roomId required' }, 400, cors);
        const { data } = await db.from('game_rooms')
          .select('custom_rules').eq('id', roomId).single();
        return jsonResponse({ customRules: data?.custom_rules ?? null }, 200, cors);
      }

      // ---- find the user's active game (reconnection) ------------------------
      case 'find_active': {
        const rows = await query(
          `SELECT gp.player_index, gp.player_name,
                  gr.id AS room_id, gr.room_code, gr.status
             FROM game_players gp
             JOIN game_rooms gr ON gr.id = gp.room_id
            WHERE gp.user_id = $1 AND gr.status IN ('waiting', 'playing')
            ORDER BY gr.updated_at DESC
            LIMIT 1`,
          [userId],
        );
        return jsonResponse({ active: rows[0] ?? null }, 200, cors);
      }

      // ---- public player list ------------------------------------------------
      case 'list_players': {
        if (!roomId) return jsonResponse({ error: 'roomId required' }, 400, cors);
        const { data } = await db.from('game_players_public')
          .select('id, player_name, player_index, cash, stocks, is_connected, is_ready, created_at')
          .eq('room_id', roomId).order('player_index');
        return jsonResponse({ players: data ?? [] }, 200, cors);
      }

      // ---- secure player list (own tiles included) ---------------------------
      case 'get_players': {
        if (!roomId) return jsonResponse({ error: 'roomId required' }, 400, cors);
        const { data: publicPlayers } = await db.from('game_players_public')
          .select('id, room_id, player_name, player_index, cash, stocks, is_connected, is_ready, created_at')
          .eq('room_id', roomId).order('player_index');

        const { data: me } = await db.from('game_players')
          .select('player_index, tiles')
          .eq('room_id', roomId).eq('user_id', userId).single();

        const myIndex = me?.player_index ?? -1;
        const myTiles: string[] = me?.tiles ?? [];
        const players = (publicPlayers ?? []).map((p: any) => ({
          ...p,
          tiles: p.player_index === myIndex ? myTiles : [],
        }));
        return jsonResponse({ players }, 200, cors);
      }

      // ---- public game state -------------------------------------------------
      case 'get_state': {
        if (!roomId) return jsonResponse({ error: 'roomId required' }, 400, cors);
        const { data } = await db.from('game_states_public')
          .select('*').eq('room_id', roomId).single();
        return jsonResponse({ state: data ?? null }, 200, cors);
      }

      // ---- join (or reconnect) ----------------------------------------------
      case 'join': {
        const roomCode = String(body.roomCode || '').toUpperCase();
        const playerName = String(body.playerName || '').trim();
        const sessionId = String(body.sessionId || '');
        if (!roomCode || !playerName) {
          return jsonResponse({ error: 'roomCode and playerName required' }, 400, cors);
        }

        const { data: room } = await db.from('game_rooms')
          .select('id, room_code, status, max_players')
          .eq('room_code', roomCode).single();
        if (!room) return jsonResponse({ error: 'Room not found' }, 404, cors);

        const maxPlayers = room.max_players || 4;

        // Already a player? → reconnect (allowed regardless of room status).
        const { data: existing } = await db.from('game_players')
          .select('id, player_index, player_name')
          .eq('room_id', room.id).eq('user_id', userId).single();

        if (existing) {
          await db.from('game_players')
            .update({ is_connected: true, last_seen_at: new Date().toISOString(), disconnected_at: null })
            .eq('id', existing.id);
          await notifyWsServer(room.id, 'game:players_changed', { roomId: room.id });
          return jsonResponse({
            success: true, roomId: room.id, playerIndex: existing.player_index,
            maxPlayers, isRejoin: room.status === 'playing',
          }, 200, cors);
        }

        if (room.status !== 'waiting') {
          return jsonResponse({
            error: 'Game already in progress. You can only rejoin with the same account you used to join.',
          }, 403, cors);
        }

        // Insert at the next free player_index, retrying on races.
        for (let attempt = 0; attempt < 5; attempt++) {
          const { data: players } = await db.from('game_players_public')
            .select('player_index').eq('room_id', room.id).order('player_index');

          if ((players?.length ?? 0) >= maxPlayers) {
            return jsonResponse({ error: 'Room is full' }, 409, cors);
          }

          const used = new Set((players ?? []).map((p: any) => p.player_index));
          let playerIndex = 0;
          while (used.has(playerIndex) && playerIndex < maxPlayers) playerIndex++;
          if (playerIndex >= maxPlayers) {
            return jsonResponse({ error: 'Room is full' }, 409, cors);
          }

          try {
            const rows = await query<{ player_index: number }>(
              `INSERT INTO game_players (room_id, player_name, player_index, user_id, session_id)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING player_index`,
              [room.id, playerName, playerIndex, userId, sessionId],
            );
            await notifyWsServer(room.id, 'game:players_changed', { roomId: room.id });
            return jsonResponse({
              success: true, roomId: room.id, playerIndex: rows[0].player_index, maxPlayers,
            }, 200, cors);
          } catch (err: any) {
            if (err?.code === '23505') {
              // Either our user already joined in parallel, or the index raced.
              const { data: nowExisting } = await db.from('game_players')
                .select('player_index').eq('room_id', room.id).eq('user_id', userId).single();
              if (nowExisting) {
                return jsonResponse({
                  success: true, roomId: room.id, playerIndex: nowExisting.player_index, maxPlayers,
                }, 200, cors);
              }
              const backoff = 150 * Math.pow(2, attempt) + Math.random() * 100;
              await new Promise((r) => setTimeout(r, backoff));
              continue;
            }
            throw err;
          }
        }
        return jsonResponse({ error: 'Failed to join room after multiple attempts' }, 409, cors);
      }

      // ---- leave -------------------------------------------------------------
      case 'leave': {
        if (!roomId) return jsonResponse({ error: 'roomId required' }, 400, cors);
        await db.from('game_players').delete().eq('room_id', roomId).eq('user_id', userId);
        await notifyWsServer(roomId, 'game:players_changed', { roomId });
        return jsonResponse({ success: true }, 200, cors);
      }

      // ---- presence ----------------------------------------------------------
      case 'heartbeat': {
        if (!roomId) return jsonResponse({ error: 'roomId required' }, 400, cors);
        await db.from('game_players')
          .update({ is_connected: true, last_seen_at: new Date().toISOString(), disconnected_at: null })
          .eq('room_id', roomId).eq('user_id', userId);
        return jsonResponse({ success: true }, 200, cors);
      }

      case 'disconnect': {
        if (!roomId) return jsonResponse({ error: 'roomId required' }, 400, cors);
        await db.from('game_players')
          .update({ is_connected: false, disconnected_at: new Date().toISOString() })
          .eq('room_id', roomId).eq('user_id', userId);
        await notifyWsServer(roomId, 'game:players_changed', { roomId });
        return jsonResponse({ success: true }, 200, cors);
      }

      default:
        return jsonResponse({ error: `Unknown op: ${op}` }, 400, cors);
    }
  } catch (err) {
    console.error('rooms error:', err);
    return jsonResponse({ error: 'An internal error occurred' }, 500, cors);
  }
};
