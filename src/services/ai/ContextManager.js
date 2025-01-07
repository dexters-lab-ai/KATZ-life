import { EventEmitter } from 'events';
import { ErrorHandler } from '../../core/errors/index.js';
import { openAIService } from './openai.js';

export class AIContextManager extends EventEmitter {
  constructor() {
    super();
    this.conversations = new Map();
    this.maxHistory = 20; // Increased from 10
    this.contextCache = new Map();
    this.referenceMap = new Map();
  }

  async getContext(userId) {
    try {
      return this.conversations.get(userId) || [];
    } catch (error) {
      await ErrorHandler.handle(error);
      return [];
    }
  }

  async updateContext(userId, message, response) {
    try {
      const context = await this.getContext(userId);
      
      // Extract and store references
      const references = await this.extractReferences(message, response);
      if (references.length) {
        this.referenceMap.set(userId, [
          ...(this.referenceMap.get(userId) || []),
          ...references
        ]);
      }

      // Add new message and response
      const newMessages = [
        { 
          role: 'user',
          content: message,
          timestamp: Date.now(),
          references
        },
        {
          role: 'assistant', 
          content: response,
          timestamp: Date.now()
        }
      ];

      // Update context with new messages
      const updatedContext = [...context, ...newMessages];

      // Keep only last N messages
      if (updatedContext.length > this.maxHistory * 2) {
        updatedContext.splice(0, 2);
      }

      this.conversations.set(userId, updatedContext);
      this.emit('contextUpdated', { userId, context: updatedContext });

      // Cache the latest context summary
      await this.updateContextSummary(userId, updatedContext);
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  async extractReferences(message, response) {
    try {
      const prompt = {
        role: 'system',
        content: `Extract any product IDs, token addresses, or specific references from this conversation. Return as JSON array of objects with type and identifier.`,
        messages: [
          { role: 'user', content: message },
          { role: 'assistant', content: response }
        ]
      };

      const result = await openAIService.generateAIResponse(prompt, 'reference_extraction');
      return JSON.parse(result);
    } catch (error) {
      console.warn('Reference extraction failed:', error);
      return [];
    }
  }

  async getContextSummary(userId) {
    const cached = this.contextCache.get(userId);
    if (cached && Date.now() - cached.timestamp < 300000) { // 5 minute cache
      return cached.summary;
    }

    const context = await this.getContext(userId);
    return this.generateContextSummary(context);
  }

  async updateContextSummary(userId, context) {
    const summary = await this.generateContextSummary(context);
    this.contextCache.set(userId, {
      summary,
      timestamp: Date.now()
    });
  }

  async generateContextSummary(context) {
    try {
      const prompt = {
        role: 'system',
        content: 'Summarize this conversation focusing on key topics, products, tokens, and decisions made.',
        messages: context
      };

      return await openAIService.generateAIResponse(prompt, 'summary');
    } catch (error) {
      console.warn('Summary generation failed:', error);
      return 'Unable to generate summary';
    }
  }

  async searchContext(userId, query) {
    const context = await this.getContext(userId);
    const prompt = {
      role: 'system',
      content: `Search through this conversation for information about: ${query}. Return relevant messages and any specific references found.`,
      messages: context
    };

    return openAIService.generateAIResponse(prompt, 'search');
  }

  async resolveReference(userId, reference) {
    const references = this.referenceMap.get(userId) || [];
    return references.find(ref => 
      ref.type === reference.type && 
      ref.identifier === reference.identifier
    );
  }

  async clearContext(userId) {
    this.conversations.delete(userId);
    this.contextCache.delete(userId);
    this.referenceMap.delete(userId);
    this.emit('contextCleared', { userId });
  }

  cleanup() {
    this.conversations.clear();
    this.contextCache.clear();
    this.referenceMap.clear();
    this.removeAllListeners();
  }
}

export const contextManager = new AIContextManager();