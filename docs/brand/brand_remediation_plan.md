# Brand Remediation Plan — Implementation Checklist

**Purpose:** Execute the compliance recommendations identified in [brand_audit.md](./brand_audit.md)

**Priority:** HIGH — Complete before public release

---

## Quick Reference: Changes Required

### Summary of Changes
- 1 game title rename
- 7 hotel chain names to create
- 10+ files to update
- Tutorial to rewrite (hotel names)
- Legal disclaimer to add

**Estimated Effort:** 4-6 hours

---

## Phase 1: Create Original Hotel Names

### Step 1.1: Choose New Hotel Names
Choose 7 original names following the tier structure:

**Budget Tier (2 hotels)** — Low cost, accessible
- Current: Sackson, Tower
- Need: 2 original names

**Midrange Tier (3 hotels)** — Medium cost, popular
- Current: Worldwide, American, Festival
- Need: 3 original names

**Premium Tier (2 hotels)** — High cost, exclusive
- Current: Continental, Imperial
- Need: 2 original names

**Recommendation:** Create a thematic naming scheme (e.g., by city, by architectural style, by time period)

**Example Options:**
```
BUDGET TIER:
- The Summit Hotel / Plaza Inn
- The Meridian / Grand Central

MIDRANGE TIER:
- The Pinnacle / Nexus Tower
- The Prospect / Horizon Plaza
- The Sterling / Grandview

PREMIUM TIER:
- The Apex / Crown Tower
- The Prestige / Empire Heights
```

### Step 1.2: Document the Mapping
Create a mapping file: `/docs/hotel_name_mapping.md`

```markdown
# Hotel Name Mapping: Original → New Names

| Original | New Name | Tier | Internal ID | Color |
|---|---|---|---|---|
| Sackson | [NEW] | Budget | sackson | Orange |
| Tower | [NEW] | Budget | tower | Yellow |
| Worldwide | [NEW] | Midrange | worldwide | Purple |
| American | [NEW] | Midrange | american | Blue |
| Festival | [NEW] | Midrange | festival | Green |
| Continental | [NEW] | Premium | continental | Red |
| Imperial | [NEW] | Premium | imperial | Pink |
```

**Status:** [ ] PENDING — Need hotel name decisions

---

## Phase 2: Update Game Title

### Step 2.1: Choose New Game Title

**Options:**
- `"[HotelName] - A Strategy Game"` (single hotel name branding)
- `"Empire Hotel"` or `"Hotel Tycoon"` (generic business theme)
- Keep current name but add attribution: `"Acquire-Inspired: [Custom Title]"`

**Recommendation:** If renaming, choose something that:
- ✅ Is original and memorable
- ✅ Relates to hotel/business theme
- ✅ Differentiates from "Acquire"

### Step 2.2: Update Files with New Title

| File | Location | Current Text | Change To |
|---|---|---|---|
| README.md | Line 1 | `# Acquire - Online Board Game` | `# [NEW TITLE] - Online Board Game` |
| README.md | Line 5 | `A digital implementation of the classic Acquire board game...` | `[New description without "Acquire" reference]` |
| index.html | Line 6 | `<title>Lovable App</title>` | `<title>[NEW TITLE]</title>` |
| index.html | Line 20 | `<meta property="og:title" content="Lovable App">` | `<meta property="og:title" content="[NEW TITLE]">` |
| src/pages/Index.tsx | Line 91 | `Acquire` | `[NEW TITLE]` |
| src/components/game/OnlineLobby.tsx | CardTitle | `Acquire` | `[NEW TITLE]` |
| src/components/game/GameContainer.tsx | h1 heading | `Acquire` | `[NEW TITLE]` |

**Status:** [ ] PENDING — Need title decision

---

## Phase 3: Update Hotel Names in Code

### Step 3.1: Update `/src/types/game.ts` — Chain Definitions

**File:** `/src/types/game.ts` (lines 124-132)

**Current Code:**
```typescript
export const CHAINS: Record<ChainName, ChainInfo> = {
  sackson: { name: 'sackson', displayName: 'Sackson', tier: 'budget', color: 'hsl(25, 95%, 53%)', textColor: 'white' },
  tower: { name: 'tower', displayName: 'Tower', tier: 'budget', color: 'hsl(45, 93%, 47%)', textColor: 'black' },
  worldwide: { name: 'worldwide', displayName: 'Worldwide', tier: 'midrange', color: 'hsl(280, 67%, 60%)', textColor: 'white' },
  american: { name: 'american', displayName: 'American', tier: 'midrange', color: 'hsl(217, 91%, 60%)', textColor: 'white' },
  festival: { name: 'festival', displayName: 'Festival', tier: 'midrange', color: 'hsl(142, 71%, 45%)', textColor: 'white' },
  continental: { name: 'continental', displayName: 'Continental', tier: 'premium', color: 'hsl(0, 84%, 60%)', textColor: 'white' },
  imperial: { name: 'imperial', displayName: 'Imperial', tier: 'premium', color: 'hsl(330, 81%, 60%)', textColor: 'white' },
};
```

