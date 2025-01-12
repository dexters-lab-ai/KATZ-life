import { EventEmitter } from 'events';
import { User } from '../../../../models/User.js';
import { openAIService } from '../../openai.js';
import { ErrorHandler } from '../../../../core/errors/index.js';
import { db } from '../../../../core/database.js';

export class UserLearningSystem extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.preferencesCollection = null;
    this.strategyCollection = null;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      await db.connect();
      const database = db.getDatabase();
      
      this.preferencesCollection = database.collection('userPreferences');
      this.strategyCollection = database.collection('userStrategies');
      
      await this.setupIndexes();
      this.initialized = true;
      console.log('✅ UserLearningSystem initialized');
    } catch (error) {
      console.error('❌ Error initializing UserLearningSystem:', error);
      throw error;
    }
  }

  async setupIndexes() {
    await this.preferencesCollection.createIndex({ userId: 1 });
    await this.strategyCollection.createIndex({ userId: 1 });
    await this.strategyCollection.createIndex({ 'performance.score': -1 });
  }

  async updateUserPreferences(userId, tradeData) {
    try {
      const preferences = await this.analyzeTradePreferences(tradeData);
      
      await this.preferencesCollection.updateOne(
        { userId },
        {
          $set: {
            preferences,
            lastUpdated: new Date()
          }
        },
        { upsert: true }
      );

      return preferences;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async analyzeTradePreferences(tradeData) {
    const prompt = {
      role: 'system',
      content: 'Analyze trading behavior to determine preferences:',
      data: tradeData
    };

    const analysis = await openAIService.generateAIResponse(prompt, 'preference_analysis');
    return JSON.parse(analysis);
  }

  async getTopStrategies(userId, limit = 4) {
    return this.strategyCollection
      .find({ userId })
      .sort({ 'performance.score': -1 })
      .limit(limit)
      .toArray();
  }

  async proposeStrategyChanges(userId, currentStrategy, performance) {
    try {
      const prompt = {
        role: 'system',
        content: 'Analyze strategy performance and propose improvements:',
        strategy: currentStrategy,
        performance
      };

      const proposal = await openAIService.generateAIResponse(prompt, 'strategy_proposal');
      const changes = JSON.parse(proposal);

      await this.saveProposal(userId, changes);
      return changes;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async applyStrategyChanges(userId, strategyId, changes) {
    try {
      const strategy = await this.strategyCollection.findOne({
        _id: strategyId,
        userId
      });

      if (!strategy) {
        throw new Error('Strategy not found');
      }

      const updatedStrategy = {
        ...strategy,
        ...changes,
        version: (strategy.version || 1) + 1,
        lastModified: new Date()
      };

      await this.strategyCollection.updateOne(
        { _id: strategyId },
        { $set: updatedStrategy }
      );

      return updatedStrategy;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async saveProposal(userId, proposal) {
    await this.strategyCollection.updateOne(
      { userId },
      {
        $push: {
          proposals: {
            ...proposal,
            timestamp: new Date(),
            status: 'pending'
          }
        }
      }
    );
  }

  cleanup() {
    this.removeAllListeners();
    this.initialized = false;
  }
}

export const userLearningSystem = new UserLearningSystem();