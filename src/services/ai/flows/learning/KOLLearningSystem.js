import { EventEmitter } from 'events';
import { twitterService } from '../../../twitter/index.js';
import { openAIService } from '../../openai.js';
import { ErrorHandler } from '../../../../core/errors/index.js';
import { db } from '../../../../core/database.js';

export class KOLLearningSystem extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.kolCollection = null;
    this.patternCollection = null;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      await db.connect();
      const database = db.getDatabase();
      
      this.kolCollection = database.collection('kolData');
      this.patternCollection = database.collection('kolPatterns');
      
      await this.setupIndexes();
      this.initialized = true;
      console.log('✅ KOLLearningSystem initialized');
    } catch (error) {
      console.error('❌ Error initializing KOLLearningSystem:', error);
      throw error;
    }
  }

  async setupIndexes() {
    await this.kolCollection.createIndex({ handle: 1 });
    await this.kolCollection.createIndex({ 'performance.score': -1 });
    await this.patternCollection.createIndex({ kolId: 1 });
  }

  async analyzeKOLPatterns(handle) {
    try {
      // Get KOL's tweets and trades
      const tweets = await twitterService.searchTweets(handle);
      const trades = await this.getKOLTrades(handle);

      // Extract patterns
      const patterns = await this.extractKOLPatterns(tweets, trades);
      
      // Validate and rank patterns
      const validatedPatterns = await this.validatePatterns(patterns);
      const rankedPatterns = this.rankPatterns(validatedPatterns);

      // Update KOL data
      await this.updateKOLData(handle, {
        patterns: rankedPatterns,
        lastAnalyzed: new Date()
      });

      return rankedPatterns;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async extractKOLPatterns(tweets, trades) {
    const prompt = {
      role: 'system',
      content: 'Analyze KOL tweets and trades to identify patterns:',
      data: { tweets, trades }
    };

    const analysis = await openAIService.generateAIResponse(prompt, 'kol_analysis');
    return JSON.parse(analysis);
  }

  async validatePatterns(patterns) {
    return patterns.filter(pattern => {
      const isValid = this.validatePattern(pattern);
      if (!isValid) {
        console.warn(`Invalid KOL pattern detected:`, pattern);
      }
      return isValid;
    });
  }

  validatePattern(pattern) {
    return (
      pattern.trigger &&
      pattern.conditions &&
      pattern.successRate >= 0 &&
      pattern.successRate <= 100
    );
  }

  rankPatterns(patterns) {
    return patterns.sort((a, b) => {
      const aScore = this.calculatePatternScore(a);
      const bScore = this.calculatePatternScore(b);
      return bScore - aScore;
    });
  }

  calculatePatternScore(pattern) {
    return (
      pattern.successRate * 0.4 +
      pattern.profitFactor * 0.3 +
      pattern.frequency * 0.2 +
      pattern.reliability * 0.1
    );
  }

  async updateKOLData(handle, data) {
    await this.kolCollection.updateOne(
      { handle },
      {
        $set: {
          ...data,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
  }

  async getKOLTrades(handle) {
    // Implement KOL trade history fetching
    return [];
  }

  cleanup() {
    this.removeAllListeners();
    this.initialized = false;
  }
}

export const kolLearningSystem = new KOLLearningSystem();