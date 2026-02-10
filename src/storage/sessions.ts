import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMs: number;
  prompt: string;
}

export interface SessionData {
  sessionId: string;
  channelId: string;
  threadId: string | null;
  channelName: string;
  createdAt: string;
  messageCount: number;
  planMode?: boolean;
  heartbeat?: HeartbeatConfig;
  model?: string;
  totalCostUsd?: number;
}

interface StateData {
  sessions: Record<string, SessionData>;
  globalModel?: string;
}

/**
 * Generate session key from channel and thread IDs
 */
export function getSessionKey(channelId: string, threadId: string | null): string {
  return `${channelId}-${threadId || 'main'}`;
}

/**
 * Load state from disk
 */
async function loadState(): Promise<StateData> {
  try {
    const data = await fs.readFile(config.stateFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { sessions: {} };
  }
}

/**
 * Save state to disk
 */
async function saveState(state: StateData): Promise<void> {
  await fs.writeFile(config.stateFile, JSON.stringify(state, null, 2));
}

/**
 * Get or create a session for a channel/thread combination
 */
export async function getOrCreateSession(
  channelId: string,
  threadId: string | null,
  channelName: string
): Promise<SessionData> {
  const key = getSessionKey(channelId, threadId);
  const state = await loadState();

  if (state.sessions[key]) {
    return state.sessions[key];
  }

  const session: SessionData = {
    sessionId: uuidv4(),
    channelId,
    threadId,
    channelName,
    createdAt: new Date().toISOString(),
    messageCount: 0,
  };

  state.sessions[key] = session;
  await saveState(state);
  logger.info(`Created new session: ${session.sessionId}`, { key, channelName });

  return session;
}

/**
 * Get an existing session without creating one
 */
export async function getSession(
  channelId: string,
  threadId: string | null
): Promise<SessionData | null> {
  const key = getSessionKey(channelId, threadId);
  const state = await loadState();
  return state.sessions[key] || null;
}

/**
 * Update session message count
 */
export async function incrementMessageCount(
  channelId: string,
  threadId: string | null
): Promise<void> {
  const key = getSessionKey(channelId, threadId);
  const state = await loadState();

  if (state.sessions[key]) {
    state.sessions[key].messageCount++;
    await saveState(state);
  }
}

/**
 * Set plan mode for a session
 */
export async function setPlanMode(
  channelId: string,
  threadId: string | null,
  planMode: boolean
): Promise<boolean> {
  const key = getSessionKey(channelId, threadId);
  const state = await loadState();

  if (state.sessions[key]) {
    state.sessions[key].planMode = planMode;
    await saveState(state);
    logger.info(`Set plan mode to ${planMode} for session: ${key}`);
    return true;
  }

  return false;
}

/**
 * Set the global model (bot-wide).
 */
export async function setGlobalModel(model: string | undefined): Promise<void> {
  const state = await loadState();
  state.globalModel = model;
  await saveState(state);
  logger.info(`Set global model to ${model}`);
}

/**
 * Get the global model from persisted state (or undefined if not set).
 */
export async function getGlobalModel(): Promise<string | undefined> {
  const state = await loadState();
  return state.globalModel;
}

/**
 * Add cost to session total
 */
export async function addCost(
  channelId: string,
  threadId: string | null,
  costUsd: number
): Promise<void> {
  const key = getSessionKey(channelId, threadId);
  const state = await loadState();

  if (state.sessions[key]) {
    state.sessions[key].totalCostUsd = (state.sessions[key].totalCostUsd || 0) + costUsd;
    await saveState(state);
  }
}

/**
 * Set heartbeat config for a session
 */
export async function setHeartbeat(
  channelId: string,
  threadId: string | null,
  heartbeat: HeartbeatConfig | undefined
): Promise<boolean> {
  const key = getSessionKey(channelId, threadId);
  const state = await loadState();

  if (state.sessions[key]) {
    state.sessions[key].heartbeat = heartbeat;
    await saveState(state);
    logger.info(`Set heartbeat for session: ${key}`, { heartbeat });
    return true;
  }

  return false;
}

/**
 * Clear (delete) a session
 */
export async function clearSession(
  channelId: string,
  threadId: string | null
): Promise<boolean> {
  const key = getSessionKey(channelId, threadId);
  const state = await loadState();

  if (state.sessions[key]) {
    delete state.sessions[key];
    await saveState(state);
    logger.info(`Cleared session: ${key}`);
    return true;
  }

  return false;
}

/**
 * Get all active sessions
 */
export async function getAllSessions(): Promise<SessionData[]> {
  const state = await loadState();
  return Object.values(state.sessions);
}
