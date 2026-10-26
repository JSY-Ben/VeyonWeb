<?php
// Development only: Apache uses its own rewrite rule in production.
declare(strict_types=1);
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/api' || str_starts_with($path, '/api/')) { require __DIR__ . '/public/api.php'; return true; }
$file = realpath(__DIR__ . '/public' . $path);
if ($file && str_starts_with($file, realpath(__DIR__ . '/public') . DIRECTORY_SEPARATOR) && is_file($file)) return false;
if ($path === '/') { readfile(__DIR__ . '/public/index.html'); return true; }
http_response_code(404); echo 'Not found';
