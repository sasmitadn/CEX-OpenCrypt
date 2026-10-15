/**
 * Configuration module for CEX Blockchain Worker
 */
module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '50052', 10),

  // Database (PostgreSQL)
  db: {
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_DATABASE || 'cex_db',
    user: process.env.DB_USER || 'cex_user',
    password: process.env.DB_PASSWORD || 'secret123',
    max: 20,
    idleTimeoutMillis: 30000,
  },

  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || 'secretredis',
  },

  // Blockchain Networks & RPCs
  networks: {
    SEPOLIA: {
      name: 'SEPOLIA',
      chainId: 11155111,
      rpcUrl: process.env.RPC_ETH_SEPOLIA || 'https://rpc.sepolia.org',
      requiredConfirmations: 2, // Sepolia block time ~12s
      blockTimeMs: 12000,
      nativeCurrency: 'ETH',
      tokens: {
        USDT: {
          address: (process.env.USDT_CONTRACT_SEPOLIA || '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0').toLowerCase(),
          decimals: 6,
          symbol: 'USDT',
        },
      },
    },
    ETH_MAINNET: {
      name: 'ETH',
      chainId: 1,
      rpcUrl: process.env.RPC_ETH_MAINNET || 'https://rpc.ankr.com/eth',
      requiredConfirmations: 12,
      blockTimeMs: 12000,
      nativeCurrency: 'ETH',
      tokens: {},
    },
    BSC_MAINNET: {
      name: 'BSC',
      chainId: 56,
      rpcUrl: process.env.RPC_BSC_MAINNET || 'https://rpc.ankr.com/bsc',
      requiredConfirmations: 15,
      blockTimeMs: 3000,
      nativeCurrency: 'BNB',
      tokens: {},
    },
  },

  defaultNetwork: process.env.NETWORK_DEFAULT || 'SEPOLIA',

  // HD Wallet Configuration (Master xPub / Mnemonic)
  hdWallet: {
    // Master Extended Public Key for EVM (BIP-44: m/44'/60'/0')
    // Crucial: xPub derives child public addresses WITHOUT exposing private keys!
    masterXpub: process.env.MASTER_XPUB_EVM || null,
    // Fallback Mnemonic for development
    masterMnemonic: process.env.MASTER_MNEMONIC || 'test test test test test test test test test test test junk',
    // Base derivation path for EVM addresses: m/44'/60'/0'/0/index
    evmBasePath: "m/44'/60'/0'/0",
  },

  // Hot Wallet Configuration (Withdrawal Signer)
  hotWallet: {
    privateKey: process.env.HOT_WALLET_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    maxGasLimit: 250000,
  },

  // Scanner Tuning
  scanner: {
    pollIntervalMs: parseInt(process.env.SCANNER_POLL_INTERVAL_MS || '4000', 10),
    maxBlocksPerBatch: parseInt(process.env.SCANNER_BATCH_SIZE || '10', 10),
    checkpointKeyPrefix: 'checkpoint:last_block:',
  },
};
