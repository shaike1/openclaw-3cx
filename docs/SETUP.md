# OpenClaw 3CX Voice — Full Setup Guide

Complete guide for deploying an AI voice assistant on a 3CX extension using OpenClaw,
drachtio, FreeSWITCH, the claude-api-server bridge, and the OpenClaw phone-call plugin.

**Recommended platform:** ARM64 Linux (Oracle Cloud Free Tier works perfectly).

---

## Architecture

```
Phone (3CX app / desk phone)
        │
        ▼
3CX Cloud (YOUR_COMPANY.3cx.cloud)
        │  SIP over TLS (tunnel via SmartSBC)
        ▼
3CX SmartSBC  ─── Docker container, port 5060
        │             (x86_64 only — runs under QEMU on ARM64)
        │  SIP INVITE
        ▼
drachtio  ─── Docker, port 5070  [ARM64 native]
        │
        ▼
voice-app  ─── Docker, ports 3000/3001  [ARM64 native]
   │
   ├─ TTS: Google Cloud Wavenet → gTTS (free) → OpenAI → ElevenLabs
   ├─ STT: Google Cloud STT → Google Web Speech (free) → Whisper
   │
   └─ claude-api-server  ─── Docker or host, port 3333  [ARM64 native]
              │
              ▼  POST /conversation/process
        OpenClaw AI Gateway  (YOUR_OPENCLAW_IP:18790)
              │  AI response
              ▼
        FreeSWITCH  ─── Docker, port 5080/RTP  [ARM64 native on Oracle]
```

### ARM64 component status

| Component | ARM64 | Notes |
|-----------|-------|-------|
| `drachtio-server` | ✅ native | Official multi-arch image |
| `drachtio-freeswitch-mrf` | ✅ native | Works on Oracle Cloud ARM; may need `platform: linux/amd64` overlay on Raspberry Pi |
| `voice-app` (Node.js) | ✅ native | `node:20-slim` multi-arch |
| `claude-api-server` (Node.js) | ✅ native | `node:20-slim` multi-arch |
| `3cx-sbc` | ⚠️ x86_64 only | No ARM build from 3CX — runs under QEMU emulation |
| Google Cloud TTS/STT | ✅ native | REST API — no binary dependencies |
| gTTS / SpeechRecognition | ✅ native | Pure Python |

---

## Step 1: Server Preparation

### Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Re-login for group membership to take effect
```

### Enable QEMU for 3CX SBC (ARM64 only)

The 3CX SmartSBC binary is x86_64 only. Enable QEMU emulation to run it on ARM:

```bash
docker run --privileged --rm tonistiigi/binfmt --install amd64
```

### Clone the repository

```bash
git clone git@github.com:shaike1/openclaw-3cx.git ~/openclaw-3cx
cd ~/openclaw-3cx
```

---

## Step 2: 3CX SmartSBC Setup

The SBC tunnels SIP signaling between your server and 3CX Cloud. It runs as a Docker
container.

### 2.1 Get the SBC Auth Key

1. Log into your 3CX Admin panel (`https://YOUR_COMPANY.3cx.cloud/management`)
2. Go to **Admin → Settings → SBC**
3. Click **Add SBC** (or select your existing entry)
4. Note the **SBC Auth Key** — you'll need it in the next step

### 2.2 Provision the SBC (run once)

```bash
./sbc/provision.sh
# Enter the Auth Key when prompted
# This builds the SBC Docker image and writes /etc/3cxsbc.conf
```

> **Migrating from host service?** Stop it first:
> ```bash
> sudo systemctl stop 3cxsbc && sudo systemctl disable 3cxsbc
> ```

### 2.3 Verify the tunnel

After starting services (Step 6), confirm the SBC established its TLS tunnel to 3CX:

```bash
ss -tnp | grep 5090   # Should show ESTABLISHED to your 3CX cloud hostname
```

---

## Step 3: 3CX Extension Setup

Create a dedicated IP phone extension for the AI bot.

### 3.1 Add an extension

1. In 3CX Admin → **Users → Add User**
2. Create an IP phone extension (e.g. `12611`)

### 3.2 Get SIP credentials

