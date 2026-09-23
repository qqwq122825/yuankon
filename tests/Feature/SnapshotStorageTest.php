<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\Snapshot;
use App\Services\SnapshotImporter;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

// Internal fixture utility only; the web application has no manual upload endpoint.
class SnapshotStorageTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
    }

    public function test_internal_fixture_storage_strips_body_and_ignores_client_project(): void
    {
        $payload = $this->fixture();
        $payload['windows'][0]['nodes'][0]['text'] = 'SENSITIVE_SENTINEL';
        $payload['windows'][0]['nodes'][0]['content_description'] = 'SENSITIVE_SENTINEL';
        $payload['extras'] = ['input' => 'SENSITIVE_SENTINEL'];
        $snapshot = $this->store($payload, ['project_id' => 999]);
        $this->assertEquals(1, $snapshot->project_id);
        $this->assertStringNotContainsString('SENSITIVE_SENTINEL', json_encode($snapshot->payload));
        $this->assertDatabaseHas('lab_events', ['kind' => 'snapshot_imported']);
        $this->get('/devices/'.$snapshot->device_id)->assertOk();
        $this->assertEquals('import', $this->store($snapshot->payload)->source);
    }

    public function test_image_is_private_and_reencoded(): void
    {
        Storage::fake('local');
        $snapshot = $this->store($this->fixture(), [], UploadedFile::fake()->image('screen.jpg', 360, 760));
        Storage::disk('local')->assertExists($snapshot->screenshot_path);
        $this->assertStringEndsWith('.png', $snapshot->screenshot_path);
        $this->get('/snapshots/'.$snapshot->id.'/image')->assertOk()->assertHeader('Content-Type', 'image/png');
    }

    public function test_invalid_image_and_json_leave_no_partial_records(): void
    {
        foreach (['image', 'json'] as $case) {
            try {
                $file = UploadedFile::fake()->createWithContent('snapshot.json', $case === 'json' ? '{' : json_encode($this->fixture()));
                $image = $case === 'image' ? UploadedFile::fake()->createWithContent('bad.png', '<svg onload="alert(1)"></svg>') : null;
                app(SnapshotImporter::class)->import(['name' => 'Test'], $file, $image);
                $this->fail('Expected validation error.');
            } catch (ValidationException $e) {
                $this->assertArrayHasKey($case === 'image' ? 'screenshot_file' : 'snapshot_file', $e->errors());
            }
        }
        $this->assertDatabaseCount('snapshots', 5);
        $this->assertDatabaseCount('devices', 6);
    }

    public function test_fixture_file_size_limit_is_enforced(): void
    {
        $this->expectException(ValidationException::class);
        app(SnapshotImporter::class)->import(['name' => 'Test'], UploadedFile::fake()->create('large.json', 2049), null);
    }

    public function test_internal_utility_respects_project_ownership(): void
    {
        DB::table('projects')->insert(['id' => 2, 'name' => 'Other']);
        $device = Device::create(['project_id' => 2, 'public_id' => 'OTHER', 'name' => 'Other']);
        $this->expectException(ModelNotFoundException::class);
        $this->store($this->fixture(), ['device_id' => $device->id]);
    }

    private function fixture(): array
    {
        return json_decode(file_get_contents(resource_path('fixtures/example-snapshot.json')), true);
    }

    private function store(array $payload, array $attributes = [], ?UploadedFile $image = null): Snapshot
    {
        return app(SnapshotImporter::class)->import(['name' => 'Fixture'] + $attributes,
            UploadedFile::fake()->createWithContent('snapshot.json', json_encode($payload)), $image);
    }
}
