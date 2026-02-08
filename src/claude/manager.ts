import { ClaudeProcess, ClaudeProcessResult } from './process.js';
import { getOrCreateSession, incrementMessageCount, SessionData } from '../storage/sessions.js';
import { getProjectDirectory } from '../storage/directories.js';
import { logger } from '../utils/logger.js';

export interface RunOptions {
  channelId: string;
  channelName: string;
  threadId: string | null;
  prompt: string;
  continueSession?: boolean;
  onTextUpdate?: (text: string) => void;
}

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
  const { channelId, channelName, threadId, prompt, continueSession, onTextUpdate } = options;
  const processKey = getProcessKey(channelId, threadId);

  // Get or create session
  const session = await getOrCreateSession(channelId, threadId, channelName);

  // Get project directory
  const workingDirectory = await getProjectDirectory(channelName);

  logger.info('Starting Claude process', {
    sessionId: session.sessionId,
    channelName,
    workingDirectory,
  });

  // Automatically continue if session has been used before
  const shouldContinue = continueSession || session.messageCount > 0;

  const process = new ClaudeProcess({
    sessionId: session.sessionId,
    workingDirectory,
    prompt,
    continueSession: shouldContinue,
  });

  activeProcesses.set(processKey, process);

  // Set up text streaming callback
  if (onTextUpdate) {
    process.on('text', onTextUpdate);
  }

  try {
    const result = await process.run();
    await incrementMessageCount(channelId, threadId);
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
