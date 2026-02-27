#!/bin/bash
set -e

echo "🛑 Disabling canary deployment..."
docker-compose -f docker-compose.voice-v2-canary.yml --profile canary down

echo "✅ Canary disabled"
echo "All traffic back to v1"
