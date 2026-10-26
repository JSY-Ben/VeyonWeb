<?php
declare(strict_types=1);
use Classroom\Bridge;
use Classroom\Config;
use Classroom\Database;
use Classroom\Settings;
use Workerman\Worker;
use Workerman\Timer;
use Workerman\Protocols\Websocket;
use Workerman\Protocols\Http\Request;
use Workerman\Connection\TcpConnection;
require __DIR__ . '/vendor/autoload.php';
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$config = Config::load();
Worker::$pidFile = dirname($config['database']) . '/gateway.pid';
Worker::$logFile = dirname($config['database']) . '/gateway.log';
TcpConnection::$defaultMaxPackageSize = 1048576;
$worker = new Worker($config['gateway_listen']);
$worker->name = 'Veyon-PHP'; $worker->count = 1;
$bridges = []; $authorizations = []; $db = null;
$worker->onWorkerStart = function () use (&$db,$config,&$bridges,&$authorizations,$worker): void {
    $db = new Database($config['database']);
    Timer::add(1,function () use ($db,&$bridges,&$authorizations,$worker): void {
        try {
            foreach ($authorizations as $id => $auth) {
                if (!$db->authorizationValid($auth)) {
                    if (isset($bridges[$id])) $bridges[$id]->fail('Teacher session ended or classroom directory changed.');
                    elseif (isset($worker->connections[$id])) $worker->connections[$id]->close();
                }
            }
        } catch (\Throwable $error) { error_log('Veyon gateway session check failed.'); foreach ($bridges as $bridge) $bridge->fail('Session validation unavailable.'); }
    });
};
$worker->onWebSocketConnect = function (TcpConnection $connection,Request $request) use (&$db,$config,&$authorizations): void {
    try {
        if ($request->path() !== '/remote') throw new \RuntimeException('Proxy path mismatch: forward the WebSocket request to /remote.');
        if ($request->header('origin') !== $config['origin']) throw new \RuntimeException('Origin mismatch: check origin in config/local.php and restart the gateway.');
        if (count($authorizations) >= 128) throw new \RuntimeException('Gateway connection limit reached.');
        $ticket = $request->get('ticket',''); $cookie = $request->cookie('classroom','');
        if (!is_string($ticket) || !preg_match('/^[a-f0-9]{64}$/D', $ticket)) throw new \RuntimeException('Missing or malformed connection ticket.');
        if (!is_string($cookie) || !preg_match('/^[a-f0-9]{64}$/D', $cookie)) throw new \RuntimeException('Missing or malformed classroom cookie: sign out and sign in again; check cookie path and proxy cookie forwarding.');
        $auth = $db->consumeTicket($ticket,$cookie);
        if (!$auth) throw new \RuntimeException('Session or ticket invalid: check that the website and gateway use the same database; tickets expire after 30 seconds and can only be used once.');
        if (count(array_filter($authorizations,fn($a) => $a['session_id'] === $auth['session_id'])) >= 64) throw new \RuntimeException('Too many sessions.');
        $connection->websocketType = Websocket::BINARY_TYPE_ARRAYBUFFER;
        $authorizations[$connection->id] = $auth;
    } catch (\Throwable $error) {
        // Log only controlled rejection reasons, never cookies, tickets or query strings.
        $reason = get_class($error) === \RuntimeException::class ? $error->getMessage() : 'Internal session validation error; check database access and server configuration.';
        error_log('Veyon gateway handshake rejected: ' . $reason);
        $connection->close("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",true);
    }
};
$worker->onWebSocketConnected = function (TcpConnection $connection) use (&$bridges,&$authorizations,&$db,$config): void {
    if (!isset($authorizations[$connection->id])) return;
    try { $effective=Settings::apply($db,$config);$bridges[$connection->id] = new Bridge($connection,$authorizations[$connection->id],$config['veyon'],$effective['connection_timeout_seconds'],$effective['preview_timeout_seconds']); }
    catch (\Throwable $error) { $connection->close(); }
};
$worker->onMessage = function (TcpConnection $connection,string $bytes) use (&$bridges): void {
    if (isset($bridges[$connection->id])) $bridges[$connection->id]->receive($bytes); else $connection->close();
};
$worker->onClose = function (TcpConnection $connection) use (&$bridges,&$authorizations): void {
    if (isset($bridges[$connection->id])) $bridges[$connection->id]->close();
    unset($bridges[$connection->id],$authorizations[$connection->id]);
};
Worker::runAll();
