<?php

namespace Database\Seeders;

use App\Models\Currency;
use App\Models\Order;
use App\Models\TradingPair;
use App\Models\User;
use App\Models\Wallet;
use App\Services\BalanceService;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database with default CEX currencies, pairs, and demo account.
     */
    public function run(): void
    {
        // 1. Currencies
        $btc = Currency::firstOrCreate(
            ['code' => 'BTC'],
            [
                'name' => 'Bitcoin',
                'type' => 'CRYPTO',
                'decimals' => 8,
                'min_deposit' => '0.000100000000000000',
                'min_withdraw' => '0.000500000000000000',
                'withdraw_fee' => '0.000200000000000000',
                'is_deposit_enabled' => true,
                'is_withdraw_enabled' => true,
                'is_trading_enabled' => true,
                'status' => 'ACTIVE',
            ]
        );

        $eth = Currency::firstOrCreate(
            ['code' => 'ETH'],
            [
                'name' => 'Ethereum',
                'type' => 'CRYPTO',
                'decimals' => 18,
                'min_deposit' => '0.005000000000000000',
                'min_withdraw' => '0.010000000000000000',
                'withdraw_fee' => '0.002000000000000000',
                'is_deposit_enabled' => true,
                'is_withdraw_enabled' => true,
                'is_trading_enabled' => true,
                'status' => 'ACTIVE',
            ]
        );

        $usdt = Currency::firstOrCreate(
            ['code' => 'USDT'],
            [
                'name' => 'Tether USD',
                'type' => 'CRYPTO',
                'decimals' => 6,
                'min_deposit' => '1.000000000000000000',
                'min_withdraw' => '10.000000000000000000',
                'withdraw_fee' => '1.000000000000000000',
                'is_deposit_enabled' => true,
                'is_withdraw_enabled' => true,
                'is_trading_enabled' => true,
                'status' => 'ACTIVE',
            ]
        );

        // 2. Trading Pairs
        TradingPair::firstOrCreate(
            ['symbol' => 'BTC_USDT'],
            [
                'base_currency_id' => $btc->id,
                'quote_currency_id' => $usdt->id,
                'price_precision' => 2,
                'quantity_precision' => 6,
                'min_order_quantity' => '0.000100000000000000',
                'min_order_notional' => '10.000000000000000000',
                'maker_fee_rate' => '0.001000',
                'taker_fee_rate' => '0.002000',
                'status' => 'TRADING',
            ]
        );

        TradingPair::firstOrCreate(
            ['symbol' => 'ETH_USDT'],
            [
                'base_currency_id' => $eth->id,
                'quote_currency_id' => $usdt->id,
                'price_precision' => 2,
                'quantity_precision' => 4,
                'min_order_quantity' => '0.001000000000000000',
                'min_order_notional' => '10.000000000000000000',
                'maker_fee_rate' => '0.001000',
                'taker_fee_rate' => '0.002000',
                'status' => 'TRADING',
            ]
        );

        // 3. Demo User
        $user = User::firstOrCreate(
            ['email' => 'trader@cex.com'],
            [
                'name' => 'Pro Trader',
                'password' => Hash::make('password123'),
                'status' => 'ACTIVE',
                'kyc_level' => 2,
            ]
        );

        // 4. Inisialisasi Saldo Awal Demo untuk Trader
        $balanceService = app(BalanceService::class);

        $btcWallet = Wallet::firstOrCreate(
            ['user_id' => $user->id, 'currency_id' => $btc->id, 'type' => 'SPOT'],
            ['uuid' => (string) Str::uuid(), 'balance' => '0', 'locked_balance' => '0', 'status' => 'ACTIVE']
        );
        if (bccomp($btcWallet->balance, '0', 18) === 0) {
            $balanceService->depositCredit($user->id, $btc, '2.500000000000000000', 'INIT_BTC_SEED');
        }

        $ethWallet = Wallet::firstOrCreate(
            ['user_id' => $user->id, 'currency_id' => $eth->id, 'type' => 'SPOT'],
            ['uuid' => (string) Str::uuid(), 'balance' => '0', 'locked_balance' => '0', 'status' => 'ACTIVE']
        );
        if (bccomp($ethWallet->balance, '0', 18) === 0) {
            $balanceService->depositCredit($user->id, $eth, '25.000000000000000000', 'INIT_ETH_SEED');
        }

        $usdtWallet = Wallet::firstOrCreate(
            ['user_id' => $user->id, 'currency_id' => $usdt->id, 'type' => 'SPOT'],
            ['uuid' => (string) Str::uuid(), 'balance' => '0', 'locked_balance' => '0', 'status' => 'ACTIVE']
        );
        if (bccomp($usdtWallet->balance, '0', 18) === 0) {
            $balanceService->depositCredit($user->id, $usdt, '100000.000000000000000000', 'INIT_USDT_SEED');
        }

        // 5. Seed Starter Liquidity Orders (Market Maker)
        $mmUser = User::firstOrCreate(
            ['email' => 'mm@cex.com'],
            [
                'name' => 'CEX Liquidity Provider',
                'password' => Hash::make('secretmm123'),
                'status' => 'ACTIVE',
                'kyc_level' => 3,
            ]
        );

        $btcPair = TradingPair::where('symbol', 'BTC_USDT')->first();
        if ($btcPair && Order::where('trading_pair_id', $btcPair->id)->where('user_id', $mmUser->id)->count() === 0) {
            $starterBids = [
                ['price' => '64900.00', 'quantity' => '0.500000'],
                ['price' => '64750.00', 'quantity' => '0.750000'],
                ['price' => '64500.00', 'quantity' => '1.500000'],
                ['price' => '64300.00', 'quantity' => '2.200000'],
                ['price' => '64000.00', 'quantity' => '3.500000'],
            ];
            foreach ($starterBids as $b) {
                Order::create([
                    'uuid' => (string) Str::uuid(),
                    'user_id' => $mmUser->id,
                    'trading_pair_id' => $btcPair->id,
                    'side' => 'BUY',
                    'type' => 'LIMIT',
                    'price' => $b['price'],
                    'quantity' => $b['quantity'],
                    'filled_quantity' => '0.000000000000000000',
                    'filled_quote_amount' => '0.000000000000000000',
                    'locked_amount' => bcmul($b['price'], $b['quantity'], 18),
                    'locked_currency_id' => $usdt->id,
                    'status' => 'OPEN',
                ]);
            }

            $starterAsks = [
                ['price' => '65100.00', 'quantity' => '0.450000'],
                ['price' => '65250.00', 'quantity' => '0.800000'],
                ['price' => '65400.00', 'quantity' => '1.200000'],
                ['price' => '65600.00', 'quantity' => '2.500000'],
                ['price' => '65900.00', 'quantity' => '3.100000'],
            ];
            foreach ($starterAsks as $a) {
                Order::create([
                    'uuid' => (string) Str::uuid(),
                    'user_id' => $mmUser->id,
                    'trading_pair_id' => $btcPair->id,
                    'side' => 'SELL',
                    'type' => 'LIMIT',
                    'price' => $a['price'],
                    'quantity' => $a['quantity'],
                    'filled_quantity' => '0.000000000000000000',
                    'filled_quote_amount' => '0.000000000000000000',
                    'locked_amount' => $a['quantity'],
                    'locked_currency_id' => $btc->id,
                    'status' => 'OPEN',
                ]);
            }
        }
    }
}
