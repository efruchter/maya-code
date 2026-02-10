import { ClaudeProcess } from './claude/process.js';
import { CodexProcess } from './codex/process.js';
import { BackendProcess, BackendProcessResult } from './types.js';
import { getOrCreateSession, incrementMessageCount, addCost, getGlobalModel } from '../storage/sessions.js';
import { getProjectDirectory } from '../storage/directories.js';
import { config } from '../config.js';
import { detectBackend } from '../models.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import fsPromises from 'fs/promises';
import pathModule from 'path';

export type { BackendProcessResult } from './types.js';
export type { ScheduledCallback } from './types.js';

export interface RunOptions {
  channelId: string;
  channelName: string;
  threadId: string | null;
  prompt: string;
  continueSession?: boolean;
  isHeartbeat?: boolean;
  imageInputs?: string[];
  onTextUpdate?: (text: string) => void;
}

// Prompt cache — loaded once from prompts/*.md, falls back to defaults
let cachedSystemPrompt: string | null = null;
let cachedHeartbeatAddition: string | null = null;

const DEFAULT_SYSTEM_PROMPT = `You are running inside a Discord channel. Your text responses will be posted as messages.`;
const DEFAULT_HEARTBEAT_ADDITION = `This message is from an automated heartbeat timer, not a human. You are running autonomously. Read HEARTBEAT.md and do the work described there. Update it when done.`;

async function loadPrompt(filename: string, fallback: string): Promise<string> {
  try {
    const filePath = pathModule.join(config.promptsDirectory, filename);
    return await fsPromises.readFile(filePath, 'utf-8');
  } catch {
    logger.warn(`Prompt file ${filename} not found, using default`);
    return fallback;
  }
}

async function getSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt === null) {
    cachedSystemPrompt = await loadPrompt('system.md', DEFAULT_SYSTEM_PROMPT);
  }
  return cachedSystemPrompt;
}

async function getHeartbeatAddition(): Promise<string> {
  if (cachedHeartbeatAddition === null) {
    cachedHeartbeatAddition = await loadPrompt('heartbeat.md', DEFAULT_HEARTBEAT_ADDITION);
  }
  return cachedHeartbeatAddition;
}

// Track active processes by session key
const activeProcesses = new Map<string, BackendProcess>();

// Queue: per-channel promise chain so messages run sequentially
const processQueues = new Map<string, Promise<unknown>>();

function getProcessKey(channelId: string, threadId: string | null): string {
  return `${channelId}-${threadId || 'main'}`;
}

/**
 * Get the current active model (from state.json override or .env default).
 */
async function getActiveModel(): Promise<string> {
  const globalModel = await getGlobalModel();
  return globalModel || config.defaultModel;
}

/**
 * Run a backend CLI for a channel/thread.
 * Automatically picks Claude or Codex based on the current model.
 */
export function runClaude(options: RunOptions): Promise<BackendProcessResult> {
  const processKey = getProcessKey(options.channelId, options.threadId);

  const pending = processQueues.get(processKey) || Promise.resolve();
  const next = pending.then(() => runBackendImmediate(options)).catch((err) => {
    throw err;
  });

  processQueues.set(processKey, next.catch(() => {}));

  return next;
}

async function runBackendImmediate(options: RunOptions): Promise<BackendProcessResult> {
  const { channelId, channelName, threadId, prompt, continueSession, isHeartbeat, imageInputs, onTextUpdate } = options;
  const processKey = getProcessKey(channelId, threadId);

  const session = await getOrCreateSession(channelId, threadId, channelName);
  const workingDirectory = await getProjectDirectory(channelName);

  // Resolve which model + backend to use
  const model = await getActiveModel();
  const backend = detectBackend(model);

  const heartbeatSessionId = isHeartbeat ? uuidv4() : null;
  const sessionId = heartbeatSessionId || session.sessionId;
  const shouldContinue = isHeartbeat ? false : (continueSession || session.messageCount > 0);

  logger.info('Starting backend process', {
    backend,
    model,
    sessionId,
    channelName,
    workingDirectory,
    isHeartbeat: !!isHeartbeat,
  });

  let systemPrompt = await getSystemPrompt();
  if (isHeartbeat) {
    systemPrompt += '\n\n' + await getHeartbeatAddition();
  }

  const processOptions = {
    sessionId,
    workingDirectory,
    prompt,
    continueSession: shouldContinue,
    appendSystemPrompt: systemPrompt,
    model,
    planMode: !isHeartbeat && session.planMode,
    imageInputs,
  };

  // Create the right backend process
  const proc: BackendProcess = backend === 'codex'
    ? new CodexProcess(processOptions)
    : new ClaudeProcess(processOptions);

  activeProcesses.set(processKey, proc);

  if (onTextUpdate) {
    proc.on('text', onTextUpdate);
  }

  try {
    const result = await proc.run();
    await incrementMessageCount(channelId, threadId);
    if (result.costUsd > 0) {
      await addCost(channelId, threadId, result.costUsd);
    }
    return result;
  } finally {
    activeProcesses.delete(processKey);
  }
}

export function isProcessRunning(channelId: string, threadId: string | null): boolean {
  const processKey = getProcessKey(channelId, threadId);
  return activeProcesses.has(processKey);
}

export function killProcess(channelId: string, threadId: string | null): boolean {
  const processKey = getProcessKey(channelId, threadId);
  const proc = activeProcesses.get(processKey);

  if (proc) {
    proc.kill();
    activeProcesses.delete(processKey);
    return true;
  }

  return false;
}

export function getActiveProcessCount(): number {
  return activeProcesses.size;
}
