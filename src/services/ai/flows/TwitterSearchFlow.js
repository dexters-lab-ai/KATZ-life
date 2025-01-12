import { BaseFlow } from './BaseFlow.js';
import { twitterService } from '../../twitter/index.js';
import { quickNodeService } from '../../quicknode/QuickNodeService.js';
import { dextools } from '../../dextools/index.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class TwitterSearchFlow extends BaseFlow {
  constructor() {
    super();
    this.steps = ['search', 'analyze', 'response'];
  }

  async start(initialData) {
    return {
      currentStep: 0,
      data: {
        ...initialData,
        startTime: Date.now()
      },
      response: 'Searching Twitter and analyzing token...'
    };
  }

  async processStep(state, input) {
    try {
      const currentStep = this.steps[state.currentStep];

      switch (currentStep) {
        case 'search':
          return await this.handleSearch(state);
        case 'analyze':
          return await this.handleAnalysis(state);
        case 'response':
          return await this.handleResponse(state);
        default:
          throw new Error('Invalid flow step');
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async handleSearch(state) {
    const { cashtag, context } = state.data;
    
    try {
      // Get tweets
      const tweets = await twitterService.searchTweets(cashtag);

      // Detect network from tweets
      const network = this.detectNetworkFromTweets(tweets);

      // Get token info based on network
      let tokenInfo;
      if (network === 'solana') {
        // Use QuickNode for Solana tokens
        tokenInfo = await quickNodeService.getTokenMetadata(cashtag);
      } else {
        // Use DexTools for EVM tokens
        tokenInfo = await dextools.getTokenInfo(network, cashtag);
      }

      return {
        completed: false,
        flowData: {
          ...state,
          currentStep: 1,
          tweets,
          network,
          tokenInfo
        },
        response: 'Analyzing tweets and token data...'
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async handleAnalysis(state) {
    const { tweets, tokenInfo, context } = state.data;

    try {
      // Format tweets for analysis
      const tweetData = tweets.map(tweet => ({
        text: tweet.text,
        author: tweet.author,
        stats: tweet.stats,
        url: tweet.url
      }));

      // Generate analysis
      const analysisPrompt = {
        role: 'system',
        content: 'Analyze these tweets and token data to answer the user\'s question:',
        data: {
          tweets: tweetData,
          token: tokenInfo,
          userQuestion: context
        }
      };

      const analysis = await openAIService.generateAIResponse(analysisPrompt, 'sentiment_analysis');

      return {
        completed: false,
        flowData: {
          ...state,
          currentStep: 2,
          analysis: JSON.parse(analysis)
        },
        response: await this.formatResponse(state, analysis)
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async handleResponse(state) {
    return {
      completed: true,
      response: state.response
    };
  }

  detectNetworkFromTweets(tweets) {
    // Look for network mentions in tweets
    const networkKeywords = {
      solana: ['solana', 'sol', 'spl'],
      ethereum: ['ethereum', 'eth', 'erc20'],
      base: ['base', 'basechain']
    };

    for (const tweet of tweets) {
      const text = tweet.text.toLowerCase();
      for (const [network, keywords] of Object.entries(networkKeywords)) {
        if (keywords.some(keyword => text.includes(keyword))) {
          return network;
        }
      }
    }

    return 'solana'; // Default to Solana if no network detected
  }

  async formatResponse(state, analysis) {
    const { tweets, tokenInfo, network } = state.data;
    const parsedAnalysis = JSON.parse(analysis);

    const response = [
      `*${tokenInfo.symbol} Analysis* 🔍\n`,
      `Network: ${network.toUpperCase()}\n`,
      tokenInfo.price ? `Price: $${tokenInfo.price}\n` : '',
      `\n*Social Analysis* 📊\n`,
      `• Tweet Volume: ${tweets.length} tweets in 24h\n`,
      `• Engagement: ${this.calculateEngagement(tweets)}\n`,
      `• Sentiment: ${parsedAnalysis.sentiment}\n\n`,
      '*Top Tweets:*\n',
      ...tweets.slice(0, 3).map(tweet => 
        `• ${tweet.text.slice(0, 100)}...\n` +
        `  ❤️ ${tweet.stats.likes} | 🔄 ${tweet.stats.retweets}\n` +
        `  [View Tweet](${tweet.url})\n`
      ),
      '\n*Analysis:*\n',
      parsedAnalysis.summary,
      '\n*Answer to Your Question:*\n',
      parsedAnalysis.answer
    ];

    return response.join('');
  }

  calculateEngagement(tweets) {
    const total = tweets.reduce((sum, t) => 
      sum + t.stats.likes + t.stats.retweets, 0
    );
    return (total / tweets.length).toFixed(2);
  }
}