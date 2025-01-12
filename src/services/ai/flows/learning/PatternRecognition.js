import { EventEmitter } from 'events';
import { openAIService } from '../../openai.js';
import { ErrorHandler } from '../../../../core/errors/index.js';

export class PatternRecognizer extends EventEmitter {
  constructor() {
    super();
  }

  async analyzePatterns(tradeHistory) {
    try {
      const patterns = await this.extractPatterns(tradeHistory);
      const validated = await this.validatePatterns(patterns);
      return this.rankPatterns(validated);
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async extractPatterns(tradeHistory) {
    const prompt = {
      role: 'system',
      content: 'Analyze this trade history and identify recurring patterns:',
      data: tradeHistory
    };

    const analysis = await openAIService.generateAIResponse(prompt, 'pattern_recognition');
    return JSON.parse(analysis);
  }

  async validatePatterns(patterns) {
    return patterns.filter(pattern => {
      const isValid = this.validatePattern(pattern);
      if (!isValid) {
        console.warn(`Invalid pattern detected:`, pattern);
      }
      return isValid;
    });
  }

  validatePattern(pattern) {
    return (
      pattern.conditions &&
      pattern.actions &&
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
}

export const patternRecognizer = new PatternRecognizer();