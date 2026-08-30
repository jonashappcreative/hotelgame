# Security Audit Report

**Application:** Acquire Online (aquire02)
**Date:** 2026-02-20
**Auditor:** Senior Security Engineer (Claude)
**Scope:** Full codebase audit including frontend (React/Vite), backend (Supabase Edge Functions), database (PostgreSQL/Supabase), and infrastructure configuration.
**Remediation Branch:** `fix/security-audit-remediation`

---

## Executive Summary (TLDR)

- **All 13 original findings have been successfully remediated** and verified against the current code on `fix/security-audit-remediation`.
- **2 new High-severity business logic flaws discovered and fixed:** missing game phase validation (HIGH-005) and client-controlled merger chain adjacency (HIGH-006) — both remediated in this pass.
- **1 Medium finding fixed:** `update_room_status` now validates status against an explicit allowlist (MED-007). One Medium remains: tile draw order transmitted via Realtime WebSocket (MED-006, architectural — requires Supabase Realtime config changes).
- **3 of 5 Low findings fixed:** generic error messages (LOW-005), `end_game_vote` phase guard (LOW-006), player name DB constraint (LOW-009). Two Lows remain as accepted-risk architectural trade-offs: anonymous session rate-limit bypass (LOW-007) and auth tokens in localStorage (LOW-008).
- **Overall risk level: Low** (post this remediation pass).

---

## Risk Overview

| | Original Audit | Post-Remediation | Re-Audit (New) | Net Remaining |
|---|---|---|---|---|
| **Critical** | 1 | 0 ✅ | 0 | **0** |
| **High** | 4 | 0 ✅ | 2 → 0 ✅ | **0** |
| **Medium** | 5 | 0 ✅ | 2 → 1 🟠 | **1** |
| **Low** | 4 | 0 ✅ | 5 → 2 🟡 | **2** |
| **Overall Risk** | High | Low | — | **Low** |

---

## ✅ Remediation Verification — All Original Findings Confirmed Fixed

The following were all verified by direct code inspection of the current branch.

| ID | Issue | Status | Verified At |
|---|---|---|---|
| CRITICAL-001 | `.env` files committed to git | ✅ FIXED | Git status shows `D .env` and `D .env.local` (removed from index) |
| HIGH-001 | Overly permissive RLS on `game_states` | ✅ FIXED | `20260220_security_audit_fixes.sql` — service_role + room-participant policies |
| HIGH-002 | `discard_tile` missing turn check | ✅ FIXED | `index.ts:1505-1511` — `current_player_index !== myPlayerIndex` → 403 |
| HIGH-003 | `update_room_status` no auth check | ✅ FIXED | `index.ts:1639-1643` — `myPlayerIndex !== 0` → 403 |
| HIGH-004 | Name-based rejoin account takeover | ✅ FIXED | `multiplayerService.ts:271-274` — name-based rejoin removed entirely |
| MED-001 | CORS wildcard on edge function | ✅ FIXED | `index.ts:4-18` — `ALLOWED_ORIGINS` whitelist with `getCorsHeaders()` |
| MED-002 | No rate limiting on room creation | ✅ FIXED | `20260220_security_audit_fixes.sql:45-73` — trigger limits 5 active rooms/user |
| MED-003 | Missing security headers | ✅ FIXED | `netlify.toml:32-37` — CSP, HSTS, X-Frame-Options, Permissions-Policy |
| MED-004 | Insufficient stock purchase validation | ✅ FIXED | `index.ts:1311-1352` — quantity ≤ 3, chain active, bank availability |
| MED-005 | Weak password policy (6 chars) | ✅ FIXED | `Auth.tsx:13-20` — 8 chars min, lowercase, uppercase, number required |
| LOW-001 | `dangerouslySetInnerHTML` in Tutorial | ✅ FIXED | `TutorialTooltip.tsx:56-64` — safe `renderBoldLine()` JSX rendering |
| LOW-002 | Console logging in production | ✅ FIXED | `vite.config.ts:21` — `esbuild.drop: ["console", "debugger"]` for production |
| LOW-003 | Dev server binds to all interfaces | ✅ FIXED | `vite.config.ts:10` — `host: "localhost"` |

