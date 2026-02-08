import {
  CommandInteraction,
  Message,
  TextChannel,
  ThreadChannel,
} from 'discord.js';
import { RateLimiter } from 'limiter';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const MAX_LENGTH = config.discord.maxMessageLength;

// Rate limiters per message for edits
const editLimiters = new Map<string, RateLimiter>();

/**
 * Get or create a rate limiter for message edits
 */
function getEditLimiter(messageId: string): RateLimiter {
  if (!editLimiters.has(messageId)) {
    const limiter = new RateLimiter({
      tokensPerInterval: config.rateLimit.editsPerMessage,
      interval: config.rateLimit.editsWindowMs,
    });
    editLimiters.set(messageId, limiter);

    // Clean up after window expires
    setTimeout(() => {
      editLimiters.delete(messageId);
    }, config.rateLimit.editsWindowMs * 2);
  }
  return editLimiters.get(messageId)!;
}

/**
 * Split text at safe boundaries (code blocks, newlines)
 */
export function splitMessage(text: string): string[] {
  if (text.length <= MAX_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitPoint = MAX_LENGTH;

    // Try to split at code block boundary
    const codeBlockEnd = remaining.lastIndexOf('\n```', MAX_LENGTH);
    if (codeBlockEnd > MAX_LENGTH / 2) {
      // Find the end of this code block line
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

    chunks.push(remaining.slice(0, splitPoint));
    remaining = remaining.slice(splitPoint);
  }

  return chunks;
}

/**
 * Fix unclosed code blocks in a chunk
 */
function fixCodeBlocks(text: string): string {
  const codeBlockMatches = text.match(/```/g) || [];
  if (codeBlockMatches.length % 2 !== 0) {
    return text + '\n```';
  }
  return text;
}

export class DiscordResponder {
  private interaction: CommandInteraction;
  private messages: Message[] = [];
  private currentText: string = '';
  private lastUpdateTime: number = 0;
  private updateDebounceMs: number = 500;
  private pendingUpdate: NodeJS.Timeout | null = null;

  constructor(interaction: CommandInteraction) {
    this.interaction = interaction;
  }

  /**
   * Send initial "thinking" message
   */
  async initialize(): Promise<void> {
    const reply = await this.interaction.editReply({
      content: '_Thinking..._',
    });
    this.messages.push(reply as Message);
  }

  /**
   * Update with streaming text
   */
  async updateText(text: string): Promise<void> {
    this.currentText = text;

    // Debounce updates
    const now = Date.now();
    if (now - this.lastUpdateTime < this.updateDebounceMs) {
      if (!this.pendingUpdate) {
        this.pendingUpdate = setTimeout(() => {
          this.pendingUpdate = null;
          this.doUpdate();
        }, this.updateDebounceMs);
      }
      return;
    }

    await this.doUpdate();
  }

  /**
   * Perform the actual update
   */
  private async doUpdate(): Promise<void> {
    this.lastUpdateTime = Date.now();

    if (!this.currentText) return;

    const chunks = splitMessage(this.currentText);

    try {
      // Update existing messages or create new ones
      for (let i = 0; i < chunks.length; i++) {
        const chunk = fixCodeBlocks(chunks[i]);

        if (i < this.messages.length) {
          // Update existing message with rate limiting
          const message = this.messages[i];
          const limiter = getEditLimiter(message.id);

          if (await limiter.tryRemoveTokens(1)) {
            if (i === 0) {
              await this.interaction.editReply({ content: chunk });
            } else {
              await message.edit({ content: chunk });
            }
          }
        } else {
          // Send new follow-up message
          const channel = this.interaction.channel as TextChannel | ThreadChannel;
          if (channel) {
            const newMessage = await channel.send({ content: chunk });
            this.messages.push(newMessage);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to update Discord message', error);
    }
  }

  /**
   * Finalize the response
   */
  async finalize(text: string): Promise<void> {
    // Cancel any pending updates
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate);
      this.pendingUpdate = null;
    }

    this.currentText = text;
    await this.doUpdate();
  }

  /**
   * Send error message
   */
  async sendError(error: string): Promise<void> {
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate);
      this.pendingUpdate = null;
    }

    const content = `**Error:** ${error}`;
    await this.interaction.editReply({ content });
  }
}
