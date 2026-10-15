<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\MarketController;
use App\Http\Controllers\Api\V1\OrderController;
use App\Http\Controllers\Api\V1\WalletController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    // 1. Auth Public
    Route::post('/auth/register', [AuthController::class, 'register']);
    Route::post('/auth/login', [AuthController::class, 'login']);

    // 2. Market Data Public
    Route::get('/markets', [MarketController::class, 'index']);
    Route::get('/markets/{symbol}/depth', [MarketController::class, 'depth']);
    Route::get('/markets/{symbol}/trades', [MarketController::class, 'trades']);

    // 3. Authenticated Routes (Sanctum)
    Route::middleware('auth:sanctum')->group(function () {
        Route::get('/auth/me', [AuthController::class, 'me']);
        Route::post('/auth/logout', [AuthController::class, 'logout']);

        // Wallets & Balances
        Route::get('/wallets', [WalletController::class, 'index']);
        Route::post('/wallets/deposit-address', [WalletController::class, 'depositAddress']);
        Route::post('/wallets/withdraw', [WalletController::class, 'withdraw']);
        Route::post('/wallets/faucet', [WalletController::class, 'faucet']); // Demo testing faucet

        // Orders
        Route::get('/orders', [OrderController::class, 'index']);
        Route::post('/orders', [OrderController::class, 'store']);
        Route::delete('/orders/{uuid}', [OrderController::class, 'destroy']);
    });
});
