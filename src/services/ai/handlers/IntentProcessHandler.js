// Core imports
import axios from 'axios';
import { EventEmitter } from 'events';
import { ErrorHandler } from '../../../core/errors/index.js';
import { retryManager } from '../../queue/RetryManager.js';

// AI Services
import { openAIService } from '../openai.js';
import { aiService } from '../index.js';
import { contextManager } from '../ContextManager.js';
import { FlowManager } from '../flows/FlowManager.js';

// External Services
import { braveSearch } from '../../brave/BraveSearchService.js';
import { shopifyService } from '../../shopify/ShopifyService.js';
import { dextools } from '../../dextools/index.js';
import { timedOrderService } from '../../timedOrders.js';
import { priceAlertService } from '../../priceAlerts.js';
import { walletService } from '../../wallet/index.js';
import { twitterService } from '../../twitter/index.js';
import { solanaPayService } from '../../solanaPay/SolanaPayService.js';
import { butlerService } from '../../butler/ButlerService.js';
import { dbAIInterface } from '../../db/DBAIInterface.js';
import { gemsService } from '../../gems/GemsService.js';
import { flipperMode } from '../../pumpfun/FlipperMode.js';

export class IntentProcessHandler {
    constructor() {
        this.flowManager = new FlowManager();
        this.activeFlows = new Map();

        this.axiosInstance = axios.create({
            baseURL: 'https://api.coingecko.com/api/v3',
            headers: {
              'accept': 'application/json',
              'x-cg-demo-api-key': 'CG-LFDubYkjAMbfAkjQ4NsNjVeV'
            }
        });
        this.marketDataCache = {
            data: null,
            timestamp: 0,
            ttl: 5 * 60 * 1000 // 5 minutes cache
        };
    }

    // Handlers to intents
    isDemoRequest(text) {
        const demoPatterns = [
        /show.*demo/i,
        /demonstrate/i,
        /showcase/i,
        /example.*capability/i
        ];
        return demoPatterns.some(pattern => pattern.test(text));
    }
    
    async handleDemoMode(text) {
        try {
        const demo = await demoManager.runRandomDemo();
        return {
            text: this.formatDemoResponse(demo),
            type: 'demo'
        };
        } catch (error) {
        await ErrorHandler.handle(error);
        throw error;
        }
    }
    
    async handleTokenAddress(address, userId) {
        try {
          // Validate address format
          const network = this.detectNetwork(address);
          if (!network) {
            throw new Error('Invalid token address format');
          }
      
          // For EVM addresses, validate checksum
          if (network === 'ethereum' || network === 'base') {
            if (!ethers.isAddress(address)) {
              throw new Error('Invalid EVM address checksum');
            }
          }
      
          // For Solana addresses, validate pubkey
          if (network === 'solana') {
            try {
              new PublicKey(address);
            } catch {
              throw new Error('Invalid Solana public key');
            }
          }
      
          // Get token info with retries
          const tokenInfo = await retryManager.executeWithRetry(
            async () => await dextools.getTokenInfo(network, address)
          );
      
          if (!tokenInfo) {
            throw new Error('Token info not found');
          }
      
          // Get available actions for user
          const actions = await this.getAvailableActions(network, address, userId);
      
          // Format response
          return {
            token: tokenInfo,
            network,
            actions,
            message: this.formatResponse(tokenInfo, actions)
          };
      
        } catch (error) {
          await ErrorHandler.handle(error);
          throw error;
        }
    }

