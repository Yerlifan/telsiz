# Telsiz desktop app

[Türkçe](README.md)

This folder is the Electron based desktop app of Telsiz for Windows and Linux. This document is for developers. Installation instructions for users are in the README at the repository root.

## Why a separate app

In the web version the interface code comes from the server every time the page opens. If the server is compromised, users can be served modified code. This is a known limit of every end-to-end encrypted application that runs in a browser.

In the desktop app the interface code ships inside the app and is never downloaded from the server. The server only answers API requests and only sees encrypted data. A compromised server therefore cannot serve modified code to desktop users.

## Security architecture

- At build time only the files of `public/` that match the server whitelist are copied to `desktop/app/` (except the service worker). The sha256 and size of every file are written to the `desktop/app/butunluk.json` manifest.
- At startup the app verifies every file in the manifest and serves files only from this verified copy in memory. If a single file is missing or different, the app does not start.
- The page is loaded from the privileged `telsiz://app/` scheme. `telsiz://app/api/*` requests are forwarded by the main process to the configured server (`src/lib/proxy.js`). Only the `X-Token`, `Content-Type` and `Accept-Language` request headers are passed on. Redirects are not followed, cookies and the cache are not used. Long-poll, upload and download bodies are streamed.
- The page CSP is identical to the one of the server (`connect-src 'self'`). The page cannot connect to the server directly, every request goes through the proxy. Responses from the proxy carry a CSP that cannot run scripts and only a JSON, binary or plain text type.
- The server address can only be `https://`. The only exception is a server on this computer (`http://localhost` and `http://127.0.0.1`). Certificate errors are never ignored.
- Every server uses its own session partition. The session token and local data of one server can never be sent to another server.
- Windows open with `contextIsolation`, `sandbox` and `webSecurity` on and `nodeIntegration` off. Navigation outside the scheme and new windows are blocked, `https://` links open in the default browser. There is no webview. A service worker cannot be registered on this scheme. Developer tools only open in development mode (unpackaged).
- Permissions are only granted to the main frame of the `telsiz://app` origin: microphone (audio only), system notifications and writing to the clipboard. Camera, location, reading the clipboard, HID, USB and others are denied. Screen capture is only granted through the screen picker below.
- The preload script exposes only a narrow API to the page (`window.telsizDesktop`). IPC channels have fixed names, the window and origin of every call and every input are checked in the main process.
- The packaged app sets Electron fuses: `ELECTRON_RUN_AS_NODE` and `NODE_OPTIONS` are ignored, the app is only loaded from `app.asar` and asar integrity is validated on Windows. The `--inspect` flag is deliberately left enabled. The smoke test runs with Playwright against the published build itself using this flag. A local program with the same user rights can already read the app data directly, so the flag does not grant anything extra.

## Screen sharing picker

When the web app calls `getDisplayMedia`, the main process opens its own picker window (`src/picker/`). The picker shows screens and windows with thumbnails and names. It only opens if there was real user input (a click or a key press) in the last few seconds, and only the source the user picked is granted. If the user cancels, the request is denied. The old `chromeMediaSource: 'desktop'` call cannot bypass the picker. The option to share system audio is only shown on Windows, because according to the Electron documentation system audio capture (`loopback`) is currently only supported on Windows.

## Requirements

- Node.js 22 and npm
- On Linux a graphical session, or `xvfb-run` for the smoke test
- The server code at the repository root (the tests start a real Telsiz server)

## Commands

All commands run in the `desktop/` folder.

| Command | What it does |
| --- | --- |
| `npm ci` | Installs the development dependencies (electron, electron-builder, playwright) |
| `npm run hazirla` | Copies the `public/` files to `app/`, writes the integrity manifest, generates icons in `build/` |
| `npm start` | Runs the preparation and opens the app in development mode |
| `npm test` | Unit tests (no Electron needed, the forwarding logic is tested against a real local server) |
| `npm run test:duman` | Playwright `_electron` smoke test (on Linux `xvfb-run -a npm run test:duman`) |
| `npm run derle:win` | Windows NSIS installer and portable exe (`dist/`) |
| `npm run derle:linux` | Linux AppImage and .deb (`dist/`) |

By default the smoke test opens the app in development mode. If the `TELSIZ_UYGULAMA` environment variable points to a packaged executable (for example `dist/linux-unpacked/telsiz-masaustu` or `dist/win-unpacked/Telsiz.exe`), the test uses it. The test starts a Telsiz server on the first free port between 4300 and 4349 and opens the app with an empty user data folder.

The test opens the app with the `TELSIZ_TANI_GUNLUGU` environment variable. When it holds an absolute file path, the main process writes its startup steps (single instance lock, integrity check, windows, page loads, child process crashes) to that file and to stderr, and reports an error that stops the startup in the log instead of a blocking error box (`src/lib/diagnostics.js`). Without the variable the user sees the error in an error box as usual. The test also sets `TELSIZ_PLAYWRIGHT=1`: when the Node.js inspector is active, the app does not open its first window until Playwright has connected and called `__playwright_run()` in the main process (`src/lib/automation.js`). Playwright does not inject its own loader into a packaged app, so when the connection landed in the middle of the first navigation (on Windows) the navigation event never reached Playwright and the launch waited forever. If the call does not arrive within 30 seconds the app opens anyway. When a test fails, the main process log, the app output, the launch error and a screenshot are written under `duman-sonuclar/`. With `DEBUG=pw:protocol` and `DEBUG_FILE`, Playwright also writes its protocol log to that file.

