<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class Order extends Model
{
    use HasFactory;

    protected $fillable = [
        'uuid',
        'user_id',
        'trading_pair_id',
        'side',
        'type',
        'price',
        'quantity',
        'filled_quantity',
        'filled_quote_amount',
        'locked_amount',
        'locked_currency_id',
        'executed_fee',
        'status',
        'canceled_at',
    ];

    protected function casts(): array
    {
        return [
            'price' => 'string',
            'quantity' => 'string',
            'filled_quantity' => 'string',
            'filled_quote_amount' => 'string',
            'locked_amount' => 'string',
            'executed_fee' => 'string',
            'canceled_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (Order $order) {
            if (empty($order->uuid)) {
                $order->uuid = (string) Str::uuid();
            }
        });
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function tradingPair(): BelongsTo
    {
        return $this->belongsTo(TradingPair::class);
    }

    public function lockedCurrency(): BelongsTo
    {
        return $this->belongsTo(Currency::class, 'locked_currency_id');
    }

    public function tradesAsMaker(): HasMany
    {
        return $this->hasMany(Trade::class, 'maker_order_id');
    }

    public function tradesAsTaker(): HasMany
    {
        return $this->hasMany(Trade::class, 'taker_order_id');
    }
}
