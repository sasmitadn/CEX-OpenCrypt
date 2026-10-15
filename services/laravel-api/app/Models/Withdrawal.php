<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class Withdrawal extends Model
{
    use HasFactory;

    protected $fillable = [
        'uuid',
        'user_id',
        'currency_id',
        'wallet_id',
        'network',
        'to_address',
        'memo_tag',
        'amount',
        'fee',
        'net_amount',
        'tx_hash',
        'status', // PENDING_APPROVAL, APPROVED, PROCESSING, BROADCASTED, COMPLETED, REJECTED, FAILED
        'rejection_reason',
        'approved_by',
        'approved_at',
        'broadcasted_at',
        'completed_at',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'string',
            'fee' => 'string',
            'net_amount' => 'string',
            'approved_at' => 'datetime',
            'broadcasted_at' => 'datetime',
            'completed_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (Withdrawal $withdrawal) {
            if (empty($withdrawal->uuid)) {
                $withdrawal->uuid = (string) Str::uuid();
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

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }
}
