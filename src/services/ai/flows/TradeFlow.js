import { EventEmitter } from 'events';
import { walletService } from '../../wallet/index.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class TradeFlow extends EventEmitter {
  constructor() {
    super();
    this.steps = ['token', 'amount', 'confirmation'];
  }

  async processStep(flowData, input) {
    try {
      const currentStep = flowData.currentStep || 0;

      switch (this.steps[currentStep]) {
        case 'token':
          return this.processTokenStep(input);
        case 'amount':
          return this.processAmountStep(flowData, input);
        case 'confirmation':
          return this.processConfirmation(flowData, input);
        default:
          throw new Error('Invalid trade flow step');
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async processTokenStep(input) {
    // Validate token address/symbol
    const tokenInfo = await walletService.validateToken(input);
    
    return {
      completed: false,
      nextStep: 'amount',
      flowData: {
        currentStep: 1,
        token: tokenInfo
      },
      response: `Great! How much ${tokenInfo.symbol} would you like to trade?`
    };
  }

  async processAmountStep(flowData, input) {
    // Validate amount
    const amount = parseFloat(input);
    if (isNaN(amount) || amount <= 0) {
      throw new Error('Invalid amount');
    }

    return {
      completed: false,
      nextStep: 'confirmation',
      flowData: {
        ...flowData,
        currentStep: 2,
        amount
      },
      response: `Ready to trade ${amount} ${flowData.token.symbol}. Confirm? (yes/no)`
    };
  }

  async processConfirmation(flowData, input) {
    const confirmed = input.toLowerCase() === 'yes';
    
    if (!confirmed) {
      return {
        completed: true,
        response: 'Trade cancelled.'
      };
    }

    // Execute trade
    const result = await walletService.executeTrade({
      token: flowData.token,
      amount: flowData.amount
    });

    return {
      completed: true,
      result,
      response: `Trade executed! Hash: ${result.hash}`
    };
  }
}