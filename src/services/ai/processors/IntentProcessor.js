import { EventEmitter } from 'events';
import { networkState } from '../../networkState.js';
import { ErrorHandler } from '../../../core/errors/index.js';
import { TRADING_INTENTS } from '../intents.js';
import { IntentProcessHandler } from '../handlers/IntentProcessHandler.js';
import { validateParameters, getParameterConfig, formatParameters } from '../config/parameterConfig.js';

// Service imports
import { addressBookService } from '../../addressBook/AddressBookService.js';
import { tradeService } from '../../trading/TradeService.js';
import { dextools } from '../../dextools/index.js';
import { trendingService } from '../../trending/TrendingService.js';
import { gemsService } from '../../gems/GemsService.js';
import { twitterService } from '../../twitter/index.js';
import { flipperMode } from '../../pumpfun/FlipperMode.js';
import { priceAlertService } from '../../priceAlerts.js';
import { timedOrderService } from '../../timedOrders.js';
import { walletService } from '../../wallet/index.js';
import { tokenApprovalService } from '../../tokens/TokenApprovalService.js';
import { solanaPayService } from '../../solanaPay/SolanaPayService.js';
import { shopifyService } from '../../shopify/ShopifyService.js';
import { butlerService } from '../../butler/ButlerService.js';
import { dbAIInterface } from '../../db/DBAIInterface.js';
import { contextManager } from '../ContextManager.js';
import { aiService } from '../index.js';