One previous open item remains a **manual/operational step**:
- [ ] `git-filter-repo` to scrub `.env` credentials from git history (only relevant if repository is or becomes public)
- [ ] Supabase dashboard auth settings should enforce the same password policy as `Auth.tsx`

---

## 🔴 New High Priority Findings — All Remediated

### [HIGH-005] Missing Game Phase Validation Allows Out-of-Sequence Actions — REMEDIATED

- **Severity:** High
- **Status:** **FIXED**
- **Category:** Business Logic / Authorization
- **Location:** `supabase/functions/game-action/index.ts` — multiple action handlers
- **Description:** Multiple action handlers verify whose turn it is (`current_player_index === myPlayerIndex`) but **do not validate that the game is in the correct phase** for the requested action. The current player can invoke any action at any time, regardless of the game phase. Specifically:
  - `place_tile` (line 627): No check for `phase === 'place_tile'`. The active player can place an additional tile during `buy_stock` phase, corrupting the board.
  - `buy_stocks` (line 1301): No check for `phase === 'buy_stock'`. Active player can buy stocks during `place_tile` phase (before placing a tile this turn).
  - `skip_buy` (line 1427): No check for `phase === 'buy_stock'`. Can be called to end the turn prematurely during any phase.
  - `found_chain` (line 833): No check for `phase === 'found_chain'`.
  - `choose_merger_survivor` (line 941): No check for `phase === 'merger_choose_survivor'`.
  - `pay_merger_bonuses` (line 981): No check for `phase === 'merger_pay_bonuses'`.
  - `merger_stock_choice` (line 1150): No check for `phase === 'merger_handle_stock'`.
- **Impact:** A malicious player can double-place tiles in one turn (gaining board advantage), buy stocks out of turn sequence, or force premature turn advancement — all of which corrupt game state irreparably. This is exploitable without any special access beyond being in the game room.
- **Proof of Concept:**
  ```
  # During 'buy_stock' phase, the current player sends:
  POST /game-action
  { "action": "place_tile", "roomId": "...", "payload": { "tileId": "5F" } }
  # → Accepted. Player places a second tile this turn. Board state is corrupted.
  ```
- **Fix Applied:**
  - [x] `place_tile` — phase guard added (`phase !== 'place_tile'` → 400)
  - [x] `found_chain` — phase guard added (`phase !== 'found_chain'` → 400)
  - [x] `choose_merger_survivor` — phase guard added (`phase !== 'merger_choose_survivor'` → 400)
  - [x] `pay_merger_bonuses` — phase guard added (`phase !== 'merger_pay_bonuses'` → 400)
  - [x] `merger_stock_choice` — phase guard added (`phase !== 'merger_handle_stock'` → 400)
  - [x] `buy_stocks` — phase guard added (`phase !== 'buy_stock'` → 400)
  - [x] `skip_buy` — phase guard added (`phase !== 'buy_stock'` → 400)