Build outputs:

- `Telsiz-Kurulum-<version>.exe` (Windows installer)
- `Telsiz-<version>-tasinabilir.exe` (Windows portable)
- `Telsiz-<version>-linux-x86_64.AppImage`
- `telsiz-masaustu_<version>_amd64.deb`

## File layout

| Path | Contents |
| --- | --- |
| `src/main.js` | Main process: windows, scheme, session policies, menu, tray, shortcuts, IPC |
| `src/preload.js` | Preload script of the app window (`window.telsizDesktop`) |
| `src/connect/`, `src/connect-preload.js` | Server address screen |
| `src/picker/`, `src/picker-preload.js` | Screen sharing picker |
| `src/lib/` | Pure modules independent of Electron: address validation, shortcut validation, whitelist, forwarding, CSP, navigation, permissions, screen sharing decisions, integrity, settings, strings, diagnostics log, automation gate |
| `scripts/hazirla.js` | Build preparation |
| `scripts/simge.js` | Icon generation from the Arcade logo (`public/favicon.svg`), without dependencies |
| `test/` | Unit tests |
| `e2e/duman.test.js` | Smoke test |
| `electron-builder.json` | Packaging configuration |

The texts of the desktop menu, tray, server address screen and picker are in `src/lib/strings.js`. They are shown in Turkish if the system language is Turkish, otherwise in English. The desktop specific texts of the web app are the keys with the `desktop.` prefix in `public/i18n.js`.

## Web app integration

`public/js/20-desktop.js` only activates if `window.telsizDesktop` exists:

- On global shortcut events it calls the `toggleMute` and `toggleDeafen` functions.
- It blocks the PWA install prompt.
- `window.TelsizDesktopUI.renderShortcutSettings(container)` draws the global shortcut section, `window.TelsizDesktopUI.renderAppSettings(container)` draws the server address and minimize to tray section.

The `window.telsizDesktop` API:

| Member | Description |
| --- | --- |
| `version`, `platform` | App version and operating system (`win32`, `linux`) |
| `getServer()` | Server origin from the settings |
| `changeServer()` | Opens the server address window |
| `getSettings()` | `server`, `closeToTray`, `trayAvailable`, `shortcuts`, `registered` |
| `setShortcuts(map)` | `{ toggleMute, toggleDeafen }`, values are Electron accelerator strings or `null` |
| `onShortcut(cb)` | `cb('toggleMute' or 'toggleDeafen')`, the returned function unsubscribes |
| `setCloseToTray(bool)` | Minimize to the tray when the window is closed |

Shortcuts made of a letter, number or punctuation key without a modifier, or with Shift only, are not accepted, because a global shortcut takes that key away from every application. F1 to F24 and the volume and media keys can be used on their own.

## Settings and data

The desktop settings (server address, minimize to tray, shortcuts) are in `ayarlar.json` in the app data folder. This folder is `%APPDATA%\Telsiz` on Windows and `~/.config/Telsiz` on Linux. The local data of the web app is in the same folder, in a separate session partition for every server.

## Known limitations

- The app is not signed. On first start Windows SmartScreen may show "Windows protected your PC". Choose "More info" and then "Run anyway". The downloaded file can be verified with `SHA256SUMS.txt` on the release page.
- There is no automatic update, because unsigned updates are not safe. New versions are downloaded and installed manually.
- There is no hold to talk global shortcut, because it needs a native module. The push to talk key only works while the window is in front. Global shortcuts only exist for toggle microphone and deafen.
- Whether global shortcuts work in Wayland sessions on Linux has not been verified.
- According to the Electron documentation, Windows notifications need a Start menu shortcut of the app. The installer creates this shortcut, in the portable version notifications may not appear.
- To run the AppImage, first run `chmod +x Telsiz-<version>-linux-x86_64.AppImage`. Some distributions need FUSE support to be installed for AppImages. On distributions that restrict unprivileged user namespaces with AppArmor (for example Ubuntu 24.04), the AppImage may not start because the Chromium sandbox cannot start. In that case use the .deb package, which installs the required AppArmor profile. The `--no-sandbox` flag, which turns the sandbox off, is not recommended.
- Chromium background timer throttling is turned off (`disable-background-timer-throttling`) so that voice activity detection keeps working while the window is in the background. Page visibility does not change, notifications still only appear while the window is hidden.

## Continuous integration

`.github/workflows/desktop.yml` runs the unit tests on pull requests and pushes to `main`, builds the Linux and Windows packages and runs the smoke test with the packaged build (under xvfb on Linux). The artifact names are `telsiz-desktop-windows` and `telsiz-desktop-linux`. The workflow is also called from the release workflow through `workflow_call` and does not publish anything itself.
