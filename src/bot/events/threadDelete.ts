import { Client, Events, ThreadChannel, DMChannel, NonThreadGuildBasedChannel } from 'discord.js';
import { clearSession } from '../../storage/sessions.js';
import { killProcess } from '../../backends/manager.js';
import { stop as stopHeartbeat } from '../../heartbeat/scheduler.js';
import { logger } from '../../utils/logger.js';

export function setupThreadDeleteEvent(client: Client): void {
  client.on(Events.ThreadDelete, async (thread: ThreadChannel) => {
    const threadId = thread.id;
    const channelId = thread.parentId;

    if (!channelId) return;

    logger.info('Thread deleted, cleaning up session', { channelId, threadId });

    killProcess(channelId, threadId);

    const cleared = await clearSession(channelId, threadId);
    if (cleared) {
      logger.info('Session cleared for deleted thread', { channelId, threadId });
    }
  });

  client.on(Events.ChannelDelete, async (channel: DMChannel | NonThreadGuildBasedChannel) => {
    const channelId = channel.id;

    logger.info('Channel deleted, cleaning up session and heartbeat', { channelId });

    stopHeartbeat(channelId);
    killProcess(channelId, null);

    const cleared = await clearSession(channelId, null);
    if (cleared) {
      logger.info('Session cleared for deleted channel', { channelId });
    }
  });
}
