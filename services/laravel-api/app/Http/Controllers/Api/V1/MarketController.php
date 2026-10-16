<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Trade;
use App\Models\TradingPair;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class MarketController extends Controller
{
    /**
     * GET /api/v1/markets
     * Daftar semua trading pairs beserta harga terkini
     */
    public function index(): JsonResponse
    {
        $pairs = TradingPair::with(['baseCurrency', 'quoteCurrency'])
            ->where('status', 'TRADING')
            ->get();

        $data = $pairs->map(function ($pair) {
            $latestTrade = Trade::where('trading_pair_id', $pair->id)
                ->latest('id')
                ->first();

            return [
                'id' => $pair->id,
                'symbol' => $pair->symbol,
                'base' => $pair->baseCurrency->code,
                'quote' => $pair->quoteCurrency->code,
                'last_price' => $latestTrade ? $latestTrade->price : '65000.00',
                'price_precision' => $pair->price_precision,
                'quantity_precision' => $pair->quantity_precision,
                'min_order_quantity' => $pair->min_order_quantity,
                'maker_fee_rate' => $pair->maker_fee_rate,
                'taker_fee_rate' => $pair->taker_fee_rate,
                'status' => $pair->status,
            ];
        });

        return response()->json([
            'success' => true,
            'data' => $data,
        ]);
    }

    /**
     * GET /api/v1/markets/{symbol}/depth
     * Mengambil kedalaman buku order (Bids & Asks)
     */
    public function depth(string $symbol): JsonResponse
    {
        $pair = TradingPair::where('symbol', strtoupper($symbol))->firstOrFail();

        // Agregasi bids aktif (tertinggi ke terendah)
        $bids = Order::select('price', DB::raw('SUM(quantity - filled_quantity) as volume'))
            ->where('trading_pair_id', $pair->id)
            ->where('side', 'BUY')
            ->whereIn('status', ['OPEN', 'PENDING', 'PARTIALLY_FILLED'])
            ->whereRaw('quantity > filled_quantity')
            ->groupBy('price')
            ->orderBy('price', 'desc')
            ->limit(20)
            ->get()
            ->map(fn($row) => [(string)$row->price, (string)$row->volume]);

        // Agregasi asks aktif (terendah ke tertinggi)
        $asks = Order::select('price', DB::raw('SUM(quantity - filled_quantity) as volume'))
            ->where('trading_pair_id', $pair->id)
            ->where('side', 'SELL')
            ->whereIn('status', ['OPEN', 'PENDING', 'PARTIALLY_FILLED'])
            ->whereRaw('quantity > filled_quantity')
            ->groupBy('price')
            ->orderBy('price', 'asc')
            ->limit(20)
            ->get()
            ->map(fn($row) => [(string)$row->price, (string)$row->volume]);

        return response()->json([
            'success' => true,
            'data' => [
                'symbol' => $pair->symbol,
                'bids' => $bids,
                'asks' => $asks,
                'timestamp' => now()->getTimestampMs(),
            ],
        ]);
    }

    /**
     * GET /api/v1/markets/{symbol}/trades
     * Riwayat perdagangan publik terkini
     */
    public function trades(string $symbol): JsonResponse
    {
        $pair = TradingPair::where('symbol', strtoupper($symbol))->firstOrFail();

        $trades = Trade::where('trading_pair_id', $pair->id)
            ->latest('id')
            ->limit(30)
            ->get()
            ->map(fn($t) => [
                'id' => $t->id,
                'price' => $t->price,
                'quantity' => $t->quantity,
                'quote_amount' => $t->quote_amount,
                'side' => $t->maker_side === 'SELL' ? 'BUY' : 'SELL', // Taker side
                'time' => $t->created_at->toISOString(),
            ]);

        return response()->json([
            'success' => true,
            'data' => $trades,
        ]);
    }

    /**
     * GET /api/v1/markets/{symbol}/candles
     * Data grafik OHLCV fleksibel dengan timeframe dinamis (1m, 5m, 15m, 30m, 1j, 4j, 1d, 1w, 1M, 1y)
     */
    public function candles(Request $request, string $symbol, \App\Services\CandleService $candleService): JsonResponse
    {
        $pair = TradingPair::where('symbol', strtoupper($symbol))->firstOrFail();
        $timeframe = (string) $request->query('timeframe', '1m');
        $limit = (int) $request->query('limit', 150);
        $startTime = $request->has('start') ? (int) $request->query('start') : null;
        $endTime = $request->has('end') ? (int) $request->query('end') : null;

        $candles = $candleService->getCandles($pair, $timeframe, $limit, $startTime, $endTime);

        return response()->json([
            'success' => true,
            'data' => [
                'symbol' => $pair->symbol,
                'timeframe' => $timeframe,
                'interval_seconds' => $candleService->resolveInterval($timeframe),
                'candles' => $candles,
            ],
        ]);
    }
}
