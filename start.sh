#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"

# Load root .env if present
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

# Resolve relative RSS_DB_PATH against repo root so running uvicorn inside backend/
# always uses the intended database location.
if [[ -n "${RSS_DB_PATH:-}" && "$RSS_DB_PATH" != /* && "$RSS_DB_PATH" != ":memory:" ]]; then
  export RSS_DB_PATH="$ROOT_DIR/$RSS_DB_PATH"
fi

# Verify required tooling
if ! command -v uv >/dev/null 2>&1; then
  echo "[error] 'uv' not found in PATH. Install uv: https://docs.astral.sh/uv/" >&2
  exit 1
fi

if command -v pnpm >/dev/null 2>&1; then
  FRONTEND_PM="pnpm"
elif command -v npm >/dev/null 2>&1; then
  FRONTEND_PM="npm"
else
  echo "[error] Neither 'pnpm' nor 'npm' found in PATH. Please install Node.js." >&2
  exit 1
fi

if [[ ! -d "$ROOT_DIR/backend" || ! -d "$ROOT_DIR/frontend" ]]; then
  echo "[error] Expected both 'backend/' and 'frontend/' directories in $ROOT_DIR." >&2
  exit 1
fi

# Ensure frontend dependencies are installed on first run
if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
  echo "[setup] Installing frontend dependencies via $FRONTEND_PM..."
  (cd "$ROOT_DIR/frontend" && "$FRONTEND_PM" install)
fi

BACKEND_PID=""
FRONTEND_PID=""
CLEANED_UP=0

cleanup() {
  if [[ "$CLEANED_UP" -eq 1 ]]; then
    return
  fi
  CLEANED_UP=1
  echo ""
  echo "[shutdown] Stopping backend and frontend servers..."

  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi

  wait "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" 2>/dev/null || true
  echo "[shutdown] All processes stopped cleanly."
}

trap cleanup INT TERM EXIT

echo "================================================================"
echo "  Personal Multi-Source RSS Reader (Local MVP)"
echo "================================================================"
echo "  Web UI   : $FRONTEND_URL"
echo "  API Base : http://$BACKEND_HOST:$BACKEND_PORT"
echo "  API Docs : http://$BACKEND_HOST:$BACKEND_PORT/docs"
echo "  Stop     : Press Ctrl+C"
echo "================================================================"
echo ""

echo "[backend] Starting FastAPI server on http://$BACKEND_HOST:$BACKEND_PORT ..."
(
  cd "$ROOT_DIR/backend"
  exec uv run uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" --reload
) &
BACKEND_PID=$!

echo "[frontend] Starting Vite dev server via $FRONTEND_PM ($FRONTEND_URL) ..."
(
  cd "$ROOT_DIR/frontend"
  if [[ "$FRONTEND_PM" == "pnpm" ]]; then
    exec pnpm dev
  else
    exec npm run dev
  fi
) &
FRONTEND_PID=$!

# Monitor child processes (compatible with macOS bash 3.2)
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done

# Surface exit code if one of the servers exited unexpectedly
EXIT_CODE=0
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  wait "$BACKEND_PID" || EXIT_CODE=$?
  echo "[backend] Exited (code $EXIT_CODE)." >&2
fi
if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
  wait "$FRONTEND_PID" || EXIT_CODE=$?
  echo "[frontend] Exited (code $EXIT_CODE)." >&2
fi

exit "$EXIT_CODE"
