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
        // 1. Currencies with multi-network support
        $btc = Currency::updateOrCreate(
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
                'networks' => [
                    ['network' => 'BTC', 'name' => 'Bitcoin Mainnet / Testnet', 'confirmation_blocks' => 2]
                ],
            ]
        );

        $eth = Currency::updateOrCreate(
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
                'networks' => [
                    ['network' => 'ETH', 'name' => 'Ethereum (ERC-20 / Sepolia)', 'confirmation_blocks' => 12],
                    ['network' => 'ARB', 'name' => 'Arbitrum One (L2)', 'confirmation_blocks' => 1]
                ],
            ]
        );

        $usdt = Currency::updateOrCreate(
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
                'networks' => [
                    ['network' => 'ETH', 'name' => 'Ethereum (ERC-20)', 'confirmation_blocks' => 12],
                    ['network' => 'ARB', 'name' => 'Arbitrum One', 'confirmation_blocks' => 1],
                    ['network' => 'MATIC', 'name' => 'Polygon PoS', 'confirmation_blocks' => 64],
                    ['network' => 'BNB', 'name' => 'BNB Smart Chain (BEP-20)', 'confirmation_blocks' => 15],
                    ['network' => 'AVAX', 'name' => 'Avalanche C-Chain', 'confirmation_blocks' => 1],
                ],
            ]
        );

        $arb = Currency::updateOrCreate(
            ['code' => 'ARB'],
            [
                'name' => 'Arbitrum',
                'type' => 'CRYPTO',
                'decimals' => 18,
                'min_deposit' => '1.000000000000000000',
                'min_withdraw' => '5.000000000000000000',
                'withdraw_fee' => '0.500000000000000000',
                'is_deposit_enabled' => true,
                'is_withdraw_enabled' => true,
                'is_trading_enabled' => true,
                'status' => 'ACTIVE',
                'networks' => [
                    ['network' => 'ARB', 'name' => 'Arbitrum One', 'confirmation_blocks' => 1],
                    ['network' => 'ETH', 'name' => 'Ethereum (ERC-20)', 'confirmation_blocks' => 12],
                ],
            ]
        );

        $matic = Currency::updateOrCreate(
            ['code' => 'MATIC'],
            [
                'name' => 'Polygon',
                'type' => 'CRYPTO',
                'decimals' => 18,
                'min_deposit' => '1.000000000000000000',
                'min_withdraw' => '5.000000000000000000',
                'withdraw_fee' => '0.200000000000000000',
                'is_deposit_enabled' => true,
                'is_withdraw_enabled' => true,
                'is_trading_enabled' => true,
                'status' => 'ACTIVE',
                'networks' => [
                    ['network' => 'MATIC', 'name' => 'Polygon PoS', 'confirmation_blocks' => 64],
                    ['network' => 'ETH', 'name' => 'Ethereum (ERC-20)', 'confirmation_blocks' => 12],
                ],
            ]
        );

        $bnb = Currency::updateOrCreate(
            ['code' => 'BNB'],
            [
                'name' => 'BNB Chain',
                'type' => 'CRYPTO',
                'decimals' => 18,
                'min_deposit' => '0.010000000000000000',
                'min_withdraw' => '0.020000000000000000',
                'withdraw_fee' => '0.001000000000000000',
                'is_deposit_enabled' => true,
                'is_withdraw_enabled' => true,
                'is_trading_enabled' => true,
                'status' => 'ACTIVE',
                'networks' => [
                    ['network' => 'BNB', 'name' => 'BNB Smart Chain (BEP-20)', 'confirmation_blocks' => 15],
                ],
            ]
        );

        $avax = Currency::updateOrCreate(
            ['code' => 'AVAX'],
            [
                'name' => 'Avalanche',
                'type' => 'CRYPTO',
                'decimals' => 18,
                'min_deposit' => '0.100000000000000000',
                'min_withdraw' => '0.200000000000000000',
                'withdraw_fee' => '0.010000000000000000',
                'is_deposit_enabled' => true,
                'is_withdraw_enabled' => true,
                'is_trading_enabled' => true,
                'status' => 'ACTIVE',
                'networks' => [
                    ['network' => 'AVAX', 'name' => 'Avalanche C-Chain', 'confirmation_blocks' => 1],
                ],
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
                'maker_fee_rate' => '0.001000', // 0.10%
                'taker_fee_rate' => '0.002000', // 0.20%
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

        TradingPair::firstOrCreate(
            ['symbol' => 'ARB_USDT'],
            [
                'base_currency_id' => $arb->id,
                'quote_currency_id' => $usdt->id,
                'price_precision' => 4,
                'quantity_precision' => 2,
                'min_order_quantity' => '1.000000000000000000',
                'min_order_notional' => '5.000000000000000000',
                'maker_fee_rate' => '0.001000',
                'taker_fee_rate' => '0.002000',
                'status' => 'TRADING',
            ]
        );

        TradingPair::firstOrCreate(
            ['symbol' => 'MATIC_USDT'],
            [
                'base_currency_id' => $matic->id,
                'quote_currency_id' => $usdt->id,
                'price_precision' => 4,
                'quantity_precision' => 2,
                'min_order_quantity' => '1.000000000000000000',
                'min_order_notional' => '5.000000000000000000',
                'maker_fee_rate' => '0.001000',
                'taker_fee_rate' => '0.002000',
                'status' => 'TRADING',
            ]
        );

        TradingPair::firstOrCreate(
            ['symbol' => 'BNB_USDT'],
            [
                'base_currency_id' => $bnb->id,
                'quote_currency_id' => $usdt->id,
                'price_precision' => 2,
                'quantity_precision' => 4,
                'min_order_quantity' => '0.010000000000000000',
                'min_order_notional' => '10.000000000000000000',
                'maker_fee_rate' => '0.001000',
                'taker_fee_rate' => '0.002000',
                'status' => 'TRADING',
            ]
        );

        TradingPair::firstOrCreate(
            ['symbol' => 'AVAX_USDT'],
            [
                'base_currency_id' => $avax->id,
                'quote_currency_id' => $usdt->id,
                'price_precision' => 2,
                'quantity_precision' => 4,
                'min_order_quantity' => '0.100000000000000000',
                'min_order_notional' => '10.000000000000000000',
                'maker_fee_rate' => '0.001000',
                'taker_fee_rate' => '0.002000',
                'status' => 'TRADING',
            ]
        );

        // 3. Admin User (Requested: admin@gmail.com / admin)
        User::updateOrCreate(
            ['email' => 'admin@gmail.com'],
            [
                'name' => 'Super Administrator',
                'password' => Hash::make('admin'),
                'role' => 'ADMIN',
                'status' => 'ACTIVE',
                'kyc_level' => 3,
            ]
        );

        // 4. Demo Trader User
        $user = User::firstOrCreate(
            ['email' => 'trader@cex.com'],
            [
                'name' => 'Pro Trader',
                'password' => Hash::make('password123'),
                'role' => 'TRADER',
                'status' => 'ACTIVE',
                'kyc_level' => 2,
            ]
        );

        // 5. Inisialisasi Saldo Awal Demo untuk Trader
        $balanceService = app(BalanceService::class);

        $coins = [
            [$btc, '2.500000000000000000', 'INIT_BTC_SEED'],
            [$eth, '25.000000000000000000', 'INIT_ETH_SEED'],
            [$usdt, '100000.000000000000000000', 'INIT_USDT_SEED'],
            [$arb, '5000.000000000000000000', 'INIT_ARB_SEED'],
            [$matic, '10000.000000000000000000', 'INIT_MATIC_SEED'],
            [$bnb, '50.000000000000000000', 'INIT_BNB_SEED'],
            [$avax, '150.000000000000000000', 'INIT_AVAX_SEED'],
        ];

        foreach ($coins as [$coin, $amt, $txHash]) {
            $wallet = Wallet::firstOrCreate(
                ['user_id' => $user->id, 'currency_id' => $coin->id, 'type' => 'SPOT'],
                ['uuid' => (string) Str::uuid(), 'balance' => '0', 'locked_balance' => '0', 'status' => 'ACTIVE']
            );
            if (bccomp($wallet->balance, '0', 18) === 0) {
                $balanceService->depositCredit($user->id, $coin, $amt, $txHash);
            }
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

        // 6. Seed Realistic 1-Minute OHLCV Historical Candles for Charts
        $candleService = app(\App\Services\CandleService::class);
        $pairPrices = [
            'BTC_USDT' => 64850.00,
            'ETH_USDT' => 3480.00,
            'ARB_USDT' => 0.88,
            'MATIC_USDT' => 0.54,
            'BNB_USDT' => 595.00,
            'AVAX_USDT' => 28.50,
        ];
        foreach ($pairPrices as $sym => $basePrice) {
            $p = TradingPair::where('symbol', $sym)->first();
            if ($p) {
                $candleService->seedHistoricalCandles($p, $basePrice, 2880); // 48 hours of 1m continuous candles
            }
        }
    }
}
