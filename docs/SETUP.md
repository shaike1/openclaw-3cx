# OpenClaw 3CX Voice Setup Guide

Complete setup guide for running an AI voice assistant on a 3CX extension using OpenClaw, drachtio, FreeSWITCH, and Google TTS/STT.

---

## Architecture Overview

```
Phone (3CX app/desk phone)
        │
        ▼
3CX Cloud (your-company.3cx.cloud)
        │  SIP trunk
        ▼
3CX SmartSBC  ← Docker container (port 5060)  [x86_64 only]
        │  SIP INVITE
        ▼
drachtio  ← Docker (port 5070)  [multi-arch]
        │
        ▼
voice-app  ← Docker (port 3000/3001)  [multi-arch]
   ├── gTTS (Google TTS, free, no key)
   ├── Google Web Speech STT (free, no key)
   └── claude-api-server ← Docker (port 3333)  [multi-arch]
              │
              ▼
        OpenClaw AI (separate server)
        │
        ▼
FreeSWITCH  ← Docker (port 5080)  [x86_64 only]
```

**ARM64 note:** FreeSWITCH and 3CX SmartSBC have x86_64 pre-built images only.
See [ARM64 section](#arm64--raspberry-pi-compatibility) for QEMU emulation workaround.

---

## Requirements

### Server
- Linux x86_64 (see ARM64 section below)
- Docker + Docker Compose
- Python 3.x with pip
- Public or LAN IP reachable by the 3CX SBC
- Ports open: 5060 (SBC SIP), 5070 (drachtio SIP), 5080 (FreeSWITCH), 8021 (ESL), 9022 (drachtio admin), 3000/3001 (HTTP/WS), 30000-30100 (RTP)

### Accounts / Services
- 3CX account (hosted cloud, e.g. `yourcompany.3cx.us`)
- OpenClaw instance running and accessible (this setup uses `YOUR_OPENCLAW_IP`)
- No paid API keys required (gTTS + Google STT are free)

---

## Step 1: Provision the 3CX SmartSBC

The SBC handles the TLS tunnel between your server and 3CX Cloud. It runs as a **Docker container** in this stack.

> ⚠️ **x86_64 only.** The 3CX SBC binary is x86_64 — see [ARM64 notes](#arm64--raspberry-pi-compatibility) if deploying on ARM.

### 1a. Get the SBC Auth Key from 3CX Admin

1. Log into your 3CX Admin panel → **Admin → Settings → SBC**
2. Click **Add SBC** (or select your existing SBC entry)
3. Note the **SBC Auth Key** — you'll need it in the next step

### 1b. Provision the SBC (interactive, run once)

```bash
# From the project root — this builds the SBC container and writes /etc/3cxsbc.conf
./sbc/provision.sh
```

The script will ask for your SBC Auth Key, build the Docker image, and write the config.

> **Existing host-service users:** If you already have 3cxsbc running as a systemd service, it will continue to work — the Docker container is for new deployments. To migrate, stop the host service first:
> ```bash
> sudo systemctl stop 3cxsbc && sudo systemctl disable 3cxsbc
> ```

### Verify tunnel (after starting services in Step 6)

```bash
ss -tnp | grep 5090   # Should show ESTAB to your 3CX cloud hostname
```

---

## Step 2: Configure 3CX Admin — Add the SBC

1. Log into your 3CX Admin panel (`https://yourcompany.3cx.us`)
2. Go to **Admin → Settings → SBC → Add SBC**
3. Select **Raspberry Pi** (or generic Linux)
4. Note the **SBC Auth Key** — you'll need this for `/etc/3cxsbc.conf`

---

## Step 3: Create a 3CX Extension for the AI

1. In 3CX Admin, go to **Users → Add User**
2. Set up an IP phone extension (e.g. extension `12611`)
3. Click the extension → **IP Phone** tab
4. Note these values (needed for `devices.json`):
   - **Extension Number**: `12611`
   - **Auth ID**: the value shown in the "Auth Id" field (e.g. `YOUR_SIP_AUTH_ID`)
   - **Password**: the SIP password
   - **Registrar Hostname or IP**: your 3CX cloud FQDN (e.g. `YOUR_COMPANY.3cx.cloud`)
   - **Registrar SIP Port**: `5060`
   - **Outbound Proxy (SBC) Address**: your server's LAN IP (e.g. `YOUR_SERVER_LAN_IP`)

![3CX IP Phone configuration tab](Screenshots/3cx_phone_config.png)

> ⚠️ The **Auth ID is not the extension number**. It's a separate field on the IP Phone tab — look for "Auth Id *". In the example above, the extension is `12610` but the Auth ID is a different string entirely.

> ⚠️ The **Routing Device** field (e.g. `SBC623709`) confirms the SBC is registered and routing calls. If it shows "No SBC" your SmartSBC is not connected — check Step 1.

---

## Step 4: Configure the Voice App

### 4.1 Device Config (`voice-app/config/devices.json`)

> ⚠️ This file is **gitignored** — it contains credentials. Configure it manually on each server.

Format must be an **object keyed by extension** (not an array):

```json
{
  "12611": {
    "name": VoiceBot,
    "extension": "12611",
    "authId": "YOUR_SIP_AUTH_ID",
    "password": "YOUR_SIP_PASSWORD",
    "voiceId": "YOUR_ELEVENLABS_VOICE_ID",
    "language": "he",
    "greeting": "שלום! איך אוכל לעזור?",
    "thinkingPhrase": "רגע אחד...",
    "prompt": "You are VoiceBot, a helpful AI assistant. Always respond in Hebrew. Keep responses under 40 words."
  }
}
```

**Fields:**
| Field | Description |
|-------|-------------|
| `extension` | 3CX extension number |
| `authId` | SIP Auth ID from 3CX Phone Config tab |
| `password` | SIP password from 3CX Phone Config tab |
| `language` | BCP-47 language code (`he`, `en`, `ar`, etc.) |
| `greeting` | Spoken when call connects |
| `thinkingPhrase` | Spoken while waiting for AI response |
| `prompt` | System prompt sent to OpenClaw with every message |
| `voiceId` | ElevenLabs voice ID (used only if ElevenLabs is configured) |

### 4.2 Environment File (`.env`)

> ⚠️ This file is **gitignored**. Configure manually.

```env
# Network — MUST be the LAN IP, not public IP
# The SBC is co-located, so it routes SIP to the LAN interface
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

# Optional (fallback TTS/STT — not required)
ELEVENLABS_API_KEY=
OPENAI_API_KEY=

# App ports
HTTP_PORT=3000
WS_PORT=3001
AUDIO_DIR=/app/audio
```

> **Why `SIP_REGISTRAR=127.0.0.1`?** The SmartSBC runs on the same machine and listens on `127.0.0.1:5060`. The voice-app sends REGISTER to the SBC, which forwards it via tunnel to 3CX Cloud.

> **Why `EXTERNAL_IP=LAN_IP`?** The SIP Contact header in REGISTER must point to an IP the SBC can reach. Since SBC and drachtio are on the same server, use the LAN IP (`YOUR_SERVER_LAN_IP`), not the public IP.

---

## Step 5: OpenClaw Bridge (`claude-api-server`)

A lightweight Node.js bridge sits between the voice-app and OpenClaw. It runs as a Docker container (recommended) or as a host process.

### Option A — Docker (recommended, included in `--profile full`)

```bash
# Set in .env:
# OPENCLAW_HOST=YOUR_OPENCLAW_IP
# OPENCLAW_PORT=18790
# Then start with:
docker compose --profile full up -d claude-api-server
```

### Option B — Host process (legacy / existing deployments)

```bash
cd claude-api-server
npm install
OPENCLAW_HOST=YOUR_OPENCLAW_IP node server.js &
```

Both options expose the bridge on port 3333. `CLAUDE_API_URL=http://127.0.0.1:3333` in `.env` works for both.

---

## Step 6: Start Docker Services

### New deployment (fully containerized)

```bash
cd /path/to/openclaw-3cx

# Build all images
docker compose --profile full build

# Start everything: SBC + drachtio + FreeSWITCH + claude-api-server + voice-app
docker compose --profile full up -d

# Check logs
docker logs voice-app -f
docker logs 3cx-sbc -f
docker logs claude-api-server -f
```

### Existing deployment (host SBC + host claude-api-server still running)

```bash
# Only rebuild/restart the core voice stack — leaves host SBC and api-server untouched
docker compose build voice-app
docker compose up -d   # starts drachtio, freeswitch, voice-app only
```

### Expected startup in voice-app logs

```
DRACHTIO Connected at ...YOUR_SERVER_LAN_IP:5070
MULTI-REGISTRAR Registering <device> (ext XXXX)
MULTI-REGISTRAR   Contact: sip:XXXX@YOUR_SERVER_LAN_IP:5070
FREESWITCH established successfully
READY Voice interface is fully connected!
MULTI-REGISTRAR <device> SUCCESS - Registered as ext XXXX
```

---

## Step 7: Test a Call

1. Dial extension `12611` from any 3CX extension
2. You should hear the greeting in the configured language
3. Speak — the system will transcribe and respond via OpenClaw

---

## TTS / STT Details

### Text-to-Speech (gTTS)
- Uses Google Translate's TTS service (free, no API key)
- Installed in the Docker image via `pip3 install gtts`
- Language codes: uses `iw` for Hebrew (not `he`)
- Fallback chain: gTTS → OpenAI TTS → ElevenLabs

### Speech-to-Text (Google SpeechRecognition)
- Uses `pip3 install SpeechRecognition`
- Calls Google Web Speech API (free, no API key)
- Hebrew locale: `iw-IL`
- Fallback: OpenAI Whisper

---

## Port Reference

| Port | Service | Note |
|------|---------|------|
| 5060 | 3CX SmartSBC | Docker (`--profile full`) or host service |
| 5070 | drachtio | Docker, host network |
| 5080 | FreeSWITCH SIP | Docker, host network |
| 5090 | SBC → 3CX tunnel | Outbound only |
| 8021 | FreeSWITCH ESL | Internal |
| 9022 | drachtio admin | Internal |
| 3000 | voice-app HTTP API | |
| 3001 | voice-app WebSocket | Audio streaming |
| 3333 | claude-api-server | Docker (`--profile full`) or host process |
| 30000-30100 | RTP audio | Avoids 3CX SBC range (20000-20099) |

---

## ARM64 / Raspberry Pi Compatibility

### Component status

| Component | ARM64 support | Notes |
|-----------|--------------|-------|
| `drachtio/drachtio-server` | ✅ Native | Official multi-arch image |
| `drachtio/drachtio-freeswitch-mrf` | ⚠️ x86_64 only | No official ARM image |
| `voice-app` (Node.js) | ✅ Native | node:20-slim is multi-arch |
| `claude-api-server` (Node.js) | ✅ Native | node:20-slim is multi-arch |
| `3cx-sbc` (3CX SmartSBC) | ⚠️ x86_64 only | No ARM build from 3CX |
| `gTTS` / `SpeechRecognition` (Python) | ✅ Native | Pure Python, no binaries |

### QEMU workaround (recommended for ARM64)

Uncomment the `platform:` lines in `docker-compose.yml` for FreeSWITCH and/or the SBC:

```yaml
freeswitch:
  image: drachtio/drachtio-freeswitch-mrf:latest
  platform: linux/amd64   # QEMU emulation

sbc:
  build: ./sbc
  platform: linux/amd64   # QEMU emulation
```

This works on Raspberry Pi 4 / Apple Silicon / any ARM64 Linux with Docker.
Performance overhead is ~20–30% — acceptable for low-to-medium call volume.

### Alternative: Split deployment

Run FreeSWITCH and the SBC on a separate x86_64 machine (even a cheap VPS), and run the voice-app, drachtio, and claude-api-server natively on ARM64. drachtio can connect to a remote FreeSWITCH over ESL.

### Native ARM64 (advanced)

FreeSWITCH compiles on ARM64. To build a native image:
```bash
git clone https://github.com/drachtio/drachtio-freeswitch-mrf
cd drachtio-freeswitch-mrf
docker buildx build --platform linux/arm64 -t drachtio-freeswitch-mrf:arm64 .
```
This takes 20–40 minutes but produces a fully native image with no QEMU overhead.

---

## Troubleshooting

### No INVITE arriving at drachtio
- Check `EXTERNAL_IP` — must be LAN IP, not public IP
- Verify SBC tunnel: `ss -tnp | grep 5090` → should be ESTAB
- Check registration: `docker logs voice-app | grep REGISTRAR`

### 403 Invalid credentials on REGISTER
- The Auth ID is **not** the extension number
- Find the real Auth ID under the extension's Phone Config tab in 3CX Admin

### TTS/STT not working
- Check internet connectivity from the container (gTTS/STT call Google APIs)
- `docker exec voice-app python3 -c "from gtts import gTTS; gTTS('test').save('/tmp/t.mp3')"`

### AI returns "unexpected error"
- Check `claude-api-server` is running: `curl http://localhost:3333/health`
- Check OpenClaw bridge: `curl -X POST http://YOUR_OPENCLAW_IP:18790/conversation/process -H 'Content-Type: application/json' -d '{"text":"hello"}'`
