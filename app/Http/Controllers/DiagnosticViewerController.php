<?php

namespace App\Http\Controllers;

use App\Models\Device;
use App\Models\DiagnosticSession;
use App\Services\DiagnosticSessions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DiagnosticViewerController extends Controller
{
    public function status(int $id, DiagnosticSessions $sessions)
    {
        $device = Device::where('project_id', config('lab.project_id'))->findOrFail($id);
        $session = DiagnosticSession::where('device_id', $id)->where('project_id', $device->project_id)->latest()->first();

        return response()->json(['online' => $device->isOnline(), 'last_heartbeat_at' => $device->last_heartbeat_at?->toIso8601String(), 'session' => $session ? $sessions->state($session) : null]);
    }

    public function preview(int $id, string $sessionId, DiagnosticSessions $sessions)
    {
        $session = DiagnosticSession::where('project_id', config('lab.project_id'))->where('device_id', $id)->findOrFail($sessionId);
        $state = $sessions->state($session);
        abort_unless($state['capture_allowed'], 409);
        $snapshot = $session->snapshot()->first();

        return response()->json(['state' => $state, 'frame' => $snapshot ? ['id' => $snapshot->id, 'payload' => $snapshot->payload, 'image_url' => $snapshot->screenshot_path ? route('snapshots.image', $snapshot->id).'?sequence='.$session->last_sequence : null] : null]);
    }

    public function lease(Request $request, int $id, string $sessionId, DiagnosticSessions $sessions)
    {
        $data = $request->validate(['viewer_id' => 'required|uuid']);
        $session = DiagnosticSession::where('project_id', config('lab.project_id'))->where('device_id', $id)->findOrFail($sessionId);
        $session = $sessions->refresh($session);
        abort_unless(in_array($session->status, ['waiting', 'active']), 409);
        DB::transaction(function () use ($session, $sessions, $data) {
            $current = DiagnosticSession::whereKey($session->id)->lockForUpdate()->firstOrFail();
            abort_unless(in_array($current->status, ['waiting', 'active']) && ! $sessions->expired($current), 409);
            $hash = hash('sha256', $data['viewer_id']);
            abort_if($current->viewer_hash && ! hash_equals($current->viewer_hash, $hash), 409, '诊断正由另一个页面查看。');
            $current->update(['status' => 'active', 'viewer_hash' => $hash, 'lease_expires_at' => min(now()->addSeconds(config('diagnostics.lease_seconds')), $current->expires_at)]);
        });

        return response()->json($sessions->state($session));
    }

    public function stop(int $id, string $sessionId, DiagnosticSessions $sessions)
    {
        $session = DiagnosticSession::where('project_id', config('lab.project_id'))->where('device_id', $id)->findOrFail($sessionId);
        $sessions->stop($session);

        return response()->json($sessions->state($session));
    }
}
