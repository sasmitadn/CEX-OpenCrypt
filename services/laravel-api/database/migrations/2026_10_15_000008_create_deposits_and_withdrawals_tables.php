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
        // 1. User Assigned Deposit Addresses
        Schema::create('deposit_addresses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('currency_id')->constrained('currencies')->cascadeOnDelete();
            $table->string('network', 30); // ETH, BSC, TRC20, BTC, SOL
            $table->string('address', 255);
            $table->string('memo_tag', 100)->nullable(); // For XRP, TON, EOS, etc.
            $table->string('status', 20)->default('ACTIVE'); // ACTIVE, EXPIRED, ARCHIVED
            $table->timestamps();

            $table->unique(['currency_id', 'network', 'address', 'memo_tag'], 'unique_deposit_addr');
            $table->index(['user_id', 'currency_id', 'network']);
            $table->index(['address', 'network']);
        });

        // 2. Deposits (State Machine: DETECTED -> CONFIRMING -> COMPLETED)
        Schema::create('deposits', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('currency_id')->constrained('currencies')->cascadeOnDelete();
            $table->foreignId('wallet_id')->constrained('wallets')->cascadeOnDelete();
            $table->string('network', 30);
            $table->string('tx_hash', 150);
            $table->string('to_address', 255);
            $table->string('from_address', 255)->nullable();
            $table->decimal('amount', 36, 18);
            $table->decimal('fee', 36, 18)->default('0.000000000000000000');
            $table->unsignedInteger('confirmations')->default(0);
            $table->unsignedInteger('required_confirmations')->default(12);
            $table->unsignedBigInteger('block_number')->nullable();
            $table->string('status', 25)->default('DETECTED'); // DETECTED, CONFIRMING, COMPLETED, FAILED
            $table->timestamp('credited_at')->nullable();
            $table->timestamps();

            // Unique constraint prevents duplicate crediting of same tx on same address
            $table->unique(['network', 'tx_hash', 'to_address'], 'unique_tx_deposit');
            $table->index(['user_id', 'currency_id', 'status']);
            $table->index(['status', 'confirmations']);
        });

        // 3. Withdrawals (State Machine: PENDING_APPROVAL -> APPROVED -> PROCESSING -> BROADCASTED -> COMPLETED)
        Schema::create('withdrawals', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('currency_id')->constrained('currencies')->cascadeOnDelete();
            $table->foreignId('wallet_id')->constrained('wallets')->cascadeOnDelete();
            $table->string('network', 30);
            $table->string('to_address', 255);
            $table->string('memo_tag', 100)->nullable();
            $table->decimal('amount', 36, 18);     // Gross amount deducted
            $table->decimal('fee', 36, 18);        // Network fee retained by exchange
            $table->decimal('net_amount', 36, 18); // Net amount sent on-chain (amount - fee)
            $table->string('tx_hash', 150)->nullable();
            $table->string('status', 25)->default('PENDING_APPROVAL'); // PENDING_APPROVAL, APPROVED, PROCESSING, BROADCASTED, COMPLETED, REJECTED, FAILED
            $table->text('rejection_reason')->nullable();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->timestamp('broadcasted_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'currency_id', 'status']);
            $table->index(['status', 'network']);
            $table->index(['tx_hash']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('withdrawals');
        Schema::dropIfExists('deposits');
        Schema::dropIfExists('deposit_addresses');
    }
};
