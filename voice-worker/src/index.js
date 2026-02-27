const express = require('express');
const Srf = require('drachtio-srf');
const CallHandler = require('./call-handler');
const SessionManager = require('./session-manager');
const SttTtsManager = require('./stt-tts-manager');
const MetricsCollector = require('./metrics');
const logger = require('./logger');
const config = require('./config');

const app = express();
const srf = new Srf();

// Initialize managers
const sessionManager = new SessionManager();
const sttTtsManager = new SttTtsManager();
const metrics = new MetricsCollector();
const callHandler = new CallHandler(srf, sessionManager, sttTtsManager, metrics);

// Health endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/ready', (req, res) => {
  const ready = srf.isConnected;
  res.status(ready ? 200 : 503).json({
    ready,
    timestamp: new Date().toISOString(),
    drachtioConnected: ready
  });
});

// Metrics endpoint
app.get('/metrics', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    stats: metrics.getStats()
  });
});

// Start health server
app.listen(config.healthPort, () => {
  logger.info(`Health server listening on port ${config.healthPort}`);
});

// Connect to Drachtio
srf.connect({
  host: config.drachtio.host,
  port: config.drachtio.port,
  secret: config.drachtio.secret
});

srf.on('connect', (err, hostport) => {
  if (err) {
    logger.error('Failed to connect to Drachtio', { error: err.message });
  } else {
    logger.info(`Connected to Drachtio at ${hostport}`);
  }
});

srf.on('error', (err) => {
  logger.error('Drachtio error', { error: err.message });
});

// Inbound call handler
srf.invite((req, res) => {
  callHandler.handleInvite(req, res);
});

logger.info('Voice worker v2 started', {
  version: '2.0.0',
  phase: '1b',
  drachtioHost: config.drachtio.host,
  drachtioPort: config.drachtio.port,
  healthPort: config.healthPort,
  bargeInEnabled: config.bargeIn.enabled,
  vadThreshold: config.bargeIn.vadThreshold
});
