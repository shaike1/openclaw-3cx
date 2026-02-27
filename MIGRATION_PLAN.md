# OpenClaw-3CX Voice v2 Migration Plan (LiveKit-style architecture)

## Goal
Migrate from the current monolithic voice path (`voice-app`) to a more resilient voice stack with clearer separation of concerns, better barge-in, and stronger session isolation — with **zero downtime** and fast rollback.

---

## Current Baseline (v1)
- SIP/3CX + SBC: working
- Inbound/outbound calls: working
- Two-way audio: working
- Known issues:
  - occasional bridge/LLM 500 fallbacks
  - sensitivity to session contention
  - mixed responsibilities in single service

---

## Target Topology (v2)

Phone ↔ 3CX/SBC ↔ SIP ingress ↔ Media/Room layer ↔ Voice Worker ↔ OpenClaw bridge

### Responsibilities split
1. **Telephony ingress**
   - SIP signaling and session lifecycle
2. **Media/room layer**
   - audio streams, participant state, interruption handling
3. **Voice worker**
   - STT → LLM → TTS orchestration
   - strict per-call session isolation
4. **Tool/brain bridge**
   - OpenClaw API calls, tool routing, policy enforcement

---

## Phase 1 — Parallel POC (No production impact)

### Deliverables
- New `voice-v2` compose stack on separate ports
- Health endpoints for each component
- Structured per-call logs (JSON)

### Tasks
- [ ] Create `docker-compose.voice-v2.yml`
- [ ] Add `voice-worker` service (separate container)
- [ ] Add env file `voice-v2/.env.example`
- [ ] Implement per-call `sessionKey = call-<uuid>`
- [ ] Implement one retry on `session locked` / upstream 500
- [ ] Add barge-in toggle and VAD thresholds
- [ ] Add `/health` + `/ready` for worker and bridge

### Exit Criteria
- [ ] 20 test calls completed
- [ ] 0 critical crashes
- [ ] no session-lock spoken to caller
- [ ] stable latency within acceptable target

---

## Phase 2 — Canary Routing (Limited real traffic)

### Deliverables
- 1 dedicated test extension routed to `voice-v2`
- rollback command ready and tested

### Tasks
- [ ] Route only extension `CANARY_EXT` to v2 path
- [ ] Keep v1 fully running as fallback
- [ ] Add alert thresholds:
  - [ ] call failure ratio > 5%
  - [ ] p95 response latency > threshold
  - [ ] repeated STT/TTS failures
- [ ] Daily canary report (success/failure/latency)

### Exit Criteria
- [ ] 48h stable canary
- [ ] failure ratio below threshold
- [ ] no user-facing regression vs v1

---

## Phase 3 — Full Cutover + Safety Net

### Deliverables
- v2 default path for production calls
- rollback to v1 in < 2 minutes

### Tasks
- [ ] Flip default routing to v2
- [ ] Keep v1 stopped but ready (warm rollback)
- [ ] Document rollback playbook
- [ ] Archive v1-only config after 7 stable days

### Exit Criteria
- [ ] 7 days stable production
- [ ] no critical call-flow incidents

---

## Reliability Checklist (Apply immediately)
- [ ] Keep gateway bind consistent (loopback or explicit reverse proxy pattern)
- [ ] Avoid auto-restart thrashing loops in heartbeat scripts
- [ ] Use background jobs for heavy backup/upload flows
- [ ] Keep one primary + one fallback for STT/TTS (not many chained fallbacks)
- [ ] Standardize call timeout and retry policy

---

## Observability (must-have)
Per call, log these fields:
- `callId`
- `direction` (inbound/outbound)
- `answerLatencyMs`
- `sttLatencyMs`
- `llmLatencyMs`
- `ttsLatencyMs`
- `bargeInCount`
- `endReason`
- `errors[]`

### Dashboards
- [ ] Calls/hour, success ratio
- [ ] Error type breakdown
- [ ] p50/p95 latencies
- [ ] Active sessions count

---

## Rollback Playbook
1. Route calls back to v1 extension/path
2. Restart v1 services if needed:
   - `docker compose up -d voice-app claude-api-server drachtio freeswitch sbc`
3. Disable canary route to v2
4. Confirm with smoke test call
5. Announce rollback completion

---

## Security & Access Notes
- Keep secrets out of repo (`.env`, device credentials)
- Use least-privilege API tokens
- Limit external exposure of media/control ports
- Keep OpenClaw gateway access explicit and audited

---

## Suggested Timeline
- Phase 1: 1–2 days
- Phase 2: 2 days
- Phase 3: 1 day + 7-day stabilization window

---

## Immediate Next Step (today)
- [ ] Build `docker-compose.voice-v2.yml` skeleton
- [ ] Add `voice-worker` scaffold with health endpoints
- [ ] Add canary extension mapping plan
