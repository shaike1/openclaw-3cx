#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/root/openclaw-3cx}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/openclaw-backups/openclaw-3cx-config}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT_DIR="$BACKUP_ROOT/$STAMP"
TAR_PATH="$BACKUP_ROOT/openclaw-3cx-config-$STAMP.tar.gz"

mkdir -p "$OUT_DIR"
mkdir -p "$BACKUP_ROOT"

copy_if_exists() {
  local src="$1"
  local dst="$2"
  if [[ -f "$src" ]]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
  fi
}

copy_if_exists "$PROJECT_DIR/.env" "$OUT_DIR/.env"
copy_if_exists "$PROJECT_DIR/.env.example" "$OUT_DIR/.env.example"
copy_if_exists "$PROJECT_DIR/voice-app/config/devices.json" "$OUT_DIR/voice-app/config/devices.json"
copy_if_exists "$PROJECT_DIR/docker-compose.yml" "$OUT_DIR/docker-compose.yml"
copy_if_exists "$PROJECT_DIR/docker-compose.arm64.yml" "$OUT_DIR/docker-compose.arm64.yml"
copy_if_exists "$PROJECT_DIR/docker-compose.bridge.yml" "$OUT_DIR/docker-compose.bridge.yml"
copy_if_exists "$PROJECT_DIR/claude-api-server/server.js" "$OUT_DIR/claude-api-server/server.js"
copy_if_exists "$PROJECT_DIR/voice-app/lib/outbound-routes.js" "$OUT_DIR/voice-app/lib/outbound-routes.js"

{
  echo "timestamp_utc=$STAMP"
  echo "host=$(hostname)"
  echo "kernel=$(uname -a)"
  echo "docker_version=$(docker --version 2>/dev/null || echo 'n/a')"
  echo "compose_version=$(docker compose version 2>/dev/null || echo 'n/a')"
} > "$OUT_DIR/backup-meta.txt"

docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' > "$OUT_DIR/docker-ps.txt" 2>/dev/null || true

(
  cd "$OUT_DIR/.."
  tar -czf "$TAR_PATH" "$STAMP"
)

chmod 600 "$TAR_PATH" || true

printf 'Backup created:\n- Folder: %s\n- Archive: %s\n' "$OUT_DIR" "$TAR_PATH"
