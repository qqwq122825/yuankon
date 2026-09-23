<?php

namespace Tests\Feature;

use App\Services\SnapshotNormalizer;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class SnapshotNormalizerTest extends TestCase
{
    public function test_cycle_is_rejected(): void
    {
        $data = $this->fixture();
        $data['windows'][0]['nodes'][0]['parent_id'] = 'n1';
        $this->expectException(ValidationException::class);
        app(SnapshotNormalizer::class)->normalize($data);
    }

    public function test_duplicate_node_is_rejected(): void
    {
        $data = $this->fixture();
        $data['windows'][0]['nodes'][] = $data['windows'][0]['nodes'][0];
        $this->expectException(ValidationException::class);
        app(SnapshotNormalizer::class)->normalize($data);
    }

    public function test_missing_parent_and_invalid_bounds_are_rejected(): void
    {
        foreach (['missing_parent', 'bounds'] as $case) {
            $data = $this->fixture();
            if ($case === 'bounds') {
                $data['windows'][0]['nodes'][0]['bounds'] = [20, 20, 10, 10];
            } else {
                $data['windows'][0]['nodes'][0]['parent_id'] = 'absent';
            }
            try {
                app(SnapshotNormalizer::class)->normalize($data);
                $this->fail('Invalid structure should fail.');
            } catch (ValidationException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_empty_windows_are_a_valid_observation(): void
    {
        $data = $this->fixture();
        $data['windows'] = [];
        $this->assertSame([], app(SnapshotNormalizer::class)->normalize($data)['windows']);
    }

    public function test_depth_and_total_node_limits(): void
    {
        foreach ([34, 2001] as $size) {
            $data = $this->fixture();
            $template = $data['windows'][0]['nodes'][0];
            $nodes = [];
            for ($i = 0; $i < $size; $i++) {
                $node = $template;
                $node['id'] = 'test-'.$i;
                $node['parent_id'] = $size === 34 && $i > 0 ? 'test-'.($i - 1) : null;
                $nodes[] = $node;
            }
            $data['windows'][0]['nodes'] = $nodes;
            try {
                app(SnapshotNormalizer::class)->normalize($data);
                $this->fail('Limit should be enforced.');
            } catch (ValidationException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    private function fixture(): array
    {
        return json_decode(file_get_contents(resource_path('fixtures/example-snapshot.json')), true);
    }
}
