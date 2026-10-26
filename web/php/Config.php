<?php
declare(strict_types=1);
namespace Classroom;

final class Config
{
    public static function load(): array
    {
        $path = getenv('CLASSROOM_CONFIG') ?: dirname(__DIR__) . '/config/local.php';
        $values = is_file($path) ? require $path : [];
        if (!is_array($values)) throw new \RuntimeException('Configuration must return an array.');
        $config = array_replace_recursive([
            'origin' => 'http://127.0.0.1:8080', 'teacher_username' => 'teacher', 'teacher_password_hash' => '',
            'base_path' => null, 'data_directory' => dirname(__DIR__) . '/data',
            'gateway_listen' => 'websocket://127.0.0.1:9001', 'websocket_url' => '/remote',
            'overview_refresh_seconds' => 30,
            'overview_stagger_ms' => 300,
            'overview_max_connections' => 3, 'overview_retry_seconds' => 60, 'preview_timeout_seconds' => 10,
            'connection_timeout_seconds' => 2,
            'wake_broadcast' => '255.255.255.255', 'max_upload_bytes' => 20971520,
            'demo' => false, 'veyon' => ['method' => 'key', 'username' => 'teacher', 'key_name' => 'teacher', 'private_key_file' => '', 'password' => ''],
        ], $values);
        foreach (['overview_max_connections'=>[1,10], 'overview_retry_seconds'=>[2,3600], 'preview_timeout_seconds'=>[1,120]] as $key=>$range) {
            if (!is_int($config[$key]) || $config[$key]<$range[0] || $config[$key]>$range[1]) throw new \RuntimeException($key . ' must be an integer between ' . $range[0] . ' and ' . $range[1] . '.');
        }
        if (!is_int($config['connection_timeout_seconds']) || $config['connection_timeout_seconds'] < 1 || $config['connection_timeout_seconds'] > 120) throw new \RuntimeException('connection_timeout_seconds must be an integer between 1 and 120.');
        if (!is_int($config['overview_refresh_seconds']) || $config['overview_refresh_seconds'] < 2 || $config['overview_refresh_seconds'] > 3600) throw new \RuntimeException('overview_refresh_seconds must be an integer between 2 and 3600.');
        if (!is_int($config['overview_stagger_ms']) || $config['overview_stagger_ms'] < 0 || $config['overview_stagger_ms'] > 10000) throw new \RuntimeException('overview_stagger_ms must be an integer between 0 and 10000.');
        if (!is_int($config['max_upload_bytes']) || $config['max_upload_bytes'] < 1 || $config['max_upload_bytes'] > 104857600) throw new \RuntimeException('max_upload_bytes must be between 1 and 104857600.');
        // Direct PHP entry points work in an existing site without rewrites or aliases.
        if ($config['base_path'] === null) {
            $script = PHP_SAPI === 'cli' ? '' : ($_SERVER['SCRIPT_NAME'] ?? '');
            $config['base_path'] = $script === '' ? '' : rtrim(str_replace('\\', '/', dirname($script)), '/.');
        }
        if (!is_string($config['base_path']) || ($config['base_path'] !== '' && !preg_match('~^(/[A-Za-z0-9_-][A-Za-z0-9._-]*)+/?$~D', $config['base_path']))) {
            throw new \RuntimeException('Configure base_path as a URL path such as /VeyonWeb, or leave it empty.');
        }
        $config['base_path'] = rtrim($config['base_path'], '/');
        if (!is_string($config['data_directory']) || !str_starts_with($config['data_directory'], '/') || str_contains($config['data_directory'], "\0")) {
            throw new \RuntimeException('Configure data_directory as an absolute directory path.');
        }
        $config['data_directory'] = rtrim($config['data_directory'], '/') ?: '/';
        // Preserve existing installations that explicitly configured a database file.
        $config['database'] = $values['database'] ?? rtrim($config['data_directory'], '/') . '/classroom.sqlite';
        if (getenv('VEYON_DEMO') === '1') {
            $config['demo'] = true;
            $config['database'] = rtrim($config['data_directory'], '/') . '/demo.sqlite';
        }
        $url = parse_url($config['origin']);
        if (!$url || !in_array($url['scheme'] ?? '', ['https', 'http'], true) || empty($url['host']) || isset($url['path']) || isset($url['query']) || isset($url['fragment']) || isset($url['user'])) {
            throw new \RuntimeException('Configure origin as a complete origin, without a path or trailing slash.');
        }
        if ($url['scheme'] !== 'https' && !in_array($url['host'], ['127.0.0.1', 'localhost', '[::1]'], true)) throw new \RuntimeException('Network access requires an HTTPS origin.');
        if (!preg_match('~^websocket://(?:127\.0\.0\.1|localhost|\[::1\]):[0-9]+$~', $config['gateway_listen'])) throw new \RuntimeException('The gateway must bind to loopback behind Apache.');
        $ws = $config['websocket_url'];
        if ($ws !== '/remote' && !preg_match('~^ws://(?:127\.0\.0\.1|localhost):[0-9]+/remote$~', $ws)) throw new \RuntimeException('Invalid WebSocket URL.');
        if ($ws !== '/remote' && $url['scheme'] === 'https') throw new \RuntimeException('HTTPS deployments must proxy /remote through Apache.');
        return $config;
    }

    public static function ready(array $config): bool
    {
        $auth = $config['veyon'];
        return $auth['method'] === 'key' ? is_readable($auth['private_key_file']) : ($auth['method'] === 'logon' && $auth['username'] !== '' && $auth['password'] !== '');
    }
}
