import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  TextChannel,
  ThreadChannel,
  AttachmentBuilder,
} from 'discord.js';
import { runClaude, isProcessRunning } from '../../backends/manager.js';
import { getSession } from '../../storage/sessions.js';
import { DiscordResponder } from '../../discord/responder.js';
import { scheduleCallbacks } from '../../heartbeat/scheduler.js';
import { logger } from '../../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

export const data = new SlashCommandBuilder()
  .setName('continue')
  .setDescription('Continue the last conversation')
  .addStringOption((option) =>
    option
      .setName('message')
      .setDescription('Optional message to add')
      .setRequired(false)
  );

function getChannelName(channel: unknown): string {
  if (channel && typeof channel === 'object' && 'name' in channel && typeof channel.name === 'string') {
    return channel.name;
  }
  return 'default';
}

async function createAttachments(filePaths: string[]): Promise<AttachmentBuilder[]> {
  const attachments: AttachmentBuilder[] = [];
  for (const filePath of filePaths) {
    try {
      await fs.access(filePath);
      attachments.push(new AttachmentBuilder(filePath, { name: path.basename(filePath) }));
    } catch {
      // File not found, skip
    }
  }
  return attachments;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const message = interaction.options.getString('message') || '';
  const channel = interaction.channel;

  if (!channel) {
    await interaction.reply({ content: 'Could not determine channel.', ephemeral: true });
    return;
  }

  // Determine if we're in a thread
  const isThread = channel instanceof ThreadChannel;
  const threadId = isThread ? channel.id : null;
  const parentChannel = isThread ? channel.parent : channel;
  const channelName = getChannelName(parentChannel);
  const channelId = parentChannel?.id || channel.id;

  // Check for existing session
  const session = await getSession(channelId, threadId);
  if (!session) {
    await interaction.reply({
      content: 'No existing session found. Use `/ask` to start a new conversation.',
      ephemeral: true,
    });
    return;
  }

  // Check for existing process
  if (isProcessRunning(channelId, threadId)) {
    await interaction.reply({
      content: 'A Claude process is already running in this channel/thread. Please wait for it to complete.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const responder = new DiscordResponder(interaction);
  await responder.initialize();

  try {
    const result = await runClaude({
      channelId,
      channelName,
      threadId,
      prompt: message || 'continue',
      continueSession: true,
      onTextUpdate: (text) => {
        responder.updateText(text);
      },
    });

    if (result.isError) {
      await responder.sendError(result.text);
    } else {
      const allAttachmentPaths = [...result.imageFiles, ...result.uploadFiles];
      const attachments = await createAttachments(allAttachmentPaths);
      await responder.finalize(result.text, attachments);

      const nonImageFiles = result.createdFiles.filter(f => !result.imageFiles.includes(f));
      if (nonImageFiles.length > 0) {
        const ch = interaction.channel as TextChannel | ThreadChannel | null;
        if (ch) {
          const fileList = nonImageFiles.map(f => `\`${path.basename(f)}\``).join(', ');
          await ch.send(`**Files changed:** ${fileList}`);
        }
      }
    }

    // Schedule any callbacks the LLM requested
    if (result.callbacks.length > 0) {
      scheduleCallbacks(channelId, channelName, result.callbacks, interaction.client);
    }

    logger.info('Claude continue completed', {
      channelId,
      threadId,
      durationMs: result.durationMs,
      costUsd: result.costUsd,
      filesCreated: result.createdFiles.length,
      imagesAttached: result.imageFiles.length,
    });
  } catch (error) {
    logger.error('Error continuing Claude', error);
    await responder.sendError(
      error instanceof Error ? error.message : 'An unknown error occurred'
    );
  }
}
