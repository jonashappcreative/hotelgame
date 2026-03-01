# Custom Room Rules — Implementation TODO

## Feature Overview

The `feature/room-settings-lovable` branch introduces a **Custom Room Rules** system that allows the room creator to configure game parameters before creating a room. Currently the entire feature is **UI-only** — rules are stored in React state inside `OnlineLobby.tsx` and are never persisted or applied.

This document covers the full end-to-end implementation: from persisting rules in the database, through the API and edge function, into game logic, and finally rendering them correctly in the game UI. All user stories must be implemented so that rules chosen in the lobby are enforced throughout gameplay.

> **Key architectural note:** Core game logic is duplicated in two places. Any change that affects game rules must be applied in **both**:
> - `src/utils/gameLogic.ts` — used by the frontend for local game state management
> - `supabase/functions/game-action/index.ts` — the Supabase edge function that is the authoritative server-side game engine

---

## Rules Reference

Below is the complete and final specification of every custom rule.

### Rule 1 — Turn Timer

| Field | Value |
|---|---|
| Toggle key | `turnTimerEnabled` |
| Default | `false` (disabled) |
| Sub-key: duration | `turnTimer` |
| Duration default | `"60"` (seconds) |
| Duration options | `"30"` · `"60"` · `"90"` |
| Sub-key: grace rounds | `disableTimerFirstRounds` |
| Grace rounds default | `true` |
| Description | Adds a per-turn countdown. When the timer expires the turn is auto-ended server-side using a deterministic auto-play sequence: place a random tile from the player's hand; if a chain would be founded, pick a random available chain; skip the buy-stock phase; in a merger, keep all stock. |

### Rule 2 — Chain Safety Threshold

| Field | Value |
|---|---|
| Toggle key | `chainSafetyEnabled` |
| Default | `false` (disabled, game uses hardcoded 11) |
| Sub-key: threshold | `chainSafetyThreshold` |
| Threshold default | `"none"` |
| Threshold options | `"none"` (no safe chains) · `"9"` · `"11"` · `"13"` · `"15"` |
| Description | Chains that reach this size become safe and cannot be acquired in mergers. The current codebase hardcodes 11 in `SAFE_CHAIN_SIZE`. When this rule is disabled the default 11-tile safe threshold remains in effect. |

### Rule 3 — Cash Visibility

| Field | Value |
|---|---|
| Toggle key | `cashVisibilityEnabled` |
| Default | `false` (disabled, cash is hidden) |
| Sub-key: mode | `cashVisibility` |
| Mode default | `"hidden"` |
| Mode options | `"hidden"` · `"visible"` · `"aggregate"` |
| Description | Controls whether opponents' cash is visible. `hidden` = no cash shown; `visible` = all individual balances shown; `aggregate` = total cash in the game shown but not broken down by player. |

### Rule 4 — Bonus Payment Tiers

| Field | Value |
|---|---|
| Toggle key | `bonusTierEnabled` |
| Default | `false` (disabled, uses standard 10x/5x) |
| Sub-key: tier | `bonusTier` |
| Tier default | `"standard"` |
| Tier options | `"standard"` (10x majority / 5x minority) · `"flat"` (equal payout to all holders) · `"aggressive"` (15x majority / 5x minority) |
| Description | Determines how merger bonuses are distributed. The current codebase hardcodes `MAJORITY_BONUS_MULTIPLIER = 10` and `MINORITY_BONUS_MULTIPLIER = 5`. |

### Rule 5 — Board Size

| Field | Value |
|---|---|
| Toggle key | `boardSizeEnabled` |
| Default | `false` (disabled, uses standard 9x12) |
| Sub-key: size | `boardSize` |
| Size default | `"9x12"` |
| Size options | `"9x12"` (Standard) · `"6x10"` (Fast) |
| Description | Controls the dimensions of the game board. The current codebase hardcodes 9 rows and 12 columns (A-L) throughout `gameLogic.ts`, `game-action/index.ts`, and `GameBoard.tsx`. **Inter-rule coupling:** selecting `"6x10"` automatically sets `maxChains` to `"5"` as the default when Chain Founding Rules are enabled. |

### Rule 6 — Chain Founding Rules (Max Chains Only)

