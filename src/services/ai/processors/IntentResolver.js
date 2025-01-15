import { TRADING_INTENTS, INTENT_PATTERNS } from '../intents.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class IntentResolver {
  constructor() {
    this.intentPatterns = new Map();
    this.initializePatterns();
  }

  initializePatterns() {
    Object.entries(INTENT_PATTERNS).forEach(([intent, patterns]) => {
      this.intentPatterns.set(intent, patterns.map(p => p.toLowerCase()));
    });
  }

  resolveIntent(text, context = []) {
    try {
      const normalizedInput = text.toLowerCase();
      
      // Check for compound intents
      const compoundIntents = this.matchCompoundIntents(normalizedInput);
      if (compoundIntents.length > 0) {
        return {
          type: 'compound',
          intents: compoundIntents
        };
      }

      // Check for single intent
      for (const [intent, patterns] of this.intentPatterns) {
        for (const pattern of patterns) {
          if (normalizedInput.includes(pattern)) {
            return {
              type: 'single',
              intent: intent
            };
          }
        }
      }

      // Default to chat or greeting based on context
      // DEFAULT TO AI BASED INTENT CHECKING IN INTENT ANALYZER
      return {
        type: 'single',
        intent: context.length > 0 ? TRADING_INTENTS.CHAT : TRADING_INTENTS.GREETING
      };
    } catch (error) {
      ErrorHandler.handle(error);
      return {
        type: 'single',
        intent: TRADING_INTENTS.CHAT
      };
    }
  }

  matchCompoundIntents(text) {
    const intents = [];
    const conjunctions = ['and', 'then', 'after'];
    
    // Split text by conjunctions
    const parts = text.split(new RegExp(`\\s+(${conjunctions.join('|')})\\s+`));
    
    for (const part of parts) {
      for (const [intent, patterns] of this.intentPatterns) {
        for (const pattern of patterns) {
          if (part.includes(pattern)) {
            intents.push(intent);
            break;
          }
        }
      }
    }

    return intents;
  }
}