const logger = require('./logger');
const config = require('./config');

class CallHandler {
  constructor(srf) {
    this.srf = srf;
    this.activeCalls = new Map();
  }

  /**
   * Handle inbound call with session isolation
   */
  async handleInvite(req, res) {
    const callId = req.get('Call-ID');
    const from = req.getParsedHeader('From').uri.user;
    const to = req.getParsedHeader('To').uri.user;
    
    logger.info('Inbound call received', { callId, from, to });

    // Phase 1: Reject with info (testing)
    try {
      res.send(486, 'Busy Here - v2 POC testing mode');
      logger.info('Call rejected (Phase 1 POC)', { callId });
    } catch (err) {
      logger.error('Failed to send response', { callId, error: err.message });
      try {
        res.send(500);
      } catch (e) {}
    }
  }

  /**
   * Get call stats
   */
  getStats() {
    return {
      activeCalls: this.activeCalls.size,
      calls: Array.from(this.activeCalls.values())
    };
  }
}

module.exports = CallHandler;
