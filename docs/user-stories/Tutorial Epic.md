# Epic: Interactive Tutorial System for Acquire Online Game

## Executive Summary
Build a comprehensive, interactive tutorial system that teaches new players the rules and mechanics of Acquire through guided walkthroughs, visual spotlights, and hands-on practice tasks.

## Product Vision
Create an engaging learning experience that transforms complete beginners into confident players through progressive disclosure, interactive demonstrations, and practice scenarios in a safe, guided environment.

---

## Recommendation for Lovable Import

**I recommend: Import ALL AT ONCE for full context** ✅

**Reasoning:**
- Lovable needs to understand the complete tutorial flow to create a cohesive architecture
- The overlay/spotlight system needs to be designed once and reused across all steps
- State management for tutorial progress works best with full context
- Ensures consistent UI/UX patterns throughout

**However, you might want to ask Lovable to implement in 2-3 phases:**
1. **Phase 1**: Tutorial infrastructure + Steps 1-10 (Basics & First Actions)
2. **Phase 2**: Steps 11-19 (Advanced Gameplay & Mergers)
3. **Phase 3**: Steps 20-24 (Game Flow & Completion)

This way Lovable builds the foundation first, then adds content incrementally.

---

## Technical Stack (Aligned with Main Game)
- **Frontend**: React with TypeScript
- **State Management**: React Context API or Zustand (for tutorial progress)
- **Styling**: Tailwind CSS
- **Animation**: Framer Motion (for spotlight effects and transitions)
- **Routing**: React Router (for /tutorial route, optional)

---

## Configuration Decisions

### Questions for Lovable Implementation - ANSWERED
1. **Tutorial Entry**: Should tutorial auto-start for first-time users, or always require manual click? **NO AUTO START**
2. **Progress Save**: Save after each step or only on completion? **ONLY ON COMPLETION**
3. **Theming**: Match main game theme or use distinct "tutorial mode" styling? **MATCH MAIN GAME THEME**
4. **Sound Effects**: Include audio feedback for success/errors? **NO SOUND EFFECTS**

---

## Epic 11: Interactive Tutorial System

### User Story 11.1: Tutorial Entry Point
**As a new player**, I want to access the tutorial from the homepage, so I can learn how to play before joining a real game.

**Acceptance Criteria:**
- "Tutorial" button prominently displayed on homepage/landing page
- Button clearly labeled and easy to find
- Clicking launches tutorial in dedicated view or overlay
- Can be accessed without creating/joining a game room
- Tutorial can be exited at any time with confirmation prompt
- Option to access tutorial from settings/help menu as well

**Technical Notes:**
- Route: `/tutorial` or embedded overlay on home page (flexible)
- Tutorial state independent from actual game state
- Use simulated game state for tutorial purposes
- No progress persistence until completion

**UI/UX:**
- Clear "Start Tutorial" call-to-action
- No "Continue Tutorial" option (progress only saved on completion)

---

### User Story 11.2: Tutorial Overlay System
**As a tutorial participant**, I want the interface to guide my attention to relevant elements, so I'm not overwhelmed.

**Acceptance Criteria:**
- Overlay darkens entire screen except for spotlighted element
- Spotlight highlights current interactive element with clear visual focus
- Dimmed areas are semi-transparent (not completely black)
- Spotlight has subtle glow/border to draw attention
- Transitions between steps are smooth (animated)
- Tooltip/info box appears near spotlighted element
- Tooltip contains clear, concise instructions
- **Navigation controls as defined in User Story 12.7**
- **Progress indicator as defined in User Story 12.8**
- **Can exit tutorial as defined in User Story 12.7**

**Technical Notes:**
- Use portal/overlay component for z-index control
- Calculate spotlight position dynamically based on target element
- Use CSS clip-path or SVG mask for spotlight effect
- Framer Motion for smooth transitions
- Responsive spotlight sizing

**UI/UX:**
- Spotlight should "breathe" (subtle pulse animation)
- Tooltip arrow points to spotlighted element
- Dark overlay: rgba(0, 0, 0, 0.8)
- Spotlight border: subtle glow effect
- Font size: larger and more readable in tooltips

---

### User Story 11.3: Step 1 - Tutorial Introduction
**As a new player**, I want to understand what the tutorial will cover, so I know what to expect.

**Acceptance Criteria:**
- Welcome screen explains tutorial structure
- Mentions interactive tasks and guided walkthroughs
- Estimated time to complete (e.g., "~10-15 minutes")
- "Let's Begin" button to start
- Can exit tutorial at this point without confirmation

**Tooltip Content:**
```
Welcome to Acquire!

In this tutorial, you'll learn:
- How to play tiles on the board
- How to found and grow hotel chains
- How to buy and trade stocks
- How to handle mergers
- How to win the game

This interactive tutorial takes about 10-15 minutes.
You can exit or pause anytime.

Ready to become a hotel tycoon?
```

**Navigation:**
- Button: "Let's Begin" → Step 2

---

### User Story 11.4: Step 2 - Game Objective
**As a new player**, I want to understand the goal of the game, so I know what I'm trying to achieve.

**Acceptance Criteria:**
- Explains core objective: become richest player
- Explains three main mechanics: build chains, buy stocks, earn money
- Simple, engaging language
- Visual icons for each mechanic (optional)

**Spotlight:** None (full-screen info card)

**Tooltip Content:**
```
Goal of Acquire

Your objective: Become the richest player!

You'll earn money by:
🏨 Building hotel chains (placing tiles)
💰 Buying stocks in hotel chains
📈 Earning bonuses when chains merge

The player with the most cash at the end wins!
```

