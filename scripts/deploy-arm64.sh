#!/usr/bin/env bash
# deploy-arm64.sh — Deploy the full voice stack on an ARM64 host
#
# Handles QEMU setup for x86-only containers (FreeSWITCH, 3CX SBC)
# and starts all services using the arm64 compose overlay.
#
# Usage:
#   ./scripts/deploy-arm64.sh           # core stack (drachtio + freeswitch + voice-app)
#   ./scripts/deploy-arm64.sh --full    # + SBC + claude-api-server in Docker
#   ./scripts/deploy-arm64.sh --build   # rebuild images before starting

set -e
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.arm64.yml"
PROFILE=""
BUILD_FLAG=""

for arg in "$@"; do
  case $arg in
    --full)   PROFILE="--profile full" ;;
    --build)  BUILD_FLAG="--build" ;;
  esac
done

echo ""
echo "======================================"
echo "  OpenClaw Voice Stack — ARM64 Deploy"
echo "======================================"
echo ""

# ── Step 1: Check prerequisites ────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "❌  Docker not found. Install Docker first."
  exit 1
fi

# ── Step 2: Enable QEMU for x86 emulation ──────────────────────
echo "→ Enabling QEMU x86_64 emulation (required for FreeSWITCH + SBC)..."
if docker run --privileged --rm tonistiigi/binfmt --install amd64 2>&1 | grep -q "installing"; then
  echo "  ✅  QEMU installed"
else
  echo "  ✅  QEMU already enabled"
fi
echo ""

# ── Step 3: Check .env ─────────────────────────────────────────
if [ ! -f .env ]; then
  echo "❌  .env not found. Copy .env.example and fill in your values:"
  echo "    cp .env.example .env && nano .env"
  exit 1
fi

if grep -q "YOUR_SERVER_LAN_IP\|YOUR_COMPANY\|YOUR_OPENCLAW_IP" .env; then
  echo "❌  .env still has placeholder values. Edit it first:"
  echo "    nano .env"
  exit 1
fi
echo "✅  .env looks configured"

# ── Step 4: Check devices.json ─────────────────────────────────
if [ ! -f voice-app/config/devices.json ]; then
  echo "❌  voice-app/config/devices.json not found."
  echo "    cp voice-app/config/devices.json.example voice-app/config/devices.json && nano voice-app/config/devices.json"
  exit 1
fi
echo "✅  devices.json found"

# ── Step 5: SBC provisioning check (--full only) ───────────────
if [ -n "$PROFILE" ]; then
  if [ ! -f /etc/3cxsbc.conf ] || ! grep -q "TunnelAddr" /etc/3cxsbc.conf 2>/dev/null; then
    echo ""
    echo "⚠️   SBC not provisioned yet. Run this first:"
    echo "    ./sbc/provision.sh"
    echo ""
    read -rp "Continue anyway? [y/N] " CONT
    [[ "$CONT" == "y" || "$CONT" == "Y" ]] || exit 1
  else
    echo "✅  SBC config found"
  fi
fi

# ── Step 6: Build and start ────────────────────────────────────
echo ""
echo "→ Building images..."
$COMPOSE $PROFILE build $BUILD_FLAG

echo ""
echo "→ Starting services..."
$COMPOSE $PROFILE up -d

echo ""
echo "→ Waiting for voice-app to register..."
sleep 8

echo ""
echo "=== Logs (last 20 lines) ==="
docker logs voice-app 2>&1 | tail -20

echo ""
if docker logs voice-app 2>&1 | grep -q "SUCCESS - Registered"; then
  echo "✅  VoiceBot is registered and ready!"
else
  echo "⚠️   Registration not confirmed yet. Check logs:"
  echo "    docker logs voice-app -f"
fi
echo ""
echo "Other useful commands:"
echo "  docker logs freeswitch -f"
echo "  docker logs drachtio -f"
echo "  docker compose -f docker-compose.yml -f docker-compose.arm64.yml ps"
