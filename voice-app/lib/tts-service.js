/**
 * Text-to-Speech Service
 * Primary: OpenAI TTS
 * Fallback: ElevenLabs (if ELEVENLABS_API_KEY set and quota available)
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const logger = require('./logger');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

// OpenAI TTS voice (used when voiceId is an ElevenLabs ID or unrecognized)
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'nova';
const OPENAI_TTS_MODEL = 'tts-1';

// Audio output directory (set via setAudioDir)
let audioDir = path.join(__dirname, '../audio-temp');

function setAudioDir(dir) {
  audioDir = dir;
  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
    logger.info('Created audio directory', { path: audioDir });
  }
}

function generateFilename(text) {
  const hash = crypto.createHash('md5').update(text).digest('hex').substring(0, 8);
  const timestamp = Date.now();
  return `tts-${timestamp}-${hash}.mp3`;
}

/**
 * Generate speech using local gTTS (Google Translate TTS - no API key needed)
 */
// gTTS uses old ISO 639-1 codes in some cases
const GTTS_LANG_MAP = { 'he': 'iw', 'yi': 'iw' };

function generateSpeechGTTS(text, language) {
  return new Promise((resolve, reject) => {
    const filename = generateFilename(text);
    const filepath = path.join(audioDir, filename);
    const rawLang = language || 'en';
    const lang = GTTS_LANG_MAP[rawLang] || rawLang;

    logger.info('Generating speech with gTTS', { textLength: text.length, lang });

    execFile('python3', ['-c',
      `from gtts import gTTS; t=gTTS(${JSON.stringify(text)}, lang=${JSON.stringify(lang)}); t.save(${JSON.stringify(filepath)})`
    ], { timeout: 15000 }, (error) => {
      if (error) return reject(new Error(`gTTS failed: ${error.message}`));
      if (!fs.existsSync(filepath)) return reject(new Error('gTTS produced no output file'));
      logger.info('gTTS successful', { filename, fileSize: fs.statSync(filepath).size });
      resolve(`http://127.0.0.1:3000/audio-files/${filename}`);
    });
  });
}

/**
 * Generate speech using OpenAI TTS
 */
async function generateSpeechOpenAI(text) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  logger.info('Generating speech with OpenAI TTS', {
    textLength: text.length,
    voice: OPENAI_TTS_VOICE,
    model: OPENAI_TTS_MODEL
  });

  const response = await axios({
    method: 'POST',
    url: 'https://api.openai.com/v1/audio/speech',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    data: {
      model: OPENAI_TTS_MODEL,
      input: text,
      voice: OPENAI_TTS_VOICE,
      response_format: 'mp3'
    },
    responseType: 'arraybuffer'
  });

  const filename = generateFilename(text);
  const filepath = path.join(audioDir, filename);
  fs.writeFileSync(filepath, response.data);

  logger.info('OpenAI TTS successful', { filename, fileSize: response.data.length });
  return `http://127.0.0.1:3000/audio-files/${filename}`;
}

/**
 * Generate speech using ElevenLabs
 */
async function generateSpeechElevenLabs(text, voiceId) {
  if (!ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not set');

  logger.info('Generating speech with ElevenLabs', {
    textLength: text.length,
    voiceId,
    model: 'eleven_turbo_v2'
  });

  const response = await axios({
    method: 'POST',
    url: `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`,
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY
    },
    data: {
      text,
      model_id: 'eleven_turbo_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true
      }
    },
    responseType: 'arraybuffer'
  });

  const filename = generateFilename(text);
  const filepath = path.join(audioDir, filename);
  fs.writeFileSync(filepath, response.data);

  logger.info('ElevenLabs TTS successful', { filename, fileSize: response.data.length });
  return `http://127.0.0.1:3000/audio-files/${filename}`;
}

/**
 * Convert text to speech - tries OpenAI first, falls back to ElevenLabs
 * @param {string} text - Text to convert
 * @param {string} voiceId - ElevenLabs voice ID (used only if ElevenLabs is chosen)
 * @returns {Promise<string>} HTTP URL to audio file
 */
async function generateSpeech(text, voiceId, language) {
  const startTime = Date.now();

  // Try gTTS first (free, no API key needed)
  try {
    const url = await generateSpeechGTTS(text, language);
    logger.info('Speech generated via gTTS', { latency: Date.now() - startTime });
    return url;
  } catch (error) {
    logger.warn('gTTS failed, trying OpenAI TTS', { error: error.message });
  }

  // Fallback: OpenAI TTS
  if (OPENAI_API_KEY) {
    try {
      const url = await generateSpeechOpenAI(text);
      logger.info('Speech generated via OpenAI TTS', { latency: Date.now() - startTime });
      return url;
    } catch (error) {
      logger.warn('OpenAI TTS failed, trying ElevenLabs', { error: error.message });
    }
  }

  // Fallback: ElevenLabs
  if (ELEVENLABS_API_KEY && voiceId) {
    try {
      const url = await generateSpeechElevenLabs(text, voiceId);
      logger.info('Speech generated via ElevenLabs', { latency: Date.now() - startTime });
      return url;
    } catch (error) {
      logger.error('ElevenLabs TTS failed', { error: error.message });
      throw new Error(`TTS generation failed: ${error.message}`);
    }
  }

  throw new Error('No TTS provider available');
}

function cleanupOldFiles(maxAgeMs = 60 * 60 * 1000) {
  try {
    const now = Date.now();
    const files = fs.readdirSync(audioDir);
    let deletedCount = 0;
    files.forEach(file => {
      if (!file.startsWith('tts-') || !file.endsWith('.mp3')) return;
      const filepath = path.join(audioDir, file);
      const stats = fs.statSync(filepath);
      if (now - stats.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filepath);
        deletedCount++;
      }
    });
    if (deletedCount > 0) {
      logger.info('Cleaned up old audio files', { deletedCount });
    }
  } catch (error) {
    logger.warn('Failed to cleanup old audio files', { error: error.message });
  }
}

// Initialize
setAudioDir(audioDir);
setInterval(() => { cleanupOldFiles(); }, 30 * 60 * 1000);

module.exports = {
  generateSpeech,
  setAudioDir,
  cleanupOldFiles
};