    detectNetwork(address) {
        // Detect network from address format
        if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
            return 'ethereum'; // or 'base' - will need additional logic
        } else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
            return 'solana';
        }
        return null;
    }
    
    async getAvailableActions(network, address, userId) {
    const actions = [];

    try {
        // Check if user has wallet for this network
        const hasWallet = await this.userHasWallet(userId, network);

        // Add available actions
        actions.push({
        type: 'scan',
        name: '🔍 Scan Token',
        description: 'Analyze token metrics and risks'
        });

        if (hasWallet) {
        actions.push({
            type: 'buy',
            name: '💰 Buy Token',
            description: 'Purchase this token'
        });

        const balance = await this.getTokenBalance(userId, network, address);
        if (balance > 0) {
            actions.push({
            type: 'sell',
            name: '💱 Sell Token',
            description: `Sell your ${balance} tokens`
            });
        }

        if (network === 'solana') {
            actions.push({
            type: 'solana_pay',
            name: '💸 Solana Pay',
            description: 'Send/receive using Solana Pay'
            });
        } else {
            actions.push({
            type: 'transfer',
            name: '📤 Transfer',
            description: 'Send tokens to another address'
            });
        }
        }

        return actions;
    } catch (error) {
        await ErrorHandler.handle(error);
        return actions; // Re
    }
    }

    async userHasWallet(userId, network) {
        try {
          const wallets = await walletService.getWallets(userId);
          return wallets.some(w => w.network === network);
        } catch (error) {
          return false;
        }
    }

    hasRiskLimitPattern(text) {
      const riskPatterns = [
        /risk\s*(?:less than|under|max|maximum)?\s*([\d.]+)%/i,
        /only\s*([\d.]+)%\s*of\s*(?:my)?\s*portfolio/i,
        /use\s*([\d.]+)%\s*of\s*(?:my)?\s*balance/i,
        /limit\s*(?:to|at)?\s*([\d.]+)%/i
      ];
  
      return riskPatterns.some(pattern => pattern.test(text));
    }
    
    async getTokenBalance(userId, network, address) {
        try {
            const wallets = await walletService.getWallets(userId);
            const wallet = wallets.find(w => w.network === network);
            if (!wallet) return 0;
        
            const balance = await walletService.getTokenBalance(
            userId,
            wallet.address,
            address
            );
            return balance;
        } catch (error) {
            return 0;
        }
    }
    
    formatResponse(token, actions) {
    return `*Token Detected* 🪙\n\n` +
            `Symbol: ${token.symbol}\n` +
            `Network: ${token.network}\n` +
            `Price: $${token.price || 'Unknown'}\n\n` +
            `*Available Actions:*\n` +
            actions.map(action => 
                `• ${action.name}: ${action.description}`
            ).join('\n');
    }
    
    formatDemoResponse(demo) {
        return `${demo.title}\n\n` +
            `${demo.description}\n\n` +
            this.formatDemoResults(demo);
    }
    
    formatDemoResults(demo) {
        switch (demo.type) {
        case 'twitter_search':
            return demo.results.map(tweet =>
            `🐦 @${tweet.author}:\n${tweet.text}\n` +
            `❤️ ${tweet.stats.likes} | 🔄 ${tweet.stats.retweets}\n`
            ).join('\n');
    
        case 'token_analysis':
            return demo.results;
    
        case 'news_search':
            return demo.results.map(article =>
            `📰 ${article.title}\n${article.description}\n`
            ).join('\n');
    
        case 'market_analysis':
            return Object.entries(demo.results).map(([chain, tokens]) =>
            `*${chain}*\n` +
            tokens.map(token => `• ${token.symbol}: $${token.price}`).join('\n')
            ).join('\n\n');
    
        default:
            return JSON.stringify(demo.results, null, 2);
        }
    }

    async handleCashtagQuery(msg, userId) {
        const cashtag = msg.text.substring(1).split(' ')[0];
        await flowManager.startFlow(userId, 'twitter_search', {
          cashtag,
          context: msg.context
        });
        
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

    async performInternetSearch(text) {
        try {
        // Log search attempt
        console.log('🔍 Performing internet search:', text);
    
        // Execute search
        const results = await braveSearch.search(text);
    
        // Format response
        const response = {
            text: `*Search Results* 🔍\n\n${
            results.map((result, i) => 
                `${i + 1}. *${result.title}*\n` +
                `${result.description}\n` +
                `[Read more](${result.url})\n`
            ).join('\n')
            }`,
            type: 'search',
            parse_mode: 'Markdown'
        };
    
        console.log('✅ Search completed with', results.length, 'results');
        return response;
    
        } catch (error) {
        console.error('❌ Search error:', error);
        await ErrorHandler.handle(error);
        
        return {
            text: "I encountered an error performing the search. Please try again.",
            type: 'error'
        };
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

    // Market Overview Handlers
    async getMarketConditions() {
        try {
          // Check cache first
          if (this.isMarketDataCacheValid()) {
            return this.marketDataCache.data;
          }
    
          // Fetch both global market data and DeFi data
          const [marketData, defiData] = await Promise.all([
            this.axiosInstance.get('/global'),
            this.axiosInstance.get('/global/decentralized_finance_defi')
          ]);
    
          // Format and combine the data
          const conditions = {
            overview: {
              total_market_cap_usd: marketData.data.data.total_market_cap.usd,
              total_volume_usd: marketData.data.data.total_volume.usd,
              market_cap_change_24h: marketData.data.data.market_cap_change_percentage_24h_usd,
              active_cryptocurrencies: marketData.data.data.active_cryptocurrencies,
              active_markets: marketData.data.data.markets
            },
            dominance: {
              ...marketData.data.data.market_cap_percentage
            },
            defi: {
              total_value_locked: defiData.data.data.defi_market_cap,
              defi_dominance: defiData.data.data.defi_dominance,
              top_protocol: defiData.data.data.top_coin_name,
              top_protocol_dominance: defiData.data.data.top_coin_defi_dominance,
              eth_market_cap: defiData.data.data.eth_market_cap,
              trading_volume_24h: defiData.data.data.trading_volume_24h
            },
            market_sentiment: this.calculateMarketSentiment(marketData.data.data),
            timestamp: new Date().toISOString()
          };
    
          // Update cache
          this.marketDataCache = {
            data: conditions,
            timestamp: Date.now(),
            ttl: 5 * 60 * 1000
          };
    
          return conditions;
        } catch (error) {
          await ErrorHandler.handle(error);
          console.error('Error fetching market conditions:', error);
          
          // Return cached data if available, even if expired
          if (this.marketDataCache.data) {
            return {
              ...this.marketDataCache.data,
              stale: true
            };
          }
          
          // Return minimal data if no cache available
          return {
            overview: {
              total_market_cap_usd: 0,
              market_cap_change_24h: 0,
              active_cryptocurrencies: 0,
              active_markets: 0
            },
            error: 'Failed to fetch market data',
            timestamp: new Date().toISOString()
          };
        }
    }
    
    isMarketDataCacheValid() {
        return (
          this.marketDataCache.data &&
          Date.now() - this.marketDataCache.timestamp < this.marketDataCache.ttl
        );
    }
    
    calculateMarketSentiment(data) {
        // Calculate market sentiment based on various metrics
        const metrics = {
            cap_change: data.market_cap_change_percentage_24h_usd,
            btc_dom: data.market_cap_percentage?.btc || 0,
            eth_dom: data.market_cap_percentage?.eth || 0
        };

        let sentiment = 'neutral';
        let confidence = 0.5;

        // Basic sentiment logic
        if (metrics.cap_change > 5) {
            sentiment = 'bullish';
            confidence = Math.min(0.5 + (metrics.cap_change / 20), 0.9);
        } else if (metrics.cap_change < -5) {
            sentiment = 'bearish';
            confidence = Math.min(0.5 + (Math.abs(metrics.cap_change) / 20), 0.9);
        }

        // Adjust based on BTC dominance changes
        const btcDomChange = metrics.btc_dom - 40; // 40% as baseline
        if (Math.abs(btcDomChange) > 5) {
            confidence += 0.1;
        }

        return {
            overall: sentiment,
            confidence: parseFloat(confidence.toFixed(2)),
            metrics
        };
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

    async handleContextualResponse(analysis, msg, context) {
        try {
        // Build enhanced prompt with context
        const enhancedPrompt = {
            role: 'system',
            content: `Analyze message with context. Intent: ${analysis.intent}`,
            messages: context
        };
    
        // Generate contextual response
        const response = await openAIService.generateAIResponse(enhancedPrompt);
    
        // Update context with new interaction
        await this.contextManager.updateContext(msg.userId, msg.text, response);
    
        return {
            text: response,
            type: 'contextual',
            requiresFollowUp: true
        };
        } catch (error) {
        await ErrorHandler.handle(error);
        throw error;
        }
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
          content: 'You are KATZ having a conversation. Maintain sarcastic personality about crypto/meme trading, research, shopify, payments, internet news, twitter trends, pumpfun, bitcoin, tasks and reminders. Consise responses',
          messages: [...safeContext, { role: 'user', content: text }]
        };
    }  
}