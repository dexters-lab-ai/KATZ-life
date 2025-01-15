import { openAIService } from '../openai.js';
import { TRADING_INTENTS, INTENT_PATTERNS } from '../intents.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class IntentAnalyzer {
  constructor() {
    this.initialized = false;
    this.intentPatterns = new Map();
    this.initializePatterns();
  }

  initializePatterns() {
    Object.entries(INTENT_PATTERNS).forEach(([intent, patterns]) => {
      this.intentPatterns.set(intent, patterns.map(p => ({
        pattern: new RegExp(p, 'i'),
        original: p // Keep original pattern for AI context
      })));
    });
  }

  async analyzeIntent(text, context = []) {
    try {
      // Check for compound intent patterns
      const compoundPatterns = this.detectCompoundPatterns(text);
      if (compoundPatterns.length > 0) {
        return this.analyzeCompoundIntent(text, compoundPatterns, context);
      }

      // Regular intent analysis
      return this.analyzeSingleIntent(text, context);
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  detectCompoundPatterns(text) {
    const patterns = [
      {
        type: 'conditional',
        regex: /if|when|unless|until/i
      },
      {
        type: 'sequential',
        regex: /then|after|before|and/i
      },
      {
        type: 'parallel',
        regex: /while|during|simultaneously/i
      }
    ];

    return patterns.filter(pattern => pattern.regex.test(text));
  }

  async analyzeCompoundIntent(text, patterns, context) {
    const prompt = {
      role: 'system',
      content: systemPrompts.compound_intent,
      messages: [
        ...context,
        {
          role: 'user',
          content: text
        }
      ]
    };

    const analysis = await openAIService.generateAIResponse(prompt, 'compound_intent');
    const intents = JSON.parse(analysis);

    // Validate and sort intents by priority
    return {
      type: 'compound',
      intents: this.validateAndSortIntents(intents),
      confidence: 1.0
    };
  }

  validateAndSortIntents(intents) {
    return intents
      .filter(intent => this.validateIntent(intent))
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  validateIntent(intent) {
    return (
      intent.type &&
      intent.parameters &&
      (!intent.condition || this.validateCondition(intent.condition))
    );
  }

  async analyzeSingleIntent(text, context) {
    const prompt = {
      role: 'system',
      content: `Analyze this message for a single intent.

      Available Intents to match: ${Object.values(TRADING_INTENTS).join(', ')}

      For each intent, these are the typical patterns:
      ${Array.from(this.intentPatterns.entries())
        .map(([intent, patterns]) => 
          `${intent}:
          ${patterns.map(p => p.original).join(', ')}`
        ).join('\n')}

      If no clear or closest matching intent is found, classify as CHAT or GREETING.
      
      Return JSON:
      {
        "type": "single",
        "intent": string,
        "parameters": object,
        "confidence": number,
        "requiresContext": boolean
      }`,
      text,
      context
    };

    const analysis = await openAIService.generateAIResponse(prompt, 'intent_analysis');
    console.log('Aanalysis: ', analysis)
    return JSON.parse(analysis);
  }
}

export const intentAnalyzer = new IntentAnalyzer();