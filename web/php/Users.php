<?php
declare(strict_types=1);
namespace Classroom;

final class Users
{
    public function __construct(private Database $db) {}
    public static function username(mixed $value): string
    {
        if (!is_string($value) || !preg_match('/^[a-zA-Z0-9._-]{1,64}$/D',$value)) throw new \InvalidArgumentException('Use 1–64 letters, digits, dots, underscores or hyphens for the username.');
        return $value;
    }
    public static function hash(mixed $password): string
    {
        if (!is_string($password) || strlen($password)<12 || strlen($password)>72 || str_contains($password,"\0")) throw new \InvalidArgumentException('Passwords must contain 12–72 bytes.');
        return password_hash($password,defined('PASSWORD_ARGON2ID')?PASSWORD_ARGON2ID:PASSWORD_DEFAULT);
    }
    /** The permanent recovery administrator is stored only in local.php. */
    public static function master(): ?array
    {
        $config=Config::load();
        $hash=$config['masteradmin_password_hash'];
        if($config['demo'] || $hash==='' || !password_get_info($hash)['algo'])return null;
        $username=self::username($config['masteradmin_username']);
        return ['username'=>$username,'password_hash'=>$hash,'role'=>'admin','enabled'=>true,
            'fingerprint'=>hash('sha256',$username."\0".$hash)];
    }
    public function find(string $username): ?array
    {
        return $this->db->query('SELECT * FROM users WHERE username=? COLLATE NOCASE',[$username])->fetch() ?: null;
    }
    public function rooms(int $id): array
    {
        return $this->db->query('SELECT room FROM user_classrooms WHERE user_id=? ORDER BY room',[$id])->fetchAll(\PDO::FETCH_COLUMN);
    }
    public function listing(): array
    {
        $users=$this->db->query('SELECT id,username,role,enabled,created_at FROM users ORDER BY username COLLATE NOCASE')->fetchAll();
        $master=self::master();
        foreach($users as &$user){$user['reserved']=$master && strcasecmp($user['username'],$master['username'])===0;$user['enabled']=(bool)$user['enabled'];$user['classrooms']=$this->rooms((int)$user['id']);}
        return $users;
    }
    public function publicSession(?array $session): array
    {
        return ['authenticated'=>$session!==null,'username'=>$session['username']??null,'userId'=>$session['user_id']??null,'role'=>$session['role']??null,'isMaster'=>(bool)($session['is_master']??false),
            'classrooms'=>$session?$this->rooms((int)$session['user_id']):[]];
    }
    private function revoke(string $username): void
    {
        $this->db->query('DELETE FROM tickets WHERE session_id IN (SELECT id FROM sessions WHERE username=? COLLATE NOCASE AND id NOT IN (SELECT session_id FROM master_sessions))',[$username]);
        $this->db->query('DELETE FROM sessions WHERE username=? COLLATE NOCASE AND id NOT IN (SELECT session_id FROM master_sessions)',[$username]);
    }
    private function protectLastAdmin(array $old, string $role, bool $enabled): void
    {
        if(!self::master() && $old['role']==='admin' && $old['enabled'] && ($role!=='admin'||!$enabled) && (int)$this->db->query("SELECT COUNT(*) FROM users WHERE role='admin' AND enabled=1")->fetchColumn()<=1) throw new \InvalidArgumentException('Keep at least one enabled administrator.');
    }
    public function save(array $input): int
    {
        $id=$input['id']??null;
        if($id!==null && (!is_int($id)||$id<1)) throw new \InvalidArgumentException('Invalid user ID.');
        $username=self::username($input['username']??null);
        $master=self::master();if($master && strcasecmp($username,$master['username'])===0)throw new \InvalidArgumentException('This username belongs to the master administrator in local.php.');
        $role=$input['role']??'';$enabled=$input['enabled']??true;$rooms=$input['classrooms']??[];
        if(!in_array($role,['admin','supervisor','teacher'],true)||!is_bool($enabled)) throw new \InvalidArgumentException('Choose a valid role and enabled status.');
        if(!is_array($rooms)||!array_is_list($rooms)||count($rooms)>200) throw new \InvalidArgumentException('Choose valid classrooms.');
        foreach($rooms as $room)if(!is_string($room)||$room===''||strlen($room)>100)throw new \InvalidArgumentException('Invalid classroom assignment.');
        $rooms=$role==='teacher'?array_values(array_unique($rooms)):[];sort($rooms);
        $password=$input['password']??'';
        if(!is_string($password))throw new \InvalidArgumentException('Invalid password.');
        $hash=($id===null||$password!=='')?self::hash($password):null;
        return $this->db->transaction(function () use ($id,$username,$role,$enabled,$rooms,$hash): int {
            $old=$id?$this->db->query('SELECT * FROM users WHERE id=?',[$id])->fetch():null;
            if($id&&!$old)throw new \InvalidArgumentException('User no longer exists.');
            if($old&&$username!==$old['username'])throw new \InvalidArgumentException('Usernames cannot be changed. Create a new account instead.');
            $duplicate=$this->find($username);if($duplicate&&(int)$duplicate['id']!==$id)throw new \InvalidArgumentException('That username already exists.');
            if($old)$this->protectLastAdmin($old,$role,$enabled);
            foreach($rooms as $room)if(!$this->db->query('SELECT 1 FROM computers WHERE room=? LIMIT 1',[$room])->fetchColumn())throw new \InvalidArgumentException('Classroom no longer exists: '.$room);
            if(!$old){
                // Even callers outside the web API cannot create a non-admin first user.
                $first=!self::master() && !(bool)$this->db->query('SELECT 1 FROM users LIMIT 1')->fetchColumn();
                $this->db->query('INSERT INTO users(username,password_hash,role,enabled,created_at) VALUES (?,?,?,?,?)',[$username,$hash,$first?'admin':$role,$first?1:(int)$enabled,time()]);
                $userId=(int)$this->db->pdo->lastInsertId();if($first)$rooms=[];
            }else{
                $userId=$id;
                $changed=$hash!==null||$role!==$old['role']||$enabled!==(bool)$old['enabled']||$rooms!==$this->rooms($id);
                $this->db->query('UPDATE users SET password_hash=?,role=?,enabled=? WHERE id=?',[$hash??$old['password_hash'],$role,(int)$enabled,$id]);
                if($changed)$this->revoke($old['username']);
            }
            $this->db->query('DELETE FROM user_classrooms WHERE user_id=?',[$userId]);
            foreach($rooms as $room)$this->db->query('INSERT INTO user_classrooms VALUES (?,?)',[$userId,$room]);
            return $userId;
        });
    }
    public function delete(int $id): void
    {
        $this->db->transaction(function () use ($id): void {
            $user=$this->db->query('SELECT * FROM users WHERE id=?',[$id])->fetch();
            if(!$user)throw new \InvalidArgumentException('User no longer exists.');
            $this->protectLastAdmin($user,'teacher',false);$this->revoke($user['username']);
            $this->db->query('DELETE FROM users WHERE id=?',[$id]);
        });
    }
}
