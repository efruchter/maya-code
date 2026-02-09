import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ThreadChannel,
} from 'discord.js';
import { getOrCreateSession, setHeartbeat } from '../../storage/sessions.js';
import { getProjectDirectory } from '../../storage/directories.js';
import { startHeartbeat, stop, isActive, fireNow, getTimeRemainingMs } from '../../heartbeat/scheduler.js';
import { logger } from '../../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

const DEFAULT_INTERVAL_MINUTES = 30;

const DEFAULT_HEARTBEAT_GOALS = `# Heartbeat Goals

## Current Focus
- Explore the project — read the README, browse the code, understand the architecture
- Identify what needs work: TODOs, bugs, incomplete features, missing tests
- Pick the single most impactful task and make progress on it

## Next Steps
_To be filled in after first tick — what should the next heartbeat focus on?_

## Status
_No work done yet — this is the initial heartbeat._
`;

export const data = new SlashCommandBuilder()
  .setName('heartbeat')
  .setDescription('Configure autonomous heartbeat — Claude runs on a timer, self-directed via HEARTBEAT.md')
  .addStringOption((option) =>
    option
      .setName('action')
      .setDescription('start, stop, status, test, or initial goals for HEARTBEAT.md')
      .setRequired(false)
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

// The heartbeat prompt stored in session — always points at HEARTBEAT.md
const HEARTBEAT_PROMPT = 'Read HEARTBEAT.md and do the work described there. Update it when done.';

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

  const action = interaction.options.getString('action');
  const intervalMinutes = interaction.options.getInteger('interval');

  // If only interval is provided (no action), update interval on existing heartbeat or start one
  if (!action && intervalMinutes !== null) {
    if (intervalMinutes === 0) {
      await getOrCreateSession(channelId, null, channelName);
      await setHeartbeat(channelId, null, undefined);
      stop(channelId);
      await interaction.editReply('**Heartbeat disabled.** HEARTBEAT.md is preserved for next time.');
      return;
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    const session = await getOrCreateSession(channelId, null, channelName);

    // Seed HEARTBEAT.md if it doesn't exist
    const projectDir = await getProjectDirectory(channelName);
    const heartbeatPath = path.join(projectDir, 'HEARTBEAT.md');
    try {
      await fs.access(heartbeatPath);
    } catch {
      await fs.writeFile(heartbeatPath, DEFAULT_HEARTBEAT_GOALS);
    }

    await setHeartbeat(channelId, null, {
      enabled: true,
      intervalMs,
      prompt: session.heartbeat?.prompt || HEARTBEAT_PROMPT,
    });

    startHeartbeat(channelId, channelName, intervalMs, interaction.client);

    await interaction.editReply(
      `**Heartbeat interval updated** — running every ${intervalMinutes} minute${intervalMinutes !== 1 ? 's' : ''}.`
    );
    logger.info('Heartbeat interval updated via command', { channelId, intervalMs });
    return;
  }

  // If neither action nor interval provided, show status
  if (!action) {
    // Fall through to status display
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

      const projectDir = await getProjectDirectory(channelName);
      const heartbeatPath = path.join(projectDir, 'HEARTBEAT.md');
      let heartbeatPreview = '';
      try {
        const content = await fs.readFile(heartbeatPath, 'utf-8');
        const preview = content.slice(0, 300);
        heartbeatPreview = `\n**HEARTBEAT.md:**\n\`\`\`\n${preview}${content.length > 300 ? '...' : ''}\n\`\`\``;
      } catch {
        heartbeatPreview = '\n**HEARTBEAT.md:** not found';
      }

      await interaction.editReply(
        `**Heartbeat:** enabled, every ${mins} minute${mins !== 1 ? 's' : ''} ${timerInfo}${heartbeatPreview}`
      );
    } else {
      await interaction.editReply('**Heartbeat:** disabled');
    }
    return;
  }

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

      // Check if HEARTBEAT.md exists
      const projectDir = await getProjectDirectory(channelName);
      const heartbeatPath = path.join(projectDir, 'HEARTBEAT.md');
      let heartbeatPreview = '';
      try {
        const content = await fs.readFile(heartbeatPath, 'utf-8');
        const preview = content.slice(0, 300);
        heartbeatPreview = `\n**HEARTBEAT.md:**\n\`\`\`\n${preview}${content.length > 300 ? '...' : ''}\n\`\`\``;
      } catch {
        heartbeatPreview = '\n**HEARTBEAT.md:** not found';
      }

      await interaction.editReply(
        `**Heartbeat:** enabled, every ${mins} minute${mins !== 1 ? 's' : ''} ${timerInfo}${heartbeatPreview}`
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
      await interaction.editReply('**No heartbeat configured.** Set one up first with `/heartbeat action:start`.');
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
    await interaction.editReply('**Heartbeat disabled.** HEARTBEAT.md is preserved for next time.');
    logger.info('Heartbeat disabled via command', { channelId });
    return;
  }

  // Start heartbeat — "start" uses defaults, anything else becomes initial goals
  const minutes = intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
  const intervalMs = minutes * 60 * 1000;

  // Seed HEARTBEAT.md if it doesn't exist (or if user provided custom goals)
  const projectDir = await getProjectDirectory(channelName);
  const heartbeatPath = path.join(projectDir, 'HEARTBEAT.md');

  const isStartAction = action === 'start';
  let seeded = false;

  if (isStartAction) {
    // Only seed if file doesn't exist
    try {
      await fs.access(heartbeatPath);
    } catch {
      await fs.writeFile(heartbeatPath, DEFAULT_HEARTBEAT_GOALS);
      seeded = true;
    }
  } else {
    // User provided custom initial goals — write them to HEARTBEAT.md
    const customGoals = `# Heartbeat Goals\n\n## Current Focus\n${action}\n\n## Status\n_No work done yet — initial goals set by user._\n`;
    await fs.writeFile(heartbeatPath, customGoals);
    seeded = true;
  }

  await getOrCreateSession(channelId, null, channelName);
  await setHeartbeat(channelId, null, {
    enabled: true,
    intervalMs,
    prompt: HEARTBEAT_PROMPT,
  });

  startHeartbeat(channelId, channelName, intervalMs, interaction.client);

  const seedNote = seeded ? ' Created `HEARTBEAT.md` with initial goals.' : ' Using existing `HEARTBEAT.md`.';
  await interaction.editReply(
    `**Heartbeat enabled** — running every ${minutes} minute${minutes !== 1 ? 's' : ''}.${seedNote}\nClaude will read and update \`HEARTBEAT.md\` each tick.`
  );

  logger.info('Heartbeat enabled via command', { channelId, channelName, intervalMs, seeded });
}
