#!/usr/bin/env bash
# build-freeswitch-arm64.sh — Build a native ARM64 FreeSWITCH image
#
# This compiles FreeSWITCH from source for ARM64, creating a local Docker image
# that replaces drachtio/drachtio-freeswitch-mrf for native (no QEMU) performance.
#
# Takes 30-60 minutes on a Raspberry Pi 4 / ARM VPS.
# Run this ONCE, then use the resulting image in your compose stack.
#
# Usage:
#   ./scripts/build-freeswitch-arm64.sh
#
# After building, update docker-compose.yml freeswitch service to use:
#   image: drachtio-freeswitch-mrf:arm64   (instead of drachtio/drachtio-freeswitch-mrf:latest)

set -e

IMAGE_TAG="drachtio-freeswitch-mrf:arm64"
BUILD_DIR="/tmp/drachtio-freeswitch-mrf-build"

echo ""
echo "======================================"
echo "  Build FreeSWITCH natively for ARM64"
echo "======================================"
echo "  Output image: $IMAGE_TAG"
echo "  This will take 30-60 minutes."
echo ""

# ── Check prerequisites ────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "❌  Docker not found."
  exit 1
fi

if ! command -v git &>/dev/null; then
  echo "❌  git not found. Install with: apt install git"
  exit 1
fi

# ── Clone drachtio-freeswitch-mrf ─────────────────────────────
echo "→ Cloning drachtio-freeswitch-mrf source..."
rm -rf "$BUILD_DIR"
git clone --depth 1 https://github.com/drachtio/drachtio-freeswitch-mrf "$BUILD_DIR"
echo "  ✅  Cloned to $BUILD_DIR"

# ── Build for ARM64 ──────────────────────────────────────────
echo ""
echo "→ Building Docker image for linux/arm64..."
echo "  (This compiles FreeSWITCH from source — grab a coffee)"
echo ""

docker buildx build \
  --platform linux/arm64 \
  --tag "$IMAGE_TAG" \
  --load \
  "$BUILD_DIR"

echo ""
echo "✅  Build complete: $IMAGE_TAG"
echo ""
echo "To use this image, edit docker-compose.yml and change the freeswitch service:"
echo ""
echo "  freeswitch:"
echo "    image: $IMAGE_TAG"
echo "    # (remove or comment out any 'platform: linux/amd64' line)"
echo ""
echo "Then restart:"
echo "  docker compose -f docker-compose.yml -f docker-compose.arm64.yml up -d freeswitch"
