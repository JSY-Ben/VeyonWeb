<?php
declare(strict_types=1);
namespace Classroom;

final class Settings
{
    public const RANGES = [
        'gateway_workers'=>[1,16],
        'overview_refresh_seconds'=>[2,3600], 'overview_max_connections'=>[1,10],
        'overview_stagger_ms'=>[0,10000], 'overview_retry_seconds'=>[2,3600],
        'connection_timeout_seconds'=>[1,120], 'preview_timeout_seconds'=>[1,120],
    ];
    public const APPEARANCE = ['app_name'=>true,'primary_colour'=>true,'theme'=>true,'app_logo'=>true,'login_graphic'=>true];
    public static function appearance(array $config): array { return array_intersect_key($config,self::APPEARANCE); }
    public static function values(array $config): array { return array_intersect_key($config,self::RANGES+self::APPEARANCE); }
    private static function image(mixed $value): bool
    {
        if(!is_string($value))return false;
        if($value==='')return true;
        if(strlen($value)>350000 || !preg_match('~^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$~D',$value,$match))return false;
        $bytes=base64_decode($match[2],true);
        if($bytes===false||strlen($bytes)>262144)return false;
        $size=@getimagesizefromstring($bytes);
        return $size && $size[0]<=8192 && $size[1]<=8192 && $size['mime']==='image/'.$match[1];
    }
    private static function validate(array $values): void
    {
        foreach($values as $name=>$value){
            if(isset(self::APPEARANCE[$name])){
                $valid=match($name){
                    'app_name'=>is_string($value)&&trim($value)!==''&&strlen($value)<=80&&!preg_match('/[\x00-\x1f\x7f]/',$value),
                    'primary_colour'=>is_string($value)&&(bool)preg_match('/^#[a-fA-F0-9]{6}$/D',$value),
                    'theme'=>in_array($value,['light','dark','system'],true),
                    default=>self::image($value),
                };
                if(!$valid)throw new \InvalidArgumentException('Invalid '.$name.'. Images must be PNG, JPEG or WebP, up to 256 KB and 8192 pixels per side.');
                continue;
            }
            if(!isset(self::RANGES[$name]))throw new \InvalidArgumentException('Unknown web setting.');
            [$min,$max]=self::RANGES[$name];
            if(!is_int($value)||$value<$min||$value>$max)throw new \InvalidArgumentException($name.' must be an integer between '.$min.' and '.$max.'.');
        }
    }
    public static function save(array $values): void { self::validate($values);ConfigWriter::save($values); }
}
