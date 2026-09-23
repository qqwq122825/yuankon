<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('projects', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->timestamps();
        });
        Schema::create('devices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->string('public_id')->unique();
            $table->string('name');
            $table->string('brand')->default('测试设备');
            $table->string('android_version')->default('待记录');
            $table->string('source')->default('import');
            $table->boolean('accessibility_enabled')->nullable();
            $table->unsignedTinyInteger('battery')->nullable();
            $table->string('note', 200)->default('');
            $table->timestamp('last_received_at')->nullable();
            $table->timestamps();
            $table->index(['project_id', 'last_received_at']);
        });
        Schema::create('snapshots', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->foreignId('device_id')->constrained()->cascadeOnDelete();
            $table->string('source');
            $table->timestamp('captured_at');
            $table->json('payload');
            $table->unsignedInteger('node_count');
            $table->unsignedInteger('window_count');
            $table->string('screenshot_path')->nullable();
            $table->timestamps();
            $table->index(['project_id', 'device_id', 'captured_at']);
        });
        Schema::create('lab_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->foreignId('device_id')->constrained()->cascadeOnDelete();
            $table->string('kind');
            $table->string('summary');
            $table->string('source');
            $table->timestamp('occurred_at');
            $table->timestamps();
            $table->index(['project_id', 'device_id', 'occurred_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('lab_events');
        Schema::dropIfExists('snapshots');
        Schema::dropIfExists('devices');
        Schema::dropIfExists('projects');
    }
};
