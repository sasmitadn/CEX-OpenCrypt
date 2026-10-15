const { ethers } = require('ethers');
const config = require('../config');
const db = require('../db');

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
];

class SweepingWorker {
  constructor(networkKey = config.defaultNetwork) {
    this.networkKey = networkKey.toUpperCase();
    this.networkConfig = config.networks[this.networkKey] || config.networks.SEPOLIA;
    this.provider = new ethers.JsonRpcProvider(this.networkConfig.rpcUrl);
    this.hotWallet = new ethers.Wallet(config.hotWallet.privateKey, this.provider);
    this.minSweepThresholdEth = '0.01'; // Minimal saldo yang layak disweep agar gas tidak tekor
    this.isRunning = false;
  }

  /**
   * Menjalankan pemindaian berkala saldo di address deposit user
   */
  async sweepUserBalances() {
    console.log(`[Sweeping Worker] Scanning user deposit addresses for sweepable funds on ${this.networkKey}...`);

    try {
      // Ambil seluruh address deposit aktif
      const res = await db.query(
        `SELECT address, user_id FROM deposit_addresses WHERE network = $1 AND status = 'ACTIVE'`,
        [this.networkKey]
      );

      for (const row of res.rows) {
        const address = row.address;
        const balanceWei = await this.provider.getBalance(address);
        const balanceEth = ethers.formatEther(balanceWei);

        if (parseFloat(balanceEth) >= parseFloat(this.minSweepThresholdEth)) {
          console.log(
            `[Sweeping Worker] Found sweepable balance on User #${row.user_id} (${address}): ${balanceEth} ETH`
          );

          // Jika master mnemonic tersedia di secure environment, turunkan private key untuk menandatangani sweep
          if (config.hdWallet.masterMnemonic) {
            await this.sweepNativeEth(row.user_id, address, balanceWei);
          } else {
            console.log(
              `[Sweeping Worker] Offline sweeping required: Server operates in watch-only xPub mode for security.`
            );
          }
        }
      }
    } catch (err) {
      console.error('[Sweeping Worker] Error during sweep scan:', err.message);
    }
  }

  /**
   * Pindahkan native ETH dari address user ke Hot/Cold Wallet bursa
   */
  async sweepNativeEth(userId, userAddress, balanceWei) {
    try {
      const hdNode = ethers.HDNodeWallet.fromPhrase(
        config.hdWallet.masterMnemonic,
        '',
        config.hdWallet.evmBasePath
      );
      const userWallet = hdNode.deriveChild(userId).connect(this.provider);

      const feeData = await this.provider.getFeeData();
      const gasLimit = 21000n;
      const gasCost = (feeData.gasPrice || ethers.parseUnits('20', 'gwei')) * gasLimit;

      if (balanceWei <= gasCost) {
        return;
      }

      const sweepAmountWei = balanceWei - gasCost;

      const tx = await userWallet.sendTransaction({
        to: this.hotWallet.address,
        value: sweepAmountWei,
        gasLimit,
        gasPrice: feeData.gasPrice,
      });

      console.log(`[Sweeping Worker] Swept ${ethers.formatEther(sweepAmountWei)} ETH to Hot Wallet [TX: ${tx.hash}]`);
    } catch (err) {
      console.error(`[Sweeping Worker] Failed to sweep address ${userAddress}:`, err.message);
    }
  }
}

module.exports = SweepingWorker;
