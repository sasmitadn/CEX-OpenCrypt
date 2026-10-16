<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Currency;
use App\Models\Deposit;
use App\Models\DepositAddress;
use App\Models\InternalTransfer;
use App\Models\LedgerEntry;
use App\Models\User;
use App\Models\Wallet;
use App\Services\BalanceService;
use App\Services\WithdrawalService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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
                    'networks' => $w->currency->networks ?? [],
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
        $user = $request->user();
        if ($user->isAdmin()) {
            return response()->json([
                'success' => false,
                'message' => 'Administrator accounts are restricted from depositing funds.',
            ], 403);
        }

        $validated = $request->validate([
            'currency' => ['required', 'string'],
            'network' => ['nullable', 'string'],
        ]);

        $currency = Currency::where('code', strtoupper($validated['currency']))->firstOrFail();
        
        $networks = $currency->networks ?? [];
        $defaultNetwork = !empty($networks) ? ($networks[0]['network'] ?? 'ETH') : 'ETH';
        $network = strtoupper($validated['network'] ?? $defaultNetwork);

        // Cari deposit address aktif
        $addr = DepositAddress::firstOrCreate(
            [
                'user_id' => $user->id,
                'currency_id' => $currency->id,
                'network' => $network,
            ],
            [
                'address' => $this->generateAddress($user->id, $currency->id, $network, $currency->code),
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
     * Generate valid blockchain address format based on network & currency
     */
    protected function generateAddress(int $userId, int $currencyId, string $network, string $currencyCode): string
    {
        $net = strtoupper($network);
        $code = strtoupper($currencyCode);

        if ($net === 'BTC' || $code === 'BTC') {
            $raw = hash('sha256', "BTC_CEX_{$userId}_{$currencyId}", true);
            $h160 = hash('ripemd160', $raw, true);
            $payload = "\x00" . $h160;
            $checksum = substr(hash('sha256', hash('sha256', $payload, true), true), 0, 4);
            $data = $payload . $checksum;

            $chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
            $hex = bin2hex($data);
            $dec = '0';
            for ($i = 0; $i < strlen($hex); $i++) {
                $dec = bcadd(bcmul($dec, '16'), (string) hexdec($hex[$i]));
            }
            $encoded = '';
            while (bccomp($dec, '0') > 0) {
                $rem = bcmod($dec, '58');
                $dec = bcdiv($dec, '58', 0);
                $encoded = $chars[(int) $rem] . $encoded;
            }
            for ($i = 0; $i < strlen($data) && $data[$i] === "\x00"; $i++) {
                $encoded = '1' . $encoded;
            }
            return $encoded;
        }

        // EVM formatted address (0x...)
        return '0x' . substr(hash('sha256', "EVM_{$userId}_{$currencyId}_{$net}"), 0, 40);
    }

    /**
     * POST /api/v1/wallets/withdraw
     * Ajukan penarikan dana on-chain
     */
    public function withdraw(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($user->isAdmin()) {
            return response()->json([
                'success' => false,
                'message' => 'Administrator accounts are restricted from withdrawing funds.',
            ], 403);
        }

        $validated = $request->validate([
            'currency' => ['required', 'string'],
            'network' => ['required', 'string'],
            'to_address' => ['required', 'string'],
            'amount' => ['required', 'numeric', 'gt:0'],
            'memo_tag' => ['nullable', 'string'],
        ]);

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
     * GET /api/v1/wallets/withdrawals
     * Riwayat pengajuan withdrawal milik user yang sedang login
     */
    public function withdrawals(Request $request): JsonResponse
    {
        $user = $request->user();
        $items = \App\Models\Withdrawal::with('currency')
            ->where('user_id', $user->id)
            ->latest()
            ->limit(50)
            ->get()
            ->map(function ($w) {
                return [
                    'id' => $w->id,
                    'uuid' => $w->uuid,
                    'currency' => $w->currency ? $w->currency->code : 'UNKNOWN',
                    'network' => $w->network,
                    'to_address' => $w->to_address,
                    'amount' => $w->amount,
                    'fee' => $w->fee,
                    'net_amount' => $w->net_amount,
                    'tx_hash' => $w->tx_hash,
                    'status' => $w->status,
                    'rejection_reason' => $w->rejection_reason,
                    'created_at' => $w->created_at ? $w->created_at->toISOString() : null,
                    'updated_at' => $w->updated_at ? $w->updated_at->toISOString() : null,
                ];
            });

        return response()->json([
            'success' => true,
            'data' => $items,
        ]);
    }

    /**
     * GET /api/v1/wallets/deposits
     * Riwayat deposit on-chain milik user yang sedang login
     */
    public function deposits(Request $request): JsonResponse
    {
        $user = $request->user();
        $items = Deposit::with('currency')
            ->where('user_id', $user->id)
            ->latest()
            ->limit(50)
            ->get()
            ->map(function ($d) {
                return [
                    'id' => $d->id,
                    'uuid' => $d->uuid,
                    'currency' => $d->currency ? $d->currency->code : 'UNKNOWN',
                    'network' => $d->network,
                    'to_address' => $d->to_address,
                    'from_address' => $d->from_address,
                    'amount' => $d->amount,
                    'fee' => $d->fee,
                    'tx_hash' => $d->tx_hash,
                    'confirmations' => $d->confirmations,
                    'required_confirmations' => $d->required_confirmations,
                    'status' => $d->status,
                    'credited_at' => $d->credited_at ? $d->credited_at->toISOString() : null,
                    'created_at' => $d->created_at ? $d->created_at->toISOString() : null,
                ];
            });

        return response()->json([
            'success' => true,
            'data' => $items,
        ]);
    }

    /**
     * POST /api/v1/wallets/transfer-internal
     * Transfer koin antar pengguna di internal CEX (off-chain, instan, zero fee)
     */
    public function transferInternal(Request $request): JsonResponse
    {
        $sender = $request->user();
        if ($sender->isAdmin()) {
            return response()->json([
                'success' => false,
                'message' => 'Administrator accounts cannot transfer funds.',
            ], 403);
        }

        $validated = $request->validate([
            'currency' => ['required', 'string'],
            'recipient' => ['required', 'string'], // email or user id
            'amount' => ['required', 'numeric', 'gt:0'],
            'memo' => ['nullable', 'string', 'max:255'],
        ]);

        $recipientQuery = trim($validated['recipient']);
        $recipient = User::where('email', strtolower($recipientQuery))
            ->orWhere('id', is_numeric($recipientQuery) ? (int) $recipientQuery : 0)
            ->first();

        if (!$recipient) {
            return response()->json([
                'success' => false,
                'message' => 'Recipient user not found. Check the email or user ID.',
            ], 404);
        }

        if ($recipient->id === $sender->id) {
            return response()->json([
                'success' => false,
                'message' => 'Cannot transfer funds to yourself.',
            ], 422);
        }

        if ($recipient->status !== 'ACTIVE') {
            return response()->json([
                'success' => false,
                'message' => 'Recipient account is currently suspended or inactive.',
            ], 422);
        }

        $currency = Currency::where('code', strtoupper($validated['currency']))->firstOrFail();
        $transferAmount = (string) $validated['amount'];

        $transfer = DB::transaction(function () use ($sender, $recipient, $currency, $transferAmount, $validated) {
            // Lock sender wallet
            $senderWallet = Wallet::where('user_id', $sender->id)
                ->where('currency_id', $currency->id)
                ->where('type', 'SPOT')
                ->lockForUpdate()
                ->first();

            if (!$senderWallet || bccomp($senderWallet->balance, $transferAmount, BalanceService::SCALE) < 0) {
                throw new \RuntimeException('Insufficient available balance for this internal transfer.');
            }

            // Lock recipient wallet (create if not exist)
            $recipientWallet = Wallet::firstOrCreate(
                ['user_id' => $recipient->id, 'currency_id' => $currency->id, 'type' => 'SPOT'],
                ['uuid' => (string) Str::uuid(), 'balance' => '0', 'locked_balance' => '0', 'status' => 'ACTIVE']
            );

            $recipientWallet = Wallet::where('id', $recipientWallet->id)->lockForUpdate()->first();

            $senderBalanceBefore = $senderWallet->balance;
            $recipientBalanceBefore = $recipientWallet->balance;

            // Update balances
            $senderWallet->balance = bcsub($senderWallet->balance, $transferAmount, BalanceService::SCALE);
            $senderWallet->save();

            $recipientWallet->balance = bcadd($recipientWallet->balance, $transferAmount, BalanceService::SCALE);
            $recipientWallet->save();

            // Record InternalTransfer
            $intTransfer = InternalTransfer::create([
                'sender_id' => $sender->id,
                'recipient_id' => $recipient->id,
                'currency_id' => $currency->id,
                'amount' => $transferAmount,
                'memo' => $validated['memo'] ?? null,
                'status' => 'COMPLETED',
            ]);

            // Ledger record for sender (DEBIT)
            LedgerEntry::create([
                'uuid' => (string) Str::uuid(),
                'wallet_id' => $senderWallet->id,
                'user_id' => $sender->id,
                'currency_id' => $currency->id,
                'entry_type' => 'DEBIT',
                'amount' => '-' . $transferAmount,
                'fee' => '0',
                'balance_before' => $senderBalanceBefore,
                'balance_after' => $senderWallet->balance,
                'locked_before' => $senderWallet->locked_balance,
                'locked_after' => $senderWallet->locked_balance,
                'reference_type' => 'INTERNAL_TRANSFER',
                'reference_id' => (string) $intTransfer->id,
                'description' => "Internal transfer to {$recipient->email} ({$recipient->name})",
                'metadata' => [
                    'direction' => 'OUT',
                    'recipient_id' => $recipient->id,
                    'recipient_email' => $recipient->email,
                    'memo' => $validated['memo'] ?? null,
                ],
            ]);

            // Ledger record for recipient (CREDIT)
            LedgerEntry::create([
                'uuid' => (string) Str::uuid(),
                'wallet_id' => $recipientWallet->id,
                'user_id' => $recipient->id,
                'currency_id' => $currency->id,
                'entry_type' => 'CREDIT',
                'amount' => '+' . $transferAmount,
                'fee' => '0',
                'balance_before' => $recipientBalanceBefore,
                'balance_after' => $recipientWallet->balance,
                'locked_before' => $recipientWallet->locked_balance,
                'locked_after' => $recipientWallet->locked_balance,
                'reference_type' => 'INTERNAL_TRANSFER',
                'reference_id' => (string) $intTransfer->id,
                'description' => "Internal transfer from {$sender->email} ({$sender->name})",
                'metadata' => [
                    'direction' => 'IN',
                    'sender_id' => $sender->id,
                    'sender_email' => $sender->email,
                    'memo' => $validated['memo'] ?? null,
                ],
            ]);

            return $intTransfer;
        });

        return response()->json([
            'success' => true,
            'message' => "Internal transfer of {$transferAmount} {$currency->code} to {$recipient->email} completed instantly with 0 fee.",
            'data' => [
                'uuid' => $transfer->uuid,
                'currency' => $currency->code,
                'amount' => $transfer->amount,
                'recipient_email' => $recipient->email,
                'recipient_name' => $recipient->name,
                'recipient_id' => $recipient->id,
                'created_at' => $transfer->created_at->toISOString(),
            ],
        ], 201);
    }

    /**
     * GET /api/v1/wallets/transfers
     * Riwayat transfer internal (kirim dan terima) milik user
     */
    public function transfers(Request $request): JsonResponse
    {
        $user = $request->user();
        $items = InternalTransfer::with(['sender', 'recipient', 'currency'])
            ->where(function ($query) use ($user) {
                $query->where('sender_id', $user->id)
                    ->orWhere('recipient_id', $user->id);
            })
            ->latest()
            ->limit(50)
            ->get()
            ->map(function ($t) use ($user) {
                $isSender = ($t->sender_id === $user->id);
                $counterparty = $isSender ? $t->recipient : $t->sender;

                return [
                    'id' => $t->id,
                    'uuid' => $t->uuid,
                    'direction' => $isSender ? 'OUT' : 'IN',
                    'type' => $isSender ? 'SENT' : 'RECEIVED',
                    'currency' => $t->currency ? $t->currency->code : 'UNKNOWN',
                    'amount' => $t->amount,
                    'counterparty_id' => $counterparty ? $counterparty->id : null,
                    'counterparty_email' => $counterparty ? $counterparty->email : 'Unknown',
                    'counterparty_name' => $counterparty ? $counterparty->name : 'Unknown',
                    'memo' => $t->memo,
                    'status' => $t->status,
                    'created_at' => $t->created_at ? $t->created_at->toISOString() : null,
                ];
            });

        return response()->json([
            'success' => true,
            'data' => $items,
        ]);
    }

    /**
     * POST /api/v1/wallets/faucet
     * Fitur kemudahan testing: Mengisi saldo demo untuk user
     */
    public function faucet(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($user->isAdmin()) {
            return response()->json([
                'success' => false,
                'message' => 'Administrator accounts cannot claim faucet balance.',
            ], 403);
        }

        $validated = $request->validate([
            'currency' => ['required', 'string'],
            'amount' => ['required', 'numeric', 'gt:0'],
        ]);

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
