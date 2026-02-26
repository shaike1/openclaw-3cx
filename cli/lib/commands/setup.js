import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
import {
  loadConfig,
  saveConfig,
  configExists
} from '../config.js';
import {
  validateElevenLabsKey,
  validateOpenAIKey,
  validateVoiceId,
  validateExtension,
  validateIP,
  validateHostname,
  validateSbcAuthKey
} from '../validators.js';
import { getLocalIP, getProjectRoot } from '../utils.js';
import { isRaspberryPi } from '../platform.js';
import { detect3cxSbc } from '../port-check.js';
import { checkPiPrerequisites } from '../prerequisites.js';
import { checkClaudeApiServer } from '../network.js';
import { runPrereqChecks } from '../prereqs.js';

/**
 * Prompt for installation type
 * @param {string} currentType - Current installation type
 * @returns {Promise<string>} Selected installation type
 */
async function promptInstallationType(currentType = 'both') {
  const { type } = await inquirer.prompt([{
    type: 'list',
    name: 'type',
    message: 'What are you installing?',
    default: currentType,
    choices: [
      {
        name: 'Voice Server (Pi/Linux) - Handles calls, needs Docker',
        value: 'voice-server'
      },
      {
        name: 'API Server - Claude Code wrapper, minimal setup',
        value: 'api-server'
      },
      {
        name: 'Both (all-in-one) - Full stack on one machine',
        value: 'both'
      }
    ]
  }]);

  console.log(chalk.cyan(`\nYou selected: ${type === 'voice-server' ? 'Voice Server' : type === 'api-server' ? 'API Server' : 'Both (all-in-one)'}\n`));

  return type;
}

/**
 * Setup command - Interactive wizard for configuration
 * @param {object} options - Command options
 * @returns {Promise<void>}
 */
export async function setupCommand(options = {}) {
  console.log(chalk.bold.cyan('\n🎯 Claude Phone Setup\n'));

  // Run minimal prerequisite check first (Node.js only)
  if (!options.skipPrereqs) {
    const minimalPrereq = await runPrereqChecks({ type: 'minimal' });

    if (!minimalPrereq.success) {
      console.log(chalk.red('\n❌ Prerequisites not met. Please fix the issues above and try again.\n'));
      process.exit(1);
    }
  } else {
    console.log(chalk.yellow('⚠️  Skipping prerequisite checks (--skip-prereqs flag)\n'));
  }

  // Check if config exists
  const hasConfig = configExists();
  let existingConfig = null;

  if (hasConfig) {
    console.log(chalk.yellow('⚠️  Configuration already exists.'));
    const { shouldContinue } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'shouldContinue',
        message: 'Do you want to update your configuration?',
        default: false
      }
    ]);

    if (!shouldContinue) {
      console.log(chalk.gray('Setup cancelled.'));
      return;
    }

    existingConfig = await loadConfig();
  }

  // Prompt for installation type
  console.log(chalk.bold.cyan('\n📦 Installation Type\n'));
  const installationType = await promptInstallationType(
    existingConfig ? existingConfig.installationType : 'both'
  );

  // Detect platform (for Pi split-mode detection)
  const isPi = await isRaspberryPi();

  // If Pi detected and user selected "both", recommend voice-server
  if (isPi && installationType === 'both') {
    console.log(chalk.yellow('\n⚠️  Raspberry Pi detected!'));
    console.log(chalk.gray('For best performance, consider selecting "Voice Server" instead of "Both".'));
    console.log(chalk.gray('This allows the API server to run on a more powerful machine.\n'));

    const { changeToPi } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'changeToPi',
        message: 'Switch to Voice Server mode?',
        default: true
      }
    ]);

    if (changeToPi) {
      // Re-run with voice-server type
      return setupInstallationType('voice-server', existingConfig, isPi, options);
    }
  }

  // Run type-specific setup
  try {
    await setupInstallationType(installationType, existingConfig, isPi, options);
  } catch (error) {
    console.error(chalk.red('\n\n❌ Setup failed with error:'));
    console.error(chalk.red(error.message));
    console.error(chalk.gray('\nStack trace:'));
    console.error(chalk.gray(error.stack));
    process.exit(1);
  }
}

/**
 * Route to type-specific setup
 * @param {string} installationType - Installation type
 * @param {object} existingConfig - Existing config or null
 * @param {boolean} isPi - Is Raspberry Pi
 * @param {object} options - Command options
 * @returns {Promise<void>}
 */
