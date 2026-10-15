<?php

namespace App\Services;

use App\Exceptions\InvalidFinancialStateException;
use App\Models\Currency;
use App\Models\Deposit;
use App\Models\DepositAddress;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class DepositService
{
    public function __construct(
        protected WalletService $walletService
    ) {}

    /**
     * Catat atau update deposit dari blockchain worker scanner.
     */
    public function processDetectedDeposit(
        string $network,
        string $txHash,
        string $toAddress,
        string $amount,
        int $confirmations,
        ?string $fromAddress = null,
        ?int $blockNumber = null
    ): Deposit {
        return DB::transaction(function () use (
            $network,
            $txHash,
            $toAddress,
            $amount,
            $confirmations,
            $fromAddress,
            $blockNumber
        ) {
            // 1. Verifikasi deposit address terdaftar pada user
            $depositAddress = DepositAddress::where('network', $network)
                ->where('address', $toAddress)
                ->where('status', 'ACTIVE')
                ->first();

            if (!$depositAddress) {
                throw new InvalidFinancialStateException("Alamat deposit {$toAddress} di network {$network} tidak terdaftar pada sistem.");
            }

            $currency = Currency::findOrFail($depositAddress->currency_id);
            if (!$currency->is_deposit_enabled) {
                throw new InvalidFinancialStateException("Deposit untuk mata uang {$currency->code} saat ini dinonaktifkan.");
            }

            // 2. Ambil atau buat record Deposit
            $deposit = Deposit::where('network', $network)
                ->where('tx_hash', $txHash)
                ->where('to_address', $toAddress)
                ->lockForUpdate()
                ->first();

            if ($deposit && $deposit->status === 'COMPLETED') {
                // Idempotent: jika sudah selesai dikreditkan sebelumnya, jangan lakukan apapun
                return $deposit;
            }

            if (!$deposit) {
                // Ambil atau inisialisasi wallet
                $wallet = $this->walletService->lockAndGetWallet($depositAddress->user_id, $currency->id, 'SPOT');

                $requiredConfirmations = match ($network) {
                    'BTC' => 2,
                    'ETH' => 12,
                    'BSC' => 15,
                    'TRC20' => 19,
                    default => 12,
                };

                $deposit = Deposit::create([
                    'uuid' => (string) Str::uuid(),
                    'user_id' => $depositAddress->user_id,
                    'currency_id' => $currency->id,
                    'wallet_id' => $wallet->id,
                    'network' => $network,
                    'tx_hash' => $txHash,
                    'to_address' => $toAddress,
                    'from_address' => $fromAddress,
                    'amount' => $amount,
                    'fee' => '0.000000000000000000',
                    'confirmations' => $confirmations,
                    'required_confirmations' => $requiredConfirmations,
                    'block_number' => $blockNumber,
                    'status' => 'DETECTED',
                ]);
            } else {
                $deposit->confirmations = $confirmations;
                if ($blockNumber) {
                    $deposit->block_number = $blockNumber;
                }
            }

            // 3. Evaluasi State Machine & Konfirmasi
            if ($deposit->confirmations >= $deposit->required_confirmations && $deposit->status !== 'COMPLETED') {
                $wallet = $this->walletService->lockAndGetWallet($deposit->user_id, $deposit->currency_id, 'SPOT');

                // Kredit saldo ke wallet secara atomik
                $this->walletService->creditBalance(
                    wallet: $wallet,
                    amount: $deposit->amount,
                    referenceId: (string) $deposit->id,
                    referenceType: 'DEPOSIT',
                    description: "Deposit {$deposit->amount} {$currency->code} (TX: {$deposit->tx_hash})",
                    metadata: [
                        'network' => $network,
                        'tx_hash' => $txHash,
                        'from_address' => $fromAddress,
                        'block_number' => $blockNumber,
                    ]
                );

                $deposit->status = 'COMPLETED';
                $deposit->credited_at = now();
            } elseif ($deposit->status === 'DETECTED' && $deposit->confirmations > 0) {
                $deposit->status = 'CONFIRMING';
            }

            $deposit->save();

            return $deposit;
        });
    }
}
