<p align="center">
  <img src="assets/logo.png" alt="Claude Phone" width="200">
</p>

# claude-phone × OpenClaw

A voice interface for [OpenClaw](https://github.com/openclaw/openclaw) via SIP/3CX. Give your AI a phone number — call it, and it can call you back.

---

## Architecture

```
Phone (3CX app / desk phone)
        │
        ▼
3CX Cloud (YOUR_COMPANY.3cx.cloud)
        │  SIP trunk
        ▼
3CX SmartSBC  ← Docker container, listens on port 5060
        │  SIP INVITE
        ▼
drachtio  ← Docker, port 5070
        │
        ▼
voice-app  ← Docker, port 3000 / 3001
   ├── gTTS (Google Translate TTS — free, no key)
   ├── Google Web Speech API (STT — free, no key)
   └── claude-api-server (port 3333, host process)
              │
              ▼
        OpenClaw AI  (separate server, e.g. YOUR_OPENCLAW_IP:18790)
        │
        ▼
FreeSWITCH  ← Docker, port 5080 — media/RTP
```

All TTS and STT is free — no ElevenLabs, OpenAI, or Whisper API keys required.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **3CX Cloud Account** | Free tier works — [3cx.com](https://www.3cx.com/) |
| **Linux server** (LAN-accessible) | Runs Docker + 3CX SBC service |
| **OpenClaw** running on the network | The AI backend |
| **Docker + Docker Compose** | For drachtio, FreeSWITCH, voice-app, SBC |
| **Python 3** with pip | For gTTS and SpeechRecognition (installed in Docker image) |

No paid API keys are needed for voice. Optional: OpenAI or ElevenLabs keys for higher-quality TTS/STT fallback.

---

## Quick Start

### 1. Clone and configure

```bash
git clone git@github.com:shaike1/openclaw-3cx.git
cd openclaw-3cx
```

Create `.env` (see [Environment Reference](#environment-reference) below):

```bash
cp .env.example .env   # then edit
```

Create `voice-app/config/devices.json` (see [Device Config](#device-config)):

```bash
cp voice-app/config/devices.json.example voice-app/config/devices.json   # then edit
```

### 2. Start the claude-api-server (host process)

```bash
cd claude-api-server
npm install
node server.js &
```

This bridges voice-app → OpenClaw at `POST /conversation/process`.

### 3. Start Docker services

```bash
docker compose build voice-app   # first time, or after code changes
docker compose up -d
```

### 4. Test a call

Dial the configured extension from any 3CX phone. You should hear the greeting in the device's configured language.

---

## Device Config

`voice-app/config/devices.json` is **volume-mounted and gitignored** (it contains SIP credentials).

Format — an **object keyed by extension** (not an array):

```json
{
  "12611": {
    "name": VoiceBot,
    "extension": "12611",
    "authId": "YOUR_SIP_AUTH_ID",
    "password": "YOUR_SIP_PASSWORD",
    "language": "he",
    "greeting": "שלום! איך אוכל לעזור?",
    "thinkingPhrase": "רגע אחד...",
    "prompt": "You are VoiceBot, a helpful AI assistant. Always respond in Hebrew. Keep responses under 40 words.",
    "voiceId": "YOUR_ELEVENLABS_VOICE_ID"
  }
}
```

| Field | Description |
|-------|-------------|
| `extension` | 3CX extension number |
| `authId` | SIP Auth ID from 3CX Phone Config tab (NOT the extension number) |
| `password` | SIP password from 3CX Phone Config tab |
| `language` | BCP-47 language code (`he`, `en`, `ar`, etc.) |
| `greeting` | Spoken when a call connects |
| `thinkingPhrase` | Spoken while waiting for AI response (e.g. "רגע אחד...") |
| `prompt` | System prompt sent to OpenClaw with every message |
| `voiceId` | ElevenLabs voice ID (only used if ElevenLabs is configured as TTS provider) |

---

## Environment Reference

```env
# Network — use LAN IP (the SBC routes internally)
EXTERNAL_IP=YOUR_SERVER_LAN_IP

# Drachtio
DRACHTIO_HOST=127.0.0.1
DRACHTIO_PORT=9022
DRACHTIO_SECRET=your_drachtio_secret
DRACHTIO_SIP_PORT=5070

# FreeSWITCH
FREESWITCH_HOST=127.0.0.1
FREESWITCH_PORT=8021
FREESWITCH_SECRET=JambonzR0ck$

# 3CX SIP — registrar is localhost because SBC handles the tunnel
SIP_DOMAIN=YOUR_COMPANY.3cx.cloud
SIP_REGISTRAR=127.0.0.1

# OpenClaw AI bridge
CLAUDE_API_URL=http://YOUR_OPENCLAW_IP:3333

# App ports
HTTP_PORT=3000
WS_PORT=3001
AUDIO_DIR=/app/audio

# Optional: higher-quality TTS/STT fallbacks
ELEVENLABS_API_KEY=
OPENAI_API_KEY=
```

> **Why `EXTERNAL_IP=LAN_IP`?** The SBC is co-located and routes INVITEs to the LAN interface. Use the LAN IP, not the public IP.
>
> **Why `SIP_REGISTRAR=127.0.0.1`?** The SmartSBC listens on `127.0.0.1:5060` and proxies REGISTER to 3CX Cloud via its tunnel.

---

## TTS / STT Stack

### Primary (free, no API keys)

| Component | Technology |
|-----------|-----------|
| **TTS** | [gTTS](https://github.com/pndurette/gTTS) — Google Translate TTS via Python |
| **STT** | [SpeechRecognition](https://github.com/Uberi/speech_recognition) — Google Web Speech API via Python |

Both are installed in the Docker image. Hebrew uses the `iw` language code for gTTS and `iw-IL` for STT (mapped automatically from `"language": "he"` in devices.json).

### Fallback chain (if API keys are set)

TTS: gTTS → OpenAI TTS → ElevenLabs
STT: Google Web Speech → OpenAI Whisper

---

## Outbound Calling API

The voice-app exposes a REST API on port 3000:

```bash
# Announce mode — play a message and hang up
curl -X POST http://localhost:3000/api/outbound-call \
  -H 'Content-Type: application/json' \
  -d '{
    "to": "12610",
    "device": "12611",
    "mode": "announce",
    "message": "שלום, יש לי הודעה חשובה עבורך."
  }'

# Conversation mode — stay on the line for two-way AI conversation
curl -X POST http://localhost:3000/api/outbound-call \
  -H 'Content-Type: application/json' \
  -d '{
    "to": "+15551234567",
    "device": "12611",
    "mode": "conversation",
    "message": "שלום! אני הבוט. התקשרתי לברר איך אתה מרגיש."
  }'
```

| Field | Description |
|-------|-------------|
| `to` | Phone number (E.164 `+15551234567`) or internal extension (`12610`) |
| `message` | Opening line spoken when the call connects |
| `device` | Extension or name of the calling device |
| `mode` | `announce` (play + hangup) or `conversation` (two-way AI conversation) |
| `context` | Background info for the AI — not spoken aloud |
| `timeoutSeconds` | Ring timeout (default: 30) |

---

## OpenClaw Phone-Call Skill

The `openclaw/extensions/phone-call` directory contains an OpenClaw plugin that lets the AI make phone calls as a tool:

```
openclaw/extensions/phone-call/
├── index.ts                 # Plugin entry point
├── package.json
├── openclaw.plugin.json     # Plugin manifest + config schema
└── src/
    └── phone-call-tool.ts   # Tool implementation
```

**Tool: `phone-call`**

| Parameter | Type | Description |
|-----------|------|-------------|
| `to` | string | Phone number or extension to call |
| `message` | string | What the device says when the call connects |
| `mode` | `announce` \| `conversation` | Call mode (default: `conversation`) |
| `device` | string | Device extension/name (optional, uses plugin default) |
| `context` | string | Background context for the AI (optional) |
| `timeoutSeconds` | number | Ring timeout (optional) |

**Plugin config** (in OpenClaw extension settings):

```json
{
  "voiceServerUrl": "http://YOUR_SERVER_LAN_IP:3000",
  "defaultDevice": "12611",
  "defaultMode": "conversation",
  "timeoutSeconds": 30
}
```

---

## Port Reference

| Port | Service | Note |
|------|---------|------|
| 5060 | 3CX SmartSBC | Docker container |
| 5070 | drachtio | Docker, host network |
| 5080 | FreeSWITCH SIP | Docker, host network |
| 5090 | SBC → 3CX tunnel | Outbound only |
| 8021 | FreeSWITCH ESL | Internal |
| 9022 | drachtio admin | Internal |
| 3000 | voice-app HTTP API | |
| 3001 | voice-app WebSocket | Audio streaming |
| 3333 | claude-api-server | Host process |
| 30000–30100 | RTP audio | Avoids 3CX SBC range (20000–20099) |

---

## Full Setup Guide

See [docs/SETUP.md](docs/SETUP.md) for the complete step-by-step guide including:

- 3CX SmartSBC installation
- 3CX extension configuration
- Docker setup
- claude-api-server setup
- ARM64 / Raspberry Pi notes
- Troubleshooting

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No INVITE reaching drachtio | Check `EXTERNAL_IP` (must be LAN IP), verify SBC tunnel |
| 403 on REGISTER | Auth ID ≠ extension number — find real Auth ID in 3CX Phone Config tab |
| No voice on inbound calls | Check `docker logs voice-app` for TTS errors |
| Outbound call not connecting | Check `SIP_DOMAIN` in .env, verify device credentials in devices.json |
| AI says "unexpected error" | Check `claude-api-server` is running: `curl http://localhost:3333/health` |

```bash
# View logs
docker logs voice-app -f
docker logs drachtio -f

# Check registrar
docker logs voice-app | grep REGISTRAR

# Test TTS manually
docker exec voice-app python3 -c "from gtts import gTTS; gTTS('שלום', lang='iw').save('/tmp/t.mp3')" && echo "OK"
```

---

## License

MIT
