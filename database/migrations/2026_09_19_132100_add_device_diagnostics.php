<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('devices', function (Blueprint $table) {
            $table->timestamp('last_heartbeat_at')->nullable()->index();
            $table->unsignedBigInteger('heartbeat_sequence')->default(0);
        });
        Schema::create('diagnostic_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->foreignId('device_id')->constrained()->cascadeOnDelete();
            $table->string('status')->default('waiting');
            $table->string('consent_version');
            $table->timestamp('expires_at');
            $table->timestamp('lease_expires_at')->nullable();
            $table->string('viewer_hash', 64)->nullable();
            $table->unsignedBigInteger('last_sequence')->default(0);
            $table->timestamp('stopped_at')->nullable();
            $table->timestamps();
            $table->index(['device_id', 'status']);
        });
        Schema::table('snapshots', function (Blueprint $table) {
            $table->foreignUuid('diagnostic_session_id')->nullable()->unique()->constrained()->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('snapshots', fn (Blueprint $table) => $table->dropConstrainedForeignId('diagnostic_session_id'));
        Schema::dropIfExists('diagnostic_sessions');
        Schema::table('devices', fn (Blueprint $table) => $table->dropColumn(['last_heartbeat_at', 'heartbeat_sequence']));
    }
};
