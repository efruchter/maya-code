import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ThreadChannel,
} from 'discord.js';
import { killProcess, isProcessRunning } from '../../backends/manager.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Stop the current response in this channel/thread');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;

  if (!channel) {
    await interaction.reply({ content: 'Could not determine channel.', ephemeral: true });
    return;
  }

  const isThread = channel instanceof ThreadChannel;
  const threadId = isThread ? channel.id : null;
  const parentChannel = isThread ? channel.parent : channel;
  const channelId = parentChannel?.id || channel.id;

  if (!isProcessRunning(channelId, threadId)) {
    await interaction.reply({ content: 'Nothing is running right now.', ephemeral: true });
    return;
  }

  killProcess(channelId, threadId);
  logger.info('Process stopped via /stop', { channelId, threadId, user: interaction.user.tag });

  await interaction.reply('**Stopped.** The response has been cancelled.');
}
