// =============================================================================
// game-action — the game engine endpoint (Node 20, Web Request/Response API)
// =============================================================================
// Ported from supabase/functions/game-action/index.ts (Deno). The game logic is
// identical; only the infrastructure boundary changed:
//   * Supabase auth getUser()  ->  jose JWT verification (verifyAuth)
//   * Supabase service client   ->  Neon-backed `db` shim (same query surface)
//   * after each mutation        ->  notifyWsServer() fans out to the Hetzner relay
// =============================================================================

import { db } from '../lib/db';
import { verifyAuth } from '../lib/auth';
import { getCorsHeaders } from '../lib/cors';
import { notifyWsServer } from '../lib/ws';
import { decideBotMove, type BotDifficulty } from '../lib/bot';
import {
  MIN_PLAYERS_TO_START,
  reindexPlayers,
  refillHand,
  getHandLimit,
  phaseAfterPlacement,
} from '../lib/players';
import { recordIfFinished, endReasonForAction } from '../lib/results';

// Pure Hotel Game rule helpers, constants, and shared types now live in
// ../lib/rules.ts so the bot (../lib/bot.ts) evaluates moves with the exact
// same logic this engine enforces.
import {
  type ChainName,
  type TileId,
  type CustomRules,
  type MergerStockDecision,
  normalizeRules,
  coerceBoardSizeCoupling,
  getTurnTimerSeconds,
  CHAINS,
  getSafeChainSize,
  getBoardDimensions,
  getEligibleChains,
  getBonusTier,
  getSellPriceFactor,
  settleSale,
  getStockPrice,
  getBonuses,
  getAdjacentTiles,
  shuffle,
  generateAllTiles,
  canDeclareGameEnd,
  endConditionReason,
  getStockholderRankings,
  calculateFinalScores,
  isTilePlayable,
  // Power cards (Epic 17). The legality helpers are the same ones the client
  // reads, so a button it offers is a move the engine accepts.
  type PowerCardId,
  type ActivePowerCard,
  type PowerCardTurnState,
  type PowerCardUseState,
  POWER_CARDS,
  EXTRA_TILES_DRAW,
  MAX_POWER_TRADES,
  canPlayPowerCard,
  canUseAnyPowerCard,
  getStockAllowance,
  isFreeStockActive,
  isMultiTileActive,
  remainingPowerTrades,
  normalizeActivePowerCard,
  normalizePowerCards,
  isPowerCardId,
  settleTrade,
  POWER_CARD_INFO,
} from '../lib/rules';

interface GameActionRequest {
  action: 'toggle_ready' | 'place_tile' | 'found_chain' | 'choose_merger_survivor' |
          'pay_merger_bonuses' | 'merger_stock_choice' | 'buy_stocks' | 'sell_stocks' | 'skip_buy' |
          'discard_tile' | 'declare_game_end' | 'new_game' | 'update_room_status' | 'auto_end_turn' |
          'play_power_card' | 'power_trade' | 'end_placements' | 'bot_tick';
  roomId: string;
  payload?: any;
}

// Fan out realtime events after a successful mutation. Over-notifying just
// triggers a client refetch, so we keep the mapping simple and safe.
// Every action already fans out game:state_updated and game:players_changed, so
// Epic 17's three new actions need no entry here — play_power_card and
// power_trade both change public state (the bank, the cards a player has left)
// and must not be silent, and the default fan-out covers exactly that.
const ROOM_STATUS_ACTIONS = new Set(['toggle_ready', 'new_game', 'update_room_status']);
async function notifyForAction(action: string, roomId: string): Promise<void> {
  const events: Promise<void>[] = [
    notifyWsServer(roomId, 'game:state_updated', { roomId }),
    notifyWsServer(roomId, 'game:players_changed', { roomId }),
  ];
  if (ROOM_STATUS_ACTIONS.has(action)) {
    events.push(notifyWsServer(roomId, 'room:status_changed', { roomId }));
  }
  await Promise.all(events);
}

