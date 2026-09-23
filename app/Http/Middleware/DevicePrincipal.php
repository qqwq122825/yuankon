<?php

namespace App\Http\Middleware;

use App\Models\Device;
use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;

class DevicePrincipal
{
    public function handle(Request $request, Closure $next)
    {
        $device = $request->user();
        abort_unless($device instanceof Device && $device->source === 'api'
            && $device->currentAccessToken() instanceof PersonalAccessToken
            && $device->tokenCan('diagnostics:write'), 403);

        return $next($request);
    }
}
