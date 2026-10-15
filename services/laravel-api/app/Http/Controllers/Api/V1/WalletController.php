<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Currency;
use App\Models\DepositAddress;
use App\Models\Wallet;
use App\Services\BalanceService;
use App\Services\WithdrawalService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class WalletController extends Controller
{
    public function __construct(
        protected WithdrawalService $withdrawalService,
        protected BalanceService $balanceService
    ) {}

    /**
     * GET /api/v1/wallets
     * Ambil seluruh saldo wallet pengguna
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        // Pastikan setiap currency memiliki wallet record
        $currencies = Currency::all();
        foreach ($currencies as $curr) {
            Wallet::firstOrCreate(
                ['user_id' => $user->id, 'currency_id' => $curr->id, 'type' => 'SPOT'],
                ['uuid' => (string) Str::uuid(), 'balance' => '0', 'locked_balance' => '0', 'status' => 'ACTIVE']
            );
        }

        $wallets = Wallet::with('currency')
            ->where('user_id', $user->id)
            ->where('type', 'SPOT')
            ->get()
            ->map(function ($w) {
                return [
                    'id' => $w->id,
                    'currency' => $w->currency->code,
                    'name' => $w->currency->name,
                    'balance' => $w->balance,
                    'locked' => $w->locked_balance,
                    'total' => bcadd($w->balance, $w->locked_balance, BalanceService::SCALE),
                    'decimals' => $w->currency->decimals,
                    'can_deposit' => $w->currency->is_deposit_enabled,
                    'can_withdraw' => $w->currency->is_withdraw_enabled,
                ];
            });

        return response()->json([
            'success' => true,
            'data' => $wallets,
        ]);
    }

    /**
     * POST /api/v1/wallets/deposit-address
     * Dapatkan atau generate deposit address untuk mata uang & network
     */
    public function depositAddress(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'currency' => ['required', 'string'],
            'network' => ['nullable', 'string'],
        ]);

        $user = $request->user();
        $currency = Currency::where('code', strtoupper($validated['currency']))->firstOrFail();
        $network = strtoupper($validated['network'] ?? 'SEPOLIA');

        // Cari deposit address aktif
        $addr = DepositAddress::firstOrCreate(
            [
                'user_id' => $user->id,
                'currency_id' => $currency->id,
                'network' => $network,
            ],
            [
                'address' => '0x' . substr(hash('sha256', $user->id . '_' . $currency->id . '_' . $network), 0, 40),
                'status' => 'ACTIVE',
            ]
        );

        return response()->json([
            'success' => true,
            'data' => [
                'currency' => $currency->code,
                'network' => $network,
                'address' => $addr->address,
                'memo_tag' => $addr->memo_tag,
            ],
        ]);
    }

    /**
     * POST /api/v1/wallets/withdraw
     * Ajukan penarikan dana on-chain
     */
    public function withdraw(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'currency' => ['required', 'string'],
            'network' => ['required', 'string'],
            'to_address' => ['required', 'string'],
            'amount' => ['required', 'numeric', 'gt:0'],
            'memo_tag' => ['nullable', 'string'],
        ]);

        $user = $request->user();
        $currency = Currency::where('code', strtoupper($validated['currency']))->firstOrFail();

        $withdrawal = $this->withdrawalService->requestWithdrawal(
            user: $user,
            currencyId: $currency->id,
            network: strtoupper($validated['network']),
            toAddress: $validated['to_address'],
            amount: (string) $validated['amount'],
            memoTag: $validated['memo_tag'] ?? null
        );

        return response()->json([
            'success' => true,
            'message' => 'Permintaan penarikan dana berhasil dibuat dan menunggu approval.',
            'data' => [
                'id' => $withdrawal->id,
                'uuid' => $withdrawal->uuid,
                'currency' => $currency->code,
                'amount' => $withdrawal->amount,
                'fee' => $withdrawal->fee,
                'net_amount' => $withdrawal->net_amount,
                'status' => $withdrawal->status,
            ],
        ], 201);
    }

    /**
     * POST /api/v1/wallets/faucet
     * Fitur kemudahan testing: Mengisi saldo demo untuk user
     */
    public function faucet(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'currency' => ['required', 'string'],
            'amount' => ['required', 'numeric', 'gt:0'],
        ]);

        $user = $request->user();
        $currency = Currency::where('code', strtoupper($validated['currency']))->firstOrFail();

        $entry = $this->balanceService->depositCredit(
            userId: $user->id,
            currency: $currency,
            amount: (string) $validated['amount'],
            txHash: 'FAUCET_' . Str::random(16),
            network: 'DEMO'
        );

        return response()->json([
            'success' => true,
            'message' => "Berhasil menambahkan {$validated['amount']} {$currency->code} ke saldo demo.",
            'data' => [
                'currency' => $currency->code,
                'amount' => $validated['amount'],
                'new_balance' => $entry->balance_after,
            ],
        ]);
    }
}
