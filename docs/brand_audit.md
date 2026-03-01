# Brand Audit: Acquire Game — IP & Naming Review

**Date:** February 2026
**Purpose:** Document all references to "Acquire" and hotel chain names to ensure this implementation operates as an "Acquire-inspired" game without copying IP-protected names or mechanics that would violate intellectual property rights.

---

## Executive Summary

This audit documents:
1. All references to the "Acquire" brand name in the codebase
2. All 7 hotel chain names and their properties
3. Game mechanics and how they differ from the original Acquire game
4. Tutorial documentation that references the brand
5. Recommendations for ensuring legal compliance

**Finding:** The game uses the exact name "Acquire" throughout the codebase and documentation. The hotel chain names (Continental, Imperial, Worldwide, American, Festival, Sackson, Tower) match the original Acquire board game. Custom rules have been implemented that modify core gameplay mechanics.

---

## 1. Game Name References

### Location 1.1: README.md
- **File:** `/README.md` (lines 1, 5-7)
- **Content:**
  - Title: `# Acquire - Online Board Game`
  - Description: `A digital implementation of the classic Acquire board game...`
  - Paragraph: `Acquire is a strategic hotel chain building game...`
- **Status:** ⚠️ CRITICAL - Direct use of trademarked name

### Location 1.2: index.html
- **File:** `/index.html` (line 6-7)
- **Content:** `<title>Lovable App</title>` (NOT SET - needs branding)
- **Note:** Meta tags have placeholder text ("Lovable App")
- **Status:** ⚠️ NEEDS UPDATE - Currently unbranded placeholder

### Location 1.3: Game Pages
- **File:** `/src/pages/Index.tsx` (line 91)
- **Content:** `<h1 className="text-4xl font-bold tracking-tight mb-2">Acquire</h1>`
- **Context:** Main landing page heading, positioned as the game title
- **Status:** ⚠️ CRITICAL - Direct brand name on main UI

### Location 1.4: Online Lobby
- **File:** `/src/components/game/OnlineLobby.tsx`
- **Content:** `<CardTitle className="text-3xl font-bold">Acquire</CardTitle>`
- **Context:** Online game lobby heading
- **Status:** ⚠️ CRITICAL - Direct brand name on game interface

### Location 1.5: Game Container
- **File:** `/src/components/game/GameContainer.tsx`
- **Content:** `<h1 className="text-2xl lg:text-3xl font-bold tracking-tight">Acquire</h1>`
- **Context:** Header displayed during active gameplay
- **Status:** ⚠️ CRITICAL - Direct brand name during gameplay

### Location 1.6: Game Types Comment
- **File:** `/src/types/game.ts` (line 1)
- **Content:** `// Core game types for Acquire`
- **Status:** ℹ️ Internal documentation (lower visibility)

---

## 2. Hotel Chain Names & Properties

### Overview
The game implements exactly 7 hotel chains organized into three price tiers. **All names match the original Acquire board game.**

### Complete Hotel Chain Inventory

#### BUDGET TIER (Least Expensive)

| Display Name | Internal ID | Color | RGB/HSL | Text Color | File Location |
|---|---|---|---|---|---|
| Sackson | `sackson` | Orange | `hsl(25, 95%, 53%)` | White | `/src/types/game.ts` line 125 |
| Tower | `tower` | Yellow | `hsl(45, 93%, 47%)` | Black | `/src/types/game.ts` line 126 |

**Notes:**
- Sackson appears first in internal listings (primary budget chain)
- Tower is second budget chain
- Price bracket: $200-900 depending on size

#### MIDRANGE TIER (Medium Price)

| Display Name | Internal ID | Color | RGB/HSL | Text Color | File Location |
|---|---|---|---|---|---|
| Worldwide | `worldwide` | Purple | `hsl(280, 67%, 60%)` | White | `/src/types/game.ts` line 127 |
| American | `american` | Blue | `hsl(217, 91%, 60%)` | White | `/src/types/game.ts` line 128 |
| Festival | `festival` | Green | `hsl(142, 71%, 45%)` | White | `/src/types/game.ts` line 129 |

**Notes:**
- Festival can be excluded when max chains is limited to 5 or 6
- Price bracket: $300-1000 depending on size

#### PREMIUM TIER (Most Expensive)

