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
        Schema::create('ledger_entries', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('reference_id', 100)->index();   // ID of Order, Trade, Deposit, or Withdrawal
            $table->string('reference_type', 50)->index(); // DEPOSIT, WITHDRAW, ORDER_LOCK, ORDER_UNLOCK, TRADE_EXECUTION, TRADE_FEE, SYSTEM_TRANSFER
            $table->foreignId('wallet_id')->constrained('wallets')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('currency_id')->constrained('currencies')->cascadeOnDelete();
            $table->string('entry_type', 20); // DEBIT, CREDIT
            $table->decimal('amount', 36, 18);
            $table->decimal('fee', 36, 18)->default('0.000000000000000000');
            $table->decimal('balance_before', 36, 18);
            $table->decimal('balance_after', 36, 18);
            $table->decimal('locked_before', 36, 18)->default('0.000000000000000000');
            $table->decimal('locked_after', 36, 18)->default('0.000000000000000000');
            $table->string('description', 255);
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->index(['wallet_id', 'created_at']);
            $table->index(['user_id', 'currency_id', 'created_at']);
            $table->index(['reference_id', 'reference_type']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('ledger_entries');
    }
};
