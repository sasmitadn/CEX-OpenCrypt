const config = require('./config');
const db = require('./db');
const { redis } = require('./redis');
const addressGenerator = require('./services/addressGenerator');
const DepositScanner = require('./services/depositScanner');
const WithdrawalDispatcher = require('./services/withdrawalDispatcher');
const SweepingWorker = require('./services/sweepingWorker');
const grpcServer = require('./rpc/grpcServer');

async function main() {
  console.log('=====================================================');
  console.log('       CEX BLOCKCHAIN WORKER & ENGINE DAEMON         ');
  console.log('=====================================================');
  console.log(`Environment: ${config.env}`);
  console.log(`Default Network: ${config.defaultNetwork}`);

  // 1. Verifikasi Konektivitas Redis
  try {
    await redis.ping();
    console.log('[Worker] Connected to Redis.');
  } catch (err) {
    console.warn('[Worker] Warning: Redis connection failed:', err.message);
  }

  // 2. Verifikasi Konektivitas PostgreSQL
  try {
    const res = await db.query('SELECT NOW() AS current_time');
    console.log('[Worker] Connected to PostgreSQL. Server Time:', res.rows[0].current_time);
  } catch (err) {
    console.warn('[Worker] Warning: PostgreSQL connection failed:', err.message);
  }

  // 3. Inisialisasi HD Wallet Address Generator
  try {
    addressGenerator.initHdWallet();
    console.log('[Worker] HD Wallet Address Generator initialized.');
  } catch (err) {
    console.error('[Worker] Fatal: HD Wallet initialization failed:', err.message);
  }

  // 4. Inisialisasi & Jalankan Deposit Scanner (Block Listener Worker)
  const depositScanner = new DepositScanner(config.defaultNetwork);
  try {
    await depositScanner.start();
  } catch (err) {
    console.error('[Worker] Deposit Scanner startup error:', err.message);
  }

  // 5. Inisialisasi & Jalankan Withdrawal Dispatcher (Signer & Broadcaster)
  const withdrawalDispatcher = new WithdrawalDispatcher(config.defaultNetwork);
  try {
    await withdrawalDispatcher.start();
  } catch (err) {
    console.error('[Worker] Withdrawal Dispatcher startup error:', err.message);
  }

  // 6. Inisialisasi Sweeping Worker (Jadwal berkala setiap 30 menit)
  const sweepingWorker = new SweepingWorker(config.defaultNetwork);
  setInterval(async () => {
    try {
      await sweepingWorker.sweepUserBalances();
    } catch (err) {
      console.error('[Worker] Sweeping worker cycle error:', err.message);
    }
  }, 30 * 60 * 1000);

  // 7. Start gRPC Server untuk melayani request dari Laravel / Matching Engine
  try {
    grpcServer.start();
  } catch (err) {
    console.error('[Worker] gRPC Server startup error:', err.message);
  }

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[Worker] Received ${signal}. Shutting down cleanly...`);
    depositScanner.stop();
    withdrawalDispatcher.stop();
    await db.pool.end();
    redis.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[Worker] Fatal bootstrap crash:', err);
  process.exit(1);
});
