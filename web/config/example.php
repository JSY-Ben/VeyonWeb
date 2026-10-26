<?php
declare(strict_types=1);
return [
    'origin' => 'https://classroom.school.example',
    'teacher_username' => 'teacher',
    // Run php scripts/setup.php to create a password hash.
    'teacher_password_hash' => '',
    // Absolute directory for the SQLite database, gateway log and PID file.
    // Create it with www-data ownership and match the service's ReadWritePaths.
    'data_directory' => dirname(__DIR__) . '/data',
    'gateway_listen' => 'websocket://127.0.0.1:9001',
    'websocket_url' => '/remote',
    'veyon' => [
        'method' => 'key',
        'username' => 'teacher',
        'key_name' => 'teacher',
        'private_key_file' => '/etc/veyonweb/teacher_private.pem',
        // For logon authentication set method=logon, username and password.
        'password' => '',
    ],
];
