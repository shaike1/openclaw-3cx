#!/bin/bash
set -e

echo "🔧 Setting up Voice v2 for testing..."

# Check required env vars
if [ ! -f .env ]; then
  echo "❌ .env file not found. Copy voice-v2.env.example to .env and fill values."
  exit 1
fi

# Create logs directory
mkdir -p logs/voice-worker logs/claude-api-v2

# Check Google Cloud key
if [ -z "$GOOGLE_CLOUD_TTS_KEY_PATH" ] && [ ! -f voice-worker/keys/google-tts-key.json ]; then
  echo "⚠️  Google Cloud TTS key not found. TTS will fail."
fi

# Check OpenAI key
if [ -z "$OPENAI_WHISPER_KEY" ]; then
  echo "⚠️  OpenAI Whisper key not set. STT will fail."
fi

# Build voice worker
echo "📦 Building voice worker..."
cd voice-worker
docker build -t voice-worker-v2:test .
cd ..

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Start v2 stack: docker-compose -f docker-compose.voice-v2.yml up -d"
echo "2. Check health: curl http://localhost:3100/health"
echo "3. View logs: docker logs -f voice-worker-v2"
echo "4. Make test call to extension"