async function setupInstallationType(installationType, existingConfig, isPi, options) {
  // Load existing config or create default
  const baseConfig = normalizeConfigForSetup(existingConfig || createDefaultConfig());

  // Run type-specific prereq checks (unless skipped)
  if (!options.skipPrereqs && installationType !== 'api-server') {
    console.log(chalk.bold.cyan(`\n🔍 Checking ${installationType === 'voice-server' ? 'Voice Server' : 'All'} prerequisites...\n`));
    const prereqResult = await runPrereqChecks({ type: installationType });

    if (!prereqResult.success) {
      console.log(chalk.red('\n❌ Prerequisites not met. Please fix the issues above and try again.\n'));
      process.exit(1);
    }
  }

  let config;

  switch (installationType) {
    case 'api-server':
      config = await setupApiServer(baseConfig);
      break;

    case 'voice-server':
      // Check if Pi - use Pi setup flow
      if (isPi) {
        config = await setupPi(baseConfig);
      } else {
        config = await setupVoiceServer(baseConfig);
      }
      break;

    case 'both':
    default:
      // Check if Pi - use Pi setup but with "both" type
      if (isPi) {
        config = await setupPi(baseConfig);
      } else {
        config = await setupBoth(baseConfig);
      }
      break;
  }

  // Set installation type in config
  config.installationType = installationType;

  // Save configuration
  const spinner = ora('Saving configuration...').start();
  try {
    await saveConfig(config);
    spinner.succeed('Configuration saved');
  } catch (error) {
    spinner.fail(`Failed to save configuration: ${error.message}`);
    throw error;
  }

  // Install dependencies for API server types
  if (installationType === 'api-server' || installationType === 'both') {
    const apiServerPath = config.paths?.claudeApiServer;
    if (apiServerPath && fs.existsSync(apiServerPath)) {
      const nodeModulesPath = path.join(apiServerPath, 'node_modules');
      if (!fs.existsSync(nodeModulesPath)) {
        const installSpinner = ora('Installing API server dependencies...').start();
        try {
          execSync('npm install', {
            cwd: apiServerPath,
            stdio: 'pipe'
          });
          installSpinner.succeed('API server dependencies installed');
        } catch (error) {
          installSpinner.fail(`Failed to install dependencies: ${error.message}`);
          console.log(chalk.yellow('\nYou can install manually with:'));
          console.log(chalk.cyan(`  cd ${apiServerPath} && npm install\n`));
        }
      }
    }
  }

  // Type-specific success messages
  console.log(chalk.bold.green('\n✓ Setup complete!\n'));

  if (installationType === 'api-server') {
    console.log(chalk.gray('To start the API server:'));
    console.log(chalk.gray('  claude-phone start\n'));
  } else {
    if (config.deployment?.openclawHost) {
      console.log(chalk.gray(`OpenClaw: http://${config.deployment.openclawHost}:${config.deployment.openclawPort || 18790}`));
      console.log(chalk.gray('Make sure OpenClaw is running and accessible.\n'));
    }
    console.log(chalk.gray('Next steps:'));
    console.log(chalk.gray('  1. Run "claude-phone start" to launch voice services'));
    if (config.devices && config.devices[0]) {
      console.log(chalk.gray('  2. Call extension ' + config.devices[0].extension + ' from your 3CX app'));
    }
    console.log(chalk.gray('  3. Start talking!\n'));
  }
}

/**
 * Normalize older config schemas so setup can safely reuse existing installs.
 * @param {object} config - Loaded config
 * @returns {object} Normalized config
 */
function normalizeConfigForSetup(config) {
  const normalized = { ...config };

  // API key schema migration: legacy top-level `elevenLabs` / `openai` -> `api.*`
  const legacyElevenLabs = normalized.elevenLabs || {};
  const legacyOpenAI = normalized.openai || {};
  normalized.api = normalized.api || {};
  normalized.api.elevenlabs = {
    apiKey: normalized.api.elevenlabs?.apiKey || legacyElevenLabs.apiKey || '',
    defaultVoiceId: normalized.api.elevenlabs?.defaultVoiceId || legacyElevenLabs.defaultVoiceId || '',
    validated: normalized.api.elevenlabs?.validated ?? false
  };
  normalized.api.openai = {
    apiKey: normalized.api.openai?.apiKey || legacyOpenAI.apiKey || '',
    validated: normalized.api.openai?.validated ?? false
  };

  // Server schema migration: legacy `externalIp` / `apiServer.port` -> `server.*`
  normalized.server = normalized.server || {};
  normalized.server.externalIp = normalized.server.externalIp || normalized.externalIp || 'auto';
  normalized.server.httpPort = normalized.server.httpPort || 3000;
  normalized.server.claudeApiPort = normalized.server.claudeApiPort || normalized.apiServer?.port || 3333;

  normalized.sip = normalized.sip || {};
  normalized.sip.domain = normalized.sip.domain || '';
  normalized.sip.registrar = normalized.sip.registrar || '';
  normalized.sip.transport = normalized.sip.transport || 'udp';

  // OpenClaw deployment fields
  normalized.deployment = normalized.deployment || {};
  normalized.deployment.openclawHost = normalized.deployment.openclawHost || '';
  normalized.deployment.openclawPort = normalized.deployment.openclawPort || 18790;
  normalized.deployment.topology = normalized.deployment.topology || 'x86';
  normalized.deployment.useQemu = normalized.deployment.useQemu || false;

  normalized.devices = Array.isArray(normalized.devices) ? normalized.devices : [];
  normalized.paths = normalized.paths || {
    voiceApp: path.join(getProjectRoot(), 'voice-app'),
    claudeApiServer: path.join(getProjectRoot(), 'claude-api-server')
  };
  normalized.secrets = normalized.secrets || {
    drachtio: generateSecret(),
    freeswitch: generateSecret()
  };

  return normalized;
}