**Update Strategy:**
- Change `displayName` values only (keep internal `name` unchanged)
- Keep all colors and tier assignments identical

**Example:**
```typescript
export const CHAINS: Record<ChainName, ChainInfo> = {
  sackson: { name: 'sackson', displayName: 'The Summit', tier: 'budget', color: 'hsl(25, 95%, 53%)', textColor: 'white' },
  tower: { name: 'tower', displayName: 'Plaza Inn', tier: 'budget', color: 'hsl(45, 93%, 47%)', textColor: 'black' },
  // ... etc
};
```

**Status:** [ ] PENDING — Need hotel names first

---

### Step 3.2: Update `/src/components/Tutorial/tutorialSteps.ts` — Tutorial References

**Critical Locations to Update:**

#### Step 10: "The 7 Hotel Chains" (lines 159-179)
**Current:**
```typescript
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
  ...
}
```

**Update:** Replace all hotel names with new names, keeping colors and tier structure

#### Step 1: Welcome (line 9)
**Current:** `title: 'Welcome to Acquire!',`
**Update:** `title: 'Welcome to [NEW GAME TITLE]!',`

#### Step 2: Goal (line 29)
**Current:** `title: 'Goal of Acquire',`
**Update:** `title: 'Goal of [NEW GAME TITLE]',`

#### Step 6: Chain Concept (line 96)
**Current:** `title: 'Hotel Chains - The Heart of Acquire',`
**Update:** `title: 'Hotel Chains - The Heart of [NEW GAME TITLE]',`

#### Step 24: Complete (line 424)
**Current:** `**You're ready to play Acquire!**`
**Update:** `**You're ready to play [NEW GAME TITLE]!**`

#### Step 8: Select Sackson (line 132)
**Current:** `Select **"Sackson"** from the list.`
**Update:** `Select **"[NEW NAME for sackson]"** from the list.` (& update `expectedAction` value)

#### Step 21: Dissolved Festival (line 363)
**Current:** `Festival is dissolved. You have 2 Festival stocks left.`
**Update:** `[Festival name] is dissolved. You have 2 [new name] stocks left.`

**Status:** [ ] PENDING — Need hotel names + game title first

---

## Phase 4: Add Legal Disclaimer

### Step 4.1: Create `/docs/LEGAL.md`

**File:** `/docs/LEGAL.md`

**Content Template:**
```markdown
# Legal Disclaimer

This project is an unofficial, community-created implementation inspired by
the board game Acquire®.

## Not Affiliated
This project is **not affiliated with**, **endorsed by**, or **associated with**:
- Avalon Hill Games
- Wizards of the Coast
- Hasbro, Inc.
- The original Acquire board game or its publishers

## Fan Project
This is a fan-made, non-commercial educational project created to:
- Explore digital game implementations
- Learn software engineering practices
- Provide an online platform for fans of strategic board games

## Respect for Original Work
We acknowledge and respect the original Acquire board game, which has been
published since 1964 and remains a classic of strategic gameplay.

## Changes Made
To differentiate this implementation from the original game, we have:
- Created original hotel chain names
- Implemented custom rule variations
- Added unique UI/UX design
- Built online multiplayer support

## Usage
This software is provided as-is for educational and entertainment purposes.
Users assume all responsibility for their use of this project.

For questions about the original Acquire game, visit the official publisher:
[Wizards of the Coast - Avalon Hill](https://www.wizards.com/en/avalon-hill)
```

### Step 4.2: Add Disclaimer to README.md

Add section after introduction:

```markdown
## ⚠️ Legal Disclaimer

This is a **fan-made** implementation inspired by the board game Acquire®.
This project is not affiliated with or endorsed by Avalon Hill, Wizards of the Coast,
or Hasbro. See [LEGAL.md](./docs/LEGAL.md) for full disclaimer.
```

**Status:** [ ] READY TO IMPLEMENT

---

## Phase 5: Update Backend (Supabase)

### Step 5.1: Check `/supabase/functions/game-action/index.ts`

**Critical:** The server-side game logic must mirror the frontend

**Search for:**
- All hotel chain references (sackson, tower, worldwide, etc.)
- Chain display names
- Any hardcoded chain references

**Action:** Apply same changes as frontend

**Status:** [ ] NEEDS REVIEW — Check if backend duplicates chain definitions

---

## Phase 6: Add Attribution in Game UI

### Step 6.1: Add Footer Attribution (Optional)

Consider adding to main pages:

```typescript
<p className="text-xs text-muted-foreground text-center">
  [Game Title] - Inspired by the classic board game Acquire®
</p>
```

Or in game's About/Help section:

```markdown
### About This Game

[Game Title] is inspired by the strategic hotel-building game Acquire®.

This is a community-created implementation with:
- Original hotel chain names
- Custom rule variations
- Online multiplayer support

[See full disclaimer →]
```

**Status:** [ ] OPTIONAL

---

## Implementation Checklist

### 1️⃣ Decisions Required

- [ ] **Choose 7 new hotel chain names** (Budget: 2, Midrange: 3, Premium: 2)
  - Document in `/docs/hotel_name_mapping.md`

