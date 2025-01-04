// src/commands/profile/ProfileCommand.js
import { db } from '../../core/database.js';
import { BaseCommand } from '../base/BaseCommand.js';
import { CertificateService } from '../../services/certificates/CertificateService.js';
import { User } from '../../models/User.js';
import { decrypt } from '../../utils/encryption.js';
import { ProfileHandler } from './handlers/ProfileHandler.js';
import { ErrorHandler } from '../../core/errors/index.js';

export class ProfileCommand extends BaseCommand {
  constructor(bot) {
    super(bot);
    this.command = '/profile';
    this.description = 'Print profile and wallet certificates';
    this.pattern = /^\/profile$/;

    this.certificateService = new CertificateService();
    this.profileHandler = new ProfileHandler(bot);
  }

  async execute(msg) {
    const chatId = msg.chat.id;

    try {
      const userInfo = msg.from;
      // Print Wallet Certificates
      await this.generateCertificate(chatId, userInfo);    
      // Print Profile Card
      await this.profileHandler.handleProfileCommand(this.bot, chatId, userInfo);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  async generateCertificate(chatId, userInfo) {
    const loadingMsg = await this.showLoadingMessage(chatId, '🔐 Generating your wallet certificates...');
    try {
      const user = await User.findOne({ telegramId: userInfo.id.toString() }).lean();
      if (!user) {
        throw new Error('User not found. Please use /start to register first.');
      }

      // Decrypt wallet data
      const wallets = this.decryptAllWallets(user.wallets);

      // Generate certificate
      const certificateBuffer = await this.certificateService.generateCertificate({
        user: {
          username: userInfo.username,
          telegramId: userInfo.id,
        },
        wallets,
      });

      await this.bot.deleteMessage(chatId, loadingMsg.message_id);

      // Send certificate with 30s self-destruct
      const certificateMsg = await this.bot.sendPhoto(chatId, certificateBuffer, {
        caption: '🔐 *Your Wallet Certificate*\n\n' +
                 '⚠️ This image will self-destruct in 30 seconds!\n\n' +
                 '*SECURITY REMINDER*\n' +
                 '• Save these details securely\n' +
                 '• Never share private keys\n' +
                 '• Keep your recovery phrases safe',
        parse_mode: 'Markdown',
      });

      setTimeout(() => {
        this.bot.deleteMessage(chatId, certificateMsg.message_id).catch(console.error);
      }, 30000);

    } catch (error) {
      if (loadingMsg) {
        await this.bot.deleteMessage(chatId, loadingMsg.message_id).catch(console.error);
      }
      throw error; // Pass the error to centralized error handler
    }
  }

  decryptAllWallets(wallets) {
    return {
      ethereum: this.decryptWallet(wallets.ethereum[0]),
      base: this.decryptWallet(wallets.base[0]),
      solana: this.decryptWallet(wallets.solana[0]),
    };
  }

  decryptWallet(wallet) {
    return {
      address: wallet.address,
      privateKey: decrypt(wallet.encryptedPrivateKey),
      mnemonic: decrypt(wallet.encryptedMnemonic),
    };
  }

  async showLoadingMessage(chatId, text) {
    try {
      return await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error showing loading message:', error);
      throw error;
    }
  }

  async showErrorMessage(chatId, error) {
    console.error('Error encountered:', error.message);
    await this.bot.sendMessage(chatId, `❌ *Error*: ${error.message}`, { parse_mode: 'Markdown' });
  }
}
