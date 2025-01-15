import { EventEmitter } from 'events';
import { ErrorHandler } from './errors/index.js';
import { rateLimiter } from './rate-limiting/RateLimiter.js';
import { circuitBreakers } from './circuit-breaker/index.js';
import { messageProcessor } from '../services/ai/processors/UnifiedMessageProcessor.js';
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

      // Check for command matches first
      const command = this.commandRegistry.findCommand(msg.text);
      if (command) {
        await command.execute(msg);
        return;
      }

      // Process message through unified processor
      const mockContext = [
        { role: 'assistant', content: 'How can I help you?' },
        { role: 'user', content: 'Search the web for Solana tokens' },
      ];
      const result = await messageProcessor.processMessage(msg, mockContext);

      // Handle the response
      await this.sendResponse(msg.chat.id, result);

    } catch (error) {
      await ErrorHandler.handle(error, this.bot, msg.chat.id);
    }
  }

  async sendResponse(chatId, result) {
    try {
      // Basic validation
      if (!result) {
        throw new Error('No response data received');
      }
  
      // Ensure result has text content
      if (!result.text && !result.message) {
        console.warn('⚠️ No text content in result:', result);
        throw new Error('Response must contain text content');
      }
  
      // Use text or message field
      const content = result.text || result.message;
  
      // Add ASCII art header if result has a type
      const header = result.type ? this.getAsciiHeader(result.type) : null;
      const formattedText = header ? `${header}\n\n${content}` : content;
  
      // Send message with appropriate options
      await this.bot.sendMessage(chatId, formattedText, {
        parse_mode: result.parse_mode || 'Markdown',
        reply_markup: result.reply_markup,
        disable_web_page_preview: result.type !== 'search' // Enable previews only for search results
      });
  
    } catch (error) {
      console.error('Error sending response:', error);
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }
  
  getAsciiHeader(type) {
    const headers = {
      search: `
  ╔════════════════════════════════════╗
  ║        🛍️  KATZ STORE 🛍️          ║
  ╚════════════════════════════════════╝`,
      
      trade: `
  ╔════════════════════════════════════╗
  ║        💱 TRADE EXECUTED 💱       ║
  ╚════════════════════════════════════╝`,
      
      alert: `
  ╔════════════════════════════════════╗
  ║         ⚡ PRICE ALERT ⚡         ║
  ╚════════════════════════════════════╝`,
      
      error: `
  ╔════════════════════════════════════╗
  ║         ❌ ERROR OCCURRED ❌      ║
  ╚════════════════════════════════════╝`,
      
      chat: `
  ╔════════════════════════════════════╗
  ║            😼 KATZ! 😼            ║
  ╚════════════════════════════════════╝`
    };
  
    return headers[type] || null;
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

  cleanup() {
    this.bot.removeAllListeners();
    this.removeAllListeners();
    this.processedCallbacks.clear();
    this.contextManager.cleanup();
    this.initialized = false;
  }
}