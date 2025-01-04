import { EventEmitter } from 'events';
import { ErrorHandler } from './errors/index.js';
import { rateLimiter } from './rate-limiting/RateLimiter.js';
import { circuitBreakers } from './circuit-breaker/index.js';
import { matchIntent } from '../services/ai/intents.js';
import { aiService } from '../services/ai/index.js';
import { contextManager } from '../services/ai/ContextManager.js';

export class UnifiedMessageHandler extends EventEmitter {
  constructor(bot, commandRegistry) {
    super();
    this.bot = bot;
    this.commandRegistry = commandRegistry;
    this.initialized = false;
    this.processedCallbacks = new Set();
    this.contextManager = contextManager;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      this.bot.on('message', async (msg) => {
        await circuitBreakers.executeWithBreaker('messages', async () => {
          const isLimited = await rateLimiter.isRateLimited(msg.from.id, 'message');
          if (isLimited) {
            await this.bot.sendMessage(msg.chat.id, '⚠️ Please slow down! Try again in a minute.');
            return;
          }
          await this.handleMessage(msg);
        });
      });

      this.bot.on('callback_query', async (query) => {
        const callbackId = `${query.from.id}:${query.data}:${Date.now()}`;
        if (this.processedCallbacks.has(callbackId)) return;
        
        this.processedCallbacks.add(callbackId);
        await this.handleCallback(query);
        
        // Cleanup old callback IDs
        setTimeout(() => this.processedCallbacks.delete(callbackId), 5000);
      });

      this.initialized = true;
      console.log('✅ UnifiedMessageHandler initialized');
    } catch (error) {
      console.error('❌ Error during UnifiedMessageHandler initialization:', error);
      throw error;
    }
  }

  async handleMessage(msg) {
    try {
      if (!msg.text) return;

      // Get conversation context
      const context = await this.contextManager.getContext(msg.from.id);
      const isReplyToBot = msg.reply_to_message?.from?.id === this.bot.id;
      const isKatzMention = msg.text.toLowerCase().includes('katz');

      // Check for command matches first
      const command = this.commandRegistry.findCommand(msg.text);
      if (command) {
        await command.execute(msg);
        return;
      }

      // Handle AI conversation if applicable
      if (isReplyToBot || isKatzMention || context.length > 0) {
        await this.handleAIResponse(msg, context);
        return;
      }

      // Check for intent matches
      const intent = matchIntent(msg.text);
      if (intent) {
        await this.handleAIResponse(msg, context, intent);
        return;
      }

      // Handle state-based input
      for (const cmd of this.commandRegistry.getCommands()) {
        if (cmd.handleInput && await cmd.handleInput(msg)) {
          return;
        }
      }
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, msg.chat.id);
    }
  }

  async handleAIResponse(msg, context, intent = null) {
    let loadingMsg = null;
    try {
      loadingMsg = await this.bot.sendMessage(
        msg.chat.id,
        '🤖 Processing your request...'
      );

      const response = await aiService.processCommand(
        msg.text,
        intent,
        msg.from.id,
        context
      );

      // Only try to delete if we have a loading message
      if (loadingMsg) {
        try {
          await this.bot.deleteMessage(msg.chat.id, loadingMsg.message_id);
        } catch (deleteError) {
          console.log('Non-critical error deleting loading message:', deleteError.message);
        }
      }

      // Send response with appropriate markup
      return await this.bot.sendMessage(msg.chat.id, response.text, {
        parse_mode: 'Markdown',
        reply_markup: {
          force_reply: true,
          selective: true
        }
      });
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, msg.chat.id);
    }
  }

  async handleCallback(query) {
    try {
      const handled = await this.commandRegistry.handleCallback(query);
      
      if (handled) {
        await this.bot.answerCallbackQuery(query.id);
      } else {
        console.warn('⚠️ Unhandled callback:', query.data);
        await this.bot.answerCallbackQuery(query.id, {
          text: '⚠️ Action not recognized.',
          show_alert: false
        });
      }
    } catch (error) {
      await this.bot.answerCallbackQuery(query.id, {
        text: '❌ An error occurred',
        show_alert: false
      });
      await ErrorHandler.handle(error, this.bot, query.message?.chat?.id);
    }
  }

  async handleAIActions(chatId, actions) {
    for (const action of actions) {
      try {
        switch (action.type) {
          case 'createAlert':
            await this.commandRegistry.findCommand('/pricealerts')
              ?.execute({ chat: { id: chatId }, action });
            break;
          case 'executeTrade':
            await this.commandRegistry.findCommand('/trade')
              ?.execute({ chat: { id: chatId }, action });
            break;
          case 'scanToken':
            await this.commandRegistry.findCommand('/scan')
              ?.execute({ chat: { id: chatId }, action });
            break;
          default:
            console.warn(`Unhandled AI action type: ${action.type}`);
        }
      } catch (error) {
        await ErrorHandler.handle(error, this.bot, chatId);
      }
    }
  }

  cleanup() {
    this.bot.removeAllListeners();
    this.removeAllListeners();
    this.processedCallbacks.clear();
    this.contextManager.cleanup();
    this.initialized = false;
  }
}