<?php

namespace App\Console\Commands;

use App\Models\Order;
use App\Models\Trade;
use App\Models\TradingPair;
use App\Services\BalanceService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;

class ProcessTradeStreamCommand extends Command
{
    /**
     * The name and signature of the console command.
     */
    protected $signature = 'cex:process-trades {--stream=trade_stream}';

    /**
     * The console command description.
     */
    protected $description = 'Consume matched trades from C++ Matching Engine via Redis Stream and execute settlement';

    /**
     * Execute the console command.
     */
    public function handle(BalanceService $balanceService): void
    {
        $stream = $this->option('stream');
        $this->info("[Trade Consumer] Listening for matched trades on Redis Stream: {$stream}...");

        $lastId = '$'; // Start from new events

        while (true) {
            try {
                // XREAD BLOCK 2000 STREAMS trade_stream $
                $entries = Redis::xread([$stream => $lastId], 2000);

                if (empty($entries) || !isset($entries[$stream])) {
                    continue;
                }

                foreach ($entries[$stream] as $id => $payload) {
                    $lastId = $id;

                    $this->info("[Trade Consumer] Processing matched trade: " . ($payload['trade_id'] ?? $id));

                    $this->settleSingleTrade($payload, $balanceService);
                }
            } catch (\Throwable $e) {
                $this->error("[Trade Consumer] Error reading stream: " . $e->getMessage());
                sleep(2);
            }
        }
    }

    protected function settleSingleTrade(array $payload, BalanceService $balanceService): void
    {
        $symbol = $payload['symbol'] ?? null;
        $makerOrderId = $payload['maker_order_id'] ?? null;
        $takerOrderId = $payload['taker_order_id'] ?? null;
        $price = $payload['price'] ?? '0';
        $quantity = $payload['quantity'] ?? '0';
        $quoteAmount = $payload['quote_amount'] ?? '0';
        $makerSide = $payload['maker_side'] ?? 'SELL';

        if (!$symbol || !$makerOrderId || !$takerOrderId) {
            return;
        }

        $pair = TradingPair::where('symbol', $symbol)->first();
        if (!$pair) {
            Log::warning("[Trade Consumer] Symbol {$symbol} not found.");
            return;
        }

        DB::transaction(function () use (
            $payload,
            $pair,
            $makerOrderId,
            $takerOrderId,
            $price,
            $quantity,
            $quoteAmount,
            $makerSide,
            $balanceService
        ) {
            $makerOrder = Order::where('uuid', $makerOrderId)->lockForUpdate()->first();
            $takerOrder = Order::where('uuid', $takerOrderId)->lockForUpdate()->first();

            if (!$makerOrder || !$takerOrder) {
                Log::warning("[Trade Consumer] Orders not found: Maker={$makerOrderId}, Taker={$takerOrderId}");
                return;
            }

            // Tentukan siapa buyer dan seller
            $buyerOrder = $makerSide === 'BUY' ? $makerOrder : $takerOrder;
            $sellerOrder = $makerSide === 'SELL' ? $makerOrder : $takerOrder;

            // Hitung fee
            $buyerFeeRate = $pair->taker_fee_rate;
            $sellerFeeRate = $pair->maker_fee_rate;

            $buyerFee = bcmul($quantity, $buyerFeeRate, BalanceService::SCALE);
            $sellerFee = bcmul($quoteAmount, $sellerFeeRate, BalanceService::SCALE);

            // 1. Eksekusi perpindahan saldo & double-entry ledger via BalanceService
            $balanceService->settleTrade(
                buyerUserId: $buyerOrder->user_id,
                sellerUserId: $sellerOrder->user_id,
                pair: $pair,
                price: $price,
                quantity: $quantity,
                buyerFee: $buyerFee,
                sellerFee: $sellerFee,
                tradeReferenceId: $payload['trade_id'] ?? (string) Str::uuid()
            );

            // 2. Simpan record Trade di database
            Trade::create([
                'uuid' => $payload['trade_id'] ?? (string) Str::uuid(),
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

            // 3. Update status order (FILLED atau PARTIALLY_FILLED)
            $this->updateOrderStatus($makerOrder, $quantity, $quoteAmount);
            $this->updateOrderStatus($takerOrder, $quantity, $quoteAmount);
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
}
