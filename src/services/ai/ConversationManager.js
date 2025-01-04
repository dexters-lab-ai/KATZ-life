import { EventEmitter } from 'events';
import { openAIService } from './openai.js';
import { ErrorHandler } from '../../core/errors/index.js';

export class ConversationManager extends EventEmitter {
  constructor() {
    super();
    this.conversations = new Map();
    this.states = new Map();
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
      
      // Update conversation state
      this.updateConversationState(userId, {
        lastMessage: text,
        lastResponse: response,
        timestamp: Date.now()
      });

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

  updateConversationState(userId, updates) {
    const current = this.getConversationState(userId);
    this.states.set(userId, {
      ...current,
      ...updates
    });
  }

  async continueFlow(userId, text, state) {
    try {
      const flow = state.activeFlow;
      const flowData = state.flowData;

      const response = await this.processFlowStep(flow, flowData, text);
      
      if (response.completed) {
        this.updateConversationState(userId, {
          activeFlow: null,
          flowData: null
        });
      } else {
        this.updateConversationState(userId, {
          flowData: response.flowData
        });
      }

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

  cleanup() {
    this.conversations.clear();
    this.states.clear();
    this.removeAllListeners();
  }
}