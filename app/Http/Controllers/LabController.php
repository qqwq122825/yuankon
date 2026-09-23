<?php

namespace App\Http\Controllers;

use App\Models\Device;
use App\Models\DiagnosticSession;
use App\Models\LabEvent;
use App\Models\Snapshot;
use App\Services\DiagnosticSessions;
use App\Support\DeviceTableSort;
use App\Support\SampleNodeLabels;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class LabController extends Controller
{
    public function index(Request $request)
    {
        $validated = $request->validate([
            'q' => 'nullable|string|max:100', 'source' => 'nullable|in:sample,import,api', 'a11y' => 'nullable|in:enabled,disabled',
            'sort' => ['sometimes', 'required', Rule::in(array_keys(DeviceTableSort::COLUMNS))],
            'direction' => 'sometimes|required|in:asc,desc',
        ]);
        $filters = array_intersect_key($validated, array_flip(['q', 'source', 'a11y']));
        $sorting = ['sort' => $validated['sort'] ?? 'id', 'direction' => $validated['direction'] ?? 'asc'];
        $query = $this->devices()->withCount('snapshots')->with('latestSnapshot');
        if ($q = trim($filters['q'] ?? '')) {
            $query->where(fn ($query) => $query->where('name', 'like', '%'.$q.'%')->orWhere('public_id', 'like', '%'.$q.'%')->orWhere('note', 'like', '%'.$q.'%')->orWhere('brand', 'like', '%'.$q.'%'));
        }
        if ($source = $filters['source'] ?? null) {
            $query->where('source', $source);
        }
        if ($a11y = $filters['a11y'] ?? null) {
            $query->where('accessibility_enabled', $a11y === 'enabled');
        }

        return view('devices.index', [
            'devices' => DeviceTableSort::apply($query, $sorting['sort'], $sorting['direction'])->paginate(10)->appends([...$filters, ...$sorting]),
            'sorting' => $sorting,
            'stats' => [
                'devices' => $this->devices()->count(),
                // A saved snapshot is not a heartbeat or an installation/state-change event.
                'online' => $this->devices()->where('source', 'api')->exists() ? $this->devices()->where('source', 'api')->where('last_heartbeat_at', '>', now()->subSeconds(config('diagnostics.online_seconds')))->count() : null,
                'periods' => [
                    ['key' => 'today', 'label' => '今日', 'installed' => null, 'offline' => null, 'accessibility' => null],
                    ['key' => 'yesterday', 'label' => '昨日', 'installed' => null, 'offline' => null, 'accessibility' => null],
                ],
            ], 'filters' => $filters,
        ]);
    }

    public function show(Request $request, int $id)
    {
        $device = $this->devices()->withCount('snapshots')->findOrFail($id);
        foreach (DiagnosticSession::where('device_id', $id)->where('project_id', $device->project_id)->whereIn('status', ['waiting', 'active'])->get() as $session) {
            app(DiagnosticSessions::class)->refresh($session);
        }
        $snapshotId = $request->validate(['snapshot' => 'nullable|integer|min:1'])['snapshot'] ?? null;
        $snapshots = $device->snapshots()->where('project_id', config('lab.project_id'))->orderByDesc('id');
        $snapshot = $snapshotId ? (clone $snapshots)->findOrFail($snapshotId) : (clone $snapshots)->first();

        return view('devices.show', [
            'device' => $device, 'snapshot' => $snapshot,
            'viewerSnapshot' => $snapshot ?? ($device->source === 'api' ? new Snapshot(['id' => 0, 'source' => 'api', 'node_count' => 0, 'window_count' => 0, 'payload' => ['schema_version' => 1, 'display' => ['width' => 1080, 'height' => 1920], 'windows' => []]]) : null),
            'readerLabels' => $snapshot ? SampleNodeLabels::forSnapshot($snapshot) : [],
            'snapshots' => $snapshots->limit(50)->get(),
            'events' => $device->events()->where('project_id', config('lab.project_id'))->latest('occurred_at')->limit(8)->get(),
        ]);
    }

    public function note(Request $request, int $id)
    {
        $device = $this->devices()->findOrFail($id);
        $validated = $request->validate(['note' => 'nullable|string|max:200']);
        $device->update(['note' => $validated['note'] ?? '']);

        return back()->with('success', '设备备注已保存。');
    }

    public function archive()
    {
        return view('snapshots.index', ['snapshots' => Snapshot::where('project_id', config('lab.project_id'))->with('device')->latest('id')->paginate(12)]);
    }

    public function events()
    {
        return view('events.index', ['events' => LabEvent::where('project_id', config('lab.project_id'))->with('device')->latest('occurred_at')->paginate(15)]);
    }

    public function export(int $id)
    {
        $snapshot = $this->snapshot($id);

        return response()->streamDownload(function () use ($snapshot) {
            echo json_encode($snapshot->payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }, 'snapshot-'.$id.'.json', ['Content-Type' => 'application/json; charset=utf-8']);
    }

    public function screenshot(int $id)
    {
        $snapshot = $this->snapshot($id);
        abort_unless($snapshot->screenshot_path, 404);
        if ($snapshot->source === 'sample' && $snapshot->screenshot_path === 'demo:settings') {
            return response()->file(resource_path('fixtures/settings.svg'), ['Content-Type' => 'image/svg+xml']);
        }
        abort_unless(str_starts_with($snapshot->screenshot_path, 'screenshots/') && Storage::disk('local')->exists($snapshot->screenshot_path), 404);

        return response()->file(Storage::disk('local')->path($snapshot->screenshot_path), ['Content-Type' => 'image/png']);
    }

    private function snapshot(int $id): Snapshot
    {
        $snapshot = Snapshot::where('project_id', config('lab.project_id'))->whereHas('device', fn ($q) => $q->where('project_id', config('lab.project_id')))->findOrFail($id);
        if ($snapshot->diagnostic_session_id) {
            $session = DiagnosticSession::findOrFail($snapshot->diagnostic_session_id);
            abort_unless(app(DiagnosticSessions::class)->refresh($session)->status === 'active', 404);
        }

        return $snapshot;
    }

    private function devices()
    {
        return Device::where('project_id', config('lab.project_id'));
    }
}