| Field | Value |
|---|---|
| Toggle key | `chainFoundingEnabled` |
| Default | `false` (disabled) |
| Sub-key: max chains | `maxChains` |
| Max chains default | `"7"` |
| Max chains options | `"5"` (Limited) · `"6"` (Extended) · `"7"` (Standard) |
| Description | Limits how many hotel chains can exist simultaneously. The founder always receives 1 free stock — this cannot be disabled. |

**Chain subset composition** (deterministic — always the same chains for a given limit):

| maxChains | Budget (cheap) | Midrange (medium) | Premium (expensive) | Excluded |
|---|---|---|---|---|
| `"5"` | sackson, tower | worldwide, american | continental | festival, imperial |
| `"6"` | sackson, tower | worldwide, american | continental, imperial | festival |
| `"7"` | sackson, tower | worldwide, american, festival | continental, imperial | — |

> Festival is always the last midrange chain to be included as the pool grows.

**Board size coupling:** When `boardSize = "6x10"` and `chainFoundingEnabled = true`, the default for `maxChains` is `"5"` instead of `"7"`. This is enforced both in the UI (auto-selecting `"5"` when small board is chosen) and in the edge function at game init.

### Rule 7 — Starting Conditions

| Field | Value |
|---|---|
| Toggle key | `startingConditionsEnabled` |
| Default | `false` (disabled) |
| Sub-key: cash | `startingCash` |
| Cash default | `"6000"` |
| Cash options | `"4000"` (Tight) · `"6000"` (Standard) · `"8000"` (Loose) |
| Sub-key: tiles | `startingTiles` |
| Tiles default | `"6"` |
| Tiles options | `"5"` · `"6"` · `"7"` |
| Sub-key: starting tile | `startWithTileOnBoard` |
| Starting tile default | `true` |
| Description | Adjusts per-player starting cash and tile count, and whether one random tile is pre-placed at game start. The edge function currently hardcodes `cash: 6000` and `tiles.splice(0, 6)`. |

---

## Dependency Graph

The infrastructure stories (0-2) are hard prerequisites. Feature stories (3-9) are independent of each other unless noted. Story 7 and Story 8 share an inter-rule coupling.

```
STORY 0 (DB Migration)
    └── STORY 1 (Shared Types)
            └── STORY 2 (API / Lobby wiring)
                    ├── STORY 3  Turn Timer
                    ├── STORY 4  Chain Safety Threshold
                    ├── STORY 5  Cash Visibility
                    ├── STORY 6  Bonus Payment Tiers
                    ├── STORY 7  Board Size ──┐ inter-rule coupling
                    ├── STORY 8  Chain Founding Rules ◄─┘
                    └── STORY 9  Starting Conditions
```

---

## Infrastructure Stories

---

### STORY 0 — Database: Schema Changes

**As a** backend system,
**I want** the room's custom rules persisted in the database at room creation time and a snapshot of active rule values stored in the game state record,
**so that** the edge function can read authoritative rule values on every game action without a second database round-trip.

#### Acceptance Criteria

- [x] A new nullable JSONB column `custom_rules` exists on the `game_rooms` table.
- [x] `custom_rules` defaults to `NULL`; existing rooms continue to work with game defaults.
- [x] A new JSONB column `rules_snapshot` exists on the `game_states` table, populated at game start from the room's `custom_rules` (or `DEFAULT_RULES` if null).
- [x] A new INTEGER column `turn_deadline_epoch` (nullable) exists on `game_states`, storing the Unix timestamp (seconds) at which the current player's turn expires. `NULL` means no timer is active.
- [x] The Supabase generated types file (`src/integrations/supabase/types.ts`) reflects all new columns.

#### Implementation Tasks

- [x] Create a new migration file in `supabase/migrations/` with the following:
  ```sql
  -- Persist rules chosen at room creation
  ALTER TABLE public.game_rooms
    ADD COLUMN custom_rules JSONB DEFAULT NULL;

  -- Snapshot of resolved rules for fast access during gameplay
  ALTER TABLE public.game_states
    ADD COLUMN rules_snapshot JSONB DEFAULT NULL;

  -- Unix epoch timestamp (seconds) for the current player's turn deadline
  ALTER TABLE public.game_states
    ADD COLUMN turn_deadline_epoch BIGINT DEFAULT NULL;
  ```
- [x] Regenerate Supabase types (`supabase gen types typescript`) and commit the updated `src/integrations/supabase/types.ts`.
- [x] Verify the migration applies cleanly without affecting existing `game_players` or other tables.

