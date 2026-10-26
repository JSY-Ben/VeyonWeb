<?php
declare(strict_types=1);

function systemdValue(string $value, bool $command = false): string
{
    if (preg_match('/[\x00-\x1f\x7f]/', $value)) throw new RuntimeException('Service paths cannot contain control characters.');
    $value = str_replace(['\\', '"', '%'], ['\\\\', '\\"', '%%'], $value);
    if ($command) $value = str_replace('$', '$$', $value);
    return '"' . $value . '"';
}

function gatewayService(string $webDirectory, string $dataDirectory, string $account): string
{
    if (!preg_match('/^[a-z_][a-z0-9_-]*[$]?$/i', $account)) throw new RuntimeException('Invalid service account.');
    // WorkingDirectory is a single literal path, not a quoted word list.
    systemdValue($webDirectory); // Validate control characters.
    if (!str_starts_with($webDirectory, '/') || !str_starts_with($dataDirectory, '/')) throw new RuntimeException('Service directories must be absolute paths.');
    $template = file_get_contents(__DIR__ . '/../deploy/veyon-gateway.service');
    if ($template === false) throw new RuntimeException('Cannot read service template.');
    return str_replace([
        'User=www-data', 'Group=www-data',
        'WorkingDirectory=/var/www/html/VeyonWeb/web',
        'ExecStart=/usr/bin/php /var/www/html/VeyonWeb/web/gateway.php start',
        'ReadWritePaths=/var/www/html/VeyonWeb/web/data',
    ], [
        'User=' . $account, 'Group=' . $account,
        'WorkingDirectory=' . str_replace('%', '%%', $webDirectory),
        'ExecStart=' . systemdValue(PHP_BINARY, true) . ' ' . systemdValue($webDirectory . '/gateway.php', true) . ' start',
        "ReadWritePaths=\nReadWritePaths=" . systemdValue($dataDirectory),
    ], $template);
}

function installGatewayService(array $config, string $configPath, string $account): void
{
    $webDirectory = dirname(__DIR__);
    $dataDirectory = dirname($config['database'] ?? rtrim($config['data_directory'], '/') . '/classroom.sqlite');
    $service = gatewayService($webDirectory, $dataDirectory, $account);
    $temporary = tempnam(sys_get_temp_dir(), 'veyon-service-');
    if ($temporary === false) throw new RuntimeException('Cannot create temporary service file.');
    $run = static function (array $arguments): void {
        if (!function_exists('posix_geteuid') || posix_geteuid() !== 0) array_unshift($arguments, 'sudo');
        passthru(implode(' ', array_map('escapeshellarg', $arguments)), $status);
        if ($status !== 0) throw new RuntimeException('Service setup failed: ' . $arguments[array_key_last($arguments)]);
    };
    try {
        if (file_put_contents($temporary, $service) === false) throw new RuntimeException('Cannot write service file.');
        $run(['install', '-d', '-o', $account, '-g', $account, '-m', '0750', '--', $dataDirectory]);
        $run(['chown', 'root:' . $account, '--', $configPath]);
        $run(['chmod', '0660', '--', $configPath]);
        $run(['chown', 'root:' . $account, '--', dirname($configPath)]);
        $run(['chmod', '2770', '--', dirname($configPath)]);
        $database=$config['database'] ?? rtrim($config['data_directory'],'/').'/classroom.sqlite';
        foreach([$database,$database.'-wal',$database.'-shm'] as $file)if(is_file($file)){
            $run(['chown',$account.':'.$account,'--',$file]);
            $run(['chmod','0660','--',$file]);
        }
        $run(['install', '-m', '0644', '--', $temporary, '/etc/systemd/system/veyon-gateway.service']);
        $run(['systemctl', 'daemon-reload']);
        $run(['systemctl', 'enable', 'veyon-gateway']);
        $run(['systemctl', 'restart', 'veyon-gateway']);
        $run(['systemctl', '--no-pager', 'status', 'veyon-gateway']);
    } finally {
        unlink($temporary);
    }
}
