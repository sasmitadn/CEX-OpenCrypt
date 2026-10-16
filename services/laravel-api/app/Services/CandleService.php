<?php

namespace App\Services;

use App\Models\OhlcvCandle;
use App\Models\TradingPair;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

class CandleService
{
    /**
     * Flexible map of supported timeframe symbols to duration in seconds.
     * To add any new timeframe (e.g. '3m', '2h', '12h', '3d'), simply add it here.
     */
    public const TIMEFRAMES = [
        '1m'  => 60,       // 1 Minute
        '5m'  => 300,      // 5 Minutes
        '15m' => 900,      // 15 Minutes
        '30m' => 1800,     // 30 Minutes
        '1h'  => 3600,     // 1 Hour
        '1j'  => 3600,     // 1 Jam (Indonesian alias)
        '4h'  => 14400,    // 4 Hours
        '4j'  => 14400,    // 4 Jam (Indonesian alias)
        '1d'  => 86400,    // 1 Day
        '1w'  => 604800,   // 1 Week
        '1M'  => 2592000,  // 1 Month (30 days)
        '1b'  => 2592000,  // 1 Bulan (Indonesian alias)
        '1y'  => 31536000, // 1 Year (365 days)
    ];

    /**
     * Resolve timeframe string to interval in seconds.
     */
    public function resolveInterval(string $timeframe): int
    {
        $tf = trim($timeframe);
        
        // Exact match
        if (isset(self::TIMEFRAMES[$tf])) {
            return self::TIMEFRAMES[$tf];
        }

        // Lowercase match
        $lower = strtolower($tf);
        if (isset(self::TIMEFRAMES[$lower])) {
            return self::TIMEFRAMES[$lower];
        }

        // Default fallback to 1m (60s)
        return 60;
    }

    /**
     * Record a trade into the 1-minute OHLCV candle bucket.
     */
    public function recordTrade(int $tradingPairId, string $price, string $quantity, ?int $timestamp = null): OhlcvCandle
    {
        $ts = $timestamp ?? time();
        $bucket = (int) (floor($ts / 60) * 60);
        $quoteTurnover = bcmul($price, $quantity, 18);

        return DB::transaction(function () use ($tradingPairId, $bucket, $price, $quantity, $quoteTurnover) {
            $candle = OhlcvCandle::where('trading_pair_id', $tradingPairId)
                ->where('timeframe', '1m')
                ->where('timestamp', $bucket)
                ->lockForUpdate()
                ->first();

            if (!$candle) {
                return OhlcvCandle::create([
                    'trading_pair_id' => $tradingPairId,
                    'timeframe' => '1m',
                    'timestamp' => $bucket,
                    'open' => $price,
                    'high' => $price,
                    'low' => $price,
                    'close' => $price,
                    'volume' => $quantity,
                    'quote_volume' => $quoteTurnover,
                    'trades_count' => 1,
                ]);
            }

            // Update existing 1-minute candle
            $newHigh = bccomp($price, $candle->high, 18) > 0 ? $price : $candle->high;
            $newLow = bccomp($price, $candle->low, 18) < 0 ? $price : $candle->low;
            $newVolume = bcadd($candle->volume, $quantity, 18);
            $newQuoteVolume = bcadd($candle->quote_volume, $quoteTurnover, 18);

            $candle->update([
                'close' => $price,
                'high' => $newHigh,
                'low' => $newLow,
                'volume' => $newVolume,
                'quote_volume' => $newQuoteVolume,
                'trades_count' => $candle->trades_count + 1,
            ]);

            return $candle;
        });
    }