#### Test Cases

- No unit tests for the migration itself. Integration coverage provided by Story 2 tests.

#### Dependencies

- None. This is the root prerequisite.

---

### STORY 1 — Shared Types: Promote `CustomRules` to `src/types/game.ts`

**As a** developer,
**I want** the `CustomRules` interface and `DEFAULT_RULES` constant defined in the shared types file,
**so that** the frontend and service layer share one canonical definition.

#### Acceptance Criteria

- [x] `CustomRules` interface is exported from `src/types/game.ts`. It does **not** include `founderFreeStock` (removed by product decision — founder always receives a free stock).
- [x] `DEFAULT_RULES` constant is exported from `src/types/game.ts`.
- [x] The local `interface CustomRules` and `const DEFAULT_RULES` inside `OnlineLobby.tsx` are removed and replaced with the import.
- [x] `OnlineLobby.tsx` removes the `founderFreeStock` toggle from its UI entirely.
- [x] The edge function (`supabase/functions/game-action/index.ts`) contains a local mirror of `CustomRules` (it cannot import from `src/` — this is the established pattern for all types there). The mirror also omits `founderFreeStock`.

#### Implementation Tasks

- [x] Add `CustomRules` interface (without `founderFreeStock`) and `DEFAULT_RULES` to `src/types/game.ts`.
- [x] Update `src/components/game/OnlineLobby.tsx`:
  - Import `CustomRules` and `DEFAULT_RULES` from `@/types/game`.
  - Remove the `founderFreeStock` toggle from the Chain Founding Rules section.
  - Update `maxChains` options to `"5"` · `"6"` · `"7"`.
  - Add UI coupling: when `boardSize` changes to `"6x10"` and `chainFoundingEnabled = true`, set `maxChains` to `"5"`.
- [x] Add a `CustomRules` interface block to `supabase/functions/game-action/index.ts` marked as a mirror of the frontend type.

#### Test Cases

In `src/utils/gameLogic.test.ts`:
- [x] `DEFAULT_RULES` contains all required `CustomRules` fields with their correct default values.
- [x] `DEFAULT_RULES` does not contain a `founderFreeStock` field.

#### Dependencies

- STORY 0

---

### STORY 2 — API Layer: Wire Rules from Lobby through Database to Game Start

**As a** room creator and as a joining player,
**I want** custom rules saved at room creation and visible to all players in the lobby before the game starts,
**so that** all players know the rules they are agreeing to before they ready up.

#### Acceptance Criteria

- [x] `OnlineLobby.tsx` passes `confirmedRules ?? DEFAULT_RULES` when calling `onCreateRoom`.
- [x] `createRoom` in `src/utils/multiplayerService.ts` accepts `customRules: CustomRules` and writes it to `game_rooms.custom_rules`.
- [x] A new `fetchRoomRules(roomId: string): Promise<CustomRules>` function exists in `multiplayerService.ts`. Returns the room's rules or `DEFAULT_RULES` if none are set.
- [x] The lobby waiting screen (when `roomCode` is set) displays the active custom rules to all players — both the creator and joiners.
- [x] All players can see the rules summary **before** they mark themselves as ready.
- [x] The edge function reads `custom_rules` from `game_rooms` when `toggle_ready` triggers game initialisation, resolves it against `DEFAULT_RULES` for any missing fields, and stores the resolved object in `game_states.rules_snapshot`.
- [x] If `custom_rules` is `NULL`, the edge function uses `DEFAULT_RULES` and stores that as `rules_snapshot`.

#### Implementation Tasks

- [x] **`src/components/game/OnlineLobby.tsx`**:
  - Update `onCreateRoom` prop type to `(playerName: string, maxPlayers: number, rules: CustomRules) => void`.
  - Pass `confirmedRules ?? DEFAULT_RULES` when calling `onCreateRoom`.
  - In the lobby waiting screen (`roomCode` branch), call `fetchRoomRules(roomId)` on mount and display a rules summary card visible to all players.
- [x] **Parent page/hook** that renders `OnlineLobby`: update `handleCreateRoom` to accept and forward the `rules` argument.
- [x] **`src/utils/multiplayerService.ts`**:
  - Update `createRoom(maxPlayers, customRules)` to include `custom_rules: customRules` in the insert payload.
  - Add `fetchRoomRules(roomId: string): Promise<CustomRules>` — selects `custom_rules` from `game_rooms` and returns `data.custom_rules ?? DEFAULT_RULES`.
