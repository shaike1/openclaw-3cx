# Changelog

## [1.1.0] - 2026-03-01

### Fixed
- Bridge binary path: updated `openclaw-http-bridge.py` from nvm path to `/usr/bin/openclaw`
- Voice calls now respond correctly end-to-end

### Added
- `claude-api-server/openclaw-http-bridge.py` added to repo (was missing)
- Session retry logic on 500 errors in claude-api-server

### Planned (next)
- Kokoro TTS local fallback (from voicemode project)
- Whisper.cpp local STT fallback
- Smart silence detection
- Session persistence across calls
- Auto-restart on bridge crash

## [1.0.0] - 2026-02-27

### Added
- Phase 1a: Call handler, session manager, drachtio + FreeSWITCH + 3CX SBC
- Phase 1b: STT (Google Cloud + Whisper fallback) + TTS (Google + gTTS)
- Phase 2: Canary deployment infrastructure
- ARM64 support (Oracle Cloud VPS)
- Migration from 100.64.0.13 → 100.64.0.7
- Interactive setup wizard
