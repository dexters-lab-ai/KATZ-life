// src/services/dexscreener/index.js
import axios from 'axios';
import { cacheService } from '../cache/CacheService.js';
import { ErrorHandler } from '../../core/errors/index.js';
import { rateLimiter } from '../../core/rate-limiting/RateLimiter.js';

const BASE_URL = 'https://api.dexscreener.com/latest';
const CACHE_DURATION = 60000; // 1 minute
const RATE_LIMIT = {
  windowMs: 60000,
  maxRequests: 60
};

class DexScreenerService {
  constructor() {
    this.api = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    // Add response interceptor for error handling
    this.api.interceptors.response.use(
      response => response,
      error => this.handleApiError(error)
    );
  }

  async fetchWithCache(endpoint, params = {}, cacheKey) {
    // Check rate limits first
    const isLimited = await rateLimiter.isRateLimited('dexscreener', endpoint);
    if (isLimited) {
      throw new Error('Rate limit exceeded');
    }

    // Check cache
    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.api.get(endpoint, { params });
      const data = response.data;

      // Cache valid responses
      await cacheService.set(cacheKey, data, CACHE_DURATION);
      return data;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  // Proper endpoint implementations based on docs
  async getPairsByChainAndPair(chainId, pairId) {
    return this.fetchWithCache(
      `/pairs/${chainId}/${pairId}`,
      {},
      `dexscreener:pairs:${chainId}:${pairId}`
    );
  }

  async searchPairs(query) {
    return this.fetchWithCache(
      `/search/pairs`,
      { query },
      `dexscreener:search:${query}`
    );
  }

  async getTokenPairs(tokenAddresses) {
    if (!Array.isArray(tokenAddresses)) {
      tokenAddresses = [tokenAddresses];
    }
    return this.fetchWithCache(
      `/tokens/${tokenAddresses.join(',')}`,
      {},
      `dexscreener:tokens:${tokenAddresses.join('-')}`
    );
  }

  // Improved error handling
  async handleApiError(error) {
    const errorData = {
      status: error.response?.status,
      message: error.response?.data?.error || error.message,
      endpoint: error.config?.url
    };

    // Log error
    console.error('DexScreener API error:', errorData);

    // Handle specific error cases
    switch (errorData.status) {
      case 429:
        throw new Error('DexScreener rate limit exceeded');
      case 404:
        throw new Error('Pair or token not found');
      default:
        throw new Error(`DexScreener API error: ${errorData.message}`);
    }
  }

  // Proper result formatting
  formatPairData(pair) {
    if (!pair) return null;

    return {
      chainId: pair.chainId,
      dexId: pair.dexId,
      pairAddress: pair.pairAddress,
      baseToken: {
        address: pair.baseToken.address,
        name: pair.baseToken.name,
        symbol: pair.baseToken.symbol
      },
      priceUsd: pair.priceUsd,
      priceChange: {
        h1: pair.priceChange.h1,
        h24: pair.priceChange.h24
      },
      liquidity: {
        usd: pair.liquidity.usd,
        base: pair.liquidity.base,
        quote: pair.liquidity.quote
      },
      volume: {
        h24: pair.volume.h24,
        h6: pair.volume.h6,
        h1: pair.volume.h1
      }
    };
  }
}

export const dexscreener = new DexScreenerService();
