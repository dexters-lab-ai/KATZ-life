import { EventEmitter } from 'events';
import { ErrorHandler } from '../../../core/errors/index.js';

export class ActionExecutor extends EventEmitter {
  constructor() {
    super();
    this.actionQueue = new Map();
    this.executionHistory = new Map();
  }

  async executeActions(actions, userId) {
    if (!Array.isArray(actions)) {
      actions = [actions];
    }

    const executionId = `${userId}_${Date.now()}`;
    this.actionQueue.set(executionId, {
      actions,
      status: 'pending',
      results: [],
      timestamp: Date.now()
    });

    try {
      const results = [];
      let lastError = null;

      for (const action of actions) {
        try {
          const result = await this.executeAction(action, userId);
          results.push({ action, result, status: 'success' });
        } catch (error) {
          lastError = error;
          results.push({ action, error, status: 'failed' });
          
          // Attempt rollback if needed
          if (results.length > 1) {
            await this.rollbackActions(results.slice(0, -1), userId);
          }
          break;
        }
      }

      this.actionQueue.set(executionId, {
        actions,
        status: lastError ? 'failed' : 'completed',
        results,
        timestamp: Date.now()
      });

      if (lastError) throw lastError;
      return results;

    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async executeAction(action, userId) {
    switch (action.type) {
      case 'createAlert':
        return await this.executeAlertAction(action.data, userId);
      case 'executeTrade':
        return await this.executeTradeAction(action.data, userId);
      case 'scanToken':
        return await this.executeScanAction(action.data, userId);
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  async rollbackActions(actions, userId) {
    for (const { action, result } of actions.reverse()) {
      try {
        await this.rollbackAction(action, result, userId);
      } catch (error) {
        console.error(`Rollback failed for action ${action.type}:`, error);
      }
    }
  }

  async rollbackAction(action, result, userId) {
    switch (action.type) {
      case 'createAlert':
        await this.rollbackAlertAction(result, userId);
        break;
      case 'executeTrade':
        await this.rollbackTradeAction(result, userId);
        break;
      // Add more rollback handlers as needed
    }
  }

  getActionStatus(executionId) {
    return this.actionQueue.get(executionId);
  }

  cleanup() {
    this.actionQueue.clear();
    this.executionHistory.clear();
    this.removeAllListeners();
  }
}