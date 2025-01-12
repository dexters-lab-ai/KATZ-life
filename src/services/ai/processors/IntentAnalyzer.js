import { openAIService } from '../openai.js';
import { TRADING_INTENTS, INTENT_PATTERNS } from '../intents.js';
import { ErrorHandler } from '../../../core/errors/index.js';
import { UnifiedMessageProcessor } from './UnifiedMessageProcessor.js';
import { validateParameters, getParameterConfig } from '../config/parameterConfig.js';

export class IntentAnalyzer {
  constructor() {
    this.initialized = false;
    this.messageProcessor = new UnifiedMessageProcessor();
    this.parameterConfig = getParameterConfig
  }

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
  }

  async analyzeIntent(text, context = []) {
    try {
      // Build system prompt
      const prompt = {
        role: 'system',
        content: this.buildPrompt(),
        messages: [...context, { role: 'user', content: text }]
      };

      // Get AI analysis
      const analysis = await openAIService.generateAIResponse(prompt, 'intent_analysis');
      const parsed = JSON.parse(analysis);

      // Validate parameters using parameterConfig
      await validateParameters(parsed.intent, parsed.parameters);

      // Check for compound intent patterns
      const isCompound = this.detectCompoundPatterns(text);

      return {
        type: isCompound ? 'compound' : 'single',
        intent: parsed.intent,
        parameters: parsed.parameters,
        confidence: parsed.confidence,
        metadata: this.generateMetadata(parsed)
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  buildPrompt() {
    // Build prompt using parameterConfig
    const intentDescriptions = Array.from(parameterConfig.entries())
      .map(([intent, config]) => {
        return `${intent}:
          Required: ${config.required.join(', ') || 'none'}
          Optional: ${config.optional.join(', ') || 'none'}`;
      })
      .join('\n\n');

    return `You are KATZ analyzing user messages for intent and parameters.
            Available Intents and Parameters:
            ${intentDescriptions}
            
            Return JSON with:
            {
              "intent": string,
              "confidence": number,
              "parameters": {
                // All required and any optional parameters for the intent
              }
            }`;
  }

  async validateIntents(intents) {
    return Promise.all(intents.map(async (intent) => {
      const config = this.parameterConfig.get(intent.type);
      if (!config) return intent;

      // Validate required parameters
      const missingParams = config.required.filter(
        param => !intent.parameters?.[param]
      );

      if (missingParams.length > 0) {
        throw new Error(`Missing required parameters for ${intent.type}: ${missingParams.join(', ')}`);
      }

      // Validate parameter values
      for (const [param, value] of Object.entries(intent.parameters)) {
        const validator = config.validation[param];
        if (validator && !validator(value)) {
          throw new Error(`Invalid value for parameter ${param} in ${intent.type}`);
        }
      }

      return {
        ...intent,
        validatedParameters: true
      };
    }));
  }

  generateMetadata(intents) {
    return {
      totalIntents: intents.length,
      categories: [...new Set(intents.map(i => i.category))],
      hasConditions: intents.some(i => i.conditions),
      requiresApproval: intents.some(i => 
        i.type === TRADING_INTENTS.TOKEN_TRADE && 
        i.parameters?.action === 'sell'
      ),
      isMultiStep: intents.length > 1,
      networks: [...new Set(intents.map(i => i.parameters?.network).filter(Boolean))]
    };
  }
}

export const intentAnalyzer = new IntentAnalyzer();