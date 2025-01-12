
import PQueue from 'p-queue';
import { retryManager } from '../../queue/RetryManager.js';
import { systemPrompts } from '../prompts.js';
import { EventEmitter } from 'events';

// Core services
import { openAIService } from '../openai.js';
import { aiMetricsService } from '../../aiMetricsService.js';
import { contextManager } from '../ContextManager.js';
import { FlowManager } from '../flows/FlowManager.js';
import { TRADING_INTENTS } from '../intents.js';
import { ErrorHandler } from '../../../core/errors/index.js';
import { intentAnalyzer } from './IntentAnalyzer.js';
import { IntentProcessHandler } from '../handlers/IntentProcessHandler.js';
import { validateParameters, getParameterConfig } from '../config/parameterConfig.js';
import { addressBookService } from '../../addressBook/AddressBookService.js';

// Import learning systems
import { learningSystem } from '../flows/learning/LearningSystem.js';
import { userLearningSystem } from '../flows/learning/UserLearningSystem.js';
import { strategyManager } from '../flows/learning/StrategyManager.js';
import { patternRecognizer } from '../flows/learning/PatternRecognition.js';
import { strategyOptimizer } from '../flows/learning/StrategyOptimizer.js';

import { shopifyService } from '../../shopify/ShopifyService.js';
import { tradeService } from '../../trading/TradeService.js';
import { dextools } from '../../dextools/index.js';
import { timedOrderService } from '../../timedOrders.js';
import { priceAlertService } from '../../priceAlerts.js';
import { walletService } from '../../wallet/index.js';
import { networkState } from '../../networkState.js';
import { twitterService } from '../../twitter/index.js';
import { solanaPayService } from '../../solanaPay/SolanaPayService.js';
import { butlerService } from '../../butler/ButlerService.js';
import { dbAIInterface } from '../../db/DBAIInterface.js';
import { gemsService } from '../../gems/GemsService.js';
import { flipperMode } from '../../pumpfun/FlipperMode.js';
import { trendingService } from '../../../services/trending/TrendingService.js';
import { tokenApprovalService } from '../../tokens/TokenApprovalService.js';

export class UnifiedMessageProcessor extends EventEmitter {
  constructor() {
    super();

    // Add parallel execution queue with optimized concurrency
    this.queue = new PQueue({ 
      concurrency: 3,
      autoStart: true,
      intervalCap: 10,
      interval: 1000,
      carryoverConcurrencyCount: true
    });

    // State tracking
    this.activeFlows = new Map();
    this.pendingIntents = new Map();
    this.flowManager = new FlowManager();

    // Core services
    this.contextManager = contextManager;
    this.metrics = aiMetricsService;
    this.intentAnalyzer = intentAnalyzer;
    this.intentProcessor = IntentProcessHandler;

    // Learning systems
    this.learningSystem = learningSystem;
    this.userLearning = userLearningSystem;
    this.strategyManager = strategyManager;
    this.patternRecognizer = patternRecognizer;
    this.strategyOptimizer = strategyOptimizer;
  }

  async initialize() {    
    if (this.initialized) return;
    try {
      // Initialize context manager
      await this.contextManager.initialize();
      
      // Initialize metrics service
      await this.metrics.initialize();
      
      // Initialize flow manager
      await this.flowManager.initialize();
      
      this.initialized = true;
      console.log('✅ UnifiedMessageProcessor initialized');
    } catch (error) {
      console.error('❌ Error initializing UnifiedMessageProcessor:', error);
      throw error;
    }
  }

  async processMessage(msg, userId) {
    console.log('🔄 Processing message:', msg.text);
    const startTime = Date.now();
  
    try {
      // Get conversation context
      const context = await this.contextManager.getContext(userId);
  
      // First analyze message intent
      const analysis = await this.intentAnalyzer.analyzeIntent(msg.text, context);
      
      console.log('🧠 Message analysis:', analysis);
  
      // Validate parameters using parameterConfig
      const validatedParams = await validateParameters(analysis.intent, analysis.parameters);
  
      // Process based on analysis type
      const result = analysis.type === 'compound' 
        ? await this.handleCompoundMessage(analysis, msg, userId)
        : await this.handleSingleMessage(analysis, msg, userId);
  
      // Update context and metrics
      await this.metrics.recordIntent(analysis.intent, true, Date.now() - startTime);
  
      return result;
    } catch (error) {
      console.error('❌ Error processing message:', error);
      await ErrorHandler.handle(error);
      await this.metrics.recordIntent('error', false, Date.now() - startTime);
      throw error;
    }
  }

