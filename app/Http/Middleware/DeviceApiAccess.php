<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class DeviceApiAccess
{
    public function handle(Request $request, Closure $next)
    {
        abort_if((int) $request->server('CONTENT_LENGTH', 0) > 3 * 1024 * 1024, 413);
        if (! config('diagnostics.remote_api')) {
            return app(LocalResearchOnly::class)->handle($request, $next);
        }
        abort_unless($request->isSecure(), 403, '设备接口要求 HTTPS。');
        $response = $next($request);
        $response->headers->set('Cache-Control', 'no-store, private');
        $response->headers->set('X-Content-Type-Options', 'nosniff');

        return $response;
    }
}
