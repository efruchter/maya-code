import { Client, Events, ThreadChannel } from 'discord.js';
import { clearSession } from '../../storage/sessions.js';
import { killProcess } from '../../backends/manager.js';
import { logger } from '../../utils/logger.js';

export function setupThreadDeleteEvent(client: Client): void {
  client.on(Events.ThreadDelete, async (thread: ThreadChannel) => {
    const threadId = thread.id;
    const channelId = thread.parentId;

    if (!channelId) return;

    logger.info('Thread deleted, cleaning up session', { channelId, threadId });

    // Kill any running process for this thread
    killProcess(channelId, threadId);

    // Clear the session
    const cleared = await clearSession(channelId, threadId);
    if (cleared) {
      logger.info('Session cleared for deleted thread', { channelId, threadId });
    }
  });
}
