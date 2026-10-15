<?php

namespace App\Services;

use App\Exceptions\InsufficientBalanceException;
use App\Exceptions\InvalidFinancialStateException;
use App\Models\LedgerEntry;
use App\Models\Wallet;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class WalletService
{
    public const DEFAULT_SCALE = 18;

    /**
     * Dapatkan wallet user dengan pessimistic lock (SELECT ... FOR UPDATE).
     * WAJIB dipanggil di dalam DB::transaction().
     */
    public function lockAndGetWallet(int $userId, int $currencyId, string $type = 'SPOT'): Wallet
    {
        if (DB::transactionLevel() === 0) {
            throw new InvalidFinancialStateException("Pessimistic lock (lockForUpdate) wajib dijalankan di dalam DB::transaction().");
        }

        // Cari atau buat wallet jika belum ada
        $wallet = Wallet::firstOrCreate(
            [
                'user_id' => $userId,
                'currency_id' => $currencyId,
                'type' => $type,
            ],
            [
                'uuid' => (string) Str::uuid(),
                'balance' => '0.000000000000000000',
                'locked_balance' => '0.000000000000000000',
                'status' => 'ACTIVE',
            ]
        );

        // Ambil instance dengan pessimistic row lock
        $lockedWallet = Wallet::where('id', $wallet->id)
            ->lockForUpdate()
            ->firstOrFail();

        if ($lockedWallet->status !== 'ACTIVE') {
            throw new InvalidFinancialStateException("Wallet ID {$lockedWallet->id} dalam status {$lockedWallet->status} (non-aktif).");
        }

        return $lockedWallet;
    }

    /**
     * Credit saldo (menambah available balance) & catat di double-entry ledger.
     * Digunakan saat deposit selesai atau menerima pembayaran trade.
     */
    public function creditBalance(
        Wallet $wallet,
        string $amount,
        string $referenceId,
        string $referenceType,
        string $description,
        ?array $metadata = null
    ): LedgerEntry {
        if (bccomp($amount, '0', self::DEFAULT_SCALE) <= 0) {
            throw new InvalidFinancialStateException("Jumlah kredit harus lebih besar dari 0.");
        }

        $balanceBefore = $wallet->balance;
        $lockedBefore = $wallet->locked_balance;

        $balanceAfter = bcadd($balanceBefore, $amount, self::DEFAULT_SCALE);

        $wallet->balance = $balanceAfter;
        $wallet->save();

        return LedgerEntry::create([
            'uuid' => (string) Str::uuid(),
            'reference_id' => $referenceId,
            'reference_type' => $referenceType,
            'wallet_id' => $wallet->id,
            'user_id' => $wallet->user_id,
            'currency_id' => $wallet->currency_id,
            'entry_type' => 'CREDIT',
            'amount' => $amount,
            'fee' => '0.000000000000000000',
            'balance_before' => $balanceBefore,
            'balance_after' => $balanceAfter,
            'locked_before' => $lockedBefore,
            'locked_after' => $lockedBefore,
            'description' => $description,
            'metadata' => $metadata,
        ]);
    }

    /**
     * Debit saldo (mengurangi available balance) & catat di ledger.
     */
    public function debitBalance(
        Wallet $wallet,
        string $amount,
        string $referenceId,
        string $referenceType,
        string $description,
        ?array $metadata = null
    ): LedgerEntry {
        if (bccomp($amount, '0', self::DEFAULT_SCALE) <= 0) {
            throw new InvalidFinancialStateException("Jumlah debit harus lebih besar dari 0.");
        }

        if (bccomp($wallet->balance, $amount, self::DEFAULT_SCALE) < 0) {
            throw new InsufficientBalanceException("Saldo tidak mencukupi. Tersedia: {$wallet->balance}, Dibutuhkan: {$amount}");
        }

        $balanceBefore = $wallet->balance;
        $lockedBefore = $wallet->locked_balance;

        $balanceAfter = bcsub($balanceBefore, $amount, self::DEFAULT_SCALE);

        $wallet->balance = $balanceAfter;
        $wallet->save();

        return LedgerEntry::create([
            'uuid' => (string) Str::uuid(),
            'reference_id' => $referenceId,
            'reference_type' => $referenceType,
            'wallet_id' => $wallet->id,
            'user_id' => $wallet->user_id,
            'currency_id' => $wallet->currency_id,
            'entry_type' => 'DEBIT',
            'amount' => $amount,
            'fee' => '0.000000000000000000',
            'balance_before' => $balanceBefore,
            'balance_after' => $balanceAfter,
            'locked_before' => $lockedBefore,
            'locked_after' => $lockedBefore,
            'description' => $description,
            'metadata' => $metadata,
        ]);
    }

    /**
     * Mengunci saldo dari available -> locked (untuk open order atau request withdraw).
     */
    public function lockBalance(
        Wallet $wallet,
        string $amount,
        string $referenceId,
        string $referenceType,
        string $description,
        ?array $metadata = null
    ): LedgerEntry {
        if (bccomp($amount, '0', self::DEFAULT_SCALE) <= 0) {
            throw new InvalidFinancialStateException("Jumlah lock harus lebih besar dari 0.");
        }

        if (bccomp($wallet->balance, $amount, self::DEFAULT_SCALE) < 0) {
            throw new InsufficientBalanceException("Saldo tidak mencukupi untuk dikunci. Tersedia: {$wallet->balance}, Dibutuhkan: {$amount}");
        }

        $balanceBefore = $wallet->balance;
        $lockedBefore = $wallet->locked_balance;

        $balanceAfter = bcsub($balanceBefore, $amount, self::DEFAULT_SCALE);
        $lockedAfter = bcadd($lockedBefore, $amount, self::DEFAULT_SCALE);

        $wallet->balance = $balanceAfter;
        $wallet->locked_balance = $lockedAfter;
        $wallet->save();

        return LedgerEntry::create([
            'uuid' => (string) Str::uuid(),
            'reference_id' => $referenceId,
            'reference_type' => $referenceType,
            'wallet_id' => $wallet->id,
            'user_id' => $wallet->user_id,
            'currency_id' => $wallet->currency_id,
            'entry_type' => 'DEBIT', // Mengurangi available balance
            'amount' => $amount,
            'fee' => '0.000000000000000000',
            'balance_before' => $balanceBefore,
            'balance_after' => $balanceAfter,
            'locked_before' => $lockedBefore,
            'locked_after' => $lockedAfter,
            'description' => $description,
            'metadata' => $metadata,
        ]);
    }

    /**
     * Membuka kunci saldo dari locked -> available (misal order dibatalkan atau withdraw ditolak).
     */
    public function unlockBalance(
        Wallet $wallet,
        string $amount,
        string $referenceId,
        string $referenceType,
        string $description,
        ?array $metadata = null
    ): LedgerEntry {
        if (bccomp($amount, '0', self::DEFAULT_SCALE) <= 0) {
            throw new InvalidFinancialStateException("Jumlah unlock harus lebih besar dari 0.");
        }

        if (bccomp($wallet->locked_balance, $amount, self::DEFAULT_SCALE) < 0) {
            throw new InvalidFinancialStateException("Saldo terkunci tidak mencukupi untuk di-unlock. Terkunci: {$wallet->locked_balance}, Diminta: {$amount}");
        }

        $balanceBefore = $wallet->balance;
        $lockedBefore = $wallet->locked_balance;

        $balanceAfter = bcadd($balanceBefore, $amount, self::DEFAULT_SCALE);
        $lockedAfter = bcsub($lockedBefore, $amount, self::DEFAULT_SCALE);

        $wallet->balance = $balanceAfter;
        $wallet->locked_balance = $lockedAfter;
        $wallet->save();

        return LedgerEntry::create([
            'uuid' => (string) Str::uuid(),
            'reference_id' => $referenceId,
            'reference_type' => $referenceType,
            'wallet_id' => $wallet->id,
            'user_id' => $wallet->user_id,
            'currency_id' => $wallet->currency_id,
            'entry_type' => 'CREDIT', // Mengembalikan ke available balance
            'amount' => $amount,
            'fee' => '0.000000000000000000',
            'balance_before' => $balanceBefore,
            'balance_after' => $balanceAfter,
            'locked_before' => $lockedBefore,
            'locked_after' => $lockedAfter,
            'description' => $description,
            'metadata' => $metadata,
        ]);
    }

    /**
     * Mengurangi locked balance secara permanen (saat order matched terisi atau withdraw berhasil terkirim di blockchain).
     */
    public function consumeLockedBalance(
        Wallet $wallet,
        string $amount,
        string $referenceId,
        string $referenceType,
        string $description,
        ?array $metadata = null
    ): LedgerEntry {
        if (bccomp($amount, '0', self::DEFAULT_SCALE) <= 0) {
            throw new InvalidFinancialStateException("Jumlah consume harus lebih besar dari 0.");
        }

        if (bccomp($wallet->locked_balance, $amount, self::DEFAULT_SCALE) < 0) {
            throw new InvalidFinancialStateException("Saldo terkunci tidak mencukupi. Terkunci: {$wallet->locked_balance}, Dibutuhkan: {$amount}");
        }

        $balanceBefore = $wallet->balance;
        $lockedBefore = $wallet->locked_balance;

        $lockedAfter = bcsub($lockedBefore, $amount, self::DEFAULT_SCALE);

        $wallet->locked_balance = $lockedAfter;
        $wallet->save();

        return LedgerEntry::create([
            'uuid' => (string) Str::uuid(),
            'reference_id' => $referenceId,
            'reference_type' => $referenceType,
            'wallet_id' => $wallet->id,
            'user_id' => $wallet->user_id,
            'currency_id' => $wallet->currency_id,
            'entry_type' => 'DEBIT',
            'amount' => $amount,
            'fee' => '0.000000000000000000',
            'balance_before' => $balanceBefore,
            'balance_after' => $balanceBefore,
            'locked_before' => $lockedBefore,
            'locked_after' => $lockedAfter,
            'description' => $description,
            'metadata' => $metadata,
        ]);
    }

    /**
     * Transfer antar-wallet secara atomik dengan kaidah Double-Entry Bookkeeping murni (Debit wallet A, Credit wallet B).
     */
    public function transferDoubleEntry(
        Wallet $fromWallet,
        Wallet $toWallet,
        string $amount,
        string $referenceId,
        string $referenceType,
        string $description,
        ?array $metadata = null
    ): array {
        if ($fromWallet->currency_id !== $toWallet->currency_id) {
            throw new InvalidFinancialStateException("Transfer double-entry hanya valid untuk mata uang yang identik.");
        }

        // Debit pengirim
        $debitEntry = $this->debitBalance(
            $fromWallet,
            $amount,
            $referenceId,
            $referenceType,
            "{$description} [DEBIT DARI #{$fromWallet->id}]",
            $metadata
        );

        // Credit penerima
        $creditEntry = $this->creditBalance(
            $toWallet,
            $amount,
            $referenceId,
            $referenceType,
            "{$description} [KREDIT KE #{$toWallet->id}]",
            $metadata
        );

        return [
            'debit_entry' => $debitEntry,
            'credit_entry' => $creditEntry,
        ];
    }
}
