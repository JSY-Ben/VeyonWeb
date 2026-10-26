<?php
declare(strict_types=1);
namespace Classroom;

final class Settings
{
    public const RANGES = [
        'overview_refresh_seconds'=>[2,3600], 'overview_max_connections'=>[1,10],
        'overview_stagger_ms'=>[0,10000], 'overview_retry_seconds'=>[2,3600],
        'connection_timeout_seconds'=>[1,120], 'preview_timeout_seconds'=>[1,120],
    ];
    public static function values(array $config): array { return array_intersect_key($config,self::RANGES); }
    private static function validate(array $values): void
    {
        foreach($values as $name=>$value){
            if(!isset(self::RANGES[$name]))throw new \InvalidArgumentException('Unknown web setting.');
            [$min,$max]=self::RANGES[$name];
            if(!is_int($value)||$value<$min||$value>$max)throw new \InvalidArgumentException($name.' must be an integer between '.$min.' and '.$max.'.');
        }
    }
    public static function save(array $values): void { self::validate($values);ConfigWriter::save($values); }
}
