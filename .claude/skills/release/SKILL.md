---
name: release
description: Promote work up the branch chain (feature → dev → staging → main). On staging it cuts a release — runs the gates, bumps the version, writes the changelog entry shown on the site, and opens the PR to main. Use when Jonas says "release", "cut a release", "promote to staging", "ship it", or "ready for main".
---

# Release & promotion

This project ships through `feature/* → dev → staging → main`. A push to `main`
auto-deploys to production via Coolify, so `main` is only ever reached through a
reviewed PR from `staging`.

**Never push directly to `main`.** A hook blocks it; that is intentional, not a
bug to route around. If Jonas explicitly wants a direct push, he removes the
hook himself.

## Step 0 — figure out which move this is

Run `git branch --show-current` and `git status --short`.

| Current branch | What `/release` does |
|---|---|
| `feature/*`, `fix/*` | Gates, then PR into `dev` |
| `dev` | Gates, then PR into `staging` (no version bump yet) |
| `staging` | **Cut a release**: gates → version bump → changelog → PR into `main` |
| `main` | Stop. Explain that releases start from `staging`. |

If the working tree is dirty, stop and ask what to do with the changes first.
Never stash or discard Jonas's uncommitted work on your own initiative.

## Step 1 — gates (all paths)

```bash
npx tsc --noEmit     # must pass — blocking
npm run build        # must pass — blocking
npm run lint         # advisory: report the error count, do not block
npm run test:run     # advisory until the vitest worker bug is fixed
```

Report lint/test results honestly, including "still broken". Do not describe a
gate as passing when it was skipped.

## Step 2 — promotion PRs (feature → dev, dev → staging)

No version work. Push the branch and open the PR:

```bash
git push -u origin "$(git branch --show-current)"
```

Then, if `gh` is installed, `gh pr create --base <target> --fill`. If it is not
(currently the case on this machine), print the compare URL for Jonas to click:

`https://github.com/jonashappcreative/hotelgame/compare/<target>...<branch>?expand=1`

## Step 3 — cutting a release (staging → main)

### 3a. Gather what changed

```bash
git describe --tags --abbrev=0          # last release tag
git log <last-tag>..HEAD --oneline --no-merges
```

### 3b. Choose the version bump

Per Jonas's rules in `docs/CLAUDE.md`:

- **patch (0.0.1)** — bug fixes only
- **minor (0.1.0)** — any new feature or user-visible capability
- **major (1.0.0)** — a milestone release

Never pick major on your own. If the change set looks like a milestone
(a rewrite, a public launch, a breaking change to saved games), *recommend* it
and let Jonas decide. Otherwise pick patch or minor from the commits and state
your reasoning in one line.

**Confirm the chosen version with Jonas before writing any files.**

### 3c. Write the changelog entry

Edit `src/data/versionHistory.ts` — never `SiteFooter.tsx`, which only
re-exports it.

1. Remove `current: true` from the entry that has it.
2. Prepend the new entry at the top of the array with `current: true`.
3. Date is today's date, `YYYY-MM-DD`.

The `summary` is **prose written for players**, matching the voice of the
existing entries. Read the last three before writing so the register matches.

- Say what changed from the outside: what a player now sees, can do, or no
  longer trips over.
- Group related work into one clause instead of listing every commit.
- Name internals only when they matter to the reader (a hosting move, a stack
  change) — not because a file changed.
- No commit hashes, no conventional-commit prefixes, no bullet lists.

Bad: `feat: add turn timer; fix: bot ready state; chore: bump deps`
Good: `Turn timers are now enforced server-side, and bots no longer get stuck
unready when a room is re-created.`

### 3d. Sync package.json

```bash
npm version <new-version> --no-git-tag-version
```

CI's release-guard job fails the PR if `package.json` and the top changelog
entry disagree, so this is not optional.

### 3e. Commit and open the PR

```bash
git add src/data/versionHistory.ts package.json package-lock.json
git commit -m "chore(release): v<version>"
git push origin staging
```

Do **not** create the git tag locally — the deploy workflow tags `main` after a
successful deploy and health check. Creating it early causes the release-guard
"version must not already be released" check to fail.

Then open the PR to `main` (or print the compare URL), with a body listing the
commits since the last tag under a short summary.

## Step 4 — hand back

Tell Jonas plainly:

- the version chosen and why
- the lint/test state (including if they are still non-blocking)
- the PR URL, and that merging it triggers the production deploy
- that the tag is created by CI after the deploy passes its health check

Do not merge the PR. That is Jonas's call.
