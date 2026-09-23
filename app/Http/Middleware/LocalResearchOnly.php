<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class LocalResearchOnly
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless(app()->environment(['local', 'testing']), 503, '当前版本为本机免登录预览。正式部署前请完成身份认证。');
        abort_unless(in_array($request->server('REMOTE_ADDR'), ['127.0.0.1', '::1'], true)
            && in_array($request->getHost(), ['localhost', '127.0.0.1', '[::1]', '::1'], true)
            && ! $request->headers->has('X-Forwarded-For')
            && ! $request->headers->has('Forwarded'), 403, '此开发实例仅接受本机直接访问。');

        $response = $next($request);
        $response->headers->set('Cache-Control', 'no-store, private');
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('Referrer-Policy', 'no-referrer');
        $response->headers->set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");

        return $response;
    }
}
