import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ThreadChannel,
  AttachmentBuilder,
} from 'discord.js';
import { getProjectDirectory } from '../../storage/directories.js';
import { logger } from '../../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

export const data = new SlashCommandBuilder()
  .setName('show')
  .setDescription('Upload a file from the project directory to Discord')
  .addStringOption((option) =>
    option
      .setName('path')
      .setDescription('File path (relative to project directory, or absolute)')
      .setRequired(true)
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
  const parentChannel = isThread ? channel.parent : channel;
  const channelName = getChannelName(parentChannel);

  const filePath = interaction.options.getString('path', true);

  // Resolve path: absolute paths used as-is, relative paths resolved from project dir
  let resolvedPath: string;
  if (path.isAbsolute(filePath)) {
    resolvedPath = filePath;
  } else {
    const projectDir = await getProjectDirectory(channelName);
    resolvedPath = path.resolve(projectDir, filePath);
  }

  // Check file exists
  try {
    const stat = await fs.stat(resolvedPath);
    if (stat.isDirectory()) {
      // List directory contents instead
      const entries = await fs.readdir(resolvedPath);
      const list = entries.map(e => `\`${e}\``).join(', ') || '*(empty)*';
      await interaction.editReply(`**Directory:** \`${filePath}\`\n${list}`);
      return;
    }
  } catch {
    await interaction.editReply(`**File not found:** \`${filePath}\``);
    return;
  }

  try {
    const fileName = path.basename(resolvedPath);
    const attachment = new AttachmentBuilder(resolvedPath, { name: fileName });

    await interaction.editReply({
      content: `**${fileName}**`,
      files: [attachment],
    });

    logger.info('File shown via /show', { filePath: resolvedPath, user: interaction.user.tag });
  } catch (error) {
    logger.error('Error showing file', error);
    await interaction.editReply(`**Error:** Could not upload \`${filePath}\``);
  }
}
