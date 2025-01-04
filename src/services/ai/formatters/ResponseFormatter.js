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
        data: data // Original data preserved
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

  static getFormatter(intent) {
    const formatters = {
      [TRADING_INTENTS.TRENDING_CHECK]: this.formatTrendingTokens,
      [TRADING_INTENTS.TOKEN_SCAN]: this.formatTokenAnalysis,
      [TRADING_INTENTS.MARKET_ANALYSIS]: this.formatMarketAnalysis,
      [TRADING_INTENTS.KOL_CHECK]: this.formatKOLResponse,
      [TRADING_INTENTS.GEMS_TODAY]: this.formatGemsResponse,
      [TRADING_INTENTS.PORTFOLIO_VIEW]: this.formatPortfolio,
      [TRADING_INTENTS.POSITION_MANAGE]: this.formatPositions,
      [TRADING_INTENTS.ALERT_MONITOR]: this.formatAlerts,
      [TRADING_INTENTS.TRADE_HISTORY]: this.formatTradeHistory,
      [TRADING_INTENTS.CHAT]: (data) => data.response,
      [TRADING_INTENTS.GREETING]: (data) => data.response
    };

    return formatters[intent];
  }

  static formatTrendingTokens(tokens) {
    if (!tokens?.length) return "No trending tokens found.";

    return '*Trending Tokens* 🔥\n\n' +
      tokens.slice(0, 10).map((token, i) =>
        `${i + 1}. *${token.symbol}*\n` +
        `• Price: $${formatBalance(token.price)}\n` +
        `• Volume: $${formatBalance(token.volume24h)}\n` +
        `• Network: ${networkState.getNetworkDisplay(token.network)}\n`
      ).join('\n');
  }

  static formatTokenAnalysis(analysis) {
    if (!analysis) return "Couldn't analyze this token.";

    return '*Token Analysis* 🔍\n\n' +
      `Symbol: ${analysis.symbol}\n` +
      `Price: $${formatBalance(analysis.price)}\n` +
      `Liquidity: $${formatBalance(analysis.liquidity)}\n` +
      `Holders: ${analysis.holders}\n\n` +
      `Security Score: ${analysis.score}/100\n` +
      `Risk Level: ${analysis.riskLevel}\n\n` +
      `[View Chart](${analysis.dextoolsUrl})\n\n` +
      '_Remember: DYOR and don\'t blame me if you get rekt!_ 😼';
  }

  static formatMarketAnalysis(data) {
    return '*Market Overview* 📊\n\n' +
      `Total Volume: $${formatBalance(data.volume24h)}\n` +
      `Active Pairs: ${data.activePairs}\n` +
      `Trending Categories: ${data.trendingCategories.join(', ')}\n\n` +
      '*Market Sentiment* 📈\n' +
      `${data.sentiment}\n\n` +
      '_Not financial advice, but you\'ll probably get rekt anyway!_ 😹';
  }

  static formatKOLResponse(tweets) {
    if (!tweets?.length) return "No KOL mentions found.";

    return '*KOL Mentions* 🐦\n\n' +
      tweets.slice(0, 5).map((tweet, i) =>
        `${i + 1}. *${tweet.author.name}* ${tweet.author.verified ? '✅' : ''}\n` +
        `@${tweet.author.username} (${tweet.author.followers} followers)\n\n` +
        `${tweet.text}\n\n` +
        `❤️ ${tweet.stats.likes} | 🔄 ${tweet.stats.retweets}\n`
      ).join('\n');
  }

  static formatGemsResponse(gems) {
    if (!gems?.length) return "No gems found today. Check back later! 💎";

    return '*Today\'s Top Gems* 💎\n\n' +
      gems.slice(0, 5).map((gem, i) =>
        `${i + 1}. *${gem.symbol}*\n` +
        `• Network: ${networkState.getNetworkDisplay(gem.network)}\n` +
        `• Rating: ${gem.metrics?.rating || 'N/A'}/10\n` +
        `• Social Score: ${this.formatSocialMetrics(gem.metrics)}\n`
      ).join('\n') +
      '\n_Ratings based on social metrics & interest_';
  }

  static formatSocialMetrics(metrics) {
    if (!metrics) return 'N/A';
    return `👁 ${metrics.impressions} | ♥️ ${metrics.likes} | 🔄 ${metrics.retweets}`;
  }

  static formatPortfolio(wallets) {
    if (!wallets?.length) return "No wallets found.";

    return '*Portfolio Overview* 👛\n\n' +
      wallets.map(wallet =>
        `*${networkState.getNetworkDisplay(wallet.network)}*\n` +
        `Address: \`${formatAddress(wallet.address)}\`\n` +
        `Balance: ${formatBalance(wallet.balance)}\n`
      ).join('\n');
  }

  static formatPositions(positions) {
    if (!positions?.length) return "No open positions.";

    return '*Open Positions* 📊\n\n' +
      positions.map((pos, i) =>
        `${i + 1}. *${pos.token.symbol}*\n` +
        `• Entry: $${formatBalance(pos.entryPrice)}\n` +
        `• Current: $${formatBalance(pos.currentPrice)}\n` +
        `• P/L: ${pos.profitLoss.toFixed(2)}%\n`
      ).join('\n');
  }

  static formatAlerts(alerts) {
    if (!alerts?.length) return "No active alerts.";

    return '*Active Alerts* ⚡\n\n' +
      alerts.map((alert, i) =>
        `${i + 1}. *${alert.token.symbol}*\n` +
        `• Target: $${formatBalance(alert.targetPrice)}\n` +
        `• Condition: ${alert.condition}\n` +
        `• Auto-Trade: ${alert.swapAction?.enabled ? '✅' : '❌'}\n`
      ).join('\n');
  }

  static formatTradeHistory(trades) {
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
}