import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import { loadConfig, configExists, getInstallationType } from '../config.js';
import { checkDocker, writeDockerConfig, startContainers, generateDevicesJson } from '../docker.js';
import { startServer, isServerRunning } from '../process-manager.js';
import { isClaudeInstalled, sleep } from '../utils.js';
import { checkClaudeApiServer } from '../network.js';
import { runPrereqChecks } from '../prereqs.js';

/**
 * Start command - Launch all services
 * @returns {Promise<void>}
 */
export async function startCommand() {
  console.log(chalk.bold.cyan('\n🚀 Starting Claude Phone\n'));

  // Check if configured
  if (!configExists()) {
    console.log(chalk.red('✗ Configuration not found'));
    console.log(chalk.gray('  Run "claude-phone setup" first\n'));
    process.exit(1);
  }

  // Load config and get installation type
  const config = await loadConfig();
  const installationType = getInstallationType(config);
  const isPiMode = config.deployment?.mode === 'pi-split';

  console.log(chalk.gray(`Installation type: ${installationType}\n`));

  // Run prerequisite checks for this installation type
  const prereqResult = await runPrereqChecks({ type: installationType });
  if (!prereqResult.success) {
    console.log(chalk.red('\n❌ Prerequisites not met. Please run "claude-phone setup" to fix.\n'));
    process.exit(1);
  }

  if (isPiMode) {
    console.log(chalk.cyan('🥧 Pi Split-Mode detected\n'));
  }

  // Route to type-specific start function
  switch (installationType) {
    case 'api-server':
      await startApiServer(config);
      break;
    case 'voice-server':
      await startVoiceServer(config, isPiMode);
      break;
    case 'both':
    default:
      await startBoth(config, isPiMode);
      break;
  }
}

/**
 * Start API server only
 * @param {object} config - Configuration
 * @returns {Promise<void>}
 */
async function startApiServer(config) {
  // Check Claude CLI
  if (!(await isClaudeInstalled())) {
    console.log(chalk.yellow('⚠️  Claude CLI not found'));
    console.log(chalk.gray('  Install from: https://claude.com/download\n'));
  }

  // Verify path exists
  if (!fs.existsSync(config.paths.claudeApiServer)) {
    console.log(chalk.red(`✗ Claude API server not found at: ${config.paths.claudeApiServer}`));
    console.log(chalk.gray('  Update paths in configuration\n'));
    process.exit(1);
  }

  // Check if dependencies are installed
  const nodeModulesPath = path.join(config.paths.claudeApiServer, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    console.log(chalk.red('✗ Dependencies not installed in claude-api-server'));
    console.log(chalk.yellow('\nRun the following to install dependencies:'));
    console.log(chalk.cyan(`  cd ${config.paths.claudeApiServer} && npm install\n`));
    process.exit(1);
  }

  // Start claude-api-server
  const spinner = ora('Starting Claude API server...').start();
  try {
    if (await isServerRunning()) {
      spinner.warn('Claude API server already running');
    } else {
      await startServer(config.paths.claudeApiServer, config.server.claudeApiPort);
      spinner.succeed(`Claude API server started on port ${config.server.claudeApiPort}`);
    }
  } catch (error) {
    spinner.fail(`Failed to start server: ${error.message}`);
    throw error;
  }

  // Success
  console.log(chalk.bold.green('\n✓ API server running!\n'));
  console.log(chalk.gray('Service:'));
  console.log(chalk.gray(`  • Claude API server: http://localhost:${config.server.claudeApiPort}\n`));
  console.log(chalk.gray('Voice servers can connect to this API server.\n'));
}

/**
 * Start voice server only
 * @param {object} config - Configuration
 * @param {boolean} isPiMode - Is Pi split-mode
 * @returns {Promise<void>}
 */
