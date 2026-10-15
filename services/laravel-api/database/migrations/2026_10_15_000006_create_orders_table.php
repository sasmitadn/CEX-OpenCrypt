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
        Schema::create('orders', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('trading_pair_id')->constrained('trading_pairs')->cascadeOnDelete();
            $table->string('side', 10); // BUY, SELL
            $table->string('type', 20); // LIMIT, MARKET, STOP_LIMIT
            $table->decimal('price', 36, 18)->nullable();
            $table->decimal('quantity', 36, 18);
            $table->decimal('filled_quantity', 36, 18)->default('0.000000000000000000');
            $table->decimal('filled_quote_amount', 36, 18)->default('0.000000000000000000');
            $table->decimal('locked_amount', 36, 18); // Reserved funds in user wallet
            $table->foreignId('locked_currency_id')->constrained('currencies')->cascadeOnDelete();
            $table->decimal('executed_fee', 36, 18)->default('0.000000000000000000');
            $table->string('status', 25)->default('PENDING'); // PENDING, OPEN, PARTIALLY_FILLED, FILLED, CANCELED, REJECTED
            $table->timestamp('canceled_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'status', 'created_at']);
            $table->index(['trading_pair_id', 'status', 'created_at']);
            $table->index(['trading_pair_id', 'side', 'price', 'created_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};
