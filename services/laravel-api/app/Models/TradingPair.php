<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TradingPair extends Model
{
    use HasFactory;

    protected $fillable = [
        'symbol',
        'base_currency_id',
        'quote_currency_id',
        'price_precision',
        'quantity_precision',
        'min_order_quantity',
        'max_order_quantity',
        'min_order_notional',
        'maker_fee_rate',
        'taker_fee_rate',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'price_precision' => 'integer',
            'quantity_precision' => 'integer',
            'min_order_quantity' => 'string',
            'max_order_quantity' => 'string',
            'min_order_notional' => 'string',
            'maker_fee_rate' => 'string',
            'taker_fee_rate' => 'string',
        ];
    }

    public function baseCurrency(): BelongsTo
    {
        return $this->belongsTo(Currency::class, 'base_currency_id');
    }

    public function quoteCurrency(): BelongsTo
    {
        return $this->belongsTo(Currency::class, 'quote_currency_id');
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    public function trades(): HasMany
    {
        return $this->hasMany(Trade::class);
    }
}