- **References:** [CWE-841](https://cwe.mitre.org/data/definitions/841.html) (Improper Enforcement of Behavioral Workflow), [OWASP A04:2021](https://owasp.org/Top10/A04_2021-Insecure_Design/)

---

### [HIGH-006] `choose_merger_survivor` Trusts Client-Provided Chain Adjacency Without Server-Side Recomputation — REMEDIATED

- **Severity:** High
- **Status:** **FIXED**
- **Category:** Business Logic / Input Validation
- **Location:** `supabase/functions/game-action/index.ts:956-967`
- **Description:** The `choose_merger_survivor` action receives `payload.adjacentChains` from the client and uses it directly to determine which chains are involved in the merger and which become defunct:
  ```typescript
  const adjacentChains = payload?.adjacentChains as ChainName[];
  const defunctChains = adjacentChains.filter(c => c !== survivingChain)
    .sort((a, b) => gameState.chains[b].tiles.length - gameState.chains[a].tiles.length);
  ```
  No validation occurs to confirm that the client-provided `adjacentChains` list matches the chains actually adjacent to `gameState.last_placed_tile` on the server-side board. A player can inject chains that were not part of the merger, or omit chains that should be defunct.
- **Impact:** An attacker could:
  1. Omit a large chain from the defunct list, preventing its shareholders from receiving merger bonuses (financial manipulation).
  2. Include a chain that was not adjacent to the merger tile, forcing it to be dissolved incorrectly.
  3. Pass an invalid or null `adjacentChains`, causing `.filter()` to throw an unhandled exception (DoS for that game session).
- **Proof of Concept:**
  ```
  # Real merger: Tower (3 tiles) absorbs Sackson (2 tiles). Player chooses Tower to survive.
  # Malicious payload omits Sackson from defunctChains → Sackson is never dissolved,
  # shareholders receive no bonuses, chain remains "active" with incorrect tile count.
  POST /game-action
  { "action": "choose_merger_survivor", "roomId": "...",
    "payload": { "survivingChain": "tower", "adjacentChains": ["tower"] } }
  ```
- **Fix Applied:**
  - [x] `payload.adjacentChains` is no longer used
  - [x] Adjacent chains recomputed server-side via `getAdjacentTiles(gameState.last_placed_tile, ...)`
  - [x] `survivingChain` validated against server-computed adjacent chains before proceeding
  - [x] `survivingChain` validated against `CHAINS` type guard
  - [x] Returns 400 if `last_placed_tile` is missing
- **References:** [CWE-20](https://cwe.mitre.org/data/definitions/20.html), [CWE-807](https://cwe.mitre.org/data/definitions/807.html), [OWASP A04:2021](https://owasp.org/Top10/A04_2021-Insecure_Design/)

---

## 🟠 New Medium Priority Findings

### [MED-006] Tile Draw Order Transmitted via Realtime WebSocket (Client-Side Filtering Only)

- **Severity:** Medium
- **Category:** Data Protection / Game Integrity
- **Location:** `src/utils/multiplayerService.ts:578-589`, `supabase/migrations/20260220_security_audit_fixes.sql:30-41`
- **Description:** The Supabase Realtime subscription in `subscribeToRoom()` listens to changes on the `game_states` table and receives the **full database row** via WebSocket — including `tile_bag`. The code strips it client-side before passing to components:
  ```typescript
  const { tile_bag, ...publicState } = state;  // client-side strip
  onGameStateChange(publicState);
  ```
  However, the complete row (including `tile_bag`) has **already been transmitted over the WebSocket connection** by the time this stripping occurs. Any player can open their browser DevTools → Network → WS tab and read the raw message to obtain `tile_bag`, which reveals the exact order of all future tile draws.

  The RLS migration (`authenticated_select_game_states_for_realtime`) correctly restricts *direct SQL queries* to room participants only, but Supabase Realtime broadcasts the full row payload to subscribed clients regardless of column-level restrictions. The comment in the migration itself acknowledges this trade-off.
- **Impact:** A player can know exactly which tiles will be drawn next by all players, providing a significant competitive advantage. This is a game integrity violation, not a data breach.
- **Remediation Options (in order of preference):**
  1. **Best:** Move the Realtime subscription to `game_states_public` view (which excludes `tile_bag`). Supabase Realtime can subscribe to views in some configurations. Verify if `game_states_public` view triggers Realtime events.
  2. **Alternative:** Use Supabase Realtime with [row filter + column filter](https://supabase.com/docs/guides/realtime/postgres-changes) to exclude specific columns (available in newer Supabase versions).
  3. **Workaround:** Instead of Realtime on `game_states`, use an edge function polling endpoint that returns only `game_states_public` data — removing `tile_bag` server-side before transmission.
  4. **Mitigation:** Add a server-side hash/checksum of the tile bag so clients can verify game integrity without seeing the sequence.
- **References:** [CWE-319](https://cwe.mitre.org/data/definitions/319.html), [OWASP A02:2021](https://owasp.org/Top10/A02_2021-Cryptographic_Failures/)

---

### [MED-007] `update_room_status` Accepts Arbitrary Status Values Without Enumeration — REMEDIATED

- **Severity:** Medium
- **Status:** **FIXED**
- **Category:** Input Validation / Business Logic
- **Location:** `supabase/functions/game-action/index.ts:1646-1652`
- **Description:** After the host-only authorization check, `update_room_status` writes `payload.status` directly to the database without validating it against an allowed set of values:
  ```typescript
  const newStatus = payload?.status;
  if (newStatus) {
    await adminClient.from('game_rooms').update({ status: newStatus }).eq('id', roomId);
  }
  ```
  A malicious host can set the room status to any arbitrary string (e.g., `"pwned"`, a 10,000-character string, or a value that breaks other parts of the application that compare against `'waiting' | 'playing' | 'finished'`).
- **Impact:** Room status is queried in several places with `in('status', ['waiting', 'playing'])`. Setting an invalid status could soft-lock a room in a permanent non-resolvable state, preventing cleanup and denying service to other players in that room. Severity is limited by the host-only prerequisite.
- **Fix Applied:**
  - [x] `VALID_ROOM_STATUSES = ['waiting', 'playing', 'finished']` allowlist added
  - [x] Missing or invalid status returns 400 before any DB write
- **References:** [CWE-20](https://cwe.mitre.org/data/definitions/20.html)

---

## 🟡 New Low Priority Findings

### [LOW-005] Raw Error Messages Returned to Client (Information Disclosure) — REMEDIATED

- **Severity:** Low
- **Status:** **FIXED**
- **Category:** Information Disclosure / Error Handling
- **Location:** `supabase/functions/game-action/index.ts:1963-1969`
- **Description:** The top-level catch block returns raw error messages directly to the client:
  ```typescript
  } catch (error: unknown) {
    console.error('Edge function error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500, ... });
  }
  ```
  Supabase client SDK errors, Deno runtime errors, and database errors can contain internal details such as table names, column names, constraint names, query structure, or stack traces. Example: a unique constraint violation would return `"duplicate key value violates unique constraint 'game_players_room_id_player_index_key'"`, leaking schema information.
- **Impact:** Aids attackers in fingerprinting the database schema, understanding internal logic, and crafting more targeted attacks. Low severity in isolation but compounds other vulnerabilities.
- **Fix Applied:**
  - [x] Catch block returns `'An internal error occurred'` — no raw error message exposed
  - [x] Full error continues to be logged via `console.error` server-side
- **References:** [CWE-209](https://cwe.mitre.org/data/definitions/209.html), [OWASP A05:2021](https://owasp.org/Top10/A05_2021-Security_Misconfiguration/)

---

### [LOW-006] `end_game_vote` Lacks Game Phase Validation — REMEDIATED

- **Severity:** Low
- **Status:** **FIXED**
- **Category:** Business Logic
- **Location:** `supabase/functions/game-action/index.ts:1570-1612`
- **Description:** The `end_game_vote` action has no check that the game is in an appropriate phase for voting. It can be triggered during `merger_pay_bonuses`, `found_chain`, or any other mid-action phase, potentially forcing an abrupt game end mid-merger or mid-chain-founding with partial state updates already committed.
- **Impact:** In the worst case, a majority vote during `merger_pay_bonuses` could set `phase: 'game_over'` while the merger's `merger` object is still non-null and some players haven't received bonuses. This creates corrupted terminal game state. The majority vote requirement (ceil(N/2)) reduces exploitability — at least half the players must be complicit.
- **Fix Applied:**
  - [x] Voting only permitted during `place_tile` or `buy_stock` phases
  - [x] Votes during merger or chain-founding phases return 400
- **References:** [CWE-841](https://cwe.mitre.org/data/definitions/841.html)

---

### [LOW-007] Rate Limiting Bypassable via New Anonymous Sessions

- **Severity:** Low
- **Category:** Abuse Prevention
- **Location:** `supabase/migrations/20260220_security_audit_fixes.sql:45-73`, `src/utils/multiplayerService.ts:15`
- **Description:** The room creation rate limit trigger (`check_room_creation_limit`) uses `auth.uid()` to identify the user. The application creates anonymous Supabase sessions (`supabase.auth.signInAnonymously()`) for unauthenticated players. Each browser session gets a unique anonymous user ID. A malicious actor can bypass the 5-room limit by:
  1. Creating 5 rooms anonymously.
  2. Clearing `localStorage` (where the Supabase session token is stored).
  3. Refreshing — a new anonymous session with a new UUID is created.
  4. Repeating to create unlimited rooms.
- **Impact:** Moderate — room spam is possible. Each room requires at least one other player to do game harm, so this is primarily an infrastructure/denial-of-service concern. Authenticated (non-anonymous) users cannot bypass the limit.
- **Remediation:**
  - Implement IP-based rate limiting at the Netlify edge (via Netlify rate limiting rules or a CDN WAF) as a secondary layer.
  - Consider requiring email verification before room creation is permitted.
  - Add a global rate limit on `game_rooms` INSERT operations per IP at the database or Netlify level.
- **References:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html)

---

### [LOW-008] Supabase Auth Tokens Stored in localStorage (XSS Token Theft Risk)

- **Severity:** Low
- **Category:** Session Management / Data Protection
- **Location:** `src/integrations/supabase/client.ts:11-16`
- **Description:** The Supabase client is explicitly configured with `storage: localStorage`:
  ```typescript
  export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { storage: localStorage, persistSession: true, autoRefreshToken: true }
  });
  ```
  JWT access tokens and refresh tokens are stored in `localStorage`, which is accessible to any JavaScript running on the page. If an XSS attack were to succeed (despite the current CSP), tokens could be exfiltrated to steal the user's session.
- **Impact:** Low given the current restrictive CSP (`script-src 'self'`) that blocks external scripts. However, `style-src 'unsafe-inline'` is permitted, and some advanced CSS injection attacks can exfiltrate data. If CSP is ever loosened, this becomes High.
- **Remediation:**
  - The safest option is to use `sessionStorage` instead of `localStorage` (shorter-lived, tab-scoped). However, this breaks the reconnection flow that relies on session persistence.
  - As a defense-in-depth measure, keep the CSP restrictive (`script-src 'self'` only) to prevent the class of attacks that would exploit this.
  - Document the explicit decision to use localStorage as an accepted risk trade-off against the reconnection UX requirement.
- **References:** [CWE-922](https://cwe.mitre.org/data/definitions/922.html), [OWASP A07:2021](https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/)

---

### [LOW-009] No Server-Side Player Name Length Validation — REMEDIATED

- **Severity:** Low
- **Status:** **FIXED**
- **Category:** Input Validation
- **Location:** `src/utils/multiplayerService.ts:307-316` (joinRoom insert), `supabase/functions/game-action/index.ts` (game log uses `playerData.player_name`)
- **Description:** When joining a room, `player_name` is inserted into `game_players` without any server-side length or content validation. The frontend form uses `maxLength={20}` for the display name, but `joinRoom()` accepts the `playerName` parameter from its caller with no sanitization. The player name is also embedded in `game_log` JSON entries (e.g., `playerName: playerData.player_name`) stored in the database. There is no visible `CHECK` constraint on the `player_name` column in any migration.
- **Impact:** A crafted API call (bypassing the frontend) could insert a player name of arbitrary length, potentially causing oversized `game_log` JSONB entries or UI layout breakage. Not an injection risk since names are stored as text and rendered via React (which escapes HTML). Exploiting this requires bypassing the frontend entirely.
- **Fix Applied:**
  - [x] `supabase/migrations/20260221_player_name_constraint.sql` — `CHECK (char_length(player_name) BETWEEN 1 AND 30)` added at DB level
- **References:** [CWE-20](https://cwe.mitre.org/data/definitions/20.html)

---

## User Stories for Remediation

### High Priority Items (New)

- **US-SEC-011:** As a developer, I need to add game phase validation to all edge function action handlers so that players cannot invoke actions out of sequence.
  - Acceptance Criteria:
    - [ ] `place_tile` validates `phase === 'place_tile'`
    - [ ] `buy_stocks` and `skip_buy` validate `phase === 'buy_stock'`
    - [ ] `found_chain` validates `phase === 'found_chain'`
    - [ ] `choose_merger_survivor` validates `phase === 'merger_choose_survivor'`
    - [ ] `pay_merger_bonuses` validates `phase === 'merger_pay_bonuses'`
    - [ ] `merger_stock_choice` validates `phase === 'merger_handle_stock'`
    - [ ] All phase mismatches return HTTP 400 with descriptive error

- **US-SEC-012:** As a developer, I need to recompute merger-adjacent chains server-side in `choose_merger_survivor` so that the server does not trust client-provided chain data.
  - Acceptance Criteria:
    - [ ] `adjacentChains` from the client payload is ignored
    - [ ] Server recomputes adjacent chains from `gameState.last_placed_tile` and `gameState.board`
    - [ ] `survivingChain` is validated to be one of the server-computed adjacent chains
    - [ ] Null/non-array payload returns HTTP 400
    - [ ] Existing merger resolution logic continues to function correctly

### Medium Priority Items (New)

- **US-SEC-013:** As a developer, I need to prevent the full `tile_bag` from being transmitted via Realtime WebSocket so that players cannot discover future tile draws from network traffic.
  - Acceptance Criteria:
    - [ ] `tile_bag` is not present in any Realtime WebSocket payload received by clients
    - [ ] Game state updates (board, chains, phase) still arrive in real time
    - [ ] Existing reconnection and subscription logic continues to function

- **US-SEC-014:** As a developer, I need to validate the `status` value in `update_room_status` against an allowlist so that hosts cannot set arbitrary room status values.
  - Acceptance Criteria:
    - [ ] Only `'waiting'`, `'playing'`, `'finished'` are accepted
    - [ ] Invalid values return HTTP 400
    - [ ] Legitimate status transitions continue to work

### Low Priority Items (New)

- **US-SEC-015:** As a developer, I need to sanitize error messages returned from the edge function so that internal implementation details are not leaked to clients.
  - Acceptance Criteria:
    - [ ] All 500 responses return a generic message ("An internal error occurred")
    - [ ] Full error details continue to be logged server-side (console.error)
    - [ ] Explicit application errors (400, 403) retain descriptive messages

- **US-SEC-016:** As a developer, I need to add a phase guard to `end_game_vote` so that early-end votes cannot be cast during mid-action phases.
  - Acceptance Criteria:
    - [ ] Votes are only accepted during `place_tile` or `buy_stock` phase
    - [ ] Votes during merger or chain-founding phases return HTTP 400

- **US-SEC-017:** As a developer, I need to add a database-level `CHECK` constraint on `player_name` length to enforce server-side validation.
  - Acceptance Criteria:
    - [ ] `player_name` length is between 1 and 30 characters at the database level
    - [ ] Attempts to insert longer names fail with a clear error

---

## Previous User Stories (All Completed)

### Critical Items

- **US-SEC-001:** Remove `.env` and `.env.local` from git tracking.
  - [x] `git rm --cached .env .env.local` executed
  - [x] `.gitignore` patterns prevent re-addition
  - [ ] Git history cleaned with `git-filter-repo` (recommended if repo goes public)

### High Priority Items

- **US-SEC-002:** Restrict `game_states` table SELECT access. — [x] Completed
- **US-SEC-003:** Add turn verification to `discard_tile`. — [x] Completed
- **US-SEC-004:** Add host-only authorization to `update_room_status`. — [x] Completed
- **US-SEC-005:** Fix name-based rejoin mechanism. — [x] Completed

### Medium Priority Items

- **US-SEC-006:** Restrict CORS origins on the edge function. — [x] Completed
- **US-SEC-007:** Add rate limiting for room creation. — [x] Completed
- **US-SEC-008:** Add CSP, HSTS, and Permissions-Policy headers. — [x] Completed
- **US-SEC-009:** Add complete server-side validation for stock purchases. — [x] Completed
- **US-SEC-010:** Strengthen the password policy.
  - [x] Minimum 8 characters required
  - [x] Complexity requirements enforced (lowercase, uppercase, number)
  - [ ] Supabase auth dashboard settings should be updated to match (manual step)

---

## Quick Wins (Remaining)

1. **Add status allowlist to `update_room_status`** — 3 lines of code, eliminates MED-007.
2. **Add generic error message to catch block** — 1 line change in edge function, fixes LOW-005.
3. **Add phase guards to `buy_stocks`, `skip_buy`, `place_tile`** — ~15 lines, covers the most exploitable phase gaps first.
4. **Add `CHECK` constraint to `player_name`** — one migration line, fixes LOW-009.
5. **Add phase guard to `end_game_vote`** — 4 lines, fixes LOW-006.

---

## Recommended Security Improvements

1. **Complete Phase Validation (HIGH-005):** Systematically add `phase` guards to all action handlers. This is the highest-priority remaining work.

2. **Server-Side Merger Chain Recomputation (HIGH-006):** The `getAdjacentTiles()` helper already exists in the edge function — use it to recompute adjacent chains from the board rather than trusting the client.

3. **Solve tile_bag Realtime Exposure (MED-006):** Investigate Supabase Realtime column filtering or subscribe to `game_states_public` view. If Realtime doesn't support column exclusion on this Supabase version, document this as an accepted risk and add a note in the game FAQ that the tile bag sequence is technically observable.

4. **Implement Game Activity Audit Log:** Log all game actions with timestamps and user IDs to a dedicated `game_audit_log` table using the service role. This enables detection of anomalous patterns (e.g., a player consistently playing out-of-phase actions).

5. **Add Automated SAST to CI/CD:** Integrate Semgrep or ESLint security plugin into the build pipeline to catch new phase-validation gaps as they're introduced.

6. **Consider Moving to Cookie-Based Auth Storage:** If a future version moves to SSR or adds more sensitive features, switch from `localStorage` to `httpOnly` cookie-based session management to eliminate the token-theft risk (LOW-008).

7. **Add IP-Based Rate Limiting at the Edge:** Netlify supports rate limiting rules. A global cap of e.g. 10 room-creation requests per IP per hour would significantly raise the bar for the anonymous session bypass (LOW-007).

---

## Security Tools Recommendation

| Category | Tool | Purpose |
|----------|------|---------|
| SAST | [Semgrep](https://semgrep.dev/) | Static analysis for TypeScript/JavaScript security patterns |
| SAST | [ESLint Security Plugin](https://github.com/eslint-community/eslint-plugin-security) | Detect common security anti-patterns in JS/TS |
| Dependency Scanning | [npm audit](https://docs.npmjs.com/cli/v8/commands/npm-audit) | Check for known CVEs in dependencies |
| Dependency Scanning | [Snyk](https://snyk.io/) | Continuous dependency vulnerability monitoring |
| Secret Scanning | [gitleaks](https://github.com/gitleaks/gitleaks) | Detect secrets committed to git history |
| Secret Scanning | [trufflehog](https://github.com/trufflesecurity/trufflehog) | Deep git history secret scanning |
| DAST | [OWASP ZAP](https://www.zaproxy.org/) | Dynamic application security testing |
| Headers | [SecurityHeaders.com](https://securityheaders.com/) | Verify HTTP security headers |
| CSP | [CSP Evaluator](https://csp-evaluator.withgoogle.com/) | Evaluate Content Security Policy |
| Supabase | [Supabase CLI](https://supabase.com/docs/guides/cli) `supabase inspect db policies` | Audit RLS policies |

---

## References & Resources

- [OWASP Top 10 (2021)](https://owasp.org/Top10/)
- [CWE Top 25 Most Dangerous Software Weaknesses](https://cwe.mitre.org/top25/archive/2023/2023_top25_list.html)
- [Supabase Security Best Practices](https://supabase.com/docs/guides/auth/row-level-security)
- [Supabase RLS Guide](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [NIST Password Guidelines (SP 800-63B)](https://pages.nist.gov/800-63-3/sp800-63b.html)
- [MDN Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Vite Security Considerations](https://vitejs.dev/guide/env-and-mode.html#env-files)

---

## Files Modified in Original Remediation

| File | Changes |
|------|---------|
| `supabase/migrations/20260220_security_audit_fixes.sql` | **NEW** — RLS policy tightening + room creation rate limit trigger |
| `supabase/functions/game-action/index.ts` | CORS origin restriction, `discard_tile` turn check, `update_room_status` host check, `buy_stocks` validation |
| `src/utils/multiplayerService.ts` | Removed insecure name-based rejoin path |
| `src/pages/Auth.tsx` | Strengthened password policy (8 chars, uppercase, lowercase, number) |
| `src/components/Tutorial/TutorialTooltip.tsx` | Replaced `dangerouslySetInnerHTML` with safe JSX rendering |
| `vite.config.ts` | Production console stripping, dev server bound to localhost |
| `netlify.toml` | Added CSP, HSTS, Permissions-Policy headers |
| `.env`, `.env.local` | Removed from git tracking |
| `VITE_SUPABASE_URL=https:` | Deleted stale directory |
