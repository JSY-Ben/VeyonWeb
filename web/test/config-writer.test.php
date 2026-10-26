<?php
declare(strict_types=1);
require dirname(__DIR__).'/vendor/autoload.php';
use Classroom\Config;
use Classroom\Settings;
use Classroom\Database;

function verify(bool $value,string $message): void { if(!$value)throw new RuntimeException($message); }
function refuses(callable $action): void { try{$action();}catch(Throwable){return;}throw new RuntimeException('Expected rejection.'); }
$directory=sys_get_temp_dir().'/veyon-config-'.bin2hex(random_bytes(8));mkdir($directory,0700);
$path=$directory.'/local.php';$original=getenv('CLASSROOM_CONFIG');putenv('CLASSROOM_CONFIG='.$path);
try{
    $source= <<<'PHP'
<?php
declare(strict_types=1);
return [
    // Keep this comment and the unrelated credential values.
    'origin' => 'https://classroom.example',
    'base_path' => null,
    'overview_refresh_seconds' => 30, // Keep this inline comment.
    'veyon' => ['password' => 'fake-secret-$value', 'overview_refresh_seconds' => 999],
    'data_directory' => __DIR__ . '/data',
];
PHP;
    file_put_contents($path,$source);chmod($path,0640);
    Settings::save(['overview_refresh_seconds'=>45,'overview_max_connections'=>2,'gateway_workers'=>8]);
    $raw=require $path;$saved=file_get_contents($path);
    verify($raw['overview_refresh_seconds']===45&&$raw['overview_max_connections']===2,'Settings not written to the config.');
    verify($raw['veyon']===['password'=>'fake-secret-$value','overview_refresh_seconds'=>999],'Nested credentials changed.');
    verify($raw['base_path']===null&&str_contains($saved,"__DIR__ . '/data'")&&str_contains($saved,'Keep this inline comment.'),'Paths or comments changed.');
    verify((fileperms($path)&0007)===0,'Config permissions expose the file to other users.');
    verify(Config::load()['overview_refresh_seconds']===45,'Config reload did not see the saved value.');
    verify(Settings::values(Config::load())['gateway_workers']===8,'Gateway process count was not saved and exposed in Settings.');
    foreach([0,17,4.5,'4',null] as $invalid)refuses(fn()=>Settings::save(['gateway_workers'=>$invalid]));
    $before=file_get_contents($path);refuses(fn()=>Settings::save(['origin'=>'https://other.example']));refuses(fn()=>Settings::save(['overview_max_connections'=>0]));verify(file_get_contents($path)===$before,'Rejected settings changed the config.');
    foreach(["<?php return array('overview_refresh_seconds'=>30, 'other'=>['x'=>1]);",'<?php return [];',"<?php return ['overview_refresh_seconds'=>30 /* comment without trailing comma */];",'<?php return (json_decode(\'{"origin":"https://example.com","base_path":null,"veyon":{"password":"keep"}}\',true));'] as $fixture){
        file_put_contents($path,$fixture);Settings::save(['overview_refresh_seconds'=>60,'overview_max_connections'=>4]);$raw=require $path;
        verify($raw['overview_refresh_seconds']===60&&$raw['overview_max_connections']===4,'Array format save failed.');
    }
    Settings::save(['app_name'=>"School's \\ Classroom",'primary_colour'=>'#aabbcc','theme'=>'dark','app_logo'=>'']);
    $raw=require $path;verify($raw['app_name']==="School's \\ Classroom"&&$raw['theme']==='dark'&&$raw['app_logo']==='','Appearance strings were not safely quoted.');
    refuses(fn()=>Settings::save(['primary_colour'=>'invalid']));refuses(fn()=>Settings::save(['app_logo'=>'javascript:alert(1)']));
    if(!function_exists('posix_geteuid')||posix_geteuid()!==0){
        $before=file_get_contents($path);chmod($directory,0500);clearstatcache();refuses(fn()=>Settings::save(['overview_max_connections'=>2]));chmod($directory,0700);verify(file_get_contents($path)===$before,'A failed save damaged the configuration.');
    }

    echo "PASS file settings: atomic saves, comments, paths, credentials, validation and permissions\n";
}finally{
    if($original===false)putenv('CLASSROOM_CONFIG');else putenv('CLASSROOM_CONFIG='.$original);
    chmod($directory,0700);foreach(new DirectoryIterator($directory) as $file)if(!$file->isDot())unlink($file->getPathname());rmdir($directory);
}
