<?php

namespace Tests\Feature;

use App\Jobs\BuildApk;
use App\Models\ApkBuild;
use App\Models\BuildBot;
use App\Services\ApkBuilder;
use App\Services\BuildConversation;
use App\Services\TelegramApi;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class BuildBotTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = '123456:FAKE_TEST_TOKEN';

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
        Http::preventStrayRequests();
        Queue::fake();
        Storage::fake('local');
    }

    private function bot(array $data = []): BuildBot
    {
        return BuildBot::create(array_replace(['project_id' => 1, 'token' => self::TOKEN, 'username' => 'test_build_bot', 'owner_id' => '100'], $data));
    }

    private function message(BuildBot $bot, string $text, int $id = 1, string $chat = '100'): void
    {
        app(BuildConversation::class)->handle($bot->fresh(), ['update_id' => $id, 'message' => ['text' => $text, 'chat' => ['id' => $chat, 'type' => 'private'], 'from' => ['is_bot' => false]]]);
    }

    private function api(): void
    {
        Http::fake(['https://api.telegram.org/*' => Http::response(['ok' => true, 'result' => ['message_id' => 42]])]);
    }

    public function test_bot_configuration_is_encrypted_and_never_echoes_token(): void
    {
        Http::fake(['https://api.telegram.org/*/getMe' => Http::response(['ok' => true, 'result' => ['is_bot' => true, 'username' => 'test_build_bot']])]);
        $this->post('/builds/bot', ['bot_token' => self::TOKEN])->assertRedirect('/builds');
        $this->assertNotEquals(self::TOKEN, DB::table('build_bots')->value('token'));
        $this->assertSame(self::TOKEN, BuildBot::current()->token);
        $this->assertArrayNotHasKey('token', BuildBot::current()->toArray());
        $this->get('/builds')->assertOk()->assertSee('@test_build_bot')->assertDontSee(self::TOKEN);
        $this->from('/builds')->post('/builds/bot', ['bot_token' => 'bad secret'])->assertSessionHasErrors('bot_token')->assertSessionMissing('_old_input.bot_token');
    }

    public function test_pair_code_is_one_time_and_only_owner_can_build(): void
    {
        $this->api();
        $bot = $this->bot(['owner_id' => null, 'pair_hash' => hash('sha256', 'PAIR'), 'pair_expires_at' => now()->addMinutes(30)]);
        $this->message($bot, '/start pair_WRONG');
        $this->assertNull($bot->fresh()->owner_id);
        Http::assertNothingSent();
        $this->message($bot, '/start pair_PAIR');
        $this->assertSame('100', $bot->fresh()->owner_id);
        $this->assertNull($bot->fresh()->pair_hash);
        $this->message($bot, '/build', 2, '200');
        $this->assertNull($bot->fresh()->conversation);
        Queue::assertNothingPushed();
        $this->post('/builds/pair')->assertStatus(409);
    }

    public function test_expired_pairing_does_not_grant_access(): void
    {
        $bot = $this->bot(['owner_id' => null, 'pair_hash' => hash('sha256', 'PAIR'), 'pair_expires_at' => now()->subMinute()]);
        $this->message($bot, '/start pair_PAIR');
        $this->assertNull($bot->fresh()->owner_id);
        Http::assertNothingSent();
    }

    public function test_conversation_queues_once_after_name_icon_url_and_confirmation(): void
    {
        $this->api();
        $bot = $this->bot();
        foreach (['/start build', '测试浏览器', '/default', 'https://example.com/?a=1&b=2', '/confirm'] as $i => $text) {
            $this->message($bot, $text, $i + 1);
        }
        $this->assertDatabaseCount('apk_builds', 1);
        $build = ApkBuild::first();
        $this->assertSame('测试浏览器', $build->app_name);
        $this->assertSame('https://example.com/?a=1&b=2', $build->home_url);
        $this->assertNull($bot->fresh()->conversation);
        Queue::assertPushed(BuildApk::class, 1);
        $this->message($bot, '/confirm', 5);
        Queue::assertPushed(BuildApk::class, 1);
    }

    public function test_name_and_url_validation_keep_conversation_at_same_step(): void
    {
        $this->api();
        $bot = $this->bot();
        $this->message($bot, '/build');
        $this->message($bot, str_repeat('x', 41));
        $this->assertSame('name', $bot->fresh()->conversation['step']);
        $this->message($bot, 'Test');
        $this->message($bot, '/default');
        foreach (['javascript:alert(1)', 'http://example.com', 'https://user:secret@example.com/'] as $url) {
            $this->message($bot, $url);
        }
        $this->assertSame('url', $bot->fresh()->conversation['step']);
        Queue::assertNothingPushed();
        $this->message($bot, '/cancel');
        $this->assertNull($bot->fresh()->conversation);
    }

    public function test_successful_job_sends_document_and_persists_delivery_result(): void
    {
        $this->api();
        $this->bot();
        $build = ApkBuild::create(['project_id' => 1, 'chat_id' => '100', 'app_name' => 'Test', 'home_url' => 'https://example.com']);
        Storage::disk('local')->put('test.apk', 'TEST FIXTURE NOT AN INSTALLABLE APK');
        $builder = $this->mock(ApkBuilder::class);
        $builder->shouldReceive('build')->once()->andReturn(['artifact_path' => 'test.apk', 'sha256' => str_repeat('a', 64), 'size' => 34]);
        (new BuildApk($build->id))->handle($builder, app(TelegramApi::class));
        $this->assertSame('succeeded', $build->fresh()->status);
        $this->assertSame('sent', $build->fresh()->delivery_status);
        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/sendDocument') && $r->hasFile('document', null, 'browser.apk') && collect($r->data())->contains(fn ($part) => $part['name'] === 'chat_id' && $part['contents'] === '100'));
        $this->get('/builds/'.$build->id.'/artifact')->assertOk()->assertDownload();
        $this->assertGreaterThan((new BuildApk($build->id))->timeout, config('queue.connections.database.retry_after'));
    }

    public function test_failed_build_does_not_send_an_apk_or_leak_internal_error(): void
    {
        $this->api();
        $this->bot();
        $build = ApkBuild::create(['project_id' => 1, 'chat_id' => '100', 'app_name' => 'Test', 'home_url' => 'https://example.com']);
        $builder = $this->mock(ApkBuilder::class);
        $builder->shouldReceive('build')->andThrow(new \RuntimeException('secret-internal-error'));
        (new BuildApk($build->id))->handle($builder, app(TelegramApi::class));
        $this->assertSame('failed', $build->fresh()->status);
        $this->get('/builds/'.$build->id.'/artifact')->assertNotFound();
        Http::assertNotSent(fn ($r) => str_ends_with($r->url(), '/sendDocument') || str_contains($r->body(), 'secret-internal-error'));
    }

    public function test_icon_is_reencoded(): void
    {
        $png = imagecreatetruecolor(2, 2);
        ob_start();
        imagepng($png);
        $body = ob_get_clean();
        imagedestroy($png);
        Http::fake(['https://api.telegram.org/bot*/getFile' => Http::response(['ok' => true, 'result' => ['file_path' => 'photos/icon.jpg', 'file_size' => strlen($body)]]), 'https://api.telegram.org/file/*' => Http::response($body)]);
        $path = app(TelegramApi::class)->icon(self::TOKEN, 'FILE');
        $size = getimagesize(Storage::disk('local')->path($path));
        $this->assertSame([512, 512], [$size[0], $size[1]]);
    }

    public function test_icon_rejects_unexpected_file_path(): void
    {
        Http::fake(['https://api.telegram.org/bot*/getFile' => Http::response(['ok' => true, 'result' => ['file_path' => '../unsafe']])]);
        $this->expectException(\RuntimeException::class);
        app(TelegramApi::class)->icon(self::TOKEN, 'BAD');
    }

    public function test_icon_rejects_non_image_bytes(): void
    {
        Http::fake(['https://api.telegram.org/bot*/getFile' => Http::response(['ok' => true, 'result' => ['file_path' => 'documents/icon.png', 'file_size' => 8]]), 'https://api.telegram.org/file/*' => Http::response('notimage')]);
        $this->expectException(\RuntimeException::class);
        app(TelegramApi::class)->icon(self::TOKEN, 'BAD');
    }

    public function test_builds_and_artifacts_are_project_scoped(): void
    {
        DB::table('projects')->insert(['id' => 2, 'name' => 'Other']);
        $build = ApkBuild::create(['project_id' => 2, 'app_name' => 'Foreign', 'home_url' => 'https://example.com']);
        $this->get('/builds')->assertDontSee('Foreign');
        $this->get('/builds/'.$build->id.'/artifact')->assertNotFound();
        $this->get('/builds/'.$build->id.'/log')->assertNotFound();
    }

    public function test_android_template_defaults_to_baidu_homepage(): void
    {
        $xml = simplexml_load_file(base_path('android-shell/app/src/main/res/values/strings.xml'));
        $this->assertSame('https://www.baidu.com', (string) $xml->xpath('/resources/string[@name="home_url"]')[0]);
    }

    public function test_android_template_only_requests_internet_permission(): void
    {
        $xml = simplexml_load_file(base_path('android-shell/app/src/main/AndroidManifest.xml'));
        $permissions = $xml->xpath('/manifest/uses-permission');
        $this->assertCount(1, $permissions);
        $this->assertSame('android.permission.INTERNET', (string) $permissions[0]->attributes('http://schemas.android.com/apk/res/android')->name);
        $this->assertCount(0, $xml->xpath('/manifest/application/receiver'));
        $services = $xml->xpath('/manifest/application/service');
        $this->assertCount(1, $services);
        $this->assertSame('android.permission.BIND_ACCESSIBILITY_SERVICE', (string) $services[0]->attributes('http://schemas.android.com/apk/res/android')->permission);
        $config = simplexml_load_file(base_path('android-shell/app/src/main/res/xml/research_accessibility_service.xml'))->attributes('http://schemas.android.com/apk/res/android');
        $this->assertFalse(isset($config->accessibilityEventTypes)); // Default mask is zero.
        foreach (['canRetrieveWindowContent', 'canTakeScreenshot', 'canPerformGestures', 'canRequestFilterKeyEvents'] as $capability) {
            $this->assertSame('false', (string) $config->{$capability});
        }
    }
}
