# Acquire: Event Card Design Document

Status: pre-balancing. This document defines **what each card does** and **which variables must be fixed before any math can be run**. No values are final. Numbers shown are placeholders that make the card readable, not proposals.

---

## 1. How to read this document

Every card has:

- **Effect**: the rules text, in its loosest form.
- **Levers**: the variables that decide whether the card is fair. Each lever is phrased as a question with a bounded answer space.
- **Risk note**: where present, the specific way this card breaks if a lever is set wrong.

A card is "balanced" when its expected value in dollars, averaged across the game states in which a player would actually buy it, sits inside the target band for its price class. Levers are the only instruments available to move a card into that band. Price is an instrument only in the three tier model.

---

## 2. Lever glossary

Six lever types recur across the whole pool. Naming them makes the balancing pass mechanical rather than case by case.

### 2.1 Magnitude
How much the card does in one use. Share counts, dollar amounts, multipliers, number of tiles. The most direct lever and usually the last one to tune, because it is continuous. Example: does Corporate Espionage take 1 share or 2.

### 2.2 Scope
What the card is allowed to target. Restricting scope is how a card is kept from interacting with the parts of the game that are already tightly balanced. The most important scope question across the whole pool is **whether a card may touch a safe chain (11+ tiles)**, because safety is the single guarantee Acquire's economy rests on. Example: may Demolition Permit remove a tile from a safe chain.

### 2.3 Duration
How long the effect lasts. Three distinct classes, and they should not be mixed inside one price band:
- **Instant**: resolves and is gone.
- **Windowed**: applies for N turns or until a named trigger.
- **Permanent**: lasts until end of game or until the target chain dies.
Permanent effects are the hardest to price because their value is a function of remaining game length, which is unknown at purchase time.

### 2.4 Frequency and access
How often a card can be bought or used. Sub-levers: cards per turn, cards per game per player, copies of each card in the deck, whether a card is unique. This is the lever that controls **stacking**, which is where most combinations break. Two Franchise Expansions in one turn is a different game than one.

### 2.5 Compensation
What the target receives. A card that takes something can pay for it (market price, half price, nothing). Compensation is both a balance lever and a social lever: it decides whether the card feels like a business move or a mugging. Compensation also feeds money back into the economy, which matters because event cards otherwise act as a permanent money sink.

### 2.6 Cost shape
Whether the card's value is flat or scales with game state. Flat cards ("collect 500") are trivial to price and get weaker as the game grows. Scaling cards ("collect 100 per share") stay relevant but have an open-ended top end. **Every scaling card needs a cap**, or it cannot be priced at all in a single price model.

---

## 3. The card pool

24 candidates. Grouping is by mechanism, not by strength.

---

### Group A: Tile flow and information

---

#### A1. Market Scan
**Effect**: Look at the top 3 tiles of the bag. Keep 1, return the others to the bottom.

**Levers**:
- *Magnitude*: how many seen (2/3/5) and how many kept (1/2).
- *Scope*: returned to bottom, or reshuffled. Bottom is strictly stronger, because it also denies opponents those tiles for a while.
- *Frequency*: unlimited, or once per turn.

**Risk note**: none serious. This is the natural floor of the pool and a good calibration anchor for "what one price unit should buy".

---

#### A2. Insider Tip
**Effect**: Look at one opponent's rack.

**Levers**:
- *Magnitude*: all 6 tiles, or a random 3.
- *Duration*: one look, or you see their rack until your next turn.
- *Compensation*: does the target learn they were targeted.

**Risk note**: in a digital build this is free to implement and free to hide, so the temptation is to make it too generous. In a 4 player game, full rack knowledge of one opponent is worth more than it looks, because it tells you which mergers they cannot trigger.

---

#### A3. Land Bank
**Effect**: Reserve one tile from your rack. It is protected from becoming permanently unplayable and may be held indefinitely.

**Levers**:
- *Duration*: N turns, or until played.
- *Magnitude*: 1 tile or 2.
- *Scope*: does the reserved tile count against your rack limit of 6. If it does not, this is also a hand size increase, which is a second effect hiding inside the first.

