<?php
declare(strict_types=1);
require __DIR__ . '/../scripts/gateway-service.php';
function check(bool $condition): void { if (!$condition) throw new RuntimeException('Service generation check failed.'); }
$service = gatewayService('/srv/Veyon Web', '/var/lib/veyon data', 'www-data');
check(str_contains($service, 'WorkingDirectory="/srv/Veyon Web"'));
check(str_contains($service, '"/srv/Veyon Web/gateway.php" start'));
check(str_contains($service, "ReadWritePaths=\nReadWritePaths=\"/var/lib/veyon data\""));
check(!str_contains($service, '/var/www/html/VeyonWeb'));
check(systemdValue('/srv/100%/$path') === '"/srv/100%%/$$path"');
try { gatewayService("/srv/bad\npath", '/data', 'www-data'); throw new LogicException('Control character accepted.'); }
catch (RuntimeException $error) { check($error->getMessage() === 'Service paths cannot contain control characters.'); }
try { gatewayService('/srv/app', '/data', 'bad user'); throw new LogicException('Invalid account accepted.'); }
catch (RuntimeException $error) { check($error->getMessage() === 'Invalid service account.'); }
echo "PASS gateway service paths, quoting and account validation\n";
