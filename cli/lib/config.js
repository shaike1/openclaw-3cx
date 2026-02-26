import fs from 'fs';
import path from 'path';
import os from 'os';
import { getProjectRoot } from './utils.js';

/**
 * Get the config directory path
 * @returns {string} Path to ~/.claude-phone
 */
export function getConfigDir() {
  return path.join(os.homedir(), '.claude-phone');
}

/**
 * Get the config file path
 * @returns {string} Path to ~/.claude-phone/config.json
 */
export function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Check if config file exists
 * @returns {boolean} True if config exists
 */
export function configExists() {
  return fs.existsSync(getConfigPath());
}

/**
 * Load configuration from disk
 * @returns {Promise<object>} Configuration object
 */
export async function loadConfig() {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    throw new Error('Configuration not found. Run "claude-phone setup" first.');
  }

  const data = await fs.promises.readFile(configPath, 'utf8');
  const config = JSON.parse(data);

  // Ensure installationType exists for backward compatibility
  if (!config.installationType) {
    config.installationType = 'both';
  }

  return config;
}

/**
 * Get the installation type from config
 * @param {object} config - Configuration object
 * @returns {string} Installation type ('voice-server' | 'api-server' | 'both')
 */
export function getInstallationType(config) {
  return config.installationType || 'both';
}

/**
 * Save configuration to disk
 * @param {object} config - Configuration object
 * @returns {Promise<void>}
 */
export async function saveConfig(config) {
  const configDir = getConfigDir();
  const configPath = getConfigPath();

  // Create directory if it doesn't exist
  if (!fs.existsSync(configDir)) {
    await fs.promises.mkdir(configDir, { recursive: true, mode: 0o700 });
  }

  // Backup existing config if it exists
  if (fs.existsSync(configPath)) {
    const backupPath = configPath + '.backup';
    await fs.promises.copyFile(configPath, backupPath);
  }

  // Add security warning to config
  const configWithWarning = {
    _WARNING: 'DO NOT SHARE THIS FILE - Contains API keys and passwords',
    ...config
  };

  // Write config file
  const data = JSON.stringify(configWithWarning, null, 2);
  await fs.promises.writeFile(configPath, data, { mode: 0o600 });
}

/**
 * Get the PID file path
 * @returns {string} Path to server.pid
 */
export function getPidPath() {
  return path.join(getConfigDir(), 'server.pid');
}

/**
 * Get the docker-compose.yml path
 * @returns {string} Path to generated docker-compose.yml
 */
export function getDockerComposePath() {
  return path.join(getConfigDir(), 'docker-compose.yml');
}

/**
 * Get the .env file path (in CLI config dir, for legacy use)
 * @returns {string} Path to generated .env
 */
export function getEnvPath() {
  return path.join(getConfigDir(), '.env');
}

/**
 * Get the project's .env file path (where Docker actually reads from)
 * @returns {string} Path to <project-root>/.env
 */
export function getProjectEnvPath() {
  return path.join(getProjectRoot(), '.env');
}

/**
 * Get the devices.json path (where voice-app reads from)
 * @returns {string} Path to voice-app/config/devices.json
 */
export function getDevicesJsonPath() {
  return path.join(getProjectRoot(), 'voice-app', 'config', 'devices.json');
}

/**
 * Get the ARM64 compose overlay path
 * @returns {string} Path to docker-compose.arm64.yml
 */
export function getArm64OverlayPath() {
  return path.join(getProjectRoot(), 'docker-compose.arm64.yml');
}

/**
 * Get the project's main docker-compose.yml path
 * @returns {string} Path to <project-root>/docker-compose.yml
 */
export function getProjectComposePath() {
  return path.join(getProjectRoot(), 'docker-compose.yml');
}
