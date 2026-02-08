import { Client, Events, Interaction } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { commands } from '../commands/index.js';

export function setupInteractionEvent(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);

    if (!command) {
      logger.warn(`Unknown command: ${interaction.commandName}`);
      return;
    }

    try {
      logger.info(`Executing command: ${interaction.commandName}`, {
        user: interaction.user.tag,
        channel: interaction.channelId,
      });

      await command.execute(interaction);
    } catch (error) {
      logger.error(`Error executing command: ${interaction.commandName}`, error);

      try {
        const errorMessage = 'There was an error executing this command.';

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMessage, flags: 64 });
        } else {
          await interaction.reply({ content: errorMessage, flags: 64 });
        }
      } catch {
        // Interaction expired, nothing we can do
      }
    }
  });
}
