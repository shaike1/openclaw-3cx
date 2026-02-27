#!/bin/bash

echo "📊 Canary Status Monitor"
echo "========================"
echo ""

# v2 Health
echo "🔍 v2 Health:"
curl -s http://localhost:3100/health 2>/dev/null || echo "❌ v2 not responding"
echo ""

# v2 Metrics
echo "📈 v2 Metrics:"
curl -s http://localhost:3100/metrics 2>/dev/null || echo "❌ metrics unavailable"
echo ""

# v1 vs v2 comparison
echo "🔄 Stack Status:"
echo "v1 containers:"
docker ps --filter "name=voice-app-v1" --format "  - {{.Names}}: {{.Status}}"
echo ""
echo "v2 containers:"
docker ps --filter "name=voice-worker-v2" --format "  - {{.Names}}: {{.Status}}"
echo ""

# Recent logs
echo "📝 Recent v2 logs:"
docker logs --tail 10 voice-worker-v2 2>/dev/null || echo "❌ no logs"
echo ""

echo "💡 Tips:"
echo "  - Watch live: docker logs -f voice-worker-v2"
echo "  - Check health: curl http://localhost:3100/health"
echo "  - View metrics: curl http://localhost:3100/metrics"
