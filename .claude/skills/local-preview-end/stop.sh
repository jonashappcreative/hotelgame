#!/usr/bin/env bash
# =============================================================================
# Stop the local preview stack: frontend + backend + Postgres.
# =============================================================================
# Stops in the reverse order it starts, and only stops things it can identify
# as ours — a process on :3000 that is not the preview backend is reported and
# left alone rather than killed. Data in the cluster is preserved; the whole
# point of a persistent cluster is that a finished game is still there tomorrow.
#
# Safe to run when nothing is up.
# =============================================================================
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../local-preview" && pwd)/preview-lib.sh"

STOPPED=0

# ---------------------------------------------------------------------------
step "1/3  Frontend"
FE_PID=$(pid_on_port "$FRONTEND_PORT")
if [ -z "$FE_PID" ]; then
  say "   --   nothing on :$FRONTEND_PORT"
else
  FE_CMD=$(cmd_of_pid "$FE_PID")
  case "$FE_CMD" in
    *vite*)
      kill "$FE_PID" 2>/dev/null
      # npx leaves a wrapper behind that would respawn nothing but lingers.
      pkill -f "vite --host --mode preview" 2>/dev/null
      sleep 1
      [ -z "$(pid_on_port "$FRONTEND_PORT")" ] \
        && { ok "stopped Vite (pid $FE_PID)"; STOPPED=$((STOPPED+1)); } \
        || warn "Vite still listening on :$FRONTEND_PORT"
      ;;
    *) warn "process on :$FRONTEND_PORT is not Vite — left alone: $FE_CMD" ;;
  esac
fi

# ---------------------------------------------------------------------------
step "2/3  Backend"
BE_PID=$(pid_on_port "$BACKEND_PORT")
if [ -z "$BE_PID" ]; then
  say "   --   nothing on :$BACKEND_PORT"
else
  BE_CMD=$(cmd_of_pid "$BE_PID")
  case "$BE_CMD" in
    *dist/server/server.js*)
      kill "$BE_PID" 2>/dev/null; sleep 1
      [ -z "$(pid_on_port "$BACKEND_PORT")" ] \
        && { ok "stopped backend (pid $BE_PID)"; STOPPED=$((STOPPED+1)); } \
        || { kill -9 "$BE_PID" 2>/dev/null; ok "stopped backend (forced)"; STOPPED=$((STOPPED+1)); }
      ;;
    *) warn "process on :$BACKEND_PORT is not the preview backend — left alone: $BE_CMD" ;;
  esac
fi

# ---------------------------------------------------------------------------
step "3/3  Postgres"
if pg_running; then
  "$PG_BIN/pg_ctl" -D "$PG_DATA" stop -m fast >/dev/null 2>&1
  sleep 1
  pg_running \
    && warn "Postgres did not stop — see $PG_LOG" \
    || { ok "stopped Postgres :$PG_PORT (data kept at $PG_DATA)"; STOPPED=$((STOPPED+1)); }
else
  say "   --   Postgres not running"
fi

# ---------------------------------------------------------------------------
step "Done"
if [ "$STOPPED" -eq 0 ]; then
  say "   Nothing was running."
else
  say "   Stopped $STOPPED service(s). Recorded games are kept."
  say "   To start over with an empty database (useful for seeing the"
  say "   dashboard's real empty state):"
  say "     $PG_BIN/pg_ctl -D $PG_DATA -o '-p $PG_PORT -c listen_addresses=127.0.0.1 -k /tmp' start"
  say "     dropdb -h 127.0.0.1 -p $PG_PORT -U postgres $PG_DB"
  say "     /local-preview   # recreates and re-applies the schema"
fi
