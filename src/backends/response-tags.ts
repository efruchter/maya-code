import { ScheduledCallback } from './types.js';

/**
 * Parse a time duration string like "30m", "2h", "1h30m", "90s" into milliseconds.
 */
export function parseDelay(delayStr: string): number | null {
  const str = delayStr.trim().toLowerCase();
  let totalMs = 0;
  let matched = false;

  const regex = /(\d+)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)/g;
  let match;
  while ((match = regex.exec(str)) !== null) {
    const value = parseInt(match[1]);
    const unit = match[2][0];
    if (unit === 'h') totalMs += value * 60 * 60 * 1000;
    else if (unit === 'm') totalMs += value * 60 * 1000;
    else if (unit === 's') totalMs += value * 1000;
    matched = true;
  }

  if (!matched && /^\d+$/.test(str)) {
    totalMs = parseInt(str) * 60 * 1000;
    matched = true;
  }

  return matched && totalMs > 0 ? totalMs : null;
}

/**
 * Extract special tags from response text:
 * - [UPLOAD: path] tags for file attachments
 * - ![alt](path) and ![[path]] markdown images for local file attachments
 * - [CALLBACK: delay: prompt] for scheduled one-shot callbacks
 * Returns cleaned text, file paths, and scheduled callbacks.
 */
export function extractResponseTags(text: string): { cleanText: string; uploadFiles: string[]; callbacks: ScheduledCallback[] } {
  const uploadFiles: string[] = [];
  const callbacks: ScheduledCallback[] = [];

  let cleanText = text.replace(/\[CALLBACK:\s*([^:]+?):\s*(.+?)\]/g, (_match, delayStr: string, prompt: string) => {
    const delayMs = parseDelay(delayStr);
    if (delayMs) {
      callbacks.push({ delayMs, prompt: prompt.trim() });
    }
    return '';
  });

  cleanText = cleanText.replace(/\[UPLOAD:\s*(.+?)\]/g, (_match, filePath: string) => {
    uploadFiles.push(filePath.trim());
    return '';
  });

  cleanText = cleanText.replace(/!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g, (_match, alt: string, filePath: string) => {
    uploadFiles.push(filePath.trim());
    return alt ? `*${alt}*` : '';
  });

  cleanText = cleanText.replace(/!\[\[([^\]]+)\]\]/g, (_match, filePath: string) => {
    uploadFiles.push(filePath.trim());
    return '';
  });

  return { cleanText: cleanText.trim(), uploadFiles, callbacks };
}
