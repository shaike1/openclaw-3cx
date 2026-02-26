#!/usr/bin/env bash
# provision.sh — Interactive 3CX SBC provisioning
#
# Run this ONCE on first setup to write /etc/3cxsbc.conf from the SBC Auth Key.
# The auth key is shown in the 3CX Admin panel under Admin → Settings → SBC.
#
# After provisioning, start the SBC with:
#   docker compose up -d sbc

set -e

CONF_FILE="/etc/3cxsbc.conf"

echo ""
echo "========================================="
echo "  3CX SmartSBC Provisioning"
echo "========================================="
echo ""
echo "You need the SBC Auth Key from 3CX Admin:"
echo "  3CX Admin → Admin → Settings → SBC → (your SBC entry) → Auth Key"
echo ""

if [ -f "$CONF_FILE" ] && grep -q "TunnelAddr" "$CONF_FILE" 2>/dev/null; then
  echo "⚠️  $CONF_FILE already exists and appears provisioned."
  read -rp "Re-provision? This will overwrite it. [y/N] " CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Skipping provisioning."
    exit 0
  fi
fi

read -rp "Paste your SBC Auth Key: " SBC_AUTH_KEY
if [ -z "$SBC_AUTH_KEY" ]; then
  echo "Error: Auth Key is required."
  exit 1
fi

# Build the SBC container if not already built
cd "$(dirname "$0")/.."
if ! docker image inspect claude-phone-cli-sbc > /dev/null 2>&1; then
  echo ""
  echo "Building SBC Docker image (first time, this downloads ~50MB)..."
  docker compose build sbc
fi

echo ""
echo "Running SBC provisioning inside a temporary container..."

# Run the SBC config tool inside the container, mounting the host conf directory
docker run --rm \
  -v "$CONF_FILE:/etc/3cxsbc.conf" \
  --entrypoint /usr/sbin/3CXSBCConfig \
  claude-phone-cli-sbc \
  "$SBC_AUTH_KEY"

if grep -q "TunnelAddr" "$CONF_FILE" 2>/dev/null; then
  echo ""
  echo "✅  Provisioning complete. Config written to $CONF_FILE"
  echo ""
  echo "Start the SBC:"
  echo "  docker compose up -d sbc"
else
  echo ""
  echo "❌  Provisioning may have failed — $CONF_FILE does not look complete."
  echo "    Check the output above and try again."
  exit 1
fi
