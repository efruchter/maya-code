import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ThreadChannel,
  EmbedBuilder,
} from 'discord.js';
import { getSession } from '../../storage/sessions.js';
import { isProcessRunning, getActiveProcessCount } from '../../claude/manager.js';
import { getProjectDirectory } from '../../storage/directories.js';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show session info for this channel/thread');

function getChannelName(channel: unknown): string {
  if (channel && typeof channel === 'object' && 'name' in channel && typeof channel.name === 'string') {
    return channel.name;
  }
  return 'default';
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;

  if (!channel) {
    await interaction.reply({ content: 'Could not determine channel.', ephemeral: true });
    return;
  }

  // Determine if we're in a thread
  const isThread = channel instanceof ThreadChannel;
  const threadId = isThread ? channel.id : null;
  const parentChannel = isThread ? channel.parent : channel;
  const channelName = getChannelName(parentChannel);
  const channelId = parentChannel?.id || channel.id;

  const session = await getSession(channelId, threadId);
  const isRunning = isProcessRunning(channelId, threadId);
  const projectDir = await getProjectDirectory(channelName);

  const embed = new EmbedBuilder()
    .setTitle('Maya Code Status')
    .setColor(isRunning ? 0xffa500 : session ? 0x00ff00 : 0x808080)
    .addFields(
      {
        name: 'Channel',
        value: `#${channelName}${threadId ? ` (thread)` : ''}`,
        inline: true,
      },
      {
        name: 'Status',
        value: isRunning ? '🔄 Running' : session ? '✅ Active' : '⚪ No session',
        inline: true,
      },
      {
        name: 'Project Directory',
        value: `\`${projectDir}\``,
        inline: false,
      }
    );

  if (session) {
    embed.addFields(
      {
        name: 'Session ID',
        value: `\`${session.sessionId}\``,
        inline: false,
      },
      {
        name: 'Messages',
        value: `${session.messageCount}`,
        inline: true,
      },
      {
        name: 'Created',
        value: new Date(session.createdAt).toLocaleString(),
        inline: true,
      }
    );
  }

  embed.addFields({
    name: 'Active Processes',
    value: `${getActiveProcessCount()} globally`,
    inline: true,
  });

  await interaction.reply({ embeds: [embed] });
}
