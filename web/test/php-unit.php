<?php
declare(strict_types=1);
require dirname(__DIR__) . '/vendor/autoload.php';
use Classroom\Wire;
use Classroom\RfbFilter;
use Classroom\Database;
use Classroom\VeyonHandshake;
use Classroom\Features;

$passed = 0;
function check(bool $value,string $message): void { if (!$value) throw new RuntimeException($message); }
function same(mixed $actual,mixed $expected): void { check($actual === $expected,'Expected ' . var_export($expected,true) . ', got ' . var_export($actual,true)); }
function rejects(callable $function): void { try { $function(); } catch (Throwable) { return; } throw new RuntimeException('Expected an exception.'); }
function runTest(string $name,callable $function): void { global $passed; $function(); $passed++; echo "PASS $name\n"; }

runTest('Qt wire fixtures and Unicode',function (): void {
    same(bin2hex(Wire::variant(3)),'000000020000000003');
    same(bin2hex(Wire::variant('A')),'0000000a00000000020041');
    same(bin2hex(Wire::variant("\xab\xcd",true)),'0000000c0000000002abcd');
    same(bin2hex(Wire::message()),'00000000');
    same(Wire::decode(Wire::variant(3).Wire::variant('tëacher').Wire::variant("\x01\x02",true)),[3,'tëacher',"\x01\x02"]);
    rejects(fn() => Wire::decode(hex2bin('0000000a000000004000')));
});
runTest('Read-only filtering rejects keyboard/mouse/clipboard/resize across fragmented packets',function (): void {
    $key=hex2bin('0401000000000041'); $pointer=hex2bin('0501000a0014'); $update=hex2bin('03000000000000020002'); $clipboard=hex2bin('060000000000000141');
    $input=$key.$pointer.$clipboard.$update; $filter=new RfbFilter(true); $output='';
    foreach (str_split($input) as $byte) $output.=$filter->push($byte);
    same($output,$update);same((new RfbFilter(false))->push($input),$input);
    $resize=hex2bin('fb00000200020000');same((new RfbFilter(true))->push($resize),'');
    rejects(fn() => (new RfbFilter(false))->push(chr(99)));
});
foreach (["RFB 003.008\n", "RFB 003.008\0", "RFB 003.007\n", "RFB 003.007\0"] as $greeting) runTest('PHP Veyon key handshake handles fragmented greeting '.bin2hex($greeting),function () use ($greeting): void {
    $key=openssl_pkey_new(['private_key_bits'=>2048,'private_key_type'=>OPENSSL_KEYTYPE_RSA]);openssl_pkey_export($key,$pem);
    $sent=[];$ready=false;
    $handshake=new VeyonHandshake(['method'=>'key','username'=>'teacher','key_name'=>'teacher','private_key'=>$pem],function ($bytes) use (&$sent) {$sent[]=$bytes;},function ($remaining) use (&$ready) {$ready=true;same($remaining,'');});
    $challenge=random_bytes(128);
    $bytes=$greeting."\x01\x28".Wire::message([Wire::variant(1),Wire::variant(3)]).Wire::message().Wire::message([Wire::variant($challenge,true)]).pack('N',0);
    foreach(str_split($bytes,3) as $chunk)$handshake->push($chunk);
    check($ready,'Handshake did not finish.');same($sent[0],"RFB 003.008\n");same($sent[1],chr(40));
    same(Wire::decode(substr($sent[2],4)),[3,'teacher']);$response=Wire::decode(substr($sent[3],4));same($response[0],'teacher');
    same(openssl_verify($challenge,$response[1],openssl_pkey_get_details($key)['key'],OPENSSL_ALGO_SHA512),1);
});
runTest('Invalid Veyon greetings remain rejected', function (): void {
    foreach (["RFB 003.008\r", "RFB 003.003\n", "HTTP/1.1 200"] as $greeting) {
        $handshake = new VeyonHandshake(['method'=>'key'], function () {}, function () {});
        rejects(fn() => $handshake->push(str_pad($greeting, 12, ' ')));
    }
});
runTest('SQLite ticket consumption, logout and roster revocation',function (): void {
    $path=sys_get_temp_dir().'/veyon-php-unit-'.bin2hex(random_bytes(8)).'.sqlite';
    try {
        $db=new Database($path);$cookie=bin2hex(random_bytes(32));$sessionId=hash('sha256',$cookie);
        $db->query('INSERT INTO sessions VALUES (?,?,?)',[$sessionId,'teacher',time()+100]);
        $db->saveRoster(Database::validateRoster([['id'=>'lab','name'=>'Lab','host'=>'lab.local','port'=>11100,'room'=>'Lab']]));
        $ticket=bin2hex(random_bytes(32));$db->query('INSERT INTO tickets VALUES (?,?,?,?,?,?)',[hash('sha256',$ticket),$sessionId,'lab','control',time()+30,$db->generation()]);
        check($db->consumeTicket($ticket,str_repeat('a',64))===null,'Ticket worked with another cookie.');
        same($db->consumeTicket($ticket,$cookie)['mode'],'control');same($db->consumeTicket($ticket,$cookie),null);
        $db->query('DELETE FROM sessions WHERE id=?',[$sessionId]);same($db->session($cookie),null);
        rejects(fn() => Database::validateRoster([['name'=>'Lab','room'=>'Lab','host'=>'http://bad/path','port'=>11100]]));
        $db=null;
    } finally {foreach ([$path,$path.'-wal',$path.'-shm'] as $file)if(is_file($file))unlink($file);}
});
runTest('Classroom command validation, Qt feature types and Wake-on-LAN packet', function (): void {
    same(bin2hex(Wire::uuid('ccb535a2-1d24-4cc1-a709-8b47d2b2ac79')), '0000001e00ccb535a21d244cc1a7098b47d2b2ac79');
    same(bin2hex(Wire::boolean(true)), '000000010001');
    same(bin2hex(Wire::strings(['A'])), '0000000b0000000001000000020041');
    same(bin2hex(Wire::map([0=>Wire::variant(7)])), '000000080000000001000000020030000000020000000007');
    rejects(fn()=>Features::command('unknown', []));
    rejects(fn()=>Features::command('reboot', []));
    rejects(fn()=>Features::command('shutdown', ['confirmed'=>'true']));
    rejects(fn()=>Features::command('website', ['url'=>'file:///etc/passwd']));
    rejects(fn()=>Features::command('program', ['program'=>"bad\0program"]));
    foreach (['../lesson.txt', '..', 'C:\\file.txt', "bad\n.txt", 'file.'] as $name) rejects(fn()=>Features::filename($name));
    same(Features::filename('lesson notes.pdf'), 'lesson notes.pdf');
    $packet=Features::magicPacket('00:11:22:33:44:55');same(strlen($packet),102);
    same(bin2hex($packet),str_repeat('ff',6).str_repeat('001122334455',16));
    rejects(fn()=>Features::magicPacket(''));
    $roster=Database::validateRoster([['name'=>'PC','host'=>'pc.local','port'=>11100,'room'=>'Room','mac'=>'aa-bb-cc-dd-ee-ff']]);
    same($roster[0]['mac'],'AA:BB:CC:DD:EE:FF');
    rejects(fn()=>Database::validateRoster([['name'=>'PC','host'=>'pc.local','port'=>11100,'room'=>'Room','mac'=>'not-a-mac']]));
});
echo "$passed PHP tests passed.\n";