**Risk note**: the interaction with dead tiles is the whole card. If reserved tiles are immune to the "would merge two safe chains" rule, the card silently rewrites a core rule.

---

#### A4. Surveyor
**Effect**: Discard any number of tiles from your rack and draw back up to 6.

**Levers**:
- *Magnitude*: full rack or maximum 3.
- *Cost shape*: free, or pay per tile discarded.
- *Frequency*: once per game per player is worth considering, since a full mulligan late is much stronger than early.

**Risk note**: overlaps heavily with Market Scan. Probably keep one of the two, not both, unless they land in different price tiers.

---

#### A5. Zoning Veto
**Effect**: Cancel the next player's tile placement. They return the tile to the bag, draw a replacement, and place nothing this turn.

**Levers**:
- *Scope*: any placement, or only one that would trigger a merger or found a chain. The restricted version is far more interesting and far less oppressive.
- *Magnitude*: do they still get their buy phase.
- *Frequency*: once per game per player, near certainly.

**Risk note**: the only card in the pool that removes a turn rather than altering it. Highest feel bad potential. In multiplayer it also has a kingmaking problem, since it hurts one specific player and helps everyone else equally.

---

### Group B: Money and shares

---

#### B1. Bridge Loan
**Effect**: Buy up to 5 shares this turn instead of 3. The 4th and 5th cost a premium.

**Levers**:
- *Magnitude*: 4 or 5 total shares.
- *Cost shape*: premium as a flat surcharge or a percentage (20%/50%).
- *Scope*: may the extra shares be in a chain you already control, or must they be spread.

**Risk note**: clean and easy to price, because it converts money to position at a known exchange rate. Good second calibration anchor.

---

#### B2. IPO Discount
**Effect**: All shares you buy this turn cost less.

**Levers**:
- *Magnitude*: one price tier down, or a flat percentage.
- *Scope*: does it apply to all chains or only to the cheapest tier.
- *Duration*: this turn only, almost certainly.

**Risk note**: value scales with share price, so it is worth roughly nothing early and a lot late. That curve is the opposite of most cards in the pool, which is actually useful for deck variety but bad for a single fixed price.

---

#### B3. Short Sell
**Effect**: Name an active chain. If it is absorbed within N rounds, collect a multiple of its share price. If not, pay a penalty.

**Levers**:
- *Magnitude*: payout multiple, penalty size.
- *Duration*: the window, in rounds. This is the dominant lever.
- *Scope*: may you name a chain you can merge yourself. If yes, the card is not a bet, it is a payout for something you were already going to do.

**Risk note**: flagged for possible cut. Self fulfilling unless scope forbids naming a chain adjacent to your own tiles, and that restriction is hard to state cleanly.

---

#### B4. Dividend Call
**Effect**: Each opponent pays you an amount based on your holdings in one chain.

**Levers**:
- *Magnitude*: rate per share.
- *Cost shape*: **the cap is mandatory**. Uncapped, this scales with both player count and holdings.
- *Scope*: paid by all players, or only by players who also hold that chain.

**Risk note**: transfers money between players rather than creating it, so it does not inflate the economy, but it can bankrupt a single player in one hit. Consider a floor rule so no player can be reduced below the price of one share.

---

#### B5. Buyback
**Effect**: Sell shares of one chain back to the bank above list price.

**Levers**:
- *Magnitude*: the premium (110%/125%/150%).
- *Scope*: how many shares, one chain or several.
- *Frequency*: once per game, likely.

**Risk note**: a liquidity valve. Its real function is letting a player escape a losing position, which is a genuine design decision, not just a number. Decide first whether escape hatches are wanted at all.

---

#### B6. Tender Offer
**Effect**: Offer an opponent a fixed price for 2 of their shares. They accept, or pay you a refusal fee.

**Levers**:
- *Magnitude*: offer price, refusal fee.
- *Cost shape*: is the offer price fixed by the card or chosen by the buyer. Buyer chosen turns this into a negotiation card, which is a different design goal.
- *Scope*: safe chains exempt or not.

**Risk note**: the refusal fee is what stops it being a pure "no thanks". Set too high it is a forced sale with extra steps.

---

### Group C: Merger manipulation

