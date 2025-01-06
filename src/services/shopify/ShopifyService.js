// src/services/shopify/ShopifyService.js
import { createStorefrontApiClient } from '@shopify/storefront-api-client';
import { ErrorHandler } from '../../core/errors/index.js';

class ShopifyService {
  constructor() {
    // Initialize Storefront API client
    this.client = createStorefrontApiClient({
      storeDomain: 'katz-store-cn-merch.myshopify.com',
      apiVersion: '2024-01', // Latest API version
      publicAccessToken: '650a3ac02550c39d1fc9047810767c68'
    });

    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Test connection
      await this.client.request(`
        query {
          shop {
            name
          }
        }
      `);

      this.initialized = true;
      console.log('✅ Shopify service initialized');
    } catch (error) {
      console.error('❌ Error initializing Shopify service:', error);
      throw error;
    }
  }

  async searchProducts(query) {
    try {
      const { data } = await this.client.request(`
        query searchProducts($query: String!) {
          products(first: 10, query: $query) {
            edges {
              node {
                id
                title
                description
                priceRange {
                  minVariantPrice {
                    amount
                    currencyCode
                  }
                }
                images(first: 1) {
                  edges {
                    node {
                      url
                      altText
                    }
                  }
                }
                variants(first: 1) {
                  edges {
                    node {
                      id
                      availableForSale
                    }
                  }
                }
              }
            }
          }
        }
      `, {
        variables: { query }
      });

      return data.products.edges.map(({ node }) => ({
        id: node.id,
        title: node.title,
        description: node.description,
        price: node.priceRange.minVariantPrice.amount,
        currency: node.priceRange.minVariantPrice.currencyCode,
        image: node.images.edges[0]?.node.url,
        variantId: node.variants.edges[0]?.node.id,
        available: node.variants.edges[0]?.node.availableForSale
      }));
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async createCheckout(productId, quantity = 1) {
    try {
      const { data } = await this.client.request(`
        mutation createCheckout($input: CheckoutCreateInput!) {
          checkoutCreate(input: $input) {
            checkout {
              id
              webUrl
              totalPrice {
                amount
                currencyCode
              }
            }
            checkoutUserErrors {
              code
              field
              message
            }
          }
        }
      `, {
        variables: {
          input: {
            lineItems: [{ variantId: productId, quantity }]
          }
        }
      });

      if (data.checkoutCreate.checkoutUserErrors.length > 0) {
        throw new Error(data.checkoutCreate.checkoutUserErrors[0].message);
      }

      return {
        checkoutId: data.checkoutCreate.checkout.id,
        checkoutUrl: data.checkoutCreate.checkout.webUrl,
        totalPrice: {
          amount: data.checkoutCreate.checkout.totalPrice.amount,
          currency: data.checkoutCreate.checkout.totalPrice.currencyCode
        }
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async updateCheckout(checkoutId, updates) {
    try {
      const { data } = await this.client.request(`
        mutation checkoutLineItemsUpdate($checkoutId: ID!, $lineItems: [CheckoutLineItemUpdateInput!]!) {
          checkoutLineItemsUpdate(checkoutId: $checkoutId, lineItems: $lineItems) {
            checkout {
              id
              webUrl
              totalPrice {
                amount
                currencyCode
              }
            }
            checkoutUserErrors {
              code
              field
              message
            }
          }
        }
      `, {
        variables: {
          checkoutId,
          lineItems: updates
        }
      });

      if (data.checkoutLineItemsUpdate.checkoutUserErrors.length > 0) {
        throw new Error(data.checkoutLineItemsUpdate.checkoutUserErrors[0].message);
      }

      return {
        checkoutId: data.checkoutLineItemsUpdate.checkout.id,
        checkoutUrl: data.checkoutLineItemsUpdate.checkout.webUrl,
        totalPrice: {
          amount: data.checkoutLineItemsUpdate.checkout.totalPrice.amount,
          currency: data.checkoutLineItemsUpdate.checkout.totalPrice.currencyCode
        }
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async completeCheckoutWithSolanaPay(checkoutId) {
    // Integration with SolanaPay service
    try {
      const checkout = await this.client.request(`
        query getCheckout($id: ID!) {
          node(id: $id) {
            ... on Checkout {
              id
              totalPrice {
                amount
                currencyCode
              }
            }
          }
        }
      `, {
        variables: { id: checkoutId }
      });

      const payment = await solanaPayService.createPayment(
        checkout.data.node.totalPrice.amount,
        checkoutId
      );

      return {
        checkoutId,
        paymentUrl: payment.url,
        qrCode: payment.qrCode
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  cleanup() {
    this.initialized = false;
    console.log('✅ Shopify service cleaned up');
  }
}

export const shopifyService = new ShopifyService();
