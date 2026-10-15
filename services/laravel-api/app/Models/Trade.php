<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class Trade extends Model
{
    use HasFactory;

    protected $fillable = [
        'uuid',
        'trading_pair_id',
        'maker_order_id',
        'taker_order_id',
        'maker_user_id',
        'taker_user_id',
        'price',
        'quantity',
        'quote_amount',
        'maker_fee',
        'taker_fee',
        'maker_side',
    ];

    protected function casts(): array
    {
        return [
            'price' => 'string',
            'quantity' => 'string',
            'quote_amount' => 'string',
            'maker_fee' => 'string',
            'taker_fee' => 'string',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (Trade $trade) {
            if (empty($trade->uuid)) {
                $trade->uuid = (string) Str::uuid();
            }
        });
    }

    public function tradingPair(): BelongsTo
    {
        return $this->belongsTo(TradingPair::class);
    }

    public function makerOrder(): BelongsTo
    {
        return $this->belongsTo(Order::class, 'maker_order_id');
    }

    public function takerOrder(): BelongsTo
    {
        return $this->belongsTo(Order::class, 'taker_order_id');
    }

    public function makerUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'maker_user_id');
    }

    public function takerUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'taker_user_id');
    }
}
