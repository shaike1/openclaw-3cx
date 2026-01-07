# Outbound Calling Implementation

**Created:** December 19, 2025
**For:** Video 508 - Call Your Server - Voice Interface via 3CX
**Status:** ✅ Implementation Complete - Ready for Deployment

---

## Overview

Minimal outbound calling system that allows you to:
1. POST to `/api/outbound-call` with a phone number and message
2. Server initiates SIP call via drachtio → 3CX
3. When answered, plays TTS message via ElevenLabs
4. Hangs up automatically

**This enables THE GRAND PAYOFF:** Your server can call you when something happens.

---

## Files Created

All files are in `/packages/voice-app/lib/`:

| File | Lines | Purpose |
|------|-------|---------|
| `outbound-handler.js` | 242 | Core SIP logic using `srf.createUAC()` with Early Offer pattern |
| `outbound-session.js` | 251 | State machine for call lifecycle (QUEUED → DIALING → PLAYING → COMPLETED) |
| `outbound-routes.js` | 248 | Express routes for POST /api/outbound-call and status endpoints |
| `logger.js` | 29 | Simple logging utility (if not already on server) |

**Documentation:**
- `DEPLOYMENT.md` - Step-by-step deployment guide
- `INTEGRATION-EXAMPLE.js` - Code examples for modifying index.js
- `README-OUTBOUND.md` - This file

---

## Architecture

```
HTTP POST /api/outbound-call
         │
         ▼
┌─────────────────────┐
│ outbound-routes.js  │  Validate request, create session
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ outbound-session.js │  State: QUEUED → DIALING
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ outbound-handler.js │  1. Create FreeSWITCH endpoint (Early Offer)
│                     │  2. srf.createUAC(sipUri, localSdp)
│                     │  3. On answer: endpoint.modify(remoteSdp)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Phone Rings! 📞   │  State: PLAYING
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  tts-service.js     │  Generate TTS via ElevenLabs
│  (existing)         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ FreeSWITCH plays    │  endpoint.play(audioUrl)
│ audio to caller     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Hangup & Cleanup   │  State: COMPLETED
└─────────────────────┘
```

---

## API Reference

### POST /api/outbound-call

Initiate an outbound call.

**Request:**
```json
{
  "to": "+15551234567",           // REQUIRED: E.164 phone number
  "message": "Hello from server", // REQUIRED: Text to speak (max 1000 chars)
  "mode": "announce",             // Optional: "announce" or "conversation" (default: announce)
  "callerId": "+15559876543",     // Optional: Caller ID (defaults to DEFAULT_CALLER_ID env var)
  "timeoutSeconds": 30,           // Optional: Ring timeout 5-120 (default: 30)
  "webhookUrl": "https://..."     // Optional: POST status updates here
}
```

**Response (immediate):**
```json
{
  "success": true,
  "callId": "abc-123-uuid",
  "status": "queued",
  "message": "Call initiated"
}
```

**States:**
- `queued` - Call created, not yet dialing
- `dialing` - SIP INVITE sent, waiting for answer
- `playing` - Call answered, playing message
- `completed` - Call finished successfully
- `failed` - Call failed (busy/no_answer/error)

---

### GET /api/call/:callId

Get status of a specific call.

**Response:**
```json
{
  "success": true,
  "callId": "abc-123-uuid",
  "to": "+15551234567",
  "state": "completed",
  "mode": "announce",
  "createdAt": "2025-12-19T12:00:00.000Z",
  "answeredAt": "2025-12-19T12:00:05.234Z",
  "endedAt": "2025-12-19T12:00:15.678Z",
  "duration": 10
}
```

---

### GET /api/calls

List all active calls.

**Response:**
```json
{
  "success": true,
  "count": 2,
  "calls": [
    { "callId": "...", "to": "...", "state": "playing", ... },
    { "callId": "...", "to": "...", "state": "dialing", ... }
  ]
}
```

---

### POST /api/call/:callId/hangup

Manually hangup an active call.

**Response:**
```json
{
  "success": true,
  "message": "Call hangup initiated",
  "callId": "abc-123-uuid"
}
```

---

## Environment Variables

Add to `.env`:

```bash
# Outbound Calling
SIP_TRUNK_HOST=127.0.0.1          # 3CX server IP
DEFAULT_CALLER_ID=+15551234567     # Your registered phone number
HTTP_PORT=3000                      # Should match existing setting
```

---

## Deployment Checklist

- [ ] Copy files to server (see DEPLOYMENT.md)
- [ ] Update .env with SIP_TRUNK_HOST and DEFAULT_CALLER_ID
- [ ] Modify index.js to register routes (see INTEGRATION-EXAMPLE.js)
- [ ] Restart Docker containers
- [ ] Test with curl (see examples below)
- [ ] Verify phone rings and message plays
- [ ] Create n8n workflow for triggering calls

---

## Testing

### 1. Health Check
```bash
curl http://YOUR_SERVER_LAN_IP:3000/api/calls
```

Expected: `{"success":true,"count":0,"calls":[]}`

