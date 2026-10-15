<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class Deposit extends Model
{
    use HasFactory;

    protected $fillable = [
        'uuid',
        'user_id',
        'currency_id',
        'wallet_id',
        'network',
        'tx_hash',
        'to_address',
        'from_address',
        'amount',
        'fee',
        'confirmations',
        'required_confirmations',
        'block_number',
        'status', // DETECTED, CONFIRMING, COMPLETED, FAILED
        'credited_at',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'string',
            'fee' => 'string',
            'confirmations' => 'integer',
            'required_confirmations' => 'integer',
            'block_number' => 'integer',
            'credited_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (Deposit $deposit) {
            if (empty($deposit->uuid)) {
                $deposit->uuid = (string) Str::uuid();
            }
        });
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function currency(): BelongsTo
    {
        return $this->belongsTo(Currency::class);
    }

    public function wallet(): BelongsTo
    {
        return $this->belongsTo(Wallet::class);
    }
}
