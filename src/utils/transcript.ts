import fs from 'fs/promises';
import path from 'path';
import { getProjectDirectory } from '../storage/directories.js';
import { logger } from './logger.js';

// Track which project dirs we've already ensured gitignore for
const gitignoreChecked = new Set<string>();

/**
 * Ensure a pattern is in the project's .gitignore.
 */
async function ensureGitignored(projectDir: string, pattern: string): Promise<void> {
  if (gitignoreChecked.has(projectDir)) return;
  gitignoreChecked.add(projectDir);

  const gitignorePath = path.join(projectDir, '.gitignore');
  try {
    const content = await fs.readFile(gitignorePath, 'utf-8');
    if (content.includes(pattern)) return;
    await fs.appendFile(gitignorePath, `\n${pattern}\n`);
  } catch {
    // No .gitignore yet — create one
    await fs.writeFile(gitignorePath, `${pattern}\n`);
  }
}

/**
 * Append a conversation exchange to the daily transcript file.
 * Files are stored in SESSIONS/YY/MM/DD.md within the project directory.
 */
export async function logTranscript(
  channelName: string,
  entry: { role: 'user' | 'assistant' | 'heartbeat' | 'callback'; author?: string; text: string }
): Promise<void> {
  try {
    const projectDir = await getProjectDirectory(channelName);
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const time = now.toLocaleTimeString('en-US', { hour12: false });

    const sessionsDir = path.join(projectDir, 'SESSIONS');
    const dir = path.join(sessionsDir, yy, mm);
    await fs.mkdir(dir, { recursive: true });

    // Ensure SESSIONS is gitignored in the project
    await ensureGitignored(projectDir, 'SESSIONS/');

    const filePath = path.join(dir, `${dd}.md`);
    const label = entry.role === 'user' && entry.author
      ? `**${entry.author}**`
      : `**${entry.role}**`;
    const line = `### ${label} — ${time}\n${entry.text}\n\n---\n\n`;

    await fs.appendFile(filePath, line);
  } catch (error) {
    logger.warn('Failed to write transcript', { channelName, error });
  }
}