- [x] **`supabase/functions/game-action/index.ts` — `toggle_ready` handler**:
  - After all players are ready, fetch `custom_rules` from `game_rooms`.
  - Merge with `DEFAULT_RULES` to fill in any missing fields: `const rules = { ...DEFAULT_RULES, ...(room.custom_rules ?? {}) }`.
  - Apply the board-size coupling: if `rules.boardSize === '6x10'` and `rules.chainFoundingEnabled` and `rules.maxChains === '7'`, override `rules.maxChains` to `'5'`.
  - Write `rules` to `game_states.rules_snapshot`.
  - Use `rules` for all subsequent init calculations.

#### Test Cases

In `src/utils/multiplayerService.test.ts`:
- [x] `createRoom` with explicit `CustomRules` inserts `custom_rules` correctly.
- [x] `createRoom` with `DEFAULT_RULES` stores the full default rule set.
- [x] `fetchRoomRules` returns the stored rules when they exist.
- [x] `fetchRoomRules` returns `DEFAULT_RULES` when `custom_rules` is `NULL`.

#### Dependencies

- STORY 0, STORY 1

---

## Feature Stories

---

### STORY 3 — Turn Timer

**As a** room creator,
**I want** to enable a per-turn countdown timer with server-enforced auto-end,
**so that** games move at a consistent pace even if a player is slow or disconnects.

#### Acceptance Criteria

- [x] When `turnTimerEnabled = true`, a visible countdown timer is displayed in the active player's game UI.
- [x] The timer counts down from the configured duration (30 / 60 / 90 seconds).
- [x] When `disableTimerFirstRounds = true`, the timer does not activate for the first 2 complete rounds (each player taking 2 turns).
- [x] The timer resets at the start of each new turn.
- [x] The timer is not displayed to non-active players.
- [x] When the timer expires, the **frontend** calls an `auto_end_turn` action on the edge function.
- [x] The edge function validates that `turn_deadline_epoch` has passed before executing auto-play.
- [x] **Auto-play sequence** (server-side, deterministic):
  - Pick a random playable tile from the current player's hand. If no tile is playable, discard one and draw.
  - If the tile would found a chain: pick a random chain from the available options.
  - Skip the buy-stock phase entirely (purchase nothing).
  - If the tile triggers a merger: keep all of the current player's stock in the defunct chain.
- [x] After auto-play, the turn advances normally to the next player.
- [x] When `turnTimerEnabled = false` (default), no timer runs and no `turn_deadline_epoch` is set.

#### Implementation Tasks

- [x] **`src/types/game.ts`**: Add `roundNumber: number` to `GameState`.
- [x] **`supabase/functions/game-action/index.ts`**:
  - In `endTurn` logic (end of `buy_stocks`/`skip_buy` handlers): increment `roundNumber` when `currentPlayerIndex` wraps to 0.
  - At the start of each turn (after incrementing `currentPlayerIndex`): if `rules_snapshot.turnTimerEnabled`, set `turn_deadline_epoch = Math.floor(Date.now() / 1000) + parseInt(rules_snapshot.turnTimer)`, unless we are in the grace period (`rules_snapshot.disableTimerFirstRounds && roundNumber < 2`), in which case set `turn_deadline_epoch = NULL`.
  - Add a new action type `auto_end_turn` to `GameActionRequest`.
  - Implement the `auto_end_turn` handler:
    1. Verify `turn_deadline_epoch !== null && Date.now() / 1000 >= turn_deadline_epoch`.
    2. Execute the auto-play sequence (random tile → optional random chain → skip buy / keep merger stock).
    3. Advance to the next player's turn.
    4. Set `turn_deadline_epoch` for the new turn (or NULL if grace period).
- [x] **`src/utils/gameLogic.ts`**: Mirror `roundNumber` increment in the `endTurn` function.
- [x] **New component `src/components/game/TurnTimer.tsx`**:
  - Props: `durationSeconds: number`, `isActive: boolean`, `onExpire: () => void`.
  - `useEffect`-based `setInterval` countdown. Calls `onExpire` at zero and clears the interval.
  - Renders a numeric countdown and a visual progress bar/ring.
