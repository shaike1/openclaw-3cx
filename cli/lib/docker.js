import { spawn, execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  getDockerComposePath,
  getEnvPath,
  getConfigDir,
  getProjectEnvPath,
  getDevicesJsonPath,
  getArm64OverlayPath,
  getProjectComposePath
} from './config.js';

/**
 * Detect which docker compose command to use
 * Some systems have 'docker compose' (plugin), others have 'docker-compose' (standalone)
 * @returns {{cmd: string, args: string[]}} Command and base args for compose
 */
function getComposeCommand() {
  // Try 'docker compose' (plugin) first
  try {
    execSync('docker compose version', { stdio: 'pipe' });
    return { cmd: 'docker', args: ['compose'] };
  } catch (e) {
    // Fall back to standalone docker-compose
    try {
      execSync('docker-compose --version', { stdio: 'pipe' });
      return { cmd: 'docker-compose', args: [] };
    } catch (e2) {
      // Default to plugin style, let it fail with helpful error
      return { cmd: 'docker', args: ['compose'] };
    }
  }
}

/**
 * Generate a random secret for Docker services
 * @returns {string} Random 32-character hex string
 */
function generateSecret() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Check if Docker is installed and running
 * @returns {Promise<{installed: boolean, running: boolean, error?: string}>}
 */
