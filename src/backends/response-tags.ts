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
 * Check if a string looks like a local file path (not a URL).
 */
function isLocalPath(str: string): boolean {
  const trimmed = str.trim();
  // Skip URLs
  if (/^https?:\/\//i.test(trimmed)) return false;
  // Absolute or relative path
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return true;
  // Has a file extension (word.ext pattern)
  if (/\.\w{1,10}$/.test(trimmed)) return true;
  return false;
}

/**
 * Extract special tags and file references from response text.
 *
 * Supported patterns:
 * - [UPLOAD: path]              — explicit upload tag
 * - ![alt](path)                — markdown image
 * - ![alt](path "title")        — markdown image with title
 * - ![[path]]                   — wiki-style image embed
 * - [text](path)                — markdown link to local file
 * - [[path]]                    — wiki-style link
 * - <img src="path" ...>        — HTML image tag
 * - [CALLBACK: delay: prompt]   — scheduled callback
 *
 * URLs (http/https) are left as-is — only local file paths are extracted.
 * If workingDirectory is provided, relative paths are resolved against it.
 */
export function extractResponseTags(text: string, workingDirectory?: string): { cleanText: string; uploadFiles: string[]; callbacks: ScheduledCallback[] } {
  const uploadFiles: string[] = [];
  const callbacks: ScheduledCallback[] = [];

  function addFile(filePath: string): void {
    let resolved = filePath.trim();
    if (workingDirectory && !resolved.startsWith('/')) {
      resolved = workingDirectory + '/' + resolved;
    }
    // Deduplicate
    if (!uploadFiles.includes(resolved)) {
      uploadFiles.push(resolved);
    }
  }

  // First pass: extract callbacks (before other patterns to avoid conflicts)
  let cleanText = text.replace(/\[CALLBACK:\s*([^:]+?):\s*(.+?)\]/g, (_match, delayStr: string, prompt: string) => {
    const delayMs = parseDelay(delayStr);
    if (delayMs) {
      callbacks.push({ delayMs, prompt: prompt.trim() });
    }
    return '';
  });

  // [UPLOAD: path/to/file]
  cleanText = cleanText.replace(/\[UPLOAD:\s*(.+?)\]/g, (_match, filePath: string) => {
    addFile(filePath);
    return '';
  });

  // ![alt](path) or ![alt](path "title") — markdown image, skip URLs
  cleanText = cleanText.replace(/!\[([^\]]*)\]\((?!https?:\/\/)([^)"]+?)(?:\s+"[^"]*")?\)/g, (_match, alt: string, filePath: string) => {
    addFile(filePath);
    return alt ? `*${alt}*` : '';
  });

  // ![[path]] — wiki-style image embed
  cleanText = cleanText.replace(/!\[\[([^\]]+)\]\]/g, (_match, filePath: string) => {
    addFile(filePath);
    return '';
  });

  // [[path]] — wiki-style link (without !)
  cleanText = cleanText.replace(/(?<!!)\[\[([^\]]+)\]\]/g, (_match, filePath: string) => {
    if (isLocalPath(filePath)) {
      addFile(filePath);
      return '';
    }
    return _match;
  });

  // [text](path) — markdown link to local file, skip URLs
  // Must come after ![alt](path) to avoid double-matching
  cleanText = cleanText.replace(/(?<!!)\[([^\]]+)\]\((?!https?:\/\/)([^)"]+?)(?:\s+"[^"]*")?\)/g, (_match, linkText: string, filePath: string) => {
    if (isLocalPath(filePath)) {
      addFile(filePath);
      return linkText;
    }
    return _match;
  });

  // <img src="path"> or <img src='path'> — HTML image tags
  cleanText = cleanText.replace(/<img\s+[^>]*src=["'](?!https?:\/\/)([^"']+)["'][^>]*\/?>/gi, (_match, filePath: string) => {
    addFile(filePath);
    return '';
  });

  return { cleanText: cleanText.trim(), uploadFiles, callbacks };
}
