<?php
declare(strict_types=1);
require dirname(__DIR__) . '/vendor/autoload.php';
header('Cache-Control: no-store');
try {
    $config = \Classroom\Config::load();
    $base = htmlspecialchars($config['base_path'] . '/', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $html = file_get_contents(__DIR__ . '/index.html');
    if ($html === false) throw new RuntimeException('Cannot read page template.');
    echo str_replace('<head>', '<head><base href="' . $base . '">', $html);
} catch (Throwable $error) {
    error_log('Veyon page: ' . $error->getMessage());
    http_response_code(503);
    echo 'VeyonWeb is not configured. Check the server logs and config/local.php.';
}
