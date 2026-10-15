<?php

namespace Tests\Feature;

use App\Exceptions\InsufficientBalanceException;
use App\Models\Currency;
use App\Models\DepositAddress;
use App\Models\TradingPair;
use App\Models\User;
use App\Services\DepositService;
use App\Services\OrderService;
use App\Services\WalletService;
use App\Services\WithdrawalService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class CexFinancialLedgerTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;
    protected Currency $btc;
    protected Currency $usdt;
    protected TradingPair $btcUsdt;
    protected WalletService $walletService;
    protected DepositService $depositService;
    protected WithdrawalService $withdrawalService;
    protected OrderService $orderService;

    protected function setUp(): void
    {
        parent::setUp();

        $this->walletService = app(WalletService::class);
        $this->depositService = app(DepositService::class);
        $this->withdrawalService = app(WithdrawalService::class);
        $this->orderService = app(OrderService::class);

        $this->user = User::factory()->create([
            'status' => 'ACTIVE',
        ]);

        $this->btc = Currency::create([
            'code' => 'BTC',
            'name' => 'Bitcoin',
            'type' => 'CRYPTO',
            'decimals' => 8,
            'min_deposit' => '0.000100000000000000',
            'min_withdraw' => '0.000500000000000000',
            'withdraw_fee' => '0.000200000000000000',
            'is_deposit_enabled' => true,
            'is_withdraw_enabled' => true,
            'is_trading_enabled' => true,
        ]);

        $this->usdt = Currency::create([
            'code' => 'USDT',
            'name' => 'Tether USD',
            'type' => 'CRYPTO',
            'decimals' => 6,
            'min_deposit' => '1.000000000000000000',
            'min_withdraw' => '10.000000000000000000',
            'withdraw_fee' => '1.000000000000000000',
            'is_deposit_enabled' => true,
            'is_withdraw_enabled' => true,
            'is_trading_enabled' => true,
        ]);

        $this->btcUsdt = TradingPair::create([
            'symbol' => 'BTC_USDT',
            'base_currency_id' => $this->btc->id,
            'quote_currency_id' => $this->usdt->id,
            'price_precision' => 2,
            'quantity_precision' => 6,
            'min_order_quantity' => '0.000100000000000000',
            'min_order_notional' => '1.000000000000000000',
            'status' => 'TRADING',
        ]);
    }

    public function test_wallet_deposit_state_machine_and_ledger(): void
    {
        // 1. Assign deposit address
        DepositAddress::create([
            'user_id' => $this->user->id,
            'currency_id' => $this->btc->id,
            'network' => 'BTC',
            'address' => 'bc1qtestaddress1234567890',
            'status' => 'ACTIVE',
        ]);

        // 2. Transaksi terdeteksi (confirmations = 0) -> status DETECTED, saldo belum masuk
        $deposit = $this->depositService->processDetectedDeposit(
            network: 'BTC',
            txHash: '0xabc1234567890',
            toAddress: 'bc1qtestaddress1234567890',
            amount: '1.500000000000000000',
            confirmations: 0
        );

        $this->assertEquals('DETECTED', $deposit->status);

        $wallet = DB::transaction(fn() => $this->walletService->lockAndGetWallet($this->user->id, $this->btc->id));
        $this->assertTrue(bccomp($wallet->balance, '0', 18) === 0);

        // 3. Konfirmasi bertambah menjadi 2 (required = 2 untuk BTC) -> status COMPLETED & saldo bertambah
        $depositCompleted = $this->depositService->processDetectedDeposit(
            network: 'BTC',
            txHash: '0xabc1234567890',
            toAddress: 'bc1qtestaddress1234567890',
            amount: '1.500000000000000000',
            confirmations: 2
        );

        $this->assertEquals('COMPLETED', $depositCompleted->status);

        $wallet->refresh();
        $this->assertTrue(bccomp($wallet->balance, '1.5', 18) === 0);

        // 4. Verifikasi audit trail di ledger_entries
        $this->assertDatabaseHas('ledger_entries', [
            'wallet_id' => $wallet->id,
            'entry_type' => 'CREDIT',
        ]);
    }

    public function test_withdrawal_locks_balance_and_prevents_double_spending(): void
    {
        // Berikan saldo awal 100 USDT
        DB::transaction(function () {
            $wallet = $this->walletService->lockAndGetWallet($this->user->id, $this->usdt->id);
            $this->walletService->creditBalance($wallet, '100.000000000000000000', 'INIT', 'SYSTEM_TRANSFER', 'Initial fund');
        });

        // Request withdraw 50 USDT (fee 1 USDT -> total dikunci 51 USDT)
        $withdrawal = $this->withdrawalService->requestWithdrawal(
            user: $this->user,
            currencyId: $this->usdt->id,
            network: 'TRC20',
            toAddress: 'TTestAddressWithdrawal123',
            amount: '50.000000000000000000'
        );

        $wallet = DB::transaction(fn() => $this->walletService->lockAndGetWallet($this->user->id, $this->usdt->id));

        // Available balance harus berkurang dari 100 menjadi 49
        $this->assertTrue(bccomp($wallet->balance, '49', 18) === 0);
        // Locked balance harus 51
        $this->assertTrue(bccomp($wallet->locked_balance, '51', 18) === 0);

        // Coba withdraw lagi sebesar 60 USDT -> harus ditolak karena sisa saldo aktif hanya 49
        $this->expectException(InsufficientBalanceException::class);
        $this->withdrawalService->requestWithdrawal(
            user: $this->user,
            currencyId: $this->usdt->id,
            network: 'TRC20',
            toAddress: 'TTestAddressWithdrawal123',
            amount: '60.000000000000000000'
        );
    }

    public function test_order_placement_locks_funds_and_cancel_unlocks(): void
    {
        // Berikan saldo 50,000 USDT untuk user
        DB::transaction(function () {
            $wallet = $this->walletService->lockAndGetWallet($this->user->id, $this->usdt->id);
            $this->walletService->creditBalance($wallet, '50000.000000000000000000', 'INIT', 'SYSTEM_TRANSFER', 'Initial fund');
        });

        // Pasang LIMIT BUY order: Beli 0.5 BTC di harga 60,000 USDT (Total notional = 30,000 USDT dikunci)
        $order = $this->orderService->placeOrder(
            user: $this->user,
            tradingPairId: $this->btcUsdt->id,
            side: 'BUY',
            type: 'LIMIT',
            quantity: '0.500000000000000000',
            price: '60000.000000000000000000'
        );

        $wallet = DB::transaction(fn() => $this->walletService->lockAndGetWallet($this->user->id, $this->usdt->id));
        $this->assertTrue(bccomp($wallet->balance, '20000', 18) === 0);
        $this->assertTrue(bccomp($wallet->locked_balance, '30000', 18) === 0);

        // Batalkan order -> 30,000 USDT harus di-unlock kembali ke available balance
        $this->orderService->cancelOrder($order);

        $wallet->refresh();
        $this->assertTrue(bccomp($wallet->balance, '50000', 18) === 0);
        $this->assertTrue(bccomp($wallet->locked_balance, '0', 18) === 0);
    }

    public function test_double_entry_transfer_between_wallets(): void
    {
        $user2 = User::factory()->create(['status' => 'ACTIVE']);

        DB::transaction(function () use ($user2) {
            $senderWallet = $this->walletService->lockAndGetWallet($this->user->id, $this->usdt->id);
            $receiverWallet = $this->walletService->lockAndGetWallet($user2->id, $this->usdt->id);

            // Beri saldo awal 500 USDT ke pengirim
            $this->walletService->creditBalance($senderWallet, '500.000000000000000000', 'INIT', 'SYSTEM_TRANSFER', 'Initial fund');

            // Transfer 200 USDT secara atomic double-entry
            $result = $this->walletService->transferDoubleEntry(
                fromWallet: $senderWallet,
                toWallet: $receiverWallet,
                amount: '200.000000000000000000',
                referenceId: 'TRANSFER_123',
                referenceType: 'TRANSFER',
                description: 'Internal transfer'
            );

            $this->assertEquals('DEBIT', $result['debit_entry']->entry_type);
            $this->assertEquals('CREDIT', $result['credit_entry']->entry_type);
        });

        $senderWallet = DB::transaction(fn() => $this->walletService->lockAndGetWallet($this->user->id, $this->usdt->id));
        $receiverWallet = DB::transaction(fn() => $this->walletService->lockAndGetWallet($user2->id, $this->usdt->id));

        $this->assertTrue(bccomp($senderWallet->balance, '300', 18) === 0);
        $this->assertTrue(bccomp($receiverWallet->balance, '200', 18) === 0);
    }

    public function test_withdrawal_rejection_restores_locked_balance(): void
    {
        DB::transaction(function () {
            $wallet = $this->walletService->lockAndGetWallet($this->user->id, $this->usdt->id);
            $this->walletService->creditBalance($wallet, '100.000000000000000000', 'INIT', 'SYSTEM_TRANSFER', 'Initial fund');
        });

        $withdrawal = $this->withdrawalService->requestWithdrawal(
            user: $this->user,
            currencyId: $this->usdt->id,
            network: 'TRC20',
            toAddress: 'TTestAddressWithdrawal123',
            amount: '50.000000000000000000'
        );

        // Reject withdrawal
        $this->withdrawalService->rejectWithdrawal($withdrawal, 'Alamat tujuan mencurigakan');

        $wallet = DB::transaction(fn() => $this->walletService->lockAndGetWallet($this->user->id, $this->usdt->id));
        $this->assertTrue(bccomp($wallet->balance, '100', 18) === 0);
        $this->assertTrue(bccomp($wallet->locked_balance, '0', 18) === 0);
        $this->assertEquals('REJECTED', $withdrawal->fresh()->status);
    }
}
