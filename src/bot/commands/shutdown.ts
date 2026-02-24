import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import { stopAll } from '../../heartbeat/scheduler.js';
import { killAllProcesses } from '../../backends/manager.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('shutdown')
  .setDescription('Kill all active sessions and shut down the bot');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const killed = killAllProcesses();
  stopAll();

  logger.info('Shutdown requested via /shutdown', { user: interaction.user.tag, processesKilled: killed });

  await interaction.reply(`**Shutting down.** Killed ${killed} active session${killed !== 1 ? 's' : ''}, stopped all heartbeats.`);

  setTimeout(() => {
    process.exit(1); // Exit code 1 so the process manager doesn't auto-restart
  }, 1000);
}
