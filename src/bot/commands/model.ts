import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { getGlobalModel, setGlobalModel } from '../../storage/sessions.js';
import { resolveModel, getAvailableModels, detectBackend, Backend } from '../../models.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('model')
  .setDescription('Set or view the current model (bot-wide)')
  .addStringOption((option) =>
    option
      .setName('name')
      .setDescription('Model name or alias (opus, sonnet, codex, 5.2, etc.) — leave empty to view current')
      .setRequired(false)
  );

function backendLabel(backend: Backend): string {
  return backend === 'codex' ? 'Codex' : 'Claude';
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const name = interaction.options.getString('name');

  // View current model
  if (!name) {
    const globalModel = await getGlobalModel();
    const current = globalModel || config.defaultModel;
    const backend = detectBackend(current);

    const models = getAvailableModels();
    const claudeModels = models.filter(m => m.backend === 'claude');
    const codexModels = models.filter(m => m.backend === 'codex');

    // Deduplicate by modelId for display
    const seen = new Set<string>();
    const dedup = (entries: typeof models) =>
      entries.filter(m => {
        if (seen.has(m.modelId)) return false;
        seen.add(m.modelId);
        return true;
      });

    const claudeList = dedup(claudeModels).map(m => {
      const aliases = claudeModels.filter(a => a.modelId === m.modelId).map(a => `\`${a.alias}\``).join(', ');
      return `  ${aliases} → ${m.modelId}`;
    }).join('\n');

    seen.clear();
    const codexList = dedup(codexModels).map(m => {
      const aliases = codexModels.filter(a => a.modelId === m.modelId).map(a => `\`${a.alias}\``).join(', ');
      return `  ${aliases} → ${m.modelId}`;
    }).join('\n');

    await interaction.editReply(
      `**Current model:** ${current} (${backendLabel(backend)})\n` +
      (globalModel ? `**Default (.env):** ${config.defaultModel}\n` : '') +
      `\n**Claude models:**\n${claudeList}\n\n**Codex models:**\n${codexList}`
    );
    return;
  }

  // Reset to default
  if (name === 'default' || name === 'reset') {
    await setGlobalModel(undefined);
    const backend = detectBackend(config.defaultModel);
    await interaction.editReply(`**Model reset to default:** ${config.defaultModel} (${backendLabel(backend)})`);
    logger.info('Model reset to default');
    return;
  }

  // Resolve and set
  const { modelId, backend } = resolveModel(name);
  await setGlobalModel(modelId);
  await interaction.editReply(`**Model switched to:** ${modelId} (${backendLabel(backend)})`);
  logger.info('Global model changed', { model: modelId, backend });
}