---

#### C1. Proxy Fight
**Effect**: In your next merger, count as holding extra shares of the defunct chain for bonus determination only. No shares actually change hands.

**Levers**:
- *Magnitude*: +1, +2 or +3 shares.
- *Scope*: majority bonus only, or minority too.
- *Duration*: next merger, or any merger within N rounds.

**Risk note**: well contained by design, since it never alters ownership and therefore never cascades into later mergers. Strong candidate for the mid band.

---

#### C2. Golden Parachute
**Effect**: Double your bonus in the next merger.

**Levers**:
- *Magnitude*: double or +50%.
- *Scope*: minority only, or both bonuses. Majority inclusion roughly triples the card's value in the games where it matters.
- *Duration*: next merger only.

**Risk note**: overlaps with Proxy Fight. They should not both exist at the same price. Proxy Fight changes *who wins*, Golden Parachute changes *how much*. The first is more interesting.

---

#### C3. Hostile Takeover
**Effect**: In a merger you trigger, choose which chain survives even if it is not the larger one.

**Levers**:
- *Scope*: the permitted size gap (equal only, 2 tiles, any). This is the whole card.
- *Scope*: may the surviving choice destroy a safe chain. Almost certainly no.
- *Frequency*: once per game per player.

**Risk note**: at "any size gap" this is the most powerful card in the pool, because it lets a player dismantle the board leader's position at will. Gap of 2 keeps it as a tactical tool.

---

#### C4. Antitrust Filing
**Effect**: One chain is frozen for a round. It cannot be merged, expanded, or traded.

**Levers**:
- *Duration*: one round or one full turn cycle.
- *Scope*: which of the three restrictions actually apply. Freezing only mergers is a defensive card; freezing everything is a denial card.
- *Frequency*: once per game per player.

**Risk note**: second cut candidate alongside Zoning Veto. Blocking expansion can make an opponent's tiles unplayable, which is a turn denial in disguise.

---

#### C5. Spin Off
**Effect**: Split a large chain into two, if board geometry allows. You take a founder share of the new chain.

**Levers**:
- *Magnitude*: minimum chain size (12+/15+), founder shares granted (1/2).
- *Scope*: does the split void safety for both halves. If yes, this is a safety removal card with a costume on.
- *Compensation*: what happens to existing holders of the original chain.

**Risk note**: the most rules heavy card in the pool. The geometry check alone needs a clear definition. Cheap to implement digitally, expensive to explain in rules text.

---

### Group D: Board and structure

---

#### D1. Demolition Permit
**Effect**: Remove one tile from the board.

**Levers**:
- *Scope*: chain must stay connected; chain must stay above a minimum size; **may it reduce a chain below the safety threshold of 11**.
- *Magnitude*: 1 tile or 2.
- *Cost shape*: does the removed tile return to the bag or leave the game.

**Risk note**: the safety clause is not a detail, it is the card. Allowing a drop below 11 turns this into a merger enabler worth several thousand in bonuses. Blocking it keeps the card as a modest tempo tool.

---

#### D2. Franchise Expansion
**Effect**: Place a second tile this turn.

**Levers**:
- *Scope*: may the extra tile found a chain; may it trigger a merger. Both defaults should be no.
- *Magnitude*: one extra tile or two.
- *Frequency*: once per turn maximum, non stacking.

**Risk note**: with both scope restrictions removed, this is a purchasable merger trigger and the strongest card in the pool by a wide margin.

---

#### D3. Charter Renewal
**Effect**: Refound a chain that has been absorbed, elsewhere on the board. Take extra founder shares.

**Levers**:
- *Magnitude*: 1 or 2 founder shares.
- *Scope*: any defunct chain, or only one absorbed this game by someone else.
- *Frequency*: once per chain.

**Risk note**: mild, and it adds a nice late game pressure valve when the board is running out of chain slots.

---

#### D4. Skyscraper
**Effect**: One chain permanently counts as larger for share price purposes only.

**Levers**:
- *Magnitude*: +2 or +3 tiles equivalent.
- *Scope*: **pricing only**. It must not affect safety or merger size comparison, or it becomes a stealth Hostile Takeover.
- *Frequency*: can a chain be upgraded twice.

