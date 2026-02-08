import { Client, TextChannel, AttachmentBuilder } from 'discord.js';
import { runClaude, isProcessRunning } from '../claude/manager.js';
import { getSession } from '../storage/sessions.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import fs from 'fs/promises';
import path from 'path';

interface HeartbeatTimer {
  timer: ReturnType<typeof setTimeout>;
  channelId: string;
  channelName: string;
  intervalMs: number;
}

// Track active heartbeat timers by channel ID (project-level, no thread)
const activeTimers = new Map<string, HeartbeatTimer>();

/**
 * Schedule the next heartbeat tick for a channel.
 * Uses setTimeout so each tick resets from the last activity.
 */
function scheduleTick(channelId: string, channelName: string, intervalMs: number, client: Client): void {
  const existing = activeTimers.get(channelId);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(() => {
    tick(channelId, channelName, intervalMs, client);
  }, intervalMs);

  // Don't let the timer keep the process alive
  timer.unref();

  activeTimers.set(channelId, { timer, channelId, channelName, intervalMs });
}

/**
 * Execute a heartbeat tick
 */
async function tick(channelId: string, channelName: string, intervalMs: number, client: Client): Promise<void> {
  try {
    // Check if heartbeat is still enabled in session
    const session = await getSession(channelId, null);
    if (!session?.heartbeat?.enabled) {
      logger.info('Heartbeat no longer enabled, stopping', { channelId });
      activeTimers.delete(channelId);
      return;
    }

    // Skip if a process is already running
    if (isProcessRunning(channelId, null)) {
      logger.info('Heartbeat skipped — process already running', { channelId });
      scheduleTick(channelId, channelName, intervalMs, client);
      return;
    }

    const userPrompt = session.heartbeat.prompt;
    if (!userPrompt) {
      logger.debug('Heartbeat skipped — no prompt configured', { channelId });
      scheduleTick(channelId, channelName, intervalMs, client);
      return;
    }

    // Wrap with [NO WORK] instruction so Claude can signal nothing to do
    const prompt = `${userPrompt}\n\nIMPORTANT: If there is no work to do, respond with exactly "[NO WORK]" and nothing else.`;

    // Get the Discord channel
    const channel = await client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) {
      logger.warn('Heartbeat channel not found or not a text channel', { channelId });
      scheduleTick(channelId, channelName, intervalMs, client);
      return;
    }

    logger.info('Heartbeat tick — running prompt', { channelId, channelName });

    await channel.sendTyping();
    const typingInterval = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, 8000);

    try {
      const result = await runClaude({
        channelId,
        channelName,
        threadId: null,
        prompt,
      });

      clearInterval(typingInterval);

      const noWork = result.text.trim() === '[NO WORK]';

      if (noWork) {
        logger.info('Heartbeat completed — no work to do', { channelId });
      } else if (result.text) {
        const chunks = splitMessage(result.text);
        const attachments = await createAttachments(result.imageFiles);

        for (let i = 0; i < chunks.length; i++) {
          const isLast = i === chunks.length - 1;
          await channel.send({
            content: chunks[i],
            files: isLast && attachments.length > 0 ? attachments : undefined,
          });
        }

        const nonImageFiles = result.createdFiles.filter(f => !result.imageFiles.includes(f));
        if (nonImageFiles.length > 0) {
          const fileList = nonImageFiles.map(f => `\`${path.basename(f)}\``).join(', ');
          await channel.send(`**Files created:** ${fileList}`);
        }

        logger.info('Heartbeat completed', {
          channelId,
          durationMs: result.durationMs,
          costUsd: result.costUsd,
          filesCreated: result.createdFiles.length,
          imagesAttached: result.imageFiles.length,
        });
      }
    } catch (error) {
      clearInterval(typingInterval);
      logger.error('Heartbeat Claude run failed', { channelId, error });
      try {
        await channel.send(`**Heartbeat error:** ${error instanceof Error ? error.message : 'Unknown error'}`);
      } catch {
        // Can't send to channel
      }
    }
  } catch (error) {
    logger.error('Heartbeat tick error', { channelId, error });
  }

  // Schedule next tick
  scheduleTick(channelId, channelName, intervalMs, client);
}

/**
 * Split text for Discord's 2000 char limit
 */
function splitMessage(text: string): string[] {
  const MAX = config.discord.maxMessageLength;
  if (text.length <= MAX) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX) {
      chunks.push(remaining);
      break;
    }

    let splitPoint = MAX;
    const newline = remaining.lastIndexOf('\n', MAX);
    if (newline > MAX / 2) {
      splitPoint = newline + 1;
    } else {
      const space = remaining.lastIndexOf(' ', MAX);
      if (space > MAX / 2) splitPoint = space + 1;
    }

    chunks.push(remaining.slice(0, splitPoint));
    remaining = remaining.slice(splitPoint);
  }

  return chunks;
}

/**
 * Create Discord attachments for image files that exist
 */
async function createAttachments(filePaths: string[]): Promise<AttachmentBuilder[]> {
  const attachments: AttachmentBuilder[] = [];
  for (const filePath of filePaths) {
    try {
      await fs.access(filePath);
      attachments.push(new AttachmentBuilder(filePath, { name: path.basename(filePath) }));
    } catch {
      logger.debug(`File not found for attachment: ${filePath}`);
    }
  }
  return attachments;
}

/**
 * Start a heartbeat for a channel
 */
export function startHeartbeat(channelId: string, channelName: string, intervalMs: number, client: Client): void {
  stop(channelId);
  scheduleTick(channelId, channelName, intervalMs, client);
  logger.info('Heartbeat started', { channelId, channelName, intervalMs });
}

/**
 * Reset the heartbeat timer (called when a message is sent).
 * This restarts the countdown from now.
 */
export function resetHeartbeat(channelId: string, client: Client): void {
  const existing = activeTimers.get(channelId);
  if (existing) {
    scheduleTick(channelId, existing.channelName, existing.intervalMs, client);
  }
}

/**
 * Stop a heartbeat for a channel
 */
export function stop(channelId: string): void {
  const existing = activeTimers.get(channelId);
  if (existing) {
    clearTimeout(existing.timer);
    activeTimers.delete(channelId);
    logger.info('Heartbeat stopped', { channelId });
  }
}

/**
 * Stop all heartbeats
 */
export function stopAll(): void {
  for (const [channelId, entry] of activeTimers) {
    clearTimeout(entry.timer);
  }
  activeTimers.clear();
  logger.info('All heartbeats stopped');
}

/**
 * Check if a heartbeat is active for a channel
 */
export function isActive(channelId: string): boolean {
  return activeTimers.has(channelId);
}

/**
 * Restore heartbeats from saved session state (call on bot startup)
 */
export async function restoreHeartbeats(client: Client): Promise<void> {
  const { getAllSessions } = await import('../storage/sessions.js');
  const sessions = await getAllSessions();

  for (const session of sessions) {
    if (session.heartbeat?.enabled && session.heartbeat.intervalMs > 0 && !session.threadId) {
      startHeartbeat(session.channelId, session.channelName, session.heartbeat.intervalMs, client);
    }
  }
}
