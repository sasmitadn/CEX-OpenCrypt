<?php

namespace App\Console\Commands;

use App\Models\Currency;
use App\Models\LedgerEntry;
use App\Models\Order;
use App\Models\Trade;
use App\Models\TradingPair;
use App\Models\Wallet;
use App\Services\BalanceService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;

class SettleTradesCommand extends Command
{
    /**
     * The name and signature of the console command.
     */
    protected $signature = 'cex:settle-trades {--queue=trades_queue} {--once : Run once and exit (for testing)}';

    /**
     * The console command description.
     */
    protected $description = 'Consume matched trades from Redis trades_queue, update balances, orders, trades, and double-entry ledger';

    public function handle(BalanceService $balanceService): void
    {
        $queue = $this->option('queue');
        $runOnce = $this->option('once');

        $this->info("=====================================================");
        $this->info("      CEX TRADE SETTLEMENT DAEMON (LARAVEL)          ");
        $this->info("=====================================================");
        $this->info("Listening for matched trades on Redis queue: {$queue}...");

        do {
            try {
                // RPOP dari Redis List trades_queue
                $rawTrade = Redis::rpop($queue);

                if ($rawTrade) {
                    $payload = json_decode($rawTrade, true);

                    if ($payload && isset($payload['trade_id'])) {
                        $this->info("Processing settlement for Trade: {$payload['trade_id']} ({$payload['symbol']})");
                        $this->settleSingleTrade($payload);
                    }
                } else {
                    // Jika queue kosong, istirahat 500ms
                    usleep(500000);
                }
            } catch (\Throwable $e) {
                $this->error("Settlement error: " . $e->getMessage());
                Log::error("[SettleTradesCommand] Settlement failed: " . $e->getMessage(), [
                    'exception' => $e,
                ]);
                sleep(1);
            }
        } while (!$runOnce);

        $this->info("Settlement worker finished.");
    }