| Display Name | Internal ID | Color | RGB/HSL | Text Color | File Location |
|---|---|---|---|---|---|
| Continental | `continental` | Red | `hsl(0, 84%, 60%)` | White | `/src/types/game.ts` line 130 |
| Imperial | `imperial` | Pink | `hsl(330, 81%, 60%)` | White | `/src/types/game.ts` line 131 |

**Notes:**
- Imperial can be excluded when max chains is limited to 5
- Price bracket: $400-1100 depending on size

### Chain Data Structure Definition
- **File:** `/src/types/game.ts` (lines 124-132)
- **Type:** `ChainInfo` interface with fields:
  - `name`: ChainName (type union of all 7 hotel names)
  - `displayName`: string (capitalized name shown to players)
  - `tier`: ChainTier ('budget' | 'midrange' | 'premium')
  - `color`: HSL string for visual rendering
  - `textColor`: Color for contrast on chain tiles

### Chain References in Game Logic
- **File:** `/src/utils/gameLogic.ts` (lines 199-207)
- **Type:** Initialization of all 7 chains in game state
- **Initialize:** Each chain created with `{ name, tiles: [], isActive: false, isSafe: false }`
- **Stock Bank:** 25 stocks available per chain

### Hotel Names in Tutorial

#### Tutorial Step 10: "The 7 Hotel Chains"
- **File:** `/src/components/Tutorial/tutorialSteps.ts` (lines 159-179)
- **Content:**
  ```
  💎 **PREMIUM** (Most expensive)
  • Continental (Red)
  • Imperial (Pink)

  💼 **MID-RANGE**
  • Worldwide (Purple)
  • American (Blue)
  • Festival (Green)

  💵 **BUDGET** (Least expensive)
  • Sackson (Orange) ← You founded this one!
  • Tower (Yellow)
  ```
- **Status:** ⚠️ EXPLICIT - Directly lists all 7 hotel names by tier

#### Tutorial Step 8: Chain Selection
- **File:** `/src/components/Tutorial/tutorialSteps.ts` (line 132)
- **Content:** Tutorial asks player to select **"Sackson"** as first chain
- **Status:** ℹ️ Uses specific hotel name in interactive tutorial

#### Tutorial Steps 9, 23, 24: General References
- Multiple references to founding/building "chains" in tutorial (no specific names)

---

## 3. Game Mechanics & Differences from Original Acquire

### Standard Rules (Matching Original Acquire)
The following core mechanics are implemented as per the original game:

| Mechanic | Value | Configurable |
|---|---|---|
| Board Size | 9 rows × 12 columns (A-L) | Yes* |
| Players | 4 required | No |
| Starting Cash | $6,000 per player | Yes** |
| Starting Hand | 6 tiles per player | Yes** |
| Max Stocks per Turn | 3 stocks | No |
| Stocks per Chain | 25 shares total | No |
| Safe Chain Size | 11+ tiles (default) | Yes* |
| End Game Trigger | Any chain reaches 41+ tiles | No |
| Majority Bonus | 10× stock price | Yes* |
| Minority Bonus | 5× stock price | Yes* |
| Founder's Bonus | 1 free stock (non-configurable) | No |
| Turn Sequence | Place tile → Buy stocks → Draw tile | No |

**\* = Configurable via custom rules**
**\*\* = Starting Conditions rule (Story 9)**

### Custom Rule Variations (Acquire-Inspired Modifications)

These rules are OPTIONAL and represent deviations from the original Acquire game:

#### Rule 1: Turn Timer (Optional)
- **Enabled by:** `turnTimerEnabled` flag
- **Default:** Disabled
- **Options:** 30, 60, or 90 seconds per turn
- **Effect:** Auto-ends turn with deterministic AI placement
- **File:** `/src/types/game.ts` lines 150-151

#### Rule 2: Bonus Tier Options (Optional)
- **Enabled by:** `bonusTierEnabled` flag
- **Options:**
  - `"standard"`: 10× majority / 5× minority (original Acquire)
  - `"flat"`: Equal payout to all stockholders
  - `"aggressive"`: 15× majority / 5× minority
- **File:** `/src/types/game.ts` line 90
- **Implementation:** `/src/utils/gameLogic.ts` lines 89-100
- **Status:** Changes core economic balance

