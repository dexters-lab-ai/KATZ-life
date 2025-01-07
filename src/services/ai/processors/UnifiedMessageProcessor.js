import { systemPrompts } from '../prompts.js';

import { EventEmitter } from 'events';
import { openAIService } from '../openai.js';
import { aiMetricsService } from '../../aiMetricsService.js';
import { contextManager } from '../ContextManager.js';
import { TRADING_INTENTS } from '../intents.js';
import { ErrorHandler } from '../../../core/errors/index.js';
import { shopifyService } from '../../shopify/ShopifyService.js';
import { tradeService } from '../../trading/TradeService.js';
import { TradeFlow } from '../flows/TradeFlow.js';
import { AlertFlow } from '../flows/AlertFlow.js';

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
import { gasEstimationService } from '../../gas/GasEstimationService.js';
import { tokenApprovalService } from '../../tokens/TokenApprovalService.js';

export class UnifiedMessageProcessor extends EventEmitter {
  constructor() {
    super();
    this.contextManager = contextManager;
    this.metrics = aiMetricsService;
    this.tradeFlow = new TradeFlow();
    this.alertFlow = new AlertFlow();
    this.activeFlows = new Map();
    this.intentParameters = new Map(Object.entries(TRADING_INTENTS).map(([key, value]) => [
      value,
      this.getParameterConfig(value)
    ]));
  }

  async processMessage(msg, userId) {
    console.log('🔄 Processing message:', msg.text);
    const startTime = Date.now();
  
    try {
      // Check for active flow first
      const activeFlow = this.activeFlows.get(userId);
      if (activeFlow) {
        console.log('👉 Continuing active flow:', activeFlow.type);
        return this.continueFlow(userId, msg.text, activeFlow);
      }
  
      // Get conversation context
      const context = await this.contextManager.getContext(userId);
      console.log('📜 Context loaded:', context);
  
      // Analyze message with AI first
      const analysis = await this.analyzeMessage(msg.text, context);
      console.log('🧠 Message analysis:', analysis);
  
      // Process based on analysis result
      const result = await this.processAnalysis(analysis, msg, userId, context);
      console.log('✨ Processing result:', result);
  
      // Update context with new interaction
      await this.contextManager.updateContext(userId, msg.text, result);
  
      // Record metrics
      await this.metrics.recordIntent(analysis.intent, true, Date.now() - startTime);
  
      return result;
    } catch (error) {
      console.error('❌ Error processing message:', error);
      await ErrorHandler.handle(error);
      await this.metrics.recordIntent('error', false, Date.now() - startTime);
      throw error;
    }
  }
  
