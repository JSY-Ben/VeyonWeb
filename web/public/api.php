<?php
declare(strict_types=1);
use Classroom\Config;
use Classroom\Database;
use Classroom\Features;
use Classroom\FeatureClient;
use Classroom\Users;
use Classroom\Settings;
require dirname(__DIR__) . '/vendor/autoload.php';

function respond(int $status, array $body): never { http_response_code($status); echo json_encode($body, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE); exit; }
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: no-referrer');
try {
    $config = Config::load();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $route = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if (isset($_GET['route'])) {
        if (!is_string($_GET['route'])) respond(400, ['error' => 'Invalid route.']);
        $route = $_GET['route'];
    } elseif ($config['base_path'] !== '' && str_starts_with($route, $config['base_path'] . '/')) {
        $route = substr($route, strlen($config['base_path']));
    }
    if (!in_array($method, ['GET', 'HEAD', 'OPTIONS'], true) && ($_SERVER['HTTP_ORIGIN'] ?? '') !== $config['origin']) respond(403, ['error' => 'Request origin rejected.']);
    if($route==='/api/appearance' && $method==='GET')respond(200,['appearance'=>Settings::appearance($config)]);
    $upload = $route === '/api/files' && $method === 'POST';
    $limit = $upload ? $config['max_upload_bytes'] + 65536 : ($route==='/api/settings'?1048576:131072);
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > $limit) respond(413, ['error' => 'Request exceeds the configured size limit.']);
    $raw = $upload ? '' : file_get_contents('php://input', false, null, 0, $limit+1);
    if (strlen($raw) > $limit) respond(413, ['error' => 'Request is too large.']);
    $body = $raw !== '' ? json_decode($raw, true, 64, JSON_THROW_ON_ERROR) : [];
    $db = new Database($config['database']); $db->cleanup();
    $users=new Users($db);
    if($config['demo']&&!$users->find('demo'))$users->save(['username'=>'demo','password'=>bin2hex(random_bytes(16)),'role'=>'admin']);
    $master=Users::master();
    $session = $db->session($_COOKIE['classroom'] ?? '');
    $settingsNotice='';
    $cookieOptions = ['expires' => time() + 28800, 'path' => $config['base_path'] . '/', 'secure' => str_starts_with($config['origin'], 'https://'), 'httponly' => true, 'samesite' => 'Strict'];
    if ($route === '/api/session' && $method === 'GET') respond(200, $users->publicSession($session)+['demo'=>$config['demo'],'settingsNotice'=>$settingsNotice,'setupRequired'=>!$master && !(bool)$db->query('SELECT 1 FROM users LIMIT 1')->fetchColumn()]);
    if ($route === '/api/login' && $method === 'POST') {
        $loginName=$config['demo']?'demo':(is_string($body['username']??null)?$body['username']:'');
        // A user's successful login must not reset another account's failures.
        $ip = ($_SERVER['REMOTE_ADDR'] ?? 'unknown').'|'.hash('sha256',strtolower($loginName));
        $attempt = $db->transaction(function () use ($db, $ip) {
            $db->query('INSERT INTO attempts (ip,count,expires) VALUES (?,1,?) ON CONFLICT(ip) DO UPDATE SET count=count+1', [$ip, time()+900]);
            return (int)$db->query('SELECT count FROM attempts WHERE ip=?', [$ip])->fetchColumn();
        });
        if ($attempt > 10) respond(429, ['error' => 'Too many attempts. Try again in 15 minutes.']);
        $isMaster=$master && strcasecmp($loginName,$master['username'])===0;
        $account=$isMaster?$master:$users->find($loginName);
        $dummyHash='$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';
        $valid=$config['demo'] || (is_string($body['password']??null) && strlen($body['password'])<=1024 && password_verify($body['password'],$account['password_hash']??$dummyHash));
        if (!$valid || !$account || !$account['enabled']) respond(401, ['error' => 'Username or password is incorrect.']);
        if ($session) $db->query('DELETE FROM sessions WHERE id=?', [$session['id']]);
        $token = bin2hex(random_bytes(32));
        $db->transaction(function () use($db,$token,$account,$isMaster): void {
            $id=hash('sha256',$token);
            $db->query('INSERT INTO sessions VALUES (?,?,?)',[$id,$account['username'],time()+28800]);
            if($isMaster)$db->query('INSERT INTO master_sessions VALUES (?,?)',[$id,$account['fingerprint']]);
        });
        $db->query('DELETE FROM attempts WHERE ip=?', [$ip]);
        setcookie('classroom', $token, $cookieOptions); respond(200, ['ok' => true]);
    }
    if ($route === '/api/logout' && $method === 'POST') {
        if ($session) $db->query('DELETE FROM sessions WHERE id=?', [$session['id']]);
        $cookieOptions['expires'] = 1; setcookie('classroom', '', $cookieOptions); respond(200, ['ok' => true]);
    }
    if (!$session) respond(401, ['error' => 'Sign in to your account.']);
    $isAdmin=$session['role']==='admin'&&!$config['demo'];
    if(in_array($route,['/api/users','/api/settings'],true)){
        if(!$isAdmin)respond(403,['error'=>'Administrator access is required.']);
        if($route==='/api/users'){
            if($method==='POST'||$method==='PUT'){
                if(!is_array($body))respond(400,['error'=>'Invalid user.']);
                if($method==='PUT'&&!isset($body['id']))respond(400,['error'=>'Choose a user to update.']);
                if($method==='POST'&&isset($body['id']))respond(400,['error'=>'New users cannot specify an ID.']);
                $id=$users->save($body);respond(200,['id'=>$id,'sessionRevoked'=>$db->sessionById($session['id'])===null]);
            }
            if($method==='DELETE'){
                if(!is_int($body['id']??null))respond(400,['error'=>'Choose a valid user.']);
                $users->delete($body['id']);respond(200,['ok'=>true,'sessionRevoked'=>$db->sessionById($session['id'])===null]);
            }
            if($method==='GET')respond(200,['masterAdmin'=>$master?['username'=>$master['username']]:null,'users'=>$users->listing(),'classrooms'=>$db->query('SELECT DISTINCT room FROM computers ORDER BY room')->fetchAll(PDO::FETCH_COLUMN)]);
        }else{
            if($method==='PUT'){
                if(!is_array($body)||array_is_list($body))respond(400,['error'=>'Invalid settings.']);
                Settings::save($body);$config=Config::load();$settingsNotice='';
            }
            if(in_array($method,['GET','PUT'],true))respond(200,['settings'=>Settings::values($config),'notice'=>$settingsNotice]);
        }
        respond(405,['error'=>'Method not allowed.']);
    }
    if ($route === '/api/computers' && $method === 'GET') {
        $computers = $db->accessibleRoster($session);
        if ($config['demo']) $computers = array_map(fn($i) => ['id' => "demo-$i", 'name' => 'Studio ' . str_pad((string)$i, 2, '0', STR_PAD_LEFT), 'host' => "studio-$i.school.local", 'port' => 11100, 'room' => $i <= 6 ? 'Design studio' : 'Library'], range(1, 8));
        respond(200, ['computers' => $computers, 'ready' => $config['demo'] || Config::ready($config), 'demo' => $config['demo'], 'settingsNotice'=>$settingsNotice,'authMethod' => $config['veyon']['method'], 'maxUploadBytes' => $config['max_upload_bytes'], 'overviewRefreshSeconds' => $config['overview_refresh_seconds'], 'overviewStaggerMs' => $config['overview_stagger_ms'], 'connectionTimeoutSeconds' => $config['connection_timeout_seconds'], 'previewTimeoutSeconds' => $config['preview_timeout_seconds'], 'overviewMaxConnections' => $config['overview_max_connections'], 'overviewRetrySeconds' => $config['overview_retry_seconds']]);
    }
    if ($route === '/api/computers' && $method === 'PUT') {
        if(!$isAdmin)respond(403,['error'=>'Only administrators can edit computers or classrooms.']);
        if ($config['demo']) respond(403, ['error' => 'The sample classroom cannot be edited. Start the live server to add your computers.']);
        $values = Database::validateRoster($body); $db->saveRoster($values); respond(200, ['computers' => $values]);
    }
    if (($route === '/api/actions' || $upload) && $method === 'POST') {
        if(!$isAdmin)respond(403,['error'=>'Classroom commands require administrator access. View, control and screenshots remain available for your classrooms.']);
        if ($config['demo']) respond(409, ['error' => 'Classroom actions are unavailable in sample mode.']);
        $input = $upload ? $_POST : $body;
        if (!is_array($input)) respond(400, ['error' => 'Invalid action request.']);
        $computer = $db->query('SELECT * FROM computers WHERE id=?', [is_string($input['computerId'] ?? null) ? $input['computerId'] : ''])->fetch();
        if (!$computer) respond(404, ['error' => 'Computer not found.']);
        if (!$upload && ($input['action'] ?? '') === 'wake') {
            Features::wake($computer['mac'], $config['wake_broadcast']);
            respond(200, ['status' => 'sent', 'message' => 'Wake packet sent. Power-on depends on the PC and network configuration.']);
        }
        if (!Config::ready($config)) respond(503, ['error' => 'Configure Veyon credentials before sending classroom actions.']);
        if ($upload) {
            $file = $_FILES['file'] ?? null;
            if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_string($file['tmp_name'] ?? null) || !is_uploaded_file($file['tmp_name'])) respond(400, ['error' => 'Upload failed. Check PHP upload_max_filesize and post_max_size.']);
            if ($file['size'] > $config['max_upload_bytes']) respond(413, ['error' => 'File exceeds the configured upload limit.']);
            Features::filename($file['name']);
            $client = new FeatureClient($computer, $config['veyon'], $config['connection_timeout_seconds'], $config['preview_timeout_seconds']);
            try { Features::distribute($client, $file['tmp_name'], $file['name'], ($input['overwrite'] ?? '') === '1', ($input['open'] ?? '') === '1'); }
            finally { $client->close(); }
            respond(200, ['status' => 'sent', 'message' => 'File sent to Veyon’s configured destination. Veyon does not acknowledge that the file was saved; check the target PC.']);
        }
        if (!is_string($input['action'] ?? null)) respond(400, ['error' => 'Choose a classroom action.']);
        $command = Features::command($input['action'], $input);
        $client = new FeatureClient($computer, $config['veyon'], $config['connection_timeout_seconds'], $config['preview_timeout_seconds']);
        try { $client->send($command); } finally { $client->close(); }
        respond(200, ['status' => 'sent', 'message' => 'Command sent to Veyon. Execution depends on client permissions and the active user session.']);
    }
    if ($route === '/api/tickets' && $method === 'POST') {
        if ($config['demo']) respond(409, ['error' => 'Sample screens are simulated. Connect your Veyon computers for remote control.']);
        $computer = $db->query('SELECT * FROM computers WHERE id=?', [is_string($body['computerId'] ?? null) ? $body['computerId'] : ''])->fetch();
        if (!$computer) respond(404, ['error' => 'Computer not found.']);
        if(!$db->canAccess($session,$computer['room']))respond(403,['error'=>'You do not have access to this classroom.']);
        if (!in_array($body['mode'] ?? null, ['view', 'control'], true)) respond(400, ['error' => 'Invalid session mode.']);
        if (!Config::ready($config)) respond(503, ['error' => 'Configure Veyon authentication on the PHP gateway first. See Connection & help.']);
        if ((int)$db->query('SELECT COUNT(*) FROM tickets')->fetchColumn() >= 512) respond(429, ['error' => 'Too many pending sessions. Try again shortly.']);
        $token = bin2hex(random_bytes(32));
        $db->query('INSERT INTO tickets VALUES (?,?,?,?,?,?)', [hash('sha256', $token), $session['id'], $computer['id'], $body['mode'], time()+30, $db->generation()]);
        $socketPath = $config['websocket_url'] === '/remote' ? $config['base_path'] . '/remote' : $config['websocket_url'];
        respond(200, ['path' => $socketPath . '?ticket=' . $token]);
    }
    respond(404, ['error' => 'API route not found.']);
} catch (\JsonException | \InvalidArgumentException $error) { respond(400, ['error' => $error->getMessage()]); }
catch (\Classroom\ConfigWriteException $error) { respond(500,['error'=>$error->getMessage()]); }
catch (\Throwable $error) {
    error_log('Veyon API: ' . $error->getMessage());
    if (isset($route) && in_array($route, ['/api/actions', '/api/files'], true) && get_class($error) === \RuntimeException::class) respond(502, ['error' => $error->getMessage()]);
    respond(503, ['error' => 'The PHP service is not ready. Check server configuration and data-directory permissions.']);
}
