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
        Schema::create('trading_pairs', function (Blueprint $table) {
            $table->id();
            $table->string('symbol', 30)->unique(); // e.g. BTC_USDT
            $table->foreignId('base_currency_id')->constrained('currencies')->cascadeOnDelete();  // e.g. BTC
            $table->foreignId('quote_currency_id')->constrained('currencies')->cascadeOnDelete(); // e.g. USDT
            $table->unsignedTinyInteger('price_precision')->default(2);    // Decimal precision for order price
            $table->unsignedTinyInteger('quantity_precision')->default(6); // Decimal precision for order quantity
            $table->decimal('min_order_quantity', 36, 18)->default('0.000100000000000000');
            $table->decimal('max_order_quantity', 36, 18)->nullable();
            $table->decimal('min_order_notional', 36, 18)->default('1.000000000000000000'); // min value (price * quantity)
            $table->decimal('maker_fee_rate', 8, 6)->default('0.001000'); // 0.10%
            $table->decimal('taker_fee_rate', 8, 6)->default('0.002000'); // 0.20%
            $table->string('status', 20)->default('TRADING'); // TRADING, HALTED, CANCEL_ONLY, DISABLED
            $table->timestamps();

            $table->unique(['base_currency_id', 'quote_currency_id']);
            $table->index(['status', 'symbol']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('trading_pairs');
    }
};
