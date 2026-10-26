<?php
declare(strict_types=1);
namespace Classroom;

final class VeyonHandshake
{
    private string $buffer = '';
    private string $state = 'version';
    private int $securityCount = 0;
    private int $method;
    public function __construct(private array $credentials, private \Closure $send, private \Closure $ready)
    {
        if (!in_array($credentials['method'], ['key', 'logon'], true)) throw new \RuntimeException('Unsupported authentication configuration.');
        $this->method = $credentials['method'] === 'key' ? 3 : 4;
    }
    private function take(int $length): ?string
    {
        if (strlen($this->buffer) < $length) return null;
        $data = substr($this->buffer,0,$length); $this->buffer = substr($this->buffer,$length); return $data;
    }
    private function variants(): ?array
    {
        if (strlen($this->buffer) < 4) return null;
        $length = unpack('N',substr($this->buffer,0,4))[1];
        if ($length > 65536) throw new \RuntimeException('Authentication message too large.');
        if (strlen($this->buffer) < 4 + $length) return null;
        $this->take(4); return Wire::decode($this->take($length));
    }
    public function push(string $data): void
    {
        $this->buffer .= $data;
        if (strlen($this->buffer) > 1048576) throw new \RuntimeException('Authentication buffer too large.');
        while (true) {
            switch ($this->state) {
                case 'version':
                    $version = $this->take(12); if ($version === null) return;
                    // Veyon servers can terminate the 12-byte greeting with NUL.
                    if (!preg_match('/^RFB 003\.00[78][\n\x00]$/D',$version)) throw new \RuntimeException('Expected a Veyon RFB 3.7/3.8 server.');
                    ($this->send)("RFB 003.008\n"); $this->state = 'count'; break;
                case 'count':
                    $count = $this->take(1); if ($count === null) return;
                    $this->securityCount = ord($count); if ($this->securityCount === 0) throw new \RuntimeException('Veyon rejected the connection.');
                    $this->state = 'security'; break;
                case 'security':
                    $types = $this->take($this->securityCount); if ($types === null) return;
                    if (!str_contains($types,chr(40))) throw new \RuntimeException('The target does not offer Veyon authentication.');
                    ($this->send)(chr(40)); $this->state = 'methods'; break;
                case 'methods':
                    $methods = $this->variants(); if ($methods === null) return;
                    if (!isset($methods[0]) || !is_int($methods[0]) || $methods[0] < 1 || $methods[0] > 32 || count($methods) !== $methods[0]+1) throw new \RuntimeException('Invalid Veyon authentication methods.');
                    if (!in_array($this->method,array_slice($methods,1),true)) throw new \RuntimeException('Veyon does not accept the configured authentication method.');
                    ($this->send)(Wire::message([Wire::variant($this->method),Wire::variant($this->credentials['username'])])); $this->state = 'ack'; break;
                case 'ack':
                    $ack = $this->variants(); if ($ack === null) return;
                    if ($ack !== []) throw new \RuntimeException('Unexpected authentication acknowledgement.');
                    $this->state = 'challenge'; break;
                case 'challenge':
                    $values = $this->variants(); if ($values === null) return;
                    if (count($values) !== 1 || !is_string($values[0])) throw new \RuntimeException('Invalid Veyon authentication challenge.');
                    $challenge = $values[0];
                    if ($this->method === 3) {
                        if (strlen($challenge) !== 128) throw new \RuntimeException('Invalid Veyon key challenge.');
                        $key = $this->credentials['private_key'] ?? @file_get_contents($this->credentials['private_key_file']);
                        if (!$key || !openssl_sign($challenge,$signature,$key,OPENSSL_ALGO_SHA512)) throw new \RuntimeException('Cannot sign with the configured Veyon key.');
                        ($this->send)(Wire::message([Wire::variant($this->credentials['key_name']),Wire::variant($signature,true)]));
                    } else {
                        if (!str_contains($challenge,'PUBLIC KEY') || !openssl_public_encrypt($this->credentials['password'],$encrypted,$challenge,OPENSSL_PKCS1_OAEP_PADDING)) throw new \RuntimeException('Cannot encrypt the Veyon logon password.');
                        ($this->send)(Wire::message([Wire::variant($encrypted,true)]));
                    }
                    $this->state = 'result'; break;
                case 'result':
                    $result = $this->take(4); if ($result === null) return;
                    if (unpack('N',$result)[1] !== 0) throw new \RuntimeException('Veyon authentication failed.');
                    $this->state = 'ready'; $remaining = $this->buffer; $this->buffer = ''; ($this->ready)($remaining); return;
                case 'ready': return;
            }
        }
    }
}
