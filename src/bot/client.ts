import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { setupReadyEvent } from './events/ready.js';
import { setupInteractionEvent } from './events/interactionCreate.js';
import { setupMessageEvent } from './events/messageCreate.js';

export function createClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  // Set up event handlers
  setupReadyEvent(client);
  setupInteractionEvent(client);
  setupMessageEvent(client);

  return client;
}

export async function startBot(): Promise<Client> {
  const client = createClient();

  logger.info('Logging in to Discord...');
  await client.login(config.discord.token);

  return client;
}
