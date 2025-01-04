import { TRADING_INTENTS } from '../intents.js';
import { dextools } from '../../dextools/index.js';
import { timedOrderService } from '../../timedOrders.js';
import { priceAlertService } from '../../priceAlerts.js';
import { walletService } from '../../wallet/index.js';
import { networkState } from '../../networkState.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class IntentProcessor {
  async processIntent(intent, userId, text, context) {
    try {
      const network = await networkState.getCurrentNetwork(userId);

      switch (intent) {
        case TRADING_INTENTS.TRENDING_CHECK:
          return await dextools.fetchTrendingTokens(network);

        case TRADING_INTENTS.TOKEN_SCAN:
          return await dextools.formatTokenAnalysis(network, intent.token);

        case TRADING_INTENTS.MARKET_ANALYSIS:
          return await dextools.getMarketOverview(network);

        case TRADING_INTENTS.PRICE_ALERT:
          return await this.handlePriceAlert(intent, userId, network);

        case TRADING_INTENTS.TIMED_ORDER:
          return await this.handleTimedOrder(intent, userId, network);

        case TRADING_INTENTS.QUICK_TRADE:
          return await this.handleQuickTrade(intent, userId, network);

        case TRADING_INTENTS.PORTFOLIO_VIEW:
          return await walletService.getWallets(userId);

        case TRADING_INTENTS.CHAT:
        case TRADING_INTENTS.GREETING:
          return { response: text, type: 'chat' };

        default:
          throw new Error('Unknown intent type');
      }
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
}