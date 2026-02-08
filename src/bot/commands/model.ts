import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ThreadChannel,
} from 'discord.js';
import { getOrCreateSession, setModel } from '../../storage/sessions.js';
import { logger } from '../../utils/logger.js';

const MODEL_ALIASES: Record<string, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-5-20250929',
  haiku: 'claude-haiku-4-5-20251001',
};

export const data = new SlashCommandBuilder()
  .setName('model')
  .setDescription('Set or view the model for this session')
  .addStringOption((option) =>
    option
      .setName('name')
      .setDescription('Model name or alias (opus, sonnet, haiku) — leave empty to view current')
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

  const isThread = channel instanceof ThreadChannel;
  const threadId = isThread ? channel.id : null;
  const parentChannel = isThread ? channel.parent : channel;
  const channelName = getChannelName(parentChannel);
  const channelId = parentChannel?.id || channel.id;

  const name = interaction.options.getString('name');

  const session = await getOrCreateSession(channelId, threadId, channelName);

  // View current model
  if (!name) {
    const current = session.model || 'default (CLI default)';
    const aliases = Object.entries(MODEL_ALIASES)
      .map(([alias, full]) => `\`${alias}\` → ${full}`)
      .join('\n');
    await interaction.editReply(`**Current model:** ${current}\n\n**Available aliases:**\n${aliases}`);
    return;
  }

  // Reset to default
  if (name === 'default' || name === 'reset') {
    await setModel(channelId, threadId, undefined);
    await interaction.editReply('**Model reset to default.** Claude CLI will use its default model.');
    logger.info('Model reset to default', { channelId, threadId });
    return;
  }

  // Set model — resolve alias or use as-is
  const resolved = MODEL_ALIASES[name.toLowerCase()] || name;
  await setModel(channelId, threadId, resolved);
  await interaction.editReply(`**Model set to:** ${resolved}`);
  logger.info('Model changed', { channelId, threadId, model: resolved });
}
