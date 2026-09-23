<?php

namespace App\Support;

use App\Models\Snapshot;

/** Fixed fixture labels, not text collected from devices or supplied by requests. */
class SampleNodeLabels
{
    private const LABELS = [
        'title' => 'Research test page',
        'subtitle' => 'Synthetic fixture',
        'section' => 'Basic controls',
        'label_wifi' => 'Network connection',
        'label_notification' => 'Test notification',
        'input_label' => 'Test input field',
        'save' => 'Save test settings',
        'caption' => 'Synthetic interface sample',
    ];

    public static function forSnapshot(Snapshot $snapshot): array
    {
        if ($snapshot->source !== 'sample') {
            return [];
        }
        $labels = [];
        foreach ($snapshot->payload['windows'] as $window) {
            foreach ($window['nodes'] as $node) {
                if (($node['flags']['password'] ?? false) || ($node['flags']['sensitive'] ?? false) || ($node['flags']['editable'] ?? false)) {
                    continue;
                }
                foreach (self::LABELS as $id => $label) {
                    if (($node['view_id'] ?? null) === 'dev.boundarylab.fixture:id/'.$id) {
                        $labels[$window['id'].':'.$node['id']] = $label;
                    }
                }
            }
        }

        return $labels;
    }
}
