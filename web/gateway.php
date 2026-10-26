<?php
declare(strict_types=1);
use Classroom\Bridge;
use Classroom\Config;
use Classroom\Database;
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
            $generation = $db->generation();
            foreach ($authorizations as $id => $auth) {
                $valid = $db->query('SELECT 1 FROM sessions WHERE id=? AND expires>?',[$auth['session_id'],time()])->fetchColumn();
                if (!$valid || (int)$auth['generation'] !== $generation) {
                    if (isset($bridges[$id])) $bridges[$id]->fail('Teacher session ended or classroom directory changed.');
                    elseif (isset($worker->connections[$id])) $worker->connections[$id]->close();
                }
            }
        } catch (\Throwable $error) { error_log('Veyon gateway session check failed.'); foreach ($bridges as $bridge) $bridge->fail('Session validation unavailable.'); }
    });
};
$worker->onWebSocketConnect = function (TcpConnection $connection,Request $request) use (&$db,$config,&$authorizations): void {
    try {
        if ($request->path() !== '/remote' || $request->header('origin') !== $config['origin'] || count($authorizations) >= 128) throw new \RuntimeException('Request denied.');
        $ticket = $request->get('ticket',''); $cookie = $request->cookie('classroom','');
        if (!is_string($ticket) || !is_string($cookie)) throw new \RuntimeException('Invalid session.');
        $auth = $db->consumeTicket($ticket,$cookie);
        if (!$auth) throw new \RuntimeException('Invalid session.');
        if (count(array_filter($authorizations,fn($a) => $a['session_id'] === $auth['session_id'])) >= 64) throw new \RuntimeException('Too many sessions.');
        $connection->websocketType = Websocket::BINARY_TYPE_ARRAYBUFFER;
        $authorizations[$connection->id] = $auth;
    } catch (\Throwable $error) { $connection->close("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",true); }
};
$worker->onWebSocketConnected = function (TcpConnection $connection) use (&$bridges,&$authorizations,$config): void {
    if (!isset($authorizations[$connection->id])) return;
    try { $bridges[$connection->id] = new Bridge($connection,$authorizations[$connection->id],$config['veyon']); }
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
