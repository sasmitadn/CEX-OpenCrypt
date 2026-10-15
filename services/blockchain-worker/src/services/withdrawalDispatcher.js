const { ethers } = require('ethers');
const config = require('../config');
const db = require('../db');
const { redis, redisPub } = require('../redis');

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

class WithdrawalDispatcher {
  constructor(networkKey = config.defaultNetwork) {
    this.networkKey = networkKey.toUpperCase();
    this.networkConfig = config.networks[this.networkKey] || config.networks.SEPOLIA;
    this.provider = new ethers.JsonRpcProvider(this.networkConfig.rpcUrl);
    this.wallet = new ethers.Wallet(config.hotWallet.privateKey, this.provider);

    this.isRunning = false;
    this.pollTimer = null;
    this.currentNonce = null;
    this.isProcessing = false;
  }

  /**
   * Inisialisasi Hot Wallet dan sinkronisasi awal nonce
   */
  async init() {
    console.log(`[Withdrawal Dispatcher] Initializing for ${this.networkKey}`);
    console.log(`[Withdrawal Dispatcher] Hot Wallet Address: ${this.wallet.address}`);

    try {
      this.currentNonce = await this.provider.getTransactionCount(this.wallet.address, 'pending');
      console.log(`[Withdrawal Dispatcher] Initialized Nonce: ${this.currentNonce}`);
    } catch (err) {
      console.error(`[Withdrawal Dispatcher] Failed to query initial nonce:`, err.message);
    }
  }

  /**
   * Start queue consumer
   */
  async start() {
    await this.init();
    this.isRunning = true;
    console.log(`[Withdrawal Dispatcher] Worker started listening for approved withdrawals.`);
    this.scheduleNextCheck(500);
  }

  stop() {
    this.isRunning = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    console.log(`[Withdrawal Dispatcher] Worker stopped.`);
  }

  scheduleNextCheck(delayMs = 3000) {
    if (!this.isRunning) return;
    this.pollTimer = setTimeout(async () => {
      try {
        await this.processQueue();
      } catch (err) {
        console.error('[Withdrawal Dispatcher] Loop error:', err.message);
      } finally {
        this.scheduleNextCheck();
      }
    }, delayMs);
  }

  /**
   * Mengonsumsi antrean penarikan dana dari database / Redis
   */
  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // 1. Ambil antrean withdrawal dengan status 'APPROVED' atau 'PROCESSING'
      const res = await db.query(
        `SELECT w.*, c.code AS currency_code, c.decimals AS currency_decimals
         FROM withdrawals w
         JOIN currencies c ON c.id = w.currency_id
         WHERE w.network = $1 AND w.status IN ('APPROVED', 'PROCESSING')
         ORDER BY w.id ASC
         LIMIT 5`,
        [this.networkKey]
      );

      if (res.rows.length === 0) {
        this.isProcessing = false;
        return;
      }

