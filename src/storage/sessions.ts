import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface SessionData {
  sessionId: string;
  channelId: string;
  threadId: string | null;
  channelName: string;
  createdAt: string;
  messageCount: number;
}

interface StateData {
  sessions: Record<string, SessionData>;
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
