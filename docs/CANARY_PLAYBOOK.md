# Canary Deployment Playbook

## Phase 2: Canary Deployment

### Overview
Route test extension to v2 while keeping v1 for all other traffic. Monitor for 48h before full cutover.

### Enable Canary
```bash
# Enable for default extension 12699
./scripts/enable-canary.sh

# Or specify custom extension
./scripts/enable-canary.sh 12698
```

### Monitor Canary
```bash
# Quick status
./scripts/monitor-canary.sh

# Follow logs
docker logs -f voice-worker-v2

# Health checks
watch -n 5 'curl -s http://localhost:3100/health | jq .'
```

### Success Criteria
- [ ] v2 remains healthy (HTTP 200 on /health)
- [ ] No critical errors in logs
- [ ] Test calls complete successfully
- [ ] STT success rate > 90%
- [ ] TTS success rate > 95%
- [ ] No session lock errors spoken to caller

### Rollback (Immediate)
```bash
./scripts/disable-canary.sh
# All traffic back to v1 instantly
```

### After 48h Stable
1. Review metrics: `curl http://localhost:3100/metrics`
2. Check logs for errors
3. Make test calls to validate
4. If all green → proceed to Phase 3 (Full Cutover)

### Alerts to Watch For
- **Critical**: v2 container crashes (restart loop)
- **Warning**: STT/TTS fallback spikes
- **Info**: High latency on /metrics

### Troubleshooting
```bash
# v2 not responding?
docker ps | grep voice-worker-v2
docker logs --tail 50 voice-worker-v2

# Health check failing?
curl -v http://localhost:3100/health
docker exec voice-worker-v2 cat /app/logs/voice-worker.log

# Rollback immediately if unsure
./scripts/disable-canary.sh
```

