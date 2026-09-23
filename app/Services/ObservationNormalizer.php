<?php

namespace App\Services;

use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class ObservationNormalizer
{
    public function normalize(array $observations): array
    {
        Validator::make(['observations' => $observations], [
            'observations' => 'array|list|max:100',
            'observations.*.scenario' => 'required|in:password_field,sms_ui,sms_notification,sms_permission',
            'observations.*.case_id' => ['required', 'string', 'max:60', 'regex:/^[A-Za-z0-9_-]+$/'],
            'observations.*.channel' => 'required|in:accessibility_node,accessibility_event,notification_listener,sms_permission',
            'observations.*.event_type' => 'required|in:manual_probe,TYPE_VIEW_TEXT_CHANGED,TYPE_WINDOW_CONTENT_CHANGED,TYPE_NOTIFICATION_STATE_CHANGED',
            'observations.*.fixture' => 'required|in:synthetic',
            'observations.*.password_flag' => 'present|nullable|boolean',
            'observations.*.sensitive_flag' => 'present|nullable|boolean',
            'observations.*.text_returned' => 'present|nullable|boolean',
            'observations.*.synthetic_match' => 'required|in:match,mismatch,not_tested',
        ])->validate();

        $channels = [
            'password_field' => ['accessibility_node', 'accessibility_event'],
            'sms_ui' => ['accessibility_node', 'accessibility_event'],
            'sms_notification' => ['accessibility_event', 'notification_listener'],
            'sms_permission' => ['sms_permission'],
        ];
        foreach ($observations as $item) {
            if (! in_array($item['channel'], $channels[$item['scenario']], true)
                || ($item['synthetic_match'] !== 'not_tested' && ! $item['text_returned'])) {
                throw ValidationException::withMessages(['observations' => '请核对测试场景、访问通道与文本匹配结果的一致性。']);
            }
        }

        return array_map(fn ($observation) => [
            'scenario' => $observation['scenario'], 'case_id' => $observation['case_id'],
            'channel' => $observation['channel'], 'event_type' => $observation['event_type'],
            'fixture' => 'synthetic', 'password_flag' => $this->flag($observation['password_flag']),
            'sensitive_flag' => $this->flag($observation['sensitive_flag']),
            'text_returned' => $this->flag($observation['text_returned']),
            'synthetic_match' => $observation['synthetic_match'], 'evidence' => 'client_reported',
        ], $observations);
    }

    private function flag(mixed $value): ?bool
    {
        return $value === null ? null : (bool) $value;
    }
}
