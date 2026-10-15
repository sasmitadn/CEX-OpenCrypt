<?php

namespace Tests\Feature;

use App\Models\Currency;
use App\Models\Order;
use App\Models\Trade;
use App\Models\TradingPair;
use App\Models\User;
use App\Models\Wallet;
use App\Services\BalanceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;
use Tests\TestCase;

class SettlementWorkerTest extends TestCase
{
    use RefreshDatabase;

    protected User $buyer;
    protected User $seller;
    protected Currency $btc;
    protected Currency $usdt;
    protected TradingPair $btcUsdt;
    protected BalanceService $balanceService;

    protected function setUp(): void
    {
        parent::setUp();

        $this->balanceService = app(BalanceService::class);

        $this->buyer = User::factory()->create(['status' => 'ACTIVE']);
        $this->seller = User::factory()->create(['status' => 'ACTIVE']);

        $this->btc = Currency::create([
            'code' => 'BTC',
            'name' => 'Bitcoin',
            'type' => 'CRYPTO',
            'decimals' => 8,
            'is_deposit_enabled' => true,
            'is_withdraw_enabled' => true,
            'is_trading_enabled' => true,
        ]);

        $this->usdt = Currency::create([
            'code' => 'USDT',
            'name' => 'Tether USD',
            'type' => 'CRYPTO',
            'decimals' => 6,
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
            'maker_fee_rate' => '0.001000', // 0.1%
            'taker_fee_rate' => '0.002000', // 0.2%
            'status' => 'TRADING',
        ]);
    }

    public function test_artisan_settle_trades_command_executes_settlement(): void
    {
        // 1. Setup Saldo & Lock untuk Maker (Seller: jual 1 BTC)
        $this->balanceService->depositCredit($this->seller->id, $this->btc, '1.000000000000000000', 'INIT_SELLER');
        $makerUuid = (string) Str::uuid();
        $this->balanceService->lockBalanceForOrder($this->seller->id, $this->btc, '1.000000000000000000', $makerUuid);

        $makerOrder = Order::create([
            'uuid' => $makerUuid,
            'user_id' => $this->seller->id,
            'trading_pair_id' => $this->btcUsdt->id,
            'side' => 'SELL',
            'type' => 'LIMIT',
            'price' => '60000.000000000000000000',
            'quantity' => '1.000000000000000000',
            'filled_quantity' => '0.000000000000000000',
            'filled_quote_amount' => '0.000000000000000000',
            'locked_amount' => '1.000000000000000000',
            'locked_currency_id' => $this->btc->id,
            'status' => 'OPEN',
        ]);

        // 2. Setup Saldo & Lock untuk Taker (Buyer: beli 1 BTC @ 60,000 USDT)
        $this->balanceService->depositCredit($this->buyer->id, $this->usdt, '60000.000000000000000000', 'INIT_BUYER');
        $takerUuid = (string) Str::uuid();
        $this->balanceService->lockBalanceForOrder($this->buyer->id, $this->usdt, '60000.000000000000000000', $takerUuid);

        $takerOrder = Order::create([
            'uuid' => $takerUuid,
            'user_id' => $this->buyer->id,
            'trading_pair_id' => $this->btcUsdt->id,
            'side' => 'BUY',
            'type' => 'LIMIT',
            'price' => '60000.000000000000000000',
            'quantity' => '1.000000000000000000',
            'filled_quantity' => '0.000000000000000000',
            'filled_quote_amount' => '0.000000000000000000',
            'locked_amount' => '60000.000000000000000000',
            'locked_currency_id' => $this->usdt->id,
            'status' => 'PENDING',
        ]);

        // 3. Mock trade payload dari Matching Engine
        $tradePayload = [
            'event' => 'trade_matched',
            'trade_id' => 'TRD-TEST-12345',
            'symbol' => 'BTC_USDT',
            'maker_order_id' => $makerUuid,
            'taker_order_id' => $takerUuid,
            'maker_user_id' => $this->seller->id,
            'taker_user_id' => $this->buyer->id,
            'price' => '60000.000000000000000000',
            'quantity' => '1.000000000000000000',
            'quote_amount' => '60000.000000000000000000',
            'maker_side' => 'SELL',
            'timestamp' => now()->getTimestampMs(),
        ];

        Redis::shouldReceive('rpop')
            ->once()
            ->with('trades_queue')
            ->andReturn(json_encode($tradePayload));

        // 4. Jalankan Artisan Worker sekali (once)
        $exitCode = Artisan::call('cex:settle-trades', [
            '--queue' => 'trades_queue',
            '--once' => true,
        ]);

        $this->assertEquals(0, $exitCode);

        // 5. Verifikasi Saldo Buyer:
        // Quote (USDT): locked balance berkurang 60,000 -> 0
        $buyerUsdt = Wallet::where('user_id', $this->buyer->id)->where('currency_id', $this->usdt->id)->first();
        $this->assertTrue(bccomp($buyerUsdt->locked_balance, '0', 18) === 0);

        // Base (BTC): bertambah 0.998 BTC (1 BTC - 0.2% taker fee 0.002)
        $buyerBtc = Wallet::where('user_id', $this->buyer->id)->where('currency_id', $this->btc->id)->first();
        $this->assertTrue(bccomp($buyerBtc->balance, '0.998', 18) === 0);

        // 6. Verifikasi Saldo Seller:
        // Base (BTC): locked balance berkurang 1 BTC -> 0
        $sellerBtc = Wallet::where('user_id', $this->seller->id)->where('currency_id', $this->btc->id)->first();
        $this->assertTrue(bccomp($sellerBtc->locked_balance, '0', 18) === 0);

        // Quote (USDT): bertambah 59,940 USDT (60,000 - 0.1% maker fee 60)
        $sellerUsdt = Wallet::where('user_id', $this->seller->id)->where('currency_id', $this->usdt->id)->first();
        $this->assertTrue(bccomp($sellerUsdt->balance, '59940', 18) === 0);

        // 7. Verifikasi Order Status menjadi FILLED
        $this->assertEquals('FILLED', $makerOrder->fresh()->status);
        $this->assertEquals('FILLED', $takerOrder->fresh()->status);

        // 8. Verifikasi Record Trade tercatat permanen
        $this->assertDatabaseHas('trades', [
            'uuid' => 'TRD-TEST-12345',
            'maker_order_id' => $makerOrder->id,
            'taker_order_id' => $takerOrder->id,
            'price' => '60000.000000000000000000',
            'quantity' => '1.000000000000000000',
        ]);

        // 9. Verifikasi 4 entri mutasi buku besar tercatat di ledger_entries
        $this->assertEquals(4, \App\Models\LedgerEntry::where('reference_id', 'TRD-TEST-12345')->count());
    }
}
