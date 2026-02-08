import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  discord: {
    token: requireEnv('DISCORD_TOKEN'),
    clientId: requireEnv('DISCORD_CLIENT_ID'),
    guildId: requireEnv('DISCORD_GUILD_ID'),
    maxMessageLength: 2000,
  },
  baseDirectory: path.resolve(process.env.BASE_DIRECTORY || './projects'),
  stateFile: path.resolve('./state.json'),

  // Rate limiting
  rateLimit: {
    editsPerMessage: 5,
    editsWindowMs: 5000,
    messagesPerChannel: 10,
    messagesWindowMs: 10000,
  },
};
