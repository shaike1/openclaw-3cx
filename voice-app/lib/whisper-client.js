/**
 * Speech-to-Text Client
 * Primary: Google Cloud Speech-to-Text API (requires GOOGLE_CLOUD_KEY)
 * Fallback: Google Web Speech API via Python SpeechRecognition (free, no API key)
 * Last resort: OpenAI Whisper API
 */

const { execFile } = require("child_process");
const WaveFile = require("wavefile").WaveFile;
const fs = require("fs");
const path = require("path");
const axios = require("axios");

/**
 * Convert L16 PCM buffer to WAV format
 */
function pcmToWav(pcmBuffer, sampleRate = 8000) {
  const wav = new WaveFile();
  const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
  wav.fromScratch(1, sampleRate, "16", samples);
  return Buffer.from(wav.toBuffer());
}

// Map BCP-47 short codes to Google Cloud STT language codes
const GOOGLE_CLOUD_STT_LANG = {
  'he': 'he-IL',
  'en': 'en-US',
  'ar': 'ar-IL',
  'ru': 'ru-RU',
  'fr': 'fr-FR',
  'es': 'es-ES',
};

/**
 * Transcribe using Google Cloud Speech-to-Text API (requires GOOGLE_CLOUD_KEY)
 */
async function transcribeGoogleCloud(wavPath, language) {
  const apiKey = process.env.GOOGLE_CLOUD_KEY;
  if (!apiKey) throw new Error("GOOGLE_CLOUD_KEY not set");

  const langCode = GOOGLE_CLOUD_STT_LANG[language] || 'en-US';
  const audioContent = fs.readFileSync(wavPath).toString('base64');

  const response = await axios.post(
    `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`,
    {
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: langCode,
        enableAutomaticPunctuation: true,
        model: 'latest_long'
      },
      audio: { content: audioContent }
    },
    { timeout: 15000 }
  );

  const results = response.data.results;
  if (!results || !results.length) return '';
  return results[0].alternatives[0].transcript || '';
}

/**
 * Transcribe using Google Web Speech API via Python SpeechRecognition (free)
 */
// Map BCP-47 short codes to Google Web Speech language codes (uses old ISO codes)
const GOOGLE_STT_LANG = {
  'he': 'iw-IL',
  'en': 'en-US',
  'ar': 'ar-IL',
  'ru': 'ru-RU',
  'fr': 'fr-FR',
  'es': 'es-ES',
};

function transcribeGoogle(wavPath, language) {
  const lang = GOOGLE_STT_LANG[language] || ('en' === language ? 'en-US' : (language + '-' + language.toUpperCase()));
  return new Promise((resolve, reject) => {
    const script = `
import speech_recognition as sr
r = sr.Recognizer()
with sr.AudioFile(${JSON.stringify(wavPath)}) as source:
    audio = r.record(source)
try:
    text = r.recognize_google(audio, language=${JSON.stringify(lang)})
    print(text)
except sr.UnknownValueError:
    print("")
except Exception as e:
    import sys
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
`;
    execFile("python3", ["-c", script], { timeout: 20000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`Google STT failed: ${stderr || error.message}`));
      resolve(stdout.trim());
    });
  });
}


/**
 * Transcribe using OpenAI Whisper API (fallback)
 */
async function transcribeWhisper(wavPath, language) {
  const OpenAI = require("openai");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(wavPath),
    model: "whisper-1",
    language: language,
    response_format: "text"
  });
  return transcription;
}

/**
 * Transcribe audio buffer to text
 * @param {Buffer} audioBuffer - Audio data (WAV or raw PCM)
 * @param {Object} options
 * @param {string} options.format - "wav" or "pcm" (default: "pcm")
 * @param {number} options.sampleRate - Sample rate for PCM (default: 8000)
 * @param {string} options.language - Language code (default: "en")
 * @returns {Promise<string>} Transcribed text
 */
async function transcribe(audioBuffer, options = {}) {
  const { format = "pcm", sampleRate = 8000, language = "en" } = options;

  // Convert to WAV if needed
  const wavBuffer = format === "pcm" ? pcmToWav(audioBuffer, sampleRate) : audioBuffer;
  const tempFile = path.join("/tmp", "stt-" + Date.now() + ".wav");
  fs.writeFileSync(tempFile, wavBuffer);

  try {
    // Primary: Google Cloud STT (accurate, requires GOOGLE_CLOUD_KEY)
    if (process.env.GOOGLE_CLOUD_KEY) {
      try {
        const text = await transcribeGoogleCloud(tempFile, language);
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] STT (Google Cloud) Transcribed: ${text.substring(0, 100)}`);
        return text;
      } catch (err) {
        const timestamp = new Date().toISOString();
        console.warn(`[${timestamp}] Google Cloud STT failed, trying free STT: ${err.message}`);
      }
    }

    // Fallback 1: Google Web Speech (free, no API key)
    try {
      const text = await transcribeGoogle(tempFile, language);
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] STT (Google) Transcribed: ${text.substring(0, 100)}`);
      return text;
    } catch (err) {
      const timestamp = new Date().toISOString();
      console.warn(`[${timestamp}] Google STT failed, trying Whisper: ${err.message}`);
    }

    // Fallback 2: OpenAI Whisper
    const text = await transcribeWhisper(tempFile, language);
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] STT (Whisper) Transcribed: ${text.substring(0, 100)}`);
    return text;

  } finally {
    try { fs.unlinkSync(tempFile); } catch (e) {}
  }
}

function isAvailable() {
  return true; // Google STT needs no API key
}

module.exports = { transcribe, pcmToWav, isAvailable };
