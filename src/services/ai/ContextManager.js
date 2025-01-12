import { EventEmitter } from 'events';
import { ErrorHandler } from '../../core/errors/index.js';
import { openAIService } from './openai.js';
import { db } from '../../core/database.js';

export class AIContextManager extends EventEmitter {
  constructor() {
    super();
    this.conversations = new Map();
    this.maxHistory = 20;
    this.contextCache = new Map();
    this.referenceMap = new Map();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      // Ensure database is connected
      await db.connect();
      
      // Get database instance
      const database = db.getDatabase();
      if (!database) {
        throw new Error('Database not initialized');
      }
  
      // Initialize collections
      this.contextCollection = database.collection('contexts');
      if (!this.contextCollection) {
        throw new Error('Failed to initialize context collection');
      }
  
      // Setup indexes
      await this.setupIndexes();
      
      this.initialized = true;
      console.log('✅ ContextManager initialized');
      return true;
    } catch (error) {
      console.error('❌ Error initializing ContextManager:', error);
      throw error;
    }
  }  

  async setupIndexes() {
    await this.contextCollection.createIndex({ userId: 1 });
    await this.contextCollection.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 2592000 }); // 30 days
  }

  async getContext(userId) {
    try {
      // Ensure initialized
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Check memory cache first
      let context = this.conversations.get(userId);
      if (context) return context;

      // Try to restore from database
      await this.restoreContext(userId);
      return this.conversations.get(userId) || [];
    } catch (error) {
      await ErrorHandler.handle(error);
      return [];
    }
  }

  async updateContext(userId, message, response) {
    try {
      const context = await this.getContext(userId);
      
      
      console.log('context & message======================', context + '=============', message);
      // Extract and store references
      const references = await this.extractReferences(message, response);
      if (references.length) {
        this.referenceMap.set(userId, [
          ...(this.referenceMap.get(userId) || []),
          ...references
        ]);
      }
      console.log('references======================', references);

      // Add new message and response with metadata
      const newMessages = [
        { 
          role: 'user',
          content: message,
          timestamp: new Date(),
          references,
          metadata: {
            intent: message.intent,
            parameters: message.parameters
          }
        },
        {
          role: 'assistant', 
          content: response,
          timestamp: new Date()
        }
      ];

      // Update context with new messages
      const updatedContext = [...context, ...newMessages];

      // Keep only last N messages
      if (updatedContext.length > this.maxHistory * 2) {
        updatedContext.splice(0, 2);
      }

      // Update memory and persist
      this.conversations.set(userId, updatedContext);
      await this.persistContext(userId, updatedContext);

      // Cache the latest context summary
      await this.updateContextSummary(userId, updatedContext);
      
      this.emit('contextUpdated', { userId, context: updatedContext });
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  async extractReferences(message, response) {
    try {
      // Skip reference extraction for simple greetings/chat
      if (this.isSimpleMessage(message)) {
        return [];
      }
  
      const prompt = {
        role: 'system',
        content: `Extract any product IDs, token addresses, wallet addresses, twitter handles, twitter ids, contacts, email addresses, reminders, cashtags, token symbols, or specific references from this conversation. Return as JSON array of objects with type and identifier.`,
        messages: [
          { role: 'user', content: message },
          { role: 'assistant', content: response }
        ]
      };
  
      const result = await openAIService.generateAIResponse(prompt, 'reference_extraction');
      
      try {
        return JSON.parse(result);
      } catch (error) {
        console.warn('Failed to parse references:', error);
        return [];
      }
    } catch (error) {
      console.warn('Reference extraction failed:', error);
      return [];
    }
  }
  
  isSimpleMessage(message) {
    // Check for simple greetings or basic chat messages
    const simplePatterns = [
      /^hi+\s*$/i,
      /^he(y|llo)\s*$/i,
      /^gm+\s*$/i,
      /^good\s*(morning|evening|night)\s*$/i,
      /^sup+\s*$/i,
      /^yo+\s*$/i
    ];
  
    return simplePatterns.some(pattern => pattern.test(message));
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
        content: 'Summarize this conversation focusing on key topics, products, tokens, cashtags, emails, reminders, twitter KOLs, questions, assessments and decisions made.',
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

  async persistContext(userId, context) {
    try {
      await this.contextCollection.updateOne(
        { userId },
        { 
          $set: { 
            context,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  async restoreContext(userId) {
    try {
      const saved = await this.contextCollection.findOne({ userId });
      if (saved?.context) {
        this.conversations.set(userId, saved.context);
        console.log(`✅ Restored context for user ${userId}`);
      }
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  async clearContext(userId) {
    try {
      this.conversations.delete(userId);
      this.contextCache.delete(userId);
      this.referenceMap.delete(userId);
      await this.contextCollection.deleteOne({ userId });
      this.emit('contextCleared', { userId });
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  async cleanup() {
    try {
      // Persist remaining contexts
      const persistPromises = Array.from(this.conversations.entries()).map(
        ([userId, context]) => this.persistContext(userId, context)
      );
      await Promise.all(persistPromises);

      // Clear memory caches
      this.conversations.clear();
      this.contextCache.clear();
      this.referenceMap.clear();

      // Remove old contexts
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      await this.contextCollection.deleteMany({
        updatedAt: { $lt: monthAgo }
      });

      this.removeAllListeners();
      this.initialized = false;
      console.log('✅ AIContextManager cleaned up');
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }
}

export const contextManager = new AIContextManager();