/**
 * API Server only setup (minimal configuration)
 * @param {object} config - Current config
 * @returns {Promise<object>} Updated config
 */
async function setupApiServer(config) {
  console.log(chalk.bold.cyan('\n🖥️  API Server Configuration\n'));

  const answers = await inquirer.prompt([{
    type: 'input',
    name: 'port',
    message: 'API server port:',
    default: config.server?.claudeApiPort || 3333,
    validate: (input) => {
      const port = parseInt(input, 10);
      if (isNaN(port) || port < 1024 || port > 65535) {
        return 'Port must be between 1024 and 65535';
      }
      return true;
    }
  }]);

  return {
    ...config,
    server: {
      ...config.server,
      claudeApiPort: parseInt(answers.port, 10)
    }
  };
}

/**
 * Voice Server only setup (non-Pi)
 * @param {object} config - Current config
 * @returns {Promise<object>} Updated config
 */
async function setupVoiceServer(config) {
  if (!config.secrets) {
    config.secrets = { drachtio: generateSecret(), freeswitch: generateSecret() };
  }
  if (!config.deployment) {
    config.deployment = { mode: 'voice-server' };
  } else {
    config.deployment.mode = 'voice-server';
  }

  // Step 1: Deployment architecture
  console.log(chalk.bold('\n🏗️  Deployment Architecture'));
  config = await setupArch(config);

  // Step 2: OpenClaw AI gateway
  console.log(chalk.bold('\n🤖 OpenClaw AI Configuration'));
  config = await setupOpenClaw(config);

  // Step 3: API Keys (optional)
  console.log(chalk.bold('\n📡 API Keys (optional)'));
  config = await setupAPIKeys(config);

  // Step 4: 3CX SBC + SIP
  console.log(chalk.bold('\n☎️  3CX SBC Configuration'));
  config = await setupSBC(config);

  // Step 5: Device
  console.log(chalk.bold('\n📱 Device Configuration'));
  config = await setupDevice(config);

  // Step 6: Server (LAN IP, ports)
  console.log(chalk.bold('\n⚙️  Server Configuration'));
  const localIp = getLocalIP();
  const serverAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'externalIp',
      message: 'Server LAN IP (must be LAN IP — SBC routes SIP to this address):',
      default: config.server.externalIp === 'auto' ? localIp : config.server.externalIp,
      validate: (input) => validateIP(input) ? true : 'Invalid IP address format'
    },
    {
      type: 'input',
      name: 'httpPort',
      message: 'Voice app HTTP port:',
      default: config.server.httpPort || 3000,
      validate: (input) => {
        const port = parseInt(input, 10);
        return (!isNaN(port) && port >= 1024 && port <= 65535) ? true : 'Port must be between 1024 and 65535';
      }
    }
  ]);

  config.server.externalIp = serverAnswers.externalIp;
  config.server.httpPort = parseInt(serverAnswers.httpPort, 10);

  return config;
}

/**
 * Both (all-in-one) setup flow
 * @param {object} config - Current config
 * @returns {Promise<object>} Updated config
 */
async function setupBoth(config) {
  if (!config.secrets) {
    config.secrets = { drachtio: generateSecret(), freeswitch: generateSecret() };
  }
  if (!config.deployment) {
    config.deployment = { mode: 'both' };
  } else {
    config.deployment.mode = 'both';
  }

  // Step 1: Deployment architecture (ARM64/QEMU/split)
  console.log(chalk.bold('\n🏗️  Deployment Architecture'));
  config = await setupArch(config);

  // Step 2: OpenClaw AI gateway
  console.log(chalk.bold('\n🤖 OpenClaw AI Configuration'));
  config = await setupOpenClaw(config);

  // Step 3: API Keys (all optional — gTTS is the free default)
  console.log(chalk.bold('\n📡 API Keys (optional)'));
  config = await setupAPIKeys(config);

  // Step 4: 3CX SBC + SIP
  console.log(chalk.bold('\n☎️  3CX SBC Configuration'));
  config = await setupSBC(config);

  // Step 5: Device
  console.log(chalk.bold('\n📱 Device Configuration'));
  config = await setupDevice(config);

  // Step 6: Server (LAN IP, ports)
  console.log(chalk.bold('\n⚙️  Server Configuration'));
  config = await setupServer(config);

  return config;
}

