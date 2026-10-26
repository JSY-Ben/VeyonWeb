<?php
declare(strict_types=1);
namespace Classroom;

final class Features
{
    public const FILES = '4a70bd5a-fab2-4a4b-a92a-a1e81d2b75ed';
    private const IDS = [
        'message' => 'e75ae9c8-ac17-4d00-8f0d-019348346208',
        'lock' => 'ccb535a2-1d24-4cc1-a709-8b47d2b2ac79',
        'unlock' => 'ccb535a2-1d24-4cc1-a709-8b47d2b2ac79',
        'website' => '8a11a75d-b3db-48b6-b9cb-f8422ddd5b0c',
        'program' => 'da9ca56a-b2ad-4fff-8f8a-929b2927b442',
        'reboot' => '4f7d98f0-395a-4fff-b968-e49b8d0f748c',
        'shutdown' => '6f5a27a0-0e2f-496e-afcc-7aae62eede10',
        'logoff' => '7311d43d-ab53-439e-a03a-8cb25f7ed526',
    ];
    private static function text(array $body, string $key, int $max): string
    {
        $value = $body[$key] ?? '';
        if (!is_string($value) || trim($value) === '' || strlen($value) > $max || str_contains($value, "\0")) throw new \InvalidArgumentException('Enter a valid ' . $key . ' (up to ' . $max . ' bytes).');
        return trim($value);
    }
    public static function command(string $action, array $body): string
    {
        if (!isset(self::IDS[$action])) throw new \InvalidArgumentException('Unknown classroom action.');
        if (in_array($action, ['reboot', 'shutdown', 'logoff'], true) && ($body['confirmed'] ?? false) !== true) throw new \InvalidArgumentException('Confirm this power or user-session action.');
        $args = [];
        if ($action === 'message') {
            // Veyon displays rich text; encode user text so messages remain plain text.
            $text = nl2br(htmlspecialchars(self::text($body, 'text', 8000), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
            $args = [0 => Wire::variant($text), 1 => Wire::variant(1), 2 => Wire::variant('Message from teacher')];
        }
        if ($action === 'website') {
            $url = self::text($body, 'url', 2048);
            if (!filter_var($url, FILTER_VALIDATE_URL) || !in_array(strtolower(parse_url($url, PHP_URL_SCHEME) ?: ''), ['https', 'http'], true)) throw new \InvalidArgumentException('Enter a complete HTTP or HTTPS website URL.');
            $args = [1 => Wire::strings([$url])];
        }
        if ($action === 'program') $args = [0 => Wire::strings([self::text($body, 'program', 2048)])];
        return Wire::feature(self::IDS[$action], $action === 'unlock' ? 1 : 0, $args);
    }
    public static function filename(string $name): string
    {
        if ($name === '' || strlen($name) > 180 || preg_match('~[\x00-\x1f\x7f/\\\\:]~', $name) || in_array($name, ['.', '..'], true) || rtrim($name, '. ') !== $name) throw new \InvalidArgumentException('Choose a file with a simple filename, without path separators or trailing dots/spaces.');
        return $name;
    }
    public static function distribute(FeatureClient $client, string $temporary, string $name, bool $overwrite, bool $open): void
    {
        $name = self::filename($name);
        $transfer = bin2hex(random_bytes(16));
        $id = Wire::uuid($transfer);
        $file = fopen($temporary, 'rb');
        if (!$file) throw new \RuntimeException('Cannot read uploaded file.');
        try {
            $client->send(Wire::feature(self::FILES, 0, [0 => $id, 1 => Wire::variant($name), 4 => Wire::boolean($overwrite)]));
            while (!feof($file)) {
                $chunk = fread($file, 65536);
                if ($chunk === false) throw new \RuntimeException('Cannot read uploaded file.');
                if ($chunk !== '') $client->send(Wire::feature(self::FILES, 1, [0 => $id, 2 => Wire::variant($chunk, true)]));
            }
            $client->send(Wire::feature(self::FILES, 3, [0 => $id, 1 => Wire::variant($name), 3 => Wire::boolean($open)]));
        } catch (\Throwable $error) {
            try { $client->send(Wire::feature(self::FILES, 2, [0 => $id])); } catch (\Throwable) {}
            throw $error;
        } finally { fclose($file); }
    }
    public static function magicPacket(string $mac): string
    {
        if (!preg_match('/^(?:[a-f0-9]{2}[:-]){5}[a-f0-9]{2}$/iD', $mac)) throw new \InvalidArgumentException('Set this computer’s MAC address before using Wake-on-LAN.');
        return str_repeat("\xff", 6) . str_repeat(hex2bin(str_replace([':', '-'], '', $mac)), 16);
    }
    public static function wake(string $mac, string $broadcast): void
    {
        $packet = self::magicPacket($mac);
        if (!filter_var($broadcast, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) throw new \InvalidArgumentException('Configure wake_broadcast as an IPv4 broadcast address.');
        if (!function_exists('socket_create')) throw new \RuntimeException('Wake-on-LAN requires the PHP sockets extension on the web server.');
        $socket = socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
        if ($socket === false) throw new \RuntimeException('Cannot create Wake-on-LAN socket.');
        try {
            if (!socket_set_option($socket, SOL_SOCKET, SO_BROADCAST, 1) || @socket_sendto($socket, $packet, strlen($packet), 0, $broadcast, 9) !== strlen($packet)) throw new \RuntimeException('Cannot send Wake-on-LAN packet. Check the broadcast address and network.');
        } finally { socket_close($socket); }
    }
}
