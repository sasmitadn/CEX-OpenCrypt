const { ethers } = require('ethers');
const config = require('../config');
const db = require('../db');
const { redis } = require('../redis');

class AddressGenerator {
  constructor() {
    this.rootNode = null;
    this.initHdWallet();
  }

  /**
   * Inisialisasi Master HD Node dari xPub (tanpa private key) atau Mnemonic
   */
  initHdWallet() {
    try {
      if (config.hdWallet.masterXpub) {
        try {
          // Gunakan Master xPub untuk keamanan tingkat enterprise: server TIDAK memegang private key
          this.rootNode = ethers.HDNodeWallet.fromExtendedKey(config.hdWallet.masterXpub);
          this.isXpub = true;
          console.log('[HD Wallet] Initialized using Master Extended Public Key (xPub) - Zero Private Key Exposure.');
          return;
        } catch (xpubErr) {
          console.warn(`[HD Wallet] Invalid masterXpub provided (${xpubErr.message}), falling back to mnemonic...`);
        }
      }

      if (config.hdWallet.masterMnemonic) {
        // Fallback untuk local development
        this.rootNode = ethers.HDNodeWallet.fromPhrase(
          config.hdWallet.masterMnemonic,
          '',
          config.hdWallet.evmBasePath
        );
        this.isXpub = false;
        console.log('[HD Wallet] Initialized using Master Mnemonic fallback.');
      } else {
        throw new Error('Neither MASTER_XPUB_EVM nor MASTER_MNEMONIC is configured!');
      }
    } catch (err) {
      console.error('[HD Wallet] Initialization error:', err.message);
      throw err;
    }
  }

  /**
   * Menurunkan public address unik berdasarkan index user
   * Path: m/44'/60'/0'/0/{userIndex}
   */
  deriveAddressByIndex(userIndex) {
    if (!this.rootNode) {
      this.initHdWallet();
    }

    let childWallet;
    if (this.isXpub || (this.rootNode.extendedKey && this.rootNode.extendedKey.startsWith('xpub'))) {
      // Jika rootNode adalah xpub pada level m/44'/60'/0'
      try {
        childWallet = this.rootNode.derivePath(`0/${userIndex}`);
      } catch {
        childWallet = this.rootNode.deriveChild(userIndex);
      }
    } else {
      childWallet = this.rootNode.deriveChild(userIndex);
    }

    return ethers.getAddress(childWallet.address); // Checksummed address
  }

  /**
   * 1. Menghasilkan atau mengambil deposit address untuk user & menyimpan mapping ke database
   */
  async getOrCreateDepositAddress(userId, currencyId, network = config.defaultNetwork) {
    const net = network.toUpperCase();

    // 1. Cek apakah user sudah memiliki deposit address aktif di database
    const existing = await db.query(
      `SELECT * FROM deposit_addresses 
       WHERE user_id = $1 AND currency_id = $2 AND network = $3 AND status = 'ACTIVE' 
       LIMIT 1`,
      [userId, currencyId, net]
    );

    if (existing.rows.length > 0) {
      const record = existing.rows[0];
      // Pastikan tercatat di Redis cache untuk scanner
      await this.cacheAddress(net, record.address, userId, currencyId);
      return record;
    }

    // 2. Turunkan address baru secara deterministik dari index userId
    const address = this.deriveAddressByIndex(userId);

    // 3. Simpan ke PostgreSQL
    const insertResult = await db.query(
      `INSERT INTO deposit_addresses (user_id, currency_id, network, address, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())
       ON CONFLICT (currency_id, network, address, memo_tag) DO UPDATE 
       SET status = 'ACTIVE', updated_at = NOW()
       RETURNING *`,
      [userId, currencyId, net, address]
    );

    const savedRecord = insertResult.rows[0];

    // 4. Cache ke Redis untuk pencarian O(1) oleh deposit scanner
    await this.cacheAddress(net, address, userId, currencyId);

    console.log(`[HD Wallet] Generated new deposit address for User #${userId} (${net}): ${address}`);
    return savedRecord;
  }

  /**
   * Cache address ke Redis set & hash
   */
  async cacheAddress(network, address, userId, currencyId) {
    const normalized = address.toLowerCase();
    const redisKeySet = `active_deposit_addresses:${network.toUpperCase()}`;
    const redisKeyMap = `deposit_address_map:${network.toUpperCase()}`;

    await redis.sadd(redisKeySet, normalized);
    await redis.hset(
      redisKeyMap,
      normalized,
      JSON.stringify({
        user_id: userId,
        currency_id: currencyId,
        address: ethers.getAddress(address),
      })
    );
  }

  /**
   * Muat seluruh deposit address aktif dari database ke Redis & in-memory Set saat startup
   */
  async preloadActiveAddresses(network = config.defaultNetwork) {
    const net = network.toUpperCase();
    const res = await db.query(
      `SELECT user_id, currency_id, address, network 
       FROM deposit_addresses 
       WHERE network = $1 AND status = 'ACTIVE'`,
      [net]
    );

    const addressSet = new Set();
    for (const row of res.rows) {
      const normalized = row.address.toLowerCase();
      addressSet.add(normalized);
      await this.cacheAddress(net, row.address, row.user_id, row.currency_id);
    }

    console.log(`[HD Wallet] Preloaded ${addressSet.size} active deposit addresses for network: ${net}`);
    return addressSet;
  }
}

module.exports = new AddressGenerator();
