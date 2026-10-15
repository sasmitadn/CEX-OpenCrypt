<?php

namespace App\Services;

use App\Exceptions\InsufficientBalanceException;
use App\Exceptions\InvalidFinancialStateException;
use App\Models\Currency;
use App\Models\User;
use App\Models\Withdrawal;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class WithdrawalService
{
    public function __construct(
        protected WalletService $walletService
    ) {}

    /**
     * Mengajukan request withdrawal & langsung mengunci saldo user agar tidak dapat di-double spend.
     */
    public function requestWithdrawal(
        User $user,
        int $currencyId,
        string $network,
        string $toAddress,
        string $amount,
        ?string $memoTag = null
    ): Withdrawal {
        if ($user->status !== 'ACTIVE') {
            throw new InvalidFinancialStateException("Akun pengguna sedang berstatus {$user->status}.");
        }

        $currency = Currency::findOrFail($currencyId);
        if (!$currency->is_withdraw_enabled) {
            throw new InvalidFinancialStateException("Penarikan untuk {$currency->code} sedang ditutup.");
        }

        if (bccomp($amount, $currency->min_withdraw, WalletService::DEFAULT_SCALE) < 0) {
            throw new InvalidFinancialStateException("Jumlah minimum withdraw adalah {$currency->min_withdraw} {$currency->code}.");
        }

        $fee = $currency->withdraw_fee;
        $totalDeduction = bcadd($amount, $fee, WalletService::DEFAULT_SCALE); // Saldo yang dikunci = amount + fee

        return DB::transaction(function () use (
            $user,
            $currency,
            $network,
            $toAddress,
            $amount,
            $fee,
            $totalDeduction,
            $memoTag
        ) {
            // 1. Kunci wallet user dengan pessimistic lock
            $wallet = $this->walletService->lockAndGetWallet($user->id, $currency->id, 'SPOT');

            if (bccomp($wallet->balance, $totalDeduction, WalletService::DEFAULT_SCALE) < 0) {
                throw new InsufficientBalanceException("Saldo tidak mencukupi untuk withdraw dan fee. Dibutuhkan: {$totalDeduction}, Tersedia: {$wallet->balance}");
            }

            // 2. Buat record Withdrawal dengan status PENDING_APPROVAL
            $withdrawal = Withdrawal::create([
                'uuid' => (string) Str::uuid(),
                'user_id' => $user->id,
                'currency_id' => $currency->id,
                'wallet_id' => $wallet->id,
                'network' => $network,
                'to_address' => $toAddress,
                'memo_tag' => $memoTag,
                'amount' => $amount,
                'fee' => $fee,
                'net_amount' => $amount, // Jumlah bersih yang akan ditransfer ke blockchain
                'status' => 'PENDING_APPROVAL',
            ]);

            // 3. Kunci saldo di wallet user (available -> locked)
            $this->walletService->lockBalance(
                wallet: $wallet,
                amount: $totalDeduction,
                referenceId: (string) $withdrawal->id,
                referenceType: 'WITHDRAW_LOCK',
                description: "Hold saldo untuk withdrawal #{$withdrawal->id} ({$amount} + fee {$fee} {$currency->code})",
                metadata: [
                    'to_address' => $toAddress,
                    'network' => $network,
                ]
            );

            return $withdrawal;
        });
    }

    /**
     * Menyetujui withdrawal oleh admin atau fraud system.
     */
    public function approveWithdrawal(Withdrawal $withdrawal, User $admin): Withdrawal
    {
        return DB::transaction(function () use ($withdrawal, $admin) {
            $lockedWithdrawal = Withdrawal::where('id', $withdrawal->id)->lockForUpdate()->firstOrFail();

            if ($lockedWithdrawal->status !== 'PENDING_APPROVAL') {
                throw new InvalidFinancialStateException("Withdrawal tidak dalam status PENDING_APPROVAL.");
            }

            $lockedWithdrawal->status = 'PROCESSING';
            $lockedWithdrawal->approved_by = $admin->id;
            $lockedWithdrawal->approved_at = now();
            $lockedWithdrawal->save();

            return $lockedWithdrawal;
        });
    }

    /**
     * Tandai withdrawal telah disiarkan ke blockchain oleh Blockchain Worker.
     */
    public function markBroadcasted(Withdrawal $withdrawal, string $txHash): Withdrawal
    {
        return DB::transaction(function () use ($withdrawal, $txHash) {
            $lockedWithdrawal = Withdrawal::where('id', $withdrawal->id)->lockForUpdate()->firstOrFail();

            if (!in_array($lockedWithdrawal->status, ['APPROVED', 'PROCESSING'])) {
                throw new InvalidFinancialStateException("Status withdrawal tidak valid untuk broadcast: {$lockedWithdrawal->status}");
            }

            $lockedWithdrawal->status = 'BROADCASTED';
            $lockedWithdrawal->tx_hash = $txHash;
            $lockedWithdrawal->broadcasted_at = now();
            $lockedWithdrawal->save();

            return $lockedWithdrawal;
        });
    }

    /**
     * Konfirmasi withdrawal berhasil di blockchain (memotong saldo terkunci secara permanen).
     */
    public function confirmWithdrawal(Withdrawal $withdrawal): Withdrawal
    {
        return DB::transaction(function () use ($withdrawal) {
            $lockedWithdrawal = Withdrawal::where('id', $withdrawal->id)->lockForUpdate()->firstOrFail();

            if ($lockedWithdrawal->status === 'COMPLETED') {
                return $lockedWithdrawal;
            }

            if (!in_array($lockedWithdrawal->status, ['PROCESSING', 'BROADCASTED'])) {
                throw new InvalidFinancialStateException("Status withdrawal tidak valid untuk penyelesaian: {$lockedWithdrawal->status}");
            }

            $wallet = $this->walletService->lockAndGetWallet($lockedWithdrawal->user_id, $lockedWithdrawal->currency_id, 'SPOT');
            $totalDeducted = bcadd($lockedWithdrawal->amount, $lockedWithdrawal->fee, WalletService::DEFAULT_SCALE);

            // Potong saldo terkunci secara permanen & catat di ledger final
            $this->walletService->consumeLockedBalance(
                wallet: $wallet,
                amount: $totalDeducted,
                referenceId: (string) $lockedWithdrawal->id,
                referenceType: 'WITHDRAW',
                description: "Penyelesaian on-chain withdrawal #{$lockedWithdrawal->id} (TX: {$lockedWithdrawal->tx_hash})",
                metadata: [
                    'tx_hash' => $lockedWithdrawal->tx_hash,
                    'network' => $lockedWithdrawal->network,
                    'net_amount' => $lockedWithdrawal->net_amount,
                    'fee' => $lockedWithdrawal->fee,
                ]
            );

            $lockedWithdrawal->status = 'COMPLETED';
            $lockedWithdrawal->completed_at = now();
            $lockedWithdrawal->save();

            return $lockedWithdrawal;
        });
    }

    /**
     * Batalkan atau tolak withdrawal (mengembalikan saldo terkunci ke available balance).
     */
    public function rejectWithdrawal(Withdrawal $withdrawal, string $reason): Withdrawal
    {
        return DB::transaction(function () use ($withdrawal, $reason) {
            $lockedWithdrawal = Withdrawal::where('id', $withdrawal->id)->lockForUpdate()->firstOrFail();

            if (!in_array($lockedWithdrawal->status, ['PENDING_APPROVAL', 'APPROVED', 'FAILED'])) {
                throw new InvalidFinancialStateException("Withdrawal dalam status {$lockedWithdrawal->status} tidak dapat ditolak/di-refund.");
            }

            $wallet = $this->walletService->lockAndGetWallet($lockedWithdrawal->user_id, $lockedWithdrawal->currency_id, 'SPOT');
            $totalLocked = bcadd($lockedWithdrawal->amount, $lockedWithdrawal->fee, WalletService::DEFAULT_SCALE);

            // Refund saldo terkunci kembali ke available balance
            $this->walletService->unlockBalance(
                wallet: $wallet,
                amount: $totalLocked,
                referenceId: (string) $lockedWithdrawal->id,
                referenceType: 'WITHDRAW_REFUND',
                description: "Pengembalian dana withdrawal dibatalkan #{$lockedWithdrawal->id}: {$reason}",
                metadata: [
                    'rejection_reason' => $reason,
                ]
            );

            $lockedWithdrawal->status = 'REJECTED';
            $lockedWithdrawal->rejection_reason = $reason;
            $lockedWithdrawal->save();

            return $lockedWithdrawal;
        });
    }
}
