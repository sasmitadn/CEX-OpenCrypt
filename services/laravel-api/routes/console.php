<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// 1. Prune expired Sanctum API tokens daily
Schedule::command('sanctum:prune-expired --hours=24')->daily();

// 2. Health & Reconciliation Heartbeat every minute
Schedule::call(function () {
    Log::info('[CEX Cron] Scheduler heartbeat: system healthy.');
})->everyMinute();
