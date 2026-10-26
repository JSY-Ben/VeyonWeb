<?php
declare(strict_types=1);
namespace Classroom;

final class Wire
{
    public static function variant(int|string $value, bool $bytes = false): string
    {
        if (is_int($value)) return pack('NCN', 2, 0, $value);
        $data = $bytes ? $value : iconv('UTF-8', 'UTF-16BE', $value);
        if ($data === false) throw new \RuntimeException('Invalid authentication text.');
        return pack('NCN', $bytes ? 12 : 10, 0, strlen($data)) . $data;
    }
    public static function message(array $variants = []): string { $data = implode('', $variants); return pack('N', strlen($data)) . $data; }
    public static function decode(string $data): array
    {
        $offset = 0; $values = [];
        $take = function (int $length) use (&$offset, $data): string {
            if ($length < 0 || $offset + $length > strlen($data)) throw new \RuntimeException('Truncated Veyon authentication message.');
            $value = substr($data, $offset, $length); $offset += $length; return $value;
        };
        while ($offset < strlen($data)) {
            $type = unpack('N', $take(4))[1]; $take(1);
            if ($type === 2) $values[] = unpack('N', $take(4))[1];
            elseif ($type === 10 || $type === 12) {
                $length = unpack('N', $take(4))[1];
                if ($length === 0xffffffff) { $values[] = ''; continue; }
                if ($length > 65536 || ($type === 10 && $length % 2)) throw new \RuntimeException('Invalid authentication field length.');
                $bytes = $take($length); $value = $type === 10 ? iconv('UTF-16BE', 'UTF-8', $bytes) : $bytes;
                if ($value === false) throw new \RuntimeException('Invalid authentication text.');
                $values[] = $value;
            } else throw new \RuntimeException('Unsupported Veyon authentication field.');
        }
        return $values;
    }
}
