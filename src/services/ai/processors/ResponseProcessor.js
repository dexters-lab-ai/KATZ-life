import { openAIService } from '../openai.js';
import { formatIntentResponse } from '../intents.js';

export class ResponseProcessor {
  constructor() {
    this.openAI = openAIService;
  }

  async generateResponse(text, intent, userId, context) {
    try {
      // Build conversation context
      const messages = this.buildConversationContext(text, context);

      // Generate AI response
      const aiResponse = await this.openAI.generateAIResponse(messages, 'chat');

      // Format response based on intent
      return formatIntentResponse(intent, {
        response: aiResponse,
        context: messages
      }, userId);
    } catch (error) {
      console.error('Error generating response:', error);
      throw error;
    }
  }

  buildConversationContext(text, context) {
    // Format previous conversation context
    const contextMessages = context.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Add system prompt for personality
    return [
      {
        role: 'system',
        content: `You are KATZ, a sarcastic AI trading assistant from Courage the Cowardly Dog. 
                 You help users with crypto trading while maintaining your witty personality.
                 Always end responses with a sarcastic warning about getting rekt.`
      },
      ...contextMessages,
      {
        role: 'user',
        content: text
      }
    ];
  }
}