/**
 * Raspberry Pi split-mode setup flow
 * @param {object} config - Current config
 * @returns {Promise<void>}
 */
async function setupPi(config) {
  console.log(chalk.bold.yellow('\n🥧 Raspberry Pi Split-Mode Setup\n'));
  console.log(chalk.gray('In this mode, the Pi runs voice-app (Docker) and your API server runs claude-api-server.\n'));

  // AC23: Handle existing standard config migration
  if (config.deployment && config.deployment.mode === 'standard') {
    console.log(chalk.yellow('\n⚠️  Detected existing standard configuration'));
    console.log(chalk.gray('Your config will be migrated to Pi split-mode while preserving:'));
    console.log(chalk.gray('  • API keys (ElevenLabs, OpenAI)'));
    console.log(chalk.gray('  • Device configurations'));
    console.log(chalk.gray('  • SIP settings\n'));

    const { confirmMigration } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmMigration',
        message: 'Continue with migration to Pi split-mode?',
        default: true
      }
    ]);

    if (!confirmMigration) {
      console.log(chalk.gray('\nSetup cancelled.\n'));
      process.exit(0);
    }

    console.log(chalk.green('✓ Preserving existing configuration\n'));
  }

  // Check prerequisites
  console.log(chalk.bold('\n✅ Prerequisites Check'));
  const prereqs = await checkPiPrerequisites();
  let allPrereqsPassed = true;

  for (const prereq of prereqs) {
    if (prereq.installed) {
      console.log(chalk.green(`  ✓ ${prereq.name}`));
    } else {
      console.log(chalk.red(`  ✗ ${prereq.name}: ${prereq.error}`));
      if (prereq.installUrl) {
        console.log(chalk.gray(`    → ${prereq.installUrl}`));
      }
      allPrereqsPassed = false;
    }
  }

  if (!allPrereqsPassed) {
    console.log(chalk.red('\n✗ Prerequisites missing. Install them before continuing.\n'));
    process.exit(1);
  }

  // Ensure secrets exist
  if (!config.secrets) {
    config.secrets = {
      drachtio: generateSecret(),
      freeswitch: generateSecret()
    };
  }

  // Initialize deployment config
  if (!config.deployment) {
    config.deployment = { mode: 'pi-split', pi: {} };
  } else {
    config.deployment.mode = 'pi-split';
    if (!config.deployment.pi) {
      config.deployment.pi = {};
    }
  }

  // Detect 3CX SBC (AC24: Handle port detection failure)
  console.log(chalk.bold('\n🔍 Network Detection'));
  const sbc3cxSpinner = ora('Checking for 3CX SBC (process + UDP/TCP port 5060)...').start();

  let has3cxSbc;
  let portCheckError = false;

  try {
    has3cxSbc = await detect3cxSbc();
    if (has3cxSbc) {
      sbc3cxSpinner.succeed('3CX SBC detected - will use port 5070 for drachtio');
    } else {
      sbc3cxSpinner.succeed('No 3CX SBC detected - will use standard port 5060');
    }
  } catch (err) {
    portCheckError = true;
    sbc3cxSpinner.warn('Port detection failed: ' + err.message);
  }

  // AC24: Manual override when port detection fails
  if (portCheckError) {
    console.log(chalk.yellow('\n⚠️  Could not automatically detect 3CX SBC'));
    const { manualSbc } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'manualSbc',
        message: 'Is 3CX SBC running on port 5060?',
        default: false
      }
    ]);
    has3cxSbc = manualSbc;

    if (has3cxSbc) {
      console.log(chalk.green('✓ Will use port 5070 for drachtio (avoid conflict with SBC)\n'));
    } else {
      console.log(chalk.green('✓ Will use port 5060 for drachtio\n'));
    }
  }

  config.deployment.pi.has3cxSbc = has3cxSbc;
  config.deployment.pi.drachtioPort = has3cxSbc ? 5070 : 5060;

  // Step 1: OpenClaw AI gateway
  console.log(chalk.bold('\n🤖 OpenClaw AI Configuration'));
  config = await setupOpenClaw(config);

  // Optionally verify connectivity
  if (config.deployment.openclawHost) {
    const openclawUrl = `http://${config.deployment.openclawHost}:${config.deployment.openclawPort || 18790}`;
    const reachSpinner = ora(`Checking OpenClaw at ${openclawUrl}...`).start();
    const apiHealth = await checkClaudeApiServer(openclawUrl);
    if (apiHealth.healthy) {
      reachSpinner.succeed(`OpenClaw is healthy at ${openclawUrl}`);
    } else {
      reachSpinner.warn(`OpenClaw not responding at ${openclawUrl} — continuing anyway`);
    }
  }

  // Step 2: 3CX SBC Configuration (Pi mode uses SBC)
  console.log(chalk.bold('\n📡 3CX SBC Connection'));
  config = await setupSBC(config);

  // Step 3: API Keys (optional — gTTS is free)
  console.log(chalk.bold('\n📡 API Configuration'));
  config = await setupAPIKeys(config);

  // Step 3: Device Configuration
  console.log(chalk.bold('\n🤖 Device Configuration'));
  config = await setupDevice(config);

  // Step 4: Server Configuration (Pi-specific)
  console.log(chalk.bold('\n⚙️  Server Configuration'));
  config = await setupPiServer(config);

  // Save configuration
  const spinner = ora('Saving configuration...').start();
  try {
    await saveConfig(config);
    spinner.succeed('Configuration saved');
  } catch (error) {
    spinner.fail(`Failed to save configuration: ${error.message}`);
    throw error;
  }

  // Summary
  console.log(chalk.bold.green('\n✓ Pi Setup complete!\n'));
  console.log(chalk.bold.yellow('📡 3CX SBC Reminder:\n'));
  console.log(chalk.gray('  Make sure your SBC is provisioned in 3CX Admin:'));
  console.log(chalk.gray('  Admin → Settings → SBC → Add SBC → Raspberry Pi'));
  console.log(chalk.gray('  Docs: https://www.3cx.com/docs/sbc/\n'));
  if (config.deployment?.openclawHost) {
    console.log(chalk.bold.cyan('📋 OpenClaw connection:\n'));
    console.log(chalk.gray(`  OpenClaw: http://${config.deployment.openclawHost}:${config.deployment.openclawPort || 18790}`));
    console.log(chalk.gray('  Make sure OpenClaw is running and reachable.\n'));
  }
  console.log(chalk.bold.cyan('📋 Next steps:\n'));
  console.log(chalk.gray('  1. Run "claude-phone start" to launch voice services'));
  console.log(chalk.gray('  2. Call extension ' + config.devices[0].extension + ' from your phone'));
  console.log(chalk.gray('  3. Start talking!\n'));

  return config;
}

