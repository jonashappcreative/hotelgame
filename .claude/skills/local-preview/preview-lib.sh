#!/usr/bin/env bash
# =============================================================================
# Shared state and discovery for the local preview stack.
# Sourced by start.sh and by local-preview-end/stop.sh.
# =============================================================================
# Services are identified by what is listening on a port, not by a stored PID,
# so stopping works even for a stack started by hand or by an earlier session
# that has since been forgotten.
# =============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

PG_BIN="/opt/homebrew/opt/postgresql@14/bin"
PG_DATA="$HOME/.hotelgame-preview/pgdata"
PG_PORT=55432
PG_DB="acquire"

BACKEND_PORT=3000
FRONTEND_PORT=5173

PREVIEW_ENV="$REPO_ROOT/.env.preview.local"
LOG_DIR="$HOME/.hotelgame-preview"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
PG_LOG="$LOG_DIR/postgres.log"

# The one invariant that matters: the preview must never point at production.
# Production's DATABASE_URL host is a Coolify-internal name that does not
# resolve off the server; this asserts we are on loopback regardless.
assert_local_only() {
  local url="${1:-}"
  case "$url" in
    *@127.0.0.1:*|*@localhost:*) return 0 ;;
    *) echo "REFUSING TO START: DATABASE_URL is not a loopback address." >&2
       echo "  The local preview may never connect to a remote database." >&2
       return 1 ;;
  esac
}

# PID listening on a TCP port, or empty. macOS lsof.
pid_on_port() { lsof -ti :"$1" -sTCP:LISTEN 2>/dev/null | head -1; }

# Human-readable command for a pid, or empty.
cmd_of_pid() { [ -n "${1:-}" ] && ps -p "$1" -o command= 2>/dev/null | head -1; }

port_busy() { [ -n "$(pid_on_port "$1")" ]; }

http_ok() { curl -sf -o /dev/null --max-time 3 "$1" 2>/dev/null; }

pg_running() {
  [ -d "$PG_DATA" ] && "$PG_BIN/pg_ctl" -D "$PG_DATA" status >/dev/null 2>&1
}

say()  { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
ok()   { printf '   ok   %s\n' "$*"; }
skip() { printf '   --   %s (already running, not restarted)\n' "$*"; }
warn() { printf '   !!   %s\n' "$*"; }
