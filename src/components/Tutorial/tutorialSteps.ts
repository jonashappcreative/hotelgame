// Tutorial step definitions

import { TutorialStep } from './types';

export const tutorialSteps: TutorialStep[] = [
  // Step 1: Introduction
  {
    id: 1,
    title: 'Welcome to Acquire!',
    content: `In this tutorial, you'll learn:

• How to play tiles on the board
• How to found and grow hotel chains
• How to buy and trade stocks
• How to handle mergers
• How to win the game

This interactive tutorial takes about 10-15 minutes.
You can exit anytime.

Ready to become a hotel tycoon?`,
    nextButtonLabel: "Let's Begin",
    showBack: false,
  },

  // Step 2: Game Objective
  {
    id: 2,
    title: 'Goal of Acquire',
    content: `Your objective: **Become the richest player!**

You'll earn money by:

🏨 Building hotel chains (placing tiles)
💰 Buying stocks in hotel chains
📈 Earning bonuses when chains merge

The player with the most cash at the end wins!`,
    nextButtonLabel: 'Got it!',
  },

  // Step 3: Game Board Overview
  {
    id: 3,
    title: 'The Game Board',
    content: `This is the **9×12 board** where you'll build your hotel empire.

Each square has a coordinate:
• Rows: 1-9 (top to bottom)
• Columns: A-L (left to right)

Example: Square "5F" is at Row 5, Column F

These coordinates match the tiles in your hand!`,
    spotlightSelector: '[data-tutorial="game-board"]',
    spotlightShape: 'rectangle',
  },

  // Step 4: Player Hand Introduction
  {
    id: 4,
    title: 'Your Tile Hand',
    content: `These are your **6 tiles**. Each tile shows a board coordinate where you can play.

Every turn, you'll:
1. Play one tile from your hand
2. Draw a new tile automatically

Right now, all your tiles are playable!

Let's place one in the next step.`,
    spotlightSelector: '[data-tutorial="player-hand"]',
    spotlightShape: 'rectangle',
  },

  // Step 5: Place First Tile (Interactive)
  {
    id: 5,
    title: 'Place Your First Tile',
    content: `Let's place the **6E** tile!

Click the "6E" tile in your hand below, then click square 6E on the board.`,
    spotlightSelector: '[data-tutorial="tile-6E"]',
    isInteractive: true,
    interactiveType: 'place_tile',
    expectedAction: { type: 'place_tile', value: '6E' },
  },

  // Step 6: Hotel Chain Concept
  {
    id: 6,
    title: 'Hotel Chains - The Heart of Acquire',
    content: `When **2 or more tiles** are next to each other (horizontally or vertically), they form a **HOTEL CHAIN**.

Chains are powerful because:
• They have unique names and colors
• They make stocks valuable
• They grow as you add more tiles

Let's found your first chain!`,
    spotlightSelector: '[data-tutorial="game-board"]',
    spotlightShape: 'rectangle',
  },

  // Step 7: Found a Hotel Chain (Interactive)
  {
    id: 7,
    title: 'Found a Hotel Chain',
    content: `Place tile **6D** next to your 6E tile.

This will create your first hotel chain!

Click your 6D tile, then click board square 6D.`,
    spotlightSelector: '[data-tutorial="tile-6D"]',
    isInteractive: true,
    interactiveType: 'place_tile',
    expectedAction: { type: 'place_tile', value: '6D' },
  },

  // Step 8: Chain Selection (Interactive - part of step 7 flow)
  {
    id: 8,
    title: 'Choose a Chain to Found',
    content: `A new chain is being created! You get to choose which one.

Select **"Sackson"** from the list.

(In a real game, you can choose any available chain)`,
    spotlightSelector: '[data-tutorial="chain-selector"]',
    isInteractive: true,
    interactiveType: 'select_chain',
    expectedAction: { type: 'select_chain', value: 'sackson' },
  },

  // Step 9: Founder's Bonus
  {
    id: 9,
    title: "Founder's Bonus! 🎁",
    content: `As the founder of Sackson, you receive:

**1 FREE Sackson stock!**

This is your reward for creating the chain.

Look at your portfolio - you now own 1 Sackson stock!

Stocks are how you make money in this game.`,
    spotlightSelector: '[data-tutorial="player-stocks"]',
    nextButtonLabel: 'Nice!',
  },

  // Step 10: The Seven Hotel Chains
  {
    id: 10,
    title: 'The 7 Hotel Chains',
    content: `There are 7 hotel chains in Acquire:

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

Higher-tier chains = More valuable stocks!`,
    nextButtonLabel: 'Got it',
  },

  // Step 11: Buying Stocks (Interactive)
  {
    id: 11,
    title: 'Buying Stocks',
    content: `After placing a tile, you can buy up to **3 stocks** from any ACTIVE chain.

Sackson is active (you founded it!).

Let's buy **2 Sackson stocks**.

Current price: **$200** per share
Cost: **$400** total

Use the + button to buy 2 stocks, then confirm.`,
    spotlightSelector: '[data-tutorial="stock-purchase"]',
    isInteractive: true,
    interactiveType: 'buy_stock',
    expectedAction: { type: 'buy_stock', value: '2' },
  },

  // Step 12: Money & Portfolio Overview
  {
    id: 12,
    title: 'Your Money & Portfolio',
    content: `Keep track of your wealth:

💵 **Cash:** $5,600
(Money you can spend)

📊 **Stocks:** 3 Sackson
(Current value: 3 × $200 = $600)

💎 **Net Worth:** $6,200
(Cash + Stock value)

Your goal: Maximize net worth by game end!`,
    spotlightSelector: '[data-tutorial="player-info"]',
  },

  // Step 13: Growing Hotel Chains (Interactive)
  {
    id: 13,
    title: 'Growing Your Chain',
    content: `Place a tile next to Sackson to make it grow!

Larger chains = More valuable stocks!

Place your **6C** tile adjacent to the Sackson chain.`,
    spotlightSelector: '[data-tutorial="tile-6C"]',
    isInteractive: true,
    interactiveType: 'place_tile',
    expectedAction: { type: 'place_tile', value: '6C' },
  },

  // Step 14: Continue Growing (Interactive)
  {
    id: 14,
    title: 'Keep Growing!',
    content: `Sackson now has 3 tiles. Let's make it even bigger!

Place your **5E** tile to grow Sackson to 4 tiles.`,
    spotlightSelector: '[data-tutorial="tile-5E"]',
    isInteractive: true,
    interactiveType: 'place_tile',
    expectedAction: { type: 'place_tile', value: '5E' },
  },

  // Step 15: Stock Values & Price Tiers
  {
    id: 15,
    title: 'How Stock Prices Work',
    content: `Stock value depends on **TWO factors**:

**1️⃣ Chain Size** (number of tiles)
• Size 2: $200-300
• Size 4-5: $400-500
• Size 11+: $600-700
• Size 41+: $900-1000

**2️⃣ Chain Tier**
• Budget (Sackson, Tower): Lowest prices
• Mid-range: Medium prices  
• Premium (Continental, Imperial): Highest prices

Strategy: **Buy early when chains are small!**`,
    nextButtonLabel: 'Understood',
  },

  // Step 16: Information Card
  {
    id: 16,
    title: 'The Information Card 📋',
    content: `The information card shows you:
• Current stock prices for all chains
• Majority/Minority bonuses
• Available stocks in the bank
• Chain sizes

Use this before buying stocks or during mergers!

You can access this anytime during the game.`,
    spotlightSelector: '[data-tutorial="info-card"]',
    nextButtonLabel: 'Got it',
  },

  // Step 17: Merger Introduction
  {
    id: 17,
    title: 'Hotel Chain Mergers 🤝',
    content: `A **MERGER** happens when you place a tile that connects two hotel chains.

What happens:
• The **LARGER** chain survives
• The **SMALLER** chain is dissolved
• Shareholders get **BONUSES**
• You make decisions about your stocks

Mergers are where **BIG money** is made!

Let's set one up...`,
    nextButtonLabel: 'Show me!',
  },

  // Step 18: Execute a Merger (Interactive)
  {
    id: 18,
    title: 'Trigger a Merger',
    content: `We've placed a Festival chain near Sackson.

Place your **5D** tile between Sackson and Festival.

This will merge the two chains!`,
    spotlightSelector: '[data-tutorial="tile-5D"]',
    isInteractive: true,
    interactiveType: 'place_tile',
    expectedAction: { type: 'place_tile', value: '5D' },
  },

  // Step 19: Surviving vs. Dissolved Chain
  {
    id: 19,
    title: 'Merger Result',
    content: `**Sackson survived** and absorbed Festival!

Rules:
✅ Larger chain survives (Sackson had 4, Festival had 3)
✅ All Festival tiles become Sackson tiles
✅ Sackson is now 8 tiles strong

If chains are **TIED** in size, YOU (the active player) choose which survives.

Now, let's talk about the money you made...`,
    spotlightSelector: '[data-tutorial="game-board"]',
    nextButtonLabel: 'Show me the money!',
  },

  // Step 20: Majority & Minority Bonuses
  {
    id: 20,
    title: 'Merger Bonuses! 💰',
    content: `When a chain is dissolved, shareholders get bonuses:

🥇 **MAJORITY** holder (most stocks): 10× stock price
🥈 **MINORITY** holder (2nd most): 5× stock price

Example (Festival dissolved):
• Stock price: $300
• Majority bonus: $3,000
• Minority bonus: $1,500

If there's a **TIE**, players split the bonuses equally.`,
    nextButtonLabel: 'Nice!',
  },

  // Step 21: Stock Disposal Options
  {
    id: 21,
    title: 'What to Do With Your Stocks?',
    content: `Festival is dissolved. You have 2 Festival stocks left.

You have **3 options**:

🔵 **KEEP:** Hold for if chain is re-founded
💵 **SELL:** Get cash now (at current price)
🔄 **TRADE:** Exchange 2:1 for surviving chain stock

Each option has strategic value depending on your goals!`,
    nextButtonLabel: 'Got it',
  },

  // Step 22: Complete Turn Sequence
  {
    id: 22,
    title: 'Your Turn Sequence',
    content: `Every turn has 3 phases:

**1️⃣ PLACE TILE** (mandatory)
Play one tile from your hand

**2️⃣ BUY STOCKS** (optional)
Purchase 0-3 stocks from active chains

**3️⃣ DRAW TILE** (automatic)
You automatically draw 1 new tile

Then the next player takes their turn!`,
    nextButtonLabel: 'Clear!',
  },

  // Step 23: Game End Conditions
  {
    id: 23,
    title: 'When Does the Game End?',
    content: `The game ends when:

**1️⃣ Any chain reaches 41+ tiles**
Automatic game end

**2️⃣ Players vote to end the game**
• Voting allowed when at least one chain is "safe" (11+ tiles)
• Safe chains cannot be merged (protected)

Strategy tip: **Timing the end-game can give you an advantage!**`,
    nextButtonLabel: 'Got it',
  },

  // Step 24: Tutorial Complete
  {
    id: 24,
    title: 'Tutorial Complete! 🎉',
    content: `Congratulations! You've learned:

✅ How to place tiles and read the board
✅ How to found and grow hotel chains
✅ How to buy and manage stocks
✅ How to handle mergers and bonuses
✅ How the game ends and scoring works

**You're ready to play Acquire!**

What would you like to do?`,
    nextButtonLabel: 'Finish',
    showBack: true,
  },
];
