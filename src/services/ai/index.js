import { openAIService } from './openai.js';
import { TRADING_INTENTS, matchIntent } from './intents.js';
import { ResponseFormatter } from './formatters/ResponseFormatter.js';
import { contextManager } from './ContextManager.js';
import { TradeFlow } from './flows/TradeFlow.js';
import { AlertFlow } from './flows/AlertFlow.js';
import { dextools } from '../dextools/index.js';
import { timedOrderService } from '../timedOrders.js';
import { priceAlertService } from '../priceAlerts.js';
import { walletService } from '../wallet/index.js';
import { networkState } from '../networkState.js';
import { ErrorHandler } from '../../core/errors/index.js';
import { circuitBreakers } from '../../core/circuit-breaker/index.js';
import { BREAKER_CONFIGS } from '../../core/circuit-breaker/index.js';

class AIService {
  constructor() {
    this.contextManager = contextManager;
    this.tradeFlow = new TradeFlow();
    this.alertFlow = new AlertFlow();
    this.activeFlows = new Map();
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
            const result = await this.processIntent(intent, text, userId, conversationContext);
  
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

  async handleIntent(intent, text, userId, context) {
    try {
      // Start appropriate flow based on intent
      switch (intent) {
        case TRADING_INTENTS.QUICK_TRADE:
          return this.startFlow('trade', userId, { text, context });

        case TRADING_INTENTS.PRICE_ALERT:
          return this.startFlow('alert', userId, { text, context });

        default:
          return this.processIntent(intent, text, userId, context);
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

  // AI handling core...
  // Previous code remains the same...

  async processIntent(intent, text, userId, context) {
    try {
      const network = await networkState.getCurrentNetwork(userId);

      switch (intent) {
        case TRADING_INTENTS.TRENDING_CHECK:
          return await dextools.fetchTrendingTokens(network);

        case TRADING_INTENTS.TOKEN_SCAN:
          return await dextools.formatTokenAnalysis(network, text);

        case TRADING_INTENTS.MARKET_ANALYSIS:
          return await dextools.getMarketOverview(network);

        case TRADING_INTENTS.KOL_CHECK:
          return await twitterService.searchTweets(text);

        case TRADING_INTENTS.GEMS_TODAY:
          return await gemsService.scanGems();

        case TRADING_INTENTS.INTERNET_SEARCH:
          return await this.performInternetSearch(text);

        case TRADING_INTENTS.PORTFOLIO_VIEW:
          return await walletService.getWallets(userId);

        case TRADING_INTENTS.POSITION_MANAGE:
          return await flipperMode.getOpenPositions();

        case TRADING_INTENTS.ALERT_MONITOR:
          return await priceAlertService.getActiveAlerts(userId);

        case TRADING_INTENTS.TRADE_HISTORY:
          return await walletService.getTradeHistory(userId);

        default:
          return this.handleConversation(text, userId, context);
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async handleConversation(text, userId, context) {
    try {
      const response = await openAIService.generateAIResponse(
        this.buildChatPrompt(text, context),
        'chat'
      );

      await this.contextManager.updateContext(userId, text, response);

      return {
        text: response,
        type: 'chat',
        requiresInput: false
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async handleGreeting(text, userId) {
    try {
      const response = await openAIService.generateAIResponse(
        this.buildChatPrompt(text, []),
        'greeting'
      );

      await this.contextManager.updateContext(userId, text, response);

      return {
        text: response,
        type: 'greeting',
        requiresInput: false
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  buildChatPrompt(text, context) {
    const contextMessages = context.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    return [
      {
        role: 'system',
        content: `You are KATZ, a sarcastic AI trading assistant from Courage the Cowardly Dog. 
                 You help users with crypto trading while maintaining your witty personality.
                 Always end responses with a sarcastic warning about getting rekt.
                 You still need more system access to fire some commands/functions/intents when you fail to, you are still in development`
      },
      ...contextMessages,
      {
        role: 'user',
        content: text
      }
    ];
  }

  async performInternetSearch(query) {
    try {
      const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        headers: {
          'X-Subscription-Token': process.env.BRAVE_API_KEY,
        },
        params: {
          q: query,
          format: 'json',
        },
      });

      return response.data.results.slice(0, 5);
    } catch (error) {
      await ErrorHandler.handle(error);
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