#### Rule 3: Board Size Variation (Optional)
- **Enabled by:** `boardSizeEnabled` flag
- **Options:**
  - `"9x12"`: Standard board (original)
  - `"6x10"`: Faster/smaller board
- **File:** `/src/types/game.ts` line 159
- **Impact:** Reduces number of tiles in play, shorter games
- **Status:** Mechanical deviation from original

#### Rule 4: Chain Founding Limits (Optional)
- **Enabled by:** `chainFoundingEnabled` flag
- **Options:**
  - `"7"`: All chains available (original Acquire)
  - `"6"`: Festival excluded
  - `"5"`: Festival and Imperial excluded
- **File:** `/src/types/game.ts` line 161
- **Files:** `/src/types/game.ts` lines 144-146 (ELIGIBLE_CHAINS_5, 6, 7)
- **Status:** Restricts available chain options

#### Rule 5: Chain Safety Threshold (Optional)
- **Enabled by:** `chainSafetyEnabled` flag
- **Options:** "none", "9", "11" (default), "13", "15"
- **Effect:** Changes when chains become "safe" (unmergeable)
- **File:** `/src/types/game.ts` lines 153-154
- **Status:** Alters endgame dynamics

#### Rule 6: Cash Visibility (Optional)
- **Enabled by:** `cashVisibilityEnabled` flag
- **Options:** "hidden", "visible", "aggregate"
- **Effect:** UI-only (no mechanical change)
- **File:** `/src/types/game.ts` lines 155-156

#### Rule 7: Starting Conditions (Optional)
- **Enabled by:** `startingConditionsEnabled` flag
- **Configurable:**
  - Starting cash (default: 6000)
  - Starting tiles (default: 6)
  - Start with tile on board (default: true)
- **File:** `/src/types/game.ts` lines 163-165, 169

### Default Game (No Custom Rules)
When all custom rules are disabled (default state), the game matches the original Acquire with these features:
- 9×12 board
- All 7 chains available
- Standard bonus system (10×/5×)
- Safe chain threshold: 11 tiles
- No turn timer
- Starting: $6000 + 6 tiles per player

---

## 4. Merger Mechanics (Core Game)

### Standard Merger Rules (Match Original Acquire)
- **Trigger:** Placing a tile that connects two hotel chains
- **Survivor Selection:** Larger chain survives; player chooses if tied
- **Dissolved Chain:** All tiles absorbed by surviving chain
- **Shareholder Payouts:** Majority (most shares) gets 10×; minority (2nd most) gets 5×
- **Stock Disposal:** Shareholders can KEEP, SELL, or TRADE 2:1 for survivor stock
- **Files:**
  - Logic: `/src/utils/mergerLogic.ts`
  - Types: `/src/types/game.ts` lines 61-67 (MergerState interface)

### Bonus Multiplier Variations (Optional)
- **File:** `/src/utils/gameLogic.ts` lines 89-100 (`getBonuses` function)
- **Tied Players:** Bonuses split equally
- **Flat Mode:** All stockholders get equal share of combined pool

---

## 5. Tutorial References to Brand Names

### All References to "Acquire"

| Step # | Page Title | Content Reference | File Location |
|---|---|---|---|
| 1 | "Welcome to Acquire!" | Main title | `tutorialSteps.ts` line 9 |
| 2 | "Goal of Acquire" | Learning objective | `tutorialSteps.ts` line 29 |
| 6 | Hotel Chains title | "The Heart of Acquire" | `tutorialSteps.ts` line 96 |
| 10 | "The 7 Hotel Chains" | Full list with tiers | `tutorialSteps.ts` lines 162-177 |
| 24 | Tutorial Complete | "ready to play Acquire!" | `tutorialSteps.ts` line 424 |

### Tutorial Hotel Name Usage

| Chain Name | Mentioned in Tutorial | Context |
|---|---|---|
| Sackson | ✅ Yes | Steps 8, 9, 10, 11, 13, 14, 15, 19, 21 (example chain) |
| Tower | ❌ No | Not used in tutorial |
| Festival | ✅ Yes | Steps 10, 18, 19, 20, 21 (merger example) |
| Continental | ✅ Yes | Step 10 (tier listing) |
| Imperial | ✅ Yes | Step 10 (tier listing) |
| Worldwide | ✅ Yes | Step 10 (tier listing) |
| American | ✅ Yes | Step 10 (tier listing) |

