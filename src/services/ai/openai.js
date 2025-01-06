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

  async generateAIResponse(messages, purpose = 'chat') {
    try {
      if (!this.isConnected) {
        await this.testConnection();
      }

      // Ensure messages is an array
      const messageArray = Array.isArray(messages) ? messages : [
        {
          role: 'system',
          content: systemPrompts[purpose] || systemPrompts.general
        },
        {
          role: 'user',
          content: messages
        }
      ];

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: messageArray,
        max_tokens: 500,
        temperature: 0.7,
        presence_penalty: 0.6,
        frequency_penalty: 0.5
      });

      return response.choices[0].message.content;
    } catch (error) {
      console.error('OpenAI Error:', error);
      await ErrorHandler.handle(error);
      throw error;
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