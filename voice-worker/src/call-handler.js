const logger = require('./logger');
const config = require('./config');
const { v4: uuidv4 } = require('uuid');

class CallHandler {
  constructor(srf, sessionManager, sttTtsManager, metrics) {
    this.srf = srf;
    this.sessionManager = sessionManager;
    this.sttTts = sttTtsManager;
    this.metrics = metrics;
  }

  /**
   * Handle inbound call with full flow
   */
  async handleInvite(req, res) {
    const callId = req.get('Call-ID');
    const from = req.getParsedHeader('From').uri.user;
    const to = req.getParsedHeader('To').uri.user;
    
    logger.info('Inbound call received', { callId, from, to });
    
    // Initialize metrics
    this.metrics.initCall(callId);
    this.metrics.record(callId, 'answerLatency', Date.now());

    // Phase 1b: Answer and handle call
    try {
      const dialog = await this.srf.createUAC(req.get('Call-ID'), req, {
        localSdp: req.body
      });

      logger.info('Call answered', { callId });
      this.metrics.record(callId, 'answerLatency', Date.now() - this.metrics.get(callId).startTime);

      // Send greeting
      await this.speak(dialog, 'שלום, זהו בדיקה מערכת קול חדשה. איך אני יכול לעזור?', callId);

      // Phase 1b: Simple echo (no conversation yet)
      await this.listenAndRespond(dialog, callId);

    } catch (err) {
      logger.error('Call handling error', { callId, error: err.message });
      try {
        res.send(500);
      } catch (e) {}
      this.metrics.record(callId, 'endCall', 'error');
    }
  }

  /**
   * Speak text to caller
   */
  async speak(dialog, text, callId) {
    try {
      const result = await this.sttTts.synthesize(text, callId, {
        languageCode: 'he-IL',
        voiceName: 'he-IL-Wavenet-A'
      });

      if (result.success) {
        logger.info('TTS synthesized', { callId, audioSize: result.audio.length });
        this.metrics.record(callId, 'ttsSuccess');
        // In real implementation: play audio to dialog
        return result.audio;
      }
    } catch (err) {
      logger.error('TTS failed', { callId, error: err.message });
      this.metrics.record(callId, 'ttsError', err.message);
    }
  }

  /**
   * Listen and respond loop
   */
  async listenAndRespond(dialog, callId) {
    // Phase 1b: Mock listening - just wait 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    logger.info('Listen phase complete (Phase 1b)', { callId });
    
    // Send to Claude for response
    const response = await this.sessionManager.sendToClaude(callId, 'hello', 'inbound');
    
    if (response.success) {
      const reply = response.data?.reply || 'תודה, זהו כל מה שיש לי עכשיו.';
      await this.speak(dialog, reply, callId);
    }
    
    this.metrics.record(callId, 'endCall', 'completed');
    this.metrics.finalize(callId);
  }
}

module.exports = CallHandler;
