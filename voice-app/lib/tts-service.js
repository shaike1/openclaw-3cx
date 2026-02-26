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
const MOSS_TTS_URL = process.env.MOSS_TTS_URL;
const GOOGLE_CLOUD_KEY = process.env.GOOGLE_CLOUD_KEY;

// OpenAI TTS voice (used when voiceId is an ElevenLabs ID or unrecognized)
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'nova';
const OPENAI_TTS_MODEL = 'tts-1';

// Path to the MOSS TTS Python client script
const MOSS_TTS_SCRIPT = path.join(__dirname, 'moss-tts.py');

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
 * Generate speech using MOSS TTS (GPU-accelerated voice cloning via Gradio)
 * @param {string} text - Text to synthesize
 * @param {string} [referenceAudio] - Optional path or URL for voice cloning
 */
function generateSpeechMoss(text, referenceAudio) {
  return new Promise((resolve, reject) => {
    if (!MOSS_TTS_URL) return reject(new Error('MOSS_TTS_URL not configured'));

    const hash = require('crypto').createHash('md5').update(text).digest('hex').substring(0, 8);
    const filename = `tts-${Date.now()}-${hash}.wav`;
    const filepath = path.join(audioDir, filename);

    const args = [MOSS_TTS_SCRIPT, text, filepath];
    if (referenceAudio) args.push(referenceAudio);

    logger.info('Generating speech with MOSS TTS', {
      textLength: text.length,
      hasRef: !!referenceAudio,
      url: MOSS_TTS_URL
    });

    const env = { ...process.env, MOSS_TTS_URL };
    execFile('python3', args, { timeout: 30000, env }, (error, stdout, stderr) => {
      if (error) {
        const msg = stderr?.trim() || error.message;
        return reject(new Error(`MOSS TTS failed: ${msg}`));
      }
      const out = stdout.trim();
      if (!out.startsWith('OK:') || !fs.existsSync(filepath)) {
        return reject(new Error(`MOSS TTS error: ${out || stderr}`));
      }
      const fileSize = fs.statSync(filepath).size;
      logger.info('MOSS TTS successful', { filename, fileSize });
      resolve(`http://127.0.0.1:3000/audio-files/${filename}`);
    });
  });
}

/**
 * Generate speech using Google Cloud Text-to-Speech API
 * Requires GOOGLE_CLOUD_KEY env var
 */
const GOOGLE_TTS_LANG = {
  'he': 'he-IL',
  'en': 'en-US',
  'ar': 'ar-XA',
  'ru': 'ru-RU',
  'fr': 'fr-FR',
  'es': 'es-ES',
};

// Preferred Wavenet voices per language (high quality, natural-sounding)
const GOOGLE_TTS_VOICE = {
  'he-IL': 'he-IL-Wavenet-A',
  'en-US': 'en-US-Wavenet-F',
  'ar-XA': 'ar-XA-Wavenet-A',
  'ru-RU': 'ru-RU-Wavenet-A',
  'fr-FR': 'fr-FR-Wavenet-A',
  'es-ES': 'es-ES-Wavenet-B',
};

async function generateSpeechGoogleCloud(text, language) {
  if (!GOOGLE_CLOUD_KEY) throw new Error('GOOGLE_CLOUD_KEY not set');

  const langCode = GOOGLE_TTS_LANG[language] || GOOGLE_TTS_LANG['en'];
  const voiceName = process.env.GOOGLE_TTS_VOICE || GOOGLE_TTS_VOICE[langCode] || null;

  logger.info('Generating speech with Google Cloud TTS', {
    textLength: text.length,
    language: langCode,
    voice: voiceName
  });

  const requestBody = {
    input: { text },
    voice: { languageCode: langCode },
    audioConfig: { audioEncoding: 'MP3' }
  };
  if (voiceName) requestBody.voice.name = voiceName;

  const response = await axios.post(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_CLOUD_KEY}`,
    requestBody
  );

  const audioContent = Buffer.from(response.data.audioContent, 'base64');
  const filename = generateFilename(text);
  const filepath = path.join(audioDir, filename);
  fs.writeFileSync(filepath, audioContent);

  logger.info('Google Cloud TTS successful', { filename, fileSize: audioContent.length });
  return `http://127.0.0.1:3000/audio-files/${filename}`;
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
 * Convert text to speech
 * Chain: Google Cloud TTS → MOSS TTS (GPU) → gTTS (free) → OpenAI TTS → ElevenLabs
 *
 * @param {string} text - Text to convert
 * @param {string} voiceId - ElevenLabs voice ID (last-resort fallback)
 * @param {string} [language] - BCP-47 language code
 * @param {string} [referenceAudio] - Path or URL for MOSS TTS voice cloning
 * @returns {Promise<string>} HTTP URL to audio file
 */
async function generateSpeech(text, voiceId, language, referenceAudio) {
  const startTime = Date.now();

  // Primary: Google Cloud TTS (high quality, requires GOOGLE_CLOUD_KEY)
  if (GOOGLE_CLOUD_KEY) {
    try {
      const url = await generateSpeechGoogleCloud(text, language);
      logger.info('Speech generated via Google Cloud TTS', { latency: Date.now() - startTime });
      return url;
    } catch (error) {
      logger.warn('Google Cloud TTS failed, falling back', { error: error.message });
    }
  }

  // Fallback 1: MOSS TTS (GPU-accelerated, voice cloning)
  if (MOSS_TTS_URL) {
    try {
      const url = await generateSpeechMoss(text, referenceAudio);
      logger.info('Speech generated via MOSS TTS', { latency: Date.now() - startTime });
      return url;
    } catch (error) {
      logger.warn('MOSS TTS failed, falling back to gTTS', { error: error.message });
    }
  }

  // Fallback 2: gTTS (free, no API key)
  try {
    const url = await generateSpeechGTTS(text, language);
    logger.info('Speech generated via gTTS', { latency: Date.now() - startTime });
    return url;
  } catch (error) {
    logger.warn('gTTS failed, trying OpenAI TTS', { error: error.message });
  }

  // Fallback 2: OpenAI TTS
  if (OPENAI_API_KEY) {
    try {
      const url = await generateSpeechOpenAI(text);
      logger.info('Speech generated via OpenAI TTS', { latency: Date.now() - startTime });
      return url;
    } catch (error) {
      logger.warn('OpenAI TTS failed, trying ElevenLabs', { error: error.message });
    }
  }

  // Fallback 3: ElevenLabs
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
