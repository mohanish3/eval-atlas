#!/usr/bin/env bash
set -euo pipefail

SKIP_DOCKER=0
SKIP_INSTALL=0
SKIP_MIGRATE=0
START_BACKEND=1
START_FRONTEND=1
DB_READY=0
DB_ISSUE=""

for arg in "$@"; do
  case "$arg" in
    --skip-docker) SKIP_DOCKER=1 ;;
    --skip-install) SKIP_INSTALL=1 ;;
    --skip-migrate) SKIP_MIGRATE=1 ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
FRONTEND_DIR="$REPO_ROOT/frontend"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

ensure_env_file() {
  local target="$1"
  local example="$2"
  if [[ ! -f "$target" ]]; then
    if [[ ! -f "$example" ]]; then
      echo "Missing env file and template: $target" >&2
      exit 1
    fi
    cp "$example" "$target"
    echo "Created $target from template."
  fi
}

get_env_value() {
  local path="$1"
  local key="$2"
  local fallback="$3"
  local value

  if [[ ! -f "$path" ]]; then
    echo "$fallback"
    return
  fi

  value="$(grep -E "^${key}=" "$path" | head -n 1 || true)"
  if [[ -z "$value" ]]; then
    echo "$fallback"
  else
    echo "${value#*=}"
  fi
}

set_env_value() {
  local path="$1"
  local key="$2"
  local value="$3"

  if [[ -f "$path" ]] && grep -qE "^${key}=" "$path"; then
    python - "$path" "$key" "$value" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
lines = path.read_text().splitlines()
for i, line in enumerate(lines):
    if line.startswith(f"{key}="):
        lines[i] = f"{key}={value}"
        break
path.write_text("\n".join(lines) + "\n")
PY
  else
    printf '%s=%s\n' "$key" "$value" >>"$path"
  fi
}

test_docker_engine() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

test_tcp_port() {
  local host="$1"
  local port="$2"
  if command -v nc >/dev/null 2>&1; then
    nc -z "$host" "$port" >/dev/null 2>&1
  else
    (echo >"/dev/tcp/$host/$port") >/dev/null 2>&1
  fi
}

get_port_owner() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnp "( sport = :$port )" 2>/dev/null | awk 'NR>1 {print $NF}' | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -n 1
  else
    echo ""
  fi
}

install_npm_deps() {
  local dir="$1"
  local name="$2"
  shift 2
  local required_paths=("$@")
  local healthy=1

  for required_path in "${required_paths[@]}"; do
    if [[ ! -e "$dir/$required_path" ]]; then
      healthy=0
      break
    fi
  done

  if [[ -d "$dir/node_modules" && "$healthy" -eq 1 ]]; then
    echo "$name dependencies already present. Skipping install."
    return
  fi

  if [[ -d "$dir/node_modules" ]]; then
    echo "Warning: $name node_modules exists but install is incomplete. Reinstalling." >&2
  fi

  echo "Installing $name dependencies..."
  (
    cd "$dir"
    npm ci
  )
}

test_placeholder_database_url() {
  local database_url="$1"
  [[ "$database_url" =~ ://[^:]+:change-me@ ]]
}

sync_backend_database_url() {
  local postgres_user postgres_password postgres_db postgres_port database_url
  postgres_user="$(get_env_value "$REPO_ROOT/.env" "POSTGRES_USER" "postgres")"
  postgres_password="$(get_env_value "$REPO_ROOT/.env" "POSTGRES_PASSWORD" "change-me")"
  postgres_db="$(get_env_value "$REPO_ROOT/.env" "POSTGRES_DB" "eval_atlas")"
  postgres_port="$(get_env_value "$REPO_ROOT/.env" "POSTGRES_PORT" "5432")"
  database_url="postgresql://${postgres_user}:${postgres_password}@localhost:${postgres_port}/${postgres_db}"
  set_env_value "$BACKEND_DIR/.env" "DATABASE_URL" "$database_url"
  echo "$database_url"
}

test_database_auth() {
  local database_url="$1"
  local output

  output="$(
    cd "$BACKEND_DIR"
    DATABASE_URL="$database_url" node - <<'EOF'
const { Client } = require("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect()
  .then(() => client.end())
  .then(() => {
    console.log("DB_OK");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err.code || err.message || "DB_ERROR");
    process.exit(1);
  });
EOF
  )" && {
    echo "ok"
    return 0
  }

  echo "$output"
  return 1
}

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}

trap cleanup INT TERM

echo "Preparing Eval Atlas startup..."

require_command npm
require_command node

ensure_env_file "$REPO_ROOT/.env" "$REPO_ROOT/.env.example"
ensure_env_file "$BACKEND_DIR/.env" "$BACKEND_DIR/.env.example"
ensure_env_file "$FRONTEND_DIR/.env" "$FRONTEND_DIR/.env.example"

