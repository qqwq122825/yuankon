<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('build_bots', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->unique()->constrained()->cascadeOnDelete();
            $table->text('token');
            $table->string('username');
            $table->string('owner_id')->nullable();
            $table->string('pair_hash')->nullable();
            $table->timestamp('pair_expires_at')->nullable();
            $table->unsignedBigInteger('update_offset')->default(0);
            $table->json('conversation')->nullable();
            $table->timestamp('polled_at')->nullable();
            $table->timestamps();
        });
        Schema::create('apk_builds', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->string('chat_id')->nullable();
            $table->unsignedBigInteger('telegram_update_id')->nullable()->unique();
            $table->string('app_name', 40);
            $table->string('home_url', 2000);
            $table->string('icon_path')->nullable();
            $table->string('status')->default('queued');
            $table->string('artifact_path')->nullable();
            $table->string('sha256', 64)->nullable();
            $table->unsignedBigInteger('size')->nullable();
            $table->string('error')->nullable();
            $table->string('delivery_status')->default('pending');
            $table->timestamps();
            $table->index(['project_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('apk_builds');
        Schema::dropIfExists('build_bots');
    }
};
