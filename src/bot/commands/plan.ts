import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ThreadChannel,
} from 'discord.js';
import { getOrCreateSession, setPlanMode } from '../../storage/sessions.js';
import { isProcessRunning } from '../../claude/manager.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('plan')
  .setDescription('Toggle plan mode (Claude reviews changes before applying)');

function getChannelName(channel: unknown): string {
  if (channel && typeof channel === 'object' && 'name' in channel && typeof (channel as Record<string, unknown>).name === 'string') {
    return (channel as Record<string, string>).name;
  }
  return 'default';
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;

  if (!channel) {
    await interaction.reply({ content: 'Could not determine channel.', ephemeral: true });
    return;
  }

  const isThread = channel instanceof ThreadChannel;
  const threadId = isThread ? channel.id : null;
  const parentChannel = isThread ? channel.parent : channel;
  const channelName = getChannelName(parentChannel);
  const channelId = parentChannel?.id || channel.id;

  // Get or create session so plan mode can be toggled before first message
  const session = await getOrCreateSession(channelId, threadId, channelName);
  const newPlanMode = !session.planMode;

  await setPlanMode(channelId, threadId, newPlanMode);

  const notice = isProcessRunning(channelId, threadId)
    ? ' (takes effect on next message — a process is currently running)'
    : '';

  if (newPlanMode) {
    await interaction.reply(
      `**Plan mode enabled${notice}.** Claude will review and describe changes before applying them. Use \`/plan\` again to disable.`
    );
  } else {
    await interaction.reply(
      `**Plan mode disabled${notice}.** Claude will apply changes directly. Use \`/plan\` again to re-enable.`
    );
  }

  logger.info('Plan mode toggled', { channelId, threadId, planMode: newPlanMode });
}
