<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\Snapshot;
use App\Models\TranslationSetting;
use App\Services\ReaderTranslation;
use App\Support\SampleNodeLabels;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class TranslationTest extends TestCase
{
    use RefreshDatabase;

    private const KEY = 'test-key-not-a-real-credential';

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
        Http::preventStrayRequests();
        Cache::flush();
    }

    public function test_settings_and_compact_reader_render_without_secrets(): void
    {
        $this->get('/settings/translation')->assertOk()->assertSee('尚未验证')->assertSee('Google Cloud Translation');
        $this->get('/devices/1')->assertOk()->assertSee('reader-translate')->assertSee('300</output>', false)
            ->assertSee('缩小阅读器')->assertSee('55%')->assertSee('翻译 API 配置')->assertDontSee('screenshot-zoom');
        Http::assertNothingSent();
    }

    public function test_save_encrypts_key_and_never_returns_it_to_browser_or_json(): void
    {
        $this->save();
        $setting = TranslationSetting::forProject();
        $this->assertEquals(self::KEY, $setting->api_key);
        $this->assertNotEquals(self::KEY, DB::table('translation_settings')->value('api_key'));
        $this->assertArrayNotHasKey('api_key', $setting->toArray());
        $this->get('/settings/translation')->assertOk()->assertSee('已加密保存')->assertDontSee(self::KEY);
        $this->get('/devices/1')->assertDontSee(self::KEY);
        $this->assertNull($setting->verified_at);
        Http::assertNothingSent();
    }

    public function test_invalid_key_and_language_are_rejected_without_flashing_key(): void
    {
        $this->from('/settings/translation')->put('/settings/translation', $this->input(['api_key' => "secret\r\nheader", 'target_language' => 'invalid']))
            ->assertSessionHasErrors(['api_key', 'target_language'])
            ->assertSessionMissing('_old_input.api_key');
        $this->assertDatabaseCount('translation_settings', 0);
        Http::assertNothingSent();
    }

    public function test_blank_key_preserves_secret_and_changed_settings_reset_verification(): void
    {
        $this->save();
        TranslationSetting::forProject()->update(['verified_at' => now()]);
        $revision = TranslationSetting::forProject()->revision;
        $this->save(['api_key' => '', 'target_language' => 'es']);
        $setting = TranslationSetting::forProject();
        $this->assertEquals(self::KEY, $setting->api_key);
        $this->assertNull($setting->verified_at);
        $this->assertNotEquals($revision, $setting->revision);
        Http::assertNothingSent();
    }

    public function test_verification_uses_fixed_text_and_header_key_with_fixed_endpoint(): void
    {
        Http::fake([ReaderTranslation::ENDPOINT => Http::response(['data' => ['translations' => [['translatedText' => '研究测试页']]]])]);
        $this->put('/settings/translation', $this->input(['action' => 'verify', 'base_url' => 'http://127.0.0.1/secret', 'text' => 'private']))
            ->assertRedirect('/settings/translation')->assertSessionHas('success');
        $this->assertNotNull(TranslationSetting::forProject()->verified_at);
        Http::assertSent(fn ($request) => $request->url() === ReaderTranslation::ENDPOINT
            && $request->hasHeader('X-Goog-Api-Key', self::KEY)
            && $request['q'] === ['Research test page'] && $request['model'] === 'nmt' && $request['format'] === 'text');
        Http::assertSentCount(1);
    }

    public function test_failed_verification_has_sanitized_message_and_no_stale_success(): void
    {
        $this->save();
        TranslationSetting::forProject()->update(['verified_at' => now()]);
        Http::fake([ReaderTranslation::ENDPOINT => Http::response(['error' => self::KEY], 403)]);
        $this->from('/settings/translation')->put('/settings/translation', $this->input(['action' => 'verify', 'api_key' => '']))
            ->assertSessionHasErrors('translation')->assertSessionMissing('_old_input.api_key')
            ->assertSessionHas('errors', fn ($errors) => str_contains($errors->first('translation'), 'HTTP 403') && ! str_contains($errors->first('translation'), self::KEY));
        $this->assertNull(TranslationSetting::forProject()->verified_at);
        $this->get('/settings/translation')->assertDontSee(self::KEY)->assertSee('尚未验证');
    }

    public function test_reader_sends_only_fixed_labels_caches_and_invalidates_after_change(): void
    {
        $this->save();
        $snapshot = Snapshot::findOrFail(1);
        $payload = $snapshot->payload;
        $payload['windows'][0]['nodes'][0]['text'] = 'SECRET-NEVER-SEND';
        $snapshot->update(['payload' => $payload]);
        $labels = SampleNodeLabels::forSnapshot($snapshot);
        Http::fake([ReaderTranslation::ENDPOINT => Http::response(['data' => ['translations' => array_fill(0, count($labels), ['translatedText' => '测试 &amp; 文本'])]])]);
        $this->postJson('/snapshots/1/translate')->assertOk()->assertJsonPath('labels.'.array_key_first($labels), '测试 & 文本');
        $this->postJson('/snapshots/1/translate')->assertOk();
        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => $request['q'] === array_values($labels) && ! str_contains($request->body(), 'SECRET-NEVER-SEND'));
        $this->save(['api_key' => '', 'target_language' => 'ja']);
        $this->postJson('/snapshots/1/translate')->assertOk()->assertJsonPath('target', 'ja');
        Http::assertSentCount(2);
    }

    public function test_disabled_missing_key_empty_and_non_sample_snapshots_do_not_call_provider(): void
    {
        $this->postJson('/snapshots/1/translate')->assertStatus(422);
        $this->put('/settings/translation', $this->input(['api_key' => '']))->assertSessionHasErrors('api_key');
        $this->assertDatabaseCount('translation_settings', 0);
        $this->flushSession();
        $this->save(['api_key' => '', 'enabled' => 0]);
        TranslationSetting::forProject()->update(['enabled' => true]);
        $this->postJson('/snapshots/1/translate')->assertUnprocessable()->assertJsonValidationErrors('translation');
        $this->save();
        $this->postJson('/snapshots/1/translate', ['texts' => ['PRIVATE']])->assertStatus(422);
        $this->postJson('/snapshots/4/translate')->assertStatus(422);
        Snapshot::findOrFail(1)->update(['source' => 'import']);
        $this->postJson('/snapshots/1/translate')->assertStatus(422);
        $this->save(['enabled' => 0]);
        $this->postJson('/snapshots/2/translate')->assertStatus(422);
        Http::assertNothingSent();
    }

    public function test_sensitive_flags_remove_labels_from_translation_catalog(): void
    {
        $snapshot = Snapshot::findOrFail(1);
        $payload = $snapshot->payload;
        foreach ($payload['windows'] as &$window) {
            foreach ($window['nodes'] as &$node) {
                $node['flags']['password'] = true;
            }
        }
        $snapshot->payload = $payload;
        $this->assertSame([], SampleNodeLabels::forSnapshot($snapshot));
    }

    public function test_network_errors_and_malformed_results_do_not_get_cached(): void
    {
        $this->save();
        Http::fake([ReaderTranslation::ENDPOINT => Http::failedConnection()]);
        $this->postJson('/snapshots/1/translate')->assertUnprocessable()->assertJsonValidationErrors('translation');
        Http::fake([ReaderTranslation::ENDPOINT => Http::response(['data' => ['translations' => []]])]);
        $this->postJson('/snapshots/1/translate')->assertUnprocessable()->assertJsonValidationErrors('translation');
    }

    public function test_foreign_snapshot_and_settings_are_isolated_and_delete_clears_current_config(): void
    {
        $this->save();
        DB::table('projects')->insert(['id' => 2, 'name' => 'Other']);
        $other = TranslationSetting::create(['project_id' => 2, 'api_key' => 'other-key', 'revision' => 'other-revision', 'enabled' => true]);
        $device = Device::create(['project_id' => 2, 'public_id' => 'OTHER', 'name' => 'Other']);
        $snapshot = $device->snapshots()->create(['project_id' => 2, 'source' => 'sample', 'captured_at' => now(), 'node_count' => 0, 'window_count' => 0, 'payload' => []]);
        $this->postJson('/snapshots/'.$snapshot->id.'/translate')->assertNotFound();
        $this->delete('/settings/translation')->assertRedirect('/settings/translation');
        $this->assertDatabaseMissing('translation_settings', ['project_id' => 1]);
        $this->assertNotNull($other->fresh());
        $this->postJson('/snapshots/1/translate')->assertStatus(422);
        Http::assertNothingSent();
    }

    private function input(array $overrides = []): array
    {
        return array_replace(['enabled' => 1, 'api_key' => self::KEY, 'target_language' => 'zh-CN', 'action' => 'save'], $overrides);
    }

    private function save(array $overrides = []): void
    {
        $this->put('/settings/translation', $this->input($overrides))->assertRedirect('/settings/translation')->assertSessionHasNoErrors();
    }
}
