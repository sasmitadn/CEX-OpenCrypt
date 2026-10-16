<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Currency;
use App\Models\Deposit;
use App\Models\LedgerEntry;
use App\Models\Order;
use App\Models\Trade;
use App\Models\TradingPair;
use App\Models\User;
use App\Models\Wallet;
use App\Models\Withdrawal;
use App\Services\BalanceService;
use App\Services\WalletService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;

class AdminController extends Controller
{
    public const PILLAR_CURRENCIES = ['BTC', 'ETH', 'USDT', 'ARB', 'MATIC', 'BNB', 'AVAX'];
    public const CORE_PAIRS = [
        'BTC_USDT', 'ETH_USDT', 'ARB_USDT', 'MATIC_USDT', 'BNB_USDT', 'AVAX_USDT',
        'BTCUSDT', 'ETHUSDT', 'ARBUSDT', 'MATICUSDT', 'BNBUSDT', 'AVAXUSDT'
    ];
    public function __construct(
        protected BalanceService $balanceService,
        protected WalletService $walletService
    ) {}

    /**
     * Pastikan hanya user dengan role ADMIN yang diizinkan
     */
    protected function authorizeAdmin(Request $request): void
    {
        $user = $request->user();
        if (!$user || !$user->isAdmin()) {
            abort(403, 'Akses ditolak. Endpoint ini hanya untuk Administrator.');
        }
    }

    /**
     * GET /api/v1/admin/overview
     * Ringkasan statistik performa bursa
     */
    public function overview(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        $totalUsers = User::count();
        $totalOrders = Order::count();
        $totalTrades = Trade::count();
        $totalDeposits = Deposit::where('status', 'COMPLETED')->count();
        $pendingWithdrawals = Withdrawal::where('status', 'PENDING_APPROVAL')->count();
        $completedWithdrawals = Withdrawal::where('status', 'COMPLETED')->count();

        // Total trading volume in quote (USDT)
        $totalVolumeUsdt = Trade::sum('quote_amount') ?? '0';

        return response()->json([
            'success' => true,
            'data' => [
                'total_users' => $totalUsers,
                'total_orders' => $totalOrders,
                'total_trades' => $totalTrades,
                'total_volume_usdt' => (string) $totalVolumeUsdt,
                'total_deposits' => $totalDeposits,
                'pending_withdrawals' => $pendingWithdrawals,
                'completed_withdrawals' => $completedWithdrawals,
            ],
        ]);
    }

    /**
     * GET /api/v1/admin/withdrawals
     * Daftar seluruh permintaan withdraw dengan filter status
     */
    public function withdrawals(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        $query = Withdrawal::with(['user', 'currency'])->latest('id');

        if ($request->filled('status')) {
            $query->where('status', strtoupper($request->status));
        }

        $withdrawals = $query->limit(100)->get()->map(function ($w) {
            return [
                'id' => $w->id,
                'uuid' => $w->uuid,
                'user_id' => $w->user_id,
                'user_email' => $w->user ? $w->user->email : 'N/A',
                'user_name' => $w->user ? $w->user->name : 'N/A',
                'currency' => $w->currency->code,
                'network' => $w->network,
                'to_address' => $w->to_address,
                'memo_tag' => $w->memo_tag,
                'amount' => $w->amount,
                'fee' => $w->fee,
                'net_amount' => $w->net_amount,
                'tx_hash' => $w->tx_hash,
                'status' => $w->status,
                'rejection_reason' => $w->rejection_reason,
                'approved_at' => $w->approved_at,
                'created_at' => $w->created_at->toISOString(),
            ];
        });

        return response()->json([
            'success' => true,
            'data' => $withdrawals,
        ]);
    }

