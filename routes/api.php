<?php

use App\Http\Controllers\DeviceApiController;
use App\Http\Middleware\DeviceApiAccess;
use App\Http\Middleware\DevicePrincipal;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->middleware([DeviceApiAccess::class, 'throttle:600,1', 'auth:sanctum', DevicePrincipal::class])->group(function () {
    Route::post('/device/heartbeat', [DeviceApiController::class, 'heartbeat'])->middleware('throttle:device-heartbeat');
    Route::post('/diagnostics/sessions', [DeviceApiController::class, 'start'])->middleware('throttle:10,1');
    Route::get('/diagnostics/{id}', [DeviceApiController::class, 'status'])->whereUuid('id');
    Route::post('/diagnostics/{id}/stop', [DeviceApiController::class, 'stop'])->whereUuid('id');
    Route::post('/diagnostics/{id}/frames', [DeviceApiController::class, 'frame'])->whereUuid('id')->middleware('throttle:device-frames');
});