**Navigation:**
- Button: "Got it!" → Step 3

---

### User Story 11.5: Step 3 - Game Board Overview
**As a new player**, I want to understand the game board layout, so I can navigate it confidently.

**Acceptance Criteria:**
- Shows the 9x12 game board
- Explains coordinate system (rows 1-9, columns A-L)
- Highlights a few example coordinates
- Interactive: hover over tiles to see coordinates (optional)

**Spotlight:** Entire game board

**Tooltip Content:**
```
The Game Board

This is the 9×12 board where you'll build your hotel empire.

Each square has a coordinate:
- Rows: 1-9 (horizontal)
- Columns: A-L (vertical)

Example: This highlighted square is "5F"
(Row 5, Column F)

These coordinates match the tiles in your hand!
```

**Visual Aid:**
- Highlight 2-3 example tiles (e.g., 1A, 5F, 9L) with labels
- Show coordinate labels on board edges

**Navigation:**
- Button: "Next" → Step 4

---

### User Story 11.6: Step 4 - Player Hand Introduction
**As a new player**, I want to understand my hand of tiles, so I know what I can play.

**Acceptance Criteria:**
- Spotlights player's hand area (with 6 pre-set tutorial tiles)
- Explains each tile represents a board coordinate
- Explains you always have 6 tiles
- Shows which tiles are playable vs. unplayable (all playable in this step)

**Spotlight:** Player hand area

**Tooltip Content:**
```
Your Tile Hand

These are your 6 tiles. Each tile shows a board coordinate where you can play.

Every turn, you'll:
1. Play one tile from your hand
2. (Automatically draw a new tile)

Right now, all your tiles are playable!

Let's place one in the next step.
```

**Tutorial Game State:**
- Player hand: [E6, 3B, 7H, 5C, 2J, 8D]
- Board: Empty or 1-2 scattered tiles

**Navigation:**
- Button: "Next" → Step 5

---

### User Story 11.7: Step 5 - Place First Tile (Interactive)
**As a new player**, I want to place my first tile, so I learn the basic action.

**Acceptance Criteria:**
- Spotlights the E6 tile in player's hand
- Instructions to click E6 tile, then click E6 on board
- Cannot proceed until correct tile is placed
- Success feedback when tile is placed correctly
- Visual confirmation (tile appears on board)

**Spotlight:** E6 tile in hand → E6 square on board (two-step)

**Tooltip Content (Part 1):**
```
Place Your First Tile

Let's place the E6 tile!

Step 1: Click the "E6" tile in your hand.
```

**Tooltip Content (Part 2 - after tile selected):**
```
Good! Now place it on the board.

Step 2: Click square E6 on the board.
```

**Tooltip Content (Part 3 - success):**
```
Great job! 🎉

You've placed your first tile on E6.

This is the basic action you'll do every turn.
```

**Validation:**
- Must click E6 tile first
- Must click E6 board square second
- Other clicks are blocked or show "Click E6 tile" reminder

**Navigation:**
- Auto-advance after success → Step 6

---

### User Story 11.8: Step 6 - Hotel Chain Concept
**As a new player**, I want to understand how hotel chains form, so I know what happens when tiles are adjacent.

**Acceptance Criteria:**
- Explains that 2+ adjacent tiles form a hotel chain
- Visual example showing adjacent tiles
- Explains chains have names, colors, and grow over time
- No interaction required (just information)

**Spotlight:** Board area showing E6 and adjacent empty squares (E5, E7, D6, F6)

**Tooltip Content:**
```
Hotel Chains - The Heart of Acquire

When 2 or more tiles are next to each other (horizontally or vertically), they form a HOTEL CHAIN.

Chains are powerful because:
- They have unique names and colors
- They make stocks valuable
- They grow as you add more tiles

Let's found your first chain!
```

**Visual Aid:**
- Highlight E6 (already placed)
- Pulse/glow on D6 square to show adjacency

**Navigation:**
- Button: "Next" → Step 7

---

### User Story 11.9: Step 7 - Found a Hotel Chain (Interactive)
**As a new player**, I want to found my first hotel chain, so I understand chain creation.

**Acceptance Criteria:**
- Spotlights D6 tile in hand
- Instructions to place D6 adjacent to E6
- After placement, chain founding dialog appears
- Must select "Sackson" chain
- Chain colors E6 and D6 with Sackson color (blue)
- Success feedback

**Spotlight:** D6 tile → D6 board square → Chain selection dialog

**Tooltip Content (Part 1):**
```
Found a Hotel Chain

Place tile D6 next to your E6 tile.

This will create your first hotel chain!

Click your D6 tile, then click board square D6.
```

**Tooltip Content (Part 2 - chain selection):**
```
Choose a Chain to Found

A new chain is being created! You get to choose which one.

Select "Sackson" from the list.

(In a real game, you can choose any available chain)
```

**Tooltip Content (Part 3 - success):**
```
Congratulations! 🏨

You founded the Sackson hotel chain!

Notice:
- Both tiles are now blue (Sackson's color)
- The chain has 2 tiles

Next, we'll talk about your founder's bonus...
```

**Validation:**
- Must place D6 at correct location
- Must select Sackson (other chains disabled in tutorial)
- Tiles change color after founding

**Navigation:**
- Auto-advance after success → Step 8

---

### User Story 11.10: Step 8 - Founder's Bonus
**As a new player**, I want to understand the founder's bonus, so I know the benefit of creating chains.