**Risk note**: benefits every holder of that chain, not just the buyer. That is either a flaw or a feature depending on whether shared benefit cards are wanted in the design.

---

#### D5. Ground Lease
**Effect**: Whenever any player expands a chosen chain, you collect a fee.

**Levers**:
- *Magnitude*: fee per tile.
- *Duration*: until the chain is absorbed, or N rounds.
- *Cost shape*: **uncapped by default**. Needs either a total cap or a hard duration.

**Risk note**: flagged for cut. Open ended and grows with game length, which is exactly the property that resists fixed pricing.

---

#### D6. Five Star Upgrade
**Effect**: Permanently upgrade a chain of at least 6 tiles. All players holding shares in it collect a recurring dividend at the start of each of their turns. The chain also moves up one price tier.

**Levers**:
- *Magnitude*: dividend rate as a percentage of current share price.
- *Scope*: minimum chain size; whether safe chains qualify; whether the price tier bump is included at all, since that is effectively a second card bolted on.
- *Duration*: permanent, or until the chain is absorbed.
- *Frequency*: once per chain, and possibly once per game globally.
- *Compensation*: does the buyer get an exclusive dividend round before others start collecting.

**Risk note**: this card introduces the only source of **recurring income** in Acquire. Base Acquire has exactly two money faucets, merger bonuses and share sales, both of which are event driven and self limiting. A recurring faucet changes the shape of the entire economy: it makes holding shares better than trading them, lengthens the game, and rewards whoever is already ahead. If only one card from this pool receives dedicated simulation, it should be this one.

---

#### D7. Board Seat
**Effect**: Look at the top 3 event cards and buy one immediately at half price.

**Levers**:
- *Magnitude*: how many seen, discount size.
- *Scope*: may the bought card be played immediately or only next turn.
- *Frequency*: once per turn.

**Risk note**: a meta card. Its value is the average value of the whole deck, which means **it cannot be priced until every other card is priced**. It also sets the effective search cost of the deck, so it changes how often high tier cards appear. Price it last, or cut it.

---

## 4. Pricing model A: single price

Every event card costs the same, for example 300, payable once per turn during the buy phase.

### 4.1 Two sub variants, and they are very different games

**A-random**: pay the price, draw the top card of a shuffled deck.
Balance requirement is only that the **deck average** sits at a fair value. Individual cards may vary widely, since you cannot select for the strong ones. Variance becomes a feature. This is by far the easier version to balance.

**A-open**: pay the price, choose freely from a face up market or the full list.
Balance requirement is that **every card is within a narrow band of every other card**, because players will simply always buy the best one. Any card outside the band is either an auto buy or dead text. This is the hardest of the three models to balance, harder than the three tier system.

The simplicity argument favours a single price. The balancing argument only favours it in the A-random form.

### 4.2 What a single price forces

- **The band is narrow.** All 24 cards must be tuned to roughly the same expected value. In practice that means either lifting the floor cards (Market Scan, Insider Tip) or gutting the ceiling cards (Five Star Upgrade, Franchise Expansion) until they meet in the middle. The pool loses its dynamic range.
- **Situational cards are structurally underpowered.** A card that is only useful in 30% of game states must be roughly 3x as strong in those states to match a card that is always useful. That raises variance and produces swingy moments.
- **The price becomes a function of game phase, not of card.** A fixed 300 is a large sum on turn 3 and pocket change on turn 30. The single price model needs a separate answer for this: either the price scales with the round number, or with the highest current share price, or event cards are simply understood to be a late game mechanic.
- **Levers carry the entire balancing load.** With price removed as an instrument, scope and frequency restrictions become the only way to bring a strong card down. Expect more rules text per card, not less, which partly cancels the simplicity gain.

### 4.3 What it buys

- One rule to explain, one number to remember.
- No tier boundary arguments, which are the usual source of "why is this card tier 2" complaints.
- Trivially easy to implement and to change globally: the price is a single constant.
- Buying decisions stay fast, which matters for a real time multiplayer build.

---

## 5. Pricing model B: three tiers

