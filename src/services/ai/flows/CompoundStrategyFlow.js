import { BaseFlow } from './BaseFlow.js';
import { tokenInfoService } from '../../tokens/TokenInfoService.js';
import { twitterService } from '../../twitter/index.js';
import { tradeService } from '../../trading/TradeService.js';
import { timedOrderService } from '../../timedOrders.js';
import { priceAlertService } from '../../priceAlerts.js';
import { walletService } from '../../wallet/index.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class CompoundStrategyFlow {
    async start(initialData) {
      try {
        // Parse the full strategy from natural language
        const strategy = await this.parseStrategy(initialData.naturalLanguageInput);
        
        return {
          currentStep: 0,
          data: {
            ...initialData,
            strategy,
            completedSteps: []
          },
          response: 'Starting strategy execution...'
        };
      } catch (error) {
        await ErrorHandler.handle(error);
        throw error;
      }
    }
  
    async parseStrategy(input) {
      // Extract all intents and their dependencies
      const intents = await this.intentAnalyzer.analyzeCompoundIntent(input);
      
      // Build execution graph
      return {
        intents,
        currentIntent: 0,
        results: new Map(),
        hasMoreIntents() {
          return this.currentIntent < this.intents.length;
        },
        nextIntent() {
          return this.intents[this.currentIntent++];
        }
      };
    }
  
    async processStep(state) {
      try {
        const { strategy } = state;
        
        // Get current intent
        const intent = strategy.intents[strategy.currentIntent];
        
        // Execute the intent
        const result = await this.executeIntent(intent);
        
        // Store result
        strategy.results.set(intent.type, result);
        
        // Move to next intent
        strategy.currentIntent++;
        
        return {
          completed: !strategy.hasMoreIntents(),
          flowData: state,
          response: this.formatResponse(result)
        };
      } catch (error) {
        await ErrorHandler.handle(error);
        throw error;
      }
    }
  
    async executeIntent(intent) {
      switch(intent.type) {
        case TRADING_INTENTS.KOL_CHECK:
          return await twitterService.searchTweets(intent.parameters.cashtag);
          
        case TRADING_INTENTS.TOKEN_SCAN:
          return await tokenInfoService.getTokenAnalysis(
            intent.parameters.network,
            intent.parameters.tokenAddress
          );
          
        case TRADING_INTENTS.QUICK_TRADE:
          return await tradeService.executeTrade(intent.parameters);
          
        case TRADING_INTENTS.PRICE_ALERT:
          return await priceAlertService.createAlert(intent.parameters);
          
        // Add cases for other intents
          
        default:
          throw new Error(`Unsupported intent type: ${intent.type}`);
      }
    }
  }
  