POSTGRES_PORT="$(get_env_value "$REPO_ROOT/.env" "POSTGRES_PORT" "5432")"
BACKEND_PORT="$(get_env_value "$BACKEND_DIR/.env" "PORT" "3000")"
FRONTEND_PORT="5173"
DATABASE_URL="$(sync_backend_database_url)"
DB_REACHABLE=0
if test_tcp_port "127.0.0.1" "$POSTGRES_PORT"; then
  DB_REACHABLE=1
fi

if [[ "$SKIP_DOCKER" -eq 0 ]]; then
  if test_docker_engine; then
    echo "Starting Postgres with docker compose..."
    (cd "$REPO_ROOT" && docker compose up -d)
    if test_tcp_port "127.0.0.1" "$POSTGRES_PORT"; then
      DB_REACHABLE=1
    fi
  else
    echo "Warning: Docker engine not available. Skipping docker compose. Start Docker Desktop or use --skip-docker with existing Postgres." >&2
    SKIP_DOCKER=1
  fi
fi

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  install_npm_deps "$BACKEND_DIR" "backend" \
    "node_modules/.bin/tsx" \
    "node_modules/pg/package.json"
  install_npm_deps "$FRONTEND_DIR" "frontend" \
    "node_modules/.bin/vite" \
    "node_modules/.bin/tsc" \
    "node_modules/react/package.json"
fi

if [[ "$DB_REACHABLE" -eq 0 ]]; then
  DB_ISSUE="Postgres not reachable on localhost:$POSTGRES_PORT"
elif [[ -z "$DATABASE_URL" ]]; then
  DB_ISSUE="DATABASE_URL missing in backend/.env"
elif test_placeholder_database_url "$DATABASE_URL"; then
  DB_ISSUE="DATABASE_URL still uses placeholder password 'change-me'"
else
  if test_output="$(test_database_auth "$DATABASE_URL" 2>&1)"; then
    DB_READY=1
  else
    DB_ISSUE="Database auth failed: $test_output"
  fi
fi

if [[ "$DB_READY" -eq 0 ]]; then
  echo "Warning: $DB_ISSUE. Skipping migrations. Backend will still start in fallback mode and avoid database-backed features." >&2
  SKIP_MIGRATE=1
fi

if [[ "$SKIP_MIGRATE" -eq 0 ]]; then
  echo "Running backend migrations..."
  (cd "$BACKEND_DIR" && npm run migrate)
fi

echo "Starting services..."
EXISTING_BACKEND_PID="$(get_port_owner "$BACKEND_PORT")"
if [[ -n "$EXISTING_BACKEND_PID" ]]; then
  echo "Warning: Backend port $BACKEND_PORT already in use by PID $EXISTING_BACKEND_PID. Reusing existing backend." >&2
  START_BACKEND=0
fi
if [[ "$START_BACKEND" -eq 1 ]]; then
  (cd "$BACKEND_DIR" && npm run dev) &
  BACKEND_PID=$!
else
  echo "Backend skipped."
fi

EXISTING_FRONTEND_PID="$(get_port_owner "$FRONTEND_PORT")"
if [[ -n "$EXISTING_FRONTEND_PID" ]]; then
  echo "Warning: Frontend port $FRONTEND_PORT already in use by PID $EXISTING_FRONTEND_PID. Reusing existing frontend." >&2
  START_FRONTEND=0
fi
if [[ "$START_FRONTEND" -eq 1 ]]; then
  (cd "$FRONTEND_DIR" && npm run dev -- --host 0.0.0.0) &
  FRONTEND_PID=$!
else
  echo "Frontend skipped."
fi

echo
echo "Eval Atlas start launched."
if [[ "$START_BACKEND" -eq 1 ]]; then
  echo "Backend PID: $BACKEND_PID"
elif [[ -n "${EXISTING_BACKEND_PID:-}" ]]; then
  echo "Backend PID: $EXISTING_BACKEND_PID (existing)"
fi
if [[ "$START_FRONTEND" -eq 1 ]]; then
  echo "Frontend PID: $FRONTEND_PID"
elif [[ -n "${EXISTING_FRONTEND_PID:-}" ]]; then
  echo "Frontend PID: $EXISTING_FRONTEND_PID (existing)"
fi
echo "Frontend URL: http://localhost:5173"
if [[ "$START_BACKEND" -eq 1 || -n "${EXISTING_BACKEND_PID:-}" ]]; then
  echo "Backend URL:  http://localhost:3000"
fi
if [[ "$DB_READY" -eq 0 ]]; then
  echo "DB status: $DB_ISSUE"
  echo "Backend fallback mode: running without database persistence."
  echo "Fix: update backend/.env DATABASE_URL with real Postgres password, or start Docker Desktop for repo-managed Postgres."
fi
echo
echo "Press Ctrl+C to stop running processes."

if [[ "$START_BACKEND" -eq 1 && "$START_FRONTEND" -eq 1 ]]; then
  wait "$BACKEND_PID" "$FRONTEND_PID"
elif [[ "$START_BACKEND" -eq 1 ]]; then
  wait "$BACKEND_PID"
elif [[ "$START_FRONTEND" -eq 1 ]]; then
  wait "$FRONTEND_PID"
fi
