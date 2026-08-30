#!/usr/bin/env bash
# PreToolUse hook: refuse `git push` to main.
#
# A push to main triggers the Coolify production deploy, so main is only ever
# reached by merging an approved PR from staging. This turns the CLAUDE.md
# convention into something the harness enforces rather than something Claude
# has to remember.
#
# Exits 0 (allow) for anything that is not a push to main, including failures to
# parse the payload — a broken hook must not block ordinary work.
set -uo pipefail

payload=$(cat)
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

# Only interested in git push.
printf '%s' "$cmd" | grep -Eq '(^|[;&|]|\s)git\s+(-[^ ]+\s+|--[^ ]+(=[^ ]+)?\s+)*push(\s|$)' || exit 0

targets_main=0

# Explicit refspec: `git push origin main`, `origin HEAD:main`, `origin foo:main`,
# `--force origin refs/heads/main`, etc.
if printf '%s' "$cmd" | grep -Eq '(^|\s|:)(refs/heads/)?main(\s|$|["'"'"'])'; then
  targets_main=1
fi

# Bare `git push` / `git push origin` / `git push -u origin` while main is checked out.
if [ "$targets_main" -eq 0 ]; then
  branch=$(git -C "${CLAUDE_PROJECT_DIR:-.}" branch --show-current 2>/dev/null)
  if [ "$branch" = "main" ]; then
    targets_main=1
  fi
fi

[ "$targets_main" -eq 1 ] || exit 0

reason='Blocked: pushing to main triggers the Coolify production deploy.

This project ships feature/* -> dev -> staging -> main, and main is only reached
by merging an approved PR from staging. Run /release from the current branch to
gate, version, changelog and open the right PR.

If Jonas explicitly wants a direct push to main, he can disable this hook in
.claude/settings.json — do not work around it.'

jq -n --arg r "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $r
  }
}'
exit 0
