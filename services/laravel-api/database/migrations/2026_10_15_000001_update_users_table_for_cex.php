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
        Schema::table('users', function (Blueprint $table) {
            $table->string('status')->default('ACTIVE')->after('email'); // ACTIVE, SUSPENDED, BANNED
            $table->unsignedTinyInteger('kyc_level')->default(0)->after('status'); // 0=None, 1=Basic, 2=Verified, 3=Institutional
            $table->boolean('two_factor_enabled')->default(false)->after('kyc_level');
            $table->string('two_factor_secret')->nullable()->after('two_factor_enabled');
            $table->string('anti_phishing_code')->nullable()->after('two_factor_secret');
            $table->string('trade_password')->nullable()->after('anti_phishing_code');
            $table->decimal('daily_withdraw_limit', 36, 18)->default('10000.000000000000000000')->after('trade_password');
            $table->index(['status', 'kyc_level']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex(['status', 'kyc_level']);
            $table->dropColumn([
                'status',
                'kyc_level',
                'two_factor_enabled',
                'two_factor_secret',
                'anti_phishing_code',
                'trade_password',
                'daily_withdraw_limit',
            ]);
        });
    }
};
