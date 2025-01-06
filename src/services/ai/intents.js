// Future use to enable broadcasts. Import WebSocket broadcasting utility
//import { broadcastUpdate } from '../websocketServer.js'; 

export const TRADING_INTENTS = {
  // Market Analysis
  TRENDING_CHECK: 'TRENDING_CHECK',
  TOKEN_SCAN: 'TOKEN_SCAN',
  MARKET_ANALYSIS: 'MARKET_ANALYSIS',
  KOL_CHECK: 'KOL_CHECK',
  GEMS_TODAY: 'GEMS_TODAY',
  INTERNET_SEARCH: 'INTERNET_SEARCH',

  // Trading Actions
  QUICK_TRADE: 'QUICK_TRADE',
  PRICE_CHECK: 'PRICE_CHECK',
  SWAP_TOKEN: 'SWAP_TOKEN',
  SEND_TOKEN: 'SEND_TOKEN',
  APPROVE_TOKEN: 'APPROVE_TOKEN',
  REVOKE_APPROVAL: 'REVOKE_APPROVAL',
  
  // Automated Trading
  PRICE_ALERT: 'PRICE_ALERT',
  TIMED_ORDER: 'TIMED_ORDER',
  FLIPPER_MODE: 'FLIPPER_MODE',
  FLIPPER_CONFIG: 'FLIPPER_CONFIG',
  FLIPPER_STATUS: 'FLIPPER_STATUS',
  
  // Portfolio Management
  PORTFOLIO_VIEW: 'PORTFOLIO_VIEW',
  POSITION_MANAGE: 'POSITION_MANAGE',
  GAS_ESTIMATE: 'GAS_ESTIMATE',
  
  // Monitoring
  ALERT_MONITOR: 'ALERT_MONITOR',
  TRADE_HISTORY: 'TRADE_HISTORY',

  // Butler Commands
  BUTLER_REMINDER: 'BUTLER_REMINDER',
  BUTLER_MONITOR: 'BUTLER_MONITOR', 
  BUTLER_REPORT: 'BUTLER_REPORT',

  // Payments & Shopping
  SOLANA_PAY: 'SOLANA_PAY',
  SHOPIFY_SEARCH: 'SHOPIFY_SEARCH',
  SHOPIFY_BUY: 'SHOPIFY_BUY',

  // AI Guidelines & Strategies
  SAVE_GUIDELINE: 'SAVE_GUIDELINE',
  GET_GUIDELINES: 'GET_GUIDELINES',
  SAVE_STRATEGY: 'SAVE_STRATEGY',
  GET_STRATEGIES: 'GET_STRATEGIES',

  // Greeting intent
  CHAT: 'CHAT',
  GREETING: 'GREETING',
};

