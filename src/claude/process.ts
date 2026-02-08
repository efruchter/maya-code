import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { parseStreamLine, StreamAccumulator } from './parser.js';
import { logger } from '../utils/logger.js';

export interface ClaudeProcessOptions {
  sessionId: string;
  workingDirectory: string;
  prompt: string;
  continueSession?: boolean;
  appendSystemPrompt?: string;
}

export interface ClaudeProcessResult {
  text: string;
  durationMs: number;
  costUsd: number;
  isError: boolean;
  sessionId: string;
  createdFiles: string[];
  imageFiles: string[];
  uploadFiles: string[];
}

/**
 * Extract [UPLOAD: path] tags from text.
 * Returns the cleaned text and list of file paths to upload.
 */
export function extractUploadTags(text: string): { cleanText: string; uploadFiles: string[] } {
  const uploadFiles: string[] = [];
  const cleanText = text.replace(/\[UPLOAD:\s*(.+?)\]/g, (_match, filePath: string) => {
    uploadFiles.push(filePath.trim());
    return '';
  });
  return { cleanText: cleanText.trim(), uploadFiles };
}

export class ClaudeProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private accumulator: StreamAccumulator;
  private options: ClaudeProcessOptions;

  constructor(options: ClaudeProcessOptions) {
    super();
    this.options = options;
    this.accumulator = new StreamAccumulator();
  }

  /**
   * Build the CLI arguments
   */
  private buildArgs(): string[] {
    const args = [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
    ];

    args.push('--dangerously-skip-permissions');

    if (this.options.appendSystemPrompt) {
      args.push('--append-system-prompt', this.options.appendSystemPrompt);
    }

    if (this.options.continueSession) {
      // Resume existing session by ID
      args.push('--resume', this.options.sessionId);
    } else {
      // Start new session with ID
      args.push('--session-id', this.options.sessionId);
    }

    args.push(this.options.prompt);

    return args;
  }

  /**
   * Start the Claude CLI process
   */
  async run(): Promise<ClaudeProcessResult> {
    return new Promise((resolve, reject) => {
      const args = this.buildArgs();
      logger.debug('Spawning Claude CLI', {
        args: args.map(a => a.length > 100 ? a.slice(0, 100) + '...' : a),
        cwd: this.options.workingDirectory
      });

      this.process = spawn('claude', args, {
        cwd: this.options.workingDirectory,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let buffer = '';

      logger.info(`Claude CLI spawned, pid: ${this.process.pid}`);

      this.process.stdout?.on('data', (chunk: Buffer) => {
        const raw = chunk.toString();
        logger.debug(`stdout chunk (${raw.length} bytes)`);
        buffer += raw;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const event = parseStreamLine(line);
          if (event) {
            logger.debug(`Parsed event: type=${event.type}`);
            this.accumulator.processEvent(event);
            this.emit('event', event);

            // Emit text updates for streaming
            if (event.type === 'assistant') {
              this.emit('text', this.accumulator.getText());
            }
          }
        }
      });

      this.process.stderr?.on('data', (chunk: Buffer) => {
        logger.warn(`Claude CLI stderr: ${chunk.toString()}`);
      });

      this.process.on('error', (err) => {
        logger.error('Claude CLI process error', err);
        reject(err);
      });

      this.process.on('close', (code) => {
        logger.info(`Claude CLI exited with code ${code}, accumulated text length: ${this.accumulator.getText().length}`);
        // Process any remaining buffer
        if (buffer) {
          const event = parseStreamLine(buffer);
          if (event) {
            this.accumulator.processEvent(event);
          }
        }

        const result = this.accumulator.getResult();
        const error = this.accumulator.getError();
        const createdFiles = this.accumulator.getCreatedFiles();
        const imageFiles = this.accumulator.getImageFiles();

        if (error) {
          logger.error('Claude CLI returned error', { error });
          resolve({
            text: error,
            durationMs: result?.duration_ms || 0,
            costUsd: result?.total_cost_usd || 0,
            isError: true,
            sessionId: this.options.sessionId,
            createdFiles,
            imageFiles,
            uploadFiles: [],
          });
          return;
        }

        if (code !== 0 && !this.accumulator.getText()) {
          reject(new Error(`Claude CLI exited with code ${code}`));
          return;
        }

        // Extract [UPLOAD: path] tags from response text
        const { cleanText, uploadFiles } = extractUploadTags(this.accumulator.getText());

        resolve({
          text: cleanText,
          durationMs: result?.duration_ms || 0,
          costUsd: result?.total_cost_usd || 0,
          isError: result?.is_error || false,
          sessionId: result?.session_id || this.options.sessionId,
          createdFiles,
          imageFiles,
          uploadFiles,
        });
      });
    });
  }

  /**
   * Get current accumulated text
   */
  getCurrentText(): string {
    return this.accumulator.getText();
  }

  /**
   * Kill the process
   */
  kill(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
    }
  }
}