/**
 * Generate a random secret for Docker services
 * @returns {string} Random 32-character hex string
 */
function generateSecret() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Create default configuration
 * @returns {object} Default config
 */
function createDefaultConfig() {
  return {
    version: '1.0.0',
    api: {
      elevenlabs: { apiKey: '', defaultVoiceId: '', validated: false },
      openai: { apiKey: '', validated: false }
    },
    sip: {
      domain: '',
      registrar: '',
      transport: 'udp'
    },
    server: {
      claudeApiPort: 3333,
      httpPort: 3000,
      externalIp: 'auto'
    },
    secrets: {
      drachtio: generateSecret(),
      freeswitch: generateSecret()
    },
    devices: [],
    paths: {
      voiceApp: path.join(getProjectRoot(), 'voice-app'),
      claudeApiServer: path.join(getProjectRoot(), 'claude-api-server')
    }
  };
}

/**
 * Setup API keys — all optional (gTTS + Google Web Speech work without any keys)
 * @param {object} config - Current config
 * @returns {Promise<object>} Updated config
 */
async function setupAPIKeys(config) {
  config.api = config.api || {};
  config.api.elevenlabs = config.api.elevenlabs || { apiKey: '', defaultVoiceId: '', validated: false };
  config.api.openai = config.api.openai || { apiKey: '', validated: false };

  console.log(chalk.gray('Default TTS/STT: gTTS (Google Translate) + Google Web Speech — free, no keys required.'));
  console.log(chalk.gray('ElevenLabs and OpenAI are optional premium fallbacks.\n'));

  // ElevenLabs (optional)
  const { wantElevenLabs } = await inquirer.prompt([{
    type: 'confirm',
    name: 'wantElevenLabs',
    message: 'Add ElevenLabs API key? (optional, premium TTS voices)',
    default: !!(config.api.elevenlabs?.apiKey)
  }]);

  if (wantElevenLabs) {
    const elevenLabsAnswers = await inquirer.prompt([{
      type: 'password',
      name: 'apiKey',
      message: 'ElevenLabs API key:',
      default: config.api.elevenlabs.apiKey,
      validate: (input) => input?.trim() ? true : 'API key is required'
    }]);

    const elevenLabsKey = elevenLabsAnswers.apiKey;
    const spinner = ora('Validating ElevenLabs API key...').start();
    const elevenLabsResult = await validateElevenLabsKey(elevenLabsKey);

    if (!elevenLabsResult.valid) {
      spinner.fail(`Invalid ElevenLabs API key: ${elevenLabsResult.error}`);
      const { continueAnyway } = await inquirer.prompt([{
        type: 'confirm', name: 'continueAnyway', message: 'Continue anyway?', default: false
      }]);
      if (!continueAnyway) throw new Error('Setup cancelled due to invalid API key');
      config.api.elevenlabs = { apiKey: elevenLabsKey, defaultVoiceId: '', validated: false };
    } else {
      spinner.succeed('ElevenLabs API key validated');
      config.api.elevenlabs = { apiKey: elevenLabsKey, defaultVoiceId: '', validated: true };
    }
  } else {
    config.api.elevenlabs = { apiKey: '', defaultVoiceId: '', validated: false };
  }

  // OpenAI (optional)
  const { wantOpenAI } = await inquirer.prompt([{
    type: 'confirm',
    name: 'wantOpenAI',
    message: 'Add OpenAI API key? (optional, Whisper STT fallback)',
    default: !!(config.api.openai?.apiKey)
  }]);

  if (wantOpenAI) {
    const openAIAnswers = await inquirer.prompt([{
      type: 'password',
      name: 'apiKey',
      message: 'OpenAI API key:',
      default: config.api.openai.apiKey,
      validate: (input) => input?.trim() ? true : 'API key is required'
    }]);

    const openAIKey = openAIAnswers.apiKey;
    const openAISpinner = ora('Validating OpenAI API key...').start();
    const openAIResult = await validateOpenAIKey(openAIKey);

    if (!openAIResult.valid) {
      openAISpinner.fail(`Invalid OpenAI API key: ${openAIResult.error}`);
      const { continueAnyway } = await inquirer.prompt([{
        type: 'confirm', name: 'continueAnyway', message: 'Continue anyway?', default: false
      }]);
      if (!continueAnyway) throw new Error('Setup cancelled due to invalid API key');
      config.api.openai = { apiKey: openAIKey, validated: false };
    } else {
      openAISpinner.succeed('OpenAI API key validated');
      config.api.openai = { apiKey: openAIKey, validated: true };
    }
  } else {
    config.api.openai = { apiKey: '', validated: false };
  }

  return config;
}

