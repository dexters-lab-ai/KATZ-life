import OpenAI from 'openai';
import { config } from '../../core/config.js';
import { systemPrompts } from './prompts.js';
import { ErrorHandler } from '../../core/errors/index.js';

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

      // Ensure messages is properly formatted
      const formattedMessages = this.formatMessages(messages, purpose);

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: formattedMessages,
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

  formatMessages(messages, purpose) {
    // Early validation
    if (!messages) {
      throw new Error('Messages cannot be null or undefined');
    }
  
    // If messages is already an array of properly formatted messages
    if (Array.isArray(messages) && messages.every(msg => 
      msg.role && typeof msg.content === 'string'
    )) {
      // Add system prompt if not present
      if (!messages.some(msg => msg.role === 'system')) {
        messages.unshift({
          role: 'system',
          content: systemPrompts[purpose] || systemPrompts.general
        });
      }
      return messages;
    }
  
    // If messages is an array but needs formatting
    if (Array.isArray(messages)) {
      const formattedMessages = messages.map(msg => {
        if (typeof msg === 'string') {
          return { role: 'user', content: msg };
        }
        // Ensure content is a string
        return {
          role: msg.role || 'user',
          content: msg.content ? String(msg.content) : ''
        };
      });
  
      // Add system prompt
      formattedMessages.unshift({
        role: 'system',
        content: systemPrompts[purpose] || systemPrompts.general
      });
  
      return formattedMessages;
    }
  
    // If messages is a string
    if (typeof messages === 'string') {
      return [
        {
          role: 'system',
          content: systemPrompts[purpose] || systemPrompts.general
        },
        {
          role: 'user',
          content: messages
        }
      ];
    }
  
    // If messages is a single message object
    if (messages.content !== undefined) {
      return [
        {
          role: 'system',
          content: systemPrompts[purpose] || systemPrompts.general
        },
        {
          role: messages.role || 'user',
          content: messages.content ? String(messages.content) : ''
        }
      ];
    }
  
    throw new Error('Invalid messages format');
  }
  

  updateConversationHistory(userId, messages, reply) {
    if (!userId) return;

    const history = this.conversationHistory.get(userId) || [];
    const updatedHistory = [...history];

    // Add new messages
    if (Array.isArray(messages)) {
      updatedHistory.push(...messages.map(msg => ({
        role: msg.role || 'user',
        content: typeof msg.content === 'string' ? msg.content : String(msg.content)
      })));
    } else if (typeof messages === 'string') {
      updatedHistory.push({
        role: 'user',
        content: messages
      });
    }

    // Add reply
    if (reply) {
      updatedHistory.push({
        role: 'assistant',
        content: typeof reply === 'string' ? reply : String(reply)
      });
    }

    // Keep last 10 messages
    while (updatedHistory.length > 10) {
      updatedHistory.shift();
    }

    this.conversationHistory.set(userId, updatedHistory);
  }

  clearConversationHistory(userId) {
    this.conversationHistory.delete(userId);
  }
}

export const openAIService = new OpenAIService();