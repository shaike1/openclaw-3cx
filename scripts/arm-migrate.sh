#!/usr/bin/env bash
# arm-migrate.sh — Full migration script: run on the ARM host
#
# This script:
#   1. Clones the project (or pulls latest)
#   2. Installs QEMU binfmt for x86_64 emulation
#   3. Checks/copies config files
#   4. Builds and starts the full stack
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/shaike1/openclaw-3cx/main/scripts/arm-migrate.sh | bash
# OR
#   git clone git@github.com:shaike1/openclaw-3cx.git && cd openclaw-3cx && ./scripts/arm-migrate.sh

set -e

REPO_URL="git@github.com:shaike1/openclaw-3cx.git"
PROJECT_DIR="${PROJECT_DIR:-$HOME/openclaw-3cx}"

echo ""
echo "======================================="
echo "  OpenClaw — ARM64 Migration"
echo "======================================="
echo ""

# ── Check architecture ────────────────────────────────────────────
ARCH=$(uname -m)
if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "arm64" ]; then
  echo "❌  This script is for ARM64 hosts. Detected: $ARCH"
  echo "    Use deploy-arm64.sh on an ARM64 host."
  exit 1
fi
echo "✅  Architecture: $ARCH"

# ── Check prerequisites ───────────────────────────────────────────
for cmd in docker git; do
  if ! command -v $cmd &>/dev/null; then
    echo "❌  $cmd not found. Install it first."
    exit 1
  fi
done
echo "✅  docker and git available"

# ── Clone or update project ───────────────────────────────────────
if [ -d "$PROJECT_DIR/.git" ]; then
  echo "→ Updating existing project at $PROJECT_DIR..."
  git -C "$PROJECT_DIR" pull
else
  echo "→ Cloning project to $PROJECT_DIR..."
  git clone "$REPO_URL" "$PROJECT_DIR"
fi
cd "$PROJECT_DIR"
echo "✅  Project ready at $PROJECT_DIR"

# ── Install QEMU binfmt (needed for FreeSWITCH + SBC x86 images) ──
echo ""
echo "→ Installing QEMU x86_64 binfmt emulation..."
if docker run --privileged --rm tonistiigi/binfmt --install amd64 2>&1 | grep -q "already\|installing"; then
  echo "✅  QEMU binfmt enabled"
else
  echo "✅  QEMU binfmt already enabled"
fi

# ── Check .env ────────────────────────────────────────────────────
echo ""
if [ ! -f .env ]; then
  echo "❌  .env not found!"
  echo ""
  echo "Either:"
  echo "  A) Copy from x86 host and edit EXTERNAL_IP:"
  echo "       scp root@YOUR_X86_HOST_IP:/root/openclaw-arm-config.tar.gz ~/"
  echo "       tar -xzf ~/openclaw-arm-config.tar.gz"
  echo "       cp .env $PROJECT_DIR/.env"
  echo "       nano $PROJECT_DIR/.env  # change EXTERNAL_IP"
  echo ""
  echo "  B) Create from template:"
  echo "       cp .env.example .env && nano .env"
  echo ""
  exit 1
fi

# Validate no placeholders remain
if grep -q "YOUR_SERVER_LAN_IP\|YOUR_COMPANY\|YOUR_OPENCLAW_IP" .env; then
  echo "❌  .env still has placeholder values. Edit it first: nano .env"
  exit 1
fi
echo "✅  .env configured"

# Validate EXTERNAL_IP is the ARM host's IP (not the x86 host's)
EXTERNAL_IP=$(grep '^EXTERNAL_IP=' .env | cut -d= -f2)
LOCAL_IPS=$(hostname -I 2>/dev/null || ip route get 1 | grep -oP 'src \K\S+')
if echo "$LOCAL_IPS" | grep -qF "$EXTERNAL_IP"; then
  echo "✅  EXTERNAL_IP=$EXTERNAL_IP (matches this host)"
else
  echo "⚠️   EXTERNAL_IP=$EXTERNAL_IP — verify this is the ARM host's LAN IP (not x86 host)"
  echo "    This host's IPs: $LOCAL_IPS"
  read -rp "    Continue anyway? [y/N] " CONT
  [[ "$CONT" == "y" || "$CONT" == "Y" ]] || exit 1
fi

# ── Check devices.json ────────────────────────────────────────────
if [ ! -f voice-app/config/devices.json ]; then
  echo "❌  voice-app/config/devices.json not found!"
  echo "    Copy from x86 host or create from example:"
  echo "      cp voice-app/config/devices.json.example voice-app/config/devices.json && nano voice-app/config/devices.json"
  exit 1
fi
echo "✅  devices.json found"

# ── Check SBC config ──────────────────────────────────────────────
if [ ! -f /etc/3cxsbc.conf ] || ! grep -q "TunnelAddr" /etc/3cxsbc.conf 2>/dev/null; then
  echo ""
  echo "⚠️   /etc/3cxsbc.conf not found or incomplete."
  echo ""
  echo "Options:"
  echo "  A) Copy from x86 host (easiest — reuse existing SBC provisioning):"
  echo "       scp root@YOUR_X86_HOST_IP:/etc/3cxsbc.conf /etc/3cxsbc.conf"
  echo ""
  echo "  B) Re-provision SBC (get auth key from 3CX Admin → Settings → SBC):"
  echo "       ./sbc/provision.sh"
  echo ""
  read -rp "  Continue without SBC config? (SBC container will fail to start) [y/N] " CONT
  [[ "$CONT" == "y" || "$CONT" == "Y" ]] || exit 1
else
  echo "✅  SBC config found (/etc/3cxsbc.conf)"
fi

# ── Build and start ───────────────────────────────────────────────
echo ""
echo "→ Building images (drachtio/voice-app native ARM64, freeswitch/sbc via QEMU)..."
docker compose -f docker-compose.yml -f docker-compose.arm64.yml --profile full build

echo ""
echo "→ Starting full stack..."
docker compose -f docker-compose.yml -f docker-compose.arm64.yml --profile full up -d

echo ""
echo "→ Waiting 15s for services to initialize (QEMU startup is slower)..."
sleep 15

echo ""
echo "=== Container status ==="
docker compose -f docker-compose.yml -f docker-compose.arm64.yml --profile full ps

echo ""
echo "=== voice-app logs (last 20 lines) ==="
docker logs voice-app 2>&1 | tail -20

echo ""
if docker logs voice-app 2>&1 | grep -q "SUCCESS - Registered\|READY Voice interface"; then
  echo "✅  Stack is up and registered!"
else
  echo "⚠️   Registration not confirmed yet. Check logs:"
  echo "    docker logs voice-app -f"
  echo "    docker logs 3cx-sbc -f"
fi

echo ""
echo "MOSS TTS URL in .env:"
grep 'MOSS_TTS_URL' .env || echo "  (not set — add MOSS_TTS_URL=http://YOUR_X86_HOST_IP:7860)"
echo ""
echo "Next step — stop x86 host services:"
echo "  ssh root@YOUR_X86_HOST_IP 'docker compose -f /root/.claude-phone-cli/docker-compose.yml down && kill \$(pgrep -f \"node server.js\") && systemctl stop 3cxsbc 2>/dev/null; pkill 3cxsbc'"
echo ""