### Tutorial File Summary
- **File:** `/src/components/Tutorial/tutorialSteps.ts`
- **Total Steps:** 24 interactive tutorial sections
- **Explicit Brand References:** 6 (steps 1, 2, 6, 10, 24)
- **Implicit Brand References:** Hotel names in steps 8-21

---

## 6. Configuration & Default Rules

### Default Rules Configuration
- **File:** `/src/types/game.ts` (lines 168-186, `DEFAULT_RULES`)
- **All custom rules default to DISABLED**
- **This means default game matches original Acquire exactly**

```typescript
{
  startWithTileOnBoard: true,
  turnTimerEnabled: false,           // ← OFF by default
  chainSafetyEnabled: false,         // ← OFF by default
  bonusTierEnabled: false,           // ← OFF by default (uses 10×/5×)
  boardSizeEnabled: false,           // ← OFF by default (9×12)
  chainFoundingEnabled: false,       // ← OFF by default (7 chains)
  startingConditionsEnabled: false,  // ← OFF by default
}
```

---

## 7. Package Metadata

### package.json
- **File:** `/package.json` (line 2)
- **Name:** `"vite_react_shadcn_ts"` (not branded)
- **Version:** `"0.0.0"` (placeholder)
- **Status:** Not yet branded/versioned for release

---

## 8. Intellectual Property Assessment

### ⚠️ IP Concerns Identified

#### 1. **Direct Use of "Acquire" Trademark**
- **Issue:** The game is labeled as "Acquire" throughout
- **Severity:** HIGH
- **Locations:**
  - README.md (title)
  - index.html (meta tags - pending)
  - /src/pages/Index.tsx (main heading)
  - /src/components/game/OnlineLobby.tsx (lobby heading)
  - /src/components/game/GameContainer.tsx (game header)
  - /src/components/Tutorial/tutorialSteps.ts (tutorial titles)
- **Recommendation:** Change to "Acquire: [Custom Name]" or "[Custom Name] - An Acquire-inspired game" to indicate this is a third-party implementation

#### 2. **Hotel Chain Names Match Original**
- **Issue:** All 7 hotel names are identical to the original Acquire game
- **Severity:** HIGH
- **Affected Names:** Continental, Imperial, Worldwide, American, Festival, Sackson, Tower
- **Files:** `/src/types/game.ts` line 124-132, tutorial steps
- **Recommendation:** Create original hotel names. Current names are copyrightable elements of the original game's creative work

#### 3. **Game Mechanics Match Original**
- **Issue:** Core rules (board size, player count, tile placement, mergers, bonuses) match Acquire
- **Severity:** MEDIUM
- **Note:** Game mechanics are generally not patentable/copyrightable, but combination may be protected
- **Mitigation:** Custom rules system allows for variation. Default game SHOULD be customized to differentiate

#### 4. **Tutorial Names Hotel Chains**
- **Issue:** Tutorial explicitly lists all 7 hotel chains with their original names and tiers
- **Severity:** HIGH
- **File:** `/src/components/Tutorial/tutorialSteps.ts` steps 8, 10, 20, 21
- **Recommendation:** Update hotel names in tutorial to match any renamed chains

---

## 9. Recommendations for Legal Compliance

### IMMEDIATE ACTIONS REQUIRED

1. **Rename the Game**
   - [ ] Change "Acquire" to "Acquire: [Game Name]" OR "[Custom Title] - An Acquire-inspired Strategy Game"
   - [ ] Update in:
     - README.md
     - index.html (meta tags, title)
     - src/pages/Index.tsx
     - src/components/game/OnlineLobby.tsx
     - src/components/game/GameContainer.tsx
     - Tutorial titles (steps 1, 2, 6, 24)

2. **Rename Hotel Chains**
   - [ ] Create 7 original hotel names
   - [ ] Maintain tier structure (2 budget, 3 midrange, 2 premium)
   - [ ] Update in:
     - `/src/types/game.ts` (ChainInfo entries)
     - `/src/utils/gameLogic.ts` (initialization)
     - `/src/components/Tutorial/tutorialSteps.ts` (step 10 and examples)
     - Any UI components that display chain names

