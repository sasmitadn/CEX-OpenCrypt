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
        Schema::create('wallets', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('currency_id')->constrained('currencies')->cascadeOnDelete();
            $table->string('type', 30)->default('SPOT'); // SPOT, FUNDING, SYSTEM_FEE, SYSTEM_RESERVE
            $table->decimal('balance', 36, 18)->default('0.000000000000000000');
            $table->decimal('locked_balance', 36, 18)->default('0.000000000000000000');
            $table->string('status', 20)->default('ACTIVE'); // ACTIVE, FROZEN, READ_ONLY
            $table->timestamps();

            $table->index(['user_id', 'currency_id', 'type']);
            $table->index(['status', 'currency_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('wallets');
    }
};
