import { EventEmitter } from 'events';
import { User } from '../../models/User.js';
import { ErrorHandler } from '../../core/errors/index.js';
import { db } from '../../core/database.js';

export class AddressBookService extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.addressCollection = null;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      await db.connect();
      const database = db.getDatabase();
      
      this.addressCollection = database.collection('addressBook');
      await this.setupIndexes();
      
      this.initialized = true;
      console.log('✅ AddressBookService initialized');
    } catch (error) {
      console.error('❌ Error initializing AddressBookService:', error);
      throw error;
    }
  }

  async setupIndexes() {
    await this.addressCollection.createIndex({ userId: 1 });
    await this.addressCollection.createIndex({ keyword: 1 });
    await this.addressCollection.createIndex({ address: 1 });
    await this.addressCollection.createIndex({ network: 1 });
  }

  async saveAddress(userId, data) {
    try {
      const { address, keyword, network, type = 'token' } = data;

      // Validate network
      if (!['ethereum', 'base', 'solana'].includes(network)) {
        throw new Error('Invalid network');
      }

      // Check if keyword already exists for user
      const existing = await this.addressCollection.findOne({
        userId: userId.toString(),
        keyword: keyword.toLowerCase()
      });

      if (existing) {
        throw new Error(`Keyword "${keyword}" already exists`);
      }

      // Save address
      const result = await this.addressCollection.insertOne({
        userId: userId.toString(),
        address,
        keyword: keyword.toLowerCase(),
        network,
        type,
        createdAt: new Date()
      });

      this.emit('addressSaved', {
        userId,
        address,
        keyword,
        network
      });

      return result;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async getAddress(userId, keyword) {
    try {
      return await this.addressCollection.findOne({
        userId: userId.toString(),
        keyword: keyword.toLowerCase()
      });
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async listAddresses(userId, options = {}) {
    try {
      const query = { userId: userId.toString() };
      
      // Add filters
      if (options.type) query.type = options.type;
      if (options.network) query.network = options.network;

      return await this.addressCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async updateAddress(userId, keyword, updates) {
    try {
      const result = await this.addressCollection.updateOne(
        {
          userId: userId.toString(),
          keyword: keyword.toLowerCase()
        },
        {
          $set: {
            ...updates,
            updatedAt: new Date()
          }
        }
      );

      if (result.matchedCount === 0) {
        throw new Error(`Address with keyword "${keyword}" not found`);
      }

      this.emit('addressUpdated', {
        userId,
        keyword,
        updates
      });

      return result;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async deleteAddress(userId, keyword) {
    try {
      const result = await this.addressCollection.deleteOne({
        userId: userId.toString(),
        keyword: keyword.toLowerCase()
      });

      if (result.deletedCount === 0) {
        throw new Error(`Address with keyword "${keyword}" not found`);
      }

      this.emit('addressDeleted', {
        userId,
        keyword
      });

      return result;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async searchAddresses(userId, query) {
    try {
      return await this.addressCollection.find({
        userId: userId.toString(),
        $or: [
          { keyword: { $regex: query, $options: 'i' } },
          { address: { $regex: query, $options: 'i' } }
        ]
      }).toArray();
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  cleanup() {
    this.removeAllListeners();
    this.initialized = false;
  }
}

export const addressBookService = new AddressBookService();