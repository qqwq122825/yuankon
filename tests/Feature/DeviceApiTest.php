<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\DiagnosticSession;
use App\Models\Snapshot;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class DeviceApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
        Storage::fake('local');
        config(['cache.default' => 'array']);
    }

    private function device(int $project = 1): Device
    {
        return Device::create(['project_id' => $project, 'public_id' => 'TEST-'.Str::random(10), 'name' => 'API 联调设备', 'source' => 'api']);
    }

    private function authenticate(Device $device, array $abilities = ['diagnostics:write'], bool $expired = false): string
    {
        $token = $device->createToken('test', $abilities, $expired ? now()->subMinute() : now()->addHour())->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->withToken($token);

        return $token;
    }

    private function start(Device $device): string
    {
        $id = (string) Str::uuid();
        $this->postJson('/api/v1/diagnostics/sessions', ['session_id' => $id, 'consent_version' => 'visible-diagnostics-v1', 'duration_seconds' => 120])->assertCreated()->assertJsonPath('capture_allowed', false);

        return $id;
    }

    private function lease(Device $device, string $id, ?string $viewer = null)
    {
        return $this->postJson('/devices/'.$device->id.'/diagnostics/'.$id.'/lease', ['viewer_id' => $viewer ?? (string) Str::uuid()]);
    }

    private function frame(string $id, int $seq = 1, mixed $image = null)
    {
        $payload = json_decode(file_get_contents(resource_path('fixtures/example-snapshot.json')), true);
        $payload['windows'][0]['nodes'][0]['text'] = 'PRIVATE-CONTENT-NEVER-STORE';

        return $this->post('/api/v1/diagnostics/'.$id.'/frames', [
            'sequence' => $seq, 'snapshot' => json_encode($payload),
            'screenshot' => $image ?? UploadedFile::fake()->image('screen.jpg', 100, 200),
        ], ['Accept' => 'application/json']);
    }

    public function test_device_api_requires_a_valid_scoped_device_token(): void
    {
        $this->postJson('/api/v1/device/heartbeat', [])->assertUnauthorized();
        $device = $this->device();
        $this->authenticate($device, ['other']);
        $this->postJson('/api/v1/device/heartbeat', [])->assertForbidden();
        $this->authenticate($device, expired: true);
        $this->postJson('/api/v1/device/heartbeat', [])->assertUnauthorized();
        $this->authenticate(Device::first()); // Fixtures are not network clients.
        $this->postJson('/api/v1/device/heartbeat', [])->assertForbidden();
    }

    public function test_heartbeat_updates_only_token_device_and_old_sequences_do_not_extend_online(): void
    {
        $device = $this->device();
        $this->authenticate($device);
        $this->postJson('/api/v1/device/heartbeat', ['schema_version' => 1, 'sequence' => 5, 'accessibility_enabled' => true, 'battery' => 73, 'device_id' => 1, 'project_id' => 999])->assertOk();
        $this->assertTrue($device->fresh()->isOnline());
        $this->assertSame(73, $device->fresh()->battery);
        $this->assertNull(Device::find(1)->last_heartbeat_at);
        $time = $device->fresh()->last_heartbeat_at;
        $this->travel(20)->seconds();
        $this->postJson('/api/v1/device/heartbeat', ['schema_version' => 1, 'sequence' => 4, 'accessibility_enabled' => false])->assertOk()->assertJsonPath('accepted_sequence', 5);
        $this->assertFalse($device->fresh()->isOnline());
        $this->assertTrue($device->fresh()->last_heartbeat_at->equalTo($time));
        $this->assertTrue($device->fresh()->accessibility_enabled);
    }

    public function test_heartbeat_is_limited_per_device(): void
    {
        $device = $this->device();
        $this->authenticate($device);
        for ($i = 1; $i <= 90; $i++) {
            $this->postJson('/api/v1/device/heartbeat', ['schema_version' => 1, 'sequence' => $i, 'accessibility_enabled' => true])->assertOk();
        }
        $this->postJson('/api/v1/device/heartbeat', ['schema_version' => 1, 'sequence' => 91, 'accessibility_enabled' => true])->assertStatus(429);
    }

    public function test_capture_needs_phone_started_session_and_web_viewer_lease(): void
    {
        $device = $this->device();
        $this->authenticate($device);
        $this->postJson('/api/v1/diagnostics/sessions', ['session_id' => Str::uuid(), 'duration_seconds' => 120])->assertUnprocessable();
        $id = $this->start($device);
        $this->frame($id)->assertStatus(409);
        $viewer = (string) Str::uuid();
        $this->lease($device, $id, $viewer)->assertOk()->assertJsonPath('capture_allowed', true);
        $this->lease($device, $id)->assertStatus(409);
        $this->frame($id)->assertOk()->assertJsonPath('accepted', true);
        $snapshot = Snapshot::where('diagnostic_session_id', $id)->firstOrFail();
        $this->assertStringNotContainsString('PRIVATE-CONTENT', json_encode($snapshot->payload));
        $this->get('/devices/'.$device->id.'/diagnostics/'.$id.'/preview')->assertOk()->assertJsonPath('frame.id', $snapshot->id);
        $this->get('/devices/'.$device->id)->assertOk()->assertSee('连接已开启的诊断')->assertSee('设备 API');
        $this->get('/snapshots/'.$snapshot->id.'/image')->assertOk();
    }

    public function test_only_latest_frame_is_kept_and_sequences_are_idempotent(): void
    {
        $device = $this->device();
        $this->authenticate($device);
        $id = $this->start($device);
        $this->lease($device, $id)->assertOk();
        $this->frame($id, 2)->assertOk();
        $path = Snapshot::where('diagnostic_session_id', $id)->value('screenshot_path');
        $this->frame($id, 1)->assertOk()->assertJsonPath('accepted', false);
        $this->assertCount(1, Storage::disk('local')->allFiles('screenshots'));
        $this->frame($id, 3)->assertOk()->assertJsonPath('accepted', true);
        $this->assertSame(1, Snapshot::where('diagnostic_session_id', $id)->count());
        Storage::disk('local')->assertMissing($path);
        $this->assertCount(1, Storage::disk('local')->allFiles('screenshots'));
    }

    public function test_expired_lease_rejects_frames_and_discards_preview_even_with_fresh_heartbeat(): void
    {
        $device = $this->device();
        $this->authenticate($device);
        $id = $this->start($device);
        $this->lease($device, $id)->assertOk();
        $this->frame($id)->assertOk();
        $snapshot = Snapshot::where('diagnostic_session_id', $id)->first();
        $this->travel(11)->seconds();
        $this->postJson('/api/v1/device/heartbeat', ['schema_version' => 1, 'sequence' => 1, 'accessibility_enabled' => true])->assertOk();
        $this->getJson('/api/v1/diagnostics/'.$id)->assertOk()->assertJsonPath('status', 'expired')->assertJsonPath('capture_allowed', false);
        $this->frame($id, 2)->assertStatus(409);
        $this->lease($device, $id)->assertStatus(409);
        $this->get('/snapshots/'.$snapshot->id.'/image')->assertNotFound();
        $this->assertSame(0, Snapshot::where('diagnostic_session_id', $id)->count());
        $this->assertTrue($device->fresh()->isOnline());
    }

    public function test_stop_is_idempotent_and_prune_expires_waiting_sessions(): void
    {
        $device = $this->device();
        $this->authenticate($device);
        $id = $this->start($device);
        $this->postJson('/api/v1/diagnostics/'.$id.'/stop')->assertOk()->assertJsonPath('status', 'stopped');
        $this->postJson('/api/v1/diagnostics/'.$id.'/stop')->assertOk();
        $other = $this->start($device);
        $this->travel(31)->seconds();
        $this->artisan('diagnostics:prune')->assertSuccessful();
        $this->assertSame('expired', DiagnosticSession::find($other)->status);
    }

    public function test_foreign_device_and_project_cannot_access_sessions_or_preview(): void
    {
        DB::table('projects')->insert(['id' => 2, 'name' => 'Other']);
        $device = $this->device(2);
        $this->authenticate($device);
        $id = $this->start($device);
        $this->getJson('/devices/'.$device->id.'/diagnostics')->assertNotFound();
        $this->lease($device, $id)->assertNotFound();
        $this->getJson('/devices/'.$device->id.'/diagnostics/'.$id.'/preview')->assertNotFound();
        $this->authenticate($this->device());
        $this->getJson('/api/v1/diagnostics/'.$id)->assertNotFound();
        $this->postJson('/api/v1/diagnostics/'.$id.'/stop')->assertNotFound();
    }

    public function test_bad_images_and_json_are_rejected_without_storing_files(): void
    {
        $device = $this->device();
        $this->authenticate($device);
        $id = $this->start($device);
        $this->lease($device, $id)->assertOk();
        $this->frame($id, 1, UploadedFile::fake()->createWithContent('bad.jpg', '<script>not image</script>'))->assertUnprocessable();
        $this->postJson('/api/v1/diagnostics/'.$id.'/frames', ['sequence' => 1, 'snapshot' => '{'])->assertUnprocessable();
        $this->assertEmpty(Storage::disk('local')->allFiles('screenshots'));
    }

    public function test_remote_api_is_closed_by_default_and_requires_https_when_enabled(): void
    {
        $this->withServerVariables(['REMOTE_ADDR' => '192.0.2.8'])->postJson('/api/v1/device/heartbeat')->assertForbidden();
        config(['diagnostics.remote_api' => true]);
        $this->postJson('/api/v1/device/heartbeat')->assertForbidden();
        $this->postJson('https://localhost/api/v1/device/heartbeat')->assertUnauthorized();
        $this->app['env'] = 'production';
        $this->get('/')->assertStatus(503); // Device API switch never opens the admin console.
    }

    public function test_live_counts_use_heartbeat_not_snapshot_count(): void
    {
        $device = $this->device();
        $this->get('/')->assertOk()->assertViewHas('stats', fn ($stats) => $stats['online'] === 0);
        $device->update(['last_heartbeat_at' => now()]);
        $this->get('/')->assertViewHas('stats', fn ($stats) => $stats['online'] === 1);
        $this->get('/?source=api')->assertSee('API 联调设备')->assertDontSee('DEMO-001');
        $this->get('/devices/'.$device->id)->assertOk()->assertSee('diagnostic-controls')->assertSee('panel-nodes');
    }
}
