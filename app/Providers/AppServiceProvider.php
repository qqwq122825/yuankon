<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('device-heartbeat', fn (Request $request) => Limit::perMinute(90)->by('heartbeat:'.$request->user()->id));
        RateLimiter::for('device-frames', fn (Request $request) => Limit::perMinute(65)->by('frames:'.$request->user()->id));
    }
}
