import { Client, Events, Message, ThreadChannel, AttachmentBuilder, Attachment } from 'discord.js';
import { runClaude } from '../../backends/manager.js';
import { resetHeartbeat, setLastUsageLimit, scheduleCallbacks } from '../../heartbeat/scheduler.js';
import { getProjectDirectory } from '../../storage/directories.js';
import { logger } from '../../utils/logger.js';
import { splitMessage } from '../../utils/discord.js';
import { autoCommit, getCompactDiff } from '../../utils/git.js';
import fs from 'fs/promises';
import path from 'path';

function getChannelName(channel: unknown): string {
  if (channel && typeof channel === 'object' && 'name' in channel && typeof channel.name === 'string') {
    return channel.name;
  }
  return 'default';
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
 * Download Discord attachments to the project's uploads/ directory.
 * Returns the local file paths.
 */
async function downloadAttachments(attachments: Attachment[], channelName: string): Promise<string[]> {
  if (attachments.length === 0) return [];

  const projectDir = await getProjectDirectory(channelName);
  const uploadsDir = path.join(projectDir, 'uploads');
  await fs.mkdir(uploadsDir, { recursive: true });

  const localPaths: string[] = [];

  for (const attachment of attachments) {
    try {
      const response = await fetch(attachment.url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        logger.warn(`Failed to download attachment ${attachment.name}: ${response.status}`);
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      // Use timestamp to avoid collisions
      const timestamp = Date.now();
      const safeName = attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const localPath = path.join(uploadsDir, `${timestamp}_${safeName}`);
      await fs.writeFile(localPath, buffer);
      localPaths.push(localPath);
      logger.debug(`Downloaded attachment to ${localPath}`);
    } catch (error) {
      logger.warn(`Failed to download attachment ${attachment.name}:`, error);
    }
  }

  return localPaths;
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

    // Ignore empty messages (unless they have attachments)
    if (!message.content.trim() && message.attachments.size === 0) return;

    const channel = message.channel;

    // Only respond in guild text channels and threads
    if (!channel.isTextBased() || channel.isDMBased()) return;

    // Determine if we're in a thread
    const isThread = channel instanceof ThreadChannel;
    const threadId = isThread ? channel.id : null;
    const parentChannel = isThread ? channel.parent : channel;
    const channelName = getChannelName(parentChannel);
    const channelId = parentChannel?.id || channel.id;

    // Reset heartbeat timer — only for messages in the main channel, not threads
    if (!isThread) {
      resetHeartbeat(channelId, client);
    }

    // Show typing indicator
    await channel.sendTyping();

    // Keep typing indicator alive during long operations
    const typingInterval = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, 8000);

    try {
      // Download any attachments to the project directory
      const discordAttachments = [...message.attachments.values()];
      const localAttachmentPaths = await downloadAttachments(discordAttachments, channelName);

      // Build prompt — include attachment paths so Claude can read/view them
      let prompt = message.content || '';
      if (localAttachmentPaths.length > 0) {
        const fileList = localAttachmentPaths.map(p => p).join('\n');
        prompt = prompt
          ? `${prompt}\n\n[The user attached ${localAttachmentPaths.length} file(s), saved to disk. Read them to see their contents:]\n${fileList}`
          : `[The user sent ${localAttachmentPaths.length} file(s). Read them to see their contents:]\n${fileList}`;
      }

      // Snapshot current state before Claude runs
      const projectDir = await getProjectDirectory(channelName);
      await autoCommit(projectDir, `Pre-message snapshot`);

      // Filter image files for Codex's -i flag
      const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
      const imageInputs = localAttachmentPaths.filter(p =>
        IMAGE_EXTS.some(ext => p.toLowerCase().endsWith(ext))
      );

      const result = await runClaude({
        channelId,
        channelName,
        threadId,
        prompt,
        imageInputs: imageInputs.length > 0 ? imageInputs : undefined,
        onTextUpdate: () => {
          // Keep typing while streaming
        },
      });

      clearInterval(typingInterval);

      if (result.isError) {
        if (/hit your limit/i.test(result.text)) {
          setLastUsageLimit(result.text);
        }
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
          await channel.send(`**Files changed:** ${fileList}`);
        }
      }

      // Show diff of what changed and auto-commit
      if (!result.isError) {
        const diff = await getCompactDiff(projectDir);
        if (diff) {
          const diffChunks = splitMessage(diff);
          for (const chunk of diffChunks) {
            await channel.send(chunk);
          }
        }
        await autoCommit(projectDir, `Auto-commit after Claude response`);
      }

      // Schedule any callbacks the LLM requested
      if (result.callbacks.length > 0) {
        scheduleCallbacks(channelId, channelName, result.callbacks, client);
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
