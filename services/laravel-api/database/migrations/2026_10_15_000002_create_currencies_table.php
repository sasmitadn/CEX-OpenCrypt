<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('currencies', function (Blueprint $table) {
            $table->id();
            $table->string('code', 20)->unique(); // e.g. BTC, ETH, USDT
            $table->string('name', 100);          // e.g. Bitcoin, Ethereum, Tether USD
            $table->string('type', 20)->default('CRYPTO'); // CRYPTO, FIAT
            $table->unsignedTinyInteger('decimals')->default(18); // Decimals (e.g. 18 for ETH, 8 for BTC, 6 for USDT)
            $table->decimal('min_deposit', 36, 18)->default('0.000000000000000000');
            $table->decimal('min_withdraw', 36, 18)->default('0.000000000000000000');
            $table->decimal('withdraw_fee', 36, 18)->default('0.000000000000000000');
            $table->boolean('is_deposit_enabled')->default(true);
            $table->boolean('is_withdraw_enabled')->default(true);
            $table->boolean('is_trading_enabled')->default(true);
            $table->string('status', 20)->default('ACTIVE'); // ACTIVE, MAINTENANCE, DISABLED
            $table->json('networks')->nullable(); // e.g. [{"network": "ERC20", "contract": "0x..."}, {"network": "TRC20"}]
            $table->timestamps();

            $table->index(['status', 'is_deposit_enabled', 'is_withdraw_enabled']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('currencies');
    }
};
