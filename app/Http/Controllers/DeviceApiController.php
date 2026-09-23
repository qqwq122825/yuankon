<?php

namespace App\Http\Controllers;

use App\Models\Device;
use App\Models\DiagnosticSession;
use App\Services\DiagnosticSessions;
use App\Services\ScreenshotStore;
use App\Services\SnapshotNormalizer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

class DeviceApiController extends Controller
{
    public function heartbeat(Request $request)
    {
        $data = $request->validate([
            'schema_version' => 'required|integer|in:1', 'sequence' => 'required|integer|between:1,9007199254740991',
            'accessibility_enabled' => 'required|boolean', 'battery' => 'sometimes|nullable|integer|between:0,100',
        ]);
        $device = $request->user();
        Device::whereKey($device->id)->where('heartbeat_sequence', '<', $data['sequence'])->update([
            'heartbeat_sequence' => $data['sequence'], 'last_heartbeat_at' => now(),
            'accessibility_enabled' => $data['accessibility_enabled'], 'battery' => $data['battery'] ?? null,
        ]);

        return response()->json(['accepted_sequence' => $device->fresh()->heartbeat_sequence, 'server_time' => now()->toIso8601String(), 'heartbeat_interval_ms' => 1000]);
    }

    public function start(Request $request, DiagnosticSessions $sessions)
    {
        $data = $request->validate([
            'session_id' => 'required|uuid', 'consent_version' => 'required|in:visible-diagnostics-v1',
            'duration_seconds' => 'required|integer|between:10,900',
        ]);
        $device = $request->user();
        $session = DB::transaction(function () use ($device, $data, $sessions) {
            Device::whereKey($device->id)->lockForUpdate()->firstOrFail();
            if ($existing = DiagnosticSession::find($data['session_id'])) {
                abort_unless($existing->device_id === $device->id && $existing->project_id === $device->project_id, 404);

                return $existing;
            }
            foreach (DiagnosticSession::where('device_id', $device->id)->whereIn('status', ['waiting', 'active'])->get() as $old) {
                abort_if(in_array($sessions->refresh($old)->status, ['waiting', 'active']), 409, '已有诊断会话。');
            }
            $created = new DiagnosticSession([
                'project_id' => $device->project_id, 'device_id' => $device->id,
                'consent_version' => $data['consent_version'], 'expires_at' => now()->addSeconds($data['duration_seconds']),
            ]);
            $created->id = $data['session_id'];
            $created->save();

            return $created;
        });

        return response()->json($sessions->state($session), 201);
    }

    public function status(Request $request, string $id, DiagnosticSessions $sessions)
    {
        return response()->json($sessions->state($this->session($request, $id)));
    }

    public function stop(Request $request, string $id, DiagnosticSessions $sessions)
    {
        $session = $this->session($request, $id);
        $sessions->stop($session);

        return response()->json($sessions->state($session));
    }

    public function frame(Request $request, string $id, DiagnosticSessions $sessions, SnapshotNormalizer $normalizer, ScreenshotStore $images)
    {
        $session = $sessions->refresh($this->session($request, $id));
        abort_unless($session->status === 'active', 409, '诊断会话未激活或已经结束。');
        $data = $request->validate([
            'sequence' => 'required|integer|between:1,9007199254740991',
            'snapshot' => 'required|string|max:524288',
            'screenshot' => 'nullable|file|image|mimes:png,jpg,jpeg,webp|max:2048|dimensions:max_width=2560,max_height=2560',
        ]);
        try {
            $raw = json_decode($data['snapshot'], true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw ValidationException::withMessages(['snapshot' => '节点 JSON 格式错误。']);
        }
        abort_unless(is_array($raw), 422);
        $payload = $normalizer->normalize($raw);
        $path = $request->file('screenshot') ? $images->store($request->file('screenshot')) : null;
        $previous = null;
        try {
            $accepted = DB::transaction(function () use ($session, $sessions, $data, $payload, $path, &$previous) {
                $current = DiagnosticSession::whereKey($session->id)->lockForUpdate()->firstOrFail();
                abort_unless($current->status === 'active' && ! $sessions->expired($current), 409, '会话已过期。');
                if ($data['sequence'] <= $current->last_sequence) {
                    return false;
                }
                $previous = $current->snapshot()->value('screenshot_path');
                $current->snapshot()->updateOrCreate([], [
                    'project_id' => $current->project_id, 'device_id' => $current->device_id, 'source' => 'api',
                    'captured_at' => $payload['captured_at'], 'payload' => $payload,
                    'node_count' => array_sum(array_map(fn ($w) => count($w['nodes']), $payload['windows'])),
                    'window_count' => count($payload['windows']), 'screenshot_path' => $path,
                ]);
                $current->update(['last_sequence' => $data['sequence']]);
                $current->device()->update(['last_received_at' => now()]);

                return true;
            });
        } catch (\Throwable $e) {
            if ($path) {
                Storage::disk('local')->delete($path);
            }
            throw $e;
        }
        if (! $accepted && $path) {
            Storage::disk('local')->delete($path);
        }
        if ($accepted && $previous) {
            Storage::disk('local')->delete($previous);
        }

        return response()->json(['accepted' => $accepted, ...$sessions->state($session)]);
    }

    private function session(Request $request, string $id): DiagnosticSession
    {
        return DiagnosticSession::where('device_id', $request->user()->id)->where('project_id', $request->user()->project_id)->findOrFail($id);
    }
}
