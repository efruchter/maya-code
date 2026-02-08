import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ThreadChannel,
} from 'discord.js';
import { runClaude } from '../../claude/manager.js';
import { getSession } from '../../storage/sessions.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('summary')
  .setDescription('Ask Claude to summarize the current session and project state');

function getChannelName(channel: unknown): string {
  if (channel && typeof channel === 'object' && 'name' in channel && typeof (channel as Record<string, unknown>).name === 'string') {
    return (channel as Record<string, string>).name;
  }
  return 'default';
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const channel = interaction.channel;
  if (!channel) {
    await interaction.editReply({ content: 'Could not determine channel.' });
    return;
  }

  const isThread = channel instanceof ThreadChannel;
  const threadId = isThread ? channel.id : null;
  const parentChannel = isThread ? channel.parent : channel;
  const channelName = getChannelName(parentChannel);
  const channelId = parentChannel?.id || channel.id;

  const session = await getSession(channelId, threadId);
  if (!session || session.messageCount === 0) {
    await interaction.editReply('No session history to summarize.');
    return;
  }

  try {
    const result = await runClaude({
      channelId,
      channelName,
      threadId,
      prompt: 'Summarize the current state of this project and conversation. What has been done, what is in progress, and what remains. Be concise.',
      continueSession: true,
    });

    if (result.isError) {
      await interaction.editReply(`**Error:** ${result.text}`);
    } else {
      await interaction.editReply(result.text.slice(0, 2000));
    }

    logger.info('Summary completed', {
      channelId,
      threadId,
      durationMs: result.durationMs,
      costUsd: result.costUsd,
    });
  } catch (error) {
    logger.error('Error generating summary', error);
    await interaction.editReply(
      `**Error:** ${error instanceof Error ? error.message : 'An unknown error occurred'}`
    );
  }
}
