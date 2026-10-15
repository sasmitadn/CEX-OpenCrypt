<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class Wallet extends Model
{
    use HasFactory;

    protected $fillable = [
        'uuid',
        'user_id',
        'currency_id',
        'type',
        'balance',
        'locked_balance',
        'status',
    ];

    protected function casts(): array
    {
        return [
            // Always cast balance as string to preserve BCMath 18-decimal precision
            'balance' => 'string',
            'locked_balance' => 'string',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (Wallet $wallet) {
            if (empty($wallet->uuid)) {
                $wallet->uuid = (string) Str::uuid();
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

    public function ledgerEntries(): HasMany
    {
        return $this->hasMany(LedgerEntry::class);
    }

    public function deposits(): HasMany
    {
        return $this->hasMany(Deposit::class);
    }

    public function withdrawals(): HasMany
    {
        return $this->hasMany(Withdrawal::class);
    }

    /**
     * Total balance (available balance + locked balance in orders/withdrawals)
     */
    public function getTotalBalance(): string
    {
        return bcadd($this->balance, $this->locked_balance, 18);
    }
}
