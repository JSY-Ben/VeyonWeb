<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__.'/gateway-service.php';
function ask(string $prompt): string { fwrite(STDOUT,$prompt);$line=fgets(STDIN);if($line===false)throw new RuntimeException('Input ended.');return trim($line); }
function secret(string $prompt): string {
    fwrite(STDOUT,$prompt);
    $tty=function_exists('stream_isatty') && stream_isatty(STDIN) && PHP_OS_FAMILY !== 'Windows';
    $mode=$tty?trim((string)shell_exec('stty -g')):'';
    if($mode!=='')shell_exec('stty -echo');
    try {$value=fgets(STDIN);if($value===false)throw new RuntimeException('Input ended.');return rtrim($value,"\r\n");}
    finally {if($mode!=='')shell_exec('stty '.escapeshellarg($mode));fwrite(STDOUT,"\n");}
}
try {
    if(!is_file(dirname(__DIR__).'/vendor/autoload.php'))throw new RuntimeException('Run composer install in the web directory before setup.');
    require dirname(__DIR__).'/vendor/autoload.php';
    $path=dirname(__DIR__).'/config/local.php';
    $config=require (is_file($path)?$path:dirname(__DIR__).'/config/example.php');
    $defaultAdmin=$config['teacher_username']??'admin';
    $config['teacher_username']=ask('Administrator username ['.$defaultAdmin.']: ') ?: $defaultAdmin;
    if(!preg_match('/^[a-zA-Z0-9._-]{1,64}$/',$config['teacher_username']))throw new RuntimeException('Use letters, digits, dots, underscores or hyphens.');
    $origin=ask('Site origin [https://classroom.school.example]: ') ?: 'https://classroom.school.example';
    $parts=parse_url($origin);
    if(!$parts || !in_array($parts['scheme']??'',['http','https'],true) || empty($parts['host']) || isset($parts['path']) || isset($parts['query']) || isset($parts['fragment']) || isset($parts['user']))throw new RuntimeException('Enter a complete origin without a trailing slash.');
    if($parts['scheme']!=='https'&&!in_array($parts['host'],['127.0.0.1','localhost'],true))throw new RuntimeException('Network hosting requires HTTPS.');
    $defaultBase=$config['base_path'] ?? 'auto';
    $base=ask('URL base path ['.($defaultBase ?: '/').'; auto detects the URL, / for site root]: ') ?: $defaultBase;
    if($base==='/')$base='';
    if($base!=='auto' && $base!=='' && !preg_match('~^(/[A-Za-z0-9_-][A-Za-z0-9._-]*)+/?$~D',$base))throw new RuntimeException('Use auto, a URL path such as /VeyonWeb, or / for the site root.');
    $config['base_path']=$base==='auto' ? null : rtrim($base,'/');
    $password=secret('Administrator password (12–72 characters): ');
    if(strlen($password)<12||strlen($password)>72)throw new RuntimeException('Use a password of 12–72 bytes.');
    if(!hash_equals($password,secret('Confirm password: ')))throw new RuntimeException('Passwords did not match.');
    $config['origin']=$origin;$config['teacher_password_hash']=password_hash($password,defined('PASSWORD_ARGON2ID')?PASSWORD_ARGON2ID:PASSWORD_DEFAULT);
    $defaultDirectory=$config['data_directory'] ?? dirname($config['database'] ?? dirname(__DIR__).'/data/classroom.sqlite');
    $directory=ask('Data directory ['.$defaultDirectory.']: ') ?: $defaultDirectory;
    if(!str_starts_with($directory,'/') || str_contains($directory,"\0"))throw new RuntimeException('Use an absolute data directory path.');
    $config['data_directory']=rtrim($directory,'/') ?: '/';
    if(isset($config['database']) && $directory!==$defaultDirectory)$config['database']=rtrim($directory,'/').'/'.basename($config['database']);
    $data="<?php\ndeclare(strict_types=1);\nreturn ".var_export($config,true).";\n";
    $old=umask(0027);
    try{if(file_put_contents($path.'.tmp',$data,LOCK_EX)===false)throw new RuntimeException('Cannot write configuration.');chmod($path.'.tmp',0640);rename($path.'.tmp',$path);}finally{umask($old);}
    $database=$config['database']??rtrim($config['data_directory'],'/').'/classroom.sqlite';
    $users=new \Classroom\Users(new \Classroom\Database($database));
    $users->provisionAdmin($config['teacher_username'],$config['teacher_password_hash']);
    chmod($database,0660);
    echo "Administrator account created/updated. Sign in and open Settings to manage users. Configure the Veyon key or logon credentials in config/local.php.\n";
    if(PHP_OS_FAMILY==='Linux') {
        $install=ask('Create the data directory and install/restart the systemd gateway service using sudo? [Y/n]: ');
        if($install==='' || in_array(strtolower($install),['y','yes'],true)) {
            $account=ask('Service user and group [www-data]: ') ?: 'www-data';
            installGatewayService($config,$path,$account);
        }
    } else {
        echo "Automatic service installation requires Linux/systemd.\n";
    }
}catch(Throwable $error){fwrite(STDERR,$error->getMessage()."\n");exit(1);}