- [ ] **Choose new game title** (or decide to keep "Acquire" with attribution)
  - Option A: Brand new title
  - Option B: "[Title] - Acquire-inspired"
  - Option C: Keep "Acquire" + add legal disclaimer

### 2️⃣ Core Updates (Required for Compliance)

#### Update Game Title
- [ ] Update README.md title and description
- [ ] Update index.html `<title>` tag
- [ ] Update index.html `<meta>` tags (og:title, twitter:title, etc.)
- [ ] Update `/src/pages/Index.tsx` line 91 heading
- [ ] Update `/src/components/game/OnlineLobby.tsx` CardTitle
- [ ] Update `/src/components/game/GameContainer.tsx` h1 heading
- [ ] Update tutorial titles (steps 1, 2, 6, 24)

#### Update Hotel Names
- [ ] Update `/src/types/game.ts` lines 124-132 (CHAINS definitions)
- [ ] Update `/src/components/Tutorial/tutorialSteps.ts`:
  - [ ] Step 1 (title)
  - [ ] Step 2 (title)
  - [ ] Step 6 (title)
  - [ ] Step 8 (Sackson → new name)
  - [ ] Step 10 (all 7 names)
  - [ ] Step 19 (Sackson/Festival merger)
  - [ ] Step 21 (Festival disposal)
  - [ ] Step 24 (final message)
- [ ] Check `/supabase/functions/game-action/index.ts` for any chain name references
- [ ] Update any other UI components that display chain names

#### Add Legal Documentation
- [ ] Create `/docs/LEGAL.md`
- [ ] Add disclaimer section to README.md

### 3️⃣ Verification (Before Release)

- [ ] Run full test suite: `npm run test:run`
- [ ] Build project: `npm run build`
- [ ] Manual testing:
  - [ ] Start tutorial, verify step 10 displays new hotel names
  - [ ] Play full game, verify hotel names in UI
  - [ ] Verify no hardcoded "Acquire" brand names in UI
- [ ] Search codebase for remaining "Acquire" references:
  ```bash
  grep -r "Acquire" src/ --include="*.ts" --include="*.tsx" --include="*.md"
  ```
- [ ] Verify legal files exist and are complete

### 4️⃣ Optional Enhancements

- [ ] Add attribution in game UI footer or About section
- [ ] Add link to official Acquire® game
- [ ] Create changelog noting this version as "compliant"

---

## Execution Order

**Recommended sequence:**

1. **Day 1:** Finalize hotel names and game title (30 min)
2. **Day 1:** Update core type definitions `/src/types/game.ts` (15 min)
3. **Day 1:** Update tutorial file with all hotel/game names (45 min)
4. **Day 2:** Update all remaining files with game title (30 min)
5. **Day 2:** Add legal documentation (15 min)
6. **Day 2:** Check backend for duplicated definitions (30 min)
7. **Day 2:** Test and verify (1 hour)
8. **Day 2:** Final review and commit (30 min)

**Total estimated time:** 4-5 hours

---

## Git Strategy

### Single Commit Approach
Combine all changes into one atomic commit:

```bash
git add docs/brand_audit.md docs/brand_remediation_plan.md docs/LEGAL.md \
        docs/hotel_name_mapping.md src/ README.md index.html

git commit -m "refactor: rebrand game with original names and legal compliance

- Rename game from 'Acquire' to '[New Title]'
- Replace hotel chain names with original names
- Add legal disclaimer and attribution
- Update tutorial to reflect new branding
- Ensure compliance with IP guidelines

Closes #[issue-number]"
```

### Multi-Commit Approach (if preferred)
```bash
# Commit 1
git commit -m "docs: add brand audit and legal documentation"

# Commit 2
git commit -m "refactor: rename game title throughout codebase"

# Commit 3
git commit -m "refactor: replace hotel names with original names"
```

---

## Rollback Plan

If issues arise during implementation:

1. **Before changes:** Create backup branch
   ```bash
   git branch backup/pre-rebrand
   ```

2. **If major issues:** Can revert to last commit
   ```bash
   git reset --hard [commit-hash]
   ```

3. **If partial issues:** Can selectively revert files
   ```bash
   git checkout main -- src/types/game.ts
   ```

---

## Definition of Done

Remediation is complete when:

- ✅ All 7 hotel chains have original names
- ✅ Game title is original or properly attributed
- ✅ No "Acquire" trademark references in UI (except legal disclaimer)
- ✅ Tutorial displays new hotel names correctly
- ✅ Legal disclaimer is visible and clear
- ✅ All tests pass
- ✅ Build succeeds
- ✅ Manual gameplay verification complete
- ✅ Code review approved
- ✅ Changes merged to main branch

---

## References

- Original Audit: [brand_audit.md](./brand_audit.md)
- Hotel Name Mapping: [hotel_name_mapping.md](./hotel_name_mapping.md) (to be created)
- Legal Disclaimer: [LEGAL.md](./LEGAL.md) (to be created)

---

**Document Version:** 1.0
**Last Updated:** February 2026
**Status:** READY FOR IMPLEMENTATION