/**
 * Setup SIP configuration (standard mode)
 * @param {object} config - Current config
 * @returns {Promise<object>} Updated config
 */
async function setupSIP(config) {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'domain',
      message: '3CX domain (e.g., your-3cx.3cx.us):',
      default: config.sip.domain,
      validate: (input) => {
        if (!input || input.trim() === '') {
          return 'SIP domain is required';
        }
        if (!validateHostname(input)) {
          return 'Invalid hostname format';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'registrar',
      message: '3CX registrar IP (e.g., 192.168.1.100):',
      default: config.sip.registrar,
      validate: (input) => {
        if (!input || input.trim() === '') {
          return 'SIP registrar IP is required';
        }
        if (!validateIP(input)) {
          return 'Invalid IP address format';
        }
        return true;
      }
    }
  ]);

  config.sip.domain = answers.domain;
  config.sip.registrar = answers.registrar;

  return config;
}

/**
 * Setup SBC configuration (Pi mode only)
 * @param {object} config - Current config
 * @returns {Promise<object>} Updated config
 */
async function setupSBC(config) {
  // Display pre-requisite information
  console.log(chalk.cyan('\nℹ️  Pre-requisite: You must create an SBC in 3CX Admin first'));
  console.log(chalk.gray('   (Admin → Settings → SBC → Add SBC → Raspberry Pi)\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'fqdn',
      message: '3CX FQDN (e.g., mycompany.3cx.us):',
      default: config.sip.domain,
      validate: (input) => {
        if (!input || input.trim() === '') {
          return '3CX FQDN is required';
        }
        if (!validateHostname(input)) {
          return 'Invalid hostname format';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'sbcAuthKey',
      message: 'SBC Auth Key ID (from 3CX Admin → Settings → SBC):',
      default: config.sip.sbcAuthKey || '',
      validate: (input) => {
        if (!validateSbcAuthKey(input)) {
          return 'Auth Key is required and must contain only letters, numbers, and dashes';
        }
        return true;
      }
    }
  ]);

  // Domain is the 3CX FQDN (for From/To SIP headers)
  config.sip.domain = answers.fqdn;
  // Registrar is the LOCAL SBC (drachtio registers with local SBC, not cloud)
  config.sip.registrar = '127.0.0.1';
  // Store Auth Key for reference (SBC reads from /etc/3cxsbc.conf)
  config.sip.sbcAuthKey = answers.sbcAuthKey;

  return config;
}

/**
 * Setup device configuration
 * @param {object} config - Current config
 * @returns {Promise<object>} Updated config
 */
async function setupDevice(config) {
  const existingDevice = config.devices.length > 0 ? config.devices[0] : null;

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Device name (e.g., MyBot):',
      default: existingDevice?.name || VoiceBot,
      validate: (input) => input?.trim() ? true : 'Device name is required'
    },
    {
      type: 'input',
      name: 'extension',
      message: 'SIP extension number (e.g., 9000):',
      default: existingDevice?.extension || '9000',
      validate: (input) => validateExtension(input) ? true : 'Extension must be 4-5 digits'
    },
    {
      type: 'input',
      name: 'authId',
      message: 'SIP auth ID (from 3CX IP Phone tab — NOT the extension number):',
      default: existingDevice?.authId || '',
      validate: (input) => input?.trim() ? true : 'Auth ID is required'
    },
    {
      type: 'password',
      name: 'password',
      message: 'SIP password:',
      default: existingDevice?.password || '',
      validate: (input) => input?.trim() ? true : 'Password is required'
    },
    {
      type: 'input',
      name: 'language',
      message: 'Language code (BCP-47, e.g. en, he, ar, ru):',
      default: existingDevice?.language || 'en',
      validate: (input) => input?.trim() ? true : 'Language is required'
    },
    {
      type: 'input',
      name: 'greeting',
      message: 'Greeting (spoken when call connects):',
      default: existingDevice?.greeting || 'Hello! How can I help you today?'
    },
    {
      type: 'input',
      name: 'thinkingPhrase',
      message: 'Thinking phrase (spoken while waiting for AI response):',
      default: existingDevice?.thinkingPhrase || 'Let me think...'
    },
    {
      type: 'input',
      name: 'prompt',
      message: 'System prompt (sent to OpenClaw with every message):',
      default: existingDevice?.prompt || 'You are a helpful AI assistant. Keep voice responses under 40 words.',
      validate: (input) => input?.trim() ? true : 'System prompt is required'
    }
  ]);

  // ElevenLabs voice ID — only ask if API key is configured
  let voiceId = existingDevice?.voiceId || '';
  if (config.api?.elevenlabs?.apiKey) {
    const voiceAnswers = await inquirer.prompt([{
      type: 'input',
      name: 'voiceId',
      message: 'ElevenLabs voice ID:',
      default: existingDevice?.voiceId || config.api.elevenlabs.defaultVoiceId || '',
      validate: (input) => input?.trim() ? true : 'Voice ID is required'
    }]);
    voiceId = voiceAnswers.voiceId;

    const voiceSpinner = ora('Validating ElevenLabs voice ID...').start();
    const voiceValidation = await validateVoiceId(config.api.elevenlabs.apiKey, voiceId);
    if (!voiceValidation.valid) {
      voiceSpinner.fail(`Voice ID validation failed: ${voiceValidation.error}`);
      const { continueAnyway } = await inquirer.prompt([{
        type: 'confirm', name: 'continueAnyway', message: 'Continue anyway?', default: false
      }]);
      if (!continueAnyway) {
        console.log(chalk.gray('\nReturning to device setup...'));
        return setupDevice(config);
      }
    } else {
      voiceSpinner.succeed(`Voice ID validated: ${voiceValidation.name}`);
    }
  }

  const device = {
    name: answers.name,
    extension: answers.extension,
    authId: answers.authId,
    password: answers.password,
    voiceId,
    language: answers.language,
    greeting: answers.greeting,
    thinkingPhrase: answers.thinkingPhrase,
    prompt: answers.prompt
  };

  if (config.devices.length > 0) {
    config.devices[0] = device;
  } else {
    config.devices.push(device);
  }

  return config;
}

