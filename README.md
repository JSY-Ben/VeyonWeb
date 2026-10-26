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

   On Linux, setup also prompts for the data directory and offers to install the systemd gateway service using `sudo`. Accept to create the directory with the chosen service account's ownership, generate the service with your installation and data paths, install it, reload systemd, enable it and restart it. The default service user and group are `www-data`. This replaces `/etc/systemd/system/veyon-gateway.service`; review any existing systemd overrides if they set paths. Existing classroom data is not moved automatically. If you accept this step, directory creation in step 3 and manual service installation in step 5 are already handled.

2. Edit `web/config/local.php`. In the `veyon` section, set your teacher username, key name and private-key path. Install the matching public key on the classroom PCs. For logon authentication, set `method` to `logon` and provide the Veyon username and password.

3. Set `data_directory` in `web/config/local.php` to an absolute path for the database, gateway log and PID file. Setup prompts for this location; the default is `/var/www/html/VeyonWeb/web/data`. Create it before starting the service:

   ```sh
   sudo install -d -o www-data -g www-data -m 0750 /var/www/html/VeyonWeb/web/data
   ```

   Substitute your chosen directory. Give the PHP web process and gateway service account read access to the configuration and private key, and write access to that directory. Keep credentials private. The supplied service uses `www-data`. Existing configurations with a `database` entry continue using that file; remove that entry to use `data_directory` for the database. Move existing data while the services are stopped if changing its location.

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

   The [supplied service](web/deploy/veyon-gateway.service) uses `/var/www/html/VeyonWeb` and `www-data`. Adjust these if needed. Set `ReadWritePaths` in the installed service to your `data_directory` (or the parent directory of an explicit `database` file). systemd cannot read the PHP configuration, so both locations must match. Then start it:

   ```sh
   sudo systemctl daemon-reload
   sudo systemctl enable --now veyon-gateway
   sudo systemctl status veyon-gateway
   ```

6. Open your HTTPS site and sign in. Add computers using their hostname/IP and Veyon port, then select **Connect classroom**. Choose **View** for a read-only session or **Remote control** for keyboard and mouse access.

Restart the gateway after changing its configuration: `sudo systemctl restart veyon-gateway`.
If you change `data_directory` later, rerun setup to regenerate the service, or update its `ReadWritePaths` manually and reload systemd before restarting.

## Maintenance

### Hosting under an existing website

If Apache already serves this location and executes PHP, the page and login need no Apache changes. Set `'base_path' => null` in `web/config/local.php` (or select `auto` during setup). Open the public entry point directly, for example `https://bookit.highlands.ac.uk/Web/VeyonWeb/web/public/index.php`. Assets and API requests use that directory, and login cookies are scoped to it. Opening `index.php` explicitly avoids changing Apache's DirectoryIndex. Keep `origin` as the hostname origin without a path.

Keep configuration, private keys and data outside the publicly accessible directory tree. If the whole checkout is inside an existing document root, verify those files are denied by existing server rules, or move the private files outside it (use `CLASSROOM_CONFIG` to select a configuration outside the checkout).

For a fixed public prefix behind an alias or proxy, set `base_path` explicitly, such as `/VeyonWeb`. Remote viewing/control still needs the WebSocket proxy below; the page and login do not. Keep `websocket_url` as `/remote` for that proxy.

Add [the subdirectory Apache example](web/deploy/apache-subdirectory.conf.example) inside your existing HTTPS virtual host, adjusting the alias, directory and proxy prefix. Expose only `web/public`, never the project directory containing configuration and private data. Use `DirectoryIndex index.php` so PHP supplies the configured base URL. The frontend calls `api.php` directly, so API rewrites are unnecessary. The WebSocket proxy strips the public prefix before forwarding to the gateway's `/remote` endpoint.

Run `sudo apachectl configtest`, reload Apache and restart the gateway. For the example prefix, open `https://your-host/VeyonWeb/`.

- Keep the dashboard and Veyon ports restricted to your trusted LAN or VPN.
- Back up `web/config/local.php`, your Veyon private key and `web/data/classroom.sqlite`. Use SQLite's backup facility or stop services before copying the database.
- For connection problems, check the Veyon credentials, PC reachability and access-control rules, then check Apache/PHP logs, `web/data/gateway.log` or `journalctl -u veyon-gateway`.

This is an independent community client. Application source is GPL-2.0-or-later; noVNC is MPL-2.0. See [LICENSE](LICENSE) and [THIRD_PARTY.md](THIRD_PARTY.md).
