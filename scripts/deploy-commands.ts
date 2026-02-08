import { REST, Routes } from 'discord.js';
import { config } from '../src/config.js';
import { getCommandsData } from '../src/bot/commands/index.js';
import { logger } from '../src/utils/logger.js';

async function deployCommands(): Promise<void> {
  const commands = getCommandsData();

  const rest = new REST({ version: '10' }).setToken(config.discord.token);

  try {
    logger.info(`Deploying ${commands.length} commands to guild ${config.discord.guildId}...`);

    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body: commands }
    );

    logger.info('Successfully deployed commands!');
    console.log('Deployed commands:');
    for (const cmd of commands) {
      console.log(`  /${cmd.name}: ${cmd.description}`);
    }
  } catch (error) {
    logger.error('Failed to deploy commands', error);
    process.exit(1);
  }
}

deployCommands();