    /**
     * POST /api/v1/admin/withdrawals/{uuid}/approve
     * Menyetujui permintaan withdrawal & mendispatch ke blockchain dispatcher
     */
    public function approveWithdrawal(Request $request, string $uuid): JsonResponse
    {
        $this->authorizeAdmin($request);

        $withdrawal = Withdrawal::with(['currency', 'user'])
            ->where('uuid', $uuid)
            ->firstOrFail();

        if ($withdrawal->status !== 'PENDING_APPROVAL') {
            return response()->json([
                'success' => false,
                'message' => "Withdrawal tidak dapat diapprove karena berstatus {$withdrawal->status}.",
            ], 422);
        }

        $admin = $request->user();

        DB::transaction(function () use ($withdrawal, $admin) {
            $withdrawal->status = 'APPROVED';
            $withdrawal->approved_by = $admin->id;
            $withdrawal->approved_at = now();
            $withdrawal->save();

            // Push ke antrean Redis withdrawals_queue untuk Node.js Dispatcher
            try {
                $payload = json_encode([
                    'withdrawal_id' => $withdrawal->id,
                    'uuid' => $withdrawal->uuid,
                    'user_id' => $withdrawal->user_id,
                    'currency' => $withdrawal->currency->code,
                    'network' => $withdrawal->network,
                    'to_address' => $withdrawal->to_address,
                    'amount' => (string) $withdrawal->net_amount,
                    'decimals' => $withdrawal->currency->decimals,
                ]);

                Redis::lpush('withdrawals_queue', $payload);
            } catch (\Throwable $e) {
                // Biarkan tetap approved di database jika Redis offline
            }
        });

        return response()->json([
            'success' => true,
            'message' => "Withdrawal #{$withdrawal->id} berhasil disetujui dan dikirim ke Blockchain Dispatcher.",
            'data' => $withdrawal,
        ]);
    }

