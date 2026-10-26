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
