# 🎯 Brand Remediation Checklist

**Quick reference for implementation team**

---

## 📋 PHASE 1: DECISIONS (Do This First!)

**⏳ Status: AWAITING DECISIONS**

### Decision 1️⃣: Choose 7 Hotel Chain Names

**Format:** 2 Budget + 3 Midrange + 2 Premium

**Placeholder Names (Choose Your Own):**
```
Budget (2):         _________________________    _________________________
Midrange (3):       _________________________    _________________________    _________________________
Premium (2):        _________________________    _________________________
```

**Deadline:** ____________________

---

### Decision 2️⃣: Choose Game Title

**Select one:**
- [ ] Option A: **Brand new title**
  - Example: "Hotel Empire", "Tycoon Quest"
  - New Title: _________________________

- [ ] Option B: **Acquire-inspired attribution** (RECOMMENDED)
  - Example: "[Title] - Acquire-Inspired Game"
  - New Title: _________________________

- [ ] Option C: Keep "Acquire"
  - Not recommended (IP risk)

**Deadline:** ____________________

---

### Decision 3️⃣: Release Timeline

- [ ] **Before Public Release** (RECOMMENDED)
- [ ] **After Beta Testing**
- [ ] **Not Urgent** (Internal Only)

**Target Release Date:** ____________________

---

## 💻 PHASE 2: IMPLEMENTATION (After Decisions Made)

**⏰ Estimated Time: 4-5 hours**

### Step A: Update Core Type Definitions
**File:** `src/types/game.ts`

- [ ] Line 125: Update `sackson` displayName
- [ ] Line 126: Update `tower` displayName
- [ ] Line 127: Update `worldwide` displayName
- [ ] Line 128: Update `american` displayName
- [ ] Line 129: Update `festival` displayName
- [ ] Line 130: Update `continental` displayName
- [ ] Line 131: Update `imperial` displayName

**⏱️ Time: 15 minutes**

---

### Step B: Update Tutorial File
**File:** `src/components/Tutorial/tutorialSteps.ts`

- [ ] Line 9: Update step 1 title (game name)
- [ ] Line 29: Update step 2 title (game name)
- [ ] Line 96: Update step 6 title (game name)
- [ ] Line 132: Update step 8 (replace "Sackson" reference)
- [ ] Line 138: Update step 8 expectedAction value
- [ ] Lines 162-177: Update step 10 (all 7 hotel names)
- [ ] Line 327: Update step 19 (merger example)
- [ ] Line 363: Update step 21 (dissolved chain)
- [ ] Line 424: Update step 24 (game name)

**⏱️ Time: 45 minutes**

---

### Step C: Update Game Title in UI
**Update these 4 files:**

#### File: `README.md`
- [ ] Line 1: `# Acquire` → `# [NEW TITLE]`
- [ ] Line 5: Update game description

#### File: `index.html`
- [ ] Line 6: `<title>` tag
- [ ] Line 20: `og:title` meta tag
- [ ] Line 21: `twitter:title` meta tag
- [ ] Line 22: `og:description` meta tag
- [ ] Line 23: `twitter:description` meta tag

#### File: `src/pages/Index.tsx`
- [ ] Line 91: Update heading text

#### File: `src/components/game/OnlineLobby.tsx`
- [ ] CardTitle component: Update "Acquire"

#### File: `src/components/game/GameContainer.tsx`
- [ ] h1 heading: Update "Acquire"

**⏱️ Time: 30 minutes**

---

### Step D: Add Legal Documentation

#### Create: `docs/LEGAL.md`
- [ ] Copy template from brand_remediation_plan.md
- [ ] Customize with your game name
- [ ] Review for accuracy

#### Update: `README.md`
- [ ] Add disclaimer section after introduction
- [ ] Link to LEGAL.md

**⏱️ Time: 15 minutes**

---

### Step E: Create Reference Document

#### Create: `docs/hotel_name_mapping.md`

```markdown
# Hotel Name Mapping

| Original Name | New Name | Tier | Internal ID | Color |
|---|---|---|---|---|
| Sackson | [NEW] | Budget | sackson | Orange |
| Tower | [NEW] | Budget | tower | Yellow |
| Worldwide | [NEW] | Midrange | worldwide | Purple |
| American | [NEW] | Midrange | american | Blue |
| Festival | [NEW] | Midrange | festival | Green |
| Continental | [NEW] | Premium | continental | Red |
| Imperial | [NEW] | Premium | imperial | Pink |
```

