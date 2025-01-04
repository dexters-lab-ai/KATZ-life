import OpenAI from 'openai';
import { config } from '../../core/config.js';
import { systemPrompts } from './prompts.js';
import { ErrorHandler } from '../../core/errors/index.js';
import { OpenAIErrorHandler } from './handlers/OpenAIErrorHandler.js';

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.isConnected = false;
    this.conversationHistory = new Map();
  }

  async testConnection() {
    try {
      await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 10,
      });
      this.isConnected = true;
      return true;
    } catch (error) {
      this.isConnected = false;
      error.name = 'OpenAIError';
      console.error('Failed to connect to OpenAI:', error);
      throw error;
    }
  }

  async generateAIResponse(input, purpose, retryCount = 0) {
    try {
      if (!this.isConnected) {
        await this.testConnection();
      }

      const messages = Array.isArray(input) ? input : this.prepareTextMessages(input, purpose);
      
      const response = await this.openai.chat.completions.create({
        model: this.getModel(purpose),
        messages,
        max_tokens: 500,
        temperature: this.getTemperature(purpose),
        timeout: 30000 // 30 second timeout
      });

      return response.choices[0].message.content;

    } catch (error) {
      const { shouldRetry, fallbackResponse } = await OpenAIErrorHandler.handleError(error, retryCount);
      
      if (shouldRetry) {
        return this.generateAIResponse(input, purpose, retryCount + 1);
      }

      if (fallbackResponse) {
        return fallbackResponse;
      }

      throw error;
    }
  }

  prepareTextMessages(text, purpose) {
    const messages = [{
      role: 'system',
      content: systemPrompts[purpose] || systemPrompts.general
    }];

    // Add user message
    messages.push({
      role: 'user',
      content: text
    });

    return messages;
  }

  getModel(purpose) {
    switch (purpose) {
      case 'image':
        return 'gpt-4-vision-preview';
      case 'pdf':
        return 'gpt-4';
      default:
        return 'gpt-3.5-turbo';
    }
  }

  getTemperature(purpose) {
    switch (purpose) {
      case 'intent_classification':
        return 0.3;
      case 'trading':
        return 0.5;
      default:
        return 0.7;
    }
  }

  updateConversationHistory(userId, messages, reply) {
    if (!userId) return;

    const history = this.conversationHistory.get(userId) || [];
    const updatedHistory = [...history, ...messages, reply];
    
    // Keep last 10 messages
    const trimmedHistory = updatedHistory.slice(-10);
    this.conversationHistory.set(userId, trimmedHistory);
  }

  clearConversationHistory(userId) {
    this.conversationHistory.delete(userId);
  }
}

export const openAIService = new OpenAIService();