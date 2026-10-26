<?php
declare(strict_types=1);
namespace Classroom;

final class Wire
{
    public static function uuid(string $uuid): string
    {
        $hex = str_replace(['-', '{', '}'], '', $uuid);
        if (!preg_match('/^[a-f0-9]{32}$/iD', $hex)) throw new \InvalidArgumentException('Invalid feature UUID.');
        return pack('NC', 30, 0) . hex2bin($hex);
    }
    public static function boolean(bool $value): string { return pack('NCC', 1, 0, (int)$value); }
    public static function strings(array $values): string
    {
        $data = pack('NCN', 11, 0, count($values));
        foreach ($values as $value) $data .= substr(self::variant($value), 5);
        return $data;
    }
    /** Map values are already serialized QVariants; keys are plain QStrings. */
    public static function map(array $values): string
    {
        $data = pack('NCN', 8, 0, count($values));
        foreach ($values as $key => $value) $data .= substr(self::variant((string)$key), 5) . $value;
        return $data;
    }
    public static function feature(string $uuid, int $command = 0, array $arguments = []): string
    {
        return chr(41) . self::message([self::uuid($uuid), self::variant($command), self::map($arguments)]);
    }
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