export const INTENT_PATTERNS = {
  [TRADING_INTENTS.TRENDING_CHECK]: [
    'what\'s trending',
    'show trending tokens',
    'top tokens',
    'trending now',
    'hot tokens'
  ],

  [TRADING_INTENTS.TOKEN_SCAN]: [
    'analyze',
    'dyor',
    'scan',
    'research',
    'scan token',
    'analyze token',
    'check token',
    'token info',
    'token details'
  ],

  [TRADING_INTENTS.KOL_CHECK]: [
    'check kol',
    'show tweets',
    'twitter check',
    'kol mentions',
    'influencer posts'
  ],

  [TRADING_INTENTS.QUICK_TRADE]: [
    'buy',
    'sell',
    'swap',
    'trade now',
    'execute trade'
  ],

  [TRADING_INTENTS.PRICE_CHECK]: [
    'price of',
    'token price',
    'how much is',
    'current price',
    'check price'
  ],

  [TRADING_INTENTS.PRICE_ALERT]: [
    'alert me',
    'notify when',
    'set alert',
    'price alert',
    'when price'
  ],

  [TRADING_INTENTS.TIMED_ORDER]: [
    'schedule trade',
    'set order',
    'trade at',
    'buy at',
    'sell at'
  ],

  [TRADING_INTENTS.FLIPPER_MODE]: [
    'start flipper',
    'run flipper',
    'enable flipper',
    'stop flipper',
    'flipper mode'
  ],

  [TRADING_INTENTS.PORTFOLIO_VIEW]: [
    'show positions',
    'view portfolio',
    'my trades',
    'open positions',
    'active trades'
  ],

  [TRADING_INTENTS.POSITION_MANAGE]: [
    'close position',
    'update stop loss',
    'change take profit',
    'modify position',
    'adjust trade'
  ],

  [TRADING_INTENTS.ALERT_MONITOR]: [
    'show alerts',
    'check orders',
    'pending trades',
    'active alerts',
    'scheduled orders'
  ],

  [TRADING_INTENTS.TRADE_HISTORY]: [
    'trade history',
    'past trades',
    'closed positions',
    'trading performance',
    'profit loss'
  ],

  [TRADING_INTENTS.GEMS_TODAY]: [
    'what to ape',
    'analyze',
    'scout',
    'discover',
    'show gems',
    'gems today',
    'trending gems',
    'show me gems',
    'hot gems',
    'new gems',
    'social gems',
    'best gems today',
    'what gems are trending',
    'scan for gems'
  ],

  [TRADING_INTENTS.INTERNET_SEARCH]: [
    'search for',
    'google',
    'search the net',
    'web search',
    'web2',
    'find information about',
    'look up',
    'research',
    'what is',
    'tell me about',
    'search the web for',
    'find news about'
  ],

  // Recent additions during V.skin2
  // Trading Action Patterns
  [TRADING_INTENTS.SWAP_TOKEN]: [
    'swap',
    'exchange',
    'trade',
    'convert'
  ],

  [TRADING_INTENTS.SEND_TOKEN]: [
    'send',
    'transfer',
    'move tokens',
    'send funds'
  ],

  [TRADING_INTENTS.APPROVE_TOKEN]: [
    'approve',
    'allow',
    'enable trading',
    'give permission'
  ],

  // Flipper Mode Patterns
  [TRADING_INTENTS.FLIPPER_MODE]: [
    'start flipper',
    'stop flipper',
    'enable flipper',
    'disable flipper'
  ],

  [TRADING_INTENTS.FLIPPER_CONFIG]: [
    'configure flipper',
    'set flipper',
    'change flipper settings',
    'update flipper'
  ],

  // Butler Patterns
  [TRADING_INTENTS.BUTLER_REMINDER]: [
    'remind me',
    'set reminder',
    'notify me',
    'alert me later'
  ],

  [TRADING_INTENTS.BUTLER_MONITOR]: [
    'monitor token',
    'watch price',
    'track token',
    'follow price'
  ],

  // Payment Patterns
  [TRADING_INTENTS.SOLANA_PAY]: [
    'pay with solana',
    'solana payment',
    'create payment',
    'generate qr'
  ],

  [TRADING_INTENTS.SHOPIFY_SEARCH]: [
    'shop online',
    'shopping',
    'shop',
    'gifts',
    'goods',
    'spoil',
    'shopify',
    'non crypto purchase',
    'search shop',
    'find products',
    'search store',
    'browse items'
  ],

  // AI Guidelines Patterns
  [TRADING_INTENTS.SAVE_GUIDELINE]: [
    'save guideline',
    'store instruction',
    'remember this rule',
    'add guideline'
  ],

  [TRADING_INTENTS.SAVE_STRATEGY]: [
    'save strategy',
    'store strategy',
    'remember strategy',
    'add trading plan'
  ],

  //Greeting Patterns
  [TRADING_INTENTS.CHAT]: [
    'hey katz',
    'hi katz',
    'hello katz',
    'sup katz',
    'yo katz'
  ],

  [TRADING_INTENTS.GREETING]: [
    'gm',
    'good morning',
    'good evening',
    'good night'
  ],
};

/**
 * Match user input to an intent based on defined patterns.
 * @param {string} userInput - The user input to match.
 * @returns {string|null} - The matching intent or null if no match is found.
 */
export function matchIntent(userInput) {
  if (!userInput) return null;
  
  const normalizedInput = userInput.toLowerCase();
  console.log('Matching intent for:', normalizedInput); // Debug logging

  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    for (const pattern of patterns) {
      if (normalizedInput.includes(pattern.toLowerCase())) {
        console.log('Matched intent:', intent); // Debug logging
        return intent;
      }
    }
  }
  
  // No specific intent matched
  return null;
}