1. Click the extension → **IP Phone** tab
2. Note these values:

   | 3CX field | Config field | Example |
   |-----------|-------------|---------|
   | Extension number | `extension` | `12611` |
   | **Auth Id** | `authId` | `EXAMPLE_AUTH_ID` |
   | Password | `password` | `abc123!` |
   | Registrar Hostname | `SIP_DOMAIN` | `YOUR_COMPANY.3cx.cloud` |

![3CX IP Phone configuration tab](Screenshots/3cx_phone_config.png)

> **Important:** The **Auth ID is not the extension number.** Look for the "Auth Id *" field
> on the IP Phone tab — it's a separate credential string.

> The **Routing Device** field should show your SBC name (e.g. `SBC623709`) once registered.
> If it shows "No SBC" the tunnel isn't connected — check Step 2.

---

## Step 4: Configure the Stack

### 4.1 Create `.env`

```bash
cp .env.example .env
nano .env
```

Key settings:

```env
# ── Network ────────────────────────────────────────────────────────────────
# CRITICAL: Use the server's private LAN IP, not the public IP.
# On Oracle Cloud / AWS / GCP, the public IP is NOT on any network interface.
# Setting EXTERNAL_IP to the public IP will cause RTP to be unreachable.
EXTERNAL_IP=10.0.0.4          # example: Oracle Cloud private IP

# ── 3CX SIP ────────────────────────────────────────────────────────────────
SIP_DOMAIN=YOUR_COMPANY.3cx.cloud
SIP_REGISTRAR=127.0.0.1       # SBC is on same host, listens on 127.0.0.1:5060

# ── OpenClaw bridge ────────────────────────────────────────────────────────
CLAUDE_API_URL=http://127.0.0.1:3333
OPENCLAW_HOST=YOUR_OPENCLAW_IP
OPENCLAW_PORT=18790

# ── Google Cloud TTS/STT (recommended) ────────────────────────────────────
# Create key: console.cloud.google.com → APIs & Services → Credentials → API Key
# Enable: Cloud Text-to-Speech API + Cloud Speech-to-Text API
GOOGLE_CLOUD_KEY=AIzaSy...

# ── MOSS TTS (GPU voice cloning — x86 only) ────────────────────────────────
# Leave empty on ARM — MOSS inference takes >15s, causing call timeouts
MOSS_TTS_URL=

# ── Other settings ─────────────────────────────────────────────────────────
DRACHTIO_HOST=127.0.0.1
DRACHTIO_PORT=9022
DRACHTIO_SECRET=your_drachtio_secret
DRACHTIO_SIP_PORT=5070
FREESWITCH_HOST=127.0.0.1
FREESWITCH_PORT=8021
FREESWITCH_SECRET=JambonzR0ck$
HTTP_PORT=3000
WS_PORT=3001
AUDIO_DIR=/app/audio
```

### 4.2 Create `voice-app/config/devices.json`

```bash
cp voice-app/config/devices.json.example voice-app/config/devices.json
nano voice-app/config/devices.json
```

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

> **Note:** `authId` is from the 3CX IP Phone tab, not the extension number. `voiceId` is only
> used if ElevenLabs is configured as a TTS fallback.

---

## Step 5: Google Cloud TTS/STT (Recommended)

Setting up Google Cloud gives you:
- **Wavenet TTS voices** — natural-sounding, supports Hebrew/Arabic/Russian/etc.
- **Accurate STT** — significantly better than free Google Web Speech

### 5.1 Create a Google Cloud API key

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Go to **APIs & Services → Library**
4. Enable **Cloud Text-to-Speech API**
5. Enable **Cloud Speech-to-Text API**
6. Go to **APIs & Services → Credentials → Create Credentials → API Key**
7. Copy the key into `.env` as `GOOGLE_CLOUD_KEY=AIzaSy...`

### 5.2 Apply without rebuilding

After adding the key to `.env`, force-recreate the container:

```bash
docker compose up -d --force-recreate voice-app
# Verify the key is now inside the container:
docker exec voice-app printenv GOOGLE_CLOUD_KEY
```

> **Why `--force-recreate`?** `docker compose restart` does NOT re-read `env_file`.
> Only `up --force-recreate` applies `.env` changes to running containers.

### 5.3 Voice configuration

TTS voices are selected automatically per language. To override the Hebrew voice:

```env
GOOGLE_TTS_VOICE=he-IL-Wavenet-B
```

Available Hebrew voices: `he-IL-Wavenet-A` (female, default), `he-IL-Wavenet-B` (male),
`he-IL-Wavenet-C` (female), `he-IL-Wavenet-D` (male).

