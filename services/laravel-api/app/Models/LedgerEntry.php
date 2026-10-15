<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class LedgerEntry extends Model
{
    use HasFactory;

    protected $fillable = [
        'uuid',
        'reference_id',
        'reference_type',
        'wallet_id',
        'user_id',
        'currency_id',
        'entry_type', // DEBIT, CREDIT
        'amount',
        'fee',
        'balance_before',
        'balance_after',
        'locked_before',
        'locked_after',
        'description',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'string',
            'fee' => 'string',
            'balance_before' => 'string',
            'balance_after' => 'string',
            'locked_before' => 'string',
            'locked_after' => 'string',
            'metadata' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (LedgerEntry $entry) {
            if (empty($entry->uuid)) {
                $entry->uuid = (string) Str::uuid();
            }
        });
    }

    public function wallet(): BelongsTo
    {
        return $this->belongsTo(Wallet::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function currency(): BelongsTo
    {
        return $this->belongsTo(Currency::class);
    }
}
