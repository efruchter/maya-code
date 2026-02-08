import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ThreadChannel,
} from 'discord.js';
import { getOrCreateSession, setHeartbeat } from '../../storage/sessions.js';
import { startHeartbeat, stop, isActive, fireNow, getTimeRemainingMs } from '../../heartbeat/scheduler.js';
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

  // Handle status
  if (action === 'status') {
    const session = await getOrCreateSession(channelId, null, channelName);
    const hb = session.heartbeat;
    if (hb?.enabled) {
      const mins = Math.round(hb.intervalMs / 60000);
      const running = isActive(channelId);
      const remainingMs = getTimeRemainingMs(channelId);
      let timerInfo: string;
      if (running && remainingMs !== null) {
        const remainMins = Math.floor(remainingMs / 60000);
        const remainSecs = Math.floor((remainingMs % 60000) / 1000);
        timerInfo = `(next tick in ${remainMins}m ${remainSecs}s)`;
      } else {
        timerInfo = '(timer not running — will restore on restart)';
      }
      await interaction.editReply(
        `**Heartbeat:** enabled, every ${mins} minute${mins !== 1 ? 's' : ''} ${timerInfo}\n**Prompt:** ${hb.prompt}`
      );
    } else {
      await interaction.editReply('**Heartbeat:** disabled');
    }
    return;
  }

  // Handle test — fire heartbeat immediately
  if (action === 'test') {
    const session = await getOrCreateSession(channelId, null, channelName);
    if (!session.heartbeat?.enabled) {
      await interaction.editReply('**No heartbeat configured.** Set one up first with `/heartbeat action:<prompt>`.');
      return;
    }
    await interaction.editReply('**Firing heartbeat now...**');
    fireNow(channelId, channelName, interaction.client);
    return;
  }

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
