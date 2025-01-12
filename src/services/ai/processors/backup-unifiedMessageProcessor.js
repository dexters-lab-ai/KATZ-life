
import PQueue from 'p-queue';
import { intentAnalyzer } from './IntentAnalyzer.js';
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
import { compoundIntentProcessor } from './CompoundIntentProcessor.js';
import { messageRouter } from './MessageRouter.js';

// Import learning systems
import { learningSystem } from '../learning/LearningSystem.js';
import { userLearningSystem } from '../learning/UserLearningSystem.js';
import { kolLearningSystem } from '../learning/KOLLearningSystem.js';
import { strategyManager } from '../learning/StrategyManager.js';
import { patternRecognizer } from '../learning/PatternRecognizer.js';
import { strategyOptimizer } from '../learning/StrategyOptimizer.js';

// Flow classes
import { TradeFlow } from '../flows/TradeFlow.js';
import { AlertFlow } from '../flows/AlertFlow.js';
import { FlipperFlow } from '../flows/FlipperFlow.js';
import { WalletFlow } from '../flows/WalletFlow.js';
import { GemsFlow } from '../flows/GemsFlow.js';
import { MonitoringFlow } from '../flows/MonitoringFlow.js';
import { PortfolioFlow } from '../flows/PortfolioFlow.js';
import { KOLMonitorFlow } from '../flows/KOLMonitorFlow.js';
import { MultiTargetFlow } from '../flows/MultiTargetFlow.js';
import { TwitterSearchFlow } from '../flows/TwitterSearchFlow.js';

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
import { gasEstimationService } from '../../gas/GasEstimationService.js';
import { tokenApprovalService } from '../../tokens/TokenApprovalService.js';

export class UnifiedMessageProcessor extends EventEmitter {
  constructor() {
    super();

    this.queue = new PQueue({ concurrency: 3 }); // Parallel processing queue
    this.intentAnalyzer = intentAnalyzer;

    // State tracking
    this.activeFlows = new Map();
    this.pendingIntents = new Map();
    this.tradeFlow = new TradeFlow();
    this.alertFlow = new AlertFlow();
    this.flowManager = new FlowManager();

    // Core services
    this.contextManager = contextManager;
    this.metrics = aiMetricsService;
    this.intentAnalyzer = intentAnalyzer;
    this.messageRouter = messageRouter;
    this.compoundProcessor = compoundIntentProcessor;

    // Learning systems
    this.learningSystem = learningSystem;
    this.userLearning = userLearningSystem;
    this.kolLearning = kolLearningSystem;
    this.strategyManager = strategyManager;
    this.patternRecognizer = patternRecognizer;
    this.strategyOptimizer = strategyOptimizer;
    
    // Initialize all flows
    this.flows = new Map([
      ['trade', new TradeFlow()],
      ['alert', new AlertFlow()],
      ['flipper', new FlipperFlow()],
      ['wallet', new WalletFlow()],
      ['gems', new GemsFlow()],
      ['monitoring', new MonitoringFlow()],
      ['portfolio', new PortfolioFlow()],
      ['kolMonitor', new KOLMonitorFlow()],
      ['multiTarget', new MultiTargetFlow()],
      ['twitter_search', new TwitterSearchFlow()]
    ]);

    this.activeFlows = new Map();
    this.intentParameters = new Map(Object.entries(TRADING_INTENTS).map(([key, value]) => [
      value,
      this.getParameterConfig(value)
    ]));
  }