Three price points that echo the existing chain tiers, which gives the model a thematic hook the game already teaches.

Placeholder tiers:
- **Tier 1**: information and tempo. Never changes ownership of anything.
- **Tier 2**: alters the outcome of an exchange that was already happening.
- **Tier 3**: changes the structure or the economy itself.

### 5.1 Provisional tier assignment

| Tier | Cards |
|---|---|
| 1 | Market Scan, Insider Tip, Land Bank, Surveyor, Bridge Loan, IPO Discount |
| 2 | Zoning Veto, Proxy Fight, Golden Parachute, Tender Offer, Buyback, Demolition Permit, Charter Renewal, Dividend Call, Antitrust Filing |
| 3 | Franchise Expansion, Five Star Upgrade, Hostile Takeover, Spin Off, Skyscraper, Short Sell, Ground Lease, Board Seat |

### 5.2 What three tiers force

- **Tiers must not overlap in value.** If the best tier 1 card is stronger than the worst tier 2 card, the tier boundary is fiction and players will notice within two games. This is the main failure mode.
- **Only three price points exist, but 24 value levels do.** Each card still has to be tuned to its tier's midpoint. Tiers reduce the required precision, they do not remove it.
- **Rich player problem.** Acquire's money distribution is highly uneven by mid game. Tier 3 cards are reachable only by whoever just won a merger, which means the strongest cards flow to the player already ahead. A single price has the same issue but much less sharply. If tiers are used, consider a catch up mechanism or a holdings based price.
- **Three numbers to explain, plus which card sits where.** Meaningfully more rules surface.

### 5.3 What it buys

- Real dynamic range. Five Star Upgrade can stay a genuinely game changing card instead of being nerfed into the middle band.
- Price itself becomes a balancing instrument, so scope restrictions can stay looser and rules text per card stays shorter.
- Natural pacing: cheap cards early, structural cards late, without needing a separate rule for it.
- Fits the existing three tier chain pricing, so it costs almost nothing to teach.

---

## 6. Comparison summary

| | Single price (A-random) | Single price (A-open) | Three tiers |
|---|---|---|---|
| Rules to teach | 1 number | 1 number | 3 numbers plus tier list |
| Balancing target | deck average | every card, narrow band | three band midpoints |
| Balancing difficulty | low | high | medium |
| Dynamic range preserved | yes, via variance | no | yes |
| Player agency in purchase | low | high | high |
| Rules text per card | medium | high | low to medium |
| Rich get richer risk | low | low | high |
| Cost to change after playtest | one constant | one constant | three constants plus reassignment |

---

## 7. Open questions before any math

1. **Is the deck random or selectable?** This single decision determines everything downstream and should be settled first. It matters more than the number of price tiers.
2. **Does the price scale with game phase?** A fixed number in a game with exponentially growing share prices behaves differently in each third of the game.
3. **How many cards per turn, and per game per player?** Stacking is where combinations break, not individual cards.
4. **May any card touch a safe chain?** A single global rule here would settle roughly a third of the scope levers in one line.
5. **Does the event deck create money or only move it?** Cards paying from the bank are inflationary; cards paying between players are not. Mixing both is fine, but the ratio should be deliberate.
6. **Are shared benefit cards wanted?** Skyscraper and Five Star Upgrade benefit all holders. That is a distinct design flavour and it needs a yes or no.
7. **Cut list confirmation.** Ground Lease and Short Sell for uncapped scaling, Zoning Veto and Antitrust Filing for turn denial, Board Seat for circular pricing, and one of Market Scan / Surveyor and one of Proxy Fight / Golden Parachute for redundancy. That is up to 7 cuts, leaving 17.

---

## 8. Note on the digital build

Since this runs as a real time multiplayer web app rather than on cardboard, several levers are effectively free to implement that would be prohibitive physically: hidden information (Insider Tip), permanent per turn upkeep (Five Star Upgrade, Ground Lease), geometry validation (Spin Off), and conditional windows (Short Sell). That is an advantage, but it is also a trap. Bookkeeping cost has historically been the natural brake on this kind of mechanic, and removing it means the only remaining brake is deliberate design. Complexity that the server absorbs silently still lands in the player's head.