- [x] **`src/components/game/GameContainer.tsx`**:
  - Receive `customRules: CustomRules` and `roundNumber: number` as props.
  - Mount `TurnTimer` when `isMyTurn && rules.turnTimerEnabled && !(rules.disableTimerFirstRounds && roundNumber < 2)`.
  - `onExpire` callback: call `executeGameAction('auto_end_turn', roomId)`.

#### Test Cases

In `src/utils/gameLogic.test.ts`:
- [x] `endTurn` called for the last player in a round (wraps to player 0) increments `roundNumber` by 1.
- [x] `endTurn` called for a non-last player leaves `roundNumber` unchanged.

In new file `src/components/game/TurnTimer.test.tsx`:
- [x] Timer counts down from the given duration.
- [x] `onExpire` is called exactly once when the countdown reaches zero.
- [x] Timer does not start when `isActive = false`.
- [x] Timer resets when the component re-mounts with a new `durationSeconds` value.

#### Dependencies

- STORY 0, STORY 1, STORY 2

---

### STORY 4 — Chain Safety Threshold

**As a** room creator,
**I want** to change the tile count at which chains become safe from acquisition,
**so that** I can control how aggressive or defensive the merger dynamic is.

#### Acceptance Criteria

- [x] When `chainSafetyEnabled = true` and `chainSafetyThreshold = "none"`, no chain is ever marked `isSafe`, regardless of size.
- [x] When `chainSafetyEnabled = true` and a numeric threshold is chosen (9 / 11 / 13 / 15), chains become safe at that tile count.
- [x] When `chainSafetyEnabled = false`, the game uses the existing default of 11 tiles (unchanged behaviour).
- [x] The `isSafe` field on `ChainState` is correctly set in `foundChain`, `growChain`, and merger evaluation in both the frontend and the edge function.
- [x] The merger UI correctly reflects whether a chain is safe based on the dynamic threshold.

#### Implementation Tasks

- [x] **`src/types/game.ts`**: Add `safeChainSize: number | null` to `GameState`. `null` = no chains ever safe; a number = the tile threshold. Populated at game init from `rules_snapshot`.
- [x] **`supabase/functions/game-action/index.ts`**:
  - Remove the module-level `const SAFE_CHAIN_SIZE = 11`.
  - At game init (`toggle_ready`), derive and store in `game_states`: `safeChainSize = rules.chainSafetyEnabled ? (rules.chainSafetyThreshold === 'none' ? null : parseInt(rules.chainSafetyThreshold)) : 11`.
  - On every action, read `safeChainSize` from `rules_snapshot` in the fetched game state.
  - Update every usage of `SAFE_CHAIN_SIZE` to use the value from `rules_snapshot`.
- [x] **`src/utils/gameLogic.ts`**:
  - Replace `SAFE_CHAIN_SIZE` usages in `foundChain` and `growChain` with `state.safeChainSize`.
  - If `safeChainSize === null`, always set `isSafe: false`.

#### Test Cases

In `src/utils/gameLogic.test.ts`:
- [x] `foundChain` sets `isSafe = true` when chain size meets `safeChainSize`.
- [x] `foundChain` sets `isSafe = false` when `safeChainSize = null`, even for a large chain.
- [x] `growChain` sets `isSafe = true` exactly at the custom threshold.
- [x] A chain with 9 tiles is safe when `safeChainSize = 9` and not safe when `safeChainSize = 11`.
- [x] A chain with 11 tiles is safe when `safeChainSize = 11` (regression).

#### Dependencies

- STORY 0, STORY 1, STORY 2

---

### STORY 5 — Cash Visibility

**As a** room creator,
**I want** to control whether players can see each other's cash,
**so that** I can tune the information asymmetry and negotiation dynamics of the game.

#### Acceptance Criteria

- [x] When `cashVisibilityEnabled = false` (default), opponents' cash is hidden — other players see `—` instead of a number.
- [x] When `cashVisibility = "visible"`, all players see every other player's exact cash balance.
- [x] When `cashVisibility = "aggregate"`, players see a single total representing the sum of all players' cash, not individual amounts.
- [x] The current player always sees their own exact cash regardless of mode.
- [x] Cash visibility is a display-only concern — the DB continues to store all cash values. No server-side filtering is required for this game's trust model.
- [x] Both `PlayerCard` and `InfoCard` respect the visibility setting.

#### Implementation Tasks

