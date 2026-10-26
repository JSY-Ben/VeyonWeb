<?php
declare(strict_types=1);
namespace Classroom;

use Workerman\Connection\AsyncTcpConnection;
use Workerman\Connection\TcpConnection;
use Workerman\Timer;

final class Bridge
{
    private AsyncTcpConnection $upstream;
    private VeyonHandshake $handshake;
    private RfbFilter $filter;
    private string $state = 'connecting';
    private string $browserBuffer = '';
    private string $pendingServer = '';
    private bool $authenticated = false;
    private bool $closed = false;
    private int $timer;
    public function __construct(private TcpConnection $browser, array $target, array $credentials)
    {
        $this->filter = new RfbFilter($target['mode'] === 'view');
        $host = str_contains($target['host'],':') ? '[' . $target['host'] . ']' : $target['host'];
        $this->upstream = new AsyncTcpConnection("tcp://$host:" . $target['port']);
        $this->upstream->maxSendBufferSize = 1048576;
        $this->handshake = new VeyonHandshake($credentials,
            fn(string $bytes) => $this->upstream->send($bytes),
            function (string $remaining): void {
                $this->authenticated = true; $this->upstream->pauseRecv();
                $this->pendingServer = $remaining; $this->state = 'version';
                $this->browser->send("RFB 003.008\n"); $this->processBrowser();
            });
        $this->upstream->onMessage = function ($connection,string $bytes): void {
            try { if (!$this->authenticated) $this->handshake->push($bytes); elseif ($this->state === 'running') $this->browser->send($bytes); else $this->pendingServer .= $bytes; }
            catch (\Throwable $error) { $this->fail($error->getMessage()); }
        };
        $this->upstream->onError = fn() => $this->fail('Cannot connect to Veyon. Check the target address and firewall.');
        $this->upstream->onClose = fn() => $this->fail('Veyon disconnected. Check credentials and access-control rules.');
        $this->upstream->onBufferFull = function (): void { if ($this->upstream->getSendBufferQueueSize() > 1048576) $this->fail('Remote input buffer exceeded its limit.'); else $this->browser->pauseRecv(); };
        $this->upstream->onBufferDrain = fn() => $this->browser->resumeRecv();
        $this->browser->maxSendBufferSize = 4194304;
        $this->browser->onBufferFull = function (): void { if ($this->browser->getSendBufferQueueSize() > 4194304) $this->fail('Screen connection is too slow.'); else $this->upstream->pauseRecv(); };
        $this->browser->onBufferDrain = function (): void { if ($this->state === 'running') $this->upstream->resumeRecv(); };
        $this->timer = Timer::add(20,fn() => $this->fail('Remote handshake timed out.'),[],false);
        $this->upstream->connect();
    }
    public function receive(string $bytes): void
    {
        if ($this->closed) return;
        try {
            if ($this->state === 'running') { $output = $this->filter->push($bytes); if ($output !== '') $this->upstream->send($output); return; }
            $this->browserBuffer .= $bytes;
            if (strlen($this->browserBuffer) > 1024) throw new \RuntimeException('Invalid browser handshake.');
            $this->processBrowser();
        } catch (\Throwable $error) { $this->fail($error->getMessage()); }
    }
    private function processBrowser(): void
    {
        if ($this->state === 'version' && strlen($this->browserBuffer) >= 12) {
            if (substr($this->browserBuffer,0,12) !== "RFB 003.008\n") throw new \RuntimeException('Browser must support RFB 3.8.');
            $this->browserBuffer = substr($this->browserBuffer,12); $this->browser->send("\x01\x01"); $this->state = 'security';
        }
        if ($this->state === 'security' && strlen($this->browserBuffer) >= 1) {
            if ($this->browserBuffer[0] !== "\x01") throw new \RuntimeException('Unexpected browser security selection.');
            $this->browserBuffer = substr($this->browserBuffer,1); $this->browser->send(pack('N',0)); $this->state = 'init';
        }
        if ($this->state === 'init' && strlen($this->browserBuffer) >= 1) {
            $this->browserBuffer = substr($this->browserBuffer,1); $this->state = 'running'; Timer::del($this->timer);
            $this->upstream->send("\x01");
            if ($this->pendingServer !== '') { $this->browser->send($this->pendingServer); $this->pendingServer = ''; }
            $this->upstream->resumeRecv();
        }
        if ($this->state === 'running' && $this->browserBuffer !== '') { $bytes = $this->browserBuffer; $this->browserBuffer = ''; $this->receive($bytes); }
    }
    public function fail(string $reason): void
    {
        if ($this->closed) return;
        $this->closed = true; Timer::del($this->timer);
        $reason = substr(preg_replace('/[^\x20-\x7e]/','',$reason),0,120);
        $payload = pack('n',1011) . $reason;
        $this->browser->close("\x88" . chr(strlen($payload)) . $payload,true);
        $this->upstream->destroy();
    }
    public function close(): void
    {
        if ($this->closed) return;
        $this->closed = true; Timer::del($this->timer); $this->upstream->destroy();
    }
}
