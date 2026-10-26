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
            'data_directory' => dirname(__DIR__) . '/data',
            'gateway_listen' => 'websocket://127.0.0.1:9001', 'websocket_url' => '/remote',
            'demo' => false, 'veyon' => ['method' => 'key', 'username' => 'teacher', 'key_name' => 'teacher', 'private_key_file' => '', 'password' => ''],
        ], $values);
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
        if (!$config['demo'] && !$config['teacher_password_hash']) throw new \RuntimeException('Teacher login is not configured. Run php scripts/setup.php.');
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
