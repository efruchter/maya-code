import { Client, Events } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { ensureBaseDirectory } from '../../storage/directories.js';

export function setupReadyEvent(client: Client): void {
  client.once(Events.ClientReady, async (readyClient) => {
    logger.info(`Bot is ready! Logged in as ${readyClient.user.tag}`);

    // Ensure base directory exists
    await ensureBaseDirectory();

    logger.info('Maya Code bot is fully initialized');
  });
}
