import { EventEmitter } from 'events';

export interface ScheduledCallback {
  delayMs: number;
  prompt: string;
}

export interface BackendProcessOptions {
  sessionId: string;
  workingDirectory: string;
  prompt: string;
  continueSession?: boolean;
  appendSystemPrompt?: string;
  model?: string;
  planMode?: boolean;
}

export interface BackendProcessResult {
  text: string;
  durationMs: number;
  costUsd: number;
  isError: boolean;
  sessionId: string;
  createdFiles: string[];
  imageFiles: string[];
  uploadFiles: string[];
  callbacks: ScheduledCallback[];
}

/**
 * Base class for backend processes (Claude, Codex, etc.)
 * Subclasses implement run() and kill().
 * Emits 'text' events for streaming updates.
 */
export abstract class BackendProcess extends EventEmitter {
  protected options: BackendProcessOptions;

  constructor(options: BackendProcessOptions) {
    super();
    this.options = options;
  }

  abstract run(): Promise<BackendProcessResult>;
  abstract getCurrentText(): string;
  abstract kill(): void;
}