---

## Step 6: Start Docker Services

### New deployment (full containerized stack)

```bash
cd ~/openclaw-3cx

# Build all images (including SBC and api-server)
docker compose --profile full build

# Start everything
docker compose --profile full up -d

# Watch logs
docker logs voice-app -f
```

### Existing deployment (SBC already running as host service)

```bash
docker compose build voice-app
docker compose up -d   # starts drachtio, freeswitch, voice-app only
```

### Expected voice-app startup

```
DRACHTIO Connected at ...10.0.0.4:5070
MULTI-REGISTRAR Registering VoiceBot (ext 12611)
MULTI-REGISTRAR   Contact: sip:12611@10.0.0.4:5070
FREESWITCH established successfully on attempt 1
READY Voice interface is fully connected!
HTTP Server started on port 3000
WEBSOCKET Audio fork server started on port 3001
MULTI-REGISTRAR VoiceBot SUCCESS - Registered as ext 12611
```

---

## Step 7: OpenClaw Phone-Call Plugin

The `openclaw-phone-call/` directory contains an OpenClaw plugin that lets the AI itself
initiate calls as a tool action. This is what enables scenarios like:

- AI calls a user to deliver a notification
- AI calls an extension on demand when instructed by another user
- Automated outbound calls triggered by events

### 7.1 Install the plugin

Copy the plugin into your OpenClaw extensions folder:

```bash
mkdir -p ~/.openclaw/extensions
cp -R openclaw-phone-call ~/.openclaw/extensions/phone-call
cd ~/.openclaw/extensions/phone-call
npm install
```

Restart the OpenClaw Gateway to load the plugin.

### 7.2 Configure the plugin

In OpenClaw, navigate to the plugin settings for `phone-call` and configure:

```json
{
  "voiceServerUrl": "http://YOUR_SERVER_LAN_IP:3000",
  "defaultDevice": "12611",
  "defaultMode": "conversation",
  "timeoutSeconds": 30
}
```

| Field | Description |
|-------|-------------|
| `voiceServerUrl` | URL of the voice-app HTTP API (port 3000) |
| `defaultDevice` | Extension to use when not specified in the tool call |
| `defaultMode` | `announce` or `conversation` |
| `timeoutSeconds` | Ring timeout in seconds |

### 7.3 How the plugin works

The plugin registers a `phone-call` tool in OpenClaw. When the AI uses it:

1. OpenClaw calls `phone-call-tool.ts` with the parameters
2. The tool sends `POST /api/outbound-call` to the voice-app
3. voice-app dials the number via drachtio → FreeSWITCH → 3CX SBC
4. When answered, the greeting is played via TTS
5. In `conversation` mode, the call stays live and routes speech through OpenClaw

**Tool parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | string | yes | E.164 number (`+15551234567`) or extension (`12610`) |
| `message` | string | yes | Opening line spoken when answered |
| `mode` | `announce`\|`conversation` | no | Default: plugin `defaultMode` |
| `device` | string | no | Override calling device |
| `context` | string | no | Silent background context for the AI |
| `timeoutSeconds` | number | no | Ring timeout (5–120) |

### 7.4 Test the plugin

From OpenClaw chat, ask the AI:

> "Call extension 12610 and say hello"

The AI will invoke `phone-call` → the extension will ring → when answered, the message is spoken.

---

## Step 8: Test End-to-End

### Inbound call test

1. Dial extension `12611` from any 3CX phone or app
2. You should hear the greeting
3. Speak — watch `docker logs voice-app -f` for STT output
4. The AI should respond via TTS

### Outbound call via API

```bash
curl -X POST http://YOUR_SERVER_IP:3000/api/outbound-call \
  -H 'Content-Type: application/json' \
  --data-binary '{
    "to": "12610",
    "device": "12611",
    "mode": "conversation",
    "message": "שלום! במה אוכל לעזור?"
  }'
```

---

## ARM64 Deployment Notes

### Challenges encountered

Running the full voice stack on ARM64 (Oracle Cloud) introduced several issues:

**1. `expectSession TIMEOUT` — no audio**

FreeSWITCH's audio fork WebSocket connects to voice-app immediately after the call is
answered. If TTS takes too long to generate the greeting, FreeSWITCH times out and the
call appears to have no audio. Root cause on ARM: MOSS TTS inference via Gradio took
>15 seconds across a network.

