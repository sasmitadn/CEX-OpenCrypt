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
        Schema::create('ohlcv_candles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trading_pair_id')->constrained('trading_pairs')->cascadeOnDelete();
            $table->string('timeframe', 10)->default('1m'); // 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w, 1M, 1y
            $table->bigInteger('timestamp'); // Unix timestamp in seconds (start of the candle bucket)
            $table->decimal('open', 36, 18);
            $table->decimal('high', 36, 18);
            $table->decimal('low', 36, 18);
            $table->decimal('close', 36, 18);
            $table->decimal('volume', 36, 18)->default('0.000000000000000000'); // Base currency volume
            $table->decimal('quote_volume', 36, 18)->default('0.000000000000000000'); // Quote currency turnover
            $table->unsignedInteger('trades_count')->default(0);
            $table->timestamps();

            // Unique index to ensure strict bucket integrity
            $table->unique(['trading_pair_id', 'timeframe', 'timestamp'], 'pair_tf_ts_unique');
            $table->index(['trading_pair_id', 'timeframe', 'timestamp'], 'pair_tf_ts_idx');
            $table->index(['trading_pair_id', 'timestamp'], 'pair_ts_idx');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('ohlcv_candles');
    }
};
