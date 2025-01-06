import { TRADING_INTENTS } from '../intents.js';
import { formatBalance, formatAddress } from '../../../utils/formatters.js';
import { networkState } from '../../networkState.js';

export class ResponseFormatter {
  static formatResponse(intent, data) {
    if (!data) {
      return {
        text: "No data available for this request.",
        type: 'error'
      };
    }

    // Handle direct text responses
    if (typeof data === 'string') {
      return {
        text: data,
        type: intent
      };
    }

    // Handle response objects
    if (data.text || data.response) {
      return {
        text: data.text || data.response,
        type: intent,
        data: data
      };
    }

    const formatter = this.getFormatter(intent);
    if (!formatter) {
      return {
        text: JSON.stringify(data, null, 2),
        type: intent
      };
    }

    try {
      const formatted = formatter(data);
      return {
        text: formatted,
        type: intent,
        data: data
      };
    } catch (error) {
      console.error(`Error formatting response for ${intent}:`, error);
      return {
        text: "Error formatting response. Please try again.",
        type: 'error',
        error: error.message
      };
    }
  }
}

/**
 * Format the intent response based on intent type and data.
 */
function formatIntentResponse(intent, data, username) {
    switch (intent) {
        case TRADING_INTENTS.GAS_ESTIMATE: 
            return formatGasEstimateResponse(data);

        case TRADING_INTENTS.APPROVE_TOKEN: 
            return formatApprovalResponse(data);

        case TRADING_INTENTS.REVOKE_APPROVAL: 
            return formatApprovalResponse(data);

        case TRADING_INTENTS.PRICE_CHECK: 
            return formatPriceCheckResponse(data);

        case TRADING_INTENTS.FLIPPER_CONFIG: 
            return formatFlipperConfigResponse(data);

        case TRADING_INTENTS.FLIPPER_STATUS: 
            return formatFlipperStatusResponse(data);

      case TRADING_INTENTS.TRENDING_CHECK:
        return formatTrendingResponse(data);
      
      case TRADING_INTENTS.TOKEN_SCAN:
        return formatScanResponse(data, username);
      
      case TRADING_INTENTS.KOL_CHECK:
        return formatKOLResponse(data);
      
      case TRADING_INTENTS.QUICK_TRADE:
        return formatTradeResponse(data);
      
      case TRADING_INTENTS.PORTFOLIO_VIEW:
        return formatPortfolioResponse(data);
      
      case TRADING_INTENTS.FLIPPER_MODE:
        return formatFlipperResponse(data);
      
      case TRADING_INTENTS.POSITION_MANAGE:
        return formatPositionResponse(data);
      
      case TRADING_INTENTS.ALERT_MONITOR:
        return formatMonitoringResponse(data);
  
      case TRADING_INTENTS.GEMS_TODAY:
        return formatGemsResponse(data);
  
      case TRADING_INTENTS.INTERNET_SEARCH:
        return formatSearchResponse(data);
  
      case TRADING_INTENTS.SWAP_TOKEN:
        return formatSwapResponse(data);
      
      case TRADING_INTENTS.SEND_TOKEN:
        return formatSendResponse(data);
      
      case TRADING_INTENTS.BUTLER_REMINDER:
        return formatButlerResponse(data);
      
      case TRADING_INTENTS.SOLANA_PAY:
        return formatSolanaPayResponse(data);
      
      case TRADING_INTENTS.SHOPIFY_SEARCH:
        return formatShopifyResponse(data);
      
      case TRADING_INTENTS.SAVE_GUIDELINE:
        return formatGuidelineResponse(data);
    
      case TRADING_INTENTS.TRADE_HISTORY:
        return formatTradeHistory(data);
      
      case TRADING_INTENTS.SAVE_STRATEGY:
        return formatStrategyResponse(data);
      case TRADING_INTENTS.CHAT:
      case TRADING_INTENTS.GREETING:
        return formatChatResponse(data, username);
      default:
        return 'I couldn’t handle it. Please try again.';
    }
  }
  
  function formatChatResponse(data, username) {
    const greetings = [
      `Sup! Ready to get rekt in the trenches? 😼`,
      `Oh look who it is... want to lose some money! 😹`,
      `*sigh* What do you want? I was napping... 😾`,
      `Yo! Let's find some gems to ape into! 💎`,
      `Another day, another degen. What's up? 🐱`
    ];
  
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  function formatMarketAnalysis(data) {
    return '*Market Overview* 📊\n\n' +
      `Total Volume: $${formatBalance(data.volume24h)}\n` +
      `Active Pairs: ${data.activePairs}\n` +
      `Trending Categories: ${data.trendingCategories.join(', ')}\n\n` +
      '*Market Sentiment* 📈\n' +
      `${data.sentiment}\n\n` +
      '_Not financial advice, but you\'ll probably get rekt anyway!_ 😹';
  }

  function formatAlerts(alerts) {
    if (!alerts?.length) return "No active alerts.";

    return '*Active Alerts* ⚡\n\n' +
      alerts.map((alert, i) =>
        `${i + 1}. *${alert.token.symbol}*\n` +
        `• Target: $${formatBalance(alert.targetPrice)}\n` +
        `• Condition: ${alert.condition}\n` +
        `• Auto-Trade: ${alert.swapAction?.enabled ? '✅' : '❌'}\n`
      ).join('\n');
  }

  function formatTradeHistory(trades) {
    if (!trades?.length) return "No trade history found.";

    return '*Trade History* 📜\n\n' +
      trades.map((trade, i) =>
        `${i + 1}. *${trade.token.symbol}*\n` +
        `• Action: ${trade.action}\n` +
        `• Price: $${formatBalance(trade.price)}\n` +
        `• Amount: ${formatBalance(trade.amount)}\n` +
        `• Time: ${new Date(trade.timestamp).toLocaleString()}\n`
      ).join('\n');
  }
  
  function formatTrendingResponse(tokens) {
    if (!tokens?.length) return "No trending tokens found.";

    return '*Trending Tokens* 🔥\n\n' +
      tokens.slice(0, 10).map((token, i) =>
        `${i + 1}. *${token.symbol}*\n` +
        `• Price: $${formatBalance(token.price)}\n` +
        `• Volume: $${formatBalance(token.volume24h)}\n` +
        `• Network: ${networkState.getNetworkDisplay(token.network)}\n`
      ).join('\n');
  }
  
  function formatScanResponse(data, username) {
    if (!data) {
      return `Anon ${username} wants to scan tokens? *sigh* Fine...but don't blame me when you get rekt! 😼`;
    }
  
    return `*Token Analysis* 🔍\n\n` +
           `Hey ${username}, here's your dextools link ser... news flash tomorrow: "${username} got rekt" 😹\n\n` +
           `Symbol: ${data.symbol}\n` +
           `Price: $${data.price}\n` +
           `Liquidity: $${data.liquidity}\n` +
           `Holders: ${data.holders}\n\n` +
           `Security Score: ${data.score}/100\n` +
           `Risk Level: ${data.riskLevel}\n\n` +
           `[View on Dextools](${data.dextoolsUrl})\n\n` +
           `_Don't say I didn't warn you anon..._`;
  }
  
  function formatKOLResponse(tweets) {
    if (!tweets?.length) return 'No KOL mentions found.';
  
    return '*KOL Mentions* 🐦\n\n' +
      tweets.map((tweet, i) =>
        `${i+1}. *${tweet.author.name}* ${tweet.author.verified ? '✅' : ''}\n` +
        `@${tweet.author.username} (${tweet.author.followers} followers)\n\n` +
        `${tweet.text}\n\n` +
        `❤️ ${tweet.stats.likes} | 🔄 ${tweet.stats.retweets}\n`
      ).join('\n');
  }
  
  function formatTradeResponse(result) {
    return '*Trade Executed* ✅\n\n' +
      `Type: ${result.action}\n` +
      `Token: ${result.token}\n` +
      `Amount: ${result.amount}\n` +
      `Price: $${result.price}\n` +
      `Hash: \`${result.hash}\``;
  }
  
  function formatPortfolioResponse(positions) {
    if (!positions?.length) return 'No open positions found.';
  
    return '*Portfolio Overview* 📊\n\n' +
      positions.map((pos, i) =>
        `${i+1}. *${pos.token.symbol}*\n` +
        `• Entry: $${pos.entryPrice}\n` +
        `• Current: $${pos.currentPrice}\n` +
        `• P/L: ${pos.profitLoss}%\n`
      ).join('\n');
  }
  
  function formatFlipperResponse(data) {
    if (data.action === 'start') {
      return '*FlipperMode Started* 🤖\n\n' +
        `Max Positions: ${data.config.maxPositions}\n` +
        `Take Profit: ${data.config.profitTarget}%\n` +
        `Stop Loss: ${data.config.stopLoss}%\n` +
        `Time Limit: ${data.config.timeLimit/60000}min`;
    }
  
    return '*FlipperMode Stopped* ⏹\n\n' +
      `Total Trades: ${data.stats.totalTrades}\n` +
      `Profitable: ${data.stats.profitable}\n` +
      `Total P/L: ${data.stats.totalProfit}%`;
  }
  
  function formatPositionResponse(data) {
    return '*Position Updated* ✅\n\n' +
      `Token: ${data.token}\n` +
      `Action: ${data.action}\n` +
      `New TP: ${data.takeProfit}%\n` +
      `New SL: ${data.stopLoss}%`;
  }
  
  // Add to formatters
function formatGasEstimateResponse(data) {
    return '*Gas Estimate* ⛽\n\n' +
      `Network: ${networkState.getNetworkDisplay(data.network)}\n` +
      `Estimated Cost: ${data.formatted}\n` +
      `Gas Price: ${data.gasPrice}\n` +
      `Gas Limit: ${data.gasLimit}`;
  }
  
  function formatApprovalResponse(data) {
    return '*Token Approval* ✅\n\n' +
      `Token: ${data.symbol}\n` +
      `Status: ${data.approved ? 'Approved' : 'Revoked'}\n` +
      `Transaction: ${data.hash}`;
  }
  
  function formatPriceCheckResponse(data) {
    return '*Token Price* 💰\n\n' +
      `Symbol: ${data.symbol}\n` +
      `Price: $${formatBalance(data.price)}\n` +
      `Network: ${networkState.getNetworkDisplay(data.network)}`;
  }
  
  function formatFlipperConfigResponse(data) {
    return '*FlipperMode Configuration* ⚙️\n\n' +
      `Take Profit: ${data.profitTarget}%\n` +
      `Stop Loss: ${data.stopLoss}%\n` +
      `Max Positions: ${data.maxPositions}\n` +
      `Time Limit: ${data.timeLimit/60000}min`;
  }
  
  function formatFlipperStatusResponse(data) {
    return '*FlipperMode Status* 📊\n\n' +
      `Status: ${data.isRunning ? '✅ Running' : '❌ Stopped'}\n` +
      `Active Positions: ${data.openPositions}\n` +
      `Total Profit: ${data.totalProfit}%\n` +
      `Win Rate: ${data.winRate}%`;
  }

  function formatMonitoringResponse(data) {
    let message = '*Active Monitoring* 📊\n\n';
  
    if (data.alerts?.length) {
      message += '*Price Alerts:*\n' +
        data.alerts.map(alert => 
          `• ${alert.token} @ $${alert.targetPrice}`
        ).join('\n') + '\n\n';
    }
  
    if (data.orders?.length) {
      message += '*Scheduled Orders:*\n' +
        data.orders.map(order =>
          `• ${order.action} ${order.token} @ ${order.executeAt}`
        ).join('\n');
    }
  
    return message;
  }
  
  function formatGemsResponse(gems) {
    if (!gems?.length) {
      return 'No trending gems found for today ser. Check back later!';
    }
  
    return '*Today\'s Top Gems* 💎\n\n' +
      gems.slice(0, 5).map((gem, i) => 
        `${i+1}. *${gem.symbol}*\n` +
        `• Rating: ${gem.metrics.rating}/10\n` +
        `• Network: ${gem.network}\n` +
        `• Social Interest: ${formatSocialMetrics(gem.metrics)}\n`
      ).join('\n') +
      '\n_Ratings based on social metrics & interest_';
  }
  
  function formatSocialMetrics(metrics) {
    return `👁 ${metrics.impressions} | ♥️ ${metrics.likes} | 🔄 ${metrics.retweets}`;
  }
  
  function formatSearchResponse(results) {
    if (!results?.length) {
      return 'No relevant information found.';
    }
  
    return '*Search Results* 🔍\n\n' +
      results.map((result, i) => 
        `${i+1}. *${result.title}*\n` +
        `${result.description}\n` +
        `[Read more](${result.url})\n`
      ).join('\n');
  }

  // Add new formatter methods
function formatShopifyResponse(data) {
    return '*Shopping Results* 🛍️\n\n' +
      data.products.map((product, i) => 
        `${i+1}. *${product.title}*\n` +
        `Price: $${product.price}\n` +
        `[View Product](${product.url})\n`
      ).join('\n');
  }
  
  function formatSolanaPayResponse(data) {
    return '*Payment Created* 💰\n\n' +
      `Amount: ${data.amount} SOL\n` +
      `Reference: ${data.reference}\n\n` +
      `Scan QR code to pay:\n${data.qrCode}`;
  }
  
  function formatButlerResponse(data) {
    return '*Butler Update* 🫅\n\n' +
      `Action: ${data.action}\n` +
      `Status: ${data.status}\n` +
      `Details: ${data.details}\n`;
  }
  
  function formatGuidelineResponse(data) {
    return '*AI Guidelines* 📝\n\n' +
      data.guidelines.map((guideline, i) =>
        `${i+1}. ${guideline.content}\n`
      ).join('\n');
  }
  
  function formatStrategyResponse(data) {
    return '*Trading Strategy* 📊\n\n' +
      `Name: ${data.name}\n` +
      `Description: ${data.description}\n\n` +
      `Parameters:\n${JSON.stringify(data.parameters, null, 2)}`;
  }