/**
 * Setup server configuration (standard mode)
 * @param {object} config - Current config
 * @returns {Promise<object>} Updated config
 */
async function setupServer(config) {
  const localIp = getLocalIP();

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'externalIp',
      message: 'Server LAN IP (for RTP audio):',
      default: config.server.externalIp === 'auto' ? localIp : config.server.externalIp,
      validate: (input) => {
        if (!input || input.trim() === '') {
          return 'IP address is required';
        }
        if (!validateIP(input)) {
          return 'Invalid IP address format';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'claudeApiPort',
      message: 'Claude API server port:',
      default: config.server.claudeApiPort,
      validate: (input) => {
        const port = parseInt(input, 10);
        if (isNaN(port) || port < 1024 || port > 65535) {
          return 'Port must be between 1024 and 65535';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'httpPort',
      message: 'Voice app HTTP port:',
      default: config.server.httpPort,
      validate: (input) => {
        const port = parseInt(input, 10);
        if (isNaN(port) || port < 1024 || port > 65535) {
          return 'Port must be between 1024 and 65535';
        }
        return true;
      }
    }
  ]);

  config.server.externalIp = answers.externalIp;
  config.server.claudeApiPort = parseInt(answers.claudeApiPort, 10);
  config.server.httpPort = parseInt(answers.httpPort, 10);

  return config;
}

/**
 * Setup Pi-specific server configuration
 * @param {object} config - Current config
 * @returns {Promise<object>} Updated config
 */
async function setupPiServer(config) {
  const localIp = getLocalIP();

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'externalIp',
      message: 'Pi LAN IP (for RTP audio):',
      default: config.server.externalIp === 'auto' ? localIp : config.server.externalIp,
      validate: (input) => {
        if (!input || input.trim() === '') {
          return 'IP address is required';
        }
        if (!validateIP(input)) {
          return 'Invalid IP address format';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'httpPort',
      message: 'Voice app HTTP port:',
      default: config.server.httpPort || 3000,
      validate: (input) => {
        const port = parseInt(input, 10);
        if (isNaN(port) || port < 1024 || port > 65535) {
          return 'Port must be between 1024 and 65535';
        }
        return true;
      }
    }
  ]);

  config.server.externalIp = answers.externalIp;
  config.server.httpPort = parseInt(answers.httpPort, 10);

  return config;
}

