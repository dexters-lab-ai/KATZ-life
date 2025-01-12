import axios from 'axios';
import { EventEmitter } from 'events';
import { ApifyClient } from 'apify-client';
import { User } from '../../../models/User.js';
import { walletService } from '../../wallet/index.js';
import { tradeService } from '../../trading/TradeService.js';
import { ErrorHandler } from '../../../core/errors/index.js';
import { config } from '../../../core/config.js';

// Rate Limits
const RATE_LIMITS = {
    searchInterval: 60000,
    maxSearchesPerInterval: 10
};

// Retry config
const RETRY_CONFIG = {
    attempts: 3,
    delay: 1000,
    backoff: 2
};

// Axios instance
const twitterAxios = axios.create({
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json'
    }
});

class TwitterService extends EventEmitter {
  constructor() {
    super();
    
    this.apifyClient = new ApifyClient({ token: config.apifyApiKey });
    this.searchCache = new Map();
    this.searchCounts = new Map();
    this.lastResetTime = Date.now();
    this.activeMonitors = new Map();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      await this.restoreActiveMonitors();
      this.startPeriodicCheck();
      this.initialized = true;
      console.log('✅ TwitterService initialized');
    } catch (error) {
      console.error('❌ Error initializing TwitterService:', error);
      throw error;
    }
  }

  async restoreActiveMonitors() {
    try {
      const users = await User.find({
        'settings.kol.monitors': { $exists: true, $ne: [] }
      });

      for (const user of users) {
        for (const monitor of user.settings.kol.monitors) {
          if (monitor.enabled) {
            await this.startKOLMonitoring(user.telegramId, monitor.handle);
          }
        }
      }
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  async validateHandle(handle) {
    try {
      const run = await this.apifyClient.actor('apify/twitter-profile-scraper').call({
        usernames: [handle],
        maxItems: 1
      });
      const [profile] = await this.apifyClient.dataset(run.defaultDatasetId).listItems();
      return !!profile;
    } catch (error) {
      return false;
    }
  }

  async startKOLMonitoring(userId, handle) {
    try {
      const user = await User.findOne({ telegramId: userId.toString() });
      const monitor = user.settings.kol.monitors.find(m => m.handle === handle);
      
      if (!monitor) throw new Error('Monitor configuration not found');

      const monitorId = `${userId}:${handle}`;
      if (this.activeMonitors.has(monitorId)) {
        console.log(`Monitor already active for ${handle}`);
        return;
      }

      const interval = setInterval(async () => {
        try {
          await this.checkNewTweets(userId, handle, monitor.amount);
        } catch (error) {
          await ErrorHandler.handle(error);
        }
      }, 60000); // Check every minute

      this.activeMonitors.set(monitorId, {
        userId,
        handle,
        interval,
        lastChecked: new Date()
      });

      console.log(`✅ Started monitoring @${handle} for user ${userId}`);
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async checkNewTweets(userId, handle, amount) {
    const monitorId = `${userId}:${handle}`;
    const monitor = this.activeMonitors.get(monitorId);
    
    if (!monitor) return;

    try {
      const run = await this.apifyClient.actor('quacker~twitter-scraper').call({
        searchTerms: [`from:${handle}`],
        maxItems: 10,
        startTime: monitor.lastChecked.toISOString()
      });

      const tweets = await this.apifyClient.dataset(run.defaultDatasetId).listItems();
      
      for (const tweet of tweets) {
        await this.processTweet(userId, tweet, amount);
      }

      monitor.lastChecked = new Date();
      this.activeMonitors.set(monitorId, monitor);
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  async processTweet(userId, tweet, amount) {
    try {
      const tokenInfo = this.extractTokenInfo(tweet.text);
      if (!tokenInfo) return;

      const { symbol, address } = tokenInfo;

      // Execute trade
      await tradeService.executeTrade({
        userId,
        network: 'solana', // Assuming Solana for now
        action: 'buy',
        tokenAddress: address,
        amount: amount.toString(),
        options: {
          slippage: 1,
          autoApprove: true
        }
      });

      this.emit('kolTrade', {
        userId,
        symbol,
        address,
        amount,
        tweet: tweet.url
      });
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  extractTokenInfo(text) {
    // Match token address pattern
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}/);
    if (!addressMatch) return null;

    // Look for token symbol/name before or after address
    const symbolMatch = text.match(/\$([A-Z0-9]+)/);
    
    return {
      address: addressMatch[0],
      symbol: symbolMatch ? symbolMatch[1] : 'Unknown'
    };
  }

  async stopKOLMonitoring(userId, handle) {
    const monitorId = `${userId}:${handle}`;
    const monitor = this.activeMonitors.get(monitorId);
    
    if (monitor) {
      clearInterval(monitor.interval);
      this.activeMonitors.delete(monitorId);
      
      await User.updateOne(
        { telegramId: userId.toString() },
        {
          $set: {
            'settings.kol.monitors.$[monitor].enabled': false
          }
        },
        {
          arrayFilters: [{ 'monitor.handle': handle }]
        }
      );
    }
  }

  async searchTweets(cashtag) {
    try {
      // Check rate limits first
      await this.checkRateLimits();

      // Check cache first
      const cached = this.getFromCache(cashtag);
      if (cached) {
        console.log('📦 Returning cached tweets for:', cashtag);
        return cached;
      }

      let attempt = 0;
      let lastError;

      while (attempt < RETRY_CONFIG.attempts) {
        try {
          // Try Apify first
          const run = await this.apifyClient.actor('quacker~twitter-scraper').call({
            searchTerms: [`$${cashtag}`],
            maxItems: 100,
            addUserInfo: true,
            startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
          });

          const tweets = await this.apifyClient.dataset(run.defaultDatasetId).listItems();
          const formattedTweets = this.formatTweets(tweets);

          // Cache the results
          this.cacheResults(cashtag, formattedTweets);

          return formattedTweets;

        } catch (error) {
          console.warn(`Twitter API attempt ${attempt + 1} failed:`, error);
          lastError = error;

          // Try fallback API if available
          try {
            const fallbackResponse = await this.twitterAxios.get(
              `${config.twitterFallbackUrl}/search?q=${encodeURIComponent(cashtag)}`,
              { headers: { 'X-API-Key': config.twitterFallbackKey } }
            );

            const formattedTweets = this.formatTweets(fallbackResponse.data);
            this.cacheResults(cashtag, formattedTweets);
            return formattedTweets;

          } catch (fallbackError) {
            console.warn('Fallback API also failed:', fallbackError);
          }

          // Increment attempt and delay
          attempt++;
          if (attempt < RETRY_CONFIG.attempts) {
            await new Promise(resolve => 
              setTimeout(resolve, RETRY_CONFIG.delay * Math.pow(RETRY_CONFIG.backoff, attempt))
            );
          }
        }
      }

      // If all attempts fail, throw simplified error
      throw new Error('X(Twitter) API is currently unavailable');

    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }
    
  // Add rate limiting check
  async checkRateLimits() {
    const now = Date.now();
    
    // Reset counts if interval passed
    if (now - this.lastResetTime > RATE_LIMITS.searchInterval) {
      this.searchCounts.clear();
      this.lastResetTime = now;
    }
  
    // Check user's search count
    const currentCount = this.searchCounts.get(userId) || 0;
    if (currentCount >= RATE_LIMITS.maxSearchesPerInterval) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }
  
    // Increment count
    this.searchCounts.set(userId, currentCount + 1);
  }

  formatTweets(tweets) {
    return tweets.map(tweet => ({
      id: tweet.id,
      text: tweet.text,
      author: {
        username: tweet.username,
        name: tweet.fullName,
        followers: tweet.followersCount,
        verified: tweet.verified
      },
      stats: {
        likes: tweet.likeCount,
        retweets: tweet.retweetCount,
        replies: tweet.replyCount
      },
      createdAt: tweet.createdAt,
      url: tweet.url
    }));
  }

  async checkRateLimits() {
    const now = Date.now();
    
    // Reset counts if interval passed
    if (now - this.lastResetTime > RATE_LIMITS.searchInterval) {
      this.searchCounts.clear();
      this.lastResetTime = now;
    }

    // Check user's search count
    const currentCount = this.searchCounts.get(userId) || 0;
    if (currentCount >= RATE_LIMITS.maxSearchesPerInterval) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    // Increment count
    this.searchCounts.set(userId, currentCount + 1);
  }

  getFromCache(cashtag) {
    const cached = this.searchCache.get(cashtag);
    if (cached && Date.now() - cached.timestamp < 300000) {
      return cached.data;
    }
    return null;
  }

  cacheResults(cashtag, data) {
    this.searchCache.set(cashtag, {
      data,
      timestamp: Date.now()
    });
  }

  cleanup() {
    // Clear all monitoring intervals
    for (const monitor of this.activeMonitors.values()) {
      clearInterval(monitor.interval);
    }
    this.activeMonitors.clear();
    
    // Remove all listeners
    this.removeAllListeners();
    this.initialized = false;
    console.log('✅ TwitterService cleaned up');
  }
}

export const twitterService = new TwitterService();