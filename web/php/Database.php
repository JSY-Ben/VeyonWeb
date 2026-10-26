<?php
declare(strict_types=1);
namespace Classroom;

final class Database
{
    public \PDO $pdo;
    public function __construct(string $path)
    {
        if (!is_dir(dirname($path)) && !mkdir(dirname($path), 0770, true) && !is_dir(dirname($path))) throw new \RuntimeException('Cannot create data directory.');
        $this->pdo = new \PDO('sqlite:' . $path, null, null, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION, \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC]);
        $this->pdo->exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS computers (id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, room TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, computer_id TEXT NOT NULL REFERENCES computers(id) ON DELETE CASCADE, mode TEXT NOT NULL, expires INTEGER NOT NULL, generation INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS attempts (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
            INSERT OR IGNORE INTO meta VALUES (\'generation\', 0);');
        if (!in_array('mac', array_column($this->query('PRAGMA table_info(computers)')->fetchAll(), 'name'), true)) {
            try { $this->pdo->exec("ALTER TABLE computers ADD COLUMN mac TEXT NOT NULL DEFAULT ''"); }
            catch (\PDOException $error) {
                if (!in_array('mac', array_column($this->query('PRAGMA table_info(computers)')->fetchAll(), 'name'), true)) throw $error;
            }
        }
    }
    public function query(string $sql, array $args = []): \PDOStatement { $statement = $this->pdo->prepare($sql); $statement->execute($args); return $statement; }
    public function transaction(callable $callback): mixed
    {
        $this->pdo->exec('BEGIN IMMEDIATE');
        try { $result = $callback(); $this->pdo->exec('COMMIT'); return $result; }
        catch (\Throwable $error) { $this->pdo->exec('ROLLBACK'); throw $error; }
    }
    public function cleanup(): void
    {
        $now = time();
        $this->query('DELETE FROM sessions WHERE expires <= ?', [$now]);
        $this->query('DELETE FROM tickets WHERE expires <= ?', [$now]);
        $this->query('DELETE FROM attempts WHERE expires <= ?', [$now]);
    }
    public function session(string $cookie): ?array
    {
        if (!preg_match('/^[a-f0-9]{64}$/', $cookie)) return null;
        $session = $this->query('SELECT * FROM sessions WHERE id = ? AND expires > ?', [hash('sha256', $cookie), time()])->fetch();
        return $session ?: null;
    }
    public function generation(): int { return (int)$this->query('SELECT value FROM meta WHERE name = \'generation\'')->fetchColumn(); }
    public function roster(): array { return $this->query('SELECT * FROM computers ORDER BY rowid')->fetchAll(); }
    public static function validateRoster(mixed $values): array
    {
        if (!is_array($values) || !array_is_list($values) || count($values) > 200) throw new \InvalidArgumentException('A directory must be a list of up to 200 computers.');
        $ids = []; $result = [];
        foreach ($values as $computer) {
            if (!is_array($computer) || !is_string($computer['name'] ?? null) || trim($computer['name']) === '' || strlen($computer['name']) > 100 || !is_string($computer['room'] ?? null) || trim($computer['room']) === '' || strlen($computer['room']) > 100 || !is_string($computer['host'] ?? null) || !preg_match('/^[a-zA-Z0-9._:\-]{1,253}$/', $computer['host']) || !is_int($computer['port'] ?? null) || $computer['port'] < 1 || $computer['port'] > 65535) throw new \InvalidArgumentException('Each computer needs a name, classroom, valid hostname/IP and port (1–65535).');
            $id = $computer['id'] ?? bin2hex(random_bytes(16));
            if (!is_string($id) || !preg_match('/^[a-zA-Z0-9-]{1,64}$/', $id) || isset($ids[$id])) throw new \InvalidArgumentException('Computer IDs must be unique.');
            $mac = $computer['mac'] ?? '';
            if (!is_string($mac) || ($mac !== '' && !preg_match('/^(?:[a-f0-9]{2}[:-]){5}[a-f0-9]{2}$/iD', $mac))) throw new \InvalidArgumentException('Use a MAC address such as 00:11:22:33:44:55, or leave it empty.');
            $ids[$id] = true;
            $result[] = ['id' => $id, 'name' => trim($computer['name']), 'host' => $computer['host'], 'port' => $computer['port'], 'room' => trim($computer['room']), 'mac' => strtoupper(str_replace('-', ':', $mac))];
        }
        return $result;
    }
    public function saveRoster(array $computers): void
    {
        $this->transaction(function () use ($computers) {
            $this->query('DELETE FROM tickets'); $this->query('DELETE FROM computers');
            foreach ($computers as $c) $this->query('INSERT INTO computers (id,name,host,port,room,mac) VALUES (?,?,?,?,?,?)', [$c['id'], $c['name'], $c['host'], $c['port'], $c['room'], $c['mac'] ?? '']);
            $this->query('UPDATE meta SET value = value + 1 WHERE name = \'generation\'');
        });
    }
    public function consumeTicket(string $token, string $cookie): ?array
    {
        if (!preg_match('/^[a-f0-9]{64}$/', $token)) return null;
        return $this->transaction(function () use ($token, $cookie) {
            $session = $this->session($cookie); if (!$session) return null;
            $ticket = $this->query('SELECT t.*, c.host, c.port FROM tickets t JOIN computers c ON c.id=t.computer_id WHERE t.id=? AND t.session_id=? AND t.expires>?', [hash('sha256', $token), $session['id'], time()])->fetch();
            if (!$ticket || (int)$ticket['generation'] !== $this->generation()) return null;
            $this->query('DELETE FROM tickets WHERE id=?', [$ticket['id']]); return $ticket;
        });
    }
}
