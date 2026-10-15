<?php

namespace App\Services;

use App\Exceptions\InsufficientBalanceException;
use App\Exceptions\InvalidFinancialStateException;
use App\Models\Currency;
use App\Models\LedgerEntry;
use App\Models\TradingPair;
use App\Models\Wallet;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class BalanceService
{
    public const SCALE = 18;

    /**
     * Dapatkan instance Wallet dengan pessimistic row lock (SELECT ... FOR UPDATE).
     * Wajib dipanggil dalam DB::transaction().
     */
    public function lockAndGetWallet(int $userId, int|Currency $currency, string $type = 'SPOT'): Wallet
    {
        if (DB::transactionLevel() === 0) {
            throw new InvalidFinancialStateException("Pessimistic locking wajib berada di dalam DB::transaction().");
        }

        $currencyId = $currency instanceof Currency ? $currency->id : (int) $currency;

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

        return Wallet::where('id', $wallet->id)
            ->lockForUpdate()
            ->firstOrFail();
    }

    /**
     * 1. depositCredit
     * Menambah available balance dan mencatat entri kredit di ledger_entries.
     */
    public function depositCredit(
        int $userId,
        int|string|Currency $currency,
        string $amount,
        string $txHash,
        ?string $network = null
    ): LedgerEntry {
        $currencyModel = $this->resolveCurrency($currency);

        if (bccomp($amount, '0', self::SCALE) <= 0) {
            throw new InvalidFinancialStateException("Jumlah deposit harus lebih besar dari nol.");
        }

        return DB::transaction(function () use ($userId, $currencyModel, $amount, $txHash, $network) {
            $wallet = $this->lockAndGetWallet($userId, $currencyModel->id, 'SPOT');

            if ($wallet->status !== 'ACTIVE') {
                throw new InvalidFinancialStateException("Wallet dalam status {$wallet->status}.");
            }

            $balanceBefore = $wallet->balance;
            $lockedBefore = $wallet->locked_balance;
            $balanceAfter = bcadd($balanceBefore, $amount, self::SCALE);

            $wallet->balance = $balanceAfter;
            $wallet->save();

            return LedgerEntry::create([
                'uuid' => (string) Str::uuid(),
                'reference_id' => $txHash,
                'reference_type' => 'DEPOSIT',
                'wallet_id' => $wallet->id,
                'user_id' => $userId,
                'currency_id' => $currencyModel->id,
                'entry_type' => 'CREDIT',
                'amount' => $amount,
                'fee' => '0.000000000000000000',
                'balance_before' => $balanceBefore,
                'balance_after' => $balanceAfter,
                'locked_before' => $lockedBefore,
                'locked_after' => $lockedBefore,
                'description' => "Deposit {$amount} {$currencyModel->code} [TX: {$txHash}]",
                'metadata' => [
                    'network' => $network,
                    'tx_hash' => $txHash,
                ],
            ]);
        });
    }

    /**
     * 2. lockBalanceForOrder
     * Memindahkan saldo dari balance (available) ke locked_balance saat order dipasang.
     */
    public function lockBalanceForOrder(
        int $userId,
        int|string|Currency $currency,
        string $amount,
        string $orderId,
        ?string $description = null
    ): LedgerEntry {
        $currencyModel = $this->resolveCurrency($currency);

        if (bccomp($amount, '0', self::SCALE) <= 0) {
            throw new InvalidFinancialStateException("Jumlah dana yang dikunci harus lebih besar dari nol.");
        }

        return DB::transaction(function () use ($userId, $currencyModel, $amount, $orderId, $description) {
            $wallet = $this->lockAndGetWallet($userId, $currencyModel->id, 'SPOT');

            if ($wallet->status !== 'ACTIVE') {
                throw new InvalidFinancialStateException("Wallet tidak aktif.");
            }

            // Validasi saldo mencukupi
            if (bccomp($wallet->balance, $amount, self::SCALE) < 0) {
                throw new InsufficientBalanceException("Saldo {$currencyModel->code} tidak mencukupi. Tersedia: {$wallet->balance}, Dibutuhkan: {$amount}");
            }

            $balanceBefore = $wallet->balance;
            $lockedBefore = $wallet->locked_balance;

            $balanceAfter = bcsub($balanceBefore, $amount, self::SCALE);
            $lockedAfter = bcadd($lockedBefore, $amount, self::SCALE);

            $wallet->balance = $balanceAfter;
            $wallet->locked_balance = $lockedAfter;
            $wallet->save();

            return LedgerEntry::create([
                'uuid' => (string) Str::uuid(),
                'reference_id' => (string) $orderId,
                'reference_type' => 'ORDER_LOCK',
                'wallet_id' => $wallet->id,
                'user_id' => $userId,
                'currency_id' => $currencyModel->id,
                'entry_type' => 'DEBIT', // Mengurangi saldo likuid
                'amount' => $amount,
                'fee' => '0.000000000000000000',
                'balance_before' => $balanceBefore,
                'balance_after' => $balanceAfter,
                'locked_before' => $lockedBefore,
                'locked_after' => $lockedAfter,
                'description' => $description ?? "Lock dana untuk Order #{$orderId} ({$amount} {$currencyModel->code})",
                'metadata' => [
                    'order_id' => $orderId,
                ],
            ]);
        });
    }

    /**
     * Unlock saldo saat order dibatalkan atau kadaluarsa.
     */
    public function unlockBalanceForOrder(
        int $userId,
        int|string|Currency $currency,
        string $amount,
        string $orderId,
        ?string $description = null
    ): LedgerEntry {
        $currencyModel = $this->resolveCurrency($currency);

        if (bccomp($amount, '0', self::SCALE) <= 0) {
            throw new InvalidFinancialStateException("Jumlah dana unlock harus lebih besar dari nol.");
        }

        return DB::transaction(function () use ($userId, $currencyModel, $amount, $orderId, $description) {
            $wallet = $this->lockAndGetWallet($userId, $currencyModel->id, 'SPOT');

            if (bccomp($wallet->locked_balance, $amount, self::SCALE) < 0) {
                throw new InvalidFinancialStateException("Locked balance tidak mencukupi untuk di-unlock. Terkunci: {$wallet->locked_balance}, Diminta: {$amount}");
            }

            $balanceBefore = $wallet->balance;
            $lockedBefore = $wallet->locked_balance;

            $balanceAfter = bcadd($balanceBefore, $amount, self::SCALE);
            $lockedAfter = bcsub($lockedBefore, $amount, self::SCALE);

            $wallet->balance = $balanceAfter;
            $wallet->locked_balance = $lockedAfter;
            $wallet->save();

            return LedgerEntry::create([
                'uuid' => (string) Str::uuid(),
                'reference_id' => (string) $orderId,
                'reference_type' => 'ORDER_UNLOCK',
                'wallet_id' => $wallet->id,
                'user_id' => $userId,
                'currency_id' => $currencyModel->id,
                'entry_type' => 'CREDIT',
                'amount' => $amount,
                'fee' => '0.000000000000000000',
                'balance_before' => $balanceBefore,
                'balance_after' => $balanceAfter,
                'locked_before' => $lockedBefore,
                'locked_after' => $lockedAfter,
                'description' => $description ?? "Unlock dana Order #{$orderId} ({$amount} {$currencyModel->code})",
                'metadata' => [
                    'order_id' => $orderId,
                ],
            ]);
        });
    }

    /**
     * 3. settleTrade
     * Eksekusi trade matching:
     * - Buyer: memotong locked quote currency (USDT), menambah aset base (BTC) ke available balance minus buyerFee.
     * - Seller: memotong locked base currency (BTC), menambah aset quote (USDT) ke available balance minus sellerFee.
     * - Menulis double-entry ledger entries untuk kedua belah pihak secara atomik.
     */
    public function settleTrade(
        int $buyerUserId,
        int $sellerUserId,
        TradingPair $pair,
        string $price,
        string $quantity,
        string $buyerFee = '0.000000000000000000',
        string $sellerFee = '0.000000000000000000',
        ?string $tradeReferenceId = null
    ): array {
        $tradeId = $tradeReferenceId ?? (string) Str::uuid();
        $quoteTotal = bcmul($price, $quantity, self::SCALE); // Total USDT

        return DB::transaction(function () use (
            $buyerUserId,
            $sellerUserId,
            $pair,
            $quantity,
            $quoteTotal,
            $buyerFee,
            $sellerFee,
            $tradeId
        ) {
            // Ambil dan kunci semua 4 wallet secara teratur (sorting ID untuk mencegah deadlock)
            $wallets = [
                'buyer_quote' => $this->lockAndGetWallet($buyerUserId, $pair->quote_currency_id), // USDT
                'buyer_base' => $this->lockAndGetWallet($buyerUserId, $pair->base_currency_id),   // BTC
                'seller_base' => $this->lockAndGetWallet($sellerUserId, $pair->base_currency_id), // BTC
                'seller_quote' => $this->lockAndGetWallet($sellerUserId, $pair->quote_currency_id), // USDT
            ];

            $entries = [];

            // ------------------------------------------------------------------
            // 1. BUYER: Potong quote locked (USDT)
            // ------------------------------------------------------------------
            $buyerQuote = $wallets['buyer_quote'];
            if (bccomp($buyerQuote->locked_balance, $quoteTotal, self::SCALE) < 0) {
                throw new InvalidFinancialStateException("Buyer locked quote balance tidak mencukupi.");
            }
            $bQBefore = $buyerQuote->balance;
            $bQLockedBefore = $buyerQuote->locked_balance;
            $bQLockedAfter = bcsub($bQLockedBefore, $quoteTotal, self::SCALE);
            $buyerQuote->locked_balance = $bQLockedAfter;
            $buyerQuote->save();

            $entries['buyer_quote_debit'] = LedgerEntry::create([
                'uuid' => (string) Str::uuid(),
                'reference_id' => $tradeId,
                'reference_type' => 'TRADE_EXECUTION',
                'wallet_id' => $buyerQuote->id,
                'user_id' => $buyerUserId,
                'currency_id' => $pair->quote_currency_id,
                'entry_type' => 'DEBIT',
                'amount' => $quoteTotal,
                'fee' => '0.000000000000000000',
                'balance_before' => $bQBefore,
                'balance_after' => $bQBefore,
                'locked_before' => $bQLockedBefore,
                'locked_after' => $bQLockedAfter,
                'description' => "Buyer trade match: Potong {$quoteTotal} quote locked",
                'metadata' => ['trade_id' => $tradeId],
            ]);

            // ------------------------------------------------------------------
            // 2. BUYER: Terima base currency (BTC) dikurangi buyer fee
            // ------------------------------------------------------------------
            $buyerBase = $wallets['buyer_base'];
            $bBBefore = $buyerBase->balance;
            $netBaseToBuyer = bcsub($quantity, $buyerFee, self::SCALE);
            $bBAfter = bcadd($bBBefore, $netBaseToBuyer, self::SCALE);
            $buyerBase->balance = $bBAfter;
            $buyerBase->save();

            $entries['buyer_base_credit'] = LedgerEntry::create([
                'uuid' => (string) Str::uuid(),
                'reference_id' => $tradeId,
                'reference_type' => 'TRADE_EXECUTION',
                'wallet_id' => $buyerBase->id,
                'user_id' => $buyerUserId,
                'currency_id' => $pair->base_currency_id,
                'entry_type' => 'CREDIT',
                'amount' => $quantity,
                'fee' => $buyerFee,
                'balance_before' => $bBBefore,
                'balance_after' => $bBAfter,
                'locked_before' => $buyerBase->locked_balance,
                'locked_after' => $buyerBase->locked_balance,
                'description' => "Buyer trade match: Terima {$quantity} base (Fee: {$buyerFee})",
                'metadata' => ['trade_id' => $tradeId],
            ]);

            // ------------------------------------------------------------------
            // 3. SELLER: Potong base locked (BTC)
            // ------------------------------------------------------------------
            $sellerBase = $wallets['seller_base'];
            if (bccomp($sellerBase->locked_balance, $quantity, self::SCALE) < 0) {
                throw new InvalidFinancialStateException("Seller locked base balance tidak mencukupi.");
            }
            $sBBefore = $sellerBase->balance;
            $sBLockedBefore = $sellerBase->locked_balance;
            $sBLockedAfter = bcsub($sBLockedBefore, $quantity, self::SCALE);
            $sellerBase->locked_balance = $sBLockedAfter;
            $sellerBase->save();

            $entries['seller_base_debit'] = LedgerEntry::create([
                'uuid' => (string) Str::uuid(),
                'reference_id' => $tradeId,
                'reference_type' => 'TRADE_EXECUTION',
                'wallet_id' => $sellerBase->id,
                'user_id' => $sellerUserId,
                'currency_id' => $pair->base_currency_id,
                'entry_type' => 'DEBIT',
                'amount' => $quantity,
                'fee' => '0.000000000000000000',
                'balance_before' => $sBBefore,
                'balance_after' => $sBBefore,
                'locked_before' => $sBLockedBefore,
                'locked_after' => $sBLockedAfter,
                'description' => "Seller trade match: Potong {$quantity} base locked",
                'metadata' => ['trade_id' => $tradeId],
            ]);

            // ------------------------------------------------------------------
            // 4. SELLER: Terima quote currency (USDT) dikurangi seller fee
            // ------------------------------------------------------------------
            $sellerQuote = $wallets['seller_quote'];
            $sQBefore = $sellerQuote->balance;
            $netQuoteToSeller = bcsub($quoteTotal, $sellerFee, self::SCALE);
            $sQAfter = bcadd($sQBefore, $netQuoteToSeller, self::SCALE);
            $sellerQuote->balance = $sQAfter;
            $sellerQuote->save();

            $entries['seller_quote_credit'] = LedgerEntry::create([
                'uuid' => (string) Str::uuid(),
                'reference_id' => $tradeId,
                'reference_type' => 'TRADE_EXECUTION',
                'wallet_id' => $sellerQuote->id,
                'user_id' => $sellerUserId,
                'currency_id' => $pair->quote_currency_id,
                'entry_type' => 'CREDIT',
                'amount' => $quoteTotal,
                'fee' => $sellerFee,
                'balance_before' => $sQBefore,
                'balance_after' => $sQAfter,
                'locked_before' => $sellerQuote->locked_balance,
                'locked_after' => $sellerQuote->locked_balance,
                'description' => "Seller trade match: Terima {$quoteTotal} quote (Fee: {$sellerFee})",
                'metadata' => ['trade_id' => $tradeId],
            ]);

            return $entries;
        });
    }

    /**
     * Resolve mata uang dari ID, kode string (BTC, USDT), atau model Currency.
     */
    protected function resolveCurrency(int|string|Currency $currency): Currency
    {
        if ($currency instanceof Currency) {
            return $currency;
        }

        if (is_numeric($currency)) {
            return Currency::findOrFail((int) $currency);
        }

        return Currency::where('code', strtoupper($currency))->firstOrFail();
    }
}