3. **Add Legal Disclaimer**
   - [ ] Create `/docs/LEGAL.md` or add to README:
     ```
     This is an unofficial, fan-made implementation inspired by the
     board game Acquire. This is not affiliated with, endorsed by, or
     associated with the original Acquire game or its publishers.
     ```

4. **Verify Custom Rules Differentiation**
   - [ ] Ensure custom rules system is prominent in marketing
   - [ ] Document how rules differ from original game
   - [ ] This shows this is a unique implementation, not a clone

### OPTIONAL ENHANCEMENTS

5. **Add Original Game Attribution**
   - [ ] "Inspired by the classic board game Acquire"
   - [ ] Link to original publisher's official game
   - [ ] This demonstrates good faith and respect for original work

6. **Consider Licensing**
   - [ ] Consult IP attorney about obtaining license from original publisher
   - [ ] Some game publishers allow fan implementations

---

## 10. File Inventory & Summary

### Files Containing Brand References

| File | References | Type | Severity |
|---|---|---|---|
| README.md | "Acquire" (title, 3×) | Name + Description | HIGH |
| index.html | "Lovable App" (placeholder) | Title/Meta | MEDIUM |
| src/pages/Index.tsx | "Acquire" (heading) | UI Display | HIGH |
| src/components/game/OnlineLobby.tsx | "Acquire" (heading) | UI Display | HIGH |
| src/components/game/GameContainer.tsx | "Acquire" (heading) | UI Display | HIGH |
| src/types/game.ts | 7 hotel names, 1 comment | Type definitions | HIGH |
| src/utils/gameLogic.ts | 7 hotel names (initialization) | Logic | MEDIUM |
| src/components/Tutorial/tutorialSteps.ts | "Acquire" (5×), all 7 hotel names | Tutorial Content | HIGH |
| package.json | Generic name (not branded) | Metadata | LOW |

### Files for Hotel Chain Updates

1. **Primary Definitions:**
   - `/src/types/game.ts` lines 124-132 (ChainInfo objects)
   - `/src/types/game.ts` lines 144-146 (Eligible chains lists)

2. **Game Logic:**
   - `/src/utils/gameLogic.ts` lines 199-207 (Chain initialization)
   - `/src/utils/gameLogic.ts` lines 210-218 (Stock bank initialization)

3. **UI/Tutorial:**
   - `/src/components/Tutorial/tutorialSteps.ts` (multiple steps)
   - Any components displaying chain names

4. **Supabase Backend:**
   - `/supabase/functions/game-action/index.ts` (server-side logic - must mirror frontend)

---

## 11. Conclusion & Compliance Status

### Current Status: ⚠️ HIGH RISK

The application currently uses IP-protected names and branding that could trigger legal action from the original Acquire game publishers:

1. ❌ Game is branded as "Acquire" (trademark violation risk)
2. ❌ All 7 hotel names match the original game (copyright violation risk)
3. ⚠️ Tutorial explicitly names all chains, creating documentation of copying
4. ✅ Game mechanics differ where custom rules are enabled (mitigating factor)
5. ✅ No code comments claiming original work (good faith indicator)

### Compliance Path Forward

**To become legally compliant (Acquire-Inspired, Not Clone):**

1. ✅ Rename game with clear attribution: "[Title] - An Acquire-Inspired Game"
2. ✅ Create original hotel chain names
3. ✅ Add legal disclaimer
4. ✅ Implement custom rules to show differentiation
5. ✅ Consider licensing or publisher contact

**Recommended Timeframe:** Complete before public release/marketing

---

## Appendix A: Original Acquire Game References

For reference, the original Acquire board game:
- **Publisher:** Avalon Hill (1964) / Wizards of the Coast (current)
- **Mechanics:** 8-color hotel chains, stock trading, tile placement on 9×12 board
- **Hotel Names (Original):** Continental, Imperial, Worldwide, American, Festival, Sackson, Tower
- **Official Website:** www.wizards.com (now Hasbro/Avalon Hill)

This audit is meant to ensure this implementation respects the original work while establishing its own identity.

---

**Audit Prepared:** February 2026
**Audit Status:** COMPLETE
**Next Review:** Before public release or major version update
