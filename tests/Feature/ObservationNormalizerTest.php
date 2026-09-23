<?php

namespace Tests\Feature;

use App\Services\ObservationNormalizer;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class ObservationNormalizerTest extends TestCase
{
    public function test_only_synthetic_visibility_metadata_survives(): void
    {
        $result = app(ObservationNormalizer::class)->normalize([$this->observation() + ['text' => 'RAW_SECRET', 'sms_body' => 'RAW_SECRET', 'password_hash' => 'HASH_SECRET']]);
        $this->assertStringNotContainsString('SECRET', json_encode($result));
        $this->assertSame('client_reported', $result[0]['evidence']);
        $this->assertTrue($result[0]['password_flag']);
    }

    public function test_actual_secret_fixture_type_is_not_accepted(): void
    {
        $item = $this->observation();
        $item['fixture'] = 'real_credentials';
        $this->expectException(ValidationException::class);
        app(ObservationNormalizer::class)->normalize([$item]);
    }

    public function test_mismatched_channel_is_rejected(): void
    {
        $item = $this->observation();
        $item['channel'] = 'sms_permission';
        $this->expectException(ValidationException::class);
        app(ObservationNormalizer::class)->normalize([$item]);
    }

    public function test_match_result_requires_returned_text(): void
    {
        $item = $this->observation();
        $item['synthetic_match'] = 'match';
        $this->expectException(ValidationException::class);
        app(ObservationNormalizer::class)->normalize([$item]);
    }

    private function observation(): array
    {
        return ['scenario' => 'password_field', 'case_id' => 'PWD-001', 'channel' => 'accessibility_event',
            'event_type' => 'TYPE_VIEW_TEXT_CHANGED', 'fixture' => 'synthetic', 'password_flag' => true,
            'sensitive_flag' => null, 'text_returned' => false, 'synthetic_match' => 'not_tested'];
    }
}
