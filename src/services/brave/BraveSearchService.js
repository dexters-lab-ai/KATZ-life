import axios from 'axios';
import { config } from '../../core/config.js';
import { ErrorHandler } from '../../core/errors/index.js';

class BraveSearchService {
  constructor() {
    this.axios = axios.create({
      baseURL: 'https://api.search.brave.com/res/v1',
      headers: {
        'X-Subscription-Token': config.braveApiKey,
        'Accept': 'application/json'
      }
    });
  }

  async search(query, options = {}) {
    try {
      const response = await this.axios.get('/web/search', {
        params: {
          q: query,
          count: options.count || 5,
          offset: options.offset || 0,
          format: 'json'
        }
      });

      return response.data.results.map(result => ({
        title: result.title,
        description: result.description,
        url: result.url
      }));
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }
}

export const braveSearch = new BraveSearchService();
