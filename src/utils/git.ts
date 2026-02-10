import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';

const exec = promisify(execFile);

/**
 * Ensure a directory has a git repo initialized.
 * If not, initializes one and makes an initial commit.
 */
export async function ensureGitRepo(cwd: string): Promise<void> {
  try {
    await exec('git', ['rev-parse', '--git-dir'], { cwd });
  } catch {
    // No git repo — initialize one
    logger.info(`Initializing git repo in ${cwd}`);
    await exec('git', ['init'], { cwd });
    await exec('git', ['add', '-A'], { cwd });
    await exec('git', [
      'commit', '--allow-empty', '-m', 'Initial commit (auto-created by Maya Code)',
      '--author', 'Maya Code <maya@bot>',
    ], { cwd });
  }
}

/**
 * Auto-commit all changes in the working directory.
 * Used to snapshot state before/after Claude runs.
 */
export async function autoCommit(cwd: string, message: string): Promise<boolean> {
  try {
    await ensureGitRepo(cwd);

    // Check if there are any changes to commit
    const { stdout: status } = await exec('git', ['status', '--porcelain'], { cwd });
    if (!status.trim()) return false;

    await exec('git', ['add', '-A'], { cwd });
    await exec('git', [
      'commit', '-m', message,
      '--author', 'Maya Code <maya@bot>',
    ], { cwd });
    return true;
  } catch (error) {
    logger.warn('Auto-commit failed', { cwd, error });
    return false;
  }
}

/**
 * Get a compact diff summary of uncommitted changes.
 * Returns a formatted string suitable for Discord, or null if no changes.
 */
export async function getCompactDiff(cwd: string): Promise<string | null> {
  try {
    await ensureGitRepo(cwd);

    // Stage everything so we can diff against HEAD
    const { stdout: status } = await exec('git', ['status', '--porcelain'], { cwd });
    if (!status.trim()) return null;

    await exec('git', ['add', '-A'], { cwd });

    // Get the diff stat (file summary)
    const { stdout: diffStat } = await exec('git', ['diff', '--cached', '--stat'], { cwd });

    // Get a compact patch (limited to avoid huge output)
    const { stdout: diffPatch } = await exec('git', ['diff', '--cached', '--no-color', '-U2'], {
      cwd,
      maxBuffer: 1024 * 64,
    });

    // Reset staging (we just wanted to see the diff, not commit)
    await exec('git', ['reset', 'HEAD'], { cwd });

    if (!diffStat.trim()) return null;

    // Truncate the patch if too long for Discord
    const maxPatchLen = 1500;
    let patch = diffPatch;
    if (patch.length > maxPatchLen) {
      patch = patch.slice(0, maxPatchLen) + '\n... (truncated)';
    }

    return `**Changes:**\n\`\`\`\n${diffStat.trim()}\n\`\`\`\n\`\`\`diff\n${patch.trim()}\n\`\`\``;
  } catch (error) {
    logger.warn('Failed to get diff', { cwd, error });
    return null;
  }
}