    /**
     * Query candles for a trading pair at any timeframe (1m, 5m, 15m, 30m, 1h/1j, 4h/4j, 1d, 1w, 1M, 1y).
     * If interval is 60s (1m), queries 1m bucket directly.
     * If interval > 60s, aggregates dynamically and accurately from 1m base candles.
     */
    public function getCandles(
        TradingPair $pair,
        string $timeframe = '1m',
        int $limit = 200,
        ?int $startTime = null,
        ?int $endTime = null
    ): array {
        $interval = $this->resolveInterval($timeframe);
        $limit = max(10, min(1000, $limit));

        if ($interval === 60) {
            // Direct 1-minute query
            $query = OhlcvCandle::where('trading_pair_id', $pair->id)
                ->where('timeframe', '1m');

            if ($startTime !== null) {
                $query->where('timestamp', '>=', $startTime);
            }
            if ($endTime !== null) {
                $query->where('timestamp', '<=', $endTime);
            }

            $rows = $query->orderBy('timestamp', 'desc')
                ->limit($limit)
                ->get()
                ->reverse()
                ->values();

            return $rows->map(function ($c) {
                return [
                    'time' => $c->timestamp,
                    'open' => (float) $c->open,
                    'high' => (float) $c->high,
                    'low' => (float) $c->low,
                    'close' => (float) $c->close,
                    'volume' => (float) $c->volume,
                    'quote_volume' => (float) $c->quote_volume,
                    'trades_count' => $c->trades_count,
                ];
            })->toArray();
        }

        // Dynamic aggregation for higher timeframes (5m, 15m, 30m, 1h, 4h, 1d, 1w, 1M, 1y)
        $bindings = [
            'pair_id' => $pair->id,
            'interval' => $interval,
        ];

        $whereClause = "trading_pair_id = :pair_id AND timeframe = '1m'";

        if ($startTime !== null) {
            $whereClause .= " AND timestamp >= :start_time";
            $bindings['start_time'] = $startTime;
        }
        if ($endTime !== null) {
            $whereClause .= " AND timestamp <= :end_time";
            $bindings['end_time'] = $endTime;
        }

        $sql = "
            SELECT 
                FLOOR(timestamp / :interval) * :interval AS bucket_time,
                (ARRAY_AGG(open ORDER BY timestamp ASC))[1] AS open,
                MAX(high) AS high,
                MIN(low) AS low,
                (ARRAY_AGG(close ORDER BY timestamp DESC))[1] AS close,
                SUM(volume) AS volume,
                SUM(quote_volume) AS quote_volume,
                SUM(trades_count) AS trades_count
            FROM ohlcv_candles
            WHERE {$whereClause}
            GROUP BY bucket_time
            ORDER BY bucket_time DESC
            LIMIT {$limit}
        ";

        $results = DB::select($sql, $bindings);

        // Reverse to ascending chronological order
        $chronological = array_reverse($results);

        return array_map(function ($row) {
            return [
                'time' => (int) $row->bucket_time,
                'open' => (float) $row->open,
                'high' => (float) $row->high,
                'low' => (float) $row->low,
                'close' => (float) $row->close,
                'volume' => (float) $row->volume,
                'quote_volume' => (float) $row->quote_volume,
                'trades_count' => (int) $row->trades_count,
            ];
        }, $chronological);
    }

    /**
     * Generate realistic 1-minute historical OHLCV seed candles for a trading pair.
     * Generates $countMinutes of realistic continuous price movement.
     */
    public function seedHistoricalCandles(TradingPair $pair, float $currentPrice, int $countMinutes = 2880): void
    {
        $now = (int) (floor(time() / 60) * 60);
        $startTime = $now - ($countMinutes * 60);

        // Check if candles already exist
        $existingCount = OhlcvCandle::where('trading_pair_id', $pair->id)->count();
        if ($existingCount >= 100) {
            return;
        }

        $price = $currentPrice;
        $batch = [];

        // Random walk generator with mean reversion
        for ($i = 0; $i < $countMinutes; $i++) {
            $ts = $startTime + ($i * 60);

            // Change between -0.4% and +0.4% with occasional trends
            $volatility = $currentPrice * 0.003;
            $drift = ($currentPrice - $price) * 0.02; // Mean reversion pull
            $delta = ((mt_rand(-100, 100) / 100.0) * $volatility) + $drift;

            $open = $price;
            $close = max($currentPrice * 0.5, $open + $delta);
            $high = max($open, $close) + (mt_rand(0, 50) / 100.0) * $volatility;
            $low = min($open, $close) - (mt_rand(0, 50) / 100.0) * $volatility;
            $volume = round((mt_rand(10, 200) / 100.0) * ($currentPrice > 1000 ? 1.5 : 50), 6);
            $quoteVolume = round($volume * (($open + $close) / 2), 4);
            $tradesCount = mt_rand(5, 45);

            $batch[] = [
                'trading_pair_id' => $pair->id,
                'timeframe' => '1m',
                'timestamp' => $ts,
                'open' => sprintf('%.8f', $open),
                'high' => sprintf('%.8f', $high),
                'low' => sprintf('%.8f', $low),
                'close' => sprintf('%.8f', $close),
                'volume' => sprintf('%.8f', $volume),
                'quote_volume' => sprintf('%.8f', $quoteVolume),
                'trades_count' => $tradesCount,
                'created_at' => now(),
                'updated_at' => now(),
            ];

            $price = $close;

            // Insert in chunks of 500 for high performance
            if (count($batch) >= 500) {
                OhlcvCandle::insertOrIgnore($batch);
                $batch = [];
            }
        }

        if (!empty($batch)) {
            OhlcvCandle::insertOrIgnore($batch);
        }
    }
}