**Acceptance Criteria:**
- Explains you receive 1 free stock as founder
- Shows portfolio update (1 Sackson stock added)
- Explains this is a reward for taking initiative
- No interaction required

**Spotlight:** Player's stock portfolio showing 1 Sackson stock

**Tooltip Content:**
```
Founder's Bonus! 🎁

As the founder of Sackson, you receive:
- 1 FREE Sackson stock

This is your reward for creating the chain.

Look at your portfolio - you now own 1 Sackson stock!

Stocks are how you make money in this game.
```

**Navigation:**
- Button: "Nice!" → Step 9

---

### User Story 11.11: Step 9 - The Seven Hotel Chains
**As a new player**, I want to learn about all seven hotel chains, so I know my options.

**Acceptance Criteria:**
- Displays all 7 chains with names, colors, and tiers
- Explains 3 price tiers: Budget, Mid-range, Premium
- Visual color reference for each chain
- No interaction required

**Spotlight:** Information card or dedicated chain reference panel

**Tooltip Content:**
```
The 7 Hotel Chains

There are 7 hotel chains in Acquire:

💎 PREMIUM (Most expensive)
- Continental (Cyan)
- Imperial (Yellow)

💼 MID-RANGE
- Worldwide (Purple)
- American (Red)
- Festival (Green)

💵 BUDGET (Least expensive)
- Sackson (Blue) ← You founded this one!
- Tower (Orange)

Higher-tier chains = More valuable stocks!
```

**Visual Aid:**
- Show all 7 chains with color swatches
- Highlight Sackson (already founded)

**Navigation:**
- Button: "Got it" → Step 10

---

### User Story 11.12: Step 10 - Buying Stocks (Interactive)
**As a new player**, I want to learn how to buy stocks, so I can invest in hotel chains.

**Acceptance Criteria:**
- Spotlights "Buy Stock" button/phase
- Explains can buy up to 3 stocks per turn
- Instructions to buy 2 Sackson stocks
- Shows current price per share
- Deducts money from player's cash
- Updates portfolio
- Success feedback

**Spotlight:** Stock purchase interface → Sackson buy button

**Tooltip Content (Part 1):**
```
Buying Stocks

After placing a tile, you can buy up to 3 stocks from any ACTIVE chain.

Sackson is active (you founded it!).

Let's buy 2 Sackson stocks.

Current price: $200 per share
Cost: $400 total

Click the Sackson "+2" button (or click twice on +1).
```

**Tooltip Content (Part 2 - success):**
```
Stock Purchased! 📈

You now own 3 Sackson stocks:
- 1 from founder's bonus
- 2 you just bought

You spent: $400
Remaining cash: $5,600

Stocks make you money when:
- The chain grows (higher value)
- Chains merge (you get bonuses)
```

**Validation:**
- Must buy exactly 2 Sackson stocks
- Cannot buy other chains (disabled in tutorial)
- Cash updates correctly

**Tutorial Game State:**
- Starting cash: $6,000
- After purchase: $5,600
- Sackson stocks: 3 total

**Navigation:**
- Auto-advance after purchase → Step 11

---

### User Story 11.13: Step 11 - Money & Portfolio Overview
**As a new player**, I want to understand my financial status, so I can track my wealth.

**Acceptance Criteria:**
- Spotlights cash display
- Spotlights stock portfolio
- Explains how to read portfolio (quantity × value)
- Shows current net worth calculation
- No interaction required

**Spotlight:** Player dashboard showing cash and stocks

**Tooltip Content:**
```
Your Money & Portfolio

Keep track of your wealth:

💵 Cash: $5,600
(Money you can spend)

📊 Stocks: 3 Sackson
(Current value: 3 × $200 = $600)

💎 Net Worth: $6,200
(Cash + Stock value)

Your goal: Maximize net worth by game end!
```

**Navigation:**
- Button: "Next" → Step 12

---

### User Story 11.14: Step 12 - Growing Hotel Chains (Interactive)
**As a new player**, I want to see how chains grow, so I understand chain expansion.

**Acceptance Criteria:**
- Spotlights playable tile adjacent to Sackson (e.g., C6 or E5)
- Instructions to place tile to grow Sackson to 3 tiles
- After placement, chain grows automatically
- Shows updated chain size (2 → 3)
- Shows updated stock price (if applicable)
- Second tile placement to reach 4 tiles
- Success feedback

**Spotlight:** Adjacent tile → Board square

**Tooltip Content (Part 1):**
```
Growing Your Chain

Place a tile next to Sackson to make it grow!

Larger chains = More valuable stocks!

Place your C6 tile adjacent to the Sackson chain.
```

**Tooltip Content (Part 2 - after first growth):**
```
Sackson is Growing! 📈

Sackson now has 3 tiles.

Let's make it even bigger!

Place your E5 tile to grow Sackson to 4 tiles.
```

**Tooltip Content (Part 3 - success):**
```
Excellent! 🎉

Sackson now has 4 tiles!

Notice:
- All 4 tiles are connected
- Chain size updated: 2 → 4
- Stock value increased (size affects price)

Bigger chains make your stocks more valuable!
```

**Validation:**
- Must place tiles in correct locations
- Chain size updates automatically
- Visual feedback on board

**Tutorial Game State:**
- Sackson grows from 2 → 4 tiles
- Stock price may increase based on size tier

**Navigation:**
- Auto-advance after success → Step 13

---

