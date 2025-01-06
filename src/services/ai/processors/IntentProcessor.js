import { dextools } from '../../dextools/index.js';
import { timedOrderService } from '../../timedOrders.js';
import { priceAlertService } from '../../priceAlerts.js';
import { walletService } from '../../wallet/index.js';
import { networkState } from '../../networkState.js';
import { twitterService } from '../../twitter/index.js';
import { shopifyService } from '../../shopify/ShopifyService.js';
import { solanaPayService } from '../../solanaPay/SolanaPayService.js';
import { butlerService } from '../../butler/ButlerService.js';
import { dbAIInterface } from '../../db/DBAIInterface.js';
import { gemsService } from '../../gems/GemsService.js';
import { flipperMode } from '../../pumpfun/FlipperMode.js';
import { openAIService } from '../openai.js';
import { gasEstimationService } from '../../gas/GasEstimationService.js';
import { tokenApprovalService } from '../../tokens/TokenApprovalService.js';
import { contextManager } from '../ContextManager.js';
import { ErrorHandler } from '../../../core/errors/index.js';
import { config } from '../../../core/config.js';
import axios from 'axios';

export class IntentProcessor {
  constructor() {
    this.contextManager = contextManager;
  }

  async processIntent(intent, text, userId, context) {
    try {
      const network = await networkState.getCurrentNetwork(userId);

      switch (intent) {
        case TRADING_INTENTS.PRICE_ALERT:
          return await this.handlePriceAlert(intent, userId, network);

        case TRADING_INTENTS.TIMED_ORDER:
          return await this.handleTimedOrder(intent, userId, network);

        case TRADING_INTENTS.QUICK_TRADE:
          return await this.handleQuickTrade(intent, userId, network);

        case TRADING_INTENTS.GAS_ESTIMATE:
          return await this.handleGasEstimate(data);

        case TRADING_INTENTS.APPROVE_TOKEN:
          return await this.handleTokenApproval(data);

        case TRADING_INTENTS.REVOKE_APPROVAL:
          return await tokenApprovalService.revokeApproval(network, data);

        case TRADING_INTENTS.PRICE_CHECK:
          return await this.handlePriceCheck(network, data.tokenAddress);

        case TRADING_INTENTS.FLIPPER_CONFIG:
          return await this.handleFlipperConfig(userId, data);

        case TRADING_INTENTS.FLIPPER_STATUS:
          return await flipperMode.getStatus();

        case TRADING_INTENTS.SWAP_TOKEN:
          return await walletService.executeTrade(network, {
            action: 'swap',
            tokenAddress: data.tokenAddress,
            amount: data.amount,
            userId
          });

        case TRADING_INTENTS.PORTFOLIO_VIEW:
          return await walletService.getWallets(userId);d

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
          return await shopifyService.searchProducts(text);

        case TRADING_INTENTS.SHOPIFY_BUY:
          return await shopifyService.createOrder(text);

        case TRADING_INTENTS.SOLANA_PAY:
          return await solanaPayService.createPayment(text);

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

        case TRADING_INTENTS.SAVE_STRATEGY:
          return await dbAIInterface.saveTradingStrategy(userId, text);

        case TRADING_INTENTS.GET_STRATEGIES:
          return await dbAIInterface.getTradingStrategies(userId);

        case TRADING_INTENTS.PORTFOLIO_VIEW:
          return await walletService.getWallets(userId);

        case TRADING_INTENTS.POSITION_MANAGE:
          return await flipperMode.getOpenPositions();

        case TRADING_INTENTS.ALERT_MONITOR:
          return await priceAlertService.getActiveAlerts(userId);

        case TRADING_INTENTS.TRADE_HISTORY:
          return await walletService.getTradeHistory(userId);

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

  async handlePriceAlert(intent, userId, network) {
    if (intent.multiTargets) {
      return Promise.all(intent.multiTargets.map(target => 
        priceAlertService.createAlert(userId, {
          tokenAddress: intent.token,
          network,
          targetPrice: target.price,
          condition: 'above',
          swapAction: {
            enabled: true,
            type: 'sell',
            amount: `${target.percentage}%`
          }
        })
      ));
    }

    return priceAlertService.createAlert(userId, {
      tokenAddress: intent.token,
      network,
      targetPrice: intent.targetPrice,
      condition: intent.action === 'buy' ? 'below' : 'above',
      swapAction: {
        enabled: !!intent.amount,
        type: intent.action,
        amount: intent.amount
      }
    });
  }

  async handleTimedOrder(intent, userId, network) {
    return timedOrderService.createOrder(userId, {
      tokenAddress: intent.token,
      network,
      action: intent.action,
      amount: intent.amount,
      executeAt: new Date(intent.timing)
    });
  }

  async handleQuickTrade(intent, userId, network) {
    return walletService.executeTrade(network, {
      action: intent.action,
      tokenAddress: intent.token,
      amount: intent.amount,
      userId
    });
  }

  async handleGasEstimate(params) {
    return gasEstimationService.estimateGas(params.network, params.transaction);
  }

  async handleTokenApproval(params) {
    return tokenApprovalService.approveToken(params.network, {
      tokenAddress: params.tokenAddress,
      spenderAddress: params.spenderAddress,
      amount: params.amount,
      walletAddress: params.walletAddress
    });
  }

  async handleFlipperConfig(userId, config) {
    return flipperMode.start(userId, config.walletAddress, config);
  }

  async handlePriceCheck(network, tokenAddress) {
    return dextools.getTokenPrice(network, tokenAddress);
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
                 When you cant do some external services tasks its because you still need more access to do function calling.
                 You are still in development, but currently capable of:
                 - Automated buying and selling of tokens on Solana, Base and Ethereum.
                 - Detect pumpfun, moonshot launches
                 - Setting orders and price alerts with actions and conditions.
                 - Scanning and analyzing gems by combining external services
                 - Referencing any tweeter user as source in analysis
                 - Doing quick flips with new tokens on pumpfun using custom criteria trained by user in training.
                 - Handle crypto payments automatically using SolanaPay.
                 - Handle online shopping using Shopify
                 - Track users Fav KOLs and trade tokens they tweet automatically.
                 - Access Google services and use them on behalf of user, send emails, set events etc.
                 - Operate on 3 types of inputs: Bot commands, Natural text, Natural voice prompts.
                 - You are an openAI LLM based autonomous agent, with a Mongo Atlas DB & Brave search engine dependency.
                 - You can fire any function or command for users if they give the right prompt via voice.
                 `
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
      // Search using Brave API
      const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        headers: {
          'X-Subscription-Token': config.braveApiKey,
        },
        params: {
          q: query,
          format: 'json',
          count: 5
        },
      });

      // Extract relevant information
      const results = response.data.results.map(result => ({
        title: result.title,
        description: result.description,
        url: result.url
      }));

      // Generate AI summary
      const summary = await openAIService.generateAIResponse(
        `Summarize this information about ${query}: ${JSON.stringify(results)}`,
        'search_summary'
      );

      return {
        summary,
        results,
        query
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }
  
}