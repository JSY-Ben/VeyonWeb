# Attribution and protocol references

VeyonWeb is an independent web client and gateway, not an official Veyon release. Veyon is developed by Tobias Junghans / Veyon Solutions and contributors: https://github.com/veyon/veyon.

The gateway implements the Veyon RFB security-type 40 handshake and Qt 5.5 QVariant serialization. Protocol behavior was checked against these upstream files on `main` on 2026-10-16:

- `core/src/RfbVeyonAuth.h`
- `core/src/VariantStream.cpp` and `VariantArrayMessage.cpp`
- `core/src/VeyonConnection.cpp` and `VncServerProtocol.cpp`
- `core/src/CryptoCore.h`
- `server/src/ServerAuthenticationManager.cpp`

Upstream is GPL-2.0-or-later. The application is also provided under GPL-2.0-or-later; see LICENSE. The gateway is PHP written for this project rather than a bundled Veyon executable. The JavaScript protocol implementation retained under web/test/ is only a simulated test peer.

The browser remote-desktop client is **noVNC 1.6.0**, copyright its contributors, MPL-2.0: https://github.com/novnc/noVNC/tree/v1.6.0. It is installed from `@novnc/novnc` and bundled locally by esbuild. Its source and individual notices are available in that package and the upstream tag. A license copy is served at `/LICENSE-noVNC.txt`. The build preserves bundled legal comments. The package's `docs/LICENSE*` files document additional component licenses.

PHP runtime dependencies Workerman and workerman/coroutine retain their MIT licenses. Composer pins them in `web/composer.lock`; installed packages contain the license notices. Optional development dependencies ws and esbuild are MIT licensed and are pinned in `web/package-lock.json`. Node.js is not a production runtime requirement. No third-party screen images, fonts, or Veyon logos are included; sample desktop scenes are generated locally and explicitly labeled as simulated.