### User Story 11.15: Step 13 - Stock Values & Price Tiers
**As a new player**, I want to understand how stock prices work, so I can make smart investments.

**Acceptance Criteria:**
- Explains stock price depends on chain size AND tier
- Shows price chart for different sizes (2, 3, 4-5, 6-10, 11-20, etc.)
- Highlights Sackson's current price (Budget tier, size 4)
- Explains Premium chains worth more than Budget at same size
- No interaction required

**Spotlight:** Price information chart or current Sackson price

**Tooltip Content:**
```
How Stock Prices Work

Stock value depends on TWO factors:

1️⃣ Chain Size (number of tiles)
- Bigger chains = Higher prices
- Size 2: $200-300
- Size 4-5: $400-500
- Size 11+: $600-700
- Size 41+: $900-1000

2️⃣ Chain Tier
- Budget (Sackson, Tower): Lowest prices
- Mid-range: Medium prices
- Premium (Continental, Imperial): Highest prices

Sackson (Budget, Size 4): $400/share
Continental (Premium, Size 4): $500/share

Strategy: Buy early when chains are small!
```

**Navigation:**
- Button: "Understood" → Step 14

---

### User Story 11.16: Step 14 - Information Card
**As a new player**, I want to learn how to access game information, so I can make informed decisions.

**Acceptance Criteria:**
- Spotlights information card button/icon
- Instructions to open information card
- Shows what's displayed: prices, bonuses, available stocks
- Explains when to reference it (before buying stocks)
- Interactive: must open card to proceed

**Spotlight:** Info card button → Opened info card

**Tooltip Content (Part 1):**
```
The Information Card 📋

This is your reference guide during the game!

Click the "Info" button to open it.
```

**Tooltip Content (Part 2 - card opened):**
```
Information Card

Here you'll find:
- Current stock prices for all chains
- Majority/Minority bonuses
- Available stocks in the bank
- Chain sizes

Use this before buying stocks or during mergers!

You can access this anytime during the game.
```

**Validation:**
- Must open information card
- Can close and reopen

**Navigation:**
- Button: "Got it" → Step 15

---

### User Story 11.17: Step 15 - Merger Introduction
**As a new player**, I want to understand what mergers are, so I'm not confused when they happen.

**Acceptance Criteria:**
- Explains mergers occur when tile connects two chains
- Explains larger chain "acquires" smaller chain
- Mentions bonuses and stock decisions
- Shows visual example of two separate chains
- No interaction yet (just concept)

**Spotlight:** Board showing Sackson and a separate second chain (e.g., Festival)

**Tooltip Content:**
```
Hotel Chain Mergers 🤝

A MERGER happens when you place a tile that connects two hotel chains.

What happens:
- The LARGER chain survives
- The SMALLER chain is dissolved
- Shareholders get BONUSES
- You make decisions about your stocks

Mergers are where BIG money is made!

Let's set one up...
```

**Tutorial Game State:**
- Board has Sackson (4 tiles) in one area
- Board has Festival (2-3 tiles) in a separate area
- One empty square between them (tutorial will use this)

**Navigation:**
- Button: "Show me!" → Step 16

---

### User Story 11.18: Step 16 - Execute a Merger (Interactive)
**As a new player**, I want to perform a merger, so I understand the process.

**Acceptance Criteria:**
- Spotlights tile that connects Sackson and Festival
- Instructions to place tile between the two chains
- After placement, merger process begins
- Visual: chains connected, smaller dissolves into larger
- Shows merger notification/modal
- Success feedback

**Spotlight:** Connecting tile → Board square

**Tooltip Content (Part 1):**
```
Trigger a Merger

Place your 5E tile between Sackson and Festival.

This will merge the two chains!

Click 5E in your hand, then click board square 5E.
```

**Tooltip Content (Part 2 - merger triggered):**
```
Merger in Progress! 🤝

Sackson (4 tiles) is merging with Festival (3 tiles).

Since Sackson is larger, it survives!

Festival will be dissolved.

Watch what happens next...
```

**Validation:**
- Must place correct tile
- Merger animation/transition plays
- Festival tiles turn blue (Sackson color)
- Sackson size increases

**Navigation:**
- Auto-advance after merger starts → Step 17

---

### User Story 11.19: Step 17 - Surviving vs. Dissolved Chain
**As a new player**, I want to understand which chain survives, so I can predict merger outcomes.

**Acceptance Criteria:**
- Explains larger chain always survives
- Shows Sackson absorbed Festival
- Explains ties: active player chooses
- Visual: all tiles now one color (Sackson blue)
- No interaction required

**Spotlight:** Merged chain on board (all Sackson tiles)

**Tooltip Content:**
```
Merger Result

Sackson survived and absorbed Festival!

Rules:
✅ Larger chain survives (Sackson had 4, Festival had 3)
✅ All Festival tiles become Sackson tiles
✅ Sackson is now 7 tiles strong

If chains are TIED in size, YOU (the active player) choose which survives.

Now, let's talk about the money you made...
```

**Tutorial Game State:**
- Sackson: 7 tiles (4 original + 3 from Festival)
- Festival: Dissolved
- Board shows all blue (Sackson) tiles

**Navigation:**
- Button: "Show me the money!" → Step 18

---

### User Story 11.20: Step 18 - Majority & Minority Bonuses
**As a new player**, I want to understand merger bonuses, so I know how to profit.

**Acceptance Criteria:**
- Explains majority holder gets 10× stock price
- Explains minority holder gets 5× stock price
- Shows example calculation with Festival
- Explains ties split bonuses
- Shows tutorial player receiving bonus (simulated)
- No interaction required

