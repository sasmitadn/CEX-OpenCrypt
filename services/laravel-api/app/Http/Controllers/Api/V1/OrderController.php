<?php

namespace App\Http\Controllers\Api\V1;

use App\Exceptions\InsufficientBalanceException;
use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\TradingPair;
use App\Models\User;
use App\Services\BalanceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;

class OrderController extends Controller
{
    public function __construct(
        protected BalanceService $balanceService
    ) {}

    /**
     * POST /api/v1/orders
     * Endpoint penempatan order spot CEX dengan validasi, balance locking, dan streaming Redis.
     */
    public function store(Request $request): JsonResponse
    {
        // 1. Validasi Input
        $validated = $request->validate([
            'symbol' => ['required', 'string'],
            'side' => ['required', 'string', 'in:BUY,SELL'],
            'type' => ['nullable', 'string', 'in:LIMIT,MARKET'],
            'price' => ['required_if:type,LIMIT', 'nullable', 'numeric', 'gt:0'],
            'quantity' => ['required', 'numeric', 'gt:0'],
            'user_id' => ['nullable', 'integer'], // Untuk testing / server-to-server
        ]);

        $user = $request->user() ?? ($request->filled('user_id') ? User::find($request->user_id) : null);
        if (!$user) {
            return response()->json([
                'message' => 'Unauthenticated.',
                'error' => 'Pengguna tidak terotentikasi.',
            ], 401);
        }

        if ($user->status !== 'ACTIVE') {
            return response()->json([
                'message' => 'Account Suspended',
                'error' => "Akun berstatus {$user->status}.",
            ], 403);
        }

        if ($user->isAdmin()) {
            return response()->json([
                'message' => 'Trading restricted',
                'error' => 'Administrator accounts are restricted from trading.',
            ], 403);
        }

        $symbol = strtoupper($validated['symbol']);
        $pair = TradingPair::with(['baseCurrency', 'quoteCurrency'])
            ->where('symbol', $symbol)
            ->first();

        if (!$pair) {
            return response()->json([
                'message' => 'Trading pair not found.',
                'error' => "Simbol trading {$symbol} tidak ditemukan.",
            ], 404);
        }

        if ($pair->status !== 'TRADING') {
            return response()->json([
                'message' => 'Trading Halted',
                'error' => "Trading untuk {$symbol} sedang {$pair->status}.",
            ], 422);
        }

        $side = strtoupper($validated['side']);
        $type = strtoupper($validated['type'] ?? 'LIMIT');
        $price = isset($validated['price']) ? (string) $validated['price'] : null;
        $quantity = (string) $validated['quantity'];

        // Validasi minimum kuantitas
        if (bccomp($quantity, $pair->min_order_quantity, BalanceService::SCALE) < 0) {
            return response()->json([
                'message' => 'Quantity below minimum.',
                'error' => "Kuantitas minimum untuk {$symbol} adalah {$pair->min_order_quantity}.",
            ], 422);
        }

        // 2. Hitung dana yang dibutuhkan & aset yang dikunci
        if ($side === 'BUY') {
            if ($type === 'LIMIT' && !$price) {
                return response()->json([
                    'message' => 'Price required for LIMIT order.',
                ], 422);
            }
            // BUY: Mengunci Quote Currency (e.g. USDT) sejumlah price * quantity
            $lockedCurrency = $pair->quoteCurrency;
            $lockedAmount = bcmul($price, $quantity, BalanceService::SCALE);

            if (bccomp($lockedAmount, $pair->min_order_notional, BalanceService::SCALE) < 0) {
                return response()->json([
                    'message' => 'Order notional below minimum.',
                    'error' => "Nilai pesanan minimum adalah {$pair->min_order_notional} {$lockedCurrency->code}.",
                ], 422);
            }
        } else {
            // SELL: Mengunci Base Currency (e.g. BTC) sejumlah quantity
            $lockedCurrency = $pair->baseCurrency;
            $lockedAmount = $quantity;
        }

        try {
            // 3. Jalankan DB::transaction dengan Pessimistic Balance Locking
            $order = DB::transaction(function () use (
                $user,
                $pair,
                $side,
                $type,
                $price,
                $quantity,
                $lockedCurrency,
                $lockedAmount
            ) {
                // Generate UUID terlebih dahulu untuk referensi ledger
                $orderUuid = (string) Str::uuid();

                // Kunci saldo di wallet user (lockForUpdate via BalanceService)
                // Jika balance kurang, throw InsufficientBalanceException (HTTP 422)
                $this->balanceService->lockBalanceForOrder(
                    userId: $user->id,
                    currency: $lockedCurrency,
                    amount: $lockedAmount,
                    orderId: $orderUuid,
                    description: "Order Lock: {$side} {$quantity} {$pair->symbol} @ {$price}"
                );

                // Buat record order baru dengan status OPEN (aktif di buku order)
                return Order::create([
                    'uuid' => $orderUuid,
                    'user_id' => $user->id,
                    'trading_pair_id' => $pair->id,
                    'side' => $side,
                    'type' => $type,
                    'price' => $price,
                    'quantity' => $quantity,
                    'filled_quantity' => '0.000000000000000000',
                    'filled_quote_amount' => '0.000000000000000000',
                    'locked_amount' => $lockedAmount,
                    'locked_currency_id' => $lockedCurrency->id,
                    'status' => 'OPEN',
                ]);
            });

            // 4. Push event order baru ke Redis Stream (order_stream) & Pub/Sub
            try {
                $payload = [
                    'event' => 'order_placed',
                    'order_id' => (string) $order->id,
                    'order_uuid' => (string) $order->uuid,
                    'user_id' => (string) $order->user_id,
                    'symbol' => $pair->symbol,
                    'side' => $order->side,
                    'type' => $order->type,
                    'price' => (string) $order->price,
                    'quantity' => (string) $order->quantity,
                    'locked_amount' => (string) $order->locked_amount,
                    'locked_currency' => $lockedCurrency->code,
                    'created_at' => (string) $order->created_at->toISOString(),
                    'timestamp' => (string) now()->getTimestampMs(),
                ];

                Redis::xadd('order_stream', '*', $payload);
                Redis::publish('orders:created', json_encode($payload));
            } catch (\Throwable $redisEx) {
                // Jangan batalkan order database jika koneksi Redis terputus saat mock/test
                Log::warning('[OrderController] Gagal push ke Redis Stream: ' . $redisEx->getMessage());
            }

            // 5. Response 201 Created
            return response()->json([
                'success' => true,
                'message' => 'Order placed successfully and queued to matching engine.',
                'data' => [
                    'order_id' => $order->id,
                    'uuid' => $order->uuid,
                    'symbol' => $pair->symbol,
                    'side' => $order->side,
                    'type' => $order->type,
                    'price' => $order->price,
                    'quantity' => $order->quantity,
                    'locked_amount' => $order->locked_amount,
                    'locked_currency' => $lockedCurrency->code,
                    'status' => $order->status,
                    'created_at' => $order->created_at,
                ],
            ], 201);

        } catch (InsufficientBalanceException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Insufficient Balance',
                'error' => $e->getMessage(),
            ], 422);
        } catch (\Throwable $e) {
            Log::error('[OrderController] Gagal membuat order: ' . $e->getMessage(), [
                'exception' => $e,
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Gagal memproses order.',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * GET /api/v1/orders
     * Daftar order milik user yang sedang login
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = Order::with('tradingPair')
            ->where('user_id', $user->id)
            ->latest('id');

        if ($request->filled('symbol')) {
            $pair = TradingPair::where('symbol', strtoupper($request->symbol))->first();
            if ($pair) {
                $query->where('trading_pair_id', $pair->id);
            }
        }

        if ($request->filled('status')) {
            $query->where('status', strtoupper($request->status));
        }

        $orders = $query->limit(50)->get()->map(function ($o) {
            return [
                'id' => $o->id,
                'uuid' => $o->uuid,
                'symbol' => $o->tradingPair->symbol,
                'side' => $o->side,
                'type' => $o->type,
                'price' => $o->price,
                'quantity' => $o->quantity,
                'filled_quantity' => $o->filled_quantity,
                'status' => $o->status,
                'created_at' => $o->created_at->toISOString(),
            ];
        });

        return response()->json([
            'success' => true,
            'data' => $orders,
        ]);
    }

    /**
     * DELETE /api/v1/orders/{uuid}
     * Membatalkan order aktif dan me-refund saldo terkunci
     */
    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $order = Order::where('uuid', $uuid)
            ->where('user_id', $user->id)
            ->firstOrFail();

        $orderService = app(\App\Services\OrderService::class);
        $canceled = $orderService->cancelOrder($order);

        return response()->json([
            'success' => true,
            'message' => 'Order berhasil dibatalkan dan saldo telah di-unlock.',
            'data' => [
                'uuid' => $canceled->uuid,
                'status' => $canceled->status,
                'canceled_at' => $canceled->canceled_at,
            ],
        ]);
    }
}
