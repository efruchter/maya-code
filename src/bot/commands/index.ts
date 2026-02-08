import {
  Collection,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import * as continueCmd from './continue.js';
import * as clear from './clear.js';
import * as status from './status.js';
import * as plan from './plan.js';
import * as heartbeat from './heartbeat.js';
import * as restart from './restart.js';
import * as summary from './summary.js';

export interface Command {
  data: Pick<SlashCommandBuilder, 'name' | 'toJSON'>;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export const commands = new Collection<string, Command>();

const commandModules = [continueCmd, clear, status, plan, heartbeat, restart, summary];

for (const module of commandModules) {
  commands.set(module.data.name, module as Command);
}

export function getCommandsData(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return commandModules.map((m) => m.data.toJSON());
}
