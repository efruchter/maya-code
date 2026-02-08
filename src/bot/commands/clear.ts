import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ThreadChannel,
} from 'discord.js';
import { clearSession, getSession } from '../../storage/sessions.js';
import { killProcess, isProcessRunning } from '../../claude/manager.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('clear')
  .setDescription('Clear the session for this channel/thread');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;

  if (!channel) {
    await interaction.reply({ content: 'Could not determine channel.', ephemeral: true });
    return;
  }

  // Determine if we're in a thread
  const isThread = channel instanceof ThreadChannel;
  const threadId = isThread ? channel.id : null;
  const parentChannel = isThread ? channel.parent : channel;
  const channelId = parentChannel?.id || channel.id;

  // Check if session exists
  const session = await getSession(channelId, threadId);
  if (!session) {
    await interaction.reply({
      content: 'No session found for this channel/thread.',
      ephemeral: true,
    });
    return;
  }

  // Kill any running process
  if (isProcessRunning(channelId, threadId)) {
    killProcess(channelId, threadId);
    logger.info('Killed running process during clear', { channelId, threadId });
  }

  // Clear the session
  const cleared = await clearSession(channelId, threadId);

  if (cleared) {
    await interaction.reply({
      content: `Session cleared. Session ID was: \`${session.sessionId}\``,
    });
    logger.info('Session cleared', { channelId, threadId, sessionId: session.sessionId });
  } else {
    await interaction.reply({
      content: 'Failed to clear session.',
      ephemeral: true,
    });
  }
}