Fix: disable MOSS TTS on ARM by setting `MOSS_TTS_URL=` (empty). gTTS delivers audio in
~500 ms.

**2. `EXTERNAL_IP` must be the private IP on Oracle Cloud**

Oracle Cloud uses NAT — the public IP is not bound to any network interface. Setting
`EXTERNAL_IP` to the public IP causes drachtio to advertise an unreachable address in SDP,
and RTP never arrives.

Fix: always set `EXTERNAL_IP` to the private LAN IP (e.g. `10.0.0.4`).

**3. Google STT: `FLAC conversion utility not available`**

The free Google Web Speech fallback uses the Python `SpeechRecognition` library, which
requires the `flac` CLI binary to convert WAV files before sending to Google. The older
Docker image didn't include it.

Fix: the Dockerfile now includes `apt-get install -y flac`. Rebuild the voice-app image.

**4. `.env` changes require `--force-recreate`**

`docker compose restart` keeps the container's original environment. New `env_file` values
(e.g. `GOOGLE_CLOUD_KEY`) only take effect after a full container recreation:

```bash
docker compose up -d --force-recreate voice-app
```

**5. 3CX SBC is x86_64 only**

3CX does not provide an ARM build of SmartSBC. On ARM, it runs under QEMU x86 emulation via
`platform: linux/amd64` in the compose file. This is enabled automatically by the
`docker-compose.arm64.yml` overlay.

Performance: acceptable for voice bot use cases. Not suitable for high-volume call centers.

### ARM64 quick deploy

```bash
# Enable QEMU (once per host)
docker run --privileged --rm tonistiigi/binfmt --install amd64

# Configure
cp .env.example .env && nano .env   # set EXTERNAL_IP to private LAN IP, MOSS_TTS_URL=

# Deploy with QEMU overlay for x86-only containers (SBC)
docker compose -f docker-compose.yml -f docker-compose.arm64.yml --profile full up -d
```

---

## TTS / STT Details

### Text-to-Speech chain

```
generateSpeech(text, language)
  │
  ├─ GOOGLE_CLOUD_KEY set? → Google Cloud TTS (Wavenet) — ~300 ms
  │     └─ fails → log warning, try next
  │
  ├─ MOSS_TTS_URL set? → MOSS Gradio TTS — >15 s on ARM (disable on ARM)
  │     └─ fails → log warning, try next
  │
  ├─ always → gTTS (Google Translate TTS, free) — ~500 ms
  │     └─ fails → log warning, try next
  │
  ├─ OPENAI_API_KEY set? → OpenAI TTS — ~1 s
  │     └─ fails → log warning, try next
  │
  └─ ELEVENLABS_API_KEY set? → ElevenLabs — ~1 s
```

### Speech-to-Text chain

```
transcribe(audioBuffer, { language })
  │
  ├─ GOOGLE_CLOUD_KEY set? → Google Cloud STT (model: latest_long) — accurate
  │     └─ fails → log warning, try next
  │
  ├─ always → Google Web Speech via Python SpeechRecognition (free)
  │     └─ requires `flac` binary in Docker image
  │     └─ fails → log warning, try next
  │
  └─ OPENAI_API_KEY set? → OpenAI Whisper
```

---

## Troubleshooting

### No audio / `expectSession TIMEOUT`

Disable slow TTS:

```bash
# In .env
MOSS_TTS_URL=    # leave empty on ARM
```

### Env vars not updating

```bash
docker compose up -d --force-recreate voice-app
docker exec voice-app printenv GOOGLE_CLOUD_KEY   # verify
```

### Google STT: FLAC error

```bash
docker compose build voice-app   # flac is in Dockerfile now
docker compose up -d --force-recreate voice-app
```

### 403 on SIP REGISTER

Auth ID is not the extension number. Get it from the 3CX IP Phone tab.

### AI returns "unexpected error"

```bash
curl http://localhost:3333/health                      # api-server up?
curl -X POST http://OPENCLAW_IP:18790/conversation/process \
  -H 'Content-Type: application/json' -d '{"text":"hello"}'  # openclaw up?
```

### SBC not connecting

```bash
ss -tnp | grep 5090   # should show ESTAB to 3CX cloud hostname
docker logs 3cx-sbc -f
```

For more see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