**Spotlight:** Bonus payment notification or player cash increase

**Tooltip Content:**
```
Merger Bonuses! 💰

When a chain is dissolved, shareholders get bonuses:

🥇 MAJORITY holder (most stocks): 10× stock price
🥈 MINORITY holder (2nd most): 5× stock price

Example (Festival dissolved):
- Stock price: $300
- Majority bonus: $3,000
- Minority bonus: $1,500

In this tutorial, you held 2 Festival stocks (minority position).

You received: $1,500! 🎉

If there's a TIE, players split the bonuses equally.
```

**Tutorial Game State:**
- Player receives $1,500 bonus
- Cash updates: $5,600 → $7,100

**Navigation:**
- Button: "Nice!" → Step 19

---

### User Story 11.21: Step 19 - Stock Disposal Options (Interactive)
**As a new player**, I want to learn what to do with dissolved chain stocks, so I can manage my portfolio.

**Acceptance Criteria:**
- Explains three options: Keep, Sell, Trade (2:1)
- Spotlights stock disposal interface
- Instructions to sell 1 stock and trade 2 stocks
- Shows calculations:
  - Sell 1 Festival @ $300 = $300
  - Trade 2 Festival → 1 Sackson
- Updates portfolio accordingly
- Success feedback

**Spotlight:** Stock disposal modal/interface

**Tooltip Content (Part 1):**
```
What to Do With Your Stocks?

Festival is dissolved. You have 2 Festival stocks left.

You have 3 options:

🔵 KEEP: Hold for end-game scoring
💵 SELL: Get cash now (at current price)
🔄 TRADE: Exchange 2:1 for surviving chain stock

Let's try selling and trading!

Sell 1 Festival stock, then trade 2 Festival → 1 Sackson.
```

**Tooltip Content (Part 2 - success):**
```
Portfolio Updated! 📊

You sold 1 Festival stock:
- Received: $300 cash

You traded 2 Festival → 1 Sackson:
- Lost: 2 Festival
- Gained: 1 Sackson

Remaining Festival stocks: 0
(You could have kept some for end-game scoring)

New cash: $7,400
Sackson stocks: 4 (3 original + 1 traded)
```

**Validation:**
- Must perform sell and trade actions
- Cannot trade odd numbers (must be 2:1 ratio)
- Cash and stocks update correctly

**Tutorial Game State After:**
- Cash: $7,400
- Sackson: 4 stocks
- Festival: 0 stocks (all disposed)

**Navigation:**
- Auto-advance after completion → Step 21

---

### User Story 11.22: Step 21 - Complete Turn Sequence
**As a new player**, I want to understand the full turn flow, so I know what to expect each round.

**Acceptance Criteria:**
- Summarizes three turn phases
- Shows visual flowchart or sequence
- Explains automatic tile draw
- Mentions turn passes to next player
- No interaction required

**Spotlight:** Turn phase indicator or flowchart

**Tooltip Content:**
```
Your Turn Sequence

Every turn has 3 phases:

1️⃣ PLACE TILE (mandatory)
   - Play one tile from your hand
   - May found chain, grow chain, or trigger merger

2️⃣ BUY STOCKS (optional)
   - Purchase 0-3 stocks from active chains
   - Costs deducted from your cash

3️⃣ DRAW TILE (automatic)
   - You automatically draw 1 new tile
   - Always have 6 tiles in hand

Then the next player takes their turn!

This repeats until the game ends.
```

**Visual Aid:**
- Flowchart with arrows: Place → Buy → Draw → Next Player
- Highlight which phases are mandatory vs optional

**Navigation:**
- Button: "Clear!" → Step 22

---

### User Story 11.23: Step 22 - Game End Conditions
**As a new player**, I want to know when the game ends, so I can plan my strategy.

**Acceptance Criteria:**
- Explains game end triggers:
  - One chain reaches 41+ tiles
  - Players vote to end (when at least one chain is safe/11+)
- Explains what "safe" means (11+ tiles, cannot be acquired)
- Mentions voting mechanism
- No interaction required

**Spotlight:** End game conditions info panel

**Tooltip Content:**
```
When Does the Game End?

The game ends when:

1️⃣ Any chain reaches 41+ tiles
   - Automatic game end

2️⃣ Players vote to end the game
   - Voting allowed when at least one chain is "safe" (11+ tiles)
   - Majority vote required
   - Safe chains cannot be merged (protected)

Strategy tip: Timing the end-game can give you an advantage!

After the game ends, final scoring determines the winner.
```

**Navigation:**
- Button: "Got it" → Step 23

---

### User Story 11.24: Step 23 - Final Scoring
**As a new player**, I want to understand how winners are determined, so I know what to aim for.

**Acceptance Criteria:**
- Explains final scoring process:
  - All stocks liquidated
  - Majority/minority bonuses paid for each chain
  - Cash totals calculated
  - Highest cash wins
- Mentions game auto-calculates everything
- No interaction required

**Spotlight:** Example final scoreboard

**Tooltip Content:**
```
Final Scoring & Winner 🏆

At game end, the computer automatically:

1️⃣ Pays bonuses for ALL active chains
   - Majority holders: 10× stock price
   - Minority holders: 5× stock price

2️⃣ Sells all remaining stocks at current price

3️⃣ Calculates total cash for each player

4️⃣ Declares the winner (most cash)

You don't need to calculate anything - the game does it all!

Example:
- Player 1: $15,200 🥇
- Player 2: $14,800
- Player 3: $13,500
- Player 4: $12,100
```

