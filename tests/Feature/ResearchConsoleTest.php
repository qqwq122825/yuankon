<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\Snapshot;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ResearchConsoleTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
    }

    public function test_all_first_version_pages_render(): void
    {
        foreach (['/', '/devices/1', '/devices/4', '/devices/6', '/snapshots', '/events', '/builds', '/guide'] as $url) {
            $this->get($url)->assertOk()->assertSee('Boundary Lab');
        }
        $this->get('/')->assertSee('示例数据')->assertSee('DEMO-001');
        $this->get('/devices/1')->assertSee('无障碍调试')->assertSee('查看截图');
    }

    public function test_compact_layout_and_reusable_viewers_are_present(): void
    {
        $this->get('/')->assertSee('console-fleet')->assertSee('fleet-table')->assertSee('选择当前页设备');
        $this->get('/devices/1')->assertSee('device-workbench')->assertSee('开始检查')
            ->assertSee('panel-screenshot')->assertSee('panel-nodes')->assertSee('data-workbench-view="observations"', false)
            ->assertSee('DEMO-PWD-001')->assertSee('DEMO-SMS-001');
        $this->get('/devices/6')->assertSee('还没有可查看的快照')->assertDontSee('id="snapshot-data"', false);
    }

    public function test_search_and_empty_state(): void
    {
        $this->get('/?q=Pixel')->assertOk()->assertSee('Pixel 8')->assertDontSee('Galaxy S23');
        $this->get('/?q=does-not-exist')->assertOk()->assertSee('没有匹配的设备');
        $this->get('/?source=import')->assertOk()->assertSee('没有匹配的设备');
    }

    public function test_main_sidebar_only_has_devices_builds_and_translation(): void
    {
        foreach (['/' => '设备', '/builds' => '构建', '/settings/translation' => '翻译'] as $path => $active) {
            $response = $this->get($path)->assertOk();
            $document = new \DOMDocument;
            @$document->loadHTML('<?xml encoding="UTF-8">'.$response->getContent());
            $xpath = new \DOMXPath($document);
            $links = $xpath->query('//nav[@aria-label="主导航"]/a');
            $this->assertSame(3, $links->length);
            $this->assertSame(['设备', '构建', '翻译'], array_map(fn ($link) => trim($link->textContent), iterator_to_array($links)));
            $current = $xpath->query('//nav[@aria-label="主导航"]/a[@aria-current="page"]');
            $this->assertSame(1, $current->length);
            $this->assertSame($active, trim($current->item(0)->textContent));
        }
    }

    public function test_header_has_daily_groups_and_does_not_present_snapshots_as_live_statistics(): void
    {
        $response = $this->get('/?q=Pixel')->assertOk()
            ->assertSee('在线设备')->assertSee('设备总数')->assertSee('今日统计')->assertSee('昨日统计')
            ->assertDontSee('结构快照')->assertViewHas('stats', fn ($stats) => $stats['devices'] === 6 && $stats['online'] === null);
        $document = new \DOMDocument;
        @$document->loadHTML('<?xml encoding="UTF-8">'.$response->getContent());
        $xpath = new \DOMXPath($document);
        $metrics = $xpath->query('//header//*[@data-header-metric]');
        $this->assertSame(8, $metrics->length);
        foreach ($metrics as $metric) {
            $this->assertSame($metric->getAttribute('data-header-metric') === 'devices' ? '6' : '—', trim($metric->textContent));
        }
        $this->assertSame(0, $xpath->query('//header//*[contains(@class,"header-summary")]')->length);
    }

    public function test_notes_persist_and_are_escaped(): void
    {
        $this->patch('/devices/1/note', ['note' => '<script>alert(1)</script>'])->assertRedirect();
        $this->assertDatabaseHas('devices', ['id' => 1, 'note' => '<script>alert(1)</script>']);
        $this->get('/devices/1')->assertSee('&lt;script&gt;', false)->assertDontSee('<script>alert(1)</script>', false);
        $this->patch('/devices/1/note', ['note' => str_repeat('a', 201)])->assertSessionHasErrors('note');
    }

    public function test_json_export_and_example_download(): void
    {
        $this->get('/snapshots/1/export')->assertOk()->assertDownload('snapshot-1.json');
        $this->get('/example-snapshot')->assertOk()->assertDownload('example-snapshot.json');
        $this->get('/snapshots/1/image')->assertOk()->assertHeader('Content-Type', 'image/svg+xml');
        $this->get('/snapshots/4/image')->assertNotFound();
    }

    public function test_manual_upload_entry_points_are_removed(): void
    {
        foreach (['/', '/devices/1', '/devices/6', '/snapshots', '/guide', '/builds'] as $path) {
            $this->get($path)->assertOk()->assertDontSee('href="'.url('/imports').'"', false)
                ->assertDontSee('action="'.url('/imports').'"', false);
        }
        $this->get('/imports')->assertNotFound();
        $this->post('/imports', [])->assertNotFound();
    }

    public function test_foreign_project_resources_are_isolated(): void
    {
        DB::table('projects')->insert(['id' => 2, 'name' => 'Other']);
        $device = Device::create(['project_id' => 2, 'public_id' => 'OTHER-DEVICE', 'name' => 'Other device']);
        $snapshot = $device->snapshots()->create(['project_id' => 2, 'source' => 'import', 'captured_at' => now(), 'node_count' => 0, 'window_count' => 0, 'payload' => $this->fixture()]);
        $this->get('/devices/'.$device->id)->assertNotFound();
        $this->patch('/devices/'.$device->id.'/note', ['note' => 'x'])->assertNotFound();
        $this->get('/snapshots/'.$snapshot->id.'/export')->assertNotFound();
        $this->get('/snapshots/'.$snapshot->id.'/image')->assertNotFound();
        $this->get('/devices/1?snapshot='.$snapshot->id)->assertNotFound();
        $this->get('/')->assertDontSee('OTHER-DEVICE');
    }

    public function test_network_preview_and_production_are_blocked(): void
    {
        $this->withServerVariables(['REMOTE_ADDR' => '192.0.2.25'])->get('/')->assertForbidden();
        $this->withServerVariables(['REMOTE_ADDR' => '127.0.0.1'])->withHeader('X-Forwarded-For', '192.0.2.25')->get('/')->assertForbidden();
        $this->flushHeaders();
        $this->app['env'] = 'production';
        $this->get('/')->assertStatus(503);
    }

    public function test_seeding_twice_preserves_notes_and_record_counts(): void
    {
        Device::first()->update(['note' => 'keep my note']);
        $this->seed();
        $this->assertEquals(6, Device::count());
        $this->assertEquals(5, Snapshot::count());
        $this->assertEquals('keep my note', Device::first()->note);
    }

    private function fixture(): array
    {
        return json_decode(file_get_contents(resource_path('fixtures/example-snapshot.json')), true);
    }
}
