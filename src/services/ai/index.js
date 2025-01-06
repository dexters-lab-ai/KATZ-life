import { openAIService } from './openai.js';
import { TRADING_INTENTS, matchIntent } from './intents.js';
import { ResponseFormatter } from './formatters/ResponseFormatter.js';
import { contextManager } from './ContextManager.js';
import { TradeFlow } from './flows/TradeFlow.js';
import { AlertFlow } from './flows/AlertFlow.js';
import { IntentProcessor } from './processors/IntentProcessor.js';
import { ErrorHandler } from '../../core/errors/index.js';
import { circuitBreakers } from '../../core/circuit-breaker/index.js';
import { BREAKER_CONFIGS } from '../../core/circuit-breaker/index.js';

class AIService {
  
  constructor() {
    this.contextManager = contextManager;
    this.tradeFlow = new TradeFlow();
    this.alertFlow = new AlertFlow();
    this.activeFlows = new Map();
    this.intentProcessor = new IntentProcessor();
  }

  async processCommand(text, providedIntent, userId, context = []) {
    return circuitBreakers.executeWithBreaker(
      'openai',
      async () => {
        try {
          // Validate input
          if (!text?.trim()) {
            return {
              text: "I need some input to work with! What can I help you with?",
              type: 'chat'
            };
          }
  
          // Check for active flow first
          const activeFlow = this.activeFlows.get(userId);
          if (activeFlow) {
            return this.continueFlow(userId, text, activeFlow);
          }
  
          // Safely handle context
          const safeContext = Array.isArray(context) ? context : [];
          const conversationContext =
            safeContext.length > 0 ? safeContext : await this.contextManager.getContext(userId);
  
          // Determine intent
          const intent = providedIntent || matchIntent(text);
  
          // Handle intent or fallback to conversation/greeting
          if (intent) {
            const result = await this.handleIntent(intent, text, userId, conversationContext);
  
            // Validate response
            if (!result?.text && !result?.response) {
              return {
                text: "I processed your request but couldn't generate a proper response. Please try again.",
                type: 'error'
              };
            }
  
            return this.formatResponse(result, intent);
          } else if (conversationContext.length > 0) {
            return this.handleConversation(text, userId, conversationContext);
          } else {
            return this.handleGreeting(text, userId);
          }
        } catch (error) {
          console.error('AI Service Error:', error);
          await ErrorHandler.handle(error);
  
          // Return user-friendly error message
          return {
            text: "I encountered an error processing your request. Please try again or use the menu options.",
            type: 'error'
          };
        }
      },
      BREAKER_CONFIGS.openai
    );
  }

  // Update the processIntent reference
  async handleIntent(intent, text, userId, context) {
    try {
      switch (intent) {
        case TRADING_INTENTS.QUICK_TRADE:
          return this.startFlow('trade', userId, { text, context });

        case TRADING_INTENTS.PRICE_ALERT:
          return this.startFlow('alert', userId, { text, context });

        default:
          return this.intentProcessor.processIntent(intent, text, userId, context);
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  formatResponse(result, intent) {
    if (!result) {
      return {
        text: "I couldn't process that request. Please try again.",
        type: 'error'
      };
    }

    return ResponseFormatter.formatResponse(intent, result);
  }

  async startFlow(flowType, userId, data) {
    const flow = flowType === 'trade' ? this.tradeFlow : this.alertFlow;
    const initialState = await flow.start(userId, data);
    
    this.activeFlows.set(userId, {
      type: flowType,
      state: initialState
    });

    return {
      text: initialState.response,
      type: flowType,
      requiresInput: true
    };
  }

  async continueFlow(userId, input, activeFlow) {
    try {
      const flow = activeFlow.type === 'trade' ? this.tradeFlow : this.alertFlow;
      const result = await flow.processStep(activeFlow.state, input);

      if (result.completed) {
        this.activeFlows.delete(userId);
        return {
          text: result.response,
          type: activeFlow.type,
          data: result.data,
          completed: true
        };
      }

      this.activeFlows.set(userId, {
        type: activeFlow.type,
        state: result.flowData
      });

      return {
        text: result.response,
        type: activeFlow.type,
        requiresInput: true
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      this.activeFlows.delete(userId);
      throw error;
    }
  }

  cleanup() {
    this.activeFlows.clear();
    this.contextManager.cleanup();
    this.tradeFlow.removeAllListeners();
    this.alertFlow.removeAllListeners();
  }
}

export const aiService = new AIService();