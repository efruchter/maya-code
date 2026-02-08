import { startBot } from './bot/client.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  try {
    logger.info('Starting Maya Code bot...');
    await startBot();
  } catch (error) {
    logger.error('Failed to start bot', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down...');
  process.exit(0);
});

main();