**Visual Aid:**
- Mock scoreboard showing 4 players and final standings

**Navigation:**
- Button: "Awesome!" → Step 24

---

### User Story 11.25: Step 24 - Tutorial Complete
**As a new player**, I want to finish the tutorial with confidence, so I'm ready to play.

**Acceptance Criteria:**
- Congratulatory message
- Summary of key concepts learned
- Two options:
  - "Start a Game" → Redirects to game lobby
  - "Replay Tutorial" → Restarts from Step 1
- Optional: "Back to Home"
- Tutorial progress marked as complete in localStorage

**Spotlight:** None (full-screen completion card)

**Tooltip Content:**
```
Tutorial Complete! 🎉

Congratulations! You've learned:
✅ How to place tiles and read the board
✅ How to found and grow hotel chains
✅ How to buy and manage stocks
✅ How to handle mergers and bonuses
✅ How the game ends and scoring works

You're ready to play Acquire!

What would you like to do?
```

**Buttons:**
- "Start a Game" → Navigate to `/lobby` or home with game creation
- "Replay Tutorial" → Restart tutorial from Step 1
- "Back to Home" → Return to homepage

**Technical Notes:**
- Set `tutorialCompleted: true` in localStorage
- Clear tutorial game state
- Confetti animation or celebration effect (optional)

**Navigation:**
- Exits tutorial based on user choice

---

## Epic 12: Tutorial Infrastructure

### User Story 12.1: Tutorial State Management
**As a developer**, I want robust state management for the tutorial, so users have a smooth experience.

**Acceptance Criteria:**
- Tutorial state tracks:
  - Current step (1-24)
  - Tutorial game state (board, tiles, chains, stocks, cash)
  - User actions/validation status
- State does NOT persist across browser refresh (fresh start each time)
- Can reset tutorial state
- State isolated from real game state

**Technical Notes:**
- Use Context API or Zustand for tutorial state
- Separate context from main game state
- Schema:
```typescript
interface TutorialState {
  currentStep: number;
  tutorialGameState: SimulatedGameState;
  isActive: boolean;
}
```

---

### User Story 12.2: Spotlight Component
**As a developer**, I want a reusable spotlight component, so I can highlight any UI element.

**Acceptance Criteria:**
- Component accepts target element ref or selector
- Dynamically calculates spotlight position and size
- Animates transitions between targets
- Supports different spotlight shapes (rectangle, circle)
- Works responsively across screen sizes
- Provides fallback if target not found

**Technical Notes:**
- Use React Portals for overlay
- Calculate bounding box with `getBoundingClientRect()`
- Use CSS clip-path or SVG mask
- Framer Motion for animations
- Example usage:
```tsx
<TutorialSpotlight
  targetRef={boardRef}
  shape="rectangle"
  padding={16}
  onNext={goToNextStep}
/>
```

---

### User Story 12.3: Tooltip Component
**As a developer**, I want a flexible tooltip component, so I can display instructions consistently.

**Acceptance Criteria:**
- Positioned near spotlighted element
- Auto-adjusts position to stay on screen
- Supports markdown/rich text
- Includes navigation buttons (Next, Back, Exit)
- Shows step counter
- Responsive sizing
- Accessible (keyboard navigation, screen readers)

**Technical Notes:**
- Use absolute positioning with smart placement logic
- Support arrow pointer to target
- Include close/exit button
- ARIA labels for accessibility

---

### User Story 12.4: Tutorial Game Simulation
**As a developer**, I want a simulated game environment, so tutorial interactions feel real.

**Acceptance Criteria:**
- Simulated game state independent of real game logic
- Pre-defined scenarios for each step
- Validates user actions against expected tutorial flow
- Updates state realistically (tile placement, chain founding, etc.)
- Does not require backend/WebSocket connection
- Resets cleanly between tutorial runs

**Technical Notes:**
- Create `tutorialGameEngine.ts` with simplified game logic
- Pre-script board states for each step
- Mock player actions and responses
- No network calls required

---

### User Story 12.5: Tutorial Validation System
**As a developer**, I want a validation system for interactive tasks, so users complete tasks correctly.

**Acceptance Criteria:**
- Validates user actions in interactive steps
- Provides feedback for incorrect actions
- Prevents progression until task complete
- Hints available if user struggles (optional)
- Tracks retry attempts (optional)

**Technical Notes:**
- Step-specific validation functions
- Example:
```typescript
const validateTilePlacement = (tile: string, position: string) => {
  return tile === "E6" && position === "E6";
};
```

---

### User Story 12.6: Skip Tutorial Option
**As an experienced player**, I want to skip the tutorial, so I can get to gameplay faster.

**Acceptance Criteria:**
- "Exit Tutorial" button visible on every step (X icon in top-right)
- Confirmation dialog before exiting: "Exit tutorial? Your progress will not be saved."
- Confirmation options: "Exit" / "Stay in Tutorial"
- Marks tutorial as complete when exited
- Returns to homepage or lobby

**Technical Notes:**
- Confirmation: "Exit tutorial? Your progress will not be saved. You can restart the tutorial anytime from the home page."
- Clear tutorial state on exit

---

### User Story 12.7: Tutorial Navigation Controls
**As a tutorial user**, I want clear navigation controls, so I can move through the tutorial at my own pace.

**Acceptance Criteria:**
- Every tooltip displays navigation buttons appropriate to the current step
- Button states update based on step context
- Navigation is consistent across all steps
- Keyboard shortcuts supported (optional)