export async function checkDocker() {
  // Check if docker command exists
  const installed = await new Promise((resolve) => {
    const check = spawn('docker', ['--version']);
    check.on('close', (code) => resolve(code === 0));
    check.on('error', () => resolve(false));
  });

  if (!installed) {
    return {
      installed: false,
      running: false,
      error: 'Docker not found. Please install Docker from https://docs.docker.com/engine/install/'
    };
  }

  // Check if Docker daemon is running by running a simple command
  const running = await new Promise((resolve) => {
    const check = spawn('docker', ['ps', '-q'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    check.on('close', (code) => resolve(code === 0));
    check.on('error', () => resolve(false));
  });

  if (!running) {
    return {
      installed: true,
      running: false,
      error: 'Docker is installed but not running. Please start Docker Desktop.'
    };
  }

  return {
    installed: true,
    running: true
  };
}

/**
 * Generate docker-compose.yml from config
 * @param {object} config - Configuration object
 * @returns {string} Docker compose YAML content
 */
export function generateDockerCompose(config) {
  const externalIp = config.server.externalIp === 'auto' ? '${EXTERNAL_IP}' : config.server.externalIp;

  // Ensure secrets exist in config
  if (!config.secrets) {
    config.secrets = {
      drachtio: generateSecret(),
      freeswitch: generateSecret()
    };
  }

  // Determine drachtio port from config (5070 when 3CX SBC detected, 5060 otherwise)
  const drachtioPort = config.deployment && config.deployment.pi && config.deployment.pi.drachtioPort
    ? config.deployment.pi.drachtioPort
    : 5060;

  // Determine if running on Pi (ARM64) - use specific versions with platform
  const isPiMode = config.deployment && config.deployment.mode === 'pi-split';
  const drachtioImage = isPiMode ? 'drachtio/drachtio-server:0.9.4' : 'drachtio/drachtio-server:latest';
  const freeswitchImage = 'drachtio/drachtio-freeswitch-mrf:latest';
  const platformLine = isPiMode ? '\n    platform: linux/arm64' : '';

  return `version: '3.8'

# CRITICAL: All containers must use network_mode: host
# Docker bridge networking causes FreeSWITCH to advertise internal IPs
# in SDP, making RTP unreachable from external callers.

services:
  drachtio:
    image: ${drachtioImage}${platformLine}
    container_name: drachtio
    restart: unless-stopped
    network_mode: host
    command: >
      drachtio
      --contact "sip:*:${drachtioPort};transport=tcp,udp"
      --secret \${DRACHTIO_SECRET}
      --port 9022
      --loglevel info

  freeswitch:
    image: ${freeswitchImage}${platformLine}
    container_name: freeswitch
    restart: unless-stopped
    network_mode: host
    command: >
      freeswitch
      --sip-port 5080
      --rtp-range-start 30000
      --rtp-range-end 30100
    # RTP ports 30000-30100 avoid conflict with 3CX SBC (uses 20000-20099)
    environment:
      - EXTERNAL_IP=${externalIp}

  voice-app:
    build: ${config.paths.voiceApp}
    container_name: voice-app
    restart: unless-stopped
    network_mode: host
    env_file:
      - ${getEnvPath()}
    volumes:
      - ${config.paths.voiceApp}/audio:/app/audio
      - ${config.paths.voiceApp}/config:/app/config
    depends_on:
      - drachtio
      - freeswitch
`;
}

/**
 * Generate .env file from config
 * @param {object} config - Configuration object
 * @returns {string} Environment file content
 */
export function generateEnvFile(config) {
  // Ensure secrets exist in config
  if (!config.secrets) {
    config.secrets = {
      drachtio: generateSecret(),
      freeswitch: generateSecret()
    };
  }

  // claude-api-server runs locally (Docker container on same host)
  // It bridges to the remote OpenClaw server via OPENCLAW_HOST/OPENCLAW_PORT
  const claudeApiPort = config.server?.claudeApiPort || 3333;
  const claudeApiUrl = `http://127.0.0.1:${claudeApiPort}`;
  const openclawHost = config.deployment?.openclawHost || '127.0.0.1';
  const openclawPort = config.deployment?.openclawPort || 18790;

  // For split topology, FreeSWITCH may be on a remote host
  const freeswitchHost = (config.deployment?.topology === 'split' && config.deployment?.freeswitchHost)
    ? config.deployment.freeswitchHost
    : '127.0.0.1';
  const freeswitchPort = config.deployment?.freeswitchPort || 8021;

  // SIP registrar: use configured value or default to 127.0.0.1 (SBC tunnel)
  const sipRegistrar = config.sip?.registrar || '127.0.0.1';

  const lines = [
    '# ====================================',
    '# WARNING: DO NOT SHARE THIS FILE',
    '# Contains SIP credentials and API keys',
    '# ====================================',
    '# Generated by claude-phone CLI',
    '# ====================================',
    '',
    '# Network — must be the LAN IP (SBC routes to this)',
    `EXTERNAL_IP=${config.server.externalIp === 'auto' ? 'auto' : config.server.externalIp}`,
    '',
    '# Drachtio',
    'DRACHTIO_HOST=127.0.0.1',
    'DRACHTIO_PORT=9022',
    `DRACHTIO_SECRET=${config.secrets.drachtio}`,
    '# SIP port 5070 (3CX SBC listens on 5060, so drachtio uses 5070)',
    `DRACHTIO_SIP_PORT=5070`,
    '',
    '# FreeSWITCH',
    `FREESWITCH_HOST=${freeswitchHost}`,
    `FREESWITCH_PORT=${freeswitchPort}`,
    'FREESWITCH_SECRET=JambonzR0ck$',
    '',
    '# 3CX SIP — registrar is 127.0.0.1 because SBC handles the TLS tunnel',
    `SIP_DOMAIN=${config.sip?.domain || ''}`,
    `SIP_REGISTRAR=${sipRegistrar}`,
    '',
    '# OpenClaw AI bridge',
    `OPENCLAW_HOST=${openclawHost}`,
    `OPENCLAW_PORT=${openclawPort}`,
    `CLAUDE_API_URL=${claudeApiUrl}`,
    '',
    '# Optional TTS/STT (gTTS + Google Web Speech work without keys)',
    `ELEVENLABS_API_KEY=${config.api?.elevenlabs?.apiKey || ''}`,
    `OPENAI_API_KEY=${config.api?.openai?.apiKey || ''}`,
    '',
    '# App ports',
    `HTTP_PORT=${config.server.httpPort || 3000}`,
    'WS_PORT=3001',
    'AUDIO_DIR=/app/audio',
    '',
    '# Outbound Call Settings',
    'MAX_CONVERSATION_TURNS=10',
    'OUTBOUND_RING_TIMEOUT=30',
    ''
  ];

  return lines.join('\n');
}

/**
 * Generate devices.json from config
 * @param {object} config - Configuration object
 * @returns {string} devices.json content (object keyed by extension)
 */
export function generateDevicesJson(config) {
  const result = {};
  for (const device of (config.devices || [])) {
    const ext = device.extension;
    result[ext] = {
      name: device.name,
      extension: ext,
      authId: device.authId,
      password: device.password,
      voiceId: device.voiceId || '',
      language: device.language || 'en',
      greeting: device.greeting || `Hello! I am ${device.name}. How can I help you?`,
      thinkingPhrase: device.thinkingPhrase || 'Let me think...',
      prompt: device.prompt || 'You are a helpful AI assistant. Keep voice responses under 40 words.'
    };
  }
  return JSON.stringify(result, null, 2);
}

/**
 * Write Docker configuration files to the project root
 * Writes .env and devices.json — does NOT overwrite docker-compose.yml
 * (the project ships with its own compose file including profiles and overlays)
 * @param {object} config - Configuration object
 * @returns {Promise<void>}
 */
export async function writeDockerConfig(config) {
  // Write .env to project root (where docker-compose.yml's env_file references)
  const envPath = getProjectEnvPath();
  const envContent = generateEnvFile(config);
  await fs.promises.writeFile(envPath, envContent, { mode: 0o600 });

  // Write devices.json to voice-app/config/
  const devicesPath = getDevicesJsonPath();
  const devicesDir = path.dirname(devicesPath);
  if (!fs.existsSync(devicesDir)) {
    await fs.promises.mkdir(devicesDir, { recursive: true });
  }
  const devicesContent = generateDevicesJson(config);
  await fs.promises.writeFile(devicesPath, devicesContent, { mode: 0o644 });
}

/**
 * Start Docker containers
 * @param {object} [options] - Start options
 * @param {boolean} [options.useQemu] - Use ARM64 overlay (QEMU for x86 containers)
 * @param {string} [options.profile] - Docker compose profile to activate (e.g. 'full')
 * @returns {Promise<void>}
 */
export async function startContainers(options = {}) {
  const projectComposePath = getProjectComposePath();
  const arm64OverlayPath = getArm64OverlayPath();

  if (!fs.existsSync(projectComposePath)) {
    throw new Error('docker-compose.yml not found at: ' + projectComposePath + '\nRun "claude-phone setup" first.');
  }

  const projectRoot = path.dirname(projectComposePath);
  const compose = getComposeCommand();
  let composeArgs = [...compose.args, '-f', projectComposePath];

  // Add ARM64 QEMU overlay if configured
  if (options.useQemu && fs.existsSync(arm64OverlayPath)) {
    composeArgs.push('-f', arm64OverlayPath);
  }

  // Add Docker profile if specified (e.g. 'full' for SBC + claude-api-server)
  if (options.profile) {
    composeArgs.push('--profile', options.profile);
  }

  composeArgs.push('up', '-d');

  // Install QEMU binfmt if ARM64 QEMU mode is enabled
  if (options.useQemu) {
    await new Promise((resolve) => {
      const qemu = spawn('docker', ['run', '--privileged', '--rm', 'tonistiigi/binfmt', '--install', 'amd64'], {
        stdio: 'pipe'
      });
      qemu.on('close', () => resolve()); // best-effort, don't fail
    });
  }

  return new Promise((resolve, reject) => {
    const child = spawn(compose.cmd, composeArgs, {
      cwd: projectRoot,
      stdio: 'pipe'
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        if (output.includes('no matching manifest') ||
            (output.includes('image with reference') && output.includes('arm64'))) {
          const error = new Error(
            'ARM64 Docker image pull failed.\n\n' +
            'The arm64 overlay adds QEMU emulation for x86-only images.\n' +
            'Make sure QEMU binfmt is installed:\n' +
            '  docker run --privileged --rm tonistiigi/binfmt --install amd64\n\n' +
            'Or use the deploy script: ./scripts/deploy-arm64.sh --full'
          );
          reject(error);
        } else {
          reject(new Error(`Docker compose failed (exit ${code}): ${output}`));
        }
      }
    });
  });
}

/**
 * Stop Docker containers
 * @returns {Promise<void>}
 */
export async function stopContainers() {
  const projectComposePath = getProjectComposePath();

  if (!fs.existsSync(projectComposePath)) {
    // No containers to stop
    return;
  }

  const projectRoot = path.dirname(projectComposePath);
  const compose = getComposeCommand();
  const composeArgs = [...compose.args, '-f', projectComposePath, 'down'];

  return new Promise((resolve, reject) => {
    const child = spawn(compose.cmd, composeArgs, {
      cwd: projectRoot,
      stdio: 'pipe'
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Docker compose down failed (exit ${code}): ${output}`));
      }
    });
  });
}

/**
 * Get status of Docker containers
 * @returns {Promise<Array<{name: string, status: string}>>}
 */
export async function getContainerStatus() {
  const projectComposePath = getProjectComposePath();

  if (!fs.existsSync(projectComposePath)) {
    return [];
  }

  const compose = getComposeCommand();
  const composeArgs = [...compose.args, '-f', projectComposePath, 'ps', '--format', 'json'];

  return new Promise((resolve) => {
    const child = spawn(compose.cmd, composeArgs, {
      stdio: 'pipe'
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        try {
          // Parse JSON lines (one per container)
          const lines = output.trim().split('\n').filter(l => l);
          const containers = lines.map(line => {
            const data = JSON.parse(line);
            return {
              name: data.Name || data.Service,
              status: data.State || data.Status
            };
          });
          resolve(containers);
        } catch (error) {
          resolve([]);
        }
      } else {
        resolve([]);
      }
    });
  });
}
