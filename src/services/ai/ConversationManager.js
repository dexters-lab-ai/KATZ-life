import { EventEmitter } from 'events';
import { openAIService } from './openai.js';
import { ErrorHandler } from '../../core/errors/index.js';
import { contextManager } from './ContextManager.js';
import { db } from '../../core/database.js';

export class ConversationManager extends EventEmitter {
  constructor() {
    super();
    this.conversations = new Map();
    this.states = new Map();
    this.initialized = false;
    this.flowCollection = null;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      await db.connect();
      this.flowCollection = db.getDatabase().collection('conversationFlows');
      await this.setupIndexes();
      this.initialized = true;
      console.log('✅ ConversationManager initialized');
    } catch (error) {
      console.error('❌ Error initializing ConversationManager:', error);
      throw error;
    }
  }

  async setupIndexes() {
    await this.flowCollection.createIndex({ userId: 1 });
    await this.flowCollection.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 3600 }); // 1 hour
  }

  async handleMessage(userId, text, context = []) {
    try {
      // Get or create conversation state
      const state = this.getConversationState(userId);
      
      // Check if we're in a specific flow
      if (state.activeFlow) {
        return this.continueFlow(userId, text, state);
      }

      // Generate chat response
      const response = await this.generateChatResponse(text, context);
      
      // Update conversation state and context
      this.updateConversationState(userId, {
        lastMessage: text,
        lastResponse: response,
        timestamp: Date.now()
      });

      await contextManager.updateContext(userId, text, response);

      return {
        type: 'chat',
        text: response,
        requiresAction: false
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async generateChatResponse(text, context) {
    const messages = [
      {
        role: 'system',
        content: 'You are KATZ, a sarcastic AI trading assistant. Keep responses helpful but witty.'
      },
      ...context.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      {
        role: 'user',
        content: text
      }
    ];

    return openAIService.generateAIResponse(messages, 'chat');
  }

  getConversationState(userId) {
    if (!this.states.has(userId)) {
      this.states.set(userId, {
        activeFlow: null,
        flowData: null,
        lastMessage: null,
        lastResponse: null,
        timestamp: Date.now()
      });
    }
    return this.states.get(userId);
  }

  async updateConversationState(userId, updates) {
    const current = this.getConversationState(userId);
    const updatedState = {
      ...current,
      ...updates
    };
    
    this.states.set(userId, updatedState);

    // Persist flow state if in active flow
    if (updatedState.activeFlow) {
      await this.persistFlowState(userId, updatedState);
    }
  }

  async continueFlow(userId, text, state) {
    try {
      const flow = state.activeFlow;
      const flowData = state.flowData;

      const response = await this.processFlowStep(flow, flowData, text);
      
      if (response.completed) {
        await this.updateConversationState(userId, {
          activeFlow: null,
          flowData: null
        });
      } else {
        await this.updateConversationState(userId, {
          flowData: response.flowData
        });
      }

      // Update context with flow interaction
      await contextManager.updateContext(userId, {
        type: 'flow',
        flow,
        input: text
      }, response);

      return response;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async processFlowStep(flow, flowData, input) {
    // Handle different conversation flows
    switch (flow) {
      case 'trade_setup':
        return this.processTradeFlow(flowData, input);
      case 'alert_setup':
        return this.processAlertFlow(flowData, input);
      default:
        throw new Error(`Unknown flow: ${flow}`);
    }
  }

  async persistFlowState(userId, state) {
    try {
      await this.flowCollection.updateOne(
        { userId },
        { 
          $set: {
            state,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  async restoreFlowState(userId) {
    try {
      const saved = await this.flowCollection.findOne({ userId });
      if (saved?.state) {
        this.states.set(userId, saved.state);
      }
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  cleanup() {
    this.conversations.clear();
    this.states.clear();
    this.removeAllListeners();
    this.initialized = false;
    console.log('✅ ConversationManager cleaned up');
  }
}

export const conversationManager = new ConversationManager();