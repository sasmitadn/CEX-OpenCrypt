<?php

use App\Http\Controllers\Api\V1\AdminController;
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
    Route::get('/markets/{symbol}/candles', [MarketController::class, 'candles']);

    // 3. Authenticated Routes (Sanctum)
    Route::middleware('auth:sanctum')->group(function () {
        Route::get('/auth/me', [AuthController::class, 'me']);
        Route::post('/auth/logout', [AuthController::class, 'logout']);

        // Wallets & Balances
        Route::get('/wallets', [WalletController::class, 'index']);
        Route::get('/wallets/withdrawals', [WalletController::class, 'withdrawals']);
        Route::get('/wallets/deposits', [WalletController::class, 'deposits']);
        Route::get('/wallets/transfers', [WalletController::class, 'transfers']);
        Route::post('/wallets/deposit-address', [WalletController::class, 'depositAddress']);
        Route::post('/wallets/withdraw', [WalletController::class, 'withdraw']);
        Route::post('/wallets/transfer-internal', [WalletController::class, 'transferInternal']);
        Route::post('/wallets/faucet', [WalletController::class, 'faucet']); // Demo testing faucet

        // Orders
        Route::get('/orders', [OrderController::class, 'index']);
        Route::post('/orders', [OrderController::class, 'store']);
        Route::delete('/orders/{uuid}', [OrderController::class, 'destroy']);

        // Admin Management Portal
        Route::prefix('admin')->group(function () {
            Route::get('/overview', [AdminController::class, 'overview']);
            Route::get('/withdrawals', [AdminController::class, 'withdrawals']);
            Route::post('/withdrawals/{uuid}/approve', [AdminController::class, 'approveWithdrawal']);
            Route::post('/withdrawals/{uuid}/reject', [AdminController::class, 'rejectWithdrawal']);
            Route::get('/transactions', [AdminController::class, 'transactions']);
            Route::get('/users', [AdminController::class, 'users']);
            Route::post('/users/{id}/status', [AdminController::class, 'updateUserStatus']);
            Route::get('/currencies', [AdminController::class, 'currencies']);
            Route::post('/currencies', [AdminController::class, 'createCurrency']);
            Route::put('/currencies/{id}', [AdminController::class, 'updateCurrency']);
            Route::delete('/currencies/{id}', [AdminController::class, 'deleteCurrency']);
            Route::get('/pairs', [AdminController::class, 'pairs']);
            Route::post('/pairs', [AdminController::class, 'createPair']);
            Route::put('/pairs/{id}', [AdminController::class, 'updatePair']);
            Route::delete('/pairs/{id}', [AdminController::class, 'deletePair']);
            Route::put('/pairs/{id}/fees', [AdminController::class, 'updatePairFees']);
        });
    });
});