- [x] **Thread `customRules` to game UI**: the parent page/hook that renders `GameContainer` passes `customRules` as a prop. `GameContainer` forwards them to child components as needed.
- [x] **`src/components/game/PlayerCard.tsx`**:
  - Accept `cashVisibility: 'hidden' | 'visible' | 'aggregate'` and `myPlayerIndex: number` props.
  - Render `—` for opponent cash when `cashVisibility = 'hidden'`.
  - Render an aggregate total (one value for the whole board, not per card) when `cashVisibility = 'aggregate'`.
- [x] **`src/components/game/InfoCard.tsx`**: Apply the same hide/aggregate logic to cash and net-worth figures.

#### Test Cases

In new file `src/components/game/PlayerCard.test.tsx`:
- [x] Renders opponent's cash as `—` when `cashVisibility = 'hidden'`.
- [x] Renders opponent's exact cash when `cashVisibility = 'visible'`.
- [x] Always renders the current player's own cash regardless of visibility mode.
- [x] Renders an aggregate total (not individual values) when `cashVisibility = 'aggregate'`.

#### Dependencies

- STORY 0, STORY 1, STORY 2

---

### STORY 6 — Bonus Payment Tiers

**As a** room creator,
**I want** to change how merger bonuses are distributed,
**so that** I can adjust how much the majority/minority shareholder position matters.

#### Acceptance Criteria

- [x] When `bonusTier = "standard"` (default), majority bonus = 10x stock price, minority bonus = 5x stock price — existing behaviour.
- [x] When `bonusTier = "aggressive"`, majority bonus = 15x stock price, minority bonus = 5x stock price.
- [x] When `bonusTier = "flat"`, the combined bonus pool (majority + minority) is split equally among **all** stockholders of the acquired chain, regardless of how many shares each holds.
- [x] The bonus tier applies both to in-game merger bonuses and to end-of-game payouts in `calculateFinalScores`.

#### Implementation Tasks

- [x] **`supabase/functions/game-action/index.ts`**:
  - Remove module-level `const MAJORITY_BONUS_MULTIPLIER = 10` and `const MINORITY_BONUS_MULTIPLIER = 5`.
  - Update `getBonuses(chainName, size, bonusTier)` to accept the tier as a third argument and return values for each tier.
  - For `flat`: the function returns a `flatPool` value. All callers split `flatPool` equally across every player who holds at least 1 share of the chain.
  - Apply the same logic to the end-of-game score calculation.
- [x] **`src/utils/gameLogic.ts`**:
  - Update `getBonuses` with the same three-tier logic.
  - Update `calculateFinalScores` to handle flat distribution.
  - `GameState` carries `bonusTier: 'standard' | 'flat' | 'aggressive'` populated at init from `rules_snapshot`.

#### Test Cases

In `src/utils/gameLogic.test.ts`:
- [x] `getBonuses` with `standard` returns `{ majority: price * 10, minority: price * 5 }`.
- [x] `getBonuses` with `aggressive` returns `{ majority: price * 15, minority: price * 5 }`.
- [x] Flat distribution with 3 stockholders gives each player `Math.floor((majority + minority) / 3)`.
- [x] `calculateFinalScores` pays out correctly under all three tiers.
- [x] With one stockholder, all three tiers pay the full combined bonus to that player.

#### Dependencies

- STORY 0, STORY 1, STORY 2

---

### STORY 7 — Board Size

**As a** room creator,
**I want** to choose between a standard 9x12 or a smaller 6x10 board,
**so that** I can play a faster, more intense game when desired.

#### Acceptance Criteria

- [x] When `boardSize = "9x12"` (default), the board is 9 rows × 12 columns (A-L), 108 tiles — identical to current behaviour.
- [x] When `boardSize = "6x10"`, the board is 6 rows × 10 columns (A-J), 60 tiles.
- [x] `generateAllTiles` accepts board dimensions and produces the correct tile set.
- [x] `getAdjacentTiles` respects board boundaries dynamically — no hard-coded `row < 9` or `colIndex < 11`.
- [x] `GameBoard.tsx` renders the correct grid for the chosen board size.
- [x] The tile bag contains only tiles valid for the chosen board.
- [x] **Inter-rule coupling**: when `boardSize = "6x10"` and `chainFoundingEnabled = true`, `maxChains` is automatically set to `"5"` in the UI (and enforced at game init in the edge function). See Story 8.

#### Implementation Tasks