  async initialize() {
    try {
      // Initialize context manager
      await this.contextManager.initialize();
      
      // Initialize metrics service
      await this.metrics.initialize();
      
      // Initialize flow manager
      await this.flowManager.initialize();

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
      // DEPRECATED>>> const analysis = await this.analyzeMessage(msg.text, context);
      // Analyze message with AI
      const analysis = await this.intentAnalyzer.analyzeIntent(msg.text, await this.contextManager.getContext(userId));

      console.log('🧠 Message analysis:', analysis);

      
      // Process based on analysis type
      const result = analysis.type === 'compound' 
        ? await this.handleCompoundMessage(analysis, msg, userId)
        : await this.handleSingleMessage(analysis, msg, userId);

      // Handle cashtag queries
      if (msg.text.startsWith('$')) {
        return this.handleCashtagQuery(msg, userId);
      }
      
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

  // deprecated>> 
  async analyzeMessage(text, context) {
    const prompt = {
      role: 'system',
      content: this.buildSystemPrompt(),
      messages: [...context, { role: 'user', content: text }]
    };

    const analysis = await openAIService.generateAIResponse(prompt, 'intent_analysis');
    return this.parseAnalysis(analysis);
  }

  async handleCompoundMessage(analysis, msg, userId) {
    try {
      // Track results and dependencies
      const results = new Map();
      const pendingIntents = new Set(analysis.intents);
      const completedIntents = new Set();

      // Process intents based on dependencies
      while (pendingIntents.size > 0) {
        for (const intent of pendingIntents) {
          // Check if dependencies are met
          if (intent.dependsOn?.every(dep => completedIntents.has(dep))) {
            // Execute intent
            const result = await this.executeIntent(
              intent.type,
              {
                ...intent.parameters,
                text: msg.text,
                userId,
                previousResults: Object.fromEntries(results)
              },
              userId
            );

            // Store result and mark as completed
            results.set(intent.type, result);
            completedIntents.add(intent.type);
            pendingIntents.delete(intent);

            // Check conditions for continuing
            if (intent.condition && !this.evaluateCondition(intent.condition, result)) {
              pendingIntents.clear(); // Stop processing remaining intents
              break;
            }
          }
        }
      }

      // Update learning systems
      await this.updateLearningData(userId, {
        analysis,
        results: Array.from(results.values()),
        message: msg.text,
        timestamp: Date.now()
      });

      return this.formatCompoundResults(Array.from(results.values()));
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  // Add helper methods
  evaluateCondition(condition, result) {
    switch (condition.type) {
      case 'sentiment':
        return result.sentiment >= condition.threshold;
      case 'price':
        return result.price >= condition.target;
      case 'volume':
        return result.volume >= condition.minimum;
      default:
        return true;
    }
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

  async handleCashtagQuery(msg, userId) {
    const cashtag = msg.text.substring(1).split(' ')[0];
    const searchFlow = this.flows.get('twitter_search');
    
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

  async processAnalysis(analysis, msg, userId, context) {
    try {
      // Check for active flows first
      if (this.activeFlows.has(userId)) {
        return this.continueFlow(userId, msg.text);
      }

      // Handle high confidence intents directly
      if (analysis.confidence > 0.8) {
        return this.executeIntent(analysis.intent, msg.text, userId, context);
      }

      // Start appropriate flow
      const flow = this.getFlowForIntent(analysis.intent);
      if (flow) {
        return this.startFlow(flow, msg, userId);
      }

      // Fallback to conversation
      return this.handleConversation(msg.text, userId, context);
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
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

  getParameterConfig(intent) {
    // Define required and optional parameters for each intent
    const configs = {
      // Shopping Intents
      [TRADING_INTENTS.PRODUCT_SEARCH]: {
        required: ['keyword'],
        optional: ['category', 'priceRange', 'limit']
      },
      [TRADING_INTENTS.SHOPIFY_SEARCH]: {
        required: ['keyword'],
        optional: ['category', 'maxPrice', 'minPrice']
      },
      [TRADING_INTENTS.SHOPIFY_BUY]: {
        required: ['productId'],
        optional: ['quantity']
      },

      // Trading Actions
      [TRADING_INTENTS.TOKEN_TRADE]: {
        required: ['action', 'token', 'amount'],
        optional: ['network', 'slippage', 'deadline']
      },
      [TRADING_INTENTS.SWAP_TOKEN]: {
        required: ['tokenAddress', 'amount', 'direction'],
        optional: ['network', 'slippage']
      },
      [TRADING_INTENTS.SEND_TOKEN]: {
        required: ['tokenAddress', 'recipientAddress', 'amount'],
        optional: ['network', 'memo']
      },

      // Market Analysis
      [TRADING_INTENTS.TRENDING_CHECK]: {
        required: [],
        optional: ['network', 'limit']
      },
      [TRADING_INTENTS.TOKEN_SCAN]: {
        required: ['tokenAddress'],
        optional: ['network']
      },
      [TRADING_INTENTS.MARKET_ANALYSIS]: {
        required: ['network'],
        optional: ['timeframe']
      },
      [TRADING_INTENTS.KOL_CHECK]: {
        required: ['keyword'],
        optional: ['timeframe', 'limit']
      },
      [TRADING_INTENTS.GEMS_TODAY]: {
        required: [],
        optional: ['network', 'minLiquidity', 'minHolders']
      },

      // Automated Trading
      [TRADING_INTENTS.PRICE_ALERT]: {
        required: ['token', 'targetPrice'],
        optional: ['action', 'amount', 'network']
      },
      [TRADING_INTENTS.TIMED_ORDER]: {
        required: ['token', 'action', 'amount', 'timing'],
        optional: ['network', 'slippage']
      },
      [TRADING_INTENTS.FLIPPER_MODE]: {
        required: ['walletAddress'],
        optional: ['maxPositions', 'profitTarget', 'stopLoss', 'timeLimit']
      },
      [TRADING_INTENTS.FLIPPER_CONFIG]: {
        required: ['walletAddress'],
        optional: ['profitTarget', 'stopLoss', 'maxPositions', 'timeLimit']
      },
      [TRADING_INTENTS.FLIPPER_STATUS]: {
        required: [],
        optional: []
      },

      // Portfolio Management
      [TRADING_INTENTS.PORTFOLIO_VIEW]: {
        required: [],
        optional: ['network']
      },
      [TRADING_INTENTS.POSITION_MANAGE]: {
        required: ['tokenAddress'],
        optional: ['action', 'takeProfit', 'stopLoss']
      },
      [TRADING_INTENTS.TRADE_HISTORY]: {
        required: [],
        optional: ['network', 'timeframe', 'limit']
      },

      // Token Approvals & Gas
      [TRADING_INTENTS.GAS_ESTIMATE]: {
        required: ['network', 'transaction'],
        optional: []
      },
      [TRADING_INTENTS.APPROVE_TOKEN]: {
        required: ['network', 'tokenAddress', 'spenderAddress', 'walletAddress'],
        optional: ['amount']
      },
      [TRADING_INTENTS.REVOKE_APPROVAL]: {
        required: ['network', 'tokenAddress', 'spenderAddress', 'walletAddress'],
        optional: []
      },
      [TRADING_INTENTS.PRICE_CHECK]: {
        required: ['tokenAddress'],
        optional: ['network']
      },

      // Butler Assistant
      [TRADING_INTENTS.BUTLER_REMINDER]: {
        required: ['text'],
        optional: ['time', 'recurring']
      },
      [TRADING_INTENTS.BUTLER_MONITOR]: {
        required: ['text'],
        optional: ['duration', 'conditions']
      },
      [TRADING_INTENTS.BUTLER_REPORT]: {
        required: [],
        optional: ['timeframe']
      },

      // Payments
      [TRADING_INTENTS.SOLANA_PAY]: {
        required: ['amount'],
        optional: ['label', 'message']
      },

      // AI Guidelines & Strategies
      [TRADING_INTENTS.SAVE_GUIDELINE]: {
        required: ['content'],
        optional: ['category']
      },
      [TRADING_INTENTS.GET_GUIDELINES]: {
        required: [],
        optional: ['category']
      },
      [TRADING_INTENTS.SAVE_STRATEGY]: {
        required: ['name', 'description', 'parameters'],
        optional: []
      },
      [TRADING_INTENTS.GET_STRATEGIES]: {
        required: [],
        optional: []
      },

      // Basic Intents
      [TRADING_INTENTS.CHAT]: {
        required: [],
        optional: []
      },
      [TRADING_INTENTS.GREETING]: {
        required: [],
        optional: []
      }
    };
    return configs[intent] || { required: [], optional: [] };
  }

  
parseAIResponse(response) {
  try {
    if (typeof response === 'string') {
      const parsed = JSON.parse(response);
      return {
        intent: parsed.intent || 'CHAT',
        confidence: parsed.confidence || 1.0,
        parameters: parsed.parameters || {},
        requiresContext: parsed.requiresContext || false,
        suggestedFlow: parsed.suggestedFlow || null
      };
    }
    return response;
  } catch (error) {
    console.warn('Failed to parse AI response:', error);
    return {
      intent: 'CHAT',
      confidence: 1.0,
      parameters: {},
      requiresContext: false
    };
  }
}


  buildSystemPrompt() {
    return `You are KATZ, an AI assistant analyzing user messages for:
              1. Intent classification
              2. Parameter extraction based on intent requirements
              3. Context awareness
              4. Action determination

              Available Intents and Required Parameters:
              ${Array.from(this.intentParameters.entries()).map(([intent, config]) => `
              ${intent}:
                Required: ${config.required.join(', ') || 'none'}
                Optional: ${config.optional.join(', ') || 'none'}
              `).join('\n')}

              Return JSON with:
              {
                "intent": string,
                "confidence": number,
                "parameters": {
                  // All required and any optional parameters for the intent
                },
                "requiresContext": boolean,
                "suggestedFlow": string|null
              }`;
  }
  
  async validateParameters(intent, parameters) {
    const config = this.intentParameters.get(intent);
    if (!config) return true;

    const missing = config.required.filter(param => !parameters[param]);
    if (missing.length > 0) {
      throw new Error(`Missing required parameters for ${intent}: ${missing.join(', ')}`);
    }

    return true;
  }
  
  async executeIntent(intent, text, userId, context) {
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
          return await flowManager.startFlow('kolMonitor', {
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
          return await flowManager.startFlow('multiTarget', {
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
  
  async handleProductSearch(query) {
    // console.log('🔍 Processing shopping query:', query);

    try {
      // Extract product name using AI
      const productNamePrompt = [
        {
          role: 'system',
          content: `Extract only the main product name or type from the query. 
          Return ONLY the product name, nothing else.
          Examples:
          "I want to buy a snowboard" -> "snowboard"
          "Looking for winter gear and boots" -> "winter gear"
          "Show me some KATZ merch" -> "KATZ merch"
          "Need a new t-shirt in black" -> "t-shirt"`
        },
        {
          role: 'user',
          content: query
        }
      ];
  
      const keyword = await openAIService.generateAIResponse(productNamePrompt, 'shopping');
      
      if (!keyword?.trim()) {
        return {
          text: "I couldn't determine what product you're looking for. Please be more specific.",
          type: 'error'
        };
      }
  
      // Search products with extracted keyword
      const products = await shopifyService.searchProducts(keyword.trim().toLowerCase());
      
      if (!products?.length) {
        return {
          text: `No products found matching "${keyword}". Try a different search term.`,
          type: 'search'
        };
      }
  
      // Take first product for image presentation
      const featuredProduct = products[0];
  
      // Format message with all products
      const message = [
        '*KATZ Store Products* 🛍️\n',
        ...products.slice(0, 5).map((product, i) => [
          `${i + 1}. *${product.title}*`,
          `💰 ${product.currency} ${parseFloat(product.price).toFixed(2)}`,
          `${product.available ? '✅ In Stock' : '❌ Out of Stock'}`,
          `[View Product](${product.image})`,
          '' // Empty line for spacing
        ].join('\n'))
      ].join('\n');
  
      return {
        text: message,
        type: 'search',
        parse_mode: 'Markdown',
        image: featuredProduct.image // Single featured product image
      };
  
    } catch (error) {
      console.error('❌ Product search error:', error);
      await ErrorHandler.handle(error);
      return {
        text: "Sorry, I encountered an error while searching. Please try again.",
        type: 'error'
      };
    }
  }

  // Result formmaters before output
  formatSingleProduct(product) {
    return {
      text: [
        `*${product.title}* 🛍️\n`,
        product.description ? `${product.description}\n` : '',
        `💰 ${product.currency} ${parseFloat(product.price).toFixed(2)}`,
        `${product.available ? '✅ In Stock' : '❌ Out of Stock'}`,
        `\n🔗 [View Product](${product.url})`,
        `\nReference: \`product_${product.id}\``, // For follow-up commands
      ].filter(Boolean).join('\n'),
      type: 'single_product',
      parse_mode: 'Markdown',
      product: {
        ...product,
        reference: `product_${product.id}`
      },
      metadata: {
        timestamp: new Date().toISOString()
      }
    };
  }
  
  formatShopifyResults(products) {
    const formattedProducts = products.map(product => ({
      ...product,
      reference: `product_${product.id}`
    }));
  
    const message = [
      '*KATZ Store Products* 🛍️\n',
      ...formattedProducts.map((product, i) => [
        `${i + 1}. *${product.title}*`,
        `💰 ${product.currency} ${parseFloat(product.price).toFixed(2)}`,
        product.description ? `${product.description.slice(0, 100)}...` : '',
        `${product.available ? '✅ In Stock' : '❌ Out of Stock'}`,
        `🔗 [View Product](${product.url})`,
        `Reference: \`${product.reference}\`\n`
      ].filter(Boolean).join('\n'))
    ].join('\n');
  
    return {
      text: message,
      type: 'product_list',
      parse_mode: 'Markdown',
      products: formattedProducts,
      metadata: {
        total: products.length,
        timestamp: new Date().toISOString()
      }
    };
  }
  
  async handleProductReference(userId, reference) {
    const productId = reference.replace('product_', '');
    const product = await shopifyService.getProductById(productId);
    
    if (!product) {
      throw new Error('Product not found');
    }
    
    return this.formatSingleProduct(product);
  }  

  formatChatHistory(history) {
    if (!history?.length) return 'No chat history available.';

    return history.map((msg, i) => {
      const role = msg.role === 'user' ? '👤' : '🤖';
      const content = msg.content.trim();
      return `${role} ${content}`;
    }).join('\n\n');
  }

  formatSearchResults(results) {
    if (!results?.length) return 'No results found.';

    const formatted = results.map((result, i) => [
      `${i + 1}. *${result.title}*`,
      `${result.description}`,
      `[Read more](${result.url})`,
      '' // Spacing
    ].join('\n'));

    return {
      text: formatted.join('\n'),
      type: 'search_results',
      parse_mode: 'Markdown',
      metadata: {
        count: results.length,
        timestamp: new Date().toISOString()
      }
    };
  }

  formatPaymentDetails(payment) {
    return {
      text: [
        '*Payment Details* 💰\n',
        `Amount: ${payment.amount} ${payment.currency}`,
        `Recipient: \`${payment.recipient}\``,
        payment.label ? `Label: ${payment.label}` : '',
        '\nScan QR code or click payment link to complete purchase.'
      ].filter(Boolean).join('\n'),
      type: 'payment',
      parse_mode: 'Markdown',
      payment_url: payment.paymentUrl,
      qr_code: payment.qrCode,
      reference: payment.reference
    };
  }

  async startFlow(flowType, msg, userId) {
    const flow = flowType === 'trade' ? this.tradeFlow : this.alertFlow;
    const initialState = await flow.start(msg, userId);
    
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

  async continueFlow(userId, input) {
    const activeFlow = this.activeFlows.get(userId);
    if (!activeFlow) return null;

    const flow = this.flows.get(activeFlow.type);
    const result = await flow.processStep(activeFlow.state, input);

    if (result.completed) {
      this.activeFlows.delete(userId);
      return result;
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
  }

  async handleContextualResponse(analysis, msg, context) {
    // Build enhanced prompt with context
    const enhancedPrompt = {
      role: 'system',
      content: `You are analyzing a message with context. Intent: ${analysis.intent}`,
      messages: context
    };
  
    // Generate contextual response
    const response = await openAIService.generateAIResponse(enhancedPrompt);
  
    // Update context
    await this.contextManager.updateContext(msg.from.id, msg.text, response);
  
    return {
      text: response,
      type: 'contextual',
      requiresFollowUp: true
    };
  }
  
  async handleConversation(text, userId, context = []) {
    try {
      // Ensure context is an array
      const safeContext = Array.isArray(context) ? context : [];
  
      // Build conversation prompt
      const prompt = this.buildConversationPrompt(text, safeContext);
  
      // Generate conversational response  
      const response = await openAIService.generateAIResponse(prompt);
  
      // Update context
      await this.contextManager.updateContext(userId, text, response);
  
      return {
        text: response,
        type: 'chat'
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }  

  shouldUseFlow(intent) {
    const flowIntents = [
      TRADING_INTENTS.FLIPPER_MODE,
      TRADING_INTENTS.WALLET_SETUP,
      TRADING_INTENTS.GEMS_TODAY,
      TRADING_INTENTS.ALERT_MONITOR,
      TRADING_INTENTS.PORTFOLIO_VIEW,
      TRADING_INTENTS.KOL_MONITOR_SETUP,
      TRADING_INTENTS.MULTI_TARGET_ORDER,
      TRADING_INTENTS.SHOPIFY_BUY, // Add Shopify checkout
      TRADING_INTENTS.SOLANA_PAY,
      TRADING_INTENTS.BUTLER_MONITOR,
      TRADING_INTENTS.TWITTER_SEARCH
    ];
    return flowIntents.includes(intent);
  }
  
  // Update - routeToFlow to include all flow mappings
  async routeToFlow(analysis, userId) {
    const flowMap = {
      [TRADING_INTENTS.FLIPPER_MODE]: 'flipper',
      [TRADING_INTENTS.WALLET_SETUP]: 'wallet',
      [TRADING_INTENTS.GEMS_TODAY]: 'gems',
      [TRADING_INTENTS.ALERT_MONITOR]: 'monitoring',
      [TRADING_INTENTS.PORTFOLIO_VIEW]: 'portfolio',
      [TRADING_INTENTS.KOL_MONITOR_SETUP]: 'kolMonitor',
      [TRADING_INTENTS.MULTI_TARGET_ORDER]: 'multiTarget',
      [TRADING_INTENTS.SHOPIFY_BUY]: 'shopify',
      [TRADING_INTENTS.SOLANA_PAY]: 'payment',
      [TRADING_INTENTS.BUTLER_MONITOR]: 'butler',
      [TRADING_INTENTS.TWITTER_SEARCH]: 'twitter_search'
    };
  
    const flowType = flowMap[analysis.intent];
    if (!flowType) {
      throw new Error(`No flow mapped for intent: ${analysis.intent}`);
    }
  
    return await this.flowManager.startFlow(userId, flowType, {
      initialData: analysis.parameters
    });
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
      content: 'You are KATZ having a conversation. Maintain sarcastic personality.',
      messages: [...safeContext, { role: 'user', content: text }]
    };
  }  

  cleanup() {
    this.activeFlows.clear();
    this.removeAllListeners();
  }
}

export const messageProcessor = new UnifiedMessageProcessor();