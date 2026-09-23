<?php

return [
    // Disabled for public access until an explicit deployment configuration is completed.
    'remote_api' => env('DIAGNOSTICS_REMOTE_API', false),
    'lease_seconds' => 10,
    'waiting_seconds' => 30,
    'max_session_seconds' => 900,
    'online_seconds' => 15,
];