- [x] **`src/types/game.ts`**: Add `boardRows: number` and `boardCols: string[]` to `GameState`.
- [x] **`src/utils/gameLogic.ts`**:
  - Update `generateAllTiles(rows?: number, cols?: number)` (default 9, 12).
  - Update `getAdjacentTiles(tileId, boardRows, boardCols)` with dynamic boundary checks.
  - Update `initializeGame` to derive `boardRows`/`boardCols` from `customRules.boardSize`.
- [x] **`supabase/functions/game-action/index.ts`**:
  - Apply identical changes to `generateAllTiles`, `getAdjacentTiles`, and `parseTileId`.
  - Derive and store `boardRows`/`boardCols` in `rules_snapshot` at game start.
  - On every action that checks adjacency, read board dimensions from `rules_snapshot`.
- [x] **`src/components/game/GameBoard.tsx`**: Replace `const COLS` and `const ROWS` literals with values from `gameState.boardCols` and `gameState.boardRows`.

#### Test Cases

In `src/utils/gameLogic.test.ts`:
- [x] `generateAllTiles(9, 12)` returns exactly 108 unique tiles.
- [x] `generateAllTiles(6, 10)` returns exactly 60 unique tiles.
- [x] `generateAllTiles(6, 10)` contains no tile with row > 6 or column after J.
- [x] `getAdjacentTiles('1A', 6, 10)` returns only `['2A', '1B']`.
- [x] `getAdjacentTiles('6J', 6, 10)` returns only `['5J', '6I']`.
- [x] `initializeGame` with `boardSize = "6x10"` produces a tile bag of 60 tiles.

#### Dependencies

- STORY 0, STORY 1, STORY 2
- **Inter-rule coupling with STORY 8**: implement the `boardSize → maxChains` default logic together with Story 8.

---

### STORY 8 — Chain Founding Rules (Max Chains)

**As a** room creator,
**I want** to limit the number of hotel chains that can be founded,
**so that** I can force earlier and more frequent mergers.

#### Acceptance Criteria

- [x] When `maxChains = "5"`, only the 5 eligible chains (sackson, tower, worldwide, american, continental) can be founded. The other 2 (festival, imperial) never appear as founding options.
- [x] When `maxChains = "6"`, only the 6 eligible chains (sackson, tower, worldwide, american, continental, imperial) can be founded. Festival is excluded.
- [x] When `maxChains = "7"` (default), all chains are eligible.
- [x] `getAvailableChainsForFoundation` only returns chains from the eligible set that are not yet active.
- [x] When all eligible chains are active, a tile that would ordinarily found a new chain is treated as **unplayable** via the existing unplayable-tile logic: if the player has another playable tile they must use it; if no tile is playable, they discard and redraw.
- [x] The founder always receives 1 free stock — this is not configurable.
- [x] **Board size coupling**: when `boardSize = "6x10"` is selected in the UI, `maxChains` defaults to `"5"`. The edge function enforces this coupling at game init regardless of what the UI sent.

#### Implementation Tasks

- [x] **`src/types/game.ts`**: Add `maxChains: number` and `eligibleChains: ChainName[]` to `GameState`. Populated at init.
- [x] **Define the eligible chain sets** as a constant in both `src/types/game.ts` and the edge function:
  ```
  ELIGIBLE_CHAINS_5 = ['sackson', 'tower', 'worldwide', 'american', 'continental']
  ELIGIBLE_CHAINS_6 = ['sackson', 'tower', 'worldwide', 'american', 'continental', 'imperial']
  ELIGIBLE_CHAINS_7 = all 7 chains
  ```
- [x] **`src/utils/gameLogic.ts`**:
  - Update `getAvailableChainsForFoundation(state)` to filter by `state.eligibleChains` (not just `isActive`).
  - Update `analyzeTilePlacement` so that a tile creating a new chain when all `eligibleChains` are already active results in `valid: false`.
- [x] **`supabase/functions/game-action/index.ts`**:
  - Apply identical changes to `foundChain`, `getAvailableChainsForFoundation`, and tile analysis.
  - At game init: apply board-size coupling — if `rules.boardSize === '6x10'` and `rules.chainFoundingEnabled` and `rules.maxChains === '7'`, override `maxChains` to `5`.
  - Store `eligibleChains` in `rules_snapshot`.
