<?php
declare(strict_types=1);
return [
    'origin' => 'https://classroom.school.example',
    // null detects the URL directory automatically; override with '/VeyonWeb'
    // or '' for the site root if using a proxy or URL rewriting.
    'base_path' => null,
    'teacher_username' => 'teacher',
    // Run php scripts/setup.php to create a password hash.
    'teacher_password_hash' => '',
    // Absolute directory for the SQLite database, gateway log and PID file.
    // Create it with www-data ownership and match the service's ReadWritePaths.
    'data_directory' => dirname(__DIR__) . '/data',
    'gateway_listen' => 'websocket://127.0.0.1:9001',
    'websocket_url' => '/remote',
    // Default overview snapshot interval; teachers can override it in the browser.
    'overview_refresh_seconds' => 30,
    // Space connection starts while allowing a small pool of captures.
    'overview_stagger_ms' => 300,
    'overview_max_connections' => 3,
    'overview_retry_seconds' => 60,
    // Allow public proxies, Veyon authentication and the first picture time to load.
    'preview_timeout_seconds' => 10,
    // Gateway-to-PC TCP connection deadline; independent of the preview budget.
    'connection_timeout_seconds' => 2,
    // Wake-on-LAN is sent by the web server; use your subnet broadcast if needed.
    'wake_broadcast' => '255.255.255.255',
    // Also adjust PHP upload_max_filesize and post_max_size for file distribution.
    'max_upload_bytes' => 20971520,
    'veyon' => [
        'method' => 'key',
        'username' => 'teacher',
        'key_name' => 'teacher',
        'private_key_file' => '/etc/veyonweb/teacher_private.pem',
        // For logon authentication set method=logon, username and password.
        'password' => '',
    ],
];
