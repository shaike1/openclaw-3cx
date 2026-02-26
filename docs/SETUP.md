# OpenClaw 3CX Voice Setup Guide

Complete setup guide for running an AI voice assistant on a 3CX extension using OpenClaw, drachtio, FreeSWITCH, and Google TTS/STT.

---

## Architecture Overview

```
Phone (3CX app/desk phone)
        │
        ▼
3CX Cloud (YOUR_COMPANY.3cx.cloud)
        │  SIP trunk
        ▼
3CX SmartSBC  ← runs as OS service on your Linux server (port 5060)
        │  SIP INVITE (routes to Contact IP:port)
        ▼
drachtio (Docker, port 5070)
        │
        ▼
voice-app (Docker, port 3000/3001)
   ├── Google STT (SpeechRecognition, free)
   ├── OpenClaw AI (YOUR_OPENCLAW_IP:18790)
   └── Google TTS (gTTS, free)
        │
        ▼
FreeSWITCH (Docker, port 5080) — media/audio handling
```

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

## Step 1: Install the 3CX SmartSBC on the OS

The SmartSBC runs as a **host OS service** (not in Docker). It handles SIP signaling between your server and 3CX Cloud.

### Install (Debian/Ubuntu x86_64)

```bash
# Add 3CX repo
curl -fsSL https://downloads.3cx.com/downloads/misc/3cxsbc.gpg | sudo gpg --dearmor -o /usr/share/keyrings/3cx-sbc.gpg
echo "deb [signed-by=/usr/share/keyrings/3cx-sbc.gpg] https://downloads.3cx.com/repo sbc main" | \
  sudo tee /etc/apt/sources.list.d/3cxsbc.list

sudo apt update
sudo apt install -y 3cxsbc
```

### Configure

The SBC reads its auth key from `/etc/3cxsbc.conf`. After installing:

```bash
# The SBC provisioning tool will write this file
sudo /usr/sbin/3CXSBCConfig
```

Or create it manually:
```ini
; /etc/3cxsbc.conf
SBCAuthKey=YOUR_SBC_AUTH_KEY_FROM_3CX_ADMIN
```

### Start / Enable

```bash
sudo systemctl enable 3cxsbc
sudo systemctl start 3cxsbc
sudo systemctl status 3cxsbc
```

### Verify tunnel

Once configured, the SBC establishes a TLS tunnel to 3CX Cloud:
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
3. Click the extension → **Phone Configuration** tab
4. Note these values (needed for `devices.json`):
   - **Extension**: `12611`
   - **Auth ID**: e.g. `YOUR_SIP_AUTH_ID`
   - **Password**: e.g. `YOUR_SIP_PASSWORD`
   - **Registrar**: your 3CX cloud FQDN (e.g. `YOUR_COMPANY.3cx.cloud`)
   - **SIP Port**: `5060`

> ⚠️ The Auth ID is **not** the extension number. Find it under the extension's Phone Config tab — it's the "Username" field shown for SIP phones.

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

A lightweight Node.js bridge sits between the voice-app and OpenClaw:

**File:** `claude-api-server/server.js`
**Runs on:** port 3333 (host process, not Docker)

```bash
cd claude-api-server
npm install
node server.js &
```

It calls `POST http://YOUR_OPENCLAW_IP:18790/conversation/process` and wraps the response as `{ success: true, response }`.

---

## Step 6: Start Docker Services

```bash
cd /path/to/openclaw-3cx

# First time — build the voice-app image
docker compose build voice-app

# Start all services
docker compose up -d

# Check logs
docker logs voice-app -f
docker logs drachtio -f
```

### Expected startup sequence in voice-app logs:
```
DRACHTIO Connected at ...YOUR_SERVER_LAN_IP:5070
MULTI-REGISTRAR Registering VoiceBot (ext 12611)
MULTI-REGISTRAR   Contact: sip:12611@YOUR_SERVER_LAN_IP:5070
FREESWITCH established successfully
READY Voice interface is fully connected!
MULTI-REGISTRAR VoiceBot SUCCESS - Registered as ext 12611
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
| 5060 | 3CX SmartSBC | Host OS process |
| 5070 | drachtio | Docker, host network |
| 5080 | FreeSWITCH SIP | Docker, host network |
| 5090 | SBC → 3CX tunnel | Outbound only |
| 8021 | FreeSWITCH ESL | Internal |
| 9022 | drachtio admin | Internal |
| 3000 | voice-app HTTP API | |
| 3001 | voice-app WebSocket | Audio streaming |
| 3333 | claude-api-server | Host process |
| 30000-30100 | RTP audio | Avoids 3CX SBC range (20000-20099) |

---

## ARM64 / Raspberry Pi Compatibility

> ⚠️ **Status: Not fully tested. See notes.**

### Docker images
| Image | ARM64 support |
|-------|--------------|
| `drachtio/drachtio-server` | ✅ Multi-arch (amd64/arm64) |
| `drachtio/drachtio-freeswitch-mrf` | ⚠️ x86_64 only — no official ARM image |
| `voice-app` (custom Node.js) | ✅ Builds on ARM64 (node:20-slim is multi-arch) |

The main blocker for ARM64 is `drachtio/drachtio-freeswitch-mrf`. Options:
1. **Build from source** on ARM64: `drachtio/drachtio-freeswitch-mrf` is open source — compile locally
2. **Use QEMU emulation**: Run x86_64 container via `platform: linux/amd64` in docker-compose (slow but functional for low-call-volume)

```yaml
# Temporary workaround in docker-compose.yml
freeswitch:
  image: drachtio/drachtio-freeswitch-mrf:latest
  platform: linux/amd64   # QEMU emulation on ARM64
```

### 3CX SmartSBC on ARM64
- The SmartSBC `.deb` package is x86_64 only
- No official ARM64 build available from 3CX at this time
- Alternative: Run SBC in x86_64 emulation or use a separate x86 box as SBC

### gTTS / SpeechRecognition on ARM64
Both Python packages run natively on ARM64 — no changes needed.

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