/**
 * Setup OpenClaw AI gateway configuration
 * @param {object} config - Current config
 * @returns {Promise<object>} Updated config
 */
async function setupOpenClaw(config) {
  console.log(chalk.gray('OpenClaw is the AI gateway that processes voice conversations.'));
  console.log(chalk.gray('It runs on a separate server and is called by the local claude-api-server bridge.\n'));

  config.deployment = config.deployment || {};

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'host',
      message: 'OpenClaw server IP or hostname:',
      default: config.deployment.openclawHost || '',
      validate: (input) => {
        if (!input?.trim()) return 'OpenClaw host is required';
        if (!validateIP(input) && !validateHostname(input)) return 'Invalid IP address or hostname';
        return true;
      }
    },
    {
      type: 'input',
      name: 'port',
      message: 'OpenClaw conversation port:',
      default: String(config.deployment.openclawPort || 18790),
      validate: (input) => {
        const port = parseInt(input, 10);
        return (!isNaN(port) && port > 0 && port < 65536) ? true : 'Port must be between 1 and 65535';
      }
    }
  ]);

  config.deployment.openclawHost = answers.host;
  config.deployment.openclawPort = parseInt(answers.port, 10);

  return config;
}

/**
 * Setup deployment architecture (ARM64/QEMU/x86/split)
 * @param {object} config - Current config
 * @returns {Promise<object>} Updated config
 */
async function setupArch(config) {
  const arch = os.arch();
  const isArm64 = arch === 'arm64';

  if (isArm64) {
    console.log(chalk.yellow(`ARM64 architecture detected (${arch}).`));
    console.log(chalk.gray('FreeSWITCH and 3CX SBC only have x86_64 pre-built images.'));
    console.log(chalk.gray('QEMU emulation is available and works well for voice bot workloads.\n'));
  }

  const choices = [];
  if (isArm64) {
    choices.push({
      name: 'All on this ARM64 host — QEMU emulation for FreeSWITCH + SBC (recommended)',
      value: 'arm64-qemu'
    });
  }
  choices.push(
    { name: 'All on this x86_64 host', value: 'x86' },
    { name: 'FreeSWITCH + SBC on a separate x86_64 host (split topology)', value: 'split' }
  );

  const { topology } = await inquirer.prompt([{
    type: 'list',
    name: 'topology',
    message: 'Deployment topology:',
    choices,
    default: isArm64 ? 'arm64-qemu' : (config.deployment?.topology || 'x86')
  }]);

  config.deployment = config.deployment || {};
  config.deployment.topology = topology;
  config.deployment.useQemu = topology === 'arm64-qemu';

  if (topology === 'split') {
    console.log(chalk.cyan('\nEnter the address of the x86_64 host running FreeSWITCH:'));
    const splitAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'freeswitchHost',
        message: 'Remote FreeSWITCH host IP:',
        default: config.deployment.freeswitchHost || '',
        validate: (input) => validateIP(input) ? true : 'Invalid IP address'
      },
      {
        type: 'input',
        name: 'freeswitchPort',
        message: 'FreeSWITCH ESL port:',
        default: String(config.deployment.freeswitchPort || 8021),
        validate: (input) => {
          const p = parseInt(input, 10);
          return (!isNaN(p) && p > 0 && p < 65536) ? true : 'Invalid port';
        }
      }
    ]);
    config.deployment.freeswitchHost = splitAnswers.freeswitchHost;
    config.deployment.freeswitchPort = parseInt(splitAnswers.freeswitchPort, 10);
  }

  if (topology === 'arm64-qemu') {
    console.log(chalk.cyan('\n→ QEMU binfmt will be installed automatically when starting services.'));
    console.log(chalk.gray('  (docker run --privileged --rm tonistiigi/binfmt --install amd64)\n'));
  }

  return config;
}
