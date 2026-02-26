#!/usr/bin/env bash
# export-for-arm.sh — Package current x86 config for transfer to an ARM host
#
# Run this on the x86 host. It creates a tarball with:
#   - /etc/3cxsbc.conf  (SBC provisioning — no need to re-provision)
#   - .env              (with EXTERNAL_IP placeholder to replace on ARM)
#   - voice-app/config/devices.json
#
# Usage:
#   ./scripts/export-for-arm.sh
#   scp /tmp/openclaw-arm-config.tar.gz user@ARM_HOST:~

set -e
cd "$(dirname "$0")/.."

TMPDIR=$(mktemp -d)
ARCHIVE=/tmp/openclaw-arm-config.tar.gz

echo ""
echo "======================================="
echo "  OpenClaw — Export Config for ARM"
echo "======================================="
echo ""

# SBC config
if [ -f /etc/3cxsbc.conf ]; then
  cp /etc/3cxsbc.conf "$TMPDIR/3cxsbc.conf"
  echo "✅  Exported /etc/3cxsbc.conf"
else
  echo "⚠️   /etc/3cxsbc.conf not found — you'll need to re-provision the SBC on ARM"
fi

# .env  (current values, ARM host must update EXTERNAL_IP)
if [ -f .env ]; then
  cp .env "$TMPDIR/.env"
  echo "✅  Exported .env"
  echo "    ⚠️  Remember to update EXTERNAL_IP to the ARM host's LAN IP"
  echo "    ⚠️  Update MOSS_TTS_URL=http://$(hostname -I | awk '{print $1}'):7860"
else
  echo "❌  .env not found"
  exit 1
fi

# devices.json
if [ -f voice-app/config/devices.json ]; then
  cp voice-app/config/devices.json "$TMPDIR/devices.json"
  echo "✅  Exported devices.json"
else
  echo "❌  voice-app/config/devices.json not found"
  exit 1
fi

# Create tarball
tar -czf "$ARCHIVE" -C "$TMPDIR" .
rm -rf "$TMPDIR"

echo ""
echo "✅  Config exported to: $ARCHIVE"
echo ""
echo "Transfer to ARM host:"
echo "  scp $ARCHIVE root@ARM_HOST_IP:~/"
echo ""
echo "Then on ARM host:"
echo "  tar -xzf ~/openclaw-arm-config.tar.gz -C /tmp/openclaw-config/"
echo "  # Review and then:"
echo "  sudo cp /tmp/openclaw-config/3cxsbc.conf /etc/3cxsbc.conf"
echo "  cp /tmp/openclaw-config/.env ~/openclaw-3cx/.env"
echo "  # Edit ~/openclaw-3cx/.env: change EXTERNAL_IP to ARM host LAN IP"
echo "  cp /tmp/openclaw-config/devices.json ~/openclaw-3cx/voice-app/config/devices.json"
echo ""
