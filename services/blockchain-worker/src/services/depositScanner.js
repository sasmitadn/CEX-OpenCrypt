const { ethers } = require('ethers');
const config = require('../config');
const db = require('../db');
const { redis, redisPub } = require('../redis');
const addressGenerator = require('./addressGenerator');

const ERC20_TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

class DepositScanner {
  constructor(networkKey = config.defaultNetwork) {
    this.networkKey = networkKey.toUpperCase();
    this.networkConfig = config.networks[this.networkKey] || config.networks.SEPOLIA;
    this.provider = new ethers.JsonRpcProvider(this.networkConfig.rpcUrl);
    this.isRunning = false;
    this.pollTimer = null;
    this.activeAddresses = new Set();
    this.currenciesCache = new Map(); // e.g. 'ETH' -> currency_id, 'USDT' -> currency_id
  }

  /**
   * Inisialisasi cache mata uang dan daftar deposit address user
   */
  async init() {
    console.log(`[Deposit Scanner] Initializing scanner for network: ${this.networkKey} (${this.networkConfig.rpcUrl})`);

    // 1. Ambil ID currency dari database
    const currRes = await db.query('SELECT id, code, decimals FROM currencies');
    for (const c of currRes.rows) {
      this.currenciesCache.set(c.code.toUpperCase(), c);
    }

    // 2. Preload active deposit addresses
    this.activeAddresses = await addressGenerator.preloadActiveAddresses(this.networkKey);

    console.log(`[Deposit Scanner] Loaded ${this.currenciesCache.size} currencies and ${this.activeAddresses.size} user addresses.`);
  }

  /**
   * Start polling loop
   */
  async start() {
    await this.init();
    this.isRunning = true;
    console.log(`[Deposit Scanner] Started block listening on ${this.networkKey}.`);
    this.scheduleNextPoll(100);
  }

  /**
   * Stop polling
   */
  stop() {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    console.log(`[Deposit Scanner] Stopped scanner on ${this.networkKey}.`);
  }

