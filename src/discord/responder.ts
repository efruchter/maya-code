import {
  CommandInteraction,
  Message,
  TextChannel,
  ThreadChannel,
  AttachmentBuilder,
} from 'discord.js';
import Limiter from 'limiter';
const { RateLimiter } = Limiter;
type RateLimiterInstance = InstanceType<typeof RateLimiter>;
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { splitMessage } from '../utils/discord.js';

// Rate limiters per message for edits
const editLimiters = new Map<string, RateLimiterInstance>();

/**
 * Get or create a rate limiter for message edits
 */
function getEditLimiter(messageId: string): RateLimiterInstance {
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
        const chunk = chunks[i];

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
   * Finalize the response, optionally with file attachments
   */
  async finalize(text: string, attachments?: AttachmentBuilder[]): Promise<void> {
    // Cancel any pending updates
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate);
      this.pendingUpdate = null;
    }

    this.currentText = text;
    await this.doUpdate();

    // Send attachments as a follow-up if present
    if (attachments && attachments.length > 0) {
      try {
        const channel = this.interaction.channel as TextChannel | ThreadChannel;
        if (channel) {
          await channel.send({ files: attachments });
        }
      } catch (error) {
        logger.error('Failed to send attachments', error);
      }
    }
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
