<?php

namespace App\Services;

use App\Models\DiagnosticSession;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class DiagnosticSessions
{
    public function expired(DiagnosticSession $session): bool
    {
        return $session->expires_at->lte(now())
            || ($session->status === 'waiting' && $session->created_at->addSeconds(config('diagnostics.waiting_seconds'))->lte(now()))
            || ($session->status === 'active' && (! $session->lease_expires_at || $session->lease_expires_at->lte(now())));
    }

    public function refresh(DiagnosticSession $session): DiagnosticSession
    {
        $session->refresh();
        if (in_array($session->status, ['waiting', 'active']) && $this->expired($session)) {
            $this->stop($session, 'expired');
        }

        return $session->refresh();
    }

    public function stop(DiagnosticSession $session, string $status = 'stopped'): void
    {
        $path = DB::transaction(function () use ($session, $status) {
            $current = DiagnosticSession::whereKey($session->id)->lockForUpdate()->firstOrFail();
            // Re-evaluate expiry under the same lock used by renewals and frame writes.
            if ($status === 'expired' && ! $this->expired($current)) {
                return null;
            }
            $snapshot = $current->snapshot()->first();
            $path = $snapshot?->screenshot_path;
            $current->update(['status' => $status, 'stopped_at' => now(), 'lease_expires_at' => null, 'viewer_hash' => null]);
            $snapshot?->delete();

            return $path;
        });
        if ($path) {
            DB::afterCommit(fn () => Storage::disk('local')->delete($path));
        }
    }

    public function state(DiagnosticSession $session): array
    {
        $session = $this->refresh($session);

        return [
            'session_id' => $session->id, 'status' => $session->status,
            'capture_allowed' => $session->status === 'active',
            'lease_remaining_ms' => $session->status === 'active' ? max(0, min(config('diagnostics.lease_seconds') * 1000, (int) now()->diffInMilliseconds(min($session->lease_expires_at, $session->expires_at), false))) : 0,
            'last_sequence' => $session->last_sequence,
            'snapshot_id' => $session->status === 'active' ? $session->snapshot()->value('id') : null,
            'expires_at' => $session->expires_at->toIso8601String(),
        ];
    }
}