**Navigation Buttons:**

**"Next" Button:**
- Visible on all informational steps (non-interactive)
- Disabled on interactive steps until task is completed
- Advances to next step when clicked
- Shows "Finish" on final step (Step 24)

**"Back" Button:**
- Visible on all steps except Step 1
- Returns to previous step when clicked
- Restores previous tutorial game state
- No confirmation required

**"Exit Tutorial" Button:**
- Visible on all steps (as X icon or text button in top-right corner)
- Shows confirmation dialog: "Exit tutorial? Your progress will not be saved."
- Confirmation options: "Exit" / "Stay in Tutorial"
- Returns to homepage on exit
- Clears tutorial game state

**Visual Layout Example:**
```
┌─────────────────────────────────────┐
│  Tutorial Step 5 of 24         [X]  │ ← Exit button
├─────────────────────────────────────┤
│                                     │
│  [Tooltip content here]             │
│                                     │
├─────────────────────────────────────┤
│  [← Back]              [Next →]     │ ← Navigation buttons
└─────────────────────────────────────┘
```

**Technical Notes:**
- Next button disabled state: `opacity: 0.5; cursor: not-allowed`
- Exit confirmation uses modal overlay
- Navigation state tracked in tutorial context
```typescript
interface TutorialNavigation {
  canGoBack: boolean;
  canGoNext: boolean;
  onNext: () => void;
  onBack: () => void;
  onExit: () => void;
}
```

---

### User Story 12.8: Step Progress Indicator
**As a tutorial user**, I want to see my progress, so I know how much is left.

**Acceptance Criteria:**
- Progress indicator shows current step number and total steps
- Format: "Step X of 24"
- Visual progress bar shows percentage completion
- Updates in real-time as user progresses
- Visible on all steps

**Visual Design:**
```
Progress: ████████░░░░░░░░░░░░ 8/24 (33%)
```

**Technical Notes:**
- Calculate percentage: `(currentStep / totalSteps) * 100`
- Use progress bar component with smooth transitions
- Color: Match game theme

---

### User Story 12.9: Interactive Step Validation Feedback
**As a tutorial user**, I want immediate feedback on my actions, so I know if I'm doing it correctly.

**Acceptance Criteria:**
- Incorrect actions show helpful error messages
- Error messages are non-blocking (can retry immediately)
- Correct actions show success confirmation
- Success confirmation auto-advances after 1.5s delay
- Visual feedback for both success and error states

**Error Message Examples:**
- Step 5 (Place E6 tile): "That's not the E6 tile. Click the E6 tile in your hand first."
- Step 7 (Found Sackson): "Please select Sackson from the chain list."
- Step 10 (Buy 2 stocks): "You need to buy exactly 2 Sackson stocks. You've bought 1. Buy 1 more."

**Success Feedback Examples:**
- ✅ "Perfect! You placed the E6 tile correctly."
- ✅ "Great! You founded the Sackson chain."
- ✅ "Excellent! You bought 2 Sackson stocks."

**Visual States:**
- Error: Red border pulse + error icon + message
- Success: Green checkmark + message + confetti (subtle)

**Technical Notes:**
```typescript
interface StepValidation {
  isValid: boolean;
  errorMessage?: string;
  successMessage?: string;
  allowRetry: boolean;
}
```

---

## Epic 13: Tutorial UX Enhancements

### User Story 13.1: Tutorial Animations
**As a user**, I want smooth animations, so the tutorial feels polished.

**Acceptance Criteria:**
- Fade transitions between steps
- Spotlight "breathe" animation (subtle pulse)
- Success checkmark animations
- Tile placement animations
- Chain color transitions
- Performance optimized (60fps)

**Technical Notes:**
- Use Framer Motion variants
- CSS transforms over layout changes
- Hardware-accelerated animations

---

### User Story 13.2: Mobile Responsiveness
**As a mobile user**, I want the tutorial to work on tablets, so I can learn on any device.

**Acceptance Criteria:**
- Spotlight adjusts for smaller screens
- Tooltips reposition to avoid overlap
- Touch interactions supported
- Font sizes readable on tablets
- Works in portrait and landscape
- Minimum supported: 768px width (tablet)

**Technical Notes:**
- Test on iPad, Android tablets
- Use responsive breakpoints
- Touch event handlers

---

### User Story 13.3: Accessibility
**As a user with accessibility needs**, I want the tutorial to be usable, so everyone can learn.

**Acceptance Criteria:**
- Keyboard navigation (Tab, Enter, Escape)
- Screen reader announcements for step changes
- High contrast mode support
- Focus indicators visible
- Skip links available
- ARIA labels on interactive elements

**Technical Notes:**
- Follow WCAG 2.1 AA standards
- Test with NVDA/JAWS screen readers
- Use semantic HTML

---

## Testing Requirements

### Unit Tests
- Tutorial state management (step progression, validation)
- Spotlight position calculations
- Tutorial game simulation logic

### Integration Tests
- Complete tutorial flow (Step 1 → 24)
- Interactive task validations
- Navigation controls (Next, Back, Exit)

### E2E Tests
- Full tutorial completion
- Exit tutorial flow
- Responsive behavior

---

## Technical Debt & Future Enhancements

### Phase 2 Considerations (Not in MVP)
- Video tutorials for each step
- Multiple language support
- Practice mode (replay specific scenarios)
- Tutorial statistics (completion rate, average time)
- Hints system for struggling users
- Adaptive difficulty (skip advanced topics for casual players)
- Progress persistence across sessions (currently only saves on completion)