      for (const withdrawal of res.rows) {
        await this.dispatchWithdrawal(withdrawal);
      }
    } catch (err) {
      console.error('[Withdrawal Dispatcher] Error processing queue:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Eksekusi penandatanganan dan broadcast transaksi on-chain
   */
  async dispatchWithdrawal(withdrawal) {
    console.log(`[Withdrawal Dispatcher] Dispatching Withdrawal #${withdrawal.id} (${withdrawal.net_amount} ${withdrawal.currency_code} to ${withdrawal.to_address})`);

    // Pastikan status menjadi PROCESSING agar tidak diproses ganda
    await db.query(
      `UPDATE withdrawals SET status = 'PROCESSING', updated_at = NOW() WHERE id = $1`,
      [withdrawal.id]
    );

    try {
      // 1. Sinkronisasi Nonce Hot Wallet
      const onchainNonce = await this.provider.getTransactionCount(this.wallet.address, 'pending');
      if (this.currentNonce === null || onchainNonce > this.currentNonce) {
        this.currentNonce = onchainNonce;
      }

      const nonce = this.currentNonce;
      this.currentNonce++; // Increment lokal untuk transaksi berikutnya

      // 2. Estimasi Gas & Fee Data (EIP-1559)
      const feeData = await this.provider.getFeeData();
      const gasParams = {};

      if (feeData.maxFeePerGas) {
        gasParams.maxFeePerGas = (feeData.maxFeePerGas * 120n) / 100n; // +20% buffer
        gasParams.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits('1.5', 'gwei');
      } else if (feeData.gasPrice) {
        gasParams.gasPrice = (feeData.gasPrice * 120n) / 100n;
      }

      let tx;
      const isNative = withdrawal.currency_code === 'ETH' || withdrawal.currency_code === 'BNB';

      if (isNative) {
        // Native Transfer (ETH)
        const valueWei = ethers.parseEther(withdrawal.net_amount);
        tx = await this.wallet.sendTransaction({
          to: withdrawal.to_address,
          value: valueWei,
          nonce,
          gasLimit: 21000n,
          ...gasParams,
        });
      } else {
        // ERC-20 Token Transfer (e.g. USDT)
        const tokenConfig = this.networkConfig.tokens[withdrawal.currency_code];
        if (!tokenConfig) {
          throw new Error(`Token config not found for currency ${withdrawal.currency_code} on ${this.networkKey}`);
        }

        const contract = new ethers.Contract(tokenConfig.address, ERC20_ABI, this.wallet);
        const amountUnits = ethers.parseUnits(withdrawal.net_amount, tokenConfig.decimals);

        tx = await contract.transfer(withdrawal.to_address, amountUnits, {
          nonce,
          gasLimit: 85000n,
          ...gasParams,
        });
      }

      console.log(`[Withdrawal Dispatcher] Broadcasted TX Hash: ${tx.hash} (Nonce: ${nonce}) for Withdrawal #${withdrawal.id}`);

      // 3. Update database: Status = BROADCASTED
      await db.query(
        `UPDATE withdrawals 
         SET status = 'BROADCASTED', tx_hash = $1, broadcasted_at = NOW(), updated_at = NOW() 
         WHERE id = $2`,
        [tx.hash, withdrawal.id]
      );

      // Notifikasi ke Redis Pub/Sub untuk Laravel & Frontend
      await redisPub.publish(
        'withdrawals:broadcasted',
        JSON.stringify({
          withdrawal_id: withdrawal.id,
          tx_hash: tx.hash,
          network: this.networkKey,
        })
      );

      // 4. Pantau konfirmasi blok on-chain di background
      this.monitorReceipt(tx, withdrawal);

    } catch (err) {
      console.error(`[Withdrawal Dispatcher] Failed to broadcast withdrawal #${withdrawal.id}:`, err.message);

      // Reset nonce kembali dari on-chain jika gagal
      this.currentNonce = await this.provider.getTransactionCount(this.wallet.address, 'pending');

      await db.query(
        `UPDATE withdrawals 
         SET status = 'FAILED', rejection_reason = $1, updated_at = NOW() 
         WHERE id = $2`,
        [err.message.slice(0, 500), withdrawal.id]
      );
    }
  }

  /**
   * Menunggu receipt transaksi on-chain lalu menyelesaikan withdrawal secara permanen
   */
  async monitorReceipt(tx, withdrawal) {
    try {
      const receipt = await tx.wait(1);

      if (receipt && receipt.status === 1) {
        console.log(`[Withdrawal Dispatcher] TX Confirmed on block #${receipt.blockNumber} for Withdrawal #${withdrawal.id}`);

        const client = await db.getClient();
        try {
          await client.query('BEGIN');

          // 1. Kunci wallet user
          const wRes = await client.query(
            `SELECT id, balance, locked_balance FROM wallets WHERE id = $1 FOR UPDATE`,
            [withdrawal.wallet_id]
          );

          if (wRes.rows.length > 0) {
            const wallet = wRes.rows[0];
            const totalDeducted = (parseFloat(withdrawal.amount) + parseFloat(withdrawal.fee)).toFixed(18);

            // Potong saldo terkunci secara permanen
            await client.query(
              `UPDATE wallets 
               SET locked_balance = locked_balance - $1, updated_at = NOW() 
               WHERE id = $2`,
              [totalDeducted, wallet.id]
            );

            // Tulis baris ledger mutasi debit final
            await client.query(
              `INSERT INTO ledger_entries (
                uuid, reference_id, reference_type, wallet_id, user_id,
                currency_id, entry_type, amount, fee, balance_before,
                balance_after, locked_before, locked_after, description, metadata, created_at, updated_at
              ) VALUES (
                gen_random_uuid(), $1, 'WITHDRAW', $2, $3, $4, 'DEBIT', $5, $6, $7, $7, $8, $8 - $5, $9, $10, NOW(), NOW()
              )`,
              [
                withdrawal.id,
                wallet.id,
                withdrawal.user_id,
                withdrawal.currency_id,
                totalDeducted,
                withdrawal.fee,
                wallet.balance,
                wallet.locked_balance,
                `Penyelesaian withdrawal on-chain [TX: ${tx.hash}]`,
                JSON.stringify({
                  tx_hash: tx.hash,
                  block_number: receipt.blockNumber,
                  gas_used: receipt.gasUsed.toString(),
                }),
              ]
            );
          }

          // 2. Tandai status COMPLETED
          await client.query(
            `UPDATE withdrawals 
             SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW() 
             WHERE id = $1`,
            [withdrawal.id]
          );

          await client.query('COMMIT');

          await redisPub.publish(
            'withdrawals:completed',
            JSON.stringify({
              withdrawal_id: withdrawal.id,
              tx_hash: tx.hash,
              block_number: receipt.blockNumber,
            })
          );
        } catch (dbErr) {
          await client.query('ROLLBACK');
          console.error(`[Withdrawal Dispatcher] DB finalize error for #${withdrawal.id}:`, dbErr.message);
        } finally {
          client.release();
        }
      } else {
        throw new Error('Transaction reverted on-chain');
      }
    } catch (err) {
      console.error(`[Withdrawal Dispatcher] Error monitoring receipt for #${withdrawal.id}:`, err.message);
      await db.query(
        `UPDATE withdrawals SET status = 'FAILED', rejection_reason = $1 WHERE id = $2`,
        [`On-chain revert: ${err.message}`, withdrawal.id]
      );
    }
  }
}

module.exports = WithdrawalDispatcher;
