# VeyonWeb

Welcome to VeyonWeb! A PHP Web Dashboard for viewing and remotely controlling Veyon classroom computers!

Once installed, you can add any computer with a Veyon installation onto the dashboard, group them into particular classroms, create users who can login to the dashboard and give them appropriate permissions to specific features and groups. 

Supported Veyon features include screenshots, text messages, screen lock/unlock, opening websites, running programs, Wake-on-LAN, restart/shutdown/logoff, and file distribution.

## Requirements

- Linux server with PHP 8.3+, Composer, and the OpenSSL, PDO SQLite, iconv, PCNTL and POSIX PHP extensions.
- Apache 2.4.47+ with HTTPS and the `ssl`, `rewrite`, `headers`, `proxy` and `proxy_http` modules, plus mod_php.
- Network access to PCs running Veyon, normally on TCP port 11100, with Veyon authentication and access-control rules configured. Either password or key authentication is supported. 
- Access to your server's 'systemd', so the background gateway process that connects to Veyon instances on your network can run. 
- Keep any configuration, private keys and data outside the publicly accessible `public` folder. 
- While this may very well work on Windows or Mac based Web servers, it so far hasn't been tested. 

## Install and run on Linux/Apache

The commands below are based on an Debian/Ubuntu installation, with Apache Web server using mod_php

1. Copy the project to your new site's root. For this example, we will use `/var/www/html/VeyonWeb`, then install dependencies and run the setup PHP script in Terminal as below:

   ```sh
   cd /var/www/html/VeyonWeb/web
   composer install --no-dev --prefer-dist --optimize-autoloader
   php scripts/setup.php
   ```

2. Answer the questions asked in the setup prompts. It will ask for a Master Administrator username, password and HTTPS site origin, such as `https://classroom.school.example`, without a trailing slash. Setup will then create your config file in the config folder of the installation, called `local.php`. Future users will be setup in the app itself, and saved in a local SQLite database. 

On Linux, the setup script will also prompt you for a location for the data directory and offers to install the systemd gateway service using `sudo`. The gateway service is a background proess that is always running to allow the web dashboard to connect to your Veyon instances.
   
Accept to create the data directory, and install the gateway background service, The default user and group used to own and run these folders and services is `www-data`. 


3. Edit the newly created config file at `web/config/local.php`. In the `veyon` section, set your Veyon login method (`key` or `logon` ) using the `method` setting. If you use keys for authentication, set the key name and path to your private key in `key_name` and `private_key_file` respectively. Of course, don't forget to install the matching public key on the classroom PCs. For logon authentication, set `method` to `logon` and provide the Veyon `username` and `password`. 


4. Open your new site in the browser and sign in using your set master admin username and password. Add computers using their hostname/IP and Veyon port, and their previews refresh automatically. Choose **View** for a live read-only session or **Remote control** for keyboard and mouse access.

5. Any changes made to the configuration after installation, including in the web dashboard 'Settings' app will likely require the gateway to be restarted. To do so, run `sudo systemctl restart veyon-gateway` in Terminal.


## Configuration after Installation

### Users, roles and settings

The permanent **master administrator** is stored in `config/local.php` as `masteradmin_username` and `masteradmin_password_hash`. It always has full access and remains available independently of database users. Run `php scripts/setup.php` to create or reset this backup account. Additional admins, supervisors and teachers are managed in the `Settings` page on the ap and stored in SQLite. The master account cannot be edited or deleted through Settings; its username is reserved.


Admins can open **Settings** in the sidebar to create accounts, choose roles, assign teacher classrooms, disable/delete users and reset passwords. 


The **Appearance** tab in Settings controls the app name, primary colour, light/dark/device colour mode, logo and login-page graphic.


This is an independent community client. Application source is GPL-2.0-or-later; noVNC is MPL-2.0. See [LICENSE](LICENSE) and [THIRD_PARTY.md](THIRD_PARTY.md).