    /**
     * Eksekusi transaksi penyelesaian saldo Maker & Taker, fee bursa, order update, dan ledger entries
     */
    public function settleSingleTrade(array $payload): ?Trade
    {
        $symbol = $payload['symbol'] ?? null;
        $makerOrderId = $payload['maker_order_id'] ?? null;
        $takerOrderId = $payload['taker_order_id'] ?? null;
        $price = (string) ($payload['price'] ?? '0');
        $quantity = (string) ($payload['quantity'] ?? '0');
        $makerSide = strtoupper($payload['maker_side'] ?? 'SELL');
        $tradeUuid = $payload['trade_id'] ?? (string) Str::uuid();

        if (!$symbol || !$makerOrderId || !$takerOrderId) {
            $this->warn("Trade payload missing required fields.");
            return null;
        }

        $pair = TradingPair::with(['baseCurrency', 'quoteCurrency'])
            ->where('symbol', $symbol)
            ->first();

        if (!$pair) {
            $this->warn("Trading pair {$symbol} not found.");
            return null;
        }

        return DB::transaction(function () use (
            $payload,
            $pair,
            $makerOrderId,
            $takerOrderId,
            $price,
            $quantity,
            $makerSide,
            $tradeUuid
        ) {
            // 1. Ambil Maker Order dan Taker Order dengan lockForUpdate
            $makerOrder = Order::where('uuid', $makerOrderId)->lockForUpdate()->first();
            $takerOrder = Order::where('uuid', $takerOrderId)->lockForUpdate()->first();

            if (!$makerOrder || !$takerOrder) {
                $this->warn("Order not found: Maker={$makerOrderId}, Taker={$takerOrderId}");
                return null;
            }

            // Cek apakah trade ini sudah pernah diselesaikan sebelumnya (idempotency check)
            $existingTrade = Trade::where('uuid', $tradeUuid)->first();
            if ($existingTrade) {
                $this->warn("Trade {$tradeUuid} already settled.");
                return $existingTrade;
            }

            $quoteAmount = bcmul($price, $quantity, BalanceService::SCALE);

            // Tentukan buyer dan seller
            $buyerOrder = $makerSide === 'BUY' ? $makerOrder : $takerOrder;
            $sellerOrder = $makerSide === 'SELL' ? $makerOrder : $takerOrder;

            // Hitung trading fee
            $buyerFeeRate = $pair->taker_fee_rate;
            $sellerFeeRate = $pair->maker_fee_rate;

            $buyerFee = bcmul($quantity, $buyerFeeRate, BalanceService::SCALE);
            $sellerFee = bcmul($quoteAmount, $sellerFeeRate, BalanceService::SCALE);

            // 2. Kunci 4 Wallet (Buyer Quote & Base, Seller Base & Quote) secara teratur
            $buyerQuoteWallet = $this->getOrCreateLockedWallet($buyerOrder->user_id, $pair->quote_currency_id);
            $buyerBaseWallet = $this->getOrCreateLockedWallet($buyerOrder->user_id, $pair->base_currency_id);
            $sellerBaseWallet = $this->getOrCreateLockedWallet($sellerOrder->user_id, $pair->base_currency_id);
            $sellerQuoteWallet = $this->getOrCreateLockedWallet($sellerOrder->user_id, $pair->quote_currency_id);

            // -------------------------------------------------------------
            // A. BUYER SETTLEMENT:
            // Potong saldo USDT dari locked_balance
            // Tambah koin BTC ke available balance (dikurangi buyer fee)
            // -------------------------------------------------------------
            $bQBefore = $buyerQuoteWallet->balance;
            $bQLockedBefore = $buyerQuoteWallet->locked_balance;
            $bQLockedAfter = bcsub($bQLockedBefore, $quoteAmount, BalanceService::SCALE);
            $buyerQuoteWallet->locked_balance = $bQLockedAfter;
            $buyerQuoteWallet->save();

            LedgerEntry::create([
                'uuid' => (string) Str::uuid(),
                'reference_id' => $tradeUuid,
                'reference_type' => 'TRADE_EXECUTION',
                'wallet_id' => $buyerQuoteWallet->id,
                'user_id' => $buyerOrder->user_id,
                'currency_id' => $pair->quote_currency_id,
                'entry_type' => 'DEBIT',
                'amount' => $quoteAmount,
                'fee' => '0.000000000000000000',
                'balance_before' => $bQBefore,
                'balance_after' => $bQBefore,
                'locked_before' => $bQLockedBefore,
                'locked_after' => $bQLockedAfter,
                'description' => "Buyer Settle: Potong {$quoteAmount} quote locked",
                'metadata' => ['trade_id' => $tradeUuid, 'side' => 'BUY'],
            ]);

            $bBBefore = $buyerBaseWallet->balance;
            $netBaseToBuyer = bcsub($quantity, $buyerFee, BalanceService::SCALE);
            $bBAfter = bcadd($bBBefore, $netBaseToBuyer, BalanceService::SCALE);
            $buyerBaseWallet->balance = $bBAfter;
            $buyerBaseWallet->save();

            LedgerEntry::create([
                'uuid' => (string) Str::uuid(),
                'reference_id' => $tradeUuid,
                'reference_type' => 'TRADE_EXECUTION',
                'wallet_id' => $buyerBaseWallet->id,
                'user_id' => $buyerOrder->user_id,
                'currency_id' => $pair->base_currency_id,
                'entry_type' => 'CREDIT',
                'amount' => $quantity,
                'fee' => $buyerFee,
                'balance_before' => $bBBefore,
                'balance_after' => $bBAfter,
                'locked_before' => $buyerBaseWallet->locked_balance,
                'locked_after' => $buyerBaseWallet->locked_balance,
                'description' => "Buyer Settle: Terima {$netBaseToBuyer} base (Fee: {$buyerFee})",
                'metadata' => ['trade_id' => $tradeUuid, 'fee' => $buyerFee],
            ]);

            // -------------------------------------------------------------
            // B. SELLER SETTLEMENT:
            // Potong saldo BTC dari locked_balance
            // Tambah USDT ke available balance (dikurangi seller fee)
            // -------------------------------------------------------------
            $sBBefore = $sellerBaseWallet->balance;
            $sBLockedBefore = $sellerBaseWallet->locked_balance;
            $sBLockedAfter = bcsub($sBLockedBefore, $quantity, BalanceService::SCALE);
            $sellerBaseWallet->locked_balance = $sBLockedAfter;
            $sellerBaseWallet->save();

            LedgerEntry::create([
                'uuid' => (string) Str::uuid(),
                'reference_id' => $tradeUuid,
                'reference_type' => 'TRADE_EXECUTION',
                'wallet_id' => $sellerBaseWallet->id,
                'user_id' => $sellerOrder->user_id,
                'currency_id' => $pair->base_currency_id,
                'entry_type' => 'DEBIT',
                'amount' => $quantity,
                'fee' => '0.000000000000000000',
                'balance_before' => $sBBefore,
                'balance_after' => $sBBefore,
                'locked_before' => $sBLockedBefore,
                'locked_after' => $sBLockedAfter,
                'description' => "Seller Settle: Potong {$quantity} base locked",
                'metadata' => ['trade_id' => $tradeUuid, 'side' => 'SELL'],
            ]);

            $sQBefore = $sellerQuoteWallet->balance;
            $netQuoteToSeller = bcsub($quoteAmount, $sellerFee, BalanceService::SCALE);
            $sQAfter = bcadd($sQBefore, $netQuoteToSeller, BalanceService::SCALE);
            $sellerQuoteWallet->balance = $sQAfter;
            $sellerQuoteWallet->save();

            LedgerEntry::create([
                'uuid' => (string) Str::uuid(),
                'reference_id' => $tradeUuid,
                'reference_type' => 'TRADE_EXECUTION',
                'wallet_id' => $sellerQuoteWallet->id,
                'user_id' => $sellerOrder->user_id,
                'currency_id' => $pair->quote_currency_id,
                'entry_type' => 'CREDIT',
                'amount' => $quoteAmount,
                'fee' => $sellerFee,
                'balance_before' => $sQBefore,
                'balance_after' => $sQAfter,
                'locked_before' => $sellerQuoteWallet->locked_balance,
                'locked_after' => $sellerQuoteWallet->locked_balance,
                'description' => "Seller Settle: Terima {$netQuoteToSeller} quote (Fee: {$sellerFee})",
                'metadata' => ['trade_id' => $tradeUuid, 'fee' => $sellerFee],
            ]);

            // -------------------------------------------------------------
            // C. CATAT RECORD BARU DI TABEL TRADES
            // -------------------------------------------------------------
            $trade = Trade::create([
                'uuid' => $tradeUuid,
                'trading_pair_id' => $pair->id,
                'maker_order_id' => $makerOrder->id,
                'taker_order_id' => $takerOrder->id,
                'maker_user_id' => $makerOrder->user_id,
                'taker_user_id' => $takerOrder->user_id,
                'price' => $price,
                'quantity' => $quantity,
                'quote_amount' => $quoteAmount,
                'maker_fee' => $makerSide === 'SELL' ? $sellerFee : $buyerFee,
                'taker_fee' => $makerSide === 'BUY' ? $sellerFee : $buyerFee,
                'maker_side' => $makerSide,
            ]);

            // -------------------------------------------------------------
            // D. UPDATE STATUS ORDER (FILLED atau PARTIALLY_FILLED)
            // -------------------------------------------------------------
            $this->updateOrderStatus($makerOrder, $quantity, $quoteAmount);
            $this->updateOrderStatus($takerOrder, $quantity, $quoteAmount);

            $this->info("Trade #{$trade->id} settled successfully: {$quantity} @ {$price} {$pair->symbol}");
            return $trade;
        });
    }

    protected function updateOrderStatus(Order $order, string $fillQty, string $fillQuote): void
    {
        $newFilled = bcadd($order->filled_quantity, $fillQty, BalanceService::SCALE);
        $newFilledQuote = bcadd($order->filled_quote_amount, $fillQuote, BalanceService::SCALE);

        $order->filled_quantity = $newFilled;
        $order->filled_quote_amount = $newFilledQuote;

        if (bccomp($newFilled, $order->quantity, BalanceService::SCALE) >= 0) {
            $order->status = 'FILLED';
        } else {
            $order->status = 'PARTIALLY_FILLED';
        }

        $order->save();
    }

    protected function getOrCreateLockedWallet(int $userId, int $currencyId): Wallet
    {
        $wallet = Wallet::firstOrCreate(
            ['user_id' => $userId, 'currency_id' => $currencyId, 'type' => 'SPOT'],
            ['uuid' => (string) Str::uuid(), 'balance' => '0', 'locked_balance' => '0', 'status' => 'ACTIVE']
        );

        return Wallet::where('id', $wallet->id)->lockForUpdate()->firstOrFail();
    }
}