  async analyzeMessage(text, context) {
    console.log('🔍 Analyzing message:', text);
    
    // Format messages properly for OpenAI
    const messages = [
      {
        role: 'system',
        content: this.buildSystemPrompt()
      }
    ];
  
    // Add context messages if they exist
    if (context?.length) {
      messages.push(...context.map(msg => ({
        role: msg.role || 'user',
        content: typeof msg.content === 'string' ? msg.content : String(msg.content)
      })));
    }
  
    // Add current message
    messages.push({
      role: 'user',
      content: text
    });
  
    console.log('📤 Sending to OpenAI:', messages);
  
    try {
      const response = await openAIService.generateAIResponse(messages, 'intent_analysis');
      console.log('📥 OpenAI response:', response);
      return this.parseAIResponse(response);
    } catch (error) {
      console.error('❌ Error analyzing message:', error);
      // Fallback to basic intent matching
      return {
        intent: 'CHAT',
        confidence: 1.0,
        parameters: {},
        requiresContext: false
      };
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

  async processAnalysis(analysis, msg, userId, context) {
    try {
      // Validate analysis object
      if (!analysis) {
        throw new Error('Invalid analysis result');
      }
  
      // Handle high confidence intents
      if (analysis.confidence > 0.8) {
        const result = await this.executeIntent(analysis.intent, msg.text, userId);
        
        // Validate result before logging
        if (!result || (!result.text && !result.message)) {
          throw new Error('Invalid response format from intent execution');
        }
        
        console.log('✨ Processing result:', {
          text: result.text || result.message,
          type: result.type || 'chat'
        });
        
        return result;
      }
  
      // Handle flows
      if (analysis.suggestedFlow) {
        const result = await this.startFlow(analysis.suggestedFlow, msg, userId);
        console.log('✨ Processing result:', {
          text: result.text || result.message,
          type: result.type || 'flow'
        });
        return result;
      }
  
      // Handle context-dependent cases
      if (analysis.requiresContext && context.length > 0) {
        const result = await this.handleContextualResponse(analysis, msg, context);
        console.log('✨ Processing result:', {
          text: result.text || result.message,
          type: result.type || 'contextual'
        });
        return result;
      }
  
      // Fallback to conversation
      const result = await this.handleConversation(msg.text, userId, context);
      console.log('✨ Processing result:', {
        text: result.text || result.message,
        type: result.type || 'chat'
      });
      return result;
  
    } catch (error) {
      console.error('Error in processAnalysis:', error);
      await ErrorHandler.handle(error);
      return {
        text: "I encountered an error processing your request. Please try again.",
        type: 'error'
      };
    }
  }

  async executeIntent(intent, text, userId, context) {
    try {
      const network = await networkState.getCurrentNetwork(userId);
  
      switch (intent) {
        case TRADING_INTENTS.QUICK_TRADE:
          return await this.handleQuickTrade(intent, userId, network);

        case TRADING_INTENTS.TOKEN_TRADE:
          return await tradeService.executeTrade({
            network,
            userId,
            tokenAddress: text,
            amount: text,
          });

        case TRADING_INTENTS.SOLANA_PAY:
          return await solanaPayService.createPayment(text);

        case TRADING_INTENTS.SAVE_STRATEGY:
          return await dbAIInterface.saveTradingStrategy(userId, { strategy: text });

        case TRADING_INTENTS.GET_STRATEGIES:
  return await dbAIInterface.getTradingStrategies(userId);

case TRADING_INTENTS.BUTLER_REMINDER:
  return await butlerService.setReminder(userId, text);

case TRADING_INTENTS.BUTLER_MONITOR:
  return await butlerService.startMonitoring(userId, text);

case TRADING_INTENTS.BUTLER_REPORT:
  return await butlerService.generateReport(userId);

case TRADING_INTENTS.SAVE_GUIDELINE:
  return await dbAIInterface.saveUserGuideline(userId, text);

case TRADING_INTENTS.GET_GUIDELINES:
  return await dbAIInterface.getUserGuidelines(userId);

case TRADING_INTENTS.POSITION_MANAGE:
  return await flipperMode.getOpenPositions();

case TRADING_INTENTS.TRADE_HISTORY:
  return await walletService.getTradeHistory(userId);


        case TRADING_INTENTS.PRICE_ALERT:
          return await this.handlePriceAlert(intent, userId, network);
  
        case TRADING_INTENTS.TIMED_ORDER:
          return await this.handleTimedOrder(intent, userId, network);
  
        case TRADING_INTENTS.QUICK_TRADE:
          return await this.handleQuickTrade(intent, userId, network);
  
        case TRADING_INTENTS.GAS_ESTIMATE:
          return await this.handleGasEstimate(network, text);
  
        case TRADING_INTENTS.APPROVE_TOKEN:
          return await this.handleTokenApproval(network, text);
  
        case TRADING_INTENTS.REVOKE_APPROVAL:
          return await tokenApprovalService.revokeApproval(network, text);
  
        case TRADING_INTENTS.PRICE_CHECK:
          return await this.handlePriceCheck(network, text);
  
        case TRADING_INTENTS.FLIPPER_CONFIG:
          return await this.handleFlipperConfig(userId, text);
  
        case TRADING_INTENTS.FLIPPER_STATUS:
          return await flipperMode.getStatus();
  
        case TRADING_INTENTS.SWAP_TOKEN:
          return await walletService.executeTrade(network, {
            action: 'swap',
            tokenAddress: text,
            amount: text,
            userId
          });
  
        case TRADING_INTENTS.PORTFOLIO_VIEW:
          return await walletService.getWallets(userId);
  
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
  
        case TRADING_INTENTS.SHOPIFY_SEARCH:
          const products = await shopifyService.searchProducts(text);
          if (!products?.length) {
            return {
              text: "I couldn't find any products matching your search.",
              type: 'search'
            };
          }
          const productList = products.map(product => (
            `🛍️ [${product.title}](${product.url})\n` +
            `💰 ${product.price} ${product.currency}\n` +
            `${product.description ? `📝 ${product.description}\n` : ''}` +
            `🔗 Product ID: \`${product.id}\``
          )).join('\n\n');
          return {
            text: `*Found ${products.length} Products:*\n\n${productList}`,
            type: 'search',
            parse_mode: 'Markdown'
          };
  
        case TRADING_INTENTS.SHOPIFY_BUY:
          const product = await shopifyService.getProductById(text);
          if (!product) {
            return {
              text: "Sorry, I couldn't find that product.",
              type: 'error'
            };
          }
          const checkout = await shopifyService.createCheckout(product.variantId);
          const payment = await solanaPayService.createPayment(checkout.totalAmount);
          return {
            text: `*Ready to Purchase ${product.title}*\n\n` +
                  `💰 Total: ${checkout.totalAmount} ${product.currency}\n\n` +
                  `Scan the QR code or click the payment link to complete your purchase.`,
            type: 'payment',
            payment_url: payment.paymentUrl,
            qr_code: payment.qrCode
          };
  
        case TRADING_INTENTS.CHAT_HISTORY:
          const history = await this.contextManager.getContext(userId);
          return {
            text: this.formatChatHistory(history),
            type: 'history'
          };
  
        case TRADING_INTENTS.CHAT_SUMMARY:
          const summary = await this.contextManager.getContextSummary(userId);
          return {
            text: summary,
            type: 'summary'
          };
  
        case TRADING_INTENTS.CONTEXT_RECALL:
          const searchResults = await this.contextManager.searchContext(userId, text);
          return {
            text: searchResults,
            type: 'search'
          };
  
        case TRADING_INTENTS.CONTEXT_REFERENCE:
          const reference = await this.contextManager.resolveReference(userId, text);
          if (reference) {
            return this.executeIntent(reference.originalIntent, reference.data, userId);
          }
          return {
            text: "I couldn't find what you're referring to. Could you be more specific?",
            type: 'error'
          };
  
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

  async handleContextualResponse(analysis, msg, context) {
    const enhancedPrompt = this.buildContextualPrompt(analysis, context);
    const response = await openAIService.generateAIResponse(enhancedPrompt);
    return {
      text: response,
      type: 'contextual',
      requiresFollowUp: true
    };
  }

  async handleConversation(text, userId, context = []) {
    const response = await openAIService.generateAIResponse(
      this.buildConversationPrompt(text, context)
    );
    return {
      text: response,
      type: 'chat'
    };
  }

  buildContextualPrompt(analysis, context) {
    return {
      role: 'system',
      content: `You are KATZ analyzing a message with context. Intent: ${analysis.intent}`,
      messages: context
    };
  }

  buildConversationPrompt(text, context) {
    return {
      role: 'system',
      content: 'You are KATZ having a conversation. Maintain sarcastic personality.',
      messages: [...context, { role: 'user', content: text }]
    };
  }

  cleanup() {
    this.activeFlows.clear();
    this.removeAllListeners();
  }
}

export const messageProcessor = new UnifiedMessageProcessor();