const logger = require('./logger');

/**
 * STT/TTS Manager with primary + fallback pattern
 * Phase 1: Interface only - implementation in next step
 */
class SttTtsManager {
  constructor() {
    this.primaryStt = process.env.PRIMARY_STT || 'google-cloud';
    this.fallbackStt = process.env.FALLBACK_STT || 'openai-whisper';
    
    this.primaryTts = process.env.PRIMARY_TTS || 'google-cloud';
    this.fallbackTts = process.env.FALLBACK_TTS || 'openai-tts';
  }

  /**
   * Transcribe audio to text
   */
  async transcribe(audioBuffer, callId) {
    logger.debug('STT request', { callId, provider: this.primaryStt });
    
    // Phase 1: Return mock text
    return {
      success: true,
      text: 'Mock transcription (Phase 1)',
      provider: this.primaryStt,
      confidence: 0.95
    };
  }

  /**
   * Synthesize text to speech
   */
  async synthesize(text, callId) {
    logger.debug('TTS request', { callId, provider: this.primaryTts, textLength: text.length });
    
    // Phase 1: Return mock audio URL
    return {
      success: true,
      audioUrl: null, // Will be implemented in Phase 1b
      provider: this.primaryTts,
      duration: 1000
    };
  }

  /**
   * Detect if user is speaking (VAD)
   */
  detectVoiceActivity(audioBuffer) {
    // Phase 1: Return mock VAD result
    return {
      speaking: false,
      confidence: 0.0
    };
  }
}

module.exports = SttTtsManager;
