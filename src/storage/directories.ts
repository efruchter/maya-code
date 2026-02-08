import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Sanitize channel name to create a valid directory name
 */
export function sanitizeChannelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'default';
}

/**
 * Get or create the project directory for a channel
 */
export async function getProjectDirectory(channelName: string): Promise<string> {
  const sanitized = sanitizeChannelName(channelName);
  const projectPath = path.join(config.baseDirectory, sanitized);

  try {
    await fs.access(projectPath);
  } catch {
    logger.info(`Creating project directory: ${projectPath}`);
    await fs.mkdir(projectPath, { recursive: true });
  }

  return projectPath;
}

/**
 * Ensure the base projects directory exists
 */
export async function ensureBaseDirectory(): Promise<void> {
  try {
    await fs.access(config.baseDirectory);
  } catch {
    logger.info(`Creating base directory: ${config.baseDirectory}`);
    await fs.mkdir(config.baseDirectory, { recursive: true });
  }
}
