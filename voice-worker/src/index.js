const express = require('express');
const Srf = require('drachtio-srf');
const logger = require('./logger');
const config = require('./config');

const app = express();
const srf = new Srf();

// Health endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/ready', (req, res) => {
  const ready = srf.isConnected;
  res.status(ready ? 200 : 503).json({ ready, timestamp: new Date().toISOString() });
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
  logger.info(`Connected to Drachtio at ${hostport}`);
});

srf.on('error', (err) => {
  logger.error('Drachtio connection error:', err);
});

// Inbound call handler (placeholder for Phase 1)
srf.invite((req, res) => {
  const callId = req.get('Call-ID');
  const from = req.getParsedHeader('From').uri;
  const to = req.getParsedHeader('To').uri;
  
  logger.info('Inbound call', { callId, from, to });
  
  // Phase 1: Just log and reject for now
  res.send(486, 'Busy Here - v2 POC not yet handling calls');
});

logger.info('Voice worker v2 started', {
  drachtioHost: config.drachtio.host,
  drachtioPort: config.drachtio.port,
  healthPort: config.healthPort
});