  async handleCompoundMessage(analysis, msg, userId) {
    
    // Track results and resources
    const results = new Map();
    const pendingIntents = new Set(analysis.intents);
    const completedIntents = new Set();
    let shouldContinue = true;

    try {    
      // Validate dependencies first
      await this.validateDependencies(analysis.intents);

      // Track execution state
      const executionState = {
        completed: new Set(),
        failed: new Set(),
        pending: new Set(analysis.intents.map(i => i.type))
      };

      while (pendingIntents.size > 0 && shouldContinue) {
        // Find executable intents (dependencies met)
        const executableIntents = Array.from(pendingIntents)
          .filter(intent => 
            !intent.dependsOn?.length || 
            intent.dependsOn.every(dep => completedIntents.has(dep))
          );

        if (executableIntents.length === 0) {
          throw new Error('No executable intents found - possible circular dependency');
        }

        // Execute parallel-safe intents concurrently
        const parallelResults = await this.queue.addAll(
          executableIntents.map(intent => async () => {
            try {
              // Execute intent
              const result = await this.executeIntent(intent.type, {
                ...intent.parameters,
                userId,
                previousResults: Object.fromEntries(results)
              });

              // Store result
              results.set(intent.type, result);
              completedIntents.add(intent.type);
              pendingIntents.delete(intent);

              return result;
            } catch (error) {
              throw error;
            }
          })
        );

        // Stop processing if condition check failed
        if (!shouldContinue) {
          break;
        }
      }

      // Update learning systems
      await this.updateLearningData(userId, {
        analysis,
        results: Array.from(results.values()),
        message: msg.text
      });

      // Handle partial completion
      if (executionState.failed.size > 0) {
        this.emit('partialCompletion', {
          userId,
          completed: Array.from(executionState.completed),
          failed: Array.from(executionState.failed)
        });
      }

      return this.formatCompoundResults(Array.from(results.values()));
    } catch (error) {
      // Cleanup resources
      results.cleanup();
      pendingIntents.cleanup();
      completedIntents.cleanup();
      shouldContinue = false;

      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async handleSingleMessage(analysis, msg, userId) {
    try {
      // Execute intent with retry
      const result = await retryManager.executeWithRetry(async () => {
        return await this.executeIntent(analysis.intent, {
          ...analysis.parameters,
          userId,
          text: msg.text
        });
      });

      return {
        type: analysis.intent,
        text: result.response,
        data: result.data
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async handleCashtagQuery(msg, userId) {
    const cashtag = msg.text.substring(1).split(' ')[0];
    await flowManager.startFlow(userId, 'twitter_search', {
      cashtag,
      context: msg.context
    });
    
    const initialState = await searchFlow.start({ 
      cashtag,
      context: msg.text,
      userId,
      timestamp: Date.now()
    });

    this.activeFlows.set(userId, {
      type: 'twitter_search',
      state: initialState
    });

    return {
      text: initialState.response,
      type: 'twitter_search',
      requiresInput: true
    };
  }

  formatCompoundResults(results) {
    return {
      text: results.map(r => r.text).join('\n\n'),
      type: 'compound',
      results: results.map(r => ({
        type: r.type,
        success: !r.error,
        data: r.data
      }))
    };
  }

  async updateLearningData(userId, data) {
    try {
      // Update user learning data
      await this.userLearning.updateUserPreferences(userId, data);

      // Analyze patterns
      const patterns = await this.patternRecognizer.analyzePatterns(data);
      
      // Update strategy if needed
      if (patterns.length > 0) {
        const optimizedStrategy = await this.strategyOptimizer.optimizeStrategy(
          await this.strategyManager.getTopStrategies(userId, 1),
          patterns
        );

        // Emit optimization proposal
        this.emit('strategyOptimization', {
          userId,
          proposal: optimizedStrategy
        });
      }
    } catch (error) {
      console.warn('Learning data update failed:', error);
    }
  }

  async updateProgress(userId, status) {
    try {
      // Format progress message based on status type
      let message;
      switch (status.type) {
        case 'intent_start':
          message = `🔄 Processing ${status.intent}...`;
          break;
        case 'intent_complete':
          message = `✅ Completed ${status.intent}`;
          break;
        case 'intent_error':
          message = `❌ Error: ${status.error}`;
          break;
        default:
          message = `${status.message || 'Processing...'}`;
      }
  
      // Emit progress event
      this.emit('progress', {
        userId,
        type: status.type,
        message,
        timestamp: Date.now(),
        metadata: status
      });
  
    } catch (error) {
      console.warn('Error updating progress:', error);
    }
  }

  // Update executeIntent method to use progress tracking
  async executeIntent(intent, params) {
    try {

      // Format parameters before processing
      const formattedParams = formatParameters(intent, params);
      
      // Update progress before execution
      await this.updateProgress(formattedParams.userId, {
        type: 'intent_start',
        intent,
        step: 1,
        message: `Processing ${intent}...`
      });
  
      // Execute the intent
      const result = await this.processIntent(intent, formattedParams);
  
      // Update progress after completion 
      await this.updateProgress(formattedParams.userId, {
        type: 'intent_complete',
        intent,
        success: true,
        message: `Completed ${intent}`
      });
  
      return result;
  
    } catch (error) {
      // Update progress on error
      await this.updateProgress(params.userId, {
        type: 'intent_error',
        intent,
        error: error.message,
        message: `Error processing ${intent}: ${error.message}`
      });
  
      throw error;
    }
  }
  
  async processIntent(intent, text, userId, context) {
    try {
      const network = await networkState.getCurrentNetwork(userId);
  
      switch (intent) {
        // Trading Actions
        case TRADING_INTENTS.QUICK_TRADE:
        case TRADING_INTENTS.TOKEN_TRADE:
          if (!intent.tokenAddress || !intent.amount) {
            throw new Error('Missing required trade parameters');
          }
          return await tradeService.executeTrade({
            network,
            userId,
            action: intent.action,
            tokenAddress: intent.tokenAddress,
            amount: intent.amount,
            options: intent.options
          });
  
        // Token Analysis & Market Data  
        case TRADING_INTENTS.TOKEN_SCAN:
          return await dextools.formatTokenAnalysis(network, text);
  
        case TRADING_INTENTS.TRENDING_CHECK:
          return await trendingService.getTrendingTokens(network);
  
        case TRADING_INTENTS.MARKET_ANALYSIS:
          return await trendingService.getMarketOverview(network);
  
        case TRADING_INTENTS.GEMS_TODAY:
          return await gemsService.scanGems();
  
        // Social & KOL Analysis
        case TRADING_INTENTS.KOL_CHECK:
          return await twitterService.searchTweets(text);
  
        case TRADING_INTENTS.KOL_MONITOR_SETUP:
          return await this.flowManager.startFlow('kolMonitor', {
            userId,
            initialData: intent.parameters
          });
  
        // Automated Trading
        case TRADING_INTENTS.FLIPPER_MODE:
          return await flipperMode.start(userId, intent.walletAddress, intent.parameters);
  
        case TRADING_INTENTS.FLIPPER_CONFIG:
          return await flipperMode.updateConfig(userId, intent.parameters);
  
        case TRADING_INTENTS.FLIPPER_STATUS:
          return await flipperMode.getStatus(userId);
  
        // Orders & Alerts
        case TRADING_INTENTS.PRICE_ALERT:
          return await priceAlertService.createAlert(userId, {
            tokenAddress: intent.tokenAddress,
            targetPrice: intent.targetPrice,
            condition: intent.condition,
            network,
            walletAddress: intent.walletAddress,
            swapAction: intent.swapAction
          });
  
        case TRADING_INTENTS.TIMED_ORDER:
          return await timedOrderService.createOrder(userId, {
            tokenAddress: intent.tokenAddress,
            action: intent.action,
            amount: intent.amount,
            executeAt: intent.timing,
            network
          });
  
        case TRADING_INTENTS.MULTI_TARGET_ORDER:
          return await this.flowManager.startFlow('multiTarget', {
            userId,
            initialData: intent.parameters
          });
  
        // Portfolio & Positions
        case TRADING_INTENTS.PORTFOLIO_VIEW:
          return await walletService.getWallets(userId);
  
        case TRADING_INTENTS.POSITION_MANAGE:
          return await flipperMode.getOpenPositions(userId);
  
        case TRADING_INTENTS.TRADE_HISTORY:
          return await walletService.getTradeHistory(userId);
  
        // Token Operations
        case TRADING_INTENTS.PRICE_CHECK:
          return await dextools.getTokenPrice(network, intent.tokenAddress);
  
        case TRADING_INTENTS.APPROVE_TOKEN:
          return await tokenApprovalService.approveToken(network, {
            tokenAddress: intent.tokenAddress,
            spenderAddress: intent.spenderAddress,
            amount: intent.amount,
            walletAddress: intent.walletAddress
          });
  
        case TRADING_INTENTS.REVOKE_APPROVAL:
          return await tokenApprovalService.revokeApproval(network, {
            tokenAddress: intent.tokenAddress,
            spenderAddress: intent.spenderAddress,
            walletAddress: intent.walletAddress
          });
  
        // Solana Payments & Shopify Shopping
        case TRADING_INTENTS.SOLANA_PAY:
          return await solanaPayService.createPayment({
            amount: intent.amount,
            recipient: intent.recipient,
            reference: intent.reference,
            label: intent.label
          });
  
        case TRADING_INTENTS.SHOPIFY_SEARCH:
          const products = await shopifyService.searchProducts(text);
          if (!products?.length) {
            return {
              text: "No products found matching your search.",
              type: 'search'
            };
          }
          
          // Handle single product differently
          if (products.length === 1) {
            return this.formatSingleProduct(products[0]);
          }
          
          // Handle multiple products
          return this.formatShopifyResults(products);
  
        case TRADING_INTENTS.SHOPIFY_BUY:
          return await shopifyService.createOrder(intent.productId);
  
        // Butler Assistant
        case TRADING_INTENTS.BUTLER_REMINDER:
          return await butlerService.setReminder(userId, text);
  
        case TRADING_INTENTS.BUTLER_MONITOR:
          return await butlerService.startMonitoring(userId, text);
  
        case TRADING_INTENTS.BUTLER_REPORT:
          return await butlerService.generateReport(userId);
  
        // AI Guidelines & Strategies
        case TRADING_INTENTS.SAVE_GUIDELINE:
          return await dbAIInterface.saveUserGuideline(userId, text);
  
        case TRADING_INTENTS.GET_GUIDELINES:
          return await dbAIInterface.getUserGuidelines(userId);
  
        case TRADING_INTENTS.SAVE_STRATEGY:
          return await dbAIInterface.saveTradingStrategy(userId, { strategy: text });
  
        case TRADING_INTENTS.GET_STRATEGIES:
          return await dbAIInterface.getTradingStrategies(userId);
  
        // Research & Analysis
        case TRADING_INTENTS.INTERNET_SEARCH:
          return await this.performInternetSearch(text);
  
        // Context & History
        case TRADING_INTENTS.CHAT_HISTORY:
          return {
            text: await this.contextManager.getContext(userId),
            type: 'history'
          };
  
        case TRADING_INTENTS.CHAT_SUMMARY:
          return {
            text: await this.contextManager.getContextSummary(userId),
            type: 'summary'
          };
  
        case TRADING_INTENTS.CONTEXT_RECALL:
          return {
            text: await this.contextManager.searchContext(userId, text),
            type: 'search'
          };
  
        case TRADING_INTENTS.CONTEXT_REFERENCE:
          const reference = await this.contextManager.resolveReference(userId, text);
          if (reference) {
            // Handle product references
            if (reference.type === 'product') {
              return await this.handleProductReference(userId, reference.identifier);
            }
            // Handle other reference types
            return await this.handleConversation(text, userId, ('context: ', context + ' reference: ', reference.data));
          }
          return {
            text: "I couldn't find what you're referring to. Could you be more specific?",
            type: 'error'
          };
  
        // Chat & Conversation
        case TRADING_INTENTS.CHAT:
        case TRADING_INTENTS.GREETING:
          return await this.handleConversation(text, userId, context);
  
        default:
          return await this.handleConversation(text, userId, context);
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  buildContextualPrompt(analysis, context) {
    return {
      role: 'system',
      content: `You are KATZ analyzing a message with context. Intent: ${analysis.intent}`,
      messages: context
    };
  }

  buildConversationPrompt(text, context = []) {
    // Ensure context is an array
    const safeContext = Array.isArray(context) ? context : [];
    
    return {
      role: 'system',
      content: 'You are KATZ having a conversation. Maintain sarcastic personality about crypto/meme trading, research, shopify, payments, internet news, twitter trends, pumpfun, bitcoin, tasks and reminders. Consise responses',
      messages: [...safeContext, { role: 'user', content: text }]
    };
  }  

  cleanup() {
    this.activeFlows.clear();
    this.flowManager.cleanup();
    this.initialized = false;
    this.removeAllListeners();
  }
}

export const messageProcessor = new UnifiedMessageProcessor();