- [x] **`src/components/game/OnlineLobby.tsx`**: When `boardSize` changes to `"6x10"`, automatically set `draftRules.maxChains` to `"5"` (only if `chainFoundingEnabled` is true or if the user subsequently enables it).

#### Test Cases

In `src/utils/gameLogic.test.ts`:
- [x] `getAvailableChainsForFoundation` with `eligibleChains = ELIGIBLE_CHAINS_5` never returns festival or imperial.
- [x] `getAvailableChainsForFoundation` returns 0 options when all 5 eligible chains (maxChains = 5) are active.
- [x] `analyzeTilePlacement` marks a tile as unplayable when it would found a chain but all eligible chains are already active.
- [x] `foundChain` always grants 1 free stock (regression — verifies it is unconditional).
- [x] `getAvailableChainsForFoundation` with `eligibleChains = ELIGIBLE_CHAINS_6` never returns festival.

#### Dependencies

- STORY 0, STORY 1, STORY 2
- **Inter-rule coupling with STORY 7**: implement the `boardSize → maxChains` default together with Story 7.

---

### STORY 9 — Starting Conditions

**As a** room creator,
**I want** to configure how much cash and how many tiles each player starts with, and whether an initial tile is pre-placed,
**so that** I can adjust the pacing and economy of the early game.

#### Acceptance Criteria

- [x] When `startingCash = "4000"`, each player starts with $4,000.
- [x] When `startingCash = "6000"` (default), each player starts with $6,000 — existing behaviour.
- [x] When `startingCash = "8000"`, each player starts with $8,000.
- [x] When `startingTiles = "5"`, each player receives 5 tiles; `"6"` gives 6 (default); `"7"` gives 7.
- [x] When `startWithTileOnBoard = true` (default), one random tile is placed on the board before tiles are dealt.
- [x] When `startWithTileOnBoard = false`, the board starts completely empty.
- [x] All values are applied in both the edge function's game init handler and the frontend's `initializeGame`.

#### Implementation Tasks

- [x] **`supabase/functions/game-action/index.ts` — `toggle_ready` / `start_game` handler**:
  - Replace hardcoded `cash: 6000` with `parseInt(rules.startingCash)`.
  - Replace hardcoded `tileBag.splice(0, 6)` with `tileBag.splice(0, parseInt(rules.startingTiles))`.
  - Make starting-tile placement conditional on `rules.startWithTileOnBoard`.
  - Ensure the `game_players` update uses the rule-derived cash value, not the DB column default.
- [x] **`src/utils/gameLogic.ts` — `initializeGame`**:
  - Accept an optional `rules: CustomRules` parameter (default to `DEFAULT_RULES`).
  - Apply `startingCash`, `startingTiles`, and `startWithTileOnBoard` from the rules object.
  - Existing calls with no `rules` argument continue to work unchanged.

#### Test Cases

In `src/utils/gameLogic.test.ts`:
- [x] `initializeGame` with `startingCash = "4000"` gives each player $4,000.
- [x] `initializeGame` with `startingCash = "8000"` gives each player $8,000.
- [x] `initializeGame` with `startingTiles = "5"` gives each player exactly 5 tiles.
- [x] `initializeGame` with `startingTiles = "7"` gives each player exactly 7 tiles.
- [x] `initializeGame` with `startWithTileOnBoard = false` results in zero tiles with `placed: true`.
- [x] `initializeGame` with `startWithTileOnBoard = true` results in exactly 1 tile with `placed: true`.
- [x] `initializeGame` with no `rules` argument behaves identically to current behaviour (regression).

#### Dependencies

- STORY 0, STORY 1, STORY 2

---

## Test File Index

| Test file | New or existing | What it covers |
|---|---|---|
| `src/utils/gameLogic.test.ts` | Existing — extend | `initializeGame`, `foundChain`, `growChain`, `getBonuses`, `calculateFinalScores`, `getAvailableChainsForFoundation`, `generateAllTiles`, `getAdjacentTiles`, `endTurn`, `DEFAULT_RULES` validation |
| `src/utils/multiplayerService.test.ts` | Existing — extend | `createRoom` with `customRules`, `fetchRoomRules`, DB payload verification |
| `src/components/game/TurnTimer.test.tsx` | New | Timer countdown, expiry callback, inactive state, reset on new turn |
| `src/components/game/PlayerCard.test.tsx` | New | Cash visibility modes: hidden, visible, aggregate |