  scheduleNextPoll(delayMs = config.scanner.pollIntervalMs) {
    if (!this.isRunning) return;
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollBlocks();
      } catch (err) {
        console.error(`[Deposit Scanner] Error in block poll cycle (${this.networkKey}):`, err.message);
      } finally {
        this.scheduleNextPoll();
      }
    }, delayMs);
  }

  /**
   * Membaca block baru dari blockchain RPC dan memproses transaksi deposit
   */
  async pollBlocks() {
    const latestBlock = await this.provider.getBlockNumber();
    const checkpointKey = `${config.scanner.checkpointKeyPrefix}${this.networkKey}`;

    let lastScannedBlock = await redis.get(checkpointKey);

    if (!lastScannedBlock) {
      // Jika pertama kali jalan: mulai dari (latestBlock - 5) untuk mencegah lag
      lastScannedBlock = Math.max(0, latestBlock - 5);
      await redis.set(checkpointKey, lastScannedBlock);
      console.log(`[Deposit Scanner] Initialized checkpoint at block #${lastScannedBlock}`);
    } else {
      lastScannedBlock = parseInt(lastScannedBlock, 10);
    }

    if (lastScannedBlock >= latestBlock) {
      // Tidak ada block baru, periksa konfirmasi deposit yang masih pending
      await this.updateConfirmationsAndCredit(latestBlock);
      return;
    }

    // Scan batch block berikutnya
    const fromBlock = lastScannedBlock + 1;
    const toBlock = Math.min(fromBlock + config.scanner.maxBlocksPerBatch - 1, latestBlock);

    for (let b = fromBlock; b <= toBlock; b++) {
      await this.scanSingleBlock(b, latestBlock);
      await redis.set(checkpointKey, b);
    }

    // Evaluasi reorg safety & konfirmasi deposit
    await this.updateConfirmationsAndCredit(latestBlock);
  }

  /**
   * Scan 1 block: deteksi Native Transfer (ETH) dan ERC-20 Transfer
   */
  async scanSingleBlock(blockNumber, latestBlockHeight) {
    try {
      const block = await this.provider.getBlock(blockNumber, true);
      if (!block) return;

      // 1. Scan Native Currency (ETH / BNB / BTC) Transfers
      if (block.prefetchedTransactions) {
        for (const tx of block.prefetchedTransactions) {
          if (!tx.to) continue;
          const toNormalized = tx.to.toLowerCase();

          if (this.activeAddresses.has(toNormalized)) {
            const amountEth = ethers.formatEther(tx.value || 0n);
            if (parseFloat(amountEth) > 0) {
              const nativeCode = this.networkConfig.nativeCurrency || 'ETH';
              const currency = this.currenciesCache.get(nativeCode);

              if (currency) {
                await this.handleDetectedDeposit({
                  network: this.networkKey,
                  txHash: tx.hash,
                  toAddress: ethers.getAddress(tx.to),
                  fromAddress: tx.from ? ethers.getAddress(tx.from) : null,
                  amount: amountEth,
                  currencyId: currency.id,
                  blockNumber,
                  latestBlockHeight,
                });
              }
            }
          }
        }
      }

      // 2. Scan ERC-20 Token Transfers
      await this.scanErc20Logs(blockNumber, latestBlockHeight);

    } catch (err) {
      console.error(`[Deposit Scanner] Error scanning block #${blockNumber}:`, err.message);
      throw err;
    }
  }

  /**
   * Scan Event Log ERC-20: Transfer(address,address,uint256)
   */
  async scanErc20Logs(blockNumber, latestBlockHeight) {
    const tokens = this.networkConfig.tokens || {};
    const tokenAddresses = Object.values(tokens).map((t) => t.address.toLowerCase());

    if (tokenAddresses.length === 0) return;

    try {
      const logs = await this.provider.getLogs({
        fromBlock: blockNumber,
        toBlock: blockNumber,
        address: tokenAddresses,
        topics: [ERC20_TRANSFER_TOPIC],
      });

      for (const log of logs) {
        if (log.topics.length < 3) continue;

        // Topic 1: from, Topic 2: to
        const rawTo = '0x' + log.topics[2].slice(26);
        const toNormalized = rawTo.toLowerCase();

        if (this.activeAddresses.has(toNormalized)) {
          const rawFrom = '0x' + log.topics[1].slice(26);
          const fromAddress = ethers.getAddress(rawFrom);
          const toAddress = ethers.getAddress(rawTo);

          // Cari token info
          const tokenEntry = Object.values(tokens).find(
            (t) => t.address.toLowerCase() === log.address.toLowerCase()
          );

          if (!tokenEntry) continue;

          const currency = this.currenciesCache.get(tokenEntry.symbol);
          if (!currency) continue;

          const rawAmount = BigInt(log.data);
          const amountFormatted = ethers.formatUnits(rawAmount, tokenEntry.decimals);

          await this.handleDetectedDeposit({
            network: this.networkKey,
            txHash: log.transactionHash,
            toAddress,
            fromAddress,
            amount: amountFormatted,
            currencyId: currency.id,
            blockNumber,
            latestBlockHeight,
          });
        }
      }
    } catch (err) {
      console.error(`[Deposit Scanner] Error fetching ERC-20 logs for block #${blockNumber}:`, err.message);
    }
  }

  /**
   * Simpan atau update deposit yang terdeteksi ke PostgreSQL
   */
  async handleDetectedDeposit(data) {
    const {
      network,
      txHash,
      toAddress,
      fromAddress,
      amount,
      currencyId,
      blockNumber,
      latestBlockHeight,
    } = data;

    const confirmations = Math.max(0, latestBlockHeight - blockNumber + 1);
    const requiredConfirmations = this.networkConfig.requiredConfirmations || 12;

    // 1. Ambil user_id dan wallet_id dari deposit_addresses & wallets
    const addrRes = await db.query(
      `SELECT da.user_id, w.id AS wallet_id
       FROM deposit_addresses da
       JOIN wallets w ON w.user_id = da.user_id AND w.currency_id = da.currency_id AND w.type = 'SPOT'
       WHERE da.address = $1 AND da.currency_id = $2 AND da.network = $3
       LIMIT 1`,
      [toAddress, currencyId, network]
    );

    if (addrRes.rows.length === 0) {
      console.warn(`[Deposit Scanner] Deposit address ${toAddress} not linked to any user wallet.`);
      return;
    }

    const { user_id, wallet_id } = addrRes.rows[0];

    // 2. Insert atau Update deposit record (idempotent ON CONFLICT)
    const initialStatus = confirmations >= requiredConfirmations ? 'COMPLETED' : 'CONFIRMING';

    const insertQuery = `
      INSERT INTO deposits (
        uuid, user_id, currency_id, wallet_id, network, tx_hash,
        to_address, from_address, amount, fee, confirmations,
        required_confirmations, block_number, status, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11, $12, NOW(), NOW()
      )
      ON CONFLICT (network, tx_hash, to_address) DO UPDATE
      SET confirmations = EXCLUDED.confirmations,
          block_number = EXCLUDED.block_number,
          updated_at = NOW()
      RETURNING *;
    `;

    const res = await db.query(insertQuery, [
      user_id,
      currencyId,
      wallet_id,
      network,
      txHash,
      toAddress,
      fromAddress,
      amount,
      confirmations,
      requiredConfirmations,
      blockNumber,
      initialStatus,
    ]);

    const deposit = res.rows[0];

    console.log(
      `[Deposit Scanner] Detected deposit: ${amount} to ${toAddress} | Conf: ${confirmations}/${requiredConfirmations} | Status: ${deposit.status}`
    );

    // Jika konfirmasi langsung mencukupi
    if (confirmations >= requiredConfirmations && deposit.status !== 'COMPLETED') {
      await this.creditUserDeposit(deposit);
    }
  }

  /**
   * Periksa dan update konfirmasi seluruh deposit yang masih dalam status DETECTED / CONFIRMING
   */
  async updateConfirmationsAndCredit(latestBlock) {
    const pendingRes = await db.query(
      `SELECT * FROM deposits 
       WHERE network = $1 AND status IN ('DETECTED', 'CONFIRMING')`,
      [this.networkKey]
    );

    for (const deposit of pendingRes.rows) {
      if (!deposit.block_number) continue;

      const confirmations = Math.max(0, latestBlock - parseInt(deposit.block_number, 10) + 1);

      if (confirmations >= deposit.required_confirmations) {
        await this.creditUserDeposit(deposit);
      } else {
        await db.query(
          `UPDATE deposits SET confirmations = $1, status = 'CONFIRMING', updated_at = NOW() WHERE id = $2`,
          [confirmations, deposit.id]
        );
      }
    }
  }

  /**
   * Eksekusi kredit saldo pengguna secara atomik (Database Transaction & Double-Entry Ledger)
   */
  async creditUserDeposit(deposit) {
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      // 1. Kunci wallet user (pessimistic lock)
      const walletRes = await client.query(
        `SELECT id, balance, locked_balance FROM wallets WHERE id = $1 FOR UPDATE`,
        [deposit.wallet_id]
      );

      if (walletRes.rows.length === 0) {
        throw new Error(`Wallet ID ${deposit.wallet_id} not found.`);
      }

      const wallet = walletRes.rows[0];

      // Periksa ulang agar tidak terjadi double credit (idempotency check)
      const checkDeposit = await client.query(
        `SELECT status FROM deposits WHERE id = $1 FOR UPDATE`,
        [deposit.id]
      );

      if (checkDeposit.rows[0].status === 'COMPLETED') {
        await client.query('ROLLBACK');
        return;
      }

      const balanceBefore = wallet.balance;
      const lockedBefore = wallet.locked_balance;
      // Gunakan numeric addition via Postgres query
      const updateWallet = await client.query(
        `UPDATE wallets 
         SET balance = balance + $1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING balance`,
        [deposit.amount, wallet.id]
      );

      const balanceAfter = updateWallet.rows[0].balance;

      // 2. Tulis entri buku besar (Double-Entry Ledger)
      await client.query(
        `INSERT INTO ledger_entries (
          uuid, reference_id, reference_type, wallet_id, user_id,
          currency_id, entry_type, amount, fee, balance_before,
          balance_after, locked_before, locked_after, description, metadata, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, 'DEPOSIT', $2, $3, $4, 'CREDIT', $5, 0, $6, $7, $8, $8, $9, $10, NOW(), NOW()
        )`,
        [
          deposit.tx_hash,
          wallet.id,
          deposit.user_id,
          deposit.currency_id,
          deposit.amount,
          balanceBefore,
          balanceAfter,
          lockedBefore,
          `Deposit on-chain ${deposit.amount} [TX: ${deposit.tx_hash}]`,
          JSON.stringify({
            network: deposit.network,
            tx_hash: deposit.tx_hash,
            block_number: deposit.block_number,
          }),
        ]
      );

      // 3. Update deposit status menjadi COMPLETED
      await client.query(
        `UPDATE deposits 
         SET status = 'COMPLETED', credited_at = NOW(), updated_at = NOW() 
         WHERE id = $1`,
        [deposit.id]
      );

      await client.query('COMMIT');

      console.log(`[Deposit Scanner] Deposit #${deposit.id} COMPLETED. Credited ${deposit.amount} to User #${deposit.user_id}`);

      // 4. Publikasikan notifikasi ke Redis Stream & Channel untuk Laravel dan Realtime Gateway
      const payload = {
        event: 'deposit_completed',
        deposit_id: deposit.id,
        user_id: deposit.user_id,
        currency_id: deposit.currency_id,
        amount: deposit.amount,
        tx_hash: deposit.tx_hash,
        network: deposit.network,
        timestamp: Date.now(),
      };

      await redisPub.publish('deposits:credited', JSON.stringify(payload));
      await redis.xadd('deposit_stream', '*', 'data', JSON.stringify(payload));

    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[Deposit Scanner] Failed to credit deposit #${deposit.id}:`, err.message);
    } finally {
      client.release();
    }
  }
}

module.exports = DepositScanner;