export class IntentProcessor extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.intentProcessHandler = IntentProcessHandler;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Initialize required services
      await Promise.all([
        tradeService.initialize(),
        shopifyService.initialize(),
        solanaPayService.initialize(),
        butlerService.initialize(),
      ]);

      this.initialized = true;
      console.log('✅ IntentProcessor initialized');
    } catch (error) {
      console.error('❌ Error initializing IntentProcessor:', error);
      throw error;
    }
  }

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

  async processIntent(intent, params) {
    try {
      const network = await networkState.getCurrentNetwork(params.userId);
      const { text, userId, context } = params;

      switch (intent) {
        // Trading Actions
        case TRADING_INTENTS.QUICK_TRADE:
        case TRADING_INTENTS.TOKEN_TRADE:
          if (!intent.tokenAddress || !intent.amount) {
            throw new Error('Missing required trade parameters');
          }
          return await this.swapTokens(params, network);
          
        case TRADING_INTENTS.COMPOUND_STRATEGY:
            return await this.intentProcessHandler.handleCompoundStrategy(params);

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
        case TRADING_INTENTS.FLIPPER_STATUS:
          return await flipperMode.getStatus(userId);

        case TRADING_INTENTS.FLIPPER_MODE:
        return await flipperMode.start(userId, intent.walletAddress, intent.parameters);

        case TRADING_INTENTS.FLIPPER_CONFIG:
        return await flipperMode.updateConfig(userId, intent.parameters);

        // Orders & Alerts
        case TRADING_INTENTS.PRICE_ALERT:
          return await this.createPriceAlert(params, network);

        case TRADING_INTENTS.TIMED_ORDER:
          return await this.createTimedOrder(params, network);
        
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
          return await dextools.getTokenPrice(network, params.tokenAddress);

        case TRADING_INTENTS.APPROVE_TOKEN:
          return await this.handleTokenApproval(params, network);

        case TRADING_INTENTS.REVOKE_APPROVAL:
          return await this.handleTokenRevocation(params, network);

        // Solana Payments & Shopify Shopping
        case TRADING_INTENTS.SOLANA_PAY:
          return await this.createSolanaPayment(params);

        case TRADING_INTENTS.SHOPIFY_SEARCH:
          return await this.handleShopifySearch(text);

        case TRADING_INTENTS.SHOPIFY_BUY:
          return await shopifyService.createOrder(params.productId);

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
          return await this.intentProcessHandler.performInternetSearch(text);

        // Context & History
        case TRADING_INTENTS.CHAT_HISTORY:
          return {
            text: await contextManager.getContext(userId),
            type: 'history'
          };

        case TRADING_INTENTS.CHAT_SUMMARY:
          return {
            text: await contextManager.getContextSummary(userId),
            type: 'summary'
          };

        case TRADING_INTENTS.CONTEXT_RECALL:
          return {
            text: await contextManager.searchContext(userId, text),
            type: 'search'
          };

        case TRADING_INTENTS.CONTEXT_REFERENCE:
          return await this.handleContextReference(params);

        // Chat & Conversation
        case TRADING_INTENTS.CHAT:
        case TRADING_INTENTS.GREETING:
          return await this.intentProcessHandler.handleConversation(text, userId, context);

        default:
          return await this.intentProcessHandler.handleConversation(text, userId, context);
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  // Helper methods for intent execution
  async swapTokens(params, network) {
    if (!params.tokenAddress || !params.amount) {
      throw new Error('Missing required trade parameters');
    }

    return await tradeService.executeTrade({
      network,
      userId: params.userId,
      action: params.action,
      tokenAddress: params.tokenAddress,
      amount: params.amount,
      options: params.options
    });
  }

  async createPriceAlert(params, network) {
    return await priceAlertService.createAlert(params.userId, {
      tokenAddress: params.tokenAddress,
      targetPrice: params.targetPrice,
      condition: params.condition,
      network,
      walletAddress: params.walletAddress,
      swapAction: params.swapAction
    });
  }

  async createTimedOrder(params, network) {
    return await timedOrderService.createOrder(params.userId, {
      tokenAddress: params.tokenAddress,
      action: params.action,
      amount: params.amount,
      executeAt: params.timing,
      network
    });
  }

  async handleTokenApproval(params, network) {
    return await tokenApprovalService.approveToken(network, {
      tokenAddress: params.tokenAddress,
      spenderAddress: params.spenderAddress,
      amount: params.amount,
      walletAddress: params.walletAddress
    });
  }

  async handleTokenRevocation(params, network) {
    return await tokenApprovalService.revokeApproval(network, {
      tokenAddress: params.tokenAddress,
      spenderAddress: params.spenderAddress,
      walletAddress: params.walletAddress
    });
  }

  async createSolanaPayment(params) {
    return await solanaPayService.createPayment({
      amount: params.amount,
      recipient: params.recipient,
      reference: params.reference,
      label: params.label
    });
  }

  async handleShopifySearch(text) {
    const products = await shopifyService.searchProducts(text);
    if (!products?.length) {
      return {
        text: "No products found matching your search.",
        type: 'search'
      };
    }

    return products.length === 1 
      ? this.formatSingleProduct(products[0])
      : this.formatShopifyResults(products);
  }

  async handleContextReference(params) {
    const reference = await contextManager.resolveReference(params.userId, params.text);
    if (!reference) {
      return {
        text: "I couldn't find what you're referring to. Could you be more specific?",
        type: 'error'
      };
    }

    if (reference.type === 'product') {
      return await this.handleProductReference(params.userId, reference.identifier);
    }

    return await intentProcessHandler.handleConversation(
      params.text, 
      params.userId, 
      `context: ${params.context} reference: ${reference.data}`
    );
  }

  formatSingleProduct(product) {
    return {
      text: [
        `*${product.title}* 🛍️\n`,
        product.description ? `${product.description}\n` : '',
        `💰 ${product.currency} ${parseFloat(product.price).toFixed(2)}`,
        `${product.available ? '✅ In Stock' : '❌ Out of Stock'}`,
        `\n🔗 [View Product](${product.url})`,
        `\nReference: \`product_${product.id}\``
      ].filter(Boolean).join('\n'),
      type: 'single_product',
      parse_mode: 'Markdown',
      product: {
        ...product,
        reference: `product_${product.id}`
      }
    };
  }

  formatShopifyResults(products) {
    const formattedProducts = products.map(product => ({
      ...product,
      reference: `product_${product.id}`
    }));

    return {
      text: [
        '*KATZ Store Products* 🛍️\n',
        ...formattedProducts.map((product, i) => [
          `${i + 1}. *${product.title}*`,
          `💰 ${product.currency} ${parseFloat(product.price).toFixed(2)}`,
          product.description ? `${product.description.slice(0, 100)}...` : '',
          `${product.available ? '✅ In Stock' : '❌ Out of Stock'}`,
          `🔗 [View Product](${product.url})`,
          `Reference: \`${product.reference}\`\n`
        ].filter(Boolean).join('\n')).join('\n')
      ].join('\n'),
      type: 'product_list',
      parse_mode: 'Markdown',
      products: formattedProducts
    };
  }

  async handleProductReference(userId, productId) {
    const product = await shopifyService.getProductById(productId);
    if (!product) {
      throw new Error('Product not found');
    }
    return this.formatSingleProduct(product);
  }

  cleanup() {
    this.removeAllListeners();
    this.initialized = false;
  }
}

export const intentProcessor = new IntentProcessor();