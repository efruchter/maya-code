import { logger } from '../utils/logger.js';

export interface SystemEvent {
  type: 'system';
  subtype: 'init';
  session_id: string;
  cwd: string;
}

export interface AssistantEvent {
  type: 'assistant';
  message: {
    content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; name: string; input: Record<string, unknown> }>;
  };
  session_id: string;
}

export interface ResultEvent {
  type: 'result';
  subtype: 'success' | 'error';
  is_error: boolean;
  duration_ms: number;
  total_cost_usd: number;
  result: string;
  session_id: string;
}

export type StreamEvent = SystemEvent | AssistantEvent | ResultEvent | { type: string };

/**
 * Parse a stream-json line from Claude CLI
 */
export function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as StreamEvent;
  } catch (e) {
    logger.warn(`Failed to parse stream line: ${trimmed.slice(0, 100)}`);
    return null;
  }
}

/**
 * Common image file extensions
 */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];

/**
 * Check if a file path is an image
 */
export function isImageFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Accumulates text and tracks file outputs from stream events
 */
export class StreamAccumulator {
  private text: string = '';
  private result: ResultEvent | null = null;
  private error: string | null = null;
  private createdFiles: string[] = [];
  private sessionId: string | null = null;

  processEvent(event: StreamEvent): void {
    switch (event.type) {
      case 'system':
        if ('session_id' in event) {
          this.sessionId = event.session_id;
        }
        break;

      case 'assistant':
        if ('message' in event && event.message.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') {
              this.text = block.text;
            } else if (block.type === 'tool_use') {
              // Track file writes
              if (block.name === 'Write' || block.name === 'Edit') {
                const input = block.input as { file_path?: string };
                if (input.file_path && !this.createdFiles.includes(input.file_path)) {
                  this.createdFiles.push(input.file_path);
                  logger.debug(`Tracked file output: ${input.file_path}`);
                }
              }
            }
          }
        }
        break;

      case 'result':
        if ('result' in event) {
          this.result = event as ResultEvent;
          // Use the result text as final text
          if (event.result) {
            this.text = event.result;
          }
          if (event.is_error) {
            this.error = event.result;
          }
        }
        break;
    }
  }

  getText(): string {
    return this.text;
  }

  getResult(): ResultEvent | null {
    return this.result;
  }

  getError(): string | null {
    return this.error;
  }

  hasError(): boolean {
    return this.error !== null;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get list of files that were created/written during the session
   */
  getCreatedFiles(): string[] {
    return [...this.createdFiles];
  }

  /**
   * Get image files from created files
   */
  getImageFiles(): string[] {
    return this.createdFiles.filter(isImageFile);
  }
}
