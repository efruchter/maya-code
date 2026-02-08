import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ThreadChannel,
} from 'discord.js';
import { getOrCreateSession, setHeartbeat } from '../../storage/sessions.js';
import { startHeartbeat, stop, isActive } from '../../heartbeat/scheduler.js';
import { logger } from '../../utils/logger.js';

const DEFAULT_INTERVAL_MINUTES = 30;

export const data = new SlashCommandBuilder()
  .setName('heartbeat')
  .setDescription('Configure autonomous heartbeat — Claude runs a prompt on a timer')
  .addStringOption((option) =>
    option
      .setName('action')
      .setDescription('stop to disable, or a prompt for Claude to run each tick')
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName('interval')
      .setDescription('Interval in minutes (0 to disable, default 30)')
      .setMinValue(0)
      .setRequired(false)
  );

function getChannelName(channel: unknown): string {
  if (channel && typeof channel === 'object' && 'name' in channel && typeof (channel as Record<string, unknown>).name === 'string') {
    return (channel as Record<string, string>).name;
  }
  return 'default';
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const channel = interaction.channel;
  if (!channel) {
    await interaction.editReply({ content: 'Could not determine channel.' });
    return;
  }

  // Heartbeat is per-project (per-channel), not per-thread
  const isThread = channel instanceof ThreadChannel;
  const parentChannel = isThread ? channel.parent : channel;
  const channelName = getChannelName(parentChannel);
  const channelId = parentChannel?.id || channel.id;

  const action = interaction.options.getString('action', true);
  const intervalMinutes = interaction.options.getInteger('interval');

  // Handle stop
  if (action === 'stop' || intervalMinutes === 0) {
    await getOrCreateSession(channelId, null, channelName);
    await setHeartbeat(channelId, null, undefined);
    stop(channelId);
    await interaction.editReply('**Heartbeat disabled.**');
    logger.info('Heartbeat disabled via command', { channelId });
    return;
  }

  // Enable heartbeat with the action string as the prompt
  const minutes = intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
  const intervalMs = minutes * 60 * 1000;
  const prompt = action;

  await getOrCreateSession(channelId, null, channelName);
  await setHeartbeat(channelId, null, {
    enabled: true,
    intervalMs,
    prompt,
  });

  startHeartbeat(channelId, channelName, intervalMs, interaction.client);

  await interaction.editReply(
    `**Heartbeat enabled** — running every ${minutes} minute${minutes !== 1 ? 's' : ''}.\n**Prompt:** ${prompt}`
  );

  logger.info('Heartbeat enabled via command', { channelId, channelName, intervalMs, prompt });
}
