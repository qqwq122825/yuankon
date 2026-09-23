<?php

use App\Http\Controllers\BuildController;
use App\Http\Controllers\DiagnosticViewerController;
use App\Http\Controllers\LabController;
use App\Http\Controllers\TranslationController;
use Illuminate\Support\Facades\Route;

Route::get('/', [LabController::class, 'index'])->name('devices.index');
Route::get('/devices/{id}', [LabController::class, 'show'])->whereNumber('id')->name('devices.show');
Route::patch('/devices/{id}/note', [LabController::class, 'note'])->whereNumber('id')->name('devices.note');
Route::get('/snapshots', [LabController::class, 'archive'])->name('snapshots.index');
Route::get('/snapshots/{id}/export', [LabController::class, 'export'])->whereNumber('id')->name('snapshots.export');
Route::get('/snapshots/{id}/image', [LabController::class, 'screenshot'])->whereNumber('id')->name('snapshots.image');
Route::get('/events', [LabController::class, 'events'])->name('events.index');
Route::get('/settings/translation', [TranslationController::class, 'edit'])->name('translation.edit');
Route::put('/settings/translation', [TranslationController::class, 'update'])->middleware('throttle:20,1')->name('translation.update');
Route::delete('/settings/translation', [TranslationController::class, 'destroy'])->name('translation.destroy');
Route::post('/snapshots/{id}/translate', [TranslationController::class, 'translate'])->whereNumber('id')->middleware('throttle:20,1')->name('snapshots.translate');
Route::view('/guide', 'guide')->name('guide');
Route::get('/builds', [BuildController::class, 'index'])->name('builds');
Route::post('/builds/bot', [BuildController::class, 'configure'])->middleware('throttle:10,1')->name('builds.configure');
Route::post('/builds/pair', [BuildController::class, 'pair'])->name('builds.pair');
Route::get('/builds/{id}/artifact', [BuildController::class, 'artifact'])->whereUuid('id')->name('builds.artifact');
Route::get('/builds/{id}/log', [BuildController::class, 'log'])->whereUuid('id')->name('builds.log');
Route::get('/example-snapshot', fn () => response()->download(resource_path('fixtures/example-snapshot.json'), 'example-snapshot.json'))->name('example');

Route::get('/devices/{id}/diagnostics', [DiagnosticViewerController::class, 'status'])->whereNumber('id')->name('diagnostics.status');
Route::post('/devices/{id}/diagnostics/{sessionId}/lease', [DiagnosticViewerController::class, 'lease'])->whereNumber('id')->whereUuid('sessionId')->name('diagnostics.lease');
Route::post('/devices/{id}/diagnostics/{sessionId}/stop', [DiagnosticViewerController::class, 'stop'])->whereNumber('id')->whereUuid('sessionId')->name('diagnostics.stop');

Route::get('/devices/{id}/diagnostics/{sessionId}/preview', [DiagnosticViewerController::class, 'preview'])->whereNumber('id')->whereUuid('sessionId')->name('diagnostics.preview');
