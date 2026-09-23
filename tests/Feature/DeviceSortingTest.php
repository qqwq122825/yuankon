<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\Snapshot;
use App\Support\DeviceTableSort;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DeviceSortingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
    }

    public function test_every_supported_column_sorts_in_both_directions(): void
    {
        foreach (array_keys(DeviceTableSort::COLUMNS) as $field) {
            foreach (['asc', 'desc'] as $direction) {
                $this->get('/?sort='.$field.'&direction='.$direction)->assertOk()
                    ->assertSee('aria-sort="'.($direction === 'asc' ? 'ascending' : 'descending').'"', false);
            }
        }
    }

    public function test_id_direction_and_numeric_battery_order(): void
    {
        $this->assertOrder('/?sort=id&direction=asc', [1, 2, 3, 4, 5, 6]);
        $this->assertOrder('/?sort=id&direction=desc', [6, 5, 4, 3, 2, 1]);
        $this->assertOrder('/?sort=battery&direction=asc', [6, 4, 5, 2, 1, 3]);
        $this->assertOrder('/?sort=battery&direction=desc', [3, 1, 2, 5, 4, 6]);
    }

    public function test_null_measurements_stay_last_and_equal_values_are_stable(): void
    {
        Device::find(6)->update(['battery' => null]);
        Device::find(5)->update(['battery' => 72]);
        $this->assertOrder('/?sort=battery&direction=asc', [4, 2, 5, 1, 3, 6]);
        $this->assertOrder('/?sort=battery&direction=desc', [3, 1, 2, 5, 4, 6]);
        $this->assertOrder('/?sort=last_seen&direction=desc', [1, 2, 3, 4, 5, 6]);
        $this->assertOrder('/?sort=last_seen&direction=asc', [5, 4, 3, 2, 1, 6]);
    }

    public function test_android_version_is_numeric_not_lexical(): void
    {
        Device::find(1)->update(['android_version' => '9']);
        Device::find(6)->update(['android_version' => '待记录']);
        $this->assertOrder('/?sort=android&direction=asc', [1, 2, 4, 5, 3, 6]);
        $this->assertOrder('/?sort=android&direction=desc', [3, 2, 4, 5, 1, 6]);
    }

    public function test_node_sort_uses_latest_snapshot_not_largest_old_value(): void
    {
        $old = Snapshot::where('device_id', 1)->first();
        $old->update(['node_count' => 999]);
        $latest = $old->replicate();
        $latest->node_count = 2;
        $latest->window_count = 0;
        $latest->save();
        $this->assertOrder('/?sort=nodes&direction=desc', [2, 3, 5, 1, 4, 6]);
        $this->assertOrder('/?sort=nodes&direction=asc', [4, 1, 2, 3, 5, 6]);
        $this->assertOrder('/?sort=windows&direction=asc', [1, 4, 2, 3, 5, 6]);
        $this->assertOrder('/?sort=snapshots&direction=desc', [1, 2, 3, 4, 5, 6]);
    }

    public function test_sorting_precedes_pagination_and_preserves_filters(): void
    {
        for ($i = 1; $i <= 14; $i++) {
            Device::create(['project_id' => 1, 'public_id' => 'EXTRA-'.$i, 'name' => 'Pixel Extra '.$i,
                'source' => 'sample', 'accessibility_enabled' => true, 'battery' => $i]);
        }
        $query = 'q=Pixel&source=sample&a11y=enabled&sort=battery&direction=asc';
        $response = $this->get('/?'.$query)->assertOk();
        $page = $response->viewData('devices');
        $this->assertSame(range(7, 16), $page->pluck('id')->all());
        $this->assertSame(15, $page->total());
        parse_str(parse_url($page->nextPageUrl(), PHP_URL_QUERY), $params);
        $this->assertSame(['q' => 'Pixel', 'source' => 'sample', 'a11y' => 'enabled', 'sort' => 'battery', 'direction' => 'asc', 'page' => '2'], $params);
        $second = $this->get('/?'.$query.'&page=2')->assertOk();
        $this->assertSame([17, 18, 19, 20, 1], $second->viewData('devices')->pluck('id')->all());
        // Heading links retain filters but omit page, and switch the active direction.
        $second->assertSee(route('devices.index', ['q' => 'Pixel', 'source' => 'sample', 'a11y' => 'enabled', 'sort' => 'battery', 'direction' => 'desc']));
        $second->assertSee('name="sort" value="battery"', false)->assertSee('name="direction" value="asc"', false);
    }

    public function test_invalid_sql_identifiers_and_directions_are_rejected(): void
    {
        $this->getJson('/?sort='.urlencode('battery; DROP TABLE devices'))->assertUnprocessable()->assertJsonValidationErrors('sort');
        $this->getJson('/?sort=battery&direction=sideways')->assertUnprocessable()->assertJsonValidationErrors('direction');
        $this->assertDatabaseCount('devices', 6);
    }

    private function assertOrder(string $url, array $expected): void
    {
        $this->assertSame($expected, $this->get($url)->assertOk()->viewData('devices')->pluck('id')->all());
    }
}
