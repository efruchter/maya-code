import { logger } from '../utils/logger.js';

export type StreamEvent =
  | { type: 'assistant'; message: AssistantMessage }
  | { type: 'content_block_start'; index: number; content_block: ContentBlock }
  | { type: 'content_block_delta'; index: number; delta: ContentDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'result'; result: ResultData }
  | { type: 'error'; error: ErrorData };

export interface AssistantMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
}

export interface ContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
}

export interface ContentDelta {
  type: 'text_delta' | 'input_json_delta';
  text?: string;
  partial_json?: string;
}

export interface ResultData {
  duration_ms: number;
  duration_api_ms: number;
  total_cost_usd: number;
  is_error: boolean;
  num_turns: number;
  session_id: string;
}

export interface ErrorData {
  message: string;
  code?: string;
}

export interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

/**
 * Parse a stream-json line from Claude CLI
 */
export function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as StreamEvent;
  } catch (e) {
    logger.warn(`Failed to parse stream line: ${trimmed}`);
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
  private result: ResultData | null = null;
  private error: ErrorData | null = null;
  private currentToolUse: { index: number; name: string; inputJson: string } | null = null;
  private createdFiles: string[] = [];

  processEvent(event: StreamEvent): void {
    switch (event.type) {
      case 'content_block_start':
        if (event.content_block.type === 'tool_use' && event.content_block.name) {
          this.currentToolUse = {
            index: event.index,
            name: event.content_block.name,
            inputJson: '',
          };
        }
        break;

      case 'content_block_delta':
        if (event.delta.type === 'text_delta' && event.delta.text) {
          this.text += event.delta.text;
        } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
          if (this.currentToolUse && this.currentToolUse.index === event.index) {
            this.currentToolUse.inputJson += event.delta.partial_json;
          }
        }
        break;

      case 'content_block_stop':
        if (this.currentToolUse && this.currentToolUse.index === event.index) {
          this.processToolUse();
          this.currentToolUse = null;
        }
        break;

      case 'result':
        this.result = event.result;
        break;

      case 'error':
        this.error = event.error;
        break;
    }
  }

  private processToolUse(): void {
    if (!this.currentToolUse) return;

    const { name, inputJson } = this.currentToolUse;

    // Track files created by Write tool
    if (name === 'Write' || name === 'Edit') {
      try {
        const input = JSON.parse(inputJson);
        if (input.file_path && typeof input.file_path === 'string') {
          this.createdFiles.push(input.file_path);
          logger.debug(`Tracked file output: ${input.file_path}`);
        }
      } catch {
        // JSON may be incomplete, ignore
      }
    }
  }

  getText(): string {
    return this.text;
  }

  getResult(): ResultData | null {
    return this.result;
  }

  getError(): ErrorData | null {
    return this.error;
  }

  hasError(): boolean {
    return this.error !== null;
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
