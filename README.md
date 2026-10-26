# VeyonWeb

A web dashboard for viewing and remotely controlling Veyon classroom computers.

## Requirements

- Linux/Unix server with PHP 8.2+, Composer, and the OpenSSL, PDO SQLite, iconv, PCNTL and POSIX extensions.
- Apache 2.4.47+ with HTTPS and the `ssl`, `rewrite`, `headers`, `proxy` and `proxy_http` modules, plus mod_php.
- Network access to PCs running Veyon Server, normally on TCP port 11100, with Veyon authentication and access-control rules configured.

## Install and run on Apache

The commands below assume Debian/Ubuntu, mod_php, systemd and an installation at `/var/www/html/VeyonWeb`. Adjust paths, the PHP version and service account for your server.

1. Copy the project to `/var/www/html/VeyonWeb`, then install dependencies and create the dashboard login:

   ```sh
   cd /var/www/html/VeyonWeb/web
   composer install --no-dev --prefer-dist --optimize-autoloader
   php scripts/setup.php
   ```

   Enter a teacher username, password and HTTPS site origin, such as `https://classroom.school.example`, without a trailing slash.

2. Edit `web/config/local.php`. In the `veyon` section, set your teacher username, key name and private-key path. Install the matching public key on the classroom PCs. For logon authentication, set `method` to `logon` and provide the Veyon username and password.

3. Give the PHP web process and gateway service account read access to the configuration and private key, and write access to `web/data/`. Keep credentials private. The supplied service uses `www-data`.

4. Enable Apache's modules and copy the virtual host configuration:

   ```sh
   sudo a2enmod ssl rewrite headers proxy proxy_http
   sudo cp /var/www/html/VeyonWeb/web/apache-vhost.conf.example /etc/apache2/sites-available/veyonweb.conf
   sudoedit /etc/apache2/sites-available/veyonweb.conf
   ```

   Ensure mod_php is installed and enabled. Set your hostname and TLS certificate paths. Use a dedicated hostname with DocumentRoot **`/var/www/html/VeyonWeb/web/public`**. In `web/config/local.php`, keep `origin` equal to your HTTPS site origin and `websocket_url` set to `/remote`.

   Enable the site and check the configuration before restarting Apache:

   ```sh
   sudo a2ensite veyonweb.conf
   sudo apachectl configtest
   sudo systemctl restart apache2
   ```

5. Install the PHP gateway service required for remote sessions:

   ```sh
   sudo cp /var/www/html/VeyonWeb/web/deploy/veyon-gateway.service /etc/systemd/system/
   ```

   The [supplied service](web/deploy/veyon-gateway.service) uses `/var/www/html/VeyonWeb` and `www-data`. Adjust these if needed, then start it:

   ```sh
   sudo systemctl daemon-reload
   sudo systemctl enable --now veyon-gateway
   sudo systemctl status veyon-gateway
   ```

6. Open your HTTPS site and sign in. Add computers using their hostname/IP and Veyon port, then select **Connect classroom**. Choose **View** for a read-only session or **Remote control** for keyboard and mouse access.

Restart the gateway after changing its configuration: `sudo systemctl restart veyon-gateway`.

## Maintenance

- Keep the dashboard and Veyon ports restricted to your trusted LAN or VPN.
- Back up `web/config/local.php`, your Veyon private key and `web/data/classroom.sqlite`. Use SQLite's backup facility or stop services before copying the database.
- For connection problems, check the Veyon credentials, PC reachability and access-control rules, then check Apache/PHP logs, `web/data/gateway.log` or `journalctl -u veyon-gateway`.

This is an independent community client. Application source is GPL-2.0-or-later; noVNC is MPL-2.0. See [LICENSE](LICENSE) and [THIRD_PARTY.md](THIRD_PARTY.md).
