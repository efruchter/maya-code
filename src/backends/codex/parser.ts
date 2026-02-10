import { logger } from '../../utils/logger.js';

/**
 * Codex JSONL event types
 */
export interface CodexThreadStarted {
  type: 'thread.started';
  thread_id: string;
}

export interface CodexTurnStarted {
  type: 'turn.started';
}

export interface CodexTurnCompleted {
  type: 'turn.completed';
  usage?: {
    input_tokens: number;
    cached_input_tokens?: number;
    output_tokens: number;
  };
}

export interface CodexTurnFailed {
  type: 'turn.failed';
  error?: string;
}

export interface CodexItemEvent {
  type: 'item.started' | 'item.updated' | 'item.completed';
  item: {
    id: string;
    type: string; // 'agent_message', 'command_execution', etc.
    text?: string;
    command?: string;
    status?: string;
    file_path?: string;
  };
}

export interface CodexErrorEvent {
  type: 'error';
  message?: string;
}

export type CodexStreamEvent =
  | CodexThreadStarted
  | CodexTurnStarted
  | CodexTurnCompleted
  | CodexTurnFailed
  | CodexItemEvent
  | CodexErrorEvent
  | { type: string };

/**
 * Parse a JSONL line from Codex CLI
 */
export function parseCodexLine(line: string): CodexStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as CodexStreamEvent;
  } catch {
    logger.warn(`Failed to parse Codex stream line: ${trimmed.slice(0, 100)}`);
    return null;
  }
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];

function isImageFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Accumulates text and tracks state from Codex JSONL events
 */
export class CodexStreamAccumulator {
  private text: string = '';
  private threadId: string | null = null;
  private error: string | null = null;
  private createdFiles: string[] = [];
  private usage: { inputTokens: number; outputTokens: number } = { inputTokens: 0, outputTokens: 0 };

  processEvent(event: CodexStreamEvent): void {
    switch (event.type) {
      case 'thread.started':
        if ('thread_id' in event) {
          this.threadId = event.thread_id;
        }
        break;

      case 'item.completed':
      case 'item.updated':
        if ('item' in event && event.item) {
          // Extract text from agent messages
          if (event.item.type === 'agent_message' && event.item.text) {
            this.text = event.item.text;
          }
          // Track file modifications
          if (event.item.file_path && !this.createdFiles.includes(event.item.file_path)) {
            this.createdFiles.push(event.item.file_path);
            logger.debug(`Tracked Codex file output: ${event.item.file_path}`);
          }
        }
        break;

      case 'turn.completed':
        if ('usage' in event && event.usage) {
          this.usage.inputTokens += event.usage.input_tokens || 0;
          this.usage.outputTokens += event.usage.output_tokens || 0;
        }
        break;

      case 'turn.failed':
        if ('error' in event && event.error) {
          this.error = typeof event.error === 'string' ? event.error : JSON.stringify(event.error);
        }
        break;

      case 'error':
        if ('message' in event) {
          this.error = (event as CodexErrorEvent).message || 'Unknown Codex error';
        }
        break;
    }
  }

  getText(): string {
    return this.text;
  }

  getThreadId(): string | null {
    return this.threadId;
  }

  getError(): string | null {
    return this.error;
  }

  getUsage(): { inputTokens: number; outputTokens: number } {
    return { ...this.usage };
  }

  getCreatedFiles(): string[] {
    return [...this.createdFiles];
  }

  getImageFiles(): string[] {
    return this.createdFiles.filter(isImageFile);
  }
}
