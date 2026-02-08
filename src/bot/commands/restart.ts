import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import { stopAll } from '../../heartbeat/scheduler.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('restart')
  .setDescription('Restart the bot process');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  logger.info('Restart requested via /restart command', { user: interaction.user.tag });

  await interaction.reply('**Restarting...** The bot will be back shortly.');

  // Stop all heartbeats cleanly
  stopAll();

  // Give Discord a moment to send the reply, then exit
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}
