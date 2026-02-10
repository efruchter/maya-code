import { config } from '../config.js';

const MAX_LENGTH = config.discord.maxMessageLength;

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
