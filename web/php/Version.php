<?php
declare(strict_types=1);
namespace Classroom;

final class Version
{
    public static function current(): string
    {
        $value = file_get_contents(dirname(__DIR__) . '/VERSION');
        if ($value === false || trim($value) === '') throw new \RuntimeException('Cannot read application version.');
        return trim($value);
    }
    public static function number(): string
    {
        if (!preg_match('/^(\d+)\.(\d+)(?:\.(\d+))?(?:\s|$)/', self::current(), $matches)) throw new \RuntimeException('Invalid application version.');
        return $matches[1] . '.' . $matches[2] . (isset($matches[3]) && $matches[3] !== '' ? '.' . $matches[3] : '');
    }
    // SQLite user_version accepts integers only; reserve three digits per component.
    public static function schemaNumber(): int
    {
        $parts = array_map('intval', explode('.', self::number()));
        [$major, $minor, $patch] = array_pad($parts, 3, 0);
        if ($major > 2146 || $minor > 999 || $patch > 999) throw new \RuntimeException('Application version exceeds the database version range.');
        return $major * 1000000 + $minor * 1000 + $patch;
    }
}
