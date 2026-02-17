import { AttachmentBuilder } from 'discord.js';
import { config } from '../config.js';
import { logger } from './logger.js';
import fs from 'fs/promises';
import path from 'path';

const MAX_LENGTH = config.discord.maxMessageLength;
const MAX_ATTACHMENTS = 10;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB Discord limit

/**
 * Split text at safe boundaries for Discord's 2000 char limit.
 * Handles code block continuation — if a split happens inside an open
 * code block, the chunk gets closing backticks and the next chunk
 * reopens with the same language tag.
 */
export function splitMessage(text: string): string[] {
  if (text.length <= MAX_LENGTH) {
    return [text];
  }

  const rawChunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      rawChunks.push(remaining);
      break;
    }

    let splitPoint = MAX_LENGTH;

    // Try to split at code block boundary
    const codeBlockEnd = remaining.lastIndexOf('\n```', MAX_LENGTH);
    if (codeBlockEnd > MAX_LENGTH / 2) {
      const lineEnd = remaining.indexOf('\n', codeBlockEnd + 1);
      if (lineEnd > 0 && lineEnd < MAX_LENGTH) {
        splitPoint = lineEnd + 1;
      }
    } else {
      // Try to split at newline
      const newlinePos = remaining.lastIndexOf('\n', MAX_LENGTH);
      if (newlinePos > MAX_LENGTH / 2) {
        splitPoint = newlinePos + 1;
      } else {
        // Try to split at space
        const spacePos = remaining.lastIndexOf(' ', MAX_LENGTH);
        if (spacePos > MAX_LENGTH / 2) {
          splitPoint = spacePos + 1;
        }
      }
    }

    rawChunks.push(remaining.slice(0, splitPoint));
    remaining = remaining.slice(splitPoint);
  }

  // Fix code block continuation across chunks
  return fixCodeBlockContinuation(rawChunks);
}

/**
 * If a chunk ends with an unclosed code block, close it and reopen
 * in the next chunk with the same language tag.
 */
function fixCodeBlockContinuation(chunks: string[]): string[] {
  const result: string[] = [];
  let openLang: string | null = null; // language tag from an unclosed block

  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];

    // If previous chunk left an open code block, reopen it
    if (openLang !== null) {
      chunk = '```' + openLang + '\n' + chunk;
      openLang = null;
    }

    // Check if this chunk has an unclosed code block
    const lang = getUnclosedCodeBlockLang(chunk);
    if (lang !== null && i < chunks.length - 1) {
      // Close the block at the end of this chunk
      chunk = chunk + '\n```';
      openLang = lang;
    }

    result.push(chunk);
  }

  return result;
}

/**
 * Returns the language tag of an unclosed code block, or null if all blocks are closed.
 * An odd number of ``` means there's an unclosed block.
 */
function getUnclosedCodeBlockLang(text: string): string | null {
  const regex = /```(\w*)/g;
  let count = 0;
  let lastLang = '';
  let match;

  while ((match = regex.exec(text)) !== null) {
    count++;
    // Odd occurrences are opening blocks (have language tags)
    // Even occurrences are closing blocks
    if (count % 2 === 1) {
      lastLang = match[1] || '';
    }
  }

  // Odd count means unclosed block
  return count % 2 === 1 ? lastLang : null;
}

/**
 * Split attachments into batches of 10 (Discord's per-message limit).
 */
export function batchAttachments(attachments: AttachmentBuilder[]): AttachmentBuilder[][] {
  const batches: AttachmentBuilder[][] = [];
  for (let i = 0; i < attachments.length; i += MAX_ATTACHMENTS) {
    batches.push(attachments.slice(i, i + MAX_ATTACHMENTS));
  }
  return batches;
}

/**
 * Create Discord attachments for files that exist and are under the size limit.
 * Returns { attachments, skipped } where skipped contains filenames that were too large.
 */
export async function createAttachments(filePaths: string[]): Promise<{ attachments: AttachmentBuilder[]; skipped: string[] }> {
  const attachments: AttachmentBuilder[] = [];
  const skipped: string[] = [];

  for (const filePath of filePaths) {
    try {
      const stat = await fs.stat(filePath);
      const fileName = path.basename(filePath);

      if (stat.size > MAX_FILE_SIZE) {
        const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
        logger.warn(`Skipping oversized attachment: ${fileName} (${sizeMB}MB)`);
        skipped.push(`${fileName} (${sizeMB}MB)`);
        continue;
      }

      attachments.push(new AttachmentBuilder(filePath, { name: fileName }));
    } catch {
      logger.debug(`File not found for attachment: ${filePath}`);
    }
  }

  return { attachments, skipped };
}