### 2. Make Test Call
```bash
curl -X POST http://YOUR_SERVER_LAN_IP:3000/api/outbound-call \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567",
    "message": "Hello from your server! This is a test call from the voice interface system."
  }'
```

Expected: `{"success":true,"callId":"...","status":"queued",...}`

### 3. Check Status
```bash
# Use callId from step 2
curl http://YOUR_SERVER_LAN_IP:3000/api/call/abc-123-uuid
```

Watch state progression: `queued` → `dialing` → `playing` → `completed`

---

## Integration Patterns

### n8n Workflow: Server Alert

```
┌─────────────────────┐
│ Home Assistant      │  Disk > 90%
│ Webhook Trigger     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ n8n Function Node   │  Format message
│                     │  "Alert: NAS storage at 95%"
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ HTTP Request Node   │  POST /api/outbound-call
│                     │  to: Chuck's number
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Chuck's Phone Rings │  📞 THE GRAND PAYOFF
└─────────────────────┘
```

### Claude Tool: "Call My Wife"

When Chuck says via inbound call: "Call my wife and tell her I'll be late"

```javascript
// In Claude's tool definitions
{
  name: "make_outbound_call",
  description: "Initiate an outbound phone call",
  parameters: {
    to: { type: "string", description: "Phone number to call" },
    message: { type: "string", description: "Message to deliver" }
  }
}

// Claude uses tool:
await makeOutboundCall({
  to: "+15559876543",  // Wife's number from contacts
  message: "Hi! Chuck asked me to let you know he's running about 30 minutes late and will be home soon."
});
```

---

## What's NOT Implemented (Future)

- **Conversation Mode** - Bidirectional conversation on outbound calls
- **Authentication** - API key or IP whitelist
- **Rate Limiting** - Prevent abuse
- **Retry Logic** - Auto-retry on no answer
- **Call Recording** - Save conversation transcripts
- **DTMF Input** - Caller can press buttons to respond

These can be added later if needed for the video.

---

## Key Implementation Details

### Early Offer Pattern

Why we do this:
1. Create FreeSWITCH endpoint FIRST to get local SDP
2. Send SIP INVITE with our SDP already included
3. When call is answered, connect endpoint with remote SDP

This avoids the "late offer" problem and ensures media flow works correctly.

```javascript
// STEP 1: Get local SDP from FreeSWITCH
const endpoint = await mediaServer.createEndpoint();
const localSdp = endpoint.local.sdp;

// STEP 2: Dial with our SDP
const { uac } = await srf.createUAC(sipUri, { localSdp });

// STEP 3: On answer, complete the connection
await endpoint.modify(uac.remote.sdp);
```

### State Machine

Tracks call lifecycle:

```
QUEUED ──┐
         ├──> DIALING ──┬──> PLAYING ──> COMPLETED
         │              │
         └──────────────┴──> FAILED
```

Each state transition:
- Logs to console
- Emits event
- Sends webhook (if configured)

### Error Handling

Maps SIP error codes to friendly reasons:
- 486 → `busy`
- 480/408 → `no_answer`
- 404 → `not_found`
- 503 → `service_unavailable`

---

## Troubleshooting

### "service_unavailable" Response

**Cause:** srf or mediaServer not ready when route is called

**Fix:** Ensure routes are registered AFTER both drachtio and FreeSWITCH connect

### Call Connects but No Audio

**Cause:** SDP negotiation failed or RTP ports blocked

**Fix:**
1. Verify EXTERNAL_IP env var matches server IP
2. Check FreeSWITCH logs for RTP errors
3. Ensure host network mode is enabled in Docker

### Phone Doesn't Ring

**Cause:** SIP routing issue with 3CX

**Fix:**
1. Verify SIP_TRUNK_HOST points to 3CX
2. Check 3CX outbound route configuration
3. Verify DEFAULT_CALLER_ID is registered in 3CX

### 404 on API Endpoint

**Cause:** Routes not registered

**Fix:** Check index.js integration - ensure `app.use('/api', outboundRouter)` is called

---

## File Size Summary

- **outbound-handler.js:** 242 lines, 7.8 KB
- **outbound-session.js:** 251 lines, 8.2 KB
- **outbound-routes.js:** 248 lines, 8.5 KB
- **logger.js:** 29 lines, 0.7 KB

**Total:** ~770 lines of clean, documented code

---

## Next Steps

1. **Deploy to sippycup** using DEPLOYMENT.md
2. **Test basic calling** with curl
3. **Create n8n workflow** for server alerts
4. **Record the demo** - THE GRAND PAYOFF moment
5. **Iterate if needed** - Add features for video

---

## The Grand Payoff

Once deployed, this enables the **mind-blowing moment** in the video:

> Chuck is on camera, explaining the system. Suddenly, his phone rings. He answers.
>
> Voice: "Alert: Your NAS storage is at 95 percent. The Plex media folder is using the most space."
>
> Chuck looks at camera: "My SERVER just called ME."

**This is what separates good tech content from LEGENDARY tech content.**

---

*Implementation by Atlas (Principal Engineer)*
*December 19, 2025*
*Video 508 - Call Your Server - Voice Interface via 3CX*
