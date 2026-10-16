<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OhlcvCandle extends Model
{
    use HasFactory;

    protected $table = 'ohlcv_candles';

    protected $fillable = [
        'trading_pair_id',
        'timeframe',
        'timestamp',
        'open',
        'high',
        'low',
        'close',
        'volume',
        'quote_volume',
        'trades_count',
    ];

    protected function casts(): array
    {
        return [
            'timestamp' => 'integer',
            'open' => 'string',
            'high' => 'string',
            'low' => 'string',
            'close' => 'string',
            'volume' => 'string',
            'quote_volume' => 'string',
            'trades_count' => 'integer',
        ];
    }

    public function tradingPair(): BelongsTo
    {
        return $this->belongsTo(TradingPair::class);
    }
}
