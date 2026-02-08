import { Client, Events, Message, ThreadChannel, AttachmentBuilder } from 'discord.js';
import { runClaude } from '../../claude/manager.js';
import { resetHeartbeat } from '../../heartbeat/scheduler.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config.js';
import fs from 'fs/promises';
import path from 'path';

function getChannelName(channel: unknown): string {
  if (channel && typeof channel === 'object' && 'name' in channel && typeof channel.name === 'string') {
    return channel.name;
  }
  return 'default';
}

/**
 * Split text at safe boundaries for Discord's 2000 char limit
 */
function splitMessage(text: string): string[] {
  const MAX_LENGTH = config.discord.maxMessageLength;
  if (text.length <= MAX_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitPoint = MAX_LENGTH;

    // Try to split at code block boundary
    const codeBlockEnd = remaining.lastIndexOf('\n```', MAX_LENGTH);
    if (codeBlockEnd > MAX_LENGTH / 2) {
      const lineEnd = remaining.indexOf('\n', codeBlockEnd + 1);
      if (lineEnd > 0 && lineEnd < MAX_LENGTH) {
        splitPoint = lineEnd + 1;
      }
    } else {
      // Try to split at newline
      const newlinePos = remaining.lastIndexOf('\n', MAX_LENGTH);
      if (newlinePos > MAX_LENGTH / 2) {
        splitPoint = newlinePos + 1;
      } else {
        // Try to split at space
        const spacePos = remaining.lastIndexOf(' ', MAX_LENGTH);
        if (spacePos > MAX_LENGTH / 2) {
          splitPoint = spacePos + 1;
        }
      }
    }

    chunks.push(remaining.slice(0, splitPoint));
    remaining = remaining.slice(splitPoint);
  }

  return chunks;
}

/**
 * Check if a file exists and is accessible
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create Discord attachments for files that exist
 */
async function createAttachments(filePaths: string[]): Promise<AttachmentBuilder[]> {
  const attachments: AttachmentBuilder[] = [];

  for (const filePath of filePaths) {
    if (await fileExists(filePath)) {
      try {
        const fileName = path.basename(filePath);
        const attachment = new AttachmentBuilder(filePath, { name: fileName });
        attachments.push(attachment);
        logger.debug(`Created attachment for: ${filePath}`);
      } catch (error) {
        logger.warn(`Failed to create attachment for ${filePath}:`, error);
      }
    } else {
      logger.debug(`File not found for attachment: ${filePath}`);
    }
  }

  return attachments;
}

export function setupMessageEvent(client: Client): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    // Ignore bot messages and system messages
    if (message.author.bot) return;
    if (message.system) return;

    // Ignore empty messages
    if (!message.content.trim()) return;

    const channel = message.channel;

    // Only respond in guild text channels and threads
    if (!channel.isTextBased() || channel.isDMBased()) return;

    // Determine if we're in a thread
    const isThread = channel instanceof ThreadChannel;
    const threadId = isThread ? channel.id : null;
    const parentChannel = isThread ? channel.parent : channel;
    const channelName = getChannelName(parentChannel);
    const channelId = parentChannel?.id || channel.id;

    // Reset heartbeat timer — human activity pushes back the next tick
    resetHeartbeat(channelId, client);

    // Show typing indicator
    await channel.sendTyping();

    // Keep typing indicator alive during long operations
    const typingInterval = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, 8000);

    try {
      const result = await runClaude({
        channelId,
        channelName,
        threadId,
        prompt: message.content,
        onTextUpdate: () => {
          // Keep typing while streaming
        },
      });

      clearInterval(typingInterval);

      if (result.isError) {
        await message.reply(`**Error:** ${result.text}`);
      } else {
        // Split response if needed
        const chunks = splitMessage(result.text);

        // Create attachments for image files and explicit [UPLOAD] files
        const allAttachmentPaths = [...result.imageFiles, ...result.uploadFiles];
        const attachments = await createAttachments(allAttachmentPaths);

        // Send text chunks
        for (let i = 0; i < chunks.length; i++) {
          const isLastChunk = i === chunks.length - 1;

          if (i === 0) {
            // First message: reply with text, and attachments if this is the only chunk
            await message.reply({
              content: chunks[i],
              files: isLastChunk && attachments.length > 0 ? attachments : undefined,
            });
          } else if (isLastChunk && attachments.length > 0) {
            // Last chunk with attachments
            await channel.send({
              content: chunks[i],
              files: attachments,
            });
          } else {
            await channel.send(chunks[i]);
          }
        }

        // If there are non-image files, mention them
        const nonImageFiles = result.createdFiles.filter(
          f => !result.imageFiles.includes(f)
        );
        if (nonImageFiles.length > 0) {
          const fileList = nonImageFiles.map(f => `\`${path.basename(f)}\``).join(', ');
          await channel.send(`**Files created:** ${fileList}`);
        }
      }

      logger.info('Claude response completed', {
        channelId,
        threadId,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
        user: message.author.tag,
        filesCreated: result.createdFiles.length,
        imagesAttached: result.imageFiles.length,
      });
    } catch (error) {
      clearInterval(typingInterval);
      logger.error('Error running Claude', error);
      try {
        await channel.send(`**Error:** ${error instanceof Error ? error.message : 'An unknown error occurred'}`);
      } catch {
        // Failed to send error message, already logged
      }
    }
  });
}
