<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class InternalTransfer extends Model
{
    use HasFactory;

    protected $fillable = [
        'uuid',
        'sender_id',
        'recipient_id',
        'currency_id',
        'amount',
        'memo',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'string',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (InternalTransfer $transfer) {
            if (empty($transfer->uuid)) {
                $transfer->uuid = (string) Str::uuid();
            }
        });
    }

    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'sender_id');
    }

    public function recipient(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recipient_id');
    }

    public function currency(): BelongsTo
    {
        return $this->belongsTo(Currency::class);
    }
}
