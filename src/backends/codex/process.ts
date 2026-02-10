import { spawn, ChildProcess } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import { BackendProcess, BackendProcessOptions, BackendProcessResult } from '../types.js';
import { extractResponseTags } from '../response-tags.js';
import { CodexStreamAccumulator, parseCodexLine } from './parser.js';

export class CodexProcess extends BackendProcess {
  private process: ChildProcess | null = null;
  private accumulator: CodexStreamAccumulator;
  private tmpPromptFile: string | null = null;

  constructor(options: BackendProcessOptions) {
    super(options);
    this.accumulator = new CodexStreamAccumulator();
  }

  private async buildArgs(): Promise<string[]> {
    const args = ['exec'];

    // JSON streaming
    args.push('--json');

    // Permission mode
    if (this.options.planMode) {
      args.push('--full-auto');
    } else {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    }

    // Working directory
    args.push('--cd', this.options.workingDirectory);

    // Model
    if (this.options.model) {
      args.push('-m', this.options.model);
    }

    // System prompt — write to temp file since Codex has no --append-system-prompt
    if (this.options.appendSystemPrompt) {
      this.tmpPromptFile = path.join(os.tmpdir(), `maya-codex-${uuidv4()}.md`);
      await fs.writeFile(this.tmpPromptFile, this.options.appendSystemPrompt);
      args.push('--config', `model_instructions_file=${this.tmpPromptFile}`);
    }

    // Session resume
    if (this.options.continueSession) {
      args.push('resume', this.options.sessionId);
    }

    // Prompt
    args.push(this.options.prompt);

    return args;
  }

  async run(): Promise<BackendProcessResult> {
    const args = await this.buildArgs();

    return new Promise((resolve, reject) => {
      logger.debug('Spawning Codex CLI', {
        args: args.map(a => a.length > 100 ? a.slice(0, 100) + '...' : a),
        cwd: this.options.workingDirectory,
      });

      this.process = spawn('codex', args, {
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let buffer = '';

      logger.info(`Codex CLI spawned, pid: ${this.process.pid}`);

      this.process.stdout?.on('data', (chunk: Buffer) => {
        const raw = chunk.toString();
        logger.debug(`stdout chunk (${raw.length} bytes)`);
        buffer += raw;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const event = parseCodexLine(line);
          if (event) {
            logger.debug(`Parsed Codex event: type=${event.type}`);
            this.accumulator.processEvent(event);

            if (event.type === 'item.completed' || event.type === 'item.updated') {
              this.emit('text', this.accumulator.getText());
            }
          }
        }
      });

      this.process.stderr?.on('data', (chunk: Buffer) => {
        logger.warn(`Codex CLI stderr: ${chunk.toString()}`);
      });

      this.process.on('error', (err) => {
        logger.error('Codex CLI process error', err);
        this.cleanup();
        reject(err);
      });

      this.process.on('close', (code) => {
        logger.info(`Codex CLI exited with code ${code}, accumulated text length: ${this.accumulator.getText().length}`);

        // Process remaining buffer
        if (buffer) {
          const event = parseCodexLine(buffer);
          if (event) {
            this.accumulator.processEvent(event);
          }
        }

        this.cleanup();

        const error = this.accumulator.getError();
        const createdFiles = this.accumulator.getCreatedFiles();
        const imageFiles = this.accumulator.getImageFiles();
        const threadId = this.accumulator.getThreadId();
        const usage = this.accumulator.getUsage();

        if (error) {
          logger.error('Codex CLI returned error', { error });
          resolve({
            text: error,
            durationMs: 0,
            costUsd: 0,
            isError: true,
            sessionId: threadId || this.options.sessionId,
            createdFiles,
            imageFiles,
            uploadFiles: [],
            callbacks: [],
          });
          return;
        }

        if (code !== 0 && !this.accumulator.getText()) {
          reject(new Error(`Codex CLI exited with code ${code}`));
          return;
        }

        const { cleanText, uploadFiles, callbacks } = extractResponseTags(this.accumulator.getText());

        resolve({
          text: cleanText,
          durationMs: 0, // Codex doesn't report duration
          costUsd: 0,    // Codex reports tokens, not USD
          isError: false,
          sessionId: threadId || this.options.sessionId,
          createdFiles,
          imageFiles,
          uploadFiles,
          callbacks,
        });
      });
    });
  }

  getCurrentText(): string {
    return this.accumulator.getText();
  }

  kill(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
    }
    this.cleanup();
  }

  private async cleanup(): Promise<void> {
    if (this.tmpPromptFile) {
      fs.unlink(this.tmpPromptFile).catch(() => {});
      this.tmpPromptFile = null;
    }
  }
}
