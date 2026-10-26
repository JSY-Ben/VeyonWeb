<?php
declare(strict_types=1);
namespace Classroom;

/** A short-lived authenticated Veyon connection for classroom commands. */
final class FeatureClient
{
    private $socket;
    private string $buffer = '';
    private float $deadline;
    public function __construct(array $target, array $credentials, int $connectionTimeout = 2, int $handshakeTimeout = 10)
    {
        $this->deadline = microtime(true) + $connectionTimeout;
        $host = str_contains($target['host'], ':') ? '[' . $target['host'] . ']' : $target['host'];
        $this->socket = @stream_socket_client('tcp://' . $host . ':' . $target['port'], $errno, $error, $connectionTimeout);
        if (!$this->socket) throw new \RuntimeException('Cannot reach Veyon. Check the address, port and firewall.');
        $this->deadline = microtime(true) + $handshakeTimeout;
        stream_set_timeout($this->socket, 5);
        try {
            $ready = false;
            $handshake = new VeyonHandshake($credentials, fn(string $bytes) => $this->send($bytes),
                function (string $remaining) use (&$ready): void { $ready = true; $this->buffer = $remaining; });
            while (!$ready) $handshake->push($this->readChunk());
            $this->send("\x01");
            $header = $this->read(24);
            $size = unpack('nwidth/nheight', substr($header, 0, 4));
            if (!$size['width'] || !$size['height']) throw new \RuntimeException('Veyon denied access. Check its access-control rules.');
            $nameLength = unpack('N', substr($header, 20, 4))[1];
            if ($nameLength > 65536) throw new \RuntimeException('Invalid Veyon desktop name.');
            $this->read($nameLength);
            // The connection deadline does not limit subsequent file transfers.
            $this->deadline = microtime(true) + 25;
            stream_set_timeout($this->socket, 5);
        } catch (\Throwable $error) { $this->close(); throw $error; }
    }
    private function readChunk(): string
    {
        $remaining = $this->deadline - microtime(true);
        if ($remaining <= 0) throw new \RuntimeException('Veyon command timed out.');
        $wait = $remaining;
        stream_set_timeout($this->socket, (int)$wait, (int)(($wait - (int)$wait) * 1000000));
        $data = fread($this->socket, 8192);
        if ($data === false || $data === '') throw new \RuntimeException('Veyon disconnected or timed out. Check credentials and access-control rules.');
        return $data;
    }
    private function read(int $length): string
    {
        while (strlen($this->buffer) < $length) $this->buffer .= $this->readChunk();
        $data = substr($this->buffer, 0, $length); $this->buffer = substr($this->buffer, $length); return $data;
    }
    public function send(string $data): void
    {
        while ($data !== '') {
            if (microtime(true) > $this->deadline) throw new \RuntimeException('Veyon command timed out.');
            $written = fwrite($this->socket, $data);
            if ($written === false || $written === 0) throw new \RuntimeException('Veyon connection closed while sending.');
            $data = substr($data, $written);
        }
    }
    public function close(): void { if (is_resource($this->socket)) fclose($this->socket); }
    public function __destruct() { $this->close(); }
}
