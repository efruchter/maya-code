import { Client, TextChannel, AttachmentBuilder } from 'discord.js';
import { runClaude } from '../backends/manager.js';
import { ScheduledCallback } from '../backends/types.js';
import { getSession } from '../storage/sessions.js';
import { getProjectDirectory } from '../storage/directories.js';
import { logger } from '../utils/logger.js';
import { autoCommit, getCompactDiff } from '../utils/git.js';
import { config } from '../config.js';
import fs from 'fs/promises';
import path from 'path';

const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /overloaded/i,
  /too many requests/i,
  /429/,
  /capacity/i,
  /quota/i,
  /hit your limit/i,
];

function isRateLimitError(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some(p => p.test(text));
}

/**
 * Parse reset time from Anthropic usage limit error.
 * Format: "You've hit your limit · resets 1pm (America/Los_Angeles)"
 * Returns ms until reset + 2 minutes, or null if unparseable.
 */
function parseResetTime(text: string): number | null {
  const match = text.match(/resets\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*\(([^)]+)\)/i);
  if (!match) return null;

  const timeStr = match[1];
  const timezone = match[2];

  try {
    // Build a date string for today with the given time
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const [month, day, year] = todayStr.split('/');

    // Parse the time
    const timeMatch = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (!timeMatch) return null;

    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const ampm = timeMatch[3].toLowerCase();

    if (ampm === 'pm' && hours !== 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    // Create date in the target timezone by formatting and parsing
    const resetDate = new Date(`${year}-${month}-${day}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);

    // Adjust for timezone offset — get the offset by comparing
    const nowInTz = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const offsetMs = now.getTime() - nowInTz.getTime();
    const resetUtc = new Date(resetDate.getTime() + offsetMs);

    // If reset time is in the past, it's tomorrow
    let delayMs = resetUtc.getTime() - now.getTime();
    if (delayMs < 0) {
      delayMs += 24 * 60 * 60 * 1000;
    }

    // Add 2 minutes buffer
    return delayMs + 2 * 60 * 1000;
  } catch {
    return null;
  }
}

// Track last known usage limit for /usage command
let lastUsageLimitMessage: string | null = null;
let lastUsageLimitTime: number | null = null;

export function getLastUsageLimit(): { message: string; timestamp: number } | null {
  if (lastUsageLimitMessage && lastUsageLimitTime) {
    return { message: lastUsageLimitMessage, timestamp: lastUsageLimitTime };
  }
  return null;
}

export function setLastUsageLimit(message: string): void {
  lastUsageLimitMessage = message;
  lastUsageLimitTime = Date.now();
}

interface HeartbeatTimer {
  timer: ReturnType<typeof setTimeout>;
  channelId: string;
  channelName: string;
  intervalMs: number;
  scheduledAt: number;
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

  activeTimers.set(channelId, { timer, channelId, channelName, intervalMs, scheduledAt: Date.now() });
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

    const userPrompt = session.heartbeat.prompt;
    if (!userPrompt) {
      logger.debug('Heartbeat skipped — no prompt configured', { channelId });
      scheduleTick(channelId, channelName, intervalMs, client);
      return;
    }

    // Get the Discord channel
    const channel = await client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) {
      logger.warn('Heartbeat channel not found or not a text channel', { channelId });
      scheduleTick(channelId, channelName, intervalMs, client);
      return;
    }

    logger.info('Heartbeat tick — running prompt', { channelId, channelName });

    // Snapshot state before heartbeat
    const projectDir = await getProjectDirectory(channelName);
    await autoCommit(projectDir, 'Pre-heartbeat snapshot');

    await channel.sendTyping();
    const typingInterval = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, 8000);

    try {
      const result = await runClaude({
        channelId,
        channelName,
        threadId: null,
        prompt: userPrompt,
        isHeartbeat: true,
      });

      clearInterval(typingInterval);

      const noWork = result.text.trim() === '[HEARTBEAT OK]';

      // Check for usage limit / rate limit errors
      if (result.isError && isRateLimitError(result.text)) {
        lastUsageLimitMessage = result.text;
        lastUsageLimitTime = Date.now();

        const delayMs = parseResetTime(result.text);
        if (delayMs) {
          const delayMins = Math.ceil(delayMs / 60000);
          logger.warn(`Heartbeat hit usage limit — delaying ${delayMins}m`, { channelId });
          try {
            await channel.send(`**Heartbeat delayed** — usage cooldown, resuming in ~${delayMins} minutes.`);
          } catch { /* can't send */ }
          // Schedule for after the reset + 2 min buffer
          scheduleTick(channelId, channelName, delayMs, client);
        } else {
          logger.warn('Heartbeat hit rate limit — backing off 2x', { channelId });
          try {
            await channel.send('**Heartbeat delayed** — rate limited, backing off.');
          } catch { /* can't send */ }
          scheduleTick(channelId, channelName, intervalMs * 2, client);
        }
        return;
      }

      if (noWork) {
        logger.info('Heartbeat completed — no work to do', { channelId });
      } else if (result.text) {
        const chunks = splitMessage(result.text);
        const allAttachmentPaths = [...result.imageFiles, ...result.uploadFiles];
        const attachments = await createAttachments(allAttachmentPaths);

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
          await channel.send(`**Files changed:** ${fileList}`);
        }

        // Schedule any callbacks the LLM requested
        if (result.callbacks.length > 0) {
          scheduleCallbacks(channelId, channelName, result.callbacks, client);
        }

        // Show diff and auto-commit
        const diff = await getCompactDiff(projectDir);
        if (diff) {
          const diffChunks = splitMessage(diff);
          for (const chunk of diffChunks) {
            await channel.send(chunk);
          }
        }
        await autoCommit(projectDir, 'Auto-commit after heartbeat tick');

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
      const errMsg = error instanceof Error ? error.message : String(error);

      if (isRateLimitError(errMsg)) {
        lastUsageLimitMessage = errMsg;
        lastUsageLimitTime = Date.now();

        const delayMs = parseResetTime(errMsg);
        if (delayMs) {
          const delayMins = Math.ceil(delayMs / 60000);
          try {
            await channel.send(`**Heartbeat delayed** — usage cooldown, resuming in ~${delayMins} minutes.`);
          } catch { /* can't send */ }
          scheduleTick(channelId, channelName, delayMs, client);
        } else {
          try {
            await channel.send('**Heartbeat delayed** — rate limited, backing off.');
          } catch { /* can't send */ }
          scheduleTick(channelId, channelName, intervalMs * 2, client);
        }
        return;
      }

      logger.error('Heartbeat Claude run failed', { channelId, error });
      try {
        await channel.send(`**Heartbeat error:** ${errMsg}`);
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
 * Fire a heartbeat tick immediately (for testing). Also resets the timer.
 */
export function fireNow(channelId: string, channelName: string, client: Client): void {
  const existing = activeTimers.get(channelId);
  const intervalMs = existing?.intervalMs || 0;

  // Fire the tick now
  tick(channelId, channelName, intervalMs, client);
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
 * Get milliseconds remaining until next heartbeat tick, or null if not active
 */
export function getTimeRemainingMs(channelId: string): number | null {
  const existing = activeTimers.get(channelId);
  if (!existing) return null;
  const elapsed = Date.now() - existing.scheduledAt;
  return Math.max(0, existing.intervalMs - elapsed);
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

// ---- Scheduled Callbacks ----
// One-shot timers: the LLM can schedule a future session with a specific prompt.

const activeCallbacks: Map<string, ReturnType<typeof setTimeout>[]> = new Map();

/**
 * Schedule one-shot callbacks from a Claude response.
 * Each callback fires a fresh session with the given prompt after the delay.
 */
export function scheduleCallbacks(
  channelId: string,
  channelName: string,
  callbacks: ScheduledCallback[],
  client: Client
): void {
  for (const cb of callbacks) {
    const delayMins = Math.round(cb.delayMs / 60000);
    logger.info(`Scheduling callback in ${delayMins}m`, { channelId, prompt: cb.prompt.slice(0, 100) });

    const timer = setTimeout(async () => {
      // Remove this timer from tracking
      const timers = activeCallbacks.get(channelId);
      if (timers) {
        const idx = timers.indexOf(timer);
        if (idx >= 0) timers.splice(idx, 1);
      }

      try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !(channel instanceof TextChannel)) {
          logger.warn('Callback channel not found', { channelId });
          return;
        }

        await channel.sendTyping();
        const typingInterval = setInterval(() => {
          channel.sendTyping().catch(() => {});
        }, 8000);

        try {
          const result = await runClaude({
            channelId,
            channelName,
            threadId: null,
            prompt: cb.prompt,
            isHeartbeat: true, // fresh session, same mechanics
          });

          clearInterval(typingInterval);

          const noWork = result.text.trim() === '[HEARTBEAT OK]';

          if (result.isError && isRateLimitError(result.text)) {
            lastUsageLimitMessage = result.text;
            lastUsageLimitTime = Date.now();
            try {
              await channel.send('**Scheduled callback hit rate limit.** Try again later.');
            } catch { /* can't send */ }
            return;
          }

          if (!noWork && result.text) {
            const chunks = splitMessage(result.text);
            const allAttachmentPaths = [...result.imageFiles, ...result.uploadFiles];
            const attachments = await createAttachments(allAttachmentPaths);

            for (let i = 0; i < chunks.length; i++) {
              const isLast = i === chunks.length - 1;
              await channel.send({
                content: chunks[i],
                files: isLast && attachments.length > 0 ? attachments : undefined,
              });
            }

            // Handle any callbacks from the callback response (nested scheduling)
            if (result.callbacks.length > 0) {
              scheduleCallbacks(channelId, channelName, result.callbacks, client);
            }
          }

          logger.info('Callback completed', { channelId, durationMs: result.durationMs });
        } catch (error) {
          clearInterval(typingInterval);
          logger.error('Callback Claude run failed', { channelId, error });
          try {
            await channel.send(`**Callback error:** ${error instanceof Error ? error.message : String(error)}`);
          } catch { /* can't send */ }
        }
      } catch (error) {
        logger.error('Callback execution error', { channelId, error });
      }
    }, cb.delayMs);

    timer.unref();

    // Track the timer
    if (!activeCallbacks.has(channelId)) {
      activeCallbacks.set(channelId, []);
    }
    activeCallbacks.get(channelId)!.push(timer);
  }
}
