<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Currency extends Model
{
    use HasFactory;

    protected $fillable = [
        'code',
        'name',
        'type',
        'decimals',
        'min_deposit',
        'min_withdraw',
        'withdraw_fee',
        'is_deposit_enabled',
        'is_withdraw_enabled',
        'is_trading_enabled',
        'status',
        'networks',
    ];

    protected function casts(): array
    {
        return [
            'decimals' => 'integer',
            'min_deposit' => 'string',
            'min_withdraw' => 'string',
            'withdraw_fee' => 'string',
            'is_deposit_enabled' => 'boolean',
            'is_withdraw_enabled' => 'boolean',
            'is_trading_enabled' => 'boolean',
            'networks' => 'array',
        ];
    }

    public function wallets(): HasMany
    {
        return $this->hasMany(Wallet::class);
    }

    public function tradingPairsAsBase(): HasMany
    {
        return $this->hasMany(TradingPair::class, 'base_currency_id');
    }

    public function tradingPairsAsQuote(): HasMany
    {
        return $this->hasMany(TradingPair::class, 'quote_currency_id');
    }
}
