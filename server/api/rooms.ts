// =============================================================================
// rooms — room + player + game-state data operations
// =============================================================================
// Dispatches on `op`. Replaces all the direct `supabase.from(...)` reads/writes
// the browser used to perform. Every op requires a valid JWT; data returned to
// the browser comes only from the *_public views (tiles / tile_bag stripped),
// except a player's own tiles (served via WHERE user_id = <jwt sub>).
//
// Epic 15 notes:
//   * The host is `game_rooms.host_user_id`, never seat 0 — that is what lets
//     the host sit anywhere in the turn order.
//   * Rules are validated against an allowlist before they touch JSONB, and
//     stay editable (op: 'update_rules') until the game starts.
//   * Any change to the group clears every human's ready flag, so "ready"
//     means "ready to play with exactly this group".
// =============================================================================

import { randomUUID } from 'node:crypto';
import { db, query } from '../lib/db';
import { verifyAuth } from '../lib/auth';
import { getCorsHeaders, jsonResponse } from '../lib/cors';
import { serverError } from '../lib/errors';
import { notifyWsServer } from '../lib/ws';
import { normalizeRules, validateRules } from '../lib/rules';
import {
  ROOM_CAPACITY,
  reindexPlayers,
  resetReadyFlags,
  transferHost,
} from '../lib/players';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_ACTIVE_ROOMS_PER_USER = 5;
const BOT_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const BOT_NAMES = ['Aria', 'Byte', 'Cortex', 'Delta', 'Echo', 'Flux'];
const TURN_ORDER_MODES = new Set(['random', 'manual']);

function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

interface HostRoom {
  id: string;
  status: string;
  max_players: number;
  host_user_id: string | null;
  turn_order_mode: string;
}

/**
 * Load a room and assert the caller may reconfigure it: they must be the host
 * and the game must not have started. Returns either the room or the Response
 * to send back, so each host-only op is one guard clause.
 */
async function requireWaitingHost(
  roomId: string,
  userId: string,
  cors: Record<string, string>,
): Promise<{ room: HostRoom } | { error: Response }> {
  if (!roomId) return { error: jsonResponse({ error: 'roomId required' }, 400, cors) };

  const { data: room } = await db.from('game_rooms')
    .select('id, status, max_players, host_user_id, turn_order_mode')
    .eq('id', roomId).single();

  if (!room) return { error: jsonResponse({ error: 'Room not found' }, 404, cors) };
  if (room.host_user_id !== userId) {
    return { error: jsonResponse({ error: 'Only the host can do that' }, 403, cors) };
  }
  if (room.status !== 'waiting') {
    return { error: jsonResponse({ error: 'The game has already started' }, 409, cors) };
  }
  return { room: room as HostRoom };
}

/** Seats 0..n-1 with no gaps, in current seat order — call after anyone leaves. */
async function compactSeats(roomId: string): Promise<void> {
  const rows = await query<{ id: string }>(
    'SELECT id FROM game_players WHERE room_id = $1 ORDER BY player_index',
    [roomId],
  );
  await reindexPlayers(roomId, rows.map((r) => r.id));
}

function broadcastPlayers(roomId: string): void {
  notifyWsServer(roomId, 'game:players_changed', { roomId })
    .catch((err: unknown) => console.error('notify error:', err));
}

