/**
 * Multi-chain Network Configuration for CEX Blockchain Worker
 * Supports: BTC, ETH, ARB, MATIC, BNB, AVAX
 */
module.exports = {
  // 1. Bitcoin (BTC)
  BTC: {
    name: 'Bitcoin',
    symbol: 'BTC',
    type: 'UTXO',
    isEVM: false,
    network: 'BTC',
    decimals: 8,
    requiredConfirmations: 2,
    blockTimeMs: 600000, // 10 minutes
    derivationPath: "m/44'/0'/0'/0",
    testnetDerivationPath: "m/44'/1'/0'/0",
    rpcUrl: process.env.RPC_BTC || 'https://mempool.space/api',
    isTestnet: process.env.BTC_TESTNET === 'true',
    nativeCurrency: 'BTC',
    tokens: {},
  },

  // 2. Ethereum (ETH) - Sepolia / Mainnet
  ETH: {
    name: 'Ethereum',
    symbol: 'ETH',
    type: 'EVM',
    isEVM: true,
    network: 'ETH',
    chainId: parseInt(process.env.ETH_CHAIN_ID || '11155111', 10), // Sepolia default for testing
    decimals: 18,
    requiredConfirmations: 2,
    blockTimeMs: 12000,
    derivationPath: "m/44'/60'/0'/0",
    rpcUrl: process.env.RPC_ETH_SEPOLIA || 'https://ethereum-sepolia-rpc.publicnode.com',
    nativeCurrency: 'ETH',
    tokens: {
      USDT: {
        address: (process.env.USDT_CONTRACT_ETH || '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0').toLowerCase(),
        decimals: 6,
        symbol: 'USDT',
      },
    },
  },

  // 3. Arbitrum One / Sepolia (ARB)
  ARB: {
    name: 'Arbitrum',
    symbol: 'ARB',
    type: 'EVM',
    isEVM: true,
    network: 'ARB',
    chainId: parseInt(process.env.ARB_CHAIN_ID || '421614', 10), // Arbitrum Sepolia
    decimals: 18,
    requiredConfirmations: 2,
    blockTimeMs: 250,
    derivationPath: "m/44'/60'/0'/0",
    rpcUrl: process.env.RPC_ARB || 'https://sepolia-rollup.arbitrum.io/rpc',
    nativeCurrency: 'ETH',
    tokens: {
      ARB: {
        address: (process.env.ARB_TOKEN_CONTRACT || '0x912CE59144191C1204E64559FE8253a0e49E6548').toLowerCase(),
        decimals: 18,
        symbol: 'ARB',
      },
      USDT: {
        address: (process.env.USDT_CONTRACT_ARB || '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9').toLowerCase(),
        decimals: 6,
        symbol: 'USDT',
      },
    },
  },

  // 4. Polygon / Amoy (MATIC / POL)
  MATIC: {
    name: 'Polygon',
    symbol: 'MATIC',
    type: 'EVM',
    isEVM: true,
    network: 'MATIC',
    chainId: parseInt(process.env.MATIC_CHAIN_ID || '80002', 10), // Polygon Amoy
    decimals: 18,
    requiredConfirmations: 5,
    blockTimeMs: 2000,
    derivationPath: "m/44'/60'/0'/0",
    rpcUrl: process.env.RPC_MATIC || 'https://rpc-amoy.polygon.technology',
    nativeCurrency: 'MATIC',
    tokens: {
      USDT: {
        address: (process.env.USDT_CONTRACT_MATIC || '0xc2132D05D31c914a87C6611C10748AEb04B58e8F').toLowerCase(),
        decimals: 6,
        symbol: 'USDT',
      },
    },
  },

  // 5. BNB Smart Chain (BNB / BSC)
  BNB: {
    name: 'BNB Smart Chain',
    symbol: 'BNB',
    type: 'EVM',
    isEVM: true,
    network: 'BNB',
    chainId: parseInt(process.env.BNB_CHAIN_ID || '97', 10), // BSC Testnet
    decimals: 18,
    requiredConfirmations: 3,
    blockTimeMs: 3000,
    derivationPath: "m/44'/60'/0'/0",
    rpcUrl: process.env.RPC_BSC || 'https://data-seed-prebsc-1-s1.binance.org:8545',
    nativeCurrency: 'BNB',
    tokens: {
      USDT: {
        address: (process.env.USDT_CONTRACT_BNB || '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd').toLowerCase(),
        decimals: 18,
        symbol: 'USDT',
      },
    },
  },

  // 6. Avalanche C-Chain (AVAX)
  AVAX: {
    name: 'Avalanche',
    symbol: 'AVAX',
    type: 'EVM',
    isEVM: true,
    network: 'AVAX',
    chainId: parseInt(process.env.AVAX_CHAIN_ID || '43113', 10), // Fuji Testnet
    decimals: 18,
    requiredConfirmations: 2,
    blockTimeMs: 2000,
    derivationPath: "m/44'/60'/0'/0",
    rpcUrl: process.env.RPC_AVAX || 'https://api.avax-test.network/ext/bc/C/rpc',
    nativeCurrency: 'AVAX',
    tokens: {
      USDT: {
        address: (process.env.USDT_CONTRACT_AVAX || '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7').toLowerCase(),
        decimals: 6,
        symbol: 'USDT',
      },
    },
  },
};
