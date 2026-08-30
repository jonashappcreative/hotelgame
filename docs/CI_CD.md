# CI/CD & release process

## Branch model

```
feature/* ──▶ staging ──▶ main ──▶ Coolify (production)
   PR           PR         auto-deploy
```

| Branch | Purpose | Protected |
|---|---|---|
| `feature/*`, `fix/*` | One change in progress | no |
| `staging` | Pre-production — features integrate here, and this is what gets promoted | yes |
| `main` | Production. **Every push auto-deploys.** | yes |

Nothing reaches `main` except a merged PR from `staging`.

There used to be a separate `dev` branch between features and `staging`. It was
dropped: with one developer the two branches held identical commits within
minutes of each other, so every change paid for an extra branch, merge and PR
that gated nothing new. Reintroduce it if a second contributor starts landing
work in parallel — that is the case it actually solves.

Because `staging` is ruleset-protected, **you cannot commit to it directly** —
including the release commit. Anything that has to land on `staging` needs its
own branch and a PR. Use a PR for anything substantive; a typo or doc tweak is
fine pushed to a short-lived branch and merged straight through.

## What runs when

**[`ci.yml`](../.github/workflows/ci.yml)** — pushes and PRs on `staging` and `main`:

| Step | Blocking |
|---|---|
| Type check (`tsc --noEmit`) | yes |
| Lint (`eslint .`) | yes — on errors |
| Test (`vitest run`, 235 tests) | yes |
| Build (`vite build`) | yes |

The `release-guard` job runs only on PRs into `main` and blocks the merge unless:
1. `src/data/versionHistory.ts` was changed,
2. `package.json`'s version equals the newest changelog entry's version,
3. no `v<version>` tag exists yet.

**[`deploy.yml`](../.github/workflows/deploy.yml)** — pushes to `main` only: re-verify build → trigger the Coolify webhook → wait 90s → health-check `https://hotelgame.jonashapp.com/health` with 5 retries → tag `v<version>`.

The tag is created by CI *after* a healthy deploy, so a tag means "this shipped and answered", not "someone typed a number".

### The `any` backlog

`@typescript-eslint/no-explicit-any` is set to **warn**, not error (`eslint.config.js`). ~115 pre-existing `any`s remain, mostly untyped DB rows and game-state payloads in `server/`. They surface in every CI run but don't fail it.

This is a ratchet, not an amnesty: everything else lints at error level, so no *new* error-level violation can land while the `any`s get retyped incrementally. When the count reaches zero, promote the rule back to `"error"`.

### A note on vitest

The suite runs on the `forks` pool (`vite.config.ts`). vitest 4's default `threads` pool fails to spawn workers on macOS here and silently reports 0 tests — which is what made the suite look broken. It was never broken; CI on Ubuntu ran it fine the whole time. Don't switch the pool back.

## Branch protection — done, both rulesets active

Both rulesets are configured and enforcing. Verify any time with:

```bash
gh api repos/jonashappcreative/hotelgame/rulesets \
  --jq '.[] | "\(.name): target=\(.target) enforcement=\(.enforcement)"'
```

They are not decorative: a direct `git push origin staging` is refused with
`GH013: Repository rule violations found`, which is why a release commit needs
its own `release/vX.Y.Z` branch.

Recorded below as configured (**Settings → Rules → Rulesets**), in case either
has to be rebuilt:

Ruleset 1 — name `main`, target branch `main`, enforcement Active:
- ✅ Restrict deletions
- ✅ Block force pushes
- ✅ Require a pull request before merging (approvals: 0 — solo project; the PR itself is the gate)
- ✅ Require status checks to pass → add **`Quality gates`** and **`Release guard`**
- ✅ Require branches to be up to date before merging

Ruleset 2 — name `staging`, target branch `staging`, enforcement Active:
- ✅ Restrict deletions
- ✅ Block force pushes
- ✅ Require a pull request before merging (approvals: 0)
- ✅ Require status checks to pass → add **`Quality gates`**

Status checks only appear in the picker after a workflow has reported them at least once, so open the first PR before adding them.

`gh` is installed and authenticated on this machine, so `/release` opens PRs directly rather than printing compare links.

## Also verify: Coolify's own auto-deploy

The deploy is triggered by `deploy.yml` calling the Coolify webhook. If Coolify *also* has git auto-deploy enabled on this repo, every merge deploys twice. Check the Coolify application's **Source → Automatic Deployment** setting and turn it off — the workflow should be the only trigger, so the health check and tagging can't be bypassed.

## Cutting a release

Run `/release` in Claude Code from the branch you want to promote. It picks the move from the branch you are on:

| On | Does |
|---|---|
| `feature/*` | gates → PR into `staging` |
| `staging` | gates → version bump → changelog entry on a `release/vX.Y.Z` branch → PR into `staging`, then PR into `main` |

A release is **two** PRs, not one: `staging` is ruleset-protected, so the version
bump and changelog cannot be committed to it directly. They go on a
`release/vX.Y.Z` branch, merge into `staging` by PR, and only then does the
`staging → main` PR open.

Version bumps follow the rules in [CLAUDE.md](./CLAUDE.md): `0.0.1` bug fixes, `0.1.0` features, `1.0.0` milestones (recommended to Jonas, never chosen unilaterally).

The changelog lives in [`src/data/versionHistory.ts`](../src/data/versionHistory.ts) — one source of truth, rendered by the footer's "Version History" dialog and the `/case-study` timeline. Entries are player-facing prose, not commit dumps.

## Guard rails on this machine

`.claude/hooks/block-main-push.sh` (wired up in `.claude/settings.json`) refuses any `git push` to `main` from a Claude Code session — explicit refspec or a bare push while `main` is checked out. It's a hard stop, not a reminder. Remove the hook from settings if you genuinely want direct pushes back.
