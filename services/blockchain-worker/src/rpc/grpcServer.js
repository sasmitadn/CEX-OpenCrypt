const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const config = require('../config');
const addressGenerator = require('../services/addressGenerator');
const db = require('../db');
const { ethers } = require('ethers');

const fs = require('fs');

const PROTO_CANDIDATES = [
  process.env.PROTO_PATH,
  '/app/proto/exchange.proto',
  path.resolve(__dirname, '../../proto/exchange.proto'),
  path.resolve(__dirname, '../../../../proto/exchange.proto'),
];
const PROTO_PATH = PROTO_CANDIDATES.find((p) => p && fs.existsSync(p)) || '/app/proto/exchange.proto';

class GrpcServer {
  constructor() {
    this.server = new grpc.Server();
  }

  start() {
    let packageDefinition;
    try {
      packageDefinition = protoLoader.loadSync(PROTO_PATH, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });
    } catch (err) {
      console.warn(`[gRPC Server] Warning: Could not load exchange.proto from ${PROTO_PATH}: ${err.message}`);
      return;
    }

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
    const exchangeProto = protoDescriptor.exchange;

    if (!exchangeProto || !exchangeProto.BlockchainService) {
      console.warn('[gRPC Server] BlockchainService not found in proto definition.');
      return;
    }

    this.server.addService(exchangeProto.BlockchainService.service, {
      GenerateDepositAddress: this.generateDepositAddress.bind(this),
      ProcessWithdrawal: this.processWithdrawal.bind(this),
      GetTxStatus: this.getTxStatus.bind(this),
    });

    const bindAddress = `0.0.0.0:${config.port}`;
    this.server.bindAsync(bindAddress, grpc.ServerCredentials.createInsecure(), (err, port) => {
      if (err) {
        console.error(`[gRPC Server] Failed to bind to ${bindAddress}:`, err.message);
        return;
      }
      console.log(`[gRPC Server] Blockchain gRPC Service running on ${bindAddress}`);
    });
  }

  /**
   * RPC: GenerateDepositAddress
   */
  async generateDepositAddress(call, callback) {
    try {
      const { user_id, network, currency } = call.request;
      const net = (network || config.defaultNetwork || 'ETH').toUpperCase();

      // Cari currency id yang sesuai
      let currencyId = 1;
      const targetCode = currency ? currency.toUpperCase() : (net === 'BTC' ? 'BTC' : 'ETH');
      const currRes = await db.query(
        `SELECT id FROM currencies WHERE code = $1 LIMIT 1`,
        [targetCode]
      );
      if (currRes.rows.length > 0) {
        currencyId = currRes.rows[0].id;
      }

      const record = await addressGenerator.getOrCreateDepositAddress(user_id, currencyId, net);

      callback(null, {
        address: record.address,
        memo: record.memo_tag || '',
        network: net,
      });
    } catch (err) {
      console.error('[gRPC Server] generateDepositAddress error:', err.message);
      callback({
        code: grpc.status.INTERNAL,
        message: err.message,
      });
    }
  }

  /**
   * RPC: ProcessWithdrawal
   */
  async processWithdrawal(call, callback) {
    try {
      const { withdrawal_id, network } = call.request;
      console.log(`[gRPC Server] Received ProcessWithdrawal request for Withdrawal #${withdrawal_id}`);

      // Update status menjadi APPROVED agar langsung diambil oleh dispatcher
      await db.query(
        `UPDATE withdrawals SET status = 'APPROVED', updated_at = NOW() WHERE id = $1`,
        [withdrawal_id]
      );

      callback(null, {
        tx_hash: '',
        status: 'QUEUED',
        error: '',
      });
    } catch (err) {
      callback({
        code: grpc.status.INTERNAL,
        message: err.message,
      });
    }
  }

  /**
   * RPC: GetTxStatus
   */
  async getTxStatus(call, callback) {
    try {
      const { tx_hash, network } = call.request;
      const net = (network || config.defaultNetwork).toUpperCase();
      const netConfig = config.networks[net] || config.networks.SEPOLIA;
      const provider = new ethers.JsonRpcProvider(netConfig.rpcUrl);

      const receipt = await provider.getTransactionReceipt(tx_hash);
      if (!receipt) {
        return callback(null, {
          tx_hash,
          confirmations: 0,
          status: 'PENDING',
        });
      }

      const latestBlock = await provider.getBlockNumber();
      const confirmations = Math.max(0, latestBlock - receipt.blockNumber + 1);

      callback(null, {
        tx_hash,
        confirmations,
        status: receipt.status === 1 ? 'CONFIRMED' : 'FAILED',
      });
    } catch (err) {
      callback({
        code: grpc.status.INTERNAL,
        message: err.message,
      });
    }
  }
}

module.exports = new GrpcServer();
