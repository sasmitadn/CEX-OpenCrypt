<?php

namespace Tests\Feature;

use App\Exceptions\InsufficientBalanceException;
use App\Models\Currency;
use App\Models\TradingPair;
use App\Models\User;
use App\Models\Wallet;
use App\Services\BalanceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class BalanceServiceTest extends TestCase
{
    use RefreshDatabase;

    protected BalanceService $balanceService;
    protected User $user;
    protected Currency $btc;
    protected Currency $usdt;
    protected TradingPair $btcUsdt;

    protected function setUp(): void
    {
        parent::setUp();

        $this->balanceService = app(BalanceService::class);

        $this->user = User::factory()->create(['status' => 'ACTIVE']);

        $this->btc = Currency::create([
            'code' => 'BTC',
            'name' => 'Bitcoin',
            'type' => 'CRYPTO',
            'decimals' => 8,
            'min_deposit' => '0.0001',
            'min_withdraw' => '0.0005',
            'withdraw_fee' => '0.0002',
            'is_deposit_enabled' => true,
            'is_withdraw_enabled' => true,
            'is_trading_enabled' => true,
        ]);

        $this->usdt = Currency::create([
            'code' => 'USDT',
            'name' => 'Tether USD',
            'type' => 'CRYPTO',
            'decimals' => 6,
            'min_deposit' => '1.0',
            'min_withdraw' => '10.0',
            'withdraw_fee' => '1.0',
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
            'min_order_quantity' => '0.0001',
            'min_order_notional' => '1.0',
            'status' => 'TRADING',
        ]);
    }

    public function test_deposit_credit_increases_balance_and_records_ledger(): void
    {
        $txHash = '0x123abc456def';
        $entry = $this->balanceService->depositCredit(
            userId: $this->user->id,
            currency: $this->usdt,
            amount: '500.000000000000000000',
            txHash: $txHash,
            network: 'TRC20'
        );

        $wallet = Wallet::where('user_id', $this->user->id)
            ->where('currency_id', $this->usdt->id)
            ->first();

        $this->assertNotNull($wallet);
        $this->assertTrue(bccomp($wallet->balance, '500', 18) === 0);
        $this->assertTrue(bccomp($wallet->locked_balance, '0', 18) === 0);

        // Verifikasi entri ledger
        $this->assertEquals('CREDIT', $entry->entry_type);
        $this->assertEquals('DEPOSIT', $entry->reference_type);
        $this->assertTrue(bccomp($entry->amount, '500', 18) === 0);
        $this->assertTrue(bccomp($entry->balance_before, '0', 18) === 0);
        $this->assertTrue(bccomp($entry->balance_after, '500', 18) === 0);
    }

    public function test_lock_balance_for_order_and_prevents_overdraft(): void
    {
        // 1. Berikan saldo awal 100 USDT
        $this->balanceService->depositCredit($this->user->id, $this->usdt, '100.000000000000000000', 'TX_INIT');

        // 2. Kunci 40 USDT untuk Order A
        $orderIdA = 'ORD-001';
        $entry = $this->balanceService->lockBalanceForOrder($this->user->id, $this->usdt, '40.000000000000000000', $orderIdA);

        $wallet = Wallet::where('user_id', $this->user->id)->where('currency_id', $this->usdt->id)->first();
        $this->assertTrue(bccomp($wallet->balance, '60', 18) === 0);
        $this->assertTrue(bccomp($wallet->locked_balance, '40', 18) === 0);
        $this->assertEquals('DEBIT', $entry->entry_type);
        $this->assertEquals('ORDER_LOCK', $entry->reference_type);

        // 3. Coba kunci 70 USDT (melebihi saldo sisa 60) -> wajib throw InsufficientBalanceException
        $this->expectException(InsufficientBalanceException::class);
        $this->balanceService->lockBalanceForOrder($this->user->id, $this->usdt, '70.000000000000000000', 'ORD-002');
    }

    public function test_settle_trade_atomic_double_entry(): void
    {
        $seller = User::factory()->create(['status' => 'ACTIVE']);

        // Buyer punya 65,000 USDT (dikunci untuk beli 1 BTC @ 65,000)
        $this->balanceService->depositCredit($this->user->id, $this->usdt, '65000.000000000000000000', 'TX_BUYER');
        $this->balanceService->lockBalanceForOrder($this->user->id, $this->usdt, '65000.000000000000000000', 'BUY_ORD_1');

        // Seller punya 1 BTC (dikunci untuk jual 1 BTC)
        $this->balanceService->depositCredit($seller->id, $this->btc, '1.000000000000000000', 'TX_SELLER');
        $this->balanceService->lockBalanceForOrder($seller->id, $this->btc, '1.000000000000000000', 'SELL_ORD_1');

        // Eksekusi settleTrade: 1 BTC @ 65,000 USDT (Buyer fee 0.001 BTC, Seller fee 65 USDT)
        $tradeResult = $this->balanceService->settleTrade(
            buyerUserId: $this->user->id,
            sellerUserId: $seller->id,
            pair: $this->btcUsdt,
            price: '65000.000000000000000000',
            quantity: '1.000000000000000000',
            buyerFee: '0.001000000000000000',
            sellerFee: '65.000000000000000000'
        );

        $this->assertCount(4, $tradeResult);

        // Cek Wallet Buyer:
        // Quote (USDT): locked balance menjadi 0
        $buyerUsdt = Wallet::where('user_id', $this->user->id)->where('currency_id', $this->usdt->id)->first();
        $this->assertTrue(bccomp($buyerUsdt->locked_balance, '0', 18) === 0);

        // Base (BTC): bertambah 0.999 (1 - fee 0.001)
        $buyerBtc = Wallet::where('user_id', $this->user->id)->where('currency_id', $this->btc->id)->first();
        $this->assertTrue(bccomp($buyerBtc->balance, '0.999', 18) === 0);

        // Cek Wallet Seller:
        // Base (BTC): locked balance menjadi 0
        $sellerBtc = Wallet::where('user_id', $seller->id)->where('currency_id', $this->btc->id)->first();
        $this->assertTrue(bccomp($sellerBtc->locked_balance, '0', 18) === 0);

        // Quote (USDT): bertambah 64,935 (65,000 - fee 65)
        $sellerUsdt = Wallet::where('user_id', $seller->id)->where('currency_id', $this->usdt->id)->first();
        $this->assertTrue(bccomp($sellerUsdt->balance, '64935', 18) === 0);
    }
}
