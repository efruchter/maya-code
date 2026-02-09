import { ClaudeProcess, ClaudeProcessResult } from './process.js';
import { getOrCreateSession, incrementMessageCount, addCost, SessionData } from '../storage/sessions.js';
import { getProjectDirectory } from '../storage/directories.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

export interface RunOptions {
  channelId: string;
  channelName: string;
  threadId: string | null;
  prompt: string;
  continueSession?: boolean;
  isHeartbeat?: boolean;
  onTextUpdate?: (text: string) => void;
}

const DISCORD_SYSTEM_PROMPT = `You are running inside a Discord channel. Your text responses will be posted as messages.

File sharing:
- Any image files you create (png, jpg, gif, webp, svg, bmp) are AUTOMATICALLY attached to your Discord message.
- To share any other file with the user in Discord, include [UPLOAD: path/to/file] in your response. The file will be attached and the tag will be removed from the displayed message.
- Markdown image syntax like ![alt](path) and ![[path]] also auto-attaches local files.
- You can include multiple [UPLOAD] tags in a single response.

Available slash commands (the user runs these, not you — but you can suggest them):
- /continue — Continue the conversation (useful after long pauses)
- /clear — Reset the session and start fresh
- /status — Show session info
- /plan — Toggle plan mode (review changes before applying)
- /heartbeat — Configure autonomous heartbeat timer (self-directed via HEARTBEAT.md)
- /summary — Get a summary of the current session
- /show path:<file> — Upload a file from the project to Discord
- /model [name] — Switch Claude model (opus, sonnet, haiku)
- /usage — Show API cost and usage stats
- /restart — Restart the bot

Messages are queued — if you're busy processing, new messages wait in line.`;

const HEARTBEAT_ADDITION = `\n\nThis message is from an automated heartbeat timer, not a human.

Your instructions are in HEARTBEAT.md in the project root. Read it first.
- Do the work described in HEARTBEAT.md
- After completing work, UPDATE HEARTBEAT.md with what you want to focus on next time
- Keep HEARTBEAT.md concise — a few bullet points of current goals and status
- If there is genuinely no meaningful work to do, respond with exactly "[NO WORK]" and nothing else
- Do not greet the user or ask questions — just do the work or respond [NO WORK]`;

// Track active processes by session key
const activeProcesses = new Map<string, ClaudeProcess>();

// Queue: per-channel promise chain so messages run sequentially
const processQueues = new Map<string, Promise<unknown>>();

/**
 * Get session key for tracking
 */
function getProcessKey(channelId: string, threadId: string | null): string {
  return `${channelId}-${threadId || 'main'}`;
}

/**
 * Run Claude CLI for a channel/thread.
 * If a process is already running, the call is queued and will run after
 * the current process completes.
 */
export function runClaude(options: RunOptions): Promise<ClaudeProcessResult> {
  const processKey = getProcessKey(options.channelId, options.threadId);

  const pending = processQueues.get(processKey) || Promise.resolve();
  const next = pending.then(() => runClaudeImmediate(options)).catch((err) => {
    // Ensure queue continues even if this run fails
    throw err;
  });

  // Always advance the queue, even on failure
  processQueues.set(processKey, next.catch(() => {}));

  return next;
}

async function runClaudeImmediate(options: RunOptions): Promise<ClaudeProcessResult> {
  const { channelId, channelName, threadId, prompt, continueSession, isHeartbeat, onTextUpdate } = options;
  const processKey = getProcessKey(channelId, threadId);

  // Get or create session
  const session = await getOrCreateSession(channelId, threadId, channelName);

  // Get project directory
  const workingDirectory = await getProjectDirectory(channelName);

  // Heartbeats use a fresh throwaway session each tick
  const heartbeatSessionId = isHeartbeat ? uuidv4() : null;
  const sessionId = heartbeatSessionId || session.sessionId;
  const shouldContinue = isHeartbeat ? false : (continueSession || session.messageCount > 0);

  logger.info('Starting Claude process', {
    sessionId,
    channelName,
    workingDirectory,
    isHeartbeat: !!isHeartbeat,
  });

  // Build system prompt
  let systemPrompt = DISCORD_SYSTEM_PROMPT;
  if (isHeartbeat) {
    systemPrompt += HEARTBEAT_ADDITION;
  }

  const process = new ClaudeProcess({
    sessionId,
    workingDirectory,
    prompt,
    continueSession: shouldContinue,
    appendSystemPrompt: systemPrompt,
    model: session.model,
  });

  activeProcesses.set(processKey, process);

  // Set up text streaming callback
  if (onTextUpdate) {
    process.on('text', onTextUpdate);
  }

  try {
    const result = await process.run();
    await incrementMessageCount(channelId, threadId);
    if (result.costUsd > 0) {
      await addCost(channelId, threadId, result.costUsd);
    }
    return result;
  } finally {
    activeProcesses.delete(processKey);
  }
}

/**
 * Check if a process is running for a channel/thread
 */
export function isProcessRunning(channelId: string, threadId: string | null): boolean {
  const processKey = getProcessKey(channelId, threadId);
  return activeProcesses.has(processKey);
}

/**
 * Kill an active process
 */
export function killProcess(channelId: string, threadId: string | null): boolean {
  const processKey = getProcessKey(channelId, threadId);
  const process = activeProcesses.get(processKey);

  if (process) {
    process.kill();
    activeProcesses.delete(processKey);
    return true;
  }

  return false;
}

/**
 * Get count of active processes
 */
export function getActiveProcessCount(): number {
  return activeProcesses.size;
}