async function startVoiceServer(config, isPiMode) {
  // Verify voice-app path exists
  if (!fs.existsSync(config.paths.voiceApp)) {
    console.log(chalk.red(`✗ Voice app not found at: ${config.paths.voiceApp}`));
    console.log(chalk.gray('  Update paths in configuration\n'));
    process.exit(1);
  }

  // Check OpenClaw reachability if configured
  const openclawHost = config.deployment?.openclawHost;
  if (openclawHost) {
    const openclawUrl = `http://${openclawHost}:${config.deployment.openclawPort || 18790}`;
    const apiSpinner = ora(`Checking OpenClaw at ${openclawUrl}...`).start();
    const apiHealth = await checkClaudeApiServer(openclawUrl);
    if (apiHealth.healthy) {
      apiSpinner.succeed(`OpenClaw is healthy at ${openclawUrl}`);
    } else {
      apiSpinner.warn(`OpenClaw not responding at ${openclawUrl} — continuing anyway`);
    }
  }

  // Check Docker
  const spinner = ora('Checking Docker...').start();
  const dockerStatus = await checkDocker();

  if (!dockerStatus.installed || !dockerStatus.running) {
    spinner.fail(dockerStatus.error);
    process.exit(1);
  }
  spinner.succeed('Docker is ready');

  // Generate Docker config (.env + devices.json)
  spinner.start('Writing .env and devices.json...');
  try {
    await writeDockerConfig(config);
    spinner.succeed('Configuration written');
  } catch (error) {
    spinner.fail(`Failed to write config: ${error.message}`);
    throw error;
  }

  // Start Docker containers (with ARM64 overlay if configured)
  const startOptions = {
    useQemu: config.deployment?.useQemu || false
  };
  spinner.start('Starting Docker containers...');
  try {
    await startContainers(startOptions);
    spinner.succeed('Docker containers started');
  } catch (error) {
    spinner.fail(`Failed to start containers: ${error.message}`);

    if (error.message.includes('port') || error.message.includes('address already in use')) {
      console.log(chalk.yellow('\n⚠️  Port conflict detected\n'));
      console.log(chalk.gray('Possible causes:'));
      console.log(chalk.gray('  • 3CX SBC is running on the configured port'));
      console.log(chalk.gray('  • Another service is using the port'));
      console.log(chalk.gray('\nSuggested fixes:'));
      console.log(chalk.gray('  1. If 3CX SBC is on port 5060, run "claude-phone setup" again'));
      console.log(chalk.gray('  2. Check running containers: docker ps'));
      console.log(chalk.gray('  3. Stop conflicting services: docker compose down\n'));
    }

    throw error;
  }

  // Wait a bit for containers to initialize
  spinner.start('Waiting for containers to initialize...');
  await sleep(3000);
  spinner.succeed('Containers initialized');

  // Success
  console.log(chalk.bold.green('\n✓ Voice server running!\n'));
  console.log(chalk.gray('Services:'));
  console.log(chalk.gray(`  • Docker containers: drachtio, freeswitch, voice-app`));
  if (openclawHost) {
    console.log(chalk.gray(`  • OpenClaw: http://${openclawHost}:${config.deployment.openclawPort || 18790}`));
  }
  console.log(chalk.gray(`  • Voice app API: http://localhost:${config.server.httpPort}\n`));
  console.log(chalk.gray('Ready to receive calls on:'));
  for (const device of config.devices) {
    console.log(chalk.gray(`  • ${device.name}: extension ${device.extension}`));
  }
  console.log();
}

/**
 * Start both API server and voice server
 * @param {object} config - Configuration
 * @param {boolean} isPiMode - Is Pi split-mode
 * @returns {Promise<void>}
 */
async function startBoth(config, isPiMode) {
  // Verify voice-app path exists
  if (!fs.existsSync(config.paths.voiceApp)) {
    console.log(chalk.red(`✗ Voice app not found at: ${config.paths.voiceApp}`));
    console.log(chalk.gray('  Update paths in configuration\n'));
    process.exit(1);
  }

  // Check OpenClaw reachability if configured
  const openclawHost = config.deployment?.openclawHost;
  if (openclawHost) {
    const openclawUrl = `http://${openclawHost}:${config.deployment.openclawPort || 18790}`;
    const apiSpinner = ora(`Checking OpenClaw at ${openclawUrl}...`).start();
    const apiHealth = await checkClaudeApiServer(openclawUrl);
    if (apiHealth.healthy) {
      apiSpinner.succeed(`OpenClaw is healthy at ${openclawUrl}`);
    } else {
      apiSpinner.warn(`OpenClaw not responding at ${openclawUrl} — continuing anyway`);
    }
  }

  // Check Docker
  const spinner = ora('Checking Docker...').start();
  const dockerStatus = await checkDocker();

  if (!dockerStatus.installed || !dockerStatus.running) {
    spinner.fail(dockerStatus.error);
    process.exit(1);
  }
  spinner.succeed('Docker is ready');

  // Write .env and devices.json to project root
  spinner.start('Writing .env and devices.json...');
  try {
    await writeDockerConfig(config);
    spinner.succeed('Configuration written');
  } catch (error) {
    spinner.fail(`Failed to write config: ${error.message}`);
    throw error;
  }

  // Start Docker containers with --profile full (includes SBC + claude-api-server)
  const startOptions = {
    useQemu: config.deployment?.useQemu || false,
    profile: 'full'
  };
  spinner.start('Starting Docker containers (full stack)...');
  try {
    await startContainers(startOptions);
    spinner.succeed('Docker containers started');
  } catch (error) {
    spinner.fail(`Failed to start containers: ${error.message}`);

    if (error.message.includes('port') || error.message.includes('address already in use')) {
      console.log(chalk.yellow('\n⚠️  Port conflict detected\n'));
      console.log(chalk.gray('Possible causes:'));
      console.log(chalk.gray('  • 3CX SBC is running on the configured port'));
      console.log(chalk.gray('  • Another service is using the port'));
      console.log(chalk.gray('\nSuggested fixes:'));
      console.log(chalk.gray('  1. Check running containers: docker ps'));
      console.log(chalk.gray('  2. Stop conflicting services: docker compose down\n'));
    }

    throw error;
  }

  // Wait for containers to initialize
  spinner.start('Waiting for containers to initialize...');
  await sleep(3000);
  spinner.succeed('Containers initialized');

  // Success
  console.log(chalk.bold.green('\n✓ All services running!\n'));
  console.log(chalk.gray('Services:'));
  console.log(chalk.gray(`  • drachtio, freeswitch, voice-app, 3cx-sbc, claude-api-server`));
  if (openclawHost) {
    console.log(chalk.gray(`  • OpenClaw: http://${openclawHost}:${config.deployment.openclawPort || 18790}`));
  }
  console.log(chalk.gray(`  • Voice app API: http://localhost:${config.server.httpPort}\n`));
  console.log(chalk.gray('Ready to receive calls on:'));
  for (const device of config.devices) {
    console.log(chalk.gray(`  • ${device.name}: extension ${device.extension}`));
  }
  console.log();
}
