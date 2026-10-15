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
        Schema::create('trades', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('trading_pair_id')->constrained('trading_pairs')->cascadeOnDelete();
            $table->foreignId('maker_order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignId('taker_order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignId('maker_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('taker_user_id')->constrained('users')->cascadeOnDelete();
            $table->decimal('price', 36, 18);
            $table->decimal('quantity', 36, 18);
            $table->decimal('quote_amount', 36, 18); // price * quantity
            $table->decimal('maker_fee', 36, 18)->default('0.000000000000000000');
            $table->decimal('taker_fee', 36, 18)->default('0.000000000000000000');
            $table->string('maker_side', 10); // BUY, SELL
            $table->timestamps();

            $table->index(['trading_pair_id', 'created_at']);
            $table->index(['maker_user_id', 'created_at']);
            $table->index(['taker_user_id', 'created_at']);
            $table->index(['maker_order_id']);
            $table->index(['taker_order_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('trades');
    }
};
