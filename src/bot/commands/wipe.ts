import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  TextChannel,
  ThreadChannel,
} from 'discord.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('wipe')
  .setDescription('Delete all messages in this channel/thread');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;

  if (!channel) {
    await interaction.reply({ content: 'Could not determine channel.', ephemeral: true });
    return;
  }

  if (!(channel instanceof TextChannel) && !(channel instanceof ThreadChannel)) {
    await interaction.reply({ content: 'This command only works in text channels and threads.', ephemeral: true });
    return;
  }

  await interaction.reply({ content: '**Wiping messages...**', ephemeral: true });

  let totalDeleted = 0;

  try {
    // bulkDelete can only delete messages < 14 days old, up to 100 at a time
    // Loop until no more messages are found
    while (true) {
      const messages = await channel.messages.fetch({ limit: 100 });
      if (messages.size === 0) break;

      // Filter to messages under 14 days old (Discord bulk delete limit)
      const now = Date.now();
      const fourteenDays = 14 * 24 * 60 * 60 * 1000;
      const deletable = messages.filter(m => now - m.createdTimestamp < fourteenDays);

      if (deletable.size === 0) break;

      const deleted = await channel.bulkDelete(deletable, true);
      totalDeleted += deleted.size;

      if (deleted.size < deletable.size) break;

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 1000));
    }

    logger.info('Channel wiped', { channelId: channel.id, messagesDeleted: totalDeleted });
    await interaction.editReply(`**Wiped ${totalDeleted} messages.**`);
  } catch (error) {
    logger.error('Wipe failed', { channelId: channel.id, error });
    await interaction.editReply(`**Wipe failed** after deleting ${totalDeleted} messages: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