---

## Definition of Done
A tutorial step is considered complete when:
- Step content finalized and reviewed
- Spotlight targets correct element
- Tooltip text clear and concise
- Validation logic works correctly (if interactive)
- Transitions smooth and bug-free
- Accessible via keyboard
- Tested on desktop and tablet
- No console errors
- Navigation controls work properly (Next, Back, Exit)

---

## Success Metrics
- >80% tutorial completion rate
- <15 minutes average completion time
- <10% exit rate before completion
- Positive user feedback on clarity
- No critical bugs reported

---

## Implementation Notes for Lovable

### Suggested File Structure
```
/src/components/Tutorial/
  TutorialOverlay.tsx          # Main tutorial wrapper
  TutorialSpotlight.tsx         # Spotlight component
  TutorialTooltip.tsx           # Tooltip component
  TutorialProgress.tsx          # Progress bar/counter
  TutorialNavigation.tsx        # Navigation controls (Next/Back/Exit)
  ExitTutorialDialog.tsx        # Exit confirmation modal
  steps/
    Step01_Introduction.tsx
    Step02_GameObjective.tsx
    Step03_GameBoard.tsx
    Step04_PlayerHand.tsx
    Step05_PlaceFirstTile.tsx
    Step06_ChainConcept.tsx
    Step07_FoundChain.tsx
    Step08_FounderBonus.tsx
    Step09_SevenChains.tsx
    Step10_BuyingStocks.tsx
    Step11_MoneyPortfolio.tsx
    Step12_GrowingChains.tsx
    Step13_StockValues.tsx
    Step14_InfoCard.tsx
    Step15_MergerIntro.tsx
    Step16_ExecuteMerger.tsx
    Step17_SurvivingChain.tsx
    Step18_MergerBonuses.tsx
    Step19_StockDisposal.tsx
    Step21_TurnSequence.tsx
    Step22_GameEnd.tsx
    Step23_FinalScoring.tsx
    Step24_Complete.tsx
  tutorialEngine.ts             # Simulated game logic
  tutorialState.ts              # State management (Context/Zustand)
  tutorialSteps.ts              # Step configuration
  tutorialValidation.ts         # Validation logic for interactive steps
  types.ts                      # TypeScript types
```

### Key Dependencies
```json
{
  "framer-motion": "^10.x",
  "zustand": "^4.x"
}
```

### Routing
Option 1: Dedicated route `/tutorial`
Option 2: Overlay on homepage (set `?tutorial=true` query param)

**Recommendation: Option 1** (dedicated route) for cleaner state isolation

---

### TutorialTooltip Component Structure
```typescript
interface TutorialTooltipProps {
  step: number;
  totalSteps: number;
  title: string;
  content: string;
  onNext?: () => void;
  onBack?: () => void;
  onExit: () => void;
  canGoBack: boolean;
  canGoNext: boolean; // false until interactive task complete
  nextButtonLabel?: string; // "Next" or "Finish"
}

function TutorialTooltip({
  step,
  totalSteps,
  title,
  content,
  onNext,
  onBack,
  onExit,
  canGoBack,
  canGoNext,
  nextButtonLabel = "Next"
}: TutorialTooltipProps) {
  return (
    <div className="tutorial-tooltip">
      {/* Header */}
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-500">
          Step {step} of {totalSteps}
        </span>
        <button onClick={onExit} aria-label="Exit tutorial">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-gray-200 rounded-full h-2 my-2">
        <div 
          className="bg-blue-600 h-2 rounded-full transition-all"
          style={{ width: `${(step / totalSteps) * 100}%` }}
        />
      </div>

      {/* Content */}
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <div className="text-gray-700 mb-4">{content}</div>

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={onBack}
          disabled={!canGoBack}
          className="btn-secondary"
        >
          ← Back
        </button>
        <button
          onClick={onNext}
          disabled={!canGoNext}
          className="btn-primary"
        >
          {nextButtonLabel} →
        </button>
      </div>
    </div>
  );
}
```

---

### Exit Tutorial Confirmation Dialog

```typescript
function ExitTutorialDialog({ onConfirm, onCancel }: ExitDialogProps) {
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h3>Exit Tutorial?</h3>
        <p>Your progress will not be saved. You can restart the tutorial anytime from the home page.</p>
        <div className="modal-actions">
          <button onClick={onCancel} className="btn-secondary">
            Stay in Tutorial
          </button>
          <button onClick={onConfirm} className="btn-danger">
            Exit
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## Navigation Summary

Here's the complete navigation control set for the tutorial:

| Control | Location | Behavior | All Steps? |
|---------|----------|----------|------------|
| **Next Button** | Bottom-right of tooltip | Advance to next step | Yes (disabled until interactive task complete) |
| **Back Button** | Bottom-left of tooltip | Return to previous step | Yes (except Step 1) |
| **Exit Button** | Top-right corner (X icon) | Exit tutorial with confirmation | Yes |
| **Progress Indicator** | Top of tooltip | Show "Step X of 24" | Yes |
| **Progress Bar** | Below title | Visual completion percentage | Yes |

---

## Final Notes
This epic provides a comprehensive blueprint for an engaging, educational tutorial that will transform beginners into confident Acquire players. The interactive tasks and progressive disclosure ensure users learn by doing, not just reading.

**Estimated Development Time**: 1.5-2 weeks for full implementation

Good luck with your Lovable build! 🚀