    /**
     * POST /api/v1/admin/withdrawals/{uuid}/reject
     * Menolak permintaan withdrawal dan mengembalikan (refund) saldo ke user
     */
    public function rejectWithdrawal(Request $request, string $uuid): JsonResponse
    {
        $this->authorizeAdmin($request);

        $validated = $request->validate([
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        $withdrawal = Withdrawal::with('currency')
            ->where('uuid', $uuid)
            ->firstOrFail();

        if ($withdrawal->status !== 'PENDING_APPROVAL') {
            return response()->json([
                'success' => false,
                'message' => "Withdrawal tidak dapat direject karena berstatus {$withdrawal->status}.",
            ], 422);
        }

        $admin = $request->user();
        $reason = $validated['reason'] ?? 'Ditolak oleh administrator bursa.';

        DB::transaction(function () use ($withdrawal, $admin, $reason) {
            $wallet = $this->walletService->lockAndGetWallet($withdrawal->user_id, $withdrawal->currency_id, 'SPOT');

            // 1. Refund locked_balance -> balance
            $this->walletService->unlockBalance(
                wallet: $wallet,
                amount: $withdrawal->amount,
                referenceId: (string) $withdrawal->id,
                referenceType: 'WITHDRAWAL_REFUND',
                description: "Refund penolakan withdrawal #{$withdrawal->id}: {$reason}"
            );

            // 2. Update status withdrawal
            $withdrawal->status = 'REJECTED';
            $withdrawal->rejection_reason = $reason;
            $withdrawal->approved_by = $admin->id;
            $withdrawal->save();
        });

        return response()->json([
            'success' => true,
            'message' => "Withdrawal #{$withdrawal->id} telah ditolak dan saldo telah dikembalikan ke user.",
            'data' => $withdrawal,
        ]);
    }

    /**
     * GET /api/v1/admin/transactions
     * Riwayat semua transaksi: Trade, Deposit, Withdrawal, Ledger
     */
    public function transactions(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        $trades = Trade::with('tradingPair')
            ->latest('id')
            ->limit(50)
            ->get()
            ->map(fn($t) => [
                'type' => 'TRADE',
                'id' => $t->id,
                'uuid' => $t->uuid,
                'pair' => $t->tradingPair ? $t->tradingPair->symbol : 'BTC_USDT',
                'price' => $t->price,
                'quantity' => $t->quantity,
                'total' => $t->quote_amount,
                'maker_fee' => $t->maker_fee,
                'taker_fee' => $t->taker_fee,
                'time' => $t->created_at->toISOString(),
            ]);

        $deposits = Deposit::with(['user', 'currency'])
            ->latest('id')
            ->limit(30)
            ->get()
            ->map(fn($d) => [
                'type' => 'DEPOSIT',
                'id' => $d->id,
                'uuid' => $d->uuid,
                'user' => $d->user ? $d->user->email : 'N/A',
                'currency' => $d->currency ? $d->currency->code : 'ETH',
                'network' => $d->network,
                'amount' => $d->amount,
                'tx_hash' => $d->tx_hash,
                'status' => $d->status,
                'time' => $d->created_at->toISOString(),
            ]);

        return response()->json([
            'success' => true,
            'data' => [
                'trades' => $trades,
                'deposits' => $deposits,
            ],
        ]);
    }

    /**
     * GET /api/v1/admin/users
     * Daftar pengguna beserta saldo koin mereka
     */
    public function users(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        $users = User::with(['wallets.currency'])
            ->latest('id')
            ->limit(100)
            ->get()
            ->map(function ($u) {
                return [
                    'id' => $u->id,
                    'name' => $u->name,
                    'email' => $u->email,
                    'role' => $u->role ?? 'TRADER',
                    'status' => $u->status,
                    'kyc_level' => $u->kyc_level,
                    'created_at' => $u->created_at->toISOString(),
                    'wallets' => $u->wallets->map(fn($w) => [
                        'currency' => $w->currency ? $w->currency->code : 'N/A',
                        'balance' => $w->balance,
                        'locked' => $w->locked_balance,
                    ]),
                ];
            });

        return response()->json([
            'success' => true,
            'data' => $users,
        ]);
    }

    /**
     * POST /api/v1/admin/users/{id}/status
     * Ubah status user (ACTIVE, SUSPENDED, BANNED)
     */
    public function updateUserStatus(Request $request, int $id): JsonResponse
    {
        $this->authorizeAdmin($request);

        $validated = $request->validate([
            'status' => ['required', 'string', 'in:ACTIVE,SUSPENDED,BANNED'],
        ]);

        $user = User::findOrFail($id);
        $user->status = $validated['status'];
        $user->save();

        return response()->json([
            'success' => true,
            'message' => "Status pengguna {$user->email} berhasil diubah menjadi {$user->status}.",
            'data' => $user,
        ]);
    }

    /**
     * GET /api/v1/admin/currencies
     * Daftar mata uang dan network yang didukung
     */
    public function currencies(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        $currencies = Currency::all()->map(function ($c) {
            $isPillar = in_array($c->code, self::PILLAR_CURRENCIES);
            return [
                'id' => $c->id,
                'code' => $c->code,
                'name' => $c->name,
                'type' => $c->type,
                'decimals' => $c->decimals,
                'min_deposit' => $c->min_deposit,
                'min_withdraw' => $c->min_withdraw,
                'withdraw_fee' => $c->withdraw_fee,
                'is_deposit_enabled' => $c->is_deposit_enabled,
                'is_withdraw_enabled' => $c->is_withdraw_enabled,
                'is_trading_enabled' => $c->is_trading_enabled,
                'status' => $c->status,
                'is_pillar' => $isPillar,
                'networks' => is_array($c->networks) ? $c->networks : json_decode($c->networks, true) ?? [],
            ];
        });

        return response()->json([
            'success' => true,
            'data' => $currencies,
        ]);
    }

    /**
     * POST /api/v1/admin/currencies
     * Tambah koin / token baru (misal BEP-20, ERC-20, Meme coin)
     */
    public function createCurrency(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        $validated = $request->validate([
            'code' => ['required', 'string', 'max:20', 'unique:currencies,code'],
            'name' => ['required', 'string', 'max:100'],
            'network' => ['required', 'string', 'in:BTC,ETH,ARB,MATIC,BNB,AVAX'],
            'contract_address' => ['nullable', 'string', 'max:100'],
            'decimals' => ['nullable', 'integer', 'min:0', 'max:36'],
            'min_deposit' => ['nullable', 'numeric', 'min:0'],
            'min_withdraw' => ['nullable', 'numeric', 'min:0'],
            'withdraw_fee' => ['nullable', 'numeric', 'min:0'],
            'is_deposit_enabled' => ['nullable', 'boolean'],
            'is_withdraw_enabled' => ['nullable', 'boolean'],
            'is_trading_enabled' => ['nullable', 'boolean'],
            'status' => ['nullable', 'string', 'in:ACTIVE,MAINTENANCE,DISABLED'],
        ]);

        $code = strtoupper(trim($validated['code']));
        $networkCode = strtoupper($validated['network']);

        $networkNames = [
            'ETH' => 'Ethereum (ERC-20 / Sepolia)',
            'BNB' => 'BNB Smart Chain (BEP-20)',
            'ARB' => 'Arbitrum One (L2)',
            'MATIC' => 'Polygon PoS',
            'AVAX' => 'Avalanche C-Chain',
            'BTC' => 'Bitcoin Network',
        ];
        $confBlocks = [
            'ETH' => 12,
            'BNB' => 15,
            'ARB' => 1,
            'MATIC' => 64,
            'AVAX' => 1,
            'BTC' => 2,
        ];

        $networks = [
            [
                'network' => $networkCode,
                'name' => $networkNames[$networkCode] ?? $networkCode,
                'contract_address' => $validated['contract_address'] ?? null,
                'confirmation_blocks' => $confBlocks[$networkCode] ?? 12,
            ]
        ];

        $currency = Currency::create([
            'code' => $code,
            'name' => $validated['name'],
            'type' => 'CRYPTO',
            'decimals' => (int) ($validated['decimals'] ?? 18),
            'min_deposit' => (string) ($validated['min_deposit'] ?? '0.000000000000000000'),
            'min_withdraw' => (string) ($validated['min_withdraw'] ?? '0.000000000000000000'),
            'withdraw_fee' => (string) ($validated['withdraw_fee'] ?? '0.000000000000000000'),
            'is_deposit_enabled' => $validated['is_deposit_enabled'] ?? true,
            'is_withdraw_enabled' => $validated['is_withdraw_enabled'] ?? true,
            'is_trading_enabled' => $validated['is_trading_enabled'] ?? true,
            'status' => $validated['status'] ?? 'ACTIVE',
            'networks' => $networks,
        ]);

        // Auto-inisialisasi SPOT wallet untuk seluruh user terdaftar
        $users = User::all();
        foreach ($users as $u) {
            Wallet::firstOrCreate(
                ['user_id' => $u->id, 'currency_id' => $currency->id, 'type' => 'SPOT'],
                ['uuid' => (string) Str::uuid(), 'balance' => '0', 'locked_balance' => '0', 'status' => 'ACTIVE']
            );
        }

        // Auto-create trading pair dengan USDT jika trading diaktifkan
        if ($code !== 'USDT' && ($validated['is_trading_enabled'] ?? true)) {
            $usdt = Currency::where('code', 'USDT')->first();
            if ($usdt) {
                TradingPair::firstOrCreate(
                    ['symbol' => "{$code}USDT"],
                    [
                        'base_currency_id' => $currency->id,
                        'quote_currency_id' => $usdt->id,
                        'price_precision' => 4,
                        'quantity_precision' => 2,
                        'min_order_quantity' => '1',
                        'min_order_notional' => '5',
                        'maker_fee_rate' => '0.001000',
                        'taker_fee_rate' => '0.002000',
                        'status' => 'TRADING',
                    ]
                );
            }
        }

        return response()->json([
            'success' => true,
            'message' => "Token {$currency->code} pada jaringan {$networkCode} berhasil ditambahkan.",
            'data' => $currency,
        ], 201);
    }

    /**
     * PUT /api/v1/admin/currencies/{id}
     * Update konfigurasi koin/token
     */
    public function updateCurrency(Request $request, int $id): JsonResponse
    {
        $this->authorizeAdmin($request);

        $currency = Currency::findOrFail($id);
        $isPillar = in_array($currency->code, self::PILLAR_CURRENCIES);

        $validated = $request->validate([
            'name' => ['nullable', 'string', 'max:100'],
            'contract_address' => ['nullable', 'string', 'max:100'],
            'decimals' => ['nullable', 'integer', 'min:0', 'max:36'],
            'min_deposit' => ['nullable', 'numeric', 'min:0'],
            'min_withdraw' => ['nullable', 'numeric', 'min:0'],
            'withdraw_fee' => ['nullable', 'numeric', 'min:0'],
            'is_deposit_enabled' => ['nullable', 'boolean'],
            'is_withdraw_enabled' => ['nullable', 'boolean'],
            'is_trading_enabled' => ['nullable', 'boolean'],
            'status' => ['nullable', 'string', 'in:ACTIVE,MAINTENANCE,DISABLED'],
        ]);

        if (isset($validated['name']) && !$isPillar) {
            $currency->name = $validated['name'];
        }
        if (isset($validated['decimals']) && !$isPillar) {
            $currency->decimals = (int) $validated['decimals'];
        }
        if (isset($validated['min_deposit'])) {
            $currency->min_deposit = (string) $validated['min_deposit'];
        }
        if (isset($validated['min_withdraw'])) {
            $currency->min_withdraw = (string) $validated['min_withdraw'];
        }
        if (isset($validated['withdraw_fee'])) {
            $currency->withdraw_fee = (string) $validated['withdraw_fee'];
        }
        if (isset($validated['is_deposit_enabled'])) {
            $currency->is_deposit_enabled = (bool) $validated['is_deposit_enabled'];
        }
        if (isset($validated['is_withdraw_enabled'])) {
            $currency->is_withdraw_enabled = (bool) $validated['is_withdraw_enabled'];
        }
        if (isset($validated['is_trading_enabled'])) {
            $currency->is_trading_enabled = (bool) $validated['is_trading_enabled'];
        }
        if (isset($validated['status'])) {
            $currency->status = $validated['status'];
        }

        if (array_key_exists('contract_address', $validated) && !$isPillar) {
            $networks = $currency->networks ?? [];
            if (!empty($networks)) {
                $networks[0]['contract_address'] = $validated['contract_address'];
            }
            $currency->networks = $networks;
        }

        $currency->save();

        return response()->json([
            'success' => true,
            'message' => "Mata uang {$currency->code} berhasil diperbarui.",
            'data' => $currency,
        ]);
    }

    /**
     * DELETE /api/v1/admin/currencies/{id}
     * Hapus token kustom (Pillar coins dilindungi)
     */
    public function deleteCurrency(Request $request, int $id): JsonResponse
    {
        $this->authorizeAdmin($request);

        $currency = Currency::findOrFail($id);

        if (in_array($currency->code, self::PILLAR_CURRENCIES)) {
            return response()->json([
                'success' => false,
                'message' => "Koin pilar utama ({$currency->code}) dilindungi sistem dan tidak dapat dihapus.",
            ], 403);
        }

        DB::transaction(function () use ($currency) {
            // Hapus trading pair dan order terkait
            $pairIds = TradingPair::where('base_currency_id', $currency->id)
                ->orWhere('quote_currency_id', $currency->id)
                ->pluck('id');

            if ($pairIds->isNotEmpty()) {
                Trade::whereIn('trading_pair_id', $pairIds)->delete();
                Order::whereIn('trading_pair_id', $pairIds)->delete();
                TradingPair::whereIn('id', $pairIds)->delete();
            }

            // Hapus wallet & ledger terkait
            $walletIds = Wallet::where('currency_id', $currency->id)->pluck('id');
            if ($walletIds->isNotEmpty()) {
                LedgerEntry::whereIn('wallet_id', $walletIds)->delete();
                Wallet::whereIn('id', $walletIds)->delete();
            }

            \App\Models\DepositAddress::where('currency_id', $currency->id)->delete();
            Deposit::where('currency_id', $currency->id)->delete();
            Withdrawal::where('currency_id', $currency->id)->delete();

            $currency->delete();
        });

        return response()->json([
            'success' => true,
            'message' => "Token {$currency->code} berhasil dihapus dari bursa.",
        ]);
    }

    /**
     * GET /api/v1/admin/pairs
     * Daftar trading pair beserta tarif pajak maker & taker
     */
    public function pairs(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        $pairs = TradingPair::with(['baseCurrency', 'quoteCurrency'])->get()->map(function ($p) {
            $isCore = in_array($p->symbol, self::CORE_PAIRS);
            return [
                'id' => $p->id,
                'symbol' => $p->symbol,
                'base_currency_id' => $p->base_currency_id,
                'quote_currency_id' => $p->quote_currency_id,
                'base' => $p->baseCurrency ? $p->baseCurrency->code : 'UNKNOWN',
                'base_name' => $p->baseCurrency ? $p->baseCurrency->name : 'Unknown',
                'quote' => $p->quoteCurrency ? $p->quoteCurrency->code : 'UNKNOWN',
                'quote_name' => $p->quoteCurrency ? $p->quoteCurrency->name : 'Unknown',
                'price_precision' => $p->price_precision,
                'quantity_precision' => $p->quantity_precision,
                'maker_fee_rate' => $p->maker_fee_rate,
                'taker_fee_rate' => $p->taker_fee_rate,
                'maker_fee_percent' => bcmul($p->maker_fee_rate, '100', 4),
                'taker_fee_percent' => bcmul($p->taker_fee_rate, '100', 4),
                'min_order_quantity' => $p->min_order_quantity,
                'min_order_notional' => $p->min_order_notional,
                'status' => $p->status,
                'is_core' => $isCore,
            ];
        });

        return response()->json([
            'success' => true,
            'data' => $pairs,
        ]);
    }

    /**
     * POST /api/v1/admin/pairs
     * Tambah trading pair baru dengan pilihan base & quote currency
     */
    public function createPair(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        $validated = $request->validate([
            'base_currency_id' => ['required', 'integer', 'exists:currencies,id'],
            'quote_currency_id' => ['required', 'integer', 'exists:currencies,id', 'different:base_currency_id'],
            'maker_fee_percent' => ['required', 'numeric', 'min:0', 'max:10'],
            'taker_fee_percent' => ['required', 'numeric', 'min:0', 'max:10'],
            'min_order_quantity' => ['nullable', 'numeric', 'min:0.00000001'],
            'min_order_notional' => ['nullable', 'numeric', 'min:0.00000001'],
            'price_precision' => ['nullable', 'integer', 'min:0', 'max:8'],
            'quantity_precision' => ['nullable', 'integer', 'min:0', 'max:8'],
            'status' => ['nullable', 'string', 'in:TRADING,HALTED,CANCEL_ONLY,DISABLED'],
        ]);

        $base = Currency::findOrFail($validated['base_currency_id']);
        $quote = Currency::findOrFail($validated['quote_currency_id']);

        $symbol = strtoupper($base->code . '_' . $quote->code);

        // Cek duplikasi pair
        $existing = TradingPair::where('symbol', $symbol)
            ->orWhere('symbol', strtoupper($base->code . $quote->code))
            ->orWhere(function ($q) use ($base, $quote) {
                $q->where('base_currency_id', $base->id)->where('quote_currency_id', $quote->id);
            })
            ->first();

        if ($existing) {
            return response()->json([
                'success' => false,
                'message' => "Trading pair {$symbol} sudah terdaftar sebelumnya.",
            ], 422);
        }

        $makerRate = bcdiv((string) $validated['maker_fee_percent'], '100', 6);
        $takerRate = bcdiv((string) $validated['taker_fee_percent'], '100', 6);

        $pair = TradingPair::create([
            'symbol' => $symbol,
            'base_currency_id' => $base->id,
            'quote_currency_id' => $quote->id,
            'price_precision' => (int) ($validated['price_precision'] ?? 4),
            'quantity_precision' => (int) ($validated['quantity_precision'] ?? 2),
            'min_order_quantity' => (string) ($validated['min_order_quantity'] ?? '1.0'),
            'min_order_notional' => (string) ($validated['min_order_notional'] ?? '5.0'),
            'maker_fee_rate' => $makerRate,
            'taker_fee_rate' => $takerRate,
            'status' => $validated['status'] ?? 'TRADING',
        ]);

        return response()->json([
            'success' => true,
            'message' => "Trading pair {$pair->symbol} ({$base->code}/{$quote->code}) berhasil dibuat.",
            'data' => [
                'id' => $pair->id,
                'symbol' => $pair->symbol,
                'base' => $base->code,
                'quote' => $quote->code,
                'maker_fee_percent' => $validated['maker_fee_percent'],
                'taker_fee_percent' => $validated['taker_fee_percent'],
                'min_order_quantity' => $pair->min_order_quantity,
                'min_order_notional' => $pair->min_order_notional,
                'price_precision' => $pair->price_precision,
                'quantity_precision' => $pair->quantity_precision,
                'status' => $pair->status,
                'is_core' => false,
            ],
        ], 201);
    }

    /**
     * PUT /api/v1/admin/pairs/{id}
     * Update parameter trading pair lengkap
     */
    public function updatePair(Request $request, int $id): JsonResponse
    {
        $this->authorizeAdmin($request);

        $pair = TradingPair::with(['baseCurrency', 'quoteCurrency'])->findOrFail($id);

        $validated = $request->validate([
            'maker_fee_percent' => ['nullable', 'numeric', 'min:0', 'max:10'],
            'taker_fee_percent' => ['nullable', 'numeric', 'min:0', 'max:10'],
            'min_order_quantity' => ['nullable', 'numeric', 'min:0.00000001'],
            'min_order_notional' => ['nullable', 'numeric', 'min:0.00000001'],
            'price_precision' => ['nullable', 'integer', 'min:0', 'max:8'],
            'quantity_precision' => ['nullable', 'integer', 'min:0', 'max:8'],
            'status' => ['nullable', 'string', 'in:TRADING,HALTED,CANCEL_ONLY,DISABLED'],
        ]);

        if (isset($validated['maker_fee_percent'])) {
            $pair->maker_fee_rate = bcdiv((string) $validated['maker_fee_percent'], '100', 6);
        }
        if (isset($validated['taker_fee_percent'])) {
            $pair->taker_fee_rate = bcdiv((string) $validated['taker_fee_percent'], '100', 6);
        }
        if (isset($validated['min_order_quantity'])) {
            $pair->min_order_quantity = (string) $validated['min_order_quantity'];
        }
        if (isset($validated['min_order_notional'])) {
            $pair->min_order_notional = (string) $validated['min_order_notional'];
        }
        if (isset($validated['price_precision'])) {
            $pair->price_precision = (int) $validated['price_precision'];
        }
        if (isset($validated['quantity_precision'])) {
            $pair->quantity_precision = (int) $validated['quantity_precision'];
        }
        if (isset($validated['status'])) {
            $pair->status = $validated['status'];
        }

        $pair->save();

        return response()->json([
            'success' => true,
            'message' => "Parameter trading pair {$pair->symbol} berhasil diperbarui.",
            'data' => [
                'id' => $pair->id,
                'symbol' => $pair->symbol,
                'base' => $pair->baseCurrency->code,
                'quote' => $pair->quoteCurrency->code,
                'maker_fee_percent' => bcmul($pair->maker_fee_rate, '100', 4),
                'taker_fee_percent' => bcmul($pair->taker_fee_rate, '100', 4),
                'min_order_quantity' => $pair->min_order_quantity,
                'min_order_notional' => $pair->min_order_notional,
                'price_precision' => $pair->price_precision,
                'quantity_precision' => $pair->quantity_precision,
                'status' => $pair->status,
                'is_core' => in_array($pair->symbol, self::CORE_PAIRS),
            ],
        ]);
    }

    /**
     * DELETE /api/v1/admin/pairs/{id}
     * Hapus trading pair kustom
     */
    public function deletePair(Request $request, int $id): JsonResponse
    {
        $this->authorizeAdmin($request);

        $pair = TradingPair::findOrFail($id);

        if (in_array($pair->symbol, self::CORE_PAIRS)) {
            return response()->json([
                'success' => false,
                'message' => "Trading pair pilar utama ({$pair->symbol}) dilindungi sistem dan tidak dapat dihapus.",
            ], 403);
        }

        DB::transaction(function () use ($pair) {
            Trade::where('trading_pair_id', $pair->id)->delete();
            Order::where('trading_pair_id', $pair->id)->delete();
            $pair->delete();
        });

        return response()->json([
            'success' => true,
            'message' => "Trading pair {$pair->symbol} berhasil dihapus dari pasar.",
        ]);
    }

    /**
     * PUT /api/v1/admin/pairs/{id}/fees
     * Atur persentase pajak maker & taker untuk trading pair tertentu atau seluruh pair
     */
    public function updatePairFees(Request $request, int $id): JsonResponse
    {
        $this->authorizeAdmin($request);

        $makerPercent = $request->input('maker_fee_percent') ?? (
            $request->has('maker_fee_rate') ? bcmul((string) $request->input('maker_fee_rate'), '100', 4) : null
        );
        $takerPercent = $request->input('taker_fee_percent') ?? (
            $request->has('taker_fee_rate') ? bcmul((string) $request->input('taker_fee_rate'), '100', 4) : null
        );

        if ($makerPercent === null || $takerPercent === null) {
            return response()->json([
                'success' => false,
                'message' => 'Parameter maker_fee_percent and taker_fee_percent are required.',
            ], 422);
        }

        $makerRate = bcdiv((string) $makerPercent, '100', 6);
        $takerRate = bcdiv((string) $takerPercent, '100', 6);

        if (!empty($request->input('apply_to_all'))) {
            TradingPair::query()->update([
                'maker_fee_rate' => $makerRate,
                'taker_fee_rate' => $takerRate,
            ]);

            return response()->json([
                'success' => true,
                'message' => "Pajak fee untuk SELURUH trading pair berhasil diperbarui: Maker {$makerPercent}%, Taker {$takerPercent}%.",
            ]);
        }

        $pair = TradingPair::findOrFail($id);
        $pair->maker_fee_rate = $makerRate;
        $pair->taker_fee_rate = $takerRate;
        $pair->save();

        return response()->json([
            'success' => true,
            'message' => "Pajak fee untuk {$pair->symbol} berhasil diperbarui: Maker {$makerPercent}%, Taker {$takerPercent}%.",
            'data' => $pair,
        ]);
    }
}