export default async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let userId: string | null;
  let body: GameActionRequest;
  try {
    // Validate authorization (jose JWT instead of Supabase Auth)
    userId = await verifyAuth(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    body = await req.json() as GameActionRequest;
  } catch (error) {
    console.error('Bad request:', error);
    return new Response(JSON.stringify({ error: 'Bad request' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Run the requested action as the authenticated human player.
  const res = await handleGameAction({ corsHeaders, body, actorUserId: userId });

  // On success, play out any consecutive bot turns server-side (this also
  // covers the toggle_ready that starts the game, so a bot in seat 0 opens).
  // Detached on purpose: bots pace themselves (a few seconds per turn) and fan
  // out their own realtime events, so the human's request returns immediately
  // instead of blocking until every bot has moved. A per-room lock inside
  // driveBots prevents overlapping runs (e.g. from bot_tick nudges).
  if (res.status === 200) {
    void driveBots(body.roomId, corsHeaders).catch((error) => {
      console.error('driveBots error:', error);
    });
  }
  return res;
};

// Core action handler. Resolves the acting player either from the JWT
// (`actorUserId`, the human path) or by seat (`actAsPlayerIndex`, the bot
// path), then runs the same engine logic and returns a Response.
async function handleGameAction(opts: {
  corsHeaders: Record<string, string>;
  body: { action: string; roomId: string; payload?: any };
  actorUserId?: string;
  actAsPlayerIndex?: number;
}): Promise<Response> {
  const { corsHeaders } = opts;

  try {
    // Neon-backed service client (same query surface as the old admin client)
    const adminClient = db;

    const { action, roomId, payload } = opts.body;
    console.log('Processing action:', action, 'for room:', roomId);

    // Resolve the acting player: a bot is addressed by seat, a human by user id.
    let playerQuery = adminClient.from('game_players').select('*').eq('room_id', roomId);
    playerQuery = opts.actAsPlayerIndex != null
      ? playerQuery.eq('player_index', opts.actAsPlayerIndex)
      : playerQuery.eq('user_id', opts.actorUserId);
    const { data: playerData, error: playerError } = await playerQuery.single();

    if (playerError || !playerData) {
      console.error('Player not found:', playerError);
      return new Response(JSON.stringify({ error: 'Player not in room' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const myPlayerIndex = playerData.player_index;

    // Host privilege is the room's owner column, never seat 0 — the host can
    // sit anywhere in the turn order, and the start-time shuffle moves them.
    // Read lazily so the per-turn actions don't pay for a query they never use.
    const isCallerHost = async (): Promise<boolean> => {
      const { data: room } = await adminClient
        .from('game_rooms').select('host_user_id').eq('id', roomId).single();
      return room?.host_user_id != null && room.host_user_id === opts.actorUserId;
    };

    // Fetch game state and all players in parallel (player query already completed above)
    const [stateResult, playersResult] = await Promise.all([
      adminClient.from('game_states').select('*').eq('room_id', roomId).single(),
      adminClient.from('game_players').select('*').eq('room_id', roomId).order('player_index'),
    ]);
    const { data: gameState, error: stateError } = stateResult;
    const { data: allPlayers, error: playersError } = playersResult;

    if (playersError) {
      console.error('Players fetch error:', playersError);
      return new Response(JSON.stringify({ error: 'Failed to fetch players' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Derive rule-based values from rules snapshot
    const globalRulesSnap: CustomRules = normalizeRules(gameState?.rules_snapshot);
    const safeChainSize: number | null = getSafeChainSize(globalRulesSnap);
    const { boardRows: globalBoardRows, boardColsCount: globalBoardColsCount } = getBoardDimensions(globalRulesSnap);
    const globalEligibleChains: ChainName[] = getEligibleChains(globalRulesSnap);
    const globalBonusTier: string = getBonusTier(globalRulesSnap);
    const globalSellFactor: number = getSellPriceFactor(globalRulesSnap);

    // Power cards (Epic 17). Normalised on read rather than trusted: the column
    // is JSONB, an unmigrated row reads as undefined, and a pre-epic game has
    // NULL — all three must mean "no card active" without a special case.
    const powerCardsOn: boolean = globalRulesSnap.powerCards === 'on';
    const activePowerCard: ActivePowerCard | null =
      normalizeActivePowerCard(gameState?.active_power_card);
    const myPowerCards: PowerCardId[] = normalizePowerCards(playerData.power_cards);
    const tilesPlacedThisTurn: number = gameState?.tiles_placed_this_turn ?? 0;
    /** Shares this player may still buy — 5 under Extra Purchase, otherwise 3. */
    const stockAllowance: number = getStockAllowance(activePowerCard);
    const freeStock: boolean = isFreeStockActive(activePowerCard);

    // The two halves of the auto-end gate's power-card term, built from the row
    // exactly as the client builds them from GameState.
    // `purchased` is an explicit override rather than a read of the row: the
    // buy handler asks this question *after* settling a purchase the row does
    // not know about yet, and a stale zero there would leave extra_buy and
    // free_stock looking playable forever — a turn that never ends on its own.
    const powerTurnState = (phase: string, purchased?: number): PowerCardTurnState => ({
      enabled: powerCardsOn,
      phase,
      held: myPowerCards,
      active: activePowerCard,
      stocksPurchasedThisTurn: purchased ?? gameState?.stocks_purchased_this_turn ?? 0,
      tilesPlacedThisTurn,
      tileBagCount: gameState?.tile_bag?.length ?? 0,
    });
    const powerUseState = (opts?: {
      stocks?: Record<string, number>;
      stockBank?: Record<string, number>;
      cash?: number;
      chainsBoughtThisTurn?: string[];
    }): PowerCardUseState => ({
      chains: gameState?.chains ?? {},
      stockBank: opts?.stockBank ?? gameState?.stock_bank ?? {},
      stocks: opts?.stocks ?? playerData.stocks ?? {},
      chainsBoughtThisTurn:
        opts?.chainsBoughtThisTurn ?? ((gameState?.chains_bought_this_turn ?? []) as string[]),
      cash: opts?.cash ?? playerData.cash ?? 0,
      handSize: (playerData.tiles ?? []).length,
    });

    /** Per-turn counters cleared at every one of the three turn ends. */
    const TURN_RESET = {
      stocks_purchased_this_turn: 0,
      stocks_sold_this_turn: 0,
      chains_bought_this_turn: [] as ChainName[],
      active_power_card: null as ActivePowerCard | null,
      tiles_placed_this_turn: 0,
    };

    // Epic 18. An end condition being met unlocks a declaration; it never ends
    // anything by itself. `end_condition_round` records the round it was first
    // observed at a turn boundary — stamped once, never cleared. Only the bots'
    // "declare unconditionally after a full round" backstop reads it, and that
    // backstop is what stops a table of bots that all want to keep playing from
    // running forever.
    const stampEndConditionRound = (
      chains: Record<ChainName, any>,
      roundNumber: number,
    ): number | null =>
      gameState?.end_condition_round ??
      (canDeclareGameEnd(chains, globalBoardRows, safeChainSize) ? roundNumber : null);

    // Handle different actions
    let result: { success: boolean; error?: string; data?: any; turnEnded?: boolean } = { success: false };

    switch (action) {
      case 'toggle_ready': {
        // Toggle this player's ready state
        const newReadyState = !playerData.is_ready;

        await adminClient
          .from('game_players')
          .update({ is_ready: newReadyState })
          .eq('id', playerData.id);

        // If toggling to not-ready, just return
        if (!newReadyState) {
          result = { success: true, data: { gameStarted: false, isReady: false } };
          break;
        }

        // Check whether the room can start
        const { data: room } = await adminClient
          .from('game_rooms')
          .select('max_players, custom_rules, turn_order_mode')
          .eq('id', roomId)
          .single();

        // Re-fetch all players to get fresh ready states
        const { data: freshPlayers } = await adminClient
          .from('game_players')
          .select('*')
          .eq('room_id', roomId)
          .order('player_index');

        if (!room || !freshPlayers) {
          result = { success: true, data: { gameStarted: false, isReady: true } };
          break;
        }

        // Epic 15: rooms no longer have a fixed player count, so the start
        // condition is "at least two players and every human ready". Bots are
        // always ready. Any join or leave clears every ready flag (see
        // rooms.ts), which is what makes readying up mean "ready to play with
        // exactly this group" and removes the last-second-joiner race.
        const allReady = freshPlayers.length >= MIN_PLAYERS_TO_START &&
          freshPlayers.every(p => p.is_bot || p.is_ready);

        if (!allReady) {
          result = { success: true, data: { gameStarted: false, isReady: true } };
          break;
        }

        // All players ready — start the game!
        console.log('All players ready, starting game for room:', roomId);

        // v1 blobs are translated on read; the small board drops Max Chains
        // from the default 7 to 5 here as well as in the rules form.
        const rules: CustomRules = coerceBoardSizeCoupling(normalizeRules(room.custom_rules));

        // Turn order. In 'random' mode (the default) the seats are shuffled
        // now, host included — this MUST happen before the dealing loop below,
        // which walks players in seat order. In 'manual' mode the host already
        // arranged the seats and we deal in the order they set.
        let seatedPlayers = freshPlayers;
        if ((room.turn_order_mode ?? 'random') === 'random' && freshPlayers.length > 1) {
          const shuffledIds: string[] = shuffle((freshPlayers as any[]).map((p) => String(p.id)));
          await reindexPlayers(roomId, shuffledIds);
          seatedPlayers = shuffledIds.map((id, index) => ({
            ...freshPlayers.find((p: any) => p.id === id),
            player_index: index,
          }));
        }

        // Derive starting parameters from rules
        const startingCash = parseInt(rules.startingCash);
        const startingTiles = parseInt(rules.startingTiles);
        const { boardRows: initBoardRows, boardColsCount: initBoardColsCount } = getBoardDimensions(rules);
        const initEligibleChains = getEligibleChains(rules);

        // Initialize tile bag
        const tileBag = shuffle(generateAllTiles(initBoardRows, initBoardColsCount));

        // Initialize board
        const board: Record<string, any> = {};
        for (const tileId of generateAllTiles(initBoardRows, initBoardColsCount)) {
          board[tileId] = { id: tileId, placed: false, chain: null };
        }

        // Conditionally place starting tile
        let startingTile: string | null = null;
        if (rules.startWithTileOnBoard) {
          startingTile = tileBag.pop()!;
          board[startingTile] = { id: startingTile, placed: true, chain: null };
        }

        // Initialize chains
        const chains: Record<ChainName, any> = {
          sackson: { name: 'sackson', tiles: [], isActive: false, isSafe: false },
          tower: { name: 'tower', tiles: [], isActive: false, isSafe: false },
          worldwide: { name: 'worldwide', tiles: [], isActive: false, isSafe: false },
          american: { name: 'american', tiles: [], isActive: false, isSafe: false },
          festival: { name: 'festival', tiles: [], isActive: false, isSafe: false },
          continental: { name: 'continental', tiles: [], isActive: false, isSafe: false },
          imperial: { name: 'imperial', tiles: [], isActive: false, isSafe: false },
        };

        // Initialize stock bank
        const stockBank: Record<ChainName, number> = {
          sackson: 25, tower: 25, worldwide: 25, american: 25,
          festival: 25, continental: 25, imperial: 25,
        };

        // Epic 17: every seat is dealt the same five cards, bots included, or
        // none at all when the rule is off. Nothing about the deal is random —
        // the cards add timing decisions, not luck.
        const dealtPowerCards: PowerCardId[] = rules.powerCards === 'on' ? [...POWER_CARDS] : [];

        // Deal tiles to players and reset ready state. seatedPlayers is in
        // final seat order, so hand N goes to seat N.
        for (const player of seatedPlayers) {
          const playerTiles = tileBag.splice(0, startingTiles);
          await adminClient
            .from('game_players')
            .update({
              tiles: playerTiles,
              cash: startingCash,
              stocks: { sackson: 0, tower: 0, worldwide: 0, american: 0, festival: 0, continental: 0, imperial: 0 },
              power_cards: dealtPowerCards,
              // Bots stay ready so a re-created room (new_game) never gets stuck;
              // only real players are reset and must ready up again.
              is_ready: player.is_bot === true,
            })
            .eq('id', player.id);
        }

        // Build game log entry
        const gameLogEntry = {
          timestamp: Date.now(),
          playerId: 'system',
          playerName: 'System',
          action: 'Game started',
          details: startingTile ? `Starting tile ${startingTile} placed on board` : 'Board starts empty',
        };

        // Compute turn deadline for the first turn
        const firstTurnSeconds = getTurnTimerSeconds(rules);
        const firstTurnDeadline: number | null =
          firstTurnSeconds !== null && !rules.disableTimerFirstRounds
            ? Math.floor(Date.now() / 1000) + firstTurnSeconds
            : null;

        // Create game state with rules_snapshot
        const { error: insertError } = await adminClient
          .from('game_states')
          .insert({
            room_id: roomId,
            current_player_index: 0,
            phase: 'place_tile',
            board,
            chains,
            stock_bank: stockBank,
            tile_bag: tileBag,
            last_placed_tile: startingTile,
            rules_snapshot: rules as unknown as any,
            game_log: [gameLogEntry],
            round_number: 0,
            turn_deadline_epoch: firstTurnDeadline,
          });

        if (insertError) {
          console.error('Insert error:', insertError);
          return new Response(JSON.stringify({ error: 'Failed to create game state' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Update room status
        await adminClient
          .from('game_rooms')
          .update({ status: 'playing' })
          .eq('id', roomId);

        result = { success: true, data: { gameStarted: true, isReady: true } };
        break;
      }

      // The legacy `start_game` handler was deleted with Epic 17. It predated
      // custom rules — hardcoded 9x12, $6000 and 6 tiles — was unreferenced by
      // the client, and would have created a rule-on game whose players held no
      // power cards. `toggle_ready` is and was the only way a game starts.

      case 'place_tile': {
        if (!gameState) {
          return new Response(JSON.stringify({ error: 'Game not started' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Validate game phase
        if (gameState.phase !== 'place_tile') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Check if it's this player's turn
        if (gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const tileId = payload?.tileId;
        if (!tileId) {
          return new Response(JSON.stringify({ error: 'Tile ID required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Verify player has this tile
        if (!playerData.tiles?.includes(tileId)) {
          return new Response(JSON.stringify({ error: 'You do not have this tile' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Analyze placement
        const board = gameState.board;
        const chains = gameState.chains;
        const adjacent = getAdjacentTiles(tileId, globalBoardRows, globalBoardColsCount);
        const adjacentChains = new Set<ChainName>();
        const adjacentUnincorporated: TileId[] = [];

        for (const adjTile of adjacent) {
          const tile = board[adjTile];
          if (tile?.placed) {
            if (tile.chain) {
              adjacentChains.add(tile.chain as ChainName);
            } else {
              adjacentUnincorporated.push(adjTile);
            }
          }
        }

        const chainArray = Array.from(adjacentChains);

        // Check for invalid placement (safe chain merger)
        if (chainArray.length >= 2) {
          const safeChains = chainArray.filter(c => chains[c].isSafe);
          if (safeChains.length >= 2) {
            return new Response(JSON.stringify({ error: 'Cannot merge two or more safe chains' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        }

        // Check if tile would found a chain when no eligible chains are available
        if (chainArray.length === 0 && adjacentUnincorporated.length > 0) {
          const availableEligible = globalEligibleChains.filter(c => !chains[c].isActive);
          if (availableEligible.length === 0) {
            return new Response(JSON.stringify({ error: 'Cannot create a new hotel chain — all eligible chains are already active' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        }

        // Update board
        const newBoard = { ...board };
        newBoard[tileId] = { id: tileId, placed: true, chain: null };

        // Remove tile from player's hand
        const newPlayerTiles = playerData.tiles.filter((t: string) => t !== tileId);

        // Determine action and new phase
        let newPhase = gameState.phase;
        const newChains = { ...chains };
        let pendingChainFoundation = null;
        let mergerAdjacentChains = null;
        let merger = null;

        const gameLog = [...gameState.game_log, {
          timestamp: Date.now(),
          playerId: `player-${myPlayerIndex}`,
          playerName: playerData.player_name,
          action: 'Placed tile',
          details: tileId,
        }];

        // Epic 17. Maintained on every placement, card or no card — it is what
        // "only before you have placed this turn" reads, and what bounds a spree.
        const placedThisTurn = tilesPlacedThisTurn + 1;

        // Both non-merger, non-founding exits ask the same question, and so do
        // found_chain and completeMergerInDb: is this turn still placing? One
        // shared helper, because a missed exit strands a spree in place_tile.
        const nextPhaseAfterThisPlacement = (chainsNow: Record<ChainName, any>) =>
          phaseAfterPlacement({
            activePowerCard,
            tilesPlacedThisTurn: placedThisTurn,
            playerTiles: newPlayerTiles,
            board: newBoard,
            chains: chainsNow,
            rules: globalRulesSnap,
          });

        if (chainArray.length >= 2) {
          // Merger
          mergerAdjacentChains = chainArray;

          // Sort chains by size
          const sortedChains = chainArray
            .map(chain => ({ chain, size: chains[chain].tiles.length }))
            .sort((a, b) => b.size - a.size);

          const largestSize = sortedChains[0].size;
          const tiedForLargest = sortedChains.filter(c => c.size === largestSize);

          if (tiedForLargest.length > 1) {
            newPhase = 'merger_choose_survivor';
          } else {
            const survivingChain = sortedChains[0].chain;
            const defunctChains = sortedChains.slice(1).map(c => c.chain);
            merger = {
              survivingChain,
              defunctChains,
              currentDefunctChain: defunctChains[0],
              currentPlayerIndex: myPlayerIndex,
              bonusesPaid: false,
            };
            newPhase = 'merger_pay_bonuses';
          }
        } else if (chainArray.length === 1) {
          // Grow chain
          const chainToGrow = chainArray[0];
          const tilesToAdd = [tileId, ...adjacentUnincorporated];

          for (const tid of tilesToAdd) {
            newBoard[tid] = { ...newBoard[tid], chain: chainToGrow };
          }

          const existingTiles = chains[chainToGrow].tiles;
          const allTiles = [...existingTiles, ...tilesToAdd];
          newChains[chainToGrow] = {
            ...newChains[chainToGrow],
            tiles: allTiles,
            isSafe: safeChainSize !== null && allTiles.length >= safeChainSize,
          };

          gameLog.push({
            timestamp: Date.now(),
            playerId: `player-${myPlayerIndex}`,
            playerName: playerData.player_name,
            action: `Extended ${chainToGrow}`,
            details: `Chain now has ${allTiles.length} tiles`,
          });

          newPhase = nextPhaseAfterThisPlacement(newChains);
        } else if (adjacentUnincorporated.length > 0) {
          // Form new chain
          newPhase = 'found_chain';
          pendingChainFoundation = [tileId, ...adjacentUnincorporated];
        } else {
          // Place only
          newPhase = nextPhaseAfterThisPlacement(newChains);
        }

        // Epic 18: placing the 41st tile no longer ends the game here. Meeting
        // an end condition only unlocks a declaration; the placement proceeds
        // to buy_stock so the declaring player still finishes their turn — and
        // under Epic 17's Building Spree it may proceed to another placement
        // instead, with the condition still merely declarable either way.
        {
          const { error: updateError } = await adminClient
            .from('game_states')
            .update({
              board: newBoard,
              chains: newChains,
              phase: newPhase,
              last_placed_tile: tileId,
              tiles_placed_this_turn: placedThisTurn,
              pending_chain_foundation: pendingChainFoundation,
              merger,
              game_log: gameLog,
            })
            .eq('room_id', roomId);

          if (updateError) {
            return new Response(JSON.stringify({ error: 'Failed to update game state', detail: updateError.message }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        }

        // Update player tiles
        await adminClient
          .from('game_players')
          .update({ tiles: newPlayerTiles })
          .eq('id', playerData.id);

        result = { success: true, data: { phase: newPhase, mergerAdjacentChains } };
        break;
      }

      case 'found_chain': {
        if (!gameState) {
          return new Response(JSON.stringify({ error: 'Game not started' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'found_chain') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const chainName = payload?.chainName as ChainName;
        if (!chainName || !CHAINS[chainName]) {
          return new Response(JSON.stringify({ error: 'Invalid chain name' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const chains = gameState.chains;
        if (chains[chainName].isActive) {
          return new Response(JSON.stringify({ error: 'Chain already active' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (!globalEligibleChains.includes(chainName)) {
          return new Response(JSON.stringify({ error: 'Chain is not eligible for this game' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const tilesToAdd = gameState.pending_chain_foundation || [];

        // Update board
        const newBoard = { ...gameState.board };
        for (const tid of tilesToAdd) {
          newBoard[tid] = { ...newBoard[tid], chain: chainName };
        }

        // Update chain
        const newChains = { ...chains };
        newChains[chainName] = {
          ...newChains[chainName],
          tiles: tilesToAdd,
          isActive: true,
          isSafe: safeChainSize !== null && tilesToAdd.length >= safeChainSize,
        };

        // Give founding bonus
        const newStockBank = { ...gameState.stock_bank };
        const playerStocks = { ...playerData.stocks };

        if (newStockBank[chainName] > 0) {
          playerStocks[chainName] = (playerStocks[chainName] || 0) + 1;
          newStockBank[chainName]--;
        }

        const gameLog = [...gameState.game_log, {
          timestamp: Date.now(),
          playerId: `player-${myPlayerIndex}`,
          playerName: playerData.player_name,
          action: `Founded ${CHAINS[chainName].displayName}`,
          details: 'Received 1 bonus share',
        }];

        // Epic 18: founding a chain never ends the game, however large the
        // cluster. Epic 17: the turn continues into the buy phase as it
        // otherwise would — unless a Building Spree still has tiles to place,
        // which is the third of the four placement exits.
        const foundNextPhase = phaseAfterPlacement({
          activePowerCard,
          tilesPlacedThisTurn,
          playerTiles: playerData.tiles ?? [],
          board: newBoard,
          chains: newChains,
          rules: globalRulesSnap,
        });

        await adminClient
          .from('game_states')
          .update({
            board: newBoard,
            chains: newChains,
            stock_bank: newStockBank,
            phase: foundNextPhase,
            pending_chain_foundation: null,
            game_log: gameLog,
          })
          .eq('room_id', roomId);

        await adminClient
          .from('game_players')
          .update({ stocks: playerStocks })
          .eq('id', playerData.id);

        result = { success: true, data: { phase: foundNextPhase } };
        break;
      }

      case 'choose_merger_survivor': {
        if (!gameState) {
          return new Response(JSON.stringify({ error: 'Game not started' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'merger_choose_survivor') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const survivingChain = payload?.survivingChain as ChainName;
        if (!survivingChain || !CHAINS[survivingChain]) {
          return new Response(JSON.stringify({ error: 'Surviving chain required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Recompute adjacent chains server-side from the last placed tile (do not trust client payload)
        const lastTileForMerger = gameState.last_placed_tile;
        if (!lastTileForMerger) {
          return new Response(JSON.stringify({ error: 'No last placed tile found' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const adjTilesForMerger = getAdjacentTiles(lastTileForMerger, globalBoardRows, globalBoardColsCount);
        const serverAdjacentChains = [...new Set(
          adjTilesForMerger
            .filter(tid => gameState.board[tid]?.placed && gameState.board[tid]?.chain)
            .map(tid => gameState.board[tid].chain as ChainName)
        )];

        if (!serverAdjacentChains.includes(survivingChain)) {
          return new Response(JSON.stringify({ error: 'Invalid surviving chain selection' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const defunctChains = serverAdjacentChains.filter(c => c !== survivingChain)
          .sort((a, b) => gameState.chains[b].tiles.length - gameState.chains[a].tiles.length);

        const merger = {
          survivingChain,
          defunctChains,
          currentDefunctChain: defunctChains[0],
          currentPlayerIndex: myPlayerIndex,
          bonusesPaid: false,
        };

        await adminClient
          .from('game_states')
          .update({
            merger,
            phase: 'merger_pay_bonuses',
          })
          .eq('room_id', roomId);

        result = { success: true };
        break;
      }

      case 'pay_merger_bonuses': {
        if (!gameState || !gameState.merger) {
          return new Response(JSON.stringify({ error: 'No merger in progress' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'merger_pay_bonuses') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Only current player can trigger bonus payment
        if (gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const merger = gameState.merger;
        const defunctChain = merger.currentDefunctChain as ChainName;
        const chains = gameState.chains;
        const chainSize = chains[defunctChain].tiles.length;
        const bonuses = getBonuses(defunctChain, chainSize, globalBonusTier);

        // Get stockholder rankings
        const playerStates = allPlayers.map(p => ({
          id: `player-${p.player_index}`,
          name: p.player_name,
          cash: p.cash,
          stocks: p.stocks,
        }));

        const gameLog = [...gameState.game_log];

        // Pay bonuses (flat tier splits pool equally among all stockholders)
        if (globalBonusTier === 'flat') {
          const allHolders = playerStates.filter(p => p.stocks[defunctChain] > 0);
          if (allHolders.length > 0) {
            const flatPool = bonuses.majority + bonuses.minority;
            const perPlayer = Math.floor(flatPool / allHolders.length);
            for (const holder of allHolders) {
              const playerIndex = parseInt(holder.id.split('-')[1]);
              const dbPlayer = allPlayers.find(p => p.player_index === playerIndex);
              if (dbPlayer) {
                await adminClient
                  .from('game_players')
                  .update({ cash: dbPlayer.cash + perPlayer })
                  .eq('id', dbPlayer.id);
              }
            }
            gameLog.push({
              timestamp: Date.now(),
              playerId: 'system',
              playerName: 'System',
              action: `${CHAINS[defunctChain].displayName} bonuses paid (flat)`,
              details: `${allHolders.map(p => p.name).join(', ')} each receive $${perPlayer}`,
            });
          }
        } else {
          const { majority, minority } = getStockholderRankings(playerStates, defunctChain);

          if (majority.length > 0) {
            if (minority.length === 0) {
              const totalBonus = bonuses.majority + bonuses.minority;
              const perPlayer = Math.floor(totalBonus / majority.length);

              for (const player of majority) {
                const playerIndex = parseInt(player.id.split('-')[1]);
                const dbPlayer = allPlayers.find(p => p.player_index === playerIndex);
                if (dbPlayer) {
                  await adminClient
                    .from('game_players')
                    .update({ cash: dbPlayer.cash + perPlayer })
                    .eq('id', dbPlayer.id);
                }
              }

              gameLog.push({
                timestamp: Date.now(),
                playerId: 'system',
                playerName: 'System',
                action: `${CHAINS[defunctChain].displayName} bonuses paid`,
                details: majority.length > 1
                  ? `${majority.map(p => p.name).join(', ')} split $${totalBonus}`
                  : `${majority[0].name} receives $${totalBonus}`,
              });
            } else {
              const majorityBonus = Math.floor(bonuses.majority / majority.length);
              const minorityBonus = Math.floor(bonuses.minority / minority.length);

              for (const player of majority) {
                const playerIndex = parseInt(player.id.split('-')[1]);
                const dbPlayer = allPlayers.find(p => p.player_index === playerIndex);
                if (dbPlayer) {
                  await adminClient
                    .from('game_players')
                    .update({ cash: dbPlayer.cash + majorityBonus })
                    .eq('id', dbPlayer.id);
                }
              }

              for (const player of minority) {
                const playerIndex = parseInt(player.id.split('-')[1]);
                const dbPlayer = allPlayers.find(p => p.player_index === playerIndex);
                if (dbPlayer) {
                  await adminClient
                    .from('game_players')
                    .update({ cash: dbPlayer.cash + minorityBonus })
                    .eq('id', dbPlayer.id);
                }
              }

              gameLog.push({
                timestamp: Date.now(),
                playerId: 'system',
                playerName: 'System',
                action: `${CHAINS[defunctChain].displayName} bonuses paid`,
                details: `Majority: ${majority.map(p => p.name).join(', ')} ($${majorityBonus} each), Minority: ${minority.map(p => p.name).join(', ')} ($${minorityBonus} each)`,
              });
            }
          }
        }

        // Check if any players have stock in defunct chain
        const playersWithShares = allPlayers.filter(p => p.stocks[defunctChain] > 0);

        let newPhase = 'merger_handle_stock';
        const newMerger = { ...merger, bonusesPaid: true };

        if (playersWithShares.length === 0) {
          // No one has shares, move to next defunct chain or complete
          const currentDefunctIndex = merger.defunctChains.indexOf(defunctChain);
          if (currentDefunctIndex < merger.defunctChains.length - 1) {
            newMerger.currentDefunctChain = merger.defunctChains[currentDefunctIndex + 1];
            newMerger.bonusesPaid = false;
            newPhase = 'merger_pay_bonuses';
          } else {
            // Complete merger
            newPhase = await completeMergerInDb(adminClient, roomId, gameState, allPlayers, gameLog);
            await adminClient
              .from('game_states')
              .update({ phase: newPhase, merger: null, game_log: gameLog })
              .eq('room_id', roomId);
            result = { success: true };
            break;
          }
        } else {
          // Find first player with shares starting from current player
          const startIdx = myPlayerIndex;
          for (let i = 0; i < allPlayers.length; i++) {
            const idx = (startIdx + i) % allPlayers.length;
            if (allPlayers[idx].stocks[defunctChain] > 0) {
              newMerger.currentPlayerIndex = idx;
              break;
            }
          }
        }

        await adminClient
          .from('game_states')
          .update({
            merger: newMerger,
            phase: newPhase,
            game_log: gameLog,
          })
          .eq('room_id', roomId);

        result = { success: true };
        break;
      }

      case 'merger_stock_choice': {
        if (!gameState || !gameState.merger) {
          return new Response(JSON.stringify({ error: 'No merger in progress' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'merger_handle_stock') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const merger = gameState.merger;
        if (merger.currentPlayerIndex !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn in merger' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const decision = payload?.decision as MergerStockDecision;
        if (!decision) {
          return new Response(JSON.stringify({ error: 'Decision required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const defunctChain = merger.currentDefunctChain as ChainName;
        const survivingChain = merger.survivingChain as ChainName;
        const currentShares = playerData.stocks[defunctChain];

        // Validate decision
        if (decision.sell + decision.trade + decision.keep !== currentShares) {
          return new Response(JSON.stringify({ error: 'Shares do not add up' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (decision.trade % 2 !== 0) {
          return new Response(JSON.stringify({ error: 'Trade must be even (2:1 ratio)' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Process decision
        const salePrice = getStockPrice(defunctChain, gameState.chains[defunctChain].tiles.length);
        const newCash = playerData.cash + (decision.sell * salePrice);

        const sharesToReceive = decision.trade / 2;
        const availableShares = Math.min(sharesToReceive, gameState.stock_bank[survivingChain]);

        const newPlayerStocks = { ...playerData.stocks };
        newPlayerStocks[defunctChain] -= (decision.sell + decision.trade);
        newPlayerStocks[survivingChain] = (newPlayerStocks[survivingChain] || 0) + availableShares;

        const newStockBank = { ...gameState.stock_bank };
        newStockBank[defunctChain] += decision.sell + decision.trade;
        newStockBank[survivingChain] -= availableShares;

        await adminClient
          .from('game_players')
          .update({ cash: newCash, stocks: newPlayerStocks })
          .eq('id', playerData.id);

        const gameLog = [...gameState.game_log];
        const actions = [];
        if (decision.sell > 0) actions.push(`sold ${decision.sell} for $${decision.sell * salePrice}`);
        if (decision.trade > 0) actions.push(`traded ${decision.trade} for ${availableShares} ${CHAINS[survivingChain].displayName}`);
        if (decision.keep > 0) actions.push(`kept ${decision.keep}`);

        gameLog.push({
          timestamp: Date.now(),
          playerId: `player-${myPlayerIndex}`,
          playerName: playerData.player_name,
          action: `${CHAINS[defunctChain].displayName} stock decision`,
          details: actions.join(', '),
        });

        // Refetch players to get updated stock counts
        const { data: updatedPlayers } = await adminClient
          .from('game_players')
          .select('*')
          .eq('room_id', roomId)
          .order('player_index');

        // Find next player with shares
        const startPlayerIndex = gameState.current_player_index;
        let nextIndex = (myPlayerIndex + 1) % allPlayers.length;
        let foundNext = false;

        while (nextIndex !== startPlayerIndex) {
          const player = updatedPlayers?.find(p => p.player_index === nextIndex);
          if (player && player.stocks[defunctChain] > 0) {
            foundNext = true;
            break;
          }
          nextIndex = (nextIndex + 1) % allPlayers.length;
        }

        // Check if start player still has shares
        if (!foundNext) {
          const startPlayer = updatedPlayers?.find(p => p.player_index === startPlayerIndex);
          if (startPlayer && startPlayer.stocks[defunctChain] > 0 && startPlayerIndex !== myPlayerIndex) {
            foundNext = true;
            nextIndex = startPlayerIndex;
          }
        }

        let newPhase = 'merger_handle_stock';
        const newMerger = { ...merger };

        if (!foundNext) {
          // Move to next defunct chain or complete merger
          const currentDefunctIndex = merger.defunctChains.indexOf(defunctChain);
          if (currentDefunctIndex < merger.defunctChains.length - 1) {
            newMerger.currentDefunctChain = merger.defunctChains[currentDefunctIndex + 1];
            newMerger.currentPlayerIndex = startPlayerIndex;
            newMerger.bonusesPaid = false;
            newPhase = 'merger_pay_bonuses';
          } else {
            // Complete merger
            newPhase = await completeMergerInDb(adminClient, roomId, gameState, allPlayers, gameLog);
            await adminClient
              .from('game_states')
              .update({
                phase: newPhase,
                merger: null,
                stock_bank: newStockBank,
                game_log: gameLog
              })
              .eq('room_id', roomId);
            result = { success: true };
            break;
          }
        } else {
          newMerger.currentPlayerIndex = nextIndex;
        }

        await adminClient
          .from('game_states')
          .update({
            merger: newMerger,
            phase: newPhase,
            stock_bank: newStockBank,
            game_log: gameLog,
          })
          .eq('room_id', roomId);

        result = { success: true };
        break;
      }

      case 'buy_stocks': {
        if (!gameState || gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'buy_stock') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const purchases = payload?.purchases as { chain: ChainName; quantity: number }[];

        // Validate total quantity against the per-turn allowance. Buying is
        // incremental, so this counts what the player already bought this turn.
        // The allowance stopped being a constant with Epic 17: Extra Purchase
        // raises it to 5 for this turn only.
        const totalQuantity = (purchases || []).reduce((sum, p) => sum + p.quantity, 0);
        const alreadyPurchased = gameState.stocks_purchased_this_turn ?? 0;
        if (alreadyPurchased + totalQuantity > stockAllowance) {
          return new Response(JSON.stringify({ error: `Cannot buy more than ${stockAllowance} stocks per turn` }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        let totalCost = 0;
        const newPlayerStocks = { ...playerData.stocks };
        const newStockBank = { ...gameState.stock_bank };

        for (const purchase of (purchases || [])) {
          // Validate chain is active
          if (!gameState.chains[purchase.chain]?.isActive) {
            return new Response(JSON.stringify({ error: `Cannot buy stock in inactive chain: ${purchase.chain}` }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Validate stock bank has sufficient shares
          if (gameState.stock_bank[purchase.chain] < purchase.quantity) {
            return new Response(JSON.stringify({ error: `Insufficient ${purchase.chain} shares in bank (available: ${gameState.stock_bank[purchase.chain]})` }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Free Shares zeroes the price and nothing else: the bank must still
          // hold the shares and the chain must still be active, both checked
          // above. Only what the player pays changes.
          const price = freeStock
            ? 0
            : getStockPrice(purchase.chain, gameState.chains[purchase.chain].tiles.length);
          totalCost += price * purchase.quantity;
          newPlayerStocks[purchase.chain] = (newPlayerStocks[purchase.chain] || 0) + purchase.quantity;
          newStockBank[purchase.chain] -= purchase.quantity;
        }

        if (totalCost > playerData.cash) {
          return new Response(JSON.stringify({ error: 'Insufficient funds' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const newCash = playerData.cash - totalCost;

        await adminClient
          .from('game_players')
          .update({ cash: newCash, stocks: newPlayerStocks })
          .eq('id', playerData.id);

        const gameLog = [...gameState.game_log];
        if (purchases && purchases.length > 0) {
          const bought = purchases.map(p => `${p.quantity} ${CHAINS[p.chain].displayName}`).join(', ');
          gameLog.push({
            timestamp: Date.now(),
            playerId: `player-${myPlayerIndex}`,
            playerName: playerData.player_name,
            // The log names the price, so a free purchase never looks like a
            // bookkeeping error to the players watching it happen.
            action: freeStock ? 'Took stocks' : 'Bought stocks',
            details: freeStock ? `${bought} (free — Free Shares)` : bought,
          });
        }

        // A purchase no longer ends the turn: the player keeps buying until the
        // per-turn cap is spent or nothing left in the bank is affordable.
        const purchasedThisTurn = alreadyPurchased + totalQuantity;
        // Chains touched this turn can't be sold back this turn (Epic 14.3).
        const chainsBoughtThisTurn = [...new Set<ChainName>([
          ...((gameState.chains_bought_this_turn ?? []) as ChainName[]),
          ...(purchases || []).filter(p => p.quantity > 0).map(p => p.chain),
        ])];
        // Affordability is skipped entirely while Free Shares is active — a
        // broke player would otherwise have their free-share turn auto-ended
        // before they could take anything.
        const canBuyMore = purchasedThisTurn < stockAllowance &&
          (Object.keys(CHAINS) as ChainName[]).some(c =>
            gameState.chains[c]?.isActive &&
            newStockBank[c] > 0 &&
            (freeStock || getStockPrice(c, gameState.chains[c].tiles.length) <= newCash)
          );

        // Epic 18: once the game *can* be ended, the turn stops ending itself.
        // A declaration is worthless if the player is swept past the decision
        // by buying their last affordable share, so the turn stays open and the
        // player leaves it deliberately through skip_buy. Mirrored client-side
        // in GameContainer's auto-end effect.
        const endDeclarable = canDeclareGameEnd(gameState.chains, globalBoardRows, safeChainSize);

        // Epic 17 adds the third term for exactly the same reason. The per-card
        // "is there actually a use" half matters as much as the first: without
        // it, a player holding only Stock Trade and nothing tradeable would have
        // every turn hang waiting for a manual End Turn.
        const cardStillPlayable = canUseAnyPowerCard(
          powerTurnState('buy_stock', purchasedThisTurn),
          powerUseState({
            stocks: newPlayerStocks,
            stockBank: newStockBank,
            cash: newCash,
            chainsBoughtThisTurn,
          }),
          getStockPrice,
        );

        if (canBuyMore || endDeclarable || cardStillPlayable) {
          // Same player, same turn deadline — only the bank and counter move.
          await adminClient
            .from('game_states')
            .update({
              stock_bank: newStockBank,
              stocks_purchased_this_turn: purchasedThisTurn,
              chains_bought_this_turn: chainsBoughtThisTurn,
              game_log: gameLog,
            })
            .eq('room_id', roomId);

          result = { success: true, turnEnded: false };
          break;
        }

        // End turn: top the hand back up to the room's limit, advance player.
        // "Refill to the limit" rather than "draw one": with Building Spree the
        // hand can be four tiles short, and after Extra Tiles it is above the
        // limit and correctly draws nothing (Epic 17.1).
        const refilled = refillHand(
          playerData.tiles ?? [],
          gameState.tile_bag ?? [],
          getHandLimit(globalRulesSnap),
        );
        const tileBag = refilled.bag;

        if (refilled.tiles.length !== (playerData.tiles ?? []).length) {
          await adminClient
            .from('game_players')
            .update({ tiles: refilled.tiles })
            .eq('id', playerData.id);
        }

        const nextPlayerIndex = (myPlayerIndex + 1) % allPlayers.length;
        const currentRoundNumber = gameState.round_number ?? 0;
        const newRoundNumber = currentRoundNumber + (nextPlayerIndex === 0 ? 1 : 0);
        const rulesSnap: CustomRules = normalizeRules(gameState.rules_snapshot);
        const turnSeconds = getTurnTimerSeconds(rulesSnap);
        const newDeadline: number | null =
          turnSeconds !== null && !(rulesSnap.disableTimerFirstRounds && newRoundNumber < 2)
            ? Math.floor(Date.now() / 1000) + turnSeconds
            : null;

        let newPhase = 'place_tile';
        let winner = null;

        // Epic 18: the game ends here only because this player announced it —
        // and only for the seat that announced it, so a declaration can never
        // leak into someone else's turn. The purchases just made are in the
        // final score, which is the whole point of finishing the turn.
        if (gameState.end_declared_by === myPlayerIndex) {
          newPhase = 'game_over';
          const scoredPlayers = allPlayers.map(p => ({
            id: `player-${p.player_index}`,
            name: p.player_name,
            cash: p.player_index === myPlayerIndex ? newCash : p.cash,
            stocks: p.player_index === myPlayerIndex ? newPlayerStocks : p.stocks,
          }));
          winner = calculateFinalScores(scoredPlayers, gameState.chains, globalBonusTier)[0].name;
        }

        await adminClient
          .from('game_states')
          .update({
            current_player_index: nextPlayerIndex,
            phase: newPhase,
            stock_bank: newStockBank,
            tile_bag: tileBag,
            ...TURN_RESET,
            last_placed_tile: null,
            game_log: gameLog,
            winner,
            round_number: newRoundNumber,
            end_condition_round: stampEndConditionRound(gameState.chains, currentRoundNumber),
            turn_deadline_epoch: newPhase === 'game_over' ? null : newDeadline,
          })
          .eq('room_id', roomId);

        result = { success: true, turnEnded: true };
        break;
      }

      // Stock Selling (Epic 14, Mode B "Broker's Cut"). Lives inside the
      // buy_stock phase with its own per-turn allowance: selling never ends the
      // turn and never changes the phase. All validation and arithmetic happens
      // in settleSale (server/lib/rules.ts) so it stays unit-testable.
      case 'sell_stocks': {
        if (!gameState || gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'buy_stock') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (globalSellFactor <= 0) {
          return new Response(JSON.stringify({ error: 'Stock selling is not enabled in this room' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const sales = payload?.sales as { chain: ChainName; quantity: number }[];
        const soldThisTurn = gameState.stocks_sold_this_turn ?? 0;

        const outcome = settleSale({
          sales,
          chains: gameState.chains,
          stocks: playerData.stocks,
          stockBank: gameState.stock_bank,
          soldThisTurn,
          chainsBoughtThisTurn: (gameState.chains_bought_this_turn ?? []) as ChainName[],
          factor: globalSellFactor,
        });

        if (!outcome.ok) {
          return new Response(JSON.stringify({ error: outcome.error }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const { proceeds, totalQuantity: soldQuantity, newStocks, newStockBank: bankAfterSale, lines } =
          outcome.settlement;

        // Write ordering matters — there are no transactions here. Cash and
        // stocks move together in one player row update; the bank follows. A
        // failure between the two can only under-return shares to the bank, it
        // can never duplicate cash or shares.
        await adminClient
          .from('game_players')
          .update({ cash: playerData.cash + proceeds, stocks: newStocks })
          .eq('id', playerData.id);

        const sellLog = [...gameState.game_log];
        for (const line of lines) {
          sellLog.push({
            timestamp: Date.now(),
            playerId: `player-${myPlayerIndex}`,
            playerName: playerData.player_name,
            action: 'Sold stocks',
            details: `${line.quantity} ${CHAINS[line.chain].displayName} for $${line.amount.toLocaleString()}`,
          });
        }

        try {
          await adminClient
            .from('game_states')
            .update({
              stock_bank: bankAfterSale,
              stocks_sold_this_turn: soldThisTurn + soldQuantity,
              game_log: sellLog,
            })
            .eq('room_id', roomId);
        } catch (bankError) {
          console.warn('sell_stocks: bank/counter write failed after player was paid:', bankError);
          throw bankError;
        }

        result = { success: true, turnEnded: false, data: { proceeds } };
        break;
      }

      case 'skip_buy': {
        if (!gameState || gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'buy_stock') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Refill the hand to the room's limit (Epic 17.1) — one tile in ordinary
        // play, up to four after a Building Spree, none while Extra Tiles still
        // has the hand above the limit.
        const skipRefill = refillHand(
          playerData.tiles ?? [],
          gameState.tile_bag ?? [],
          getHandLimit(globalRulesSnap),
        );
        const tileBag = skipRefill.bag;

        if (skipRefill.tiles.length !== (playerData.tiles ?? []).length) {
          await adminClient
            .from('game_players')
            .update({ tiles: skipRefill.tiles })
            .eq('id', playerData.id);
        }

        const nextPlayerIndex = (myPlayerIndex + 1) % allPlayers.length;
        const skipCurrentRound = gameState.round_number ?? 0;
        const skipNewRound = skipCurrentRound + (nextPlayerIndex === 0 ? 1 : 0);
        const skipRulesSnap: CustomRules = normalizeRules(gameState.rules_snapshot);
        const skipTurnSeconds = getTurnTimerSeconds(skipRulesSnap);
        const skipNewDeadline: number | null =
          skipTurnSeconds !== null && !(skipRulesSnap.disableTimerFirstRounds && skipNewRound < 2)
            ? Math.floor(Date.now() / 1000) + skipTurnSeconds
            : null;

        let newPhase = 'place_tile';
        let winner = null;

        // Epic 18: same branch as buy_stocks — a declared turn ends the game
        // when it ends, and only for the seat that declared.
        if (gameState.end_declared_by === myPlayerIndex) {
          newPhase = 'game_over';
          const scoredPlayers = allPlayers.map(p => ({
            id: `player-${p.player_index}`,
            name: p.player_name,
            cash: p.cash,
            stocks: p.stocks,
          }));
          winner = calculateFinalScores(scoredPlayers, gameState.chains, globalBonusTier)[0].name;
        }

        await adminClient
          .from('game_states')
          .update({
            current_player_index: nextPlayerIndex,
            phase: newPhase,
            tile_bag: tileBag,
            ...TURN_RESET,
            last_placed_tile: null,
            winner,
            round_number: skipNewRound,
            end_condition_round: stampEndConditionRound(gameState.chains, skipCurrentRound),
            turn_deadline_epoch: newPhase === 'game_over' ? null : skipNewDeadline,
          })
          .eq('room_id', roomId);

        result = { success: true };
        break;
      }

      // Deliberately still a 1-for-1 swap, not a refill (Epic 17.7). Turning it
      // into refillHand would let an 11-tile hand full of dead tiles collapse
      // straight back to the limit, which is exactly the cost Extra Tiles buys.
      case 'discard_tile': {
        const { tileId } = payload as { tileId: string };

        if (!tileId) {
          return new Response(
            JSON.stringify({ success: false, error: 'Missing tileId' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!gameState) {
          return new Response(
            JSON.stringify({ success: false, error: 'Game not started' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Security: Verify the requesting user is the current player
        if (gameState.current_player_index !== myPlayerIndex) {
          return new Response(
            JSON.stringify({ success: false, error: 'Not your turn' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get current player
        const currentPlayer = allPlayers.find((p: any) => p.player_index === gameState.current_player_index);
        if (!currentPlayer) {
          return new Response(
            JSON.stringify({ success: false, error: 'Player not found' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Validate tile is in player's hand
        if (!currentPlayer.tiles.includes(tileId)) {
          return new Response(
            JSON.stringify({ success: false, error: 'Tile not in hand' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Remove tile from player's hand
        const updatedTiles = currentPlayer.tiles.filter((t: string) => t !== tileId);

        // Add tile back to bag at random position
        const tileBag = [...gameState.tile_bag];
        const randomIndex = Math.floor(Math.random() * (tileBag.length + 1));
        tileBag.splice(randomIndex, 0, tileId);

        // Draw new tile
        if (tileBag.length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'Tile bag is empty' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const drawnTile = tileBag.pop()!;
        const finalTiles = [...updatedTiles, drawnTile];

        // Update player tiles in database
        const { error: updatePlayerError } = await adminClient
          .from('game_players')
          .update({ tiles: finalTiles })
          .eq('room_id', roomId)
          .eq('player_index', gameState.current_player_index);

        if (updatePlayerError) throw updatePlayerError;

        // Update tile bag in game state
        const { error: updateStateError } = await adminClient
          .from('game_states')
          .update({ tile_bag: tileBag })
          .eq('room_id', roomId);

        if (updateStateError) throw updateStateError;

        result = { success: true };
        break;
      }

      // Epic 18. Announcing the end, in the sense the physical rules mean it:
      // the player says so during their turn, then finishes that turn as
      // normal, and the game ends when the turn does. Nothing here changes the
      // current turn — the branch that ends the game lives in buy_stocks,
      // skip_buy and auto_end_turn. Replaces the majority end-game vote, which
      // was a mechanic the board game does not have.
      case 'declare_game_end': {
        if (!gameState) {
          return new Response(JSON.stringify({ error: 'Game not started' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Only the player whose turn it is may declare. Everyone else can see
        // the condition is met — chain sizes are public — but cannot act on it.
        if (gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Merger phases are excluded (as the retired vote also excluded them):
        // the board is mid-transition and chain sizes are not final.
        if (!['place_tile', 'buy_stock'].includes(gameState.phase)) {
          return new Response(JSON.stringify({ error: 'Cannot declare the game over during an active action phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // A declaration cannot be withdrawn, and the first one stands.
        if (gameState.end_declared_by !== null && gameState.end_declared_by !== undefined) {
          return new Response(JSON.stringify({ error: 'The game has already been declared over' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // The condition is evaluated now, when the declaration is made — not
        // when the turn ends.
        if (!canDeclareGameEnd(gameState.chains, globalBoardRows, safeChainSize)) {
          return new Response(JSON.stringify({ error: 'No end-game condition is met' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const declareReason = endConditionReason(gameState.chains, globalBoardRows, safeChainSize);
        const declareLog = [...gameState.game_log, {
          timestamp: Date.now(),
          playerId: `player-${myPlayerIndex}`,
          playerName: playerData.player_name,
          action: 'Declared the game over',
          details: declareReason === 'all_safe'
            ? 'Every active chain is safe — the game ends after this turn'
            : `A chain has reached ${globalBoardRows === 6 ? 30 : 41} tiles — the game ends after this turn`,
        }];

        await adminClient
          .from('game_states')
          .update({
            end_declared_by: myPlayerIndex,
            end_condition_round: stampEndConditionRound(gameState.chains, gameState.round_number ?? 0),
            game_log: declareLog,
          })
          .eq('room_id', roomId);

        result = { success: true };
        break;
      }

      // =======================================================================
      // Power cards (Epic 17)
      // =======================================================================
      // Three actions, all following the existing handler shape: turn check →
      // phase check → validate → write → fan out.

      // Play one card. This is the ONLY place card legality is decided, through
      // canPlayPowerCard — the same function the client calls to disable a
      // button and explain why, so the two can never disagree.
      //
      // A card is spent when it is played, not when it pays off: playing Extra
      // Purchase and then buying nothing burns the card. That is what makes
      // this validation simple and race-free, and it is stated in the dialog.
      case 'play_power_card': {
        if (!gameState) {
          return new Response(JSON.stringify({ error: 'Game not started' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const card = payload?.card;
        if (!isPowerCardId(card)) {
          return new Response(JSON.stringify({ error: 'Unknown power card' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const legality = canPlayPowerCard(card, powerTurnState(gameState.phase));
        if (!legality.ok) {
          // 409 for "a card is already active": that is the double-click race,
          // and it is a conflict with state rather than a malformed request.
          const conflict = activePowerCard !== null || !myPowerCards.includes(card);
          return new Response(JSON.stringify({ error: legality.reason }), {
            status: conflict ? 409 : 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const info = POWER_CARD_INFO[card];
        const cardLog = [...gameState.game_log, {
          timestamp: Date.now(),
          playerId: `player-${myPlayerIndex}`,
          playerName: playerData.player_name,
          action: `Played ${info.name}`,
          details: info.summary,
        }];

        // Extra Tiles is the one card whose effect lands at play time rather
        // than colouring the rest of the turn: the tiles have to arrive now to
        // be usable now. Everything else is bookkeeping the later handlers read.
        const cardTileBag = [...(gameState.tile_bag ?? [])];
        let cardPlayerTiles: string[] = playerData.tiles ?? [];
        if (card === 'extra_tiles') {
          const drawCount = Math.min(EXTRA_TILES_DRAW, cardTileBag.length);
          const drawn = cardTileBag.splice(cardTileBag.length - drawCount, drawCount);
          cardPlayerTiles = [...cardPlayerTiles, ...drawn.reverse()];
          cardLog.push({
            timestamp: Date.now(),
            playerId: `player-${myPlayerIndex}`,
            playerName: playerData.player_name,
            action: 'Drew extra tiles',
            details: `${drawn.length} tiles — no tiles are drawn at end of turn until the hand is back to ${getHandLimit(globalRulesSnap)}`,
          });
          await adminClient
            .from('game_players')
            .update({ tiles: cardPlayerTiles })
            .eq('id', playerData.id);
        }

        // The card leaves the player's hand in the same write that marks it
        // active, so a double-clicked card cannot be played twice.
        await adminClient
          .from('game_players')
          .update({ power_cards: myPowerCards.filter((c) => c !== card) })
          .eq('id', playerData.id);

        await adminClient
          .from('game_states')
          .update({
            active_power_card: { card, tradesUsed: 0 },
            tile_bag: cardTileBag,
            game_log: cardLog,
          })
          .eq('room_id', roomId);

        result = { success: true, turnEnded: false, data: { card } };
        break;
      }

      // One Stock Trade: TRADE_GIVE shares of the player's own go back to the
      // bank, TRADE_RECEIVE comes out of it. Modelled exactly on sell_stocks,
      // including the write ordering — the player row moves first and the bank
      // second, so a failure between them can only under-return shares to the
      // bank, never duplicate them. Trading never ends the turn and never
      // changes the phase.
      case 'power_trade': {
        if (!gameState || gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'buy_stock') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (activePowerCard?.card !== 'stock_trade') {
          return new Response(JSON.stringify({ error: 'Stock Trade is not active this turn' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const tradeOutcome = settleTrade({
          give: payload?.give,
          receive: payload?.receive,
          chains: gameState.chains,
          stocks: playerData.stocks,
          stockBank: gameState.stock_bank,
          tradesUsed: activePowerCard.tradesUsed ?? 0,
          chainsBoughtThisTurn: (gameState.chains_bought_this_turn ?? []) as ChainName[],
        });

        if (!tradeOutcome.ok) {
          return new Response(JSON.stringify({ error: tradeOutcome.error }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const trade = tradeOutcome.settlement;

        await adminClient
          .from('game_players')
          .update({ stocks: trade.newStocks })
          .eq('id', playerData.id);

        const tradesUsed = (activePowerCard.tradesUsed ?? 0) + 1;
        const tradeLog = [...gameState.game_log, {
          timestamp: Date.now(),
          playerId: `player-${myPlayerIndex}`,
          playerName: playerData.player_name,
          action: 'Traded stocks',
          details: `${trade.given.map(g => `${g.quantity} ${CHAINS[g.chain].displayName}`).join(' + ')} → 1 ${CHAINS[trade.received].displayName} (trade ${tradesUsed} of ${MAX_POWER_TRADES})`,
        }];

        await adminClient
          .from('game_states')
          .update({
            stock_bank: trade.newStockBank,
            chains_bought_this_turn: trade.newChainsBoughtThisTurn,
            active_power_card: { card: 'stock_trade', tradesUsed },
            game_log: tradeLog,
          })
          .eq('room_id', roomId);

        result = { success: true, turnEnded: false, data: { tradesUsed } };
        break;
      }

      // Stop a Building Spree early. Without it a player who wants only two of
      // their four tiles would be stuck in place_tile — the spree has no other
      // way out while they still hold a playable tile.
      case 'end_placements': {
        if (!gameState || gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'place_tile') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (!isMultiTileActive(activePowerCard)) {
          return new Response(JSON.stringify({ error: 'Building Spree is not active this turn' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Refused before the first placement: a turn still owes the board a
        // tile, spree or no spree.
        if (tilesPlacedThisTurn < 1) {
          return new Response(JSON.stringify({ error: 'Place at least one tile first' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        await adminClient
          .from('game_states')
          .update({
            phase: 'buy_stock',
            game_log: [...gameState.game_log, {
              timestamp: Date.now(),
              playerId: `player-${myPlayerIndex}`,
              playerName: playerData.player_name,
              action: 'Finished placing',
              details: `${tilesPlacedThisTurn} tile${tilesPlacedThisTurn === 1 ? '' : 's'} placed this turn`,
            }],
          })
          .eq('room_id', roomId);

        result = { success: true, turnEnded: false };
        break;
      }

      case 'new_game': {
        // Only host can start new game
        if (!await isCallerHost()) {
          return new Response(JSON.stringify({ error: 'Only host can start new game' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        await adminClient
          .from('game_states')
          .delete()
          .eq('room_id', roomId);

        await adminClient
          .from('game_rooms')
          .update({ status: 'waiting' })
          .eq('id', roomId);

        result = { success: true };
        break;
      }

      case 'update_room_status': {
        // Security: only the room's host may change its status
        if (!await isCallerHost()) {
          return new Response(JSON.stringify({ error: 'Only host can update room status' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const VALID_ROOM_STATUSES = ['waiting', 'playing', 'finished'] as const;
        const newStatus = payload?.status;
        if (!newStatus || !(VALID_ROOM_STATUSES as readonly string[]).includes(newStatus)) {
          return new Response(JSON.stringify({ error: 'Invalid or missing status value' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        await adminClient
          .from('game_rooms')
          .update({ status: newStatus })
          .eq('id', roomId);
        result = { success: true };
        break;
      }

      case 'auto_end_turn': {
        if (!gameState) {
          return new Response(JSON.stringify({ error: 'Game not started' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'place_tile') {
          return new Response(JSON.stringify({ error: 'Not in place_tile phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const autoDeadline = gameState.turn_deadline_epoch;
        if (!autoDeadline || Math.floor(Date.now() / 1000) < autoDeadline) {
          return new Response(JSON.stringify({ error: 'Timer has not expired' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const autoRules: CustomRules = normalizeRules(gameState.rules_snapshot);
        const autoSafeChainSize: number | null = getSafeChainSize(autoRules);
        const { boardRows: autoBoardRows, boardColsCount: autoBoardColsCount } = getBoardDimensions(autoRules);
        const autoEligibleChains: ChainName[] = getEligibleChains(autoRules);
        const autoBonusTier: string = getBonusTier(autoRules);
        const autoBoard = { ...gameState.board };
        const autoChains = { ...gameState.chains };
        const autoStockBank = { ...gameState.stock_bank };
        const autoTileBag = [...gameState.tile_bag];
        const autoPlayerTiles: string[] = playerData.tiles || [];

        const autoGameLog = [...gameState.game_log, {
          timestamp: Date.now(),
          playerId: `player-${myPlayerIndex}`,
          playerName: playerData.player_name,
          action: 'Turn auto-ended (timer expired)',
        }];

        // Find playable tiles (the same legality test place_tile enforces).
        const autoPlayableTiles = autoPlayerTiles.filter(tileId => isTilePlayable({
          tileId,
          board: autoBoard,
          chains: autoChains,
          eligibleChains: autoEligibleChains,
          boardRows: autoBoardRows,
          boardColsCount: autoBoardColsCount,
        }));

        // Helper: compute next turn index, round number, and timer deadline
        const computeAutoNextTurn = (chains: Record<ChainName, any>) => {
          const npi = (myPlayerIndex + 1) % allPlayers.length;
          const curRound = gameState.round_number ?? 0;
          const nrn = curRound + (npi === 0 ? 1 : 0);
          const autoTurnSeconds = getTurnTimerSeconds(autoRules);
          const nd: number | null =
            autoTurnSeconds !== null && !(autoRules.disableTimerFirstRounds && nrn < 2)
              ? Math.floor(Date.now() / 1000) + autoTurnSeconds
              : null;
          let phase = 'place_tile';
          let autoWinner: string | null = null;
          // Epic 18: a declared turn that times out still ends the game — a
          // player can neither stall out of the consequence nor lose the
          // declaration by running down the clock.
          if (gameState.end_declared_by === myPlayerIndex) {
            phase = 'game_over';
            const scored = allPlayers.map(p => ({
              id: `player-${p.player_index}`,
              name: p.player_name,
              cash: p.cash,
              stocks: p.stocks,
            }));
            autoWinner = calculateFinalScores(scored, chains, autoBonusTier)[0].name;
          }
          return {
            nextPlayerIndex: npi,
            newRoundNumber: nrn,
            newDeadline: phase === 'game_over' ? null : nd,
            newPhase: phase,
            winner: autoWinner,
            endConditionRound: stampEndConditionRound(chains, curRound),
          };
        };

        let autoNewPlayerTiles = [...autoPlayerTiles];

        if (autoPlayableTiles.length === 0) {
          // No playable tile: return a random tile to the bag, refill, end turn.
          const discardIdx = Math.floor(Math.random() * autoPlayerTiles.length);
          const tileToDiscard = autoPlayerTiles[discardIdx];
          const bagInsertPos = Math.floor(Math.random() * (autoTileBag.length + 1));
          autoTileBag.splice(bagInsertPos, 0, tileToDiscard);
          const swapped = refillHand(
            autoPlayerTiles.filter(t => t !== tileToDiscard),
            autoTileBag,
            getHandLimit(autoRules),
          );
          autoNewPlayerTiles = swapped.tiles;
          autoTileBag.length = 0;
          autoTileBag.push(...swapped.bag);

          await adminClient.from('game_players').update({ tiles: autoNewPlayerTiles }).eq('id', playerData.id);

          const { nextPlayerIndex, newRoundNumber, newDeadline, newPhase, winner, endConditionRound } =
            computeAutoNextTurn(autoChains);
          await adminClient.from('game_states').update({
            current_player_index: nextPlayerIndex,
            phase: newPhase,
            tile_bag: autoTileBag,
            ...TURN_RESET,
            last_placed_tile: null,
            round_number: newRoundNumber,
            end_condition_round: endConditionRound,
            turn_deadline_epoch: newDeadline,
            game_log: autoGameLog,
            winner,
          }).eq('room_id', roomId);

          result = { success: true };
          break;
        }

        // Pick a random playable tile
        const tileToPlay = autoPlayableTiles[Math.floor(Math.random() * autoPlayableTiles.length)];
        autoNewPlayerTiles = autoPlayerTiles.filter(t => t !== tileToPlay);

        // Analyze placement
        const autoAdjTiles = getAdjacentTiles(tileToPlay, autoBoardRows, autoBoardColsCount);
        const autoChainsSet = new Set<ChainName>();
        const autoUnincorp: string[] = [];
        for (const a of autoAdjTiles) {
          const t = autoBoard[a];
          if (t?.placed) {
            if (t.chain) autoChainsSet.add(t.chain as ChainName);
            else autoUnincorp.push(a);
          }
        }
        const autoChainArray = Array.from(autoChainsSet);

        // Place tile on board
        autoBoard[tileToPlay] = { id: tileToPlay, placed: true, chain: null };
        const autoNewChains = { ...autoChains };

        // Helper: draw tile and advance turn
        const advanceTurn = async (chains: Record<ChainName, any>) => {
          // Epic 17.13: a timer that expires mid-spree ends the turn from
          // wherever the spree reached and refills the hand from there, rather
          // than forcing another placement.
          const autoRefill = refillHand(autoNewPlayerTiles, autoTileBag, getHandLimit(autoRules));
          autoNewPlayerTiles = autoRefill.tiles;
          autoTileBag.length = 0;
          autoTileBag.push(...autoRefill.bag);
          await adminClient.from('game_players').update({ tiles: autoNewPlayerTiles }).eq('id', playerData.id);
          const { nextPlayerIndex, newRoundNumber, newDeadline, newPhase, winner, endConditionRound } =
            computeAutoNextTurn(chains);
          await adminClient.from('game_states').update({
            board: autoBoard,
            chains,
            stock_bank: autoStockBank,
            current_player_index: nextPlayerIndex,
            phase: newPhase,
            tile_bag: autoTileBag,
            ...TURN_RESET,
            last_placed_tile: null,
            merger: null,
            pending_chain_foundation: null,
            round_number: newRoundNumber,
            end_condition_round: endConditionRound,
            turn_deadline_epoch: newDeadline,
            game_log: autoGameLog,
            winner,
          }).eq('room_id', roomId);
        };

        if (autoChainArray.length >= 2) {
          // Merger: auto-resolve — all players keep their stock
          const sortedBySize = autoChainArray
            .map(c => ({ chain: c, size: autoChains[c].tiles.length }))
            .sort((a, b) => b.size - a.size);
          const biggestSize = sortedBySize[0].size;
          const tiedChains = sortedBySize.filter(c => c.size === biggestSize);
          const survivingChain = tiedChains[Math.floor(Math.random() * tiedChains.length)].chain;
          const defunctList = autoChainArray.filter(c => c !== survivingChain);

          // Fetch fresh player data for accurate cash
          const { data: freshAutoPlayers } = await adminClient
            .from('game_players').select('*').eq('room_id', roomId).order('player_index');
          const freshAutoStates = (freshAutoPlayers || []).map((p: any) => ({
            id: `player-${p.player_index}`,
            name: p.player_name,
            cash: p.cash,
            stocks: p.stocks,
          }));

          // Pay bonuses for each defunct chain
          for (const defunctC of defunctList) {
            const dSize = autoChains[defunctC].tiles.length;
            const dBonuses = getBonuses(defunctC, dSize, autoBonusTier);
            const payments: { pi: number; amount: number }[] = [];

            if (autoBonusTier === 'flat') {
              const allHolders = freshAutoStates.filter((p: any) => (p.stocks[defunctC] ?? 0) > 0);
              if (allHolders.length > 0) {
                const flatPool = dBonuses.majority + dBonuses.minority;
                const perPlayer = Math.floor(flatPool / allHolders.length);
                allHolders.forEach((p: any) => payments.push({ pi: parseInt(p.id.split('-')[1]), amount: perPlayer }));
              }
            } else {
              const { majority: dMaj, minority: dMin } = getStockholderRankings(freshAutoStates, defunctC);
              if (dMaj.length > 0) {
                if (dMin.length === 0) {
                  const each = Math.floor((dBonuses.majority + dBonuses.minority) / dMaj.length);
                  dMaj.forEach((p: any) => payments.push({ pi: parseInt(p.id.split('-')[1]), amount: each }));
                } else {
                  const majEach = Math.floor(dBonuses.majority / dMaj.length);
                  const minEach = Math.floor(dBonuses.minority / dMin.length);
                  dMaj.forEach((p: any) => payments.push({ pi: parseInt(p.id.split('-')[1]), amount: majEach }));
                  dMin.forEach((p: any) => payments.push({ pi: parseInt(p.id.split('-')[1]), amount: minEach }));
                }
              }
            }

            if (payments.length > 0) {
              for (const { pi, amount } of payments) {
                const dbP = (freshAutoPlayers || []).find((p: any) => p.player_index === pi);
                if (dbP) await adminClient.from('game_players').update({ cash: dbP.cash + amount }).eq('id', dbP.id);
              }
              autoGameLog.push({
                timestamp: Date.now(),
                playerId: 'system',
                playerName: 'System',
                action: `${CHAINS[defunctC].displayName} bonuses paid (auto)`,
              });
            }
          }

          // Transfer all defunct tiles to surviving chain
          const mergerTilesToAdd = [tileToPlay, ...autoUnincorp];
          for (const dc of defunctList) mergerTilesToAdd.push(...autoChains[dc].tiles);
          for (const tid of mergerTilesToAdd) autoBoard[tid] = { ...autoBoard[tid], chain: survivingChain };
          const survivorExisting = autoChains[survivingChain].tiles;
          const survivorAll = [...new Set([...survivorExisting, ...mergerTilesToAdd])];
          autoNewChains[survivingChain] = { ...autoNewChains[survivingChain], tiles: survivorAll, isSafe: autoSafeChainSize !== null && survivorAll.length >= autoSafeChainSize };
          for (const dc of defunctList) {
            autoNewChains[dc] = { ...autoNewChains[dc], tiles: [], isActive: false, isSafe: false };
          }

          autoGameLog.push({
            timestamp: Date.now(),
            playerId: 'system',
            playerName: 'System',
            action: 'Merger auto-resolved',
            details: `${CHAINS[survivingChain].displayName} absorbed ${defunctList.map(c => CHAINS[c].displayName).join(', ')}`,
          });

          await advanceTurn(autoNewChains);

        } else if (autoChainArray.length === 1) {
          // Grow existing chain
          const growTarget = autoChainArray[0];
          const growTiles = [tileToPlay, ...autoUnincorp];
          for (const tid of growTiles) autoBoard[tid] = { ...autoBoard[tid], chain: growTarget };
          const growExisting = autoChains[growTarget].tiles;
          const growAll = [...growExisting, ...growTiles];
          autoNewChains[growTarget] = { ...autoNewChains[growTarget], tiles: growAll, isSafe: autoSafeChainSize !== null && growAll.length >= autoSafeChainSize };

          await advanceTurn(autoNewChains);

        } else if (autoUnincorp.length > 0) {
          // Found a new chain: pick random from eligible available chains
          const availableForAuto = autoEligibleChains.filter(c => !autoChains[c].isActive);
          const newAutoChain = availableForAuto[Math.floor(Math.random() * availableForAuto.length)];
          const foundTiles = [tileToPlay, ...autoUnincorp];
          for (const tid of foundTiles) autoBoard[tid] = { ...autoBoard[tid], chain: newAutoChain };
          autoNewChains[newAutoChain] = { ...autoNewChains[newAutoChain], tiles: foundTiles, isActive: true, isSafe: autoSafeChainSize !== null && foundTiles.length >= autoSafeChainSize };

          // Founding bonus
          if (autoStockBank[newAutoChain] > 0) {
            const founderStocks = { ...playerData.stocks };
            founderStocks[newAutoChain] = (founderStocks[newAutoChain] || 0) + 1;
            autoStockBank[newAutoChain]--;
            await adminClient.from('game_players').update({ stocks: founderStocks }).eq('id', playerData.id);
          }

          autoGameLog.push({
            timestamp: Date.now(),
            playerId: `player-${myPlayerIndex}`,
            playerName: playerData.player_name,
            action: `Auto-founded ${CHAINS[newAutoChain].displayName}`,
          });

          await advanceTurn(autoNewChains);

        } else {
          // Place only — skip buy, advance turn
          await advanceTurn(autoNewChains);
        }

        result = { success: true };
        break;
      }

      case 'bot_tick': {
        // No-op: any player in the room may call this to resume bot play that
        // was paused by the per-invocation budget. driveBots runs afterwards.
        result = { success: true };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    // Fan out realtime events to the room (best-effort, non-blocking)
    if (result.success) {
      notifyForAction(action, roomId).catch((err) => console.error('notify error:', err));
    }

    // Record the game for the statistics dashboard the moment it ends (Epic 16).
    // Hooked here, at the single exit point, rather than at each of the seven
    // sites that set phase = 'game_over' — so a path added later is still
    // captured. The gate is one indexed lookup when the game was already
    // running, and skipped entirely once the game is over. Awaited on purpose:
    // 'new_game' deletes the game_states row, and the record is built from it.
    if (result.success && gameState && gameState.phase !== 'game_over') {
      // Epic 18.7 — the stalemate backstop. Removing automatic end detection
      // makes one dead end reachable: the bag is empty, no player holds a
      // playable tile, and nobody has declared. discard_tile already refuses on
      // an empty bag, so there is nothing any player could still do, and with
      // the vote retired there is no human escape either. Acquire's own answer
      // is that the game ends when no one can place a tile — the single piece
      // of automatic ending this epic keeps, as a liveness guarantee rather
      // than a rules decision. Gated on the pre-action bag already being empty,
      // so ordinary play pays nothing for it.
      const stalled = (gameState.tile_bag?.length ?? 0) === 0
        ? await endIfStalemate(roomId)
        : false;
      await recordIfFinished(roomId, stalled ? 'stalemate' : endReasonForAction(action));
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('Function error:', error);
    return new Response(JSON.stringify({ error: 'An internal error occurred' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Epic 18.7. End the game when the board is dead: the tile bag is empty and no
// player holds a tile they could legally place. Only ever called at a turn
// boundary (phase 'place_tile') so a mid-merger state is never mistaken for a
// stalemate. Returns true when this call is the one that ended the game.
async function endIfStalemate(roomId: string): Promise<boolean> {
  try {
    const { data: state } = await db.from('game_states').select('*').eq('room_id', roomId).single();
    if (!state || state.phase !== 'place_tile') return false;
    if ((state.tile_bag?.length ?? 0) > 0) return false;

    const { data: players } = await db
      .from('game_players').select('*').eq('room_id', roomId).order('player_index');
    if (!players || players.length === 0) return false;

    const rules: CustomRules = normalizeRules(state.rules_snapshot);
    const { boardRows, boardColsCount } = getBoardDimensions(rules);
    const eligible: ChainName[] = getEligibleChains(rules);
    const chains = state.chains ?? {};
    const board = state.board ?? {};

    // Same legality test the turn timer and the Building Spree exit use: a tile
    // is dead if it would merge two safe chains, or would found an eighth chain.
    const isPlayable = (tileId: string): boolean =>
      isTilePlayable({ tileId, board, chains, eligibleChains: eligible, boardRows, boardColsCount });

    if (players.some((p: any) => (p.tiles ?? []).some(isPlayable))) return false;

    const scored = players.map((p: any) => ({
      id: `player-${p.player_index}`,
      name: p.player_name,
      cash: p.cash,
      stocks: p.stocks,
    }));
    const winner = calculateFinalScores(scored, chains, getBonusTier(rules))[0]?.name ?? null;

    await db.from('game_states').update({
      phase: 'game_over',
      winner,
      turn_deadline_epoch: null,
      game_log: [...(state.game_log ?? []), {
        timestamp: Date.now(),
        playerId: 'system',
        playerName: 'System',
        action: 'Game over — no player can place a tile',
        details: 'The tile bag is empty and every remaining tile is unplayable.',
      }],
    }).eq('room_id', roomId);

    return true;
  } catch (error) {
    // A backstop that throws must not fail the action that triggered it.
    console.error('endIfStalemate error:', error);
    return false;
  }
}

// Pacing for bot play: each bot waits this long before taking its turn so a
// human can watch the game unfold instead of bots resolving instantly.
const BOT_TURN_DELAY_MS = 3000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Rooms with a driveBots loop currently running. Because the Hetzner backend is
// a single long-lived process, this in-memory set is enough to guarantee only
// one bot loop runs per room at a time — bot_tick nudges that arrive during a
// pacing delay are ignored rather than playing the same turn twice.
const drivingRooms = new Set<string>();

// Play out consecutive bot turns until a human must act or the game ends. Each
// bot move runs through the real engine (handleGameAction), so it is validated
// and fans out its own realtime event. State is persisted after every single
// move, so an interrupted run never corrupts a turn — the next human action (or
// `bot_tick` nudge) resumes here. Bots are paced (BOT_TURN_DELAY_MS per turn).
async function driveBots(roomId: string, corsHeaders: Record<string, string>): Promise<void> {
  if (drivingRooms.has(roomId)) return; // a loop is already pacing this room
  drivingRooms.add(roomId);
  try {
    await driveBotsLoop(roomId, corsHeaders);
  } finally {
    drivingRooms.delete(roomId);
  }
}

async function driveBotsLoop(roomId: string, corsHeaders: Record<string, string>): Promise<void> {
  // Generous safety cap (the loop normally exits as soon as a human must act).
  const deadline = Date.now() + 5 * 60 * 1000;
  const MAX_MOVES = 60;
  // Track retries per actorIndex to prevent infinite retry loops
  const retryCount = new Map<number, number>();
  // The seat whose turn we last paced, so multiple actions within one bot turn
  // (e.g. place tile + buy stock) only incur a single delay.
  let lastActorIndex: number | null = null;

  for (let i = 0; i < MAX_MOVES; i++) {
    if (Date.now() > deadline) return;

    const { data: gameState } = await db.from('game_states').select('*').eq('room_id', roomId).single();
    if (!gameState || gameState.phase === 'game_over') return;

    const { data: players } = await db.from('game_players').select('*').eq('room_id', roomId).order('player_index');
    if (!players || players.length === 0) return;

    // Whose move is it? During the per-player merger stock step the actor is
    // merger.currentPlayerIndex; otherwise it's the current player.
    const actorIndex = gameState.phase === 'merger_handle_stock'
      ? gameState.merger?.currentPlayerIndex
      : gameState.current_player_index;
    if (actorIndex == null) return;

    const actor = players.find((p: any) => p.player_index === actorIndex);
    if (!actor || !actor.is_bot) return; // a human must act — stop

    // Pace one delay per bot turn (not per individual action within a turn).
    if (lastActorIndex !== actorIndex) {
      lastActorIndex = actorIndex;
      await sleep(BOT_TURN_DELAY_MS);
    }

    const difficulty = (actor.bot_difficulty as BotDifficulty) || 'medium';
    let move;
    try {
      move = decideBotMove(difficulty, gameState.phase, gameState, players, actor);
    } catch (error) {
      console.error('Bot decision error:', error);
      return;
    }

    const res = await handleGameAction({
      corsHeaders,
      body: { action: move.action, roomId, payload: move.payload },
      actAsPlayerIndex: actorIndex,
    });

    if (res.status !== 200) {
      const retries = (retryCount.get(actorIndex) ?? 0) + 1;
      retryCount.set(actorIndex, retries);

      if (retries > 3) {
        console.error('Bot move rejected too many times, giving up:', gameState.phase, move.action);
        return;
      }

      const isMergerPhase = ['merger_pay_bonuses', 'merger_handle_stock', 'merger_choose_survivor'].includes(gameState.phase);
      if (!isMergerPhase) {
        console.error('Bot move rejected:', difficulty, gameState.phase, move.action, res.status);
        return;
      }

      // For merger phases: try a safe fallback action to prevent permanent freezes
      let fallback: { action: string; payload?: any };
      if (gameState.phase === 'merger_handle_stock') {
        const defunctChain = gameState.merger?.currentDefunctChain;
        const shares: number = actor.stocks?.[defunctChain] ?? 0;
        fallback = { action: 'merger_stock_choice', payload: { decision: { sell: 0, trade: 0, keep: shares } } };
      } else if (gameState.phase === 'merger_choose_survivor') {
        const chains = gameState.chains ?? {};
        const tiedChains = (gameState.merger?.defunctChains as string[] ?? []);
        const survivor = [...tiedChains].sort(
          (a: string, b: string) => (chains[b]?.tiles?.length ?? 0) - (chains[a]?.tiles?.length ?? 0)
        )[0] ?? tiedChains[0];
        fallback = { action: 'choose_merger_survivor', payload: { survivingChain: survivor } };
      } else {
        fallback = { action: 'pay_merger_bonuses' };
      }

      const fallbackRes = await handleGameAction({
        corsHeaders,
        body: { action: fallback.action, roomId, payload: fallback.payload },
        actAsPlayerIndex: actorIndex,
      });

      if (fallbackRes.status !== 200) {
        console.error('Bot fallback also rejected:', gameState.phase, fallback.action, fallbackRes.status);
        return;
      }
      // Fallback succeeded — re-enter the loop to read fresh state
      continue;
    }
    retryCount.delete(actorIndex); // successful move clears retry counter
  }
}

// Helper function to complete merger
async function completeMergerInDb(
  adminClient: any,
  roomId: string,
  gameState: any,
  allPlayers: any[],
  gameLog: any[]
): Promise<string> {
  const merger = gameState.merger;
  const survivingChain = merger.survivingChain as ChainName;
  const lastTile = gameState.last_placed_tile;

  // Derive board dimensions for adjacency calculation
  const completeMergerRulesForBoard: CustomRules = normalizeRules(gameState.rules_snapshot);
  const { boardRows: cmBoardRows, boardColsCount: cmBoardColsCount } = getBoardDimensions(completeMergerRulesForBoard);

  // Collect all tiles to add
  const tilesToAdd: TileId[] = [lastTile];

  const adjacent = getAdjacentTiles(lastTile, cmBoardRows, cmBoardColsCount);
  for (const adjTile of adjacent) {
    const tile = gameState.board[adjTile];
    if (tile?.placed && !tile.chain) {
      tilesToAdd.push(adjTile);
    }
  }

  for (const defunctChain of merger.defunctChains) {
    tilesToAdd.push(...gameState.chains[defunctChain].tiles);
  }

  // Update board
  const newBoard = { ...gameState.board };
  for (const tid of tilesToAdd) {
    newBoard[tid] = { ...newBoard[tid], chain: survivingChain };
  }

  // Update chains
  const completeMergerRules: CustomRules = normalizeRules(gameState.rules_snapshot);
  const completeMergerSafeSize: number | null = getSafeChainSize(completeMergerRules);
  const newChains = { ...gameState.chains };
  const existingTiles = newChains[survivingChain].tiles;
  const allTiles = [...new Set([...existingTiles, ...tilesToAdd])];

  newChains[survivingChain] = {
    ...newChains[survivingChain],
    tiles: allTiles,
    isSafe: completeMergerSafeSize !== null && allTiles.length >= completeMergerSafeSize,
  };

  for (const defunctChain of merger.defunctChains) {
    newChains[defunctChain] = {
      ...newChains[defunctChain],
      tiles: [],
      isActive: false,
      isSafe: false,
    };
  }

  gameLog.push({
    timestamp: Date.now(),
    playerId: 'system',
    playerName: 'System',
    action: 'Merger complete',
    details: `${CHAINS[survivingChain].displayName} absorbed ${merger.defunctChains.map((c: ChainName) => CHAINS[c].displayName).join(', ')}. Now has ${allTiles.length} tiles.`,
  });

  // Epic 18: a merger that pushes a chain past the end-game size no longer ends
  // the game mid-turn. It exits like any other merger, and the player may
  // declare from there.
  //
  // Epic 17: this is the fourth and last placement exit — the one every merger
  // path funnels through. A merger triggered mid-spree is therefore always
  // *fully* resolved (survivor, bonuses, every player's stock decision) before
  // the next tile can be placed, because the spree edge is only added here,
  // after the merger has finished.
  const placingPlayer = allPlayers.find(
    (p: any) => p.player_index === gameState.current_player_index,
  );
  const newPhase = phaseAfterPlacement({
    activePowerCard: normalizeActivePowerCard(gameState.active_power_card),
    tilesPlacedThisTurn: gameState.tiles_placed_this_turn ?? 0,
    playerTiles: placingPlayer?.tiles ?? [],
    board: newBoard,
    chains: newChains,
    rules: completeMergerRules,
  });

  await adminClient
    .from('game_states')
    .update({
      board: newBoard,
      chains: newChains,
      phase: newPhase,
      merger: null,
      game_log: gameLog,
    })
    .eq('room_id', roomId);

  return newPhase;
}
