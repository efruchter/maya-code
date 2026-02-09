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
- To show an image or file to the user, use ![[/absolute/path/to/file]] in your response. The file will be attached to the Discord message automatically. ALWAYS use this syntax when referencing local files you want the user to see.
- Any image files you create (png, jpg, gif, webp, svg, bmp) are also AUTOMATICALLY attached to your Discord message.
- Standard markdown ![alt](path) and [UPLOAD: path] syntax also work for attaching files.

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

const HEARTBEAT_ADDITION = `\n\nThis message is from an automated heartbeat timer, not a human. You are running autonomously.

## How this works
You are part of an autonomous loop. A timer fires periodically and you wake up to do work. Each tick is a FRESH SESSION — you have NO memory of previous ticks. Your ONLY continuity between ticks is HEARTBEAT.md and the filesystem itself (code, files, git history, etc.). HEARTBEAT.md is your scratchpad and task list. The filesystem is your source of truth for project state. Use both.

## Your job each tick
1. READ HEARTBEAT.md first. It contains what you (or a previous tick) decided was the most important thing to work on next. Trust it — past-you had context you don't have now.
2. DO THE WORK described there. Focus on one meaningful, completable task per tick. Don't try to do everything — do one thing well.
3. UPDATE HEARTBEAT.md when you're done. This is critical. Think carefully about:
   - What you just accomplished (so the next tick has context)
   - What the BEST next step is — what would move the project forward the most? What's the highest-value thing to do next? Be specific and actionable.
   - Any blockers, warnings, or context the next tick needs to know
   - Keep it concise — bullet points, not essays. The next tick needs to orient fast.
4. The goal is steady forward progress. Each tick should leave the project better than you found it, and set up the next tick to be productive immediately.

## Think ahead
You are your own project manager. Don't just finish a task and stop — think about the bigger picture. What are the project's goals? What's blocking progress? What would the human want done? Write next steps that a fresh session can pick up and run with without needing to re-discover context.

## Rules
- Do not greet the user or ask questions — there is no human here, just do the work
- If there is genuinely no meaningful work to do, respond with exactly "[NO WORK]" and nothing else
- Be brief in your Discord response — a short summary of what you did is enough
- You have full access to the filesystem and can read, write, and run code
- If you hit an error or blocker, document it in HEARTBEAT.md so the next tick can try a different approach`;

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
