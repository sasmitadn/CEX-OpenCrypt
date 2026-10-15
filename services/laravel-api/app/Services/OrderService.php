<?php

namespace App\Services;

use App\Exceptions\InsufficientBalanceException;
use App\Exceptions\InvalidFinancialStateException;
use App\Models\Order;
use App\Models\TradingPair;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class OrderService
{
    public function __construct(
        protected WalletService $walletService
    ) {}

    /**
     * Membuat order baru dan mengunci dana di wallet pengguna secara atomik.
     */
    public function placeOrder(
        User $user,
        int $tradingPairId,
        string $side, // BUY, SELL
        string $type, // LIMIT, MARKET
        string $quantity,
        ?string $price = null
    ): Order {
        if ($user->status !== 'ACTIVE') {
            throw new InvalidFinancialStateException("Akun pengguna sedang berstatus {$user->status}.");
        }

        $pair = TradingPair::with(['baseCurrency', 'quoteCurrency'])->findOrFail($tradingPairId);

        if ($pair->status !== 'TRADING') {
            throw new InvalidFinancialStateException("Pasangan trading {$pair->symbol} sedang {$pair->status}.");
        }

        if (bccomp($quantity, $pair->min_order_quantity, WalletService::DEFAULT_SCALE) < 0) {
            throw new InvalidFinancialStateException("Kuantitas minimum adalah {$pair->min_order_quantity}.");
        }

        // Tentukan aset dan jumlah yang harus dikunci di wallet
        if ($side === 'BUY') {
            if ($type === 'LIMIT' && !$price) {
                throw new InvalidFinancialStateException("Harga (price) wajib diisi untuk LIMIT order.");
            }
            // BUY: Mengunci Quote Currency (e.g. USDT) sejumlah price * quantity
            $lockedCurrencyId = $pair->quote_currency_id;
            $lockedAmount = bcmul($price, $quantity, WalletService::DEFAULT_SCALE);

            if (bccomp($lockedAmount, $pair->min_order_notional, WalletService::DEFAULT_SCALE) < 0) {
                throw new InvalidFinancialStateException("Nilai minimum order notional adalah {$pair->min_order_notional}.");
            }
        } else {
            // SELL: Mengunci Base Currency (e.g. BTC) sejumlah quantity
            $lockedCurrencyId = $pair->base_currency_id;
            $lockedAmount = $quantity;
        }

        return DB::transaction(function () use (
            $user,
            $pair,
            $side,
            $type,
            $quantity,
            $price,
            $lockedCurrencyId,
            $lockedAmount
        ) {
            // 1. Kunci wallet yang sesuai
            $wallet = $this->walletService->lockAndGetWallet($user->id, $lockedCurrencyId, 'SPOT');

            if (bccomp($wallet->balance, $lockedAmount, WalletService::DEFAULT_SCALE) < 0) {
                throw new InsufficientBalanceException("Saldo tidak mencukupi untuk membuat order. Dibutuhkan: {$lockedAmount}, Tersedia: {$wallet->balance}");
            }

            // 2. Buat record Order
            $order = Order::create([
                'uuid' => (string) Str::uuid(),
                'user_id' => $user->id,
                'trading_pair_id' => $pair->id,
                'side' => $side,
                'type' => $type,
                'price' => $price,
                'quantity' => $quantity,
                'filled_quantity' => '0.000000000000000000',
                'filled_quote_amount' => '0.000000000000000000',
                'locked_amount' => $lockedAmount,
                'locked_currency_id' => $lockedCurrencyId,
                'status' => 'OPEN',
            ]);

            // 3. Kunci saldo di wallet user
            $this->walletService->lockBalance(
                wallet: $wallet,
                amount: $lockedAmount,
                referenceId: (string) $order->id,
                referenceType: 'ORDER_LOCK',
                description: "Hold saldo untuk Order #{$order->id} ({$side} {$quantity} {$pair->symbol})",
                metadata: [
                    'order_uuid' => $order->uuid,
                    'pair' => $pair->symbol,
                    'side' => $side,
                ]
            );

            return $order;
        });
    }

    /**
     * Membatalkan order dan mengembalikan sisa locked balance ke saldo aktif pengguna.
     */
    public function cancelOrder(Order $order): Order
    {
        return DB::transaction(function () use ($order) {
            $lockedOrder = Order::where('id', $order->id)->lockForUpdate()->firstOrFail();

            if (!in_array($lockedOrder->status, ['PENDING', 'OPEN', 'PARTIALLY_FILLED'])) {
                throw new InvalidFinancialStateException("Order dengan status {$lockedOrder->status} tidak dapat dibatalkan.");
            }

            $wallet = $this->walletService->lockAndGetWallet($lockedOrder->user_id, $lockedOrder->locked_currency_id, 'SPOT');

            // Hitung sisa yang belum terisi
            $unfilledRatio = bcdiv(
                bcsub($lockedOrder->quantity, $lockedOrder->filled_quantity, WalletService::DEFAULT_SCALE),
                $lockedOrder->quantity,
                WalletService::DEFAULT_SCALE
            );

            $refundAmount = bcmul($lockedOrder->locked_amount, $unfilledRatio, WalletService::DEFAULT_SCALE);

            if (bccomp($refundAmount, '0', WalletService::DEFAULT_SCALE) > 0) {
                $this->walletService->unlockBalance(
                    wallet: $wallet,
                    amount: $refundAmount,
                    referenceId: (string) $lockedOrder->id,
                    referenceType: 'ORDER_UNLOCK',
                    description: "Refund saldo karena Order #{$lockedOrder->id} dibatalkan",
                    metadata: [
                        'order_uuid' => $lockedOrder->uuid,
                        'refund_amount' => $refundAmount,
                    ]
                );
            }

            $lockedOrder->status = 'CANCELED';
            $lockedOrder->canceled_at = now();
            $lockedOrder->save();

            return $lockedOrder;
        });
    }
}