export default async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, cors);

  const userId = await verifyAuth(req);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401, cors);

  try {
    const body = await req.json() as any;
    const op = body?.op as string;
    const roomId = body?.roomId as string;

    switch (op) {
      // ---- create a room -----------------------------------------------------
      case 'create': {
        // Rules are validated against an explicit allowlist before they are
        // stringified into JSONB — an out-of-range value is a 400 here rather
        // than a NaN surfacing mid-game.
        const validation = validateRules(body.customRules ?? null);
        if (!validation.ok) {
          return jsonResponse({ error: `Invalid rules: ${validation.errors.join('; ')}` }, 400, cors);
        }
        const customRules = validation.rules;

        // Enforce the active-room limit (was a DB trigger under Supabase).
        // Counts rooms the caller *hosts*, which is now an explicit column.
        const limitRows = await query<{ count: string }>(
          `SELECT COUNT(*)::int AS count
             FROM game_rooms
            WHERE host_user_id = $1 AND status IN ('waiting', 'playing')`,
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
              `INSERT INTO game_rooms (room_code, max_players, custom_rules, host_user_id)
               VALUES ($1, $2, $3::jsonb, $4)
               RETURNING id, room_code, max_players`,
              [roomCode, ROOM_CAPACITY, JSON.stringify(customRules), userId],
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

      // ---- edit the rules of a waiting room (host only) ----------------------
      case 'update_rules': {
        const guard = await requireWaitingHost(roomId, userId, cors);
        if ('error' in guard) return guard.error;

        const validation = validateRules(body.customRules ?? null);
        if (!validation.ok) {
          return jsonResponse({ error: `Invalid rules: ${validation.errors.join('; ')}` }, 400, cors);
        }

        await query(
          'UPDATE game_rooms SET custom_rules = $1::jsonb WHERE id = $2',
          [JSON.stringify(validation.rules), roomId],
        );
        // Rules changed under everyone's feet — re-reading the player list is
        // how clients notice, and the rules panel refetches with it.
        broadcastPlayers(roomId);
        return jsonResponse({ success: true, customRules: validation.rules }, 200, cors);
      }

      // ---- arrange the turn order by hand (host only) ------------------------
      case 'set_player_order': {
        const guard = await requireWaitingHost(roomId, userId, cors);
        if ('error' in guard) return guard.error;

        const orderedIds = body.playerIds;
        if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) {
          return jsonResponse({ error: 'playerIds must be an array of player ids' }, 400, cors);
        }

        // The list must be exactly this room's players: no partial order, no
        // duplicate, no id from another room.
        const current = await query<{ id: string }>(
          'SELECT id FROM game_players WHERE room_id = $1',
          [roomId],
        );
        const currentIds = new Set(current.map((r) => r.id));
        const givenIds = new Set<string>(orderedIds);
        const sameSet = givenIds.size === orderedIds.length
          && currentIds.size === givenIds.size
          && [...givenIds].every((id) => currentIds.has(id));
        if (!sameSet) {
          return jsonResponse(
            { error: 'playerIds must list exactly the players currently in this room' },
            400, cors,
          );
        }

        await reindexPlayers(roomId, orderedIds);
        // Arranging seats by hand is what 'manual' means — a later shuffle at
        // game start would throw the arrangement away.
        await query(
          `UPDATE game_rooms SET turn_order_mode = 'manual' WHERE id = $1`,
          [roomId],
        );
        broadcastPlayers(roomId);
        return jsonResponse({ success: true }, 200, cors);
      }

      // ---- random vs manual turn order (host only) ---------------------------
      case 'set_turn_order_mode': {
        const guard = await requireWaitingHost(roomId, userId, cors);
        if ('error' in guard) return guard.error;

        const mode = String(body.mode ?? '');
        if (!TURN_ORDER_MODES.has(mode)) {
          return jsonResponse({ error: `mode must be one of ${[...TURN_ORDER_MODES].join(', ')}` }, 400, cors);
        }

        await query('UPDATE game_rooms SET turn_order_mode = $1 WHERE id = $2', [mode, roomId]);
        broadcastPlayers(roomId);
        return jsonResponse({ success: true, turnOrderMode: mode }, 200, cors);
      }

      // ---- add a bot player (host only, waiting room) -------------------------
      case 'add_bot': {
        const difficulty = String(body.difficulty || 'medium');
        if (!BOT_DIFFICULTIES.has(difficulty)) {
          return jsonResponse({ error: 'Invalid difficulty' }, 400, cors);
        }

        const guard = await requireWaitingHost(roomId, userId, cors);
        if ('error' in guard) return guard.error;
        const room = guard.room;

        // Pick the lowest free seat.
        const seats = await query<{ player_index: number }>(
          'SELECT player_index FROM game_players WHERE room_id = $1 ORDER BY player_index',
          [roomId],
        );
        if (seats.length >= room.max_players) {
          return jsonResponse({ error: 'Room is full' }, 409, cors);
        }
        const used = new Set(seats.map((s) => s.player_index));
        let seat = 0;
        while (used.has(seat) && seat < room.max_players) seat++;
        if (seat >= room.max_players) {
          return jsonResponse({ error: 'Room is full' }, 409, cors);
        }

        const name = BOT_NAMES[seat % BOT_NAMES.length];
        // Bots have no user_id, are always ready/connected, and carry a synthetic
        // session id (the column is NOT NULL). Retry once on a seat race.
        try {
          await query(
            `INSERT INTO game_players
               (room_id, player_name, player_index, session_id, is_ready, is_connected, is_bot, bot_difficulty)
             VALUES ($1, $2, $3, $4, true, true, true, $5)`,
            [roomId, name, seat, `bot:${randomUUID()}`, difficulty],
          );
        } catch (err: any) {
          if (err?.code === '23505') {
            return jsonResponse({ error: 'Seat taken, try again' }, 409, cors);
          }
          throw err;
        }

        await resetReadyFlags(roomId);
        broadcastPlayers(roomId);
        return jsonResponse({ success: true, playerIndex: seat }, 200, cors);
      }

      // ---- remove a bot player (host only, waiting room) ----------------------
      case 'remove_bot': {
        const playerIndex = Number(body.playerIndex);
        if (!Number.isInteger(playerIndex)) {
          return jsonResponse({ error: 'playerIndex required' }, 400, cors);
        }

        const guard = await requireWaitingHost(roomId, userId, cors);
        if ('error' in guard) return guard.error;

        const target = await query<{ is_bot: boolean }>(
          'SELECT is_bot FROM game_players WHERE room_id = $1 AND player_index = $2',
          [roomId, playerIndex],
        );
        if (!target[0]) return jsonResponse({ error: 'Seat not found' }, 404, cors);
        if (!target[0].is_bot) return jsonResponse({ error: 'That seat is not a bot' }, 400, cors);

        await query(
          'DELETE FROM game_players WHERE room_id = $1 AND player_index = $2 AND is_bot = true',
          [roomId, playerIndex],
        );
        await compactSeats(roomId);
        await resetReadyFlags(roomId);
        broadcastPlayers(roomId);
        return jsonResponse({ success: true }, 200, cors);
      }

      // ---- room metadata -----------------------------------------------------
      case 'get_room': {
        if (!roomId) return jsonResponse({ error: 'roomId required' }, 400, cors);
        const { data } = await db.from('game_rooms')
          .select('id, room_code, status, max_players, custom_rules, host_user_id, turn_order_mode')
          .eq('id', roomId).single();
        if (!data) return jsonResponse({ room: null }, 200, cors);
        return jsonResponse({
          room: {
            ...data,
            // v1 blobs are translated here so no client ever sees the old shape.
            custom_rules: normalizeRules(data.custom_rules),
            turn_order_mode: data.turn_order_mode ?? 'random',
            // Host status is told to the client, never inferred from a seat.
            isHost: data.host_user_id === userId,
          },
        }, 200, cors);
      }

      case 'get_rules': {
        if (!roomId) return jsonResponse({ error: 'roomId required' }, 400, cors);
        const { data } = await db.from('game_rooms')
          .select('custom_rules').eq('id', roomId).single();
        return jsonResponse({ customRules: normalizeRules(data?.custom_rules) }, 200, cors);
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
      // myPlayerIndex is resolved server-side and returned with every list, so
      // the client re-derives its seat on each refresh instead of trusting the
      // value it cached at join. Seats move now (reorder, start-time shuffle)
      // and a stale index would make a player act as somebody else.
      case 'list_players': {
        if (!roomId) return jsonResponse({ error: 'roomId required' }, 400, cors);
        const { data } = await db.from('game_players_public')
          .select('id, player_name, player_index, cash, stocks, is_connected, is_ready, is_bot, bot_difficulty, created_at')
          .eq('room_id', roomId).order('player_index');

        const { data: me } = await db.from('game_players')
          .select('player_index').eq('room_id', roomId).eq('user_id', userId).single();

        return jsonResponse(
          { players: data ?? [], myPlayerIndex: me?.player_index ?? null },
          200, cors,
        );
      }

      // ---- secure player list (own tiles included) ---------------------------
      case 'get_players': {
        if (!roomId) return jsonResponse({ error: 'roomId required' }, 400, cors);
        const { data: publicPlayers } = await db.from('game_players_public')
          .select('id, room_id, player_name, player_index, cash, stocks, is_connected, is_ready, is_bot, bot_difficulty, created_at')
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
        return jsonResponse(
          { players, myPlayerIndex: me?.player_index ?? null },
          200, cors,
        );
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
          .select('id, room_code, status, max_players, host_user_id')
          .eq('room_code', roomCode).single();
        if (!room) return jsonResponse({ error: 'Room not found' }, 404, cors);

        const maxPlayers = room.max_players || ROOM_CAPACITY;

        // Already a player? → reconnect (allowed regardless of room status).
        // A reconnect is not a group change, so ready flags are left alone.
        const { data: existing } = await db.from('game_players')
          .select('id, player_index, player_name')
          .eq('room_id', room.id).eq('user_id', userId).single();

        if (existing) {
          await db.from('game_players')
            .update({ is_connected: true, last_seen_at: new Date().toISOString(), disconnected_at: null })
            .eq('id', existing.id);
          broadcastPlayers(room.id);
          return jsonResponse({
            success: true, roomId: room.id, playerIndex: existing.player_index,
            maxPlayers, isRejoin: room.status === 'playing',
            isHost: room.host_user_id === userId,
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
            // The group changed: everyone re-readies, so nobody is dragged into
            // a game with a player who arrived after they clicked ready.
            await resetReadyFlags(room.id);
            broadcastPlayers(room.id);
            return jsonResponse({
              success: true, roomId: room.id, playerIndex: rows[0].player_index, maxPlayers,
              isHost: room.host_user_id === userId,
            }, 200, cors);
          } catch (err: any) {
            if (err?.code === '23505') {
              // Either our user already joined in parallel, or the index raced.
              const { data: nowExisting } = await db.from('game_players')
                .select('player_index').eq('room_id', room.id).eq('user_id', userId).single();
              if (nowExisting) {
                return jsonResponse({
                  success: true, roomId: room.id, playerIndex: nowExisting.player_index, maxPlayers,
                  isHost: room.host_user_id === userId,
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

        const { data: room } = await db.from('game_rooms')
          .select('status, host_user_id').eq('id', roomId).single();

        await db.from('game_players').delete().eq('room_id', roomId).eq('user_id', userId);

        if (room?.status === 'waiting') {
          // Close the gap the departure left, or the vacated seat index would
          // have no player behind it when the game starts.
          await compactSeats(roomId);
          await resetReadyFlags(roomId);
          // A room must never be left hostless — the next-earliest human takes
          // over every host control.
          if (room.host_user_id === userId) await transferHost(roomId);
        }

        broadcastPlayers(roomId);
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
        broadcastPlayers(roomId);
        return jsonResponse({ success: true }, 200, cors);
      }

      default:
        return jsonResponse({ error: `Unknown op: ${op}` }, 400, cors);
    }
  } catch (err) {
    return serverError('rooms error', err, cors);
  }
};
