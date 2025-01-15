import { TRADING_INTENTS, INTENT_PATTERNS, INTENT_SAMPLES } from '../intents.js';
import { openAIService } from '../openai.js'; // Example: For NLP support
import { ErrorHandler } from '../../../core/errors/index.js';

class IntentEngine {
  constructor() {
    this.patterns = INTENT_PATTERNS; // Patterns mapped to TRADING_INTENTS
  }

  /**
   * Main entry point to analyze user input and return matching intents.
   * @param {string | object} message - User input.
   * @param {Array<object>} context - Optional session context for additional data.
   * @returns {Promise<object>} - Matched intents and parameters.
   */
  async processMessage(message, context = [
    { role: 'assistant', content: 'How can I help you?' },
    { role: 'user', content: 'Search the web for Solana tokens' },
  ]) {
    try {
      // Extract text if the input is an object
      const text = typeof message === 'string' ? message : message?.text;

      // Validate input
      if (typeof text !== 'string') {
        console.error('❌ Invalid input type for text:', text);
        throw new Error('Invalid input: Text must be a string.');
      }

      // 1. Preprocess Input
      const sanitizedText = text.toLowerCase().trim();
      console.log('🚀 User Input:', sanitizedText);

      // 2. Match Intents via Patterns
      const matchedIntents = this.matchIntentsByPatterns(sanitizedText);

      // 3. If no match, try NLP-based Analysis
      if (matchedIntents.length === 0) {
        console.log('⚠️ No direct pattern match found. Analyzing via AI...');
        const aiResults = await this.analyzeViaAI(sanitizedText, context);
        return aiResults;
      }

      // 4. Extract Parameters and Resolve Context
      const enrichedIntents = matchedIntents.map((intent) => ({
        intent,
        parameters: this.extractParameters(intent, sanitizedText, context),
      }));

      return { type: 'multiple', intents: enrichedIntents };
    } catch (error) {
      console.error('❌ Intent Analysis Error:', error);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  /**
   * Match intents using defined patterns in INTENT_PATTERNS.
   * @param {string} text - User input.
   * @returns {Array<string>} - List of matched intents.
   */
  matchIntentsByPatterns(text) {
    const matchedIntents = [];
    for (const [intent, patterns] of Object.entries(this.patterns)) {
      for (const pattern of patterns) {
        if (text.includes(pattern)) {
          matchedIntents.push(intent);
          break; // Prevent duplicate matching for the same intent
        }
      }
    }
    console.log('🔍 Matched Intents via Patterns:', matchedIntents);
    return matchedIntents;
  }

    /**
   * Analyze input via AI for complex or ambiguous cases.
   * @param {string} text - User input.
   * @param {Array<object>} context - Optional session context.
   * @returns {Promise<object>} - Parsed AI analysis result.
   */
    async analyzeViaAI(text, context) {
      try {
        // Extract only the last message from the user
        const lastUserMessage = { role: 'user', content: text };
  
        // Build the prompt
        const prompt = {
          role: 'system',
          content: this.buildSystemPrompt(),
          messages: [...context, { role: 'user', content: text }],
        };
  
        console.log('📝 AI Prompt Sent:', JSON.stringify(prompt, null, 2));
  
        // Send to AI and parse the response
        const analysis = await openAIService.generateAIResponse(prompt, 'intent_analysis');
        const parsed = JSON.parse(analysis);
  
        console.log('✅ AI Analysis Result:', parsed);
  
        // Enrich the response with metadata
        return {
          type: parsed.intents?.length > 1 ? 'multiple' : 'single',
          intents: parsed.intents || [parsed.intent], // Ensure fallback to single intent structure
          metadata: this.generateMetadata(parsed),
        };
      } catch (error) {
        console.error('❌ AI Analysis Error:', error);
        throw new Error('Failed to analyze intent via AI.');
      }
    }
  

  /**
   * Extract parameters from user input based on the detected intent.
   * @param {string} intent - Detected intent.
   * @param {string} text - User input.
   * @param {object} context - Optional session context.
   * @returns {object} - Extracted parameters.
   */
  extractParameters(intent, text, context) {
    const parameters = {};
    if (intent === TRADING_INTENTS.SWAP_TOKEN || intent === TRADING_INTENTS.TIMED_ORDER) {
      const tokenMatch = text.match(/\$(\w+)/); // Matches tokens like "$BONK"
      const amountMatch = text.match(/(\d+\.?\d*)\s?(sol|eth|usd|bnb)/i); // Matches amounts and units
      if (tokenMatch) parameters.token = tokenMatch[1];
      if (amountMatch) parameters.amount = parseFloat(amountMatch[1]);
    }

    if (intent === TRADING_INTENTS.INTERNET_SEARCH) {
      parameters.query = text.replace(/search for|google|find/gi, '').trim();
    }

    if (context?.wallet) {
      parameters.wallet = context.wallet;
    }

    console.log(`⚙️ Extracted Parameters for ${intent}:`, parameters);
    return parameters;
  }

  /**
   * Generate system prompt for AI-based analysis.
   * @returns {string} - System prompt string.
   */
  buildSystemPrompt() {
    const intentList = Object.keys(TRADING_INTENTS).join(', ');

    return `
      You are an intent analysis engine for a crypto trading app.
      You convert Natural Language Input to an exact intent match, for every existing intent, or none at all.
      As a NLU engine you interprate in common sense, the exact intent the user wants to fire from existing intents list.
      Identify the user's intent(s) from the input text and extract relevant parameters.
      Rate confidence level 0 - 10 for every intent discovered, 0 being worst fit & 10 being exact fit, return one exact fit as confidence score. 
      Respond in JSON format with intents and their parameters. Return nothing else strictly!

      Return JSON with:
              {
                "intent": string,
                "confidence": number,
                "parameters": {
                  // All required and any optional parameters for the intent
                },
                "requiresContext": boolean,
                "suggestedFlow": string|null
              }

      Below are the available intents:
      ${intentList}

      Explanation of the above examples and how to use common sense to find matching intents from user message:
      - Channel general greetings or warm messages to GREETINGS intent.
      - Match trading related intentions to SWAP_TOKEN
      - Match shopping related intentions to PRODUCT_SEARCH
      - Match Bot or Agent capabilies talk to LIST_CAPABILITIES
      - Match any user portfolio or balance talk to PORTFOLIO_VIEW
      - Match any trading strategy related talk to GET_STRATEGIES
      - Match and social media, Twitter or X or KOL or influencer talk to KOL_CHECK
      - etc etc

      Match intents exactly. If no exact match, default to CHAT intent. Follow instructions strictly.

      Current message to process below:
    `;
  }

  /**
   * Generate metadata for logging or further processing.
   * @param {object} parsed - Parsed AI analysis result.
   * @returns {object} - Metadata object.
   */
  generateMetadata(parsed) {
    return {
      timestamp: new Date().toISOString(),
      detectedIntents: parsed.intents,
    };
  }
}

export const messageProcessor = new IntentEngine();