**⏱️ Time: 5 minutes**

---

### Step F: Backend Verification (IMPORTANT!)

**File:** `supabase/functions/game-action/index.ts`

- [ ] Search for all hotel chain references
- [ ] Check if chains are defined in backend
- [ ] If duplicated: Update backend definitions to match frontend

**⏱️ Time: 30 minutes**

---

## ✅ PHASE 3: TESTING & VERIFICATION

**⏰ Estimated Time: 1 hour**

### Automated Testing
```bash
# Run all tests
npm run test:run
```

- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] No linting errors

### Build Verification
```bash
# Build for production
npm run build
```

- [ ] Build succeeds
- [ ] No warnings
- [ ] Dist folder created

### Manual Testing

#### Tutorial Verification
- [ ] Start tutorial
- [ ] Check step 10 displays 7 new hotel names
- [ ] Verify game title in steps 1, 2, 6, 24
- [ ] Complete full tutorial

#### Gameplay Verification
- [ ] Start a game locally
- [ ] Place tiles
- [ ] Found a chain (verify new hotel names)
- [ ] Merge chains
- [ ] View game log (verify hotel names in logs)
- [ ] Play to completion

#### UI Verification
- [ ] Main page shows new game title
- [ ] Online lobby shows new game title
- [ ] Game header shows new game title
- [ ] No "Acquire" brand name in UI (except legal docs)

### Code Search Verification
```bash
# Search for remaining "Acquire" references
grep -r "Acquire" src/ --include="*.ts" --include="*.tsx"
grep -r "Acquire" --include="*.md"
```

- [ ] Only references are in legal disclaimer
- [ ] No other trademark uses

---

## 🎬 PHASE 4: COMMIT & MERGE

**Once all above is complete:**

```bash
# Stage all changes
git add .

# Commit with descriptive message
git commit -m "refactor: rebrand with original names and legal compliance

- Rename game from 'Acquire' to '[New Title]'
- Replace hotel chain names with [7 new names]
- Add legal disclaimer
- Update tutorial and UI"

# Push to branch (or merge if on main)
git push origin [branch-name]
```

- [ ] Code changes committed
- [ ] Commit message is descriptive
- [ ] Branch pushed (or merged to main)
- [ ] Code review approved (if team practice)

---

## 📊 SUMMARY TABLE

| Task | File(s) | Lines | Time | Status |
|---|---|---|---|---|
| Type definitions | src/types/game.ts | 7 | 15 min | [ ] |
| Tutorial | tutorialSteps.ts | 9 | 45 min | [ ] |
| Game title | 5 files | ~8 | 30 min | [ ] |
| Legal docs | LEGAL.md + README | 2 | 15 min | [ ] |
| Reference | hotel_name_mapping.md | 1 | 5 min | [ ] |
| Backend | game-action/index.ts | TBD | 30 min | [ ] |
| Testing | Multiple | N/A | 60 min | [ ] |
| **TOTAL** | | | **200 min (3.3 hr)** | |

**Actual implementation time will vary based on:**
- Size of supabase/functions/game-action/index.ts
- Number of hotel name references in backend
- Thoroughness of testing

---

## 🚨 CRITICAL REMINDERS

⚠️ **Do NOT commit before:**
- [ ] All decisions are made
- [ ] Hotel names finalized
- [ ] Game title finalized
- [ ] All tests pass

⚠️ **Do NOT merge to main before:**
- [ ] Full manual testing complete
- [ ] No remaining "Acquire" references in UI
- [ ] Legal disclaimer added
- [ ] Code review approved

⚠️ **Do NOT release publicly before:**
- [ ] All remediation complete
- [ ] Final QA testing
- [ ] Legal review (recommended)
- [ ] Documentation updated

---

## 📞 Support/Questions?

**Refer to detailed docs:**
- Full audit details → [brand_audit.md](./brand_audit.md)
- Implementation guide → [brand_remediation_plan.md](./brand_remediation_plan.md)
- Executive summary → [BRAND_AUDIT_SUMMARY.md](./BRAND_AUDIT_SUMMARY.md)

---

## ✍️ Completion Tracker

**Assigned To:** ____________________

**Started:** ____________________

**Completed:** ____________________

**Approved By:** ____________________

**Merged To Main:** ____________________

**Released:** ____________________

---

**Version:** 1.0
**Date:** February 2026
**Status:** READY FOR IMPLEMENTATION

✅ **All preparation complete. Ready to execute!**
