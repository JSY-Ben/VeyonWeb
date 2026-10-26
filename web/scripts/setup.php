<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
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
    $path=dirname(__DIR__).'/config/local.php';
    $config=require (is_file($path)?$path:dirname(__DIR__).'/config/example.php');
    $config['teacher_username']=ask('Teacher username [teacher]: ') ?: 'teacher';
    if(!preg_match('/^[a-zA-Z0-9._-]{1,64}$/',$config['teacher_username']))throw new RuntimeException('Use letters, digits, dots, underscores or hyphens.');
    $origin=ask('Site origin [https://classroom.school.example]: ') ?: 'https://classroom.school.example';
    $parts=parse_url($origin);
    if(!$parts || !in_array($parts['scheme']??'',['http','https'],true) || empty($parts['host']) || isset($parts['path']) || isset($parts['query']) || isset($parts['fragment']) || isset($parts['user']))throw new RuntimeException('Enter a complete origin without a trailing slash.');
    if($parts['scheme']!=='https'&&!in_array($parts['host'],['127.0.0.1','localhost'],true))throw new RuntimeException('Network hosting requires HTTPS.');
    $password=secret('Teacher password (12–72 characters): ');
    if(strlen($password)<12||strlen($password)>72)throw new RuntimeException('Use a password of 12–72 bytes.');
    if(!hash_equals($password,secret('Confirm password: ')))throw new RuntimeException('Passwords did not match.');
    $config['origin']=$origin;$config['teacher_password_hash']=password_hash($password,defined('PASSWORD_ARGON2ID')?PASSWORD_ARGON2ID:PASSWORD_DEFAULT);
    // Resolve the example’s relative database path before writing configuration.
    $config['database']=dirname(__DIR__).'/data/classroom.sqlite';
    $data="<?php\ndeclare(strict_types=1);\nreturn ".var_export($config,true).";\n";
    $old=umask(0027);
    try{if(file_put_contents($path.'.tmp',$data,LOCK_EX)===false)throw new RuntimeException('Cannot write configuration.');chmod($path.'.tmp',0640);rename($path.'.tmp',$path);}finally{umask($old);}
    echo "Teacher login saved in config/local.php. Configure the Veyon key or logon credentials there, then start the PHP gateway.\n";
}catch(Throwable $error){fwrite(STDERR,$error->getMessage()."\n");exit(1);}
