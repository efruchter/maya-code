import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ThreadChannel,
} from 'discord.js';
import { getSession, getAllSessions } from '../../storage/sessions.js';
import { getLastUsageLimit } from '../../heartbeat/scheduler.js';

export const data = new SlashCommandBuilder()
  .setName('usage')
  .setDescription('Show API usage and cost for this session');

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

  const isThread = channel instanceof ThreadChannel;
  const threadId = isThread ? channel.id : null;
  const parentChannel = isThread ? channel.parent : channel;
  const channelName = getChannelName(parentChannel);
  const channelId = parentChannel?.id || channel.id;

  const session = await getSession(channelId, threadId);

  const lines: string[] = [];

  if (session) {
    const cost = session.totalCostUsd || 0;
    lines.push(`**This session** (\`${channelName}${threadId ? ' / thread' : ''}\`)`);
    lines.push(`  Messages: ${session.messageCount}`);
    lines.push(`  Cost: $${cost.toFixed(4)}`);
    lines.push(`  Model: ${session.model || 'default'}`);
  } else {
    lines.push('**No session found for this channel/thread.**');
  }

  // Global totals
  const allSessions = await getAllSessions();
  const totalCost = allSessions.reduce((sum, s) => sum + (s.totalCostUsd || 0), 0);
  const totalMessages = allSessions.reduce((sum, s) => sum + s.messageCount, 0);

  lines.push('');
  lines.push(`**All sessions** (${allSessions.length} total)`);
  lines.push(`  Messages: ${totalMessages}`);
  lines.push(`  Cost: $${totalCost.toFixed(4)}`);

  // Show last known usage limit
  const limit = getLastUsageLimit();
  if (limit) {
    const ago = Math.round((Date.now() - limit.timestamp) / 60000);
    lines.push('');
    lines.push(`**Last usage limit** (${ago}m ago)`);
    lines.push(`  ${limit.message}`);
  }

  await interaction.editReply(lines.join('\n'));
}
