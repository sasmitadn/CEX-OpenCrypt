<?php

namespace Tests\Feature;

use App\Models\Currency;
use App\Models\Order;
use App\Models\TradingPair;
use App\Models\User;
use App\Models\Wallet;
use App\Services\BalanceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

class OrderConcurrencyTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;
    protected Currency $btc;
    protected Currency $usdt;
    protected TradingPair $btcUsdt;
    protected BalanceService $balanceService;

    protected function setUp(): void
    {
        parent::setUp();

        $this->balanceService = app(BalanceService::class);

        // Mock Redis agar test tidak bergantung pada server Redis fisik
        Redis::shouldReceive('xadd')->andReturn('1700000000000-0');
        Redis::shouldReceive('publish')->andReturn(1);

        $this->user = User::factory()->create(['status' => 'ACTIVE']);

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
            'min_order_notional' => '10.000000000000000000',
            'status' => 'TRADING',
        ]);
    }

    /**
     * Skenario Kritis:
     * User hanya memiliki saldo 50,000 USDT (cukup untuk 1 order beli 1 BTC @ 50,000 USDT).
     * Jalankan 2 request berturut-turut/bersamaan:
     * - Request 1 wajib BERHASIL (201 Created).
     * - Request 2 wajib GAGAL (422 Insufficient Balance).
     * - Saldo tidak pernah minus.
     */
    public function test_two_orders_when_balance_only_sufficient_for_one(): void
    {
        // 1. Berikan saldo 50,000 USDT ke user
        $this->balanceService->depositCredit(
            userId: $this->user->id,
            currency: $this->usdt,
            amount: '50000.000000000000000000',
            txHash: 'INIT_USDT'
        );

        $orderPayload = [
            'symbol' => 'BTC_USDT',
            'side' => 'BUY',
            'type' => 'LIMIT',
            'price' => '50000.00',
            'quantity' => '1.0',
        ];

        // 2. Request Pertama (Harus Sukses 201)
        $response1 = $this->actingAs($this->user)->postJson('/api/v1/orders', $orderPayload);
        $response1->assertStatus(201);
        $response1->assertJsonPath('success', true);
        $response1->assertJsonPath('data.status', 'OPEN');
        $response1->assertJsonPath('data.locked_amount', '50000.000000000000000000');

        // 3. Request Kedua (Harus Gagal 422 Insufficient Balance)
        $response2 = $this->actingAs($this->user)->postJson('/api/v1/orders', $orderPayload);
        $response2->assertStatus(422);
        $response2->assertJsonPath('success', false);
        $response2->assertJsonPath('message', 'Insufficient Balance');

        // 4. Verifikasi Integritas Database: Saldo Tidak Pernah Minus!
        $wallet = Wallet::where('user_id', $this->user->id)
            ->where('currency_id', $this->usdt->id)
            ->first();

        // Available balance harus tepat 0, TIDAK BOLEH -50,000
        $this->assertTrue(bccomp($wallet->balance, '0', 18) === 0);
        // Locked balance harus tepat 50,000
        $this->assertTrue(bccomp($wallet->locked_balance, '50000', 18) === 0);

        // Hanya 1 order yang tercatat di database
        $this->assertEquals(1, Order::where('user_id', $this->user->id)->count());
        $this->assertEquals('OPEN', Order::where('user_id', $this->user->id)->first()->status);
    }

    /**
     * Skenario SELL Order:
     * User memiliki 0.5 BTC.
     * Order 1 (Jual 0.5 BTC) -> Berhasil (201).
     * Order 2 (Jual 0.1 BTC) -> Gagal (422 Insufficient Balance).
     */
    public function test_sell_order_locking_and_insufficient_balance(): void
    {
        // Berikan saldo 0.5 BTC ke user
        $this->balanceService->depositCredit(
            userId: $this->user->id,
            currency: $this->btc,
            amount: '0.500000000000000000',
            txHash: 'INIT_BTC'
        );

        $orderPayload = [
            'symbol' => 'BTC_USDT',
            'side' => 'SELL',
            'type' => 'LIMIT',
            'price' => '65000.00',
            'quantity' => '0.500000',
        ];

        // Request 1: Sukses
        $res1 = $this->actingAs($this->user)->postJson('/api/v1/orders', $orderPayload);
        $res1->assertStatus(201);

        // Request 2: Gagal karena sisa saldo aktif 0 BTC
        $orderPayload2 = [
            'symbol' => 'BTC_USDT',
            'side' => 'SELL',
            'type' => 'LIMIT',
            'price' => '65000.00',
            'quantity' => '0.100000',
        ];
        $res2 = $this->actingAs($this->user)->postJson('/api/v1/orders', $orderPayload2);
        $res2->assertStatus(422);

        $btcWallet = Wallet::where('user_id', $this->user->id)
            ->where('currency_id', $this->btc->id)
            ->first();

        $this->assertTrue(bccomp($btcWallet->balance, '0', 18) === 0);
        $this->assertTrue(bccomp($btcWallet->locked_balance, '0.5', 18) === 0);
    }
}
