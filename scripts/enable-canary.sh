#!/bin/bash
set -e

CANARY_EXT="${1:-12699}"  # Default test extension
echo "🐤 Enabling canary deployment for extension $CANARY_EXT..."
echo ""

# Check v1 is running
if ! docker ps | grep -q voice-app; then
  echo "❌ v1 stack not running. Start it first:"
  echo "   docker-compose up -d"
  exit 1
fi

# Start v2 canary
echo "📦 Starting v2 canary stack..."
docker-compose -f docker-compose.voice-v2-canary.yml --profile canary up -d

# Wait for health
echo "⏳ Waiting for v2 to be healthy..."
sleep 5

if curl -s http://localhost:3100/health | grep -q "healthy"; then
  echo "✅ v2 is healthy"
else
  echo "❌ v2 health check failed"
  exit 1
fi

echo ""
echo "🐤 Canary enabled!"
echo "Test extension: $CANARY_EXT"
echo "v1 handles: all other extensions"
echo "v2 handles: $CANARY_EXT (test)"
echo ""
echo "Monitor: docker logs -f voice-worker-v2"
echo "Disable: ./scripts/disable-canary.sh"
