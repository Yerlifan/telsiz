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
- The page CSP is identical to the one of the server (`connect-src 'self'`). The `'wasm-unsafe-eval'` keyword in the script source allows only WebAssembly compilation and is there to compile the bundled RNNoise module (advanced noise suppression, `vendor/rnnoise/rnnoise.wasm`) in an AudioWorklet. `eval` and inline scripts are blocked. The page cannot connect to the server directly, every request goes through the proxy. Responses from the proxy carry a CSP that cannot run scripts and only a JSON, binary or plain text type.
- The only frame the page can open is the YouTube player of Telsiz DJ: a direct child frame of the app window's main frame, and only for the `https://www.youtube-nocookie.com` origin (`src/lib/navigation.js`, `frame-src` in the CSP). Frames inside it and all other subframes are blocked. The web app does not load this frame before the person gives consent. Because YouTube rejects a player request without a Referer header with error 153 and the `telsiz://app` origin sends no Referer, the app adds the server origin (for example `https://telsiz.example.com/`) as the Referer of this frame's document request only. In the web version the browser sends YouTube the same information, the page origin.
- The server address can only be `https://`. The only exception is a server on this computer (`http://localhost` and `http://127.0.0.1`). Certificate errors are never ignored. The server address screen checks the server's `/api/info` response and shows a warning if the server's major version differs from the app's or the server does not report its version, and the user can still connect.
- Every server uses its own session partition. The session token and local data of one server can never be sent to another server.
- Windows open with `contextIsolation`, `sandbox` and `webSecurity` on and `nodeIntegration` off. Navigation outside the scheme and new windows are blocked, `https://` links open in the default browser. There is no webview. A service worker cannot be registered on this scheme. Developer tools only open in development mode (unpackaged).
- Permissions are only granted to the main frame of the `telsiz://app` origin: microphone and camera (`getUserMedia` audio and video), system notifications, writing to the clipboard and full screen for the Full screen button of the stage (screen sharing and the camera grid). The app requests the camera only when the person presses the Camera button in a voice room, and subframes (the YouTube player included) and other windows cannot get the camera or the microphone. Subframes cannot go full screen either. The page's `Permissions-Policy` header also opens the camera and the microphone only to the app's own origin (`camera=(self)`, `microphone=(self)`). Location, reading the clipboard, HID, USB and others are denied. Screen capture is only granted through the screen picker below.
- The preload script exposes only a narrow API to the page (`window.telsizDesktop`). IPC channels have fixed names, the window and origin of every call and every input are checked in the main process.
- The packaged app sets Electron fuses: `ELECTRON_RUN_AS_NODE` and `NODE_OPTIONS` are ignored, the app is only loaded from `app.asar` and asar integrity is validated on Windows. The `--inspect` flag is deliberately left enabled. The smoke test runs with Playwright against the published build itself using this flag. A local program with the same user rights can already read the app data directly, so the flag does not grant anything extra.

## Frequencies

In the interface every Telsiz server is a frequency. The app remembers several frequencies and the user switches between them. The server side and the encryption model do not change: each frequency is a separate server, a separate account and a separate key.

- The list is kept in the `frequencies` field of `ayarlar.json`: `[{ origin, name, lastUsed }]`, and the active frequency is the `server` field (`src/lib/frequencies.js`, `src/lib/settings-store.js`). Every origin is validated with the `server-url.js` rules, and the list holds at most 50 frequencies. The single server address of the earlier version is added to the list on first start. Session partitions were already per origin, so no sign-in is lost.
- The display name is the server name from the `/api/info` response that the connect window checks. If the web app learns a new name later (when the server name changes), it reports it with `setFrequencyName`, and the name is written only to the frequency the window is open on. Without a name the host name is shown.
- The frequency band at the top (`public/js/24-frekans.js`) shows the list in saved order: the open frequency is marked (the needle), and pressing another station, dragging the needle, the end buttons or the L1 and R1 buttons of a gamepad switch to it. The All button of the band opens the same list in the Frequencies sheet. On a switch the app window is opened again with that frequency's session partition and the old window closes (the voice connection closes too). Add a frequency (the + button of the band) opens the frequency address window in add mode, and after a successful connection the new frequency is added to the list and becomes active. Remove from list in the Frequencies sheet and in the app menu (Telsiz > Frequencies > Remove from list, also available on the sign-in screen) asks for confirmation. The session data of that frequency on this device (sign-in, local storage, cache) is deleted only if the box in the confirmation dialog is checked, keeping it is the default. If the active frequency is removed, the app switches to the most recently used other frequency, and if the list becomes empty the address window opens.
- The Frequencies submenu in the app menu and in the tray shows the list too and performs the same switch.
- Every origin and name that comes from the page is validated again in the main process: the origin must be a string of limited length, valid and saved in the list. Like the others, these IPC handlers check that the call comes from the main frame of the app window and from the `telsiz://app` origin.

Limits: switching ends the voice connection (you are asked first while in a voice room). The list is not synced between devices. The counts of frequencies that are not open come from the background counting below.

## Background counting

The frequency band at the top shows the status and unread counts of frequencies that are not open too. For this the main process (`src/lib/background.js`, `src/main.js createBackgroundWindow`) runs a hidden background window for each saved frequency that is not open, in that frequency's own session partition.

- The cap is 8 windows: the 8 most recently used frequencies (`lastUsed`, the open frequency excluded). To keep memory and network use limited, the windows open one at a time, 3 seconds after startup and 1.5 seconds apart. For frequencies beyond the cap only reachability is shown.
- The window uses the same app bundle, the same preload script, the sandbox and the CSP. It is invisible, has no taskbar entry, its audio is muted, images are not loaded and autoplay needs user activation. It only has the notification permission (every other permission, the microphone and the camera included, is denied, `src/lib/permissions.js` `deniedFor`), and the YouTube frame cannot open.
- The preload script turns on background mode only with the `--telsiz-background=<origin>` argument that the main process adds, and then gives the page the `window.telsizArkaPlan` object. Page content cannot change this argument. The background mode of the client (`public/js/25-arka-plan.js`) draws no interface, starts no voice, screen sharing, Telsiz DJ or message sound, long-polls with the saved session of that frequency, counts unread messages and mentions with the same rules as the normal client (it decrypts the message with the key on this device to detect mentions), and never writes the last read marker.
- The window reports its state (`origin`, `state`, `unread`, `mention`, `online`, `lastError`, `name`, `onlineUsers`) on the `telsiz:bg-report` channel at most once a second. The main process accepts a report only from the main frame of a registered background window and from the `telsiz://app` origin, the origin must be that window's frequency, every field is checked for type and range, and a report with an unknown field is rejected. The collected state is sent to the app window with the `telsiz:bg-state` event (`window.telsizArkaPlan.onState`, `getState()`).
- A frequency without a session or with an invalid one reports "sign-in needed": its window closes and does not open again until that frequency is opened once. The session data is not touched. A crashed window opens again after 30 seconds, less often after repeated crashes.
- For reachability (the online and offline dot) the main process sends `GET <origin>/api/info` to every saved frequency (those beyond the cap included) with a separate non-persistent session: an 8 second timeout, about every 60 seconds on success, and less often on failure, doubling up to 10 minutes.

- Frequency photo: when the `serverIcon` hash in the probe response changes, the main process downloads the photo with the same cookieless session from `GET <origin>/api/server-icon?v=<hash>` (`src/lib/server-icon.js`): redirects are not followed, a 10 second timeout, at most 1 MB. The type is detected from the file signature (only PNG, JPEG and WebP) and must match the Content-Type header, and the sha256 hash of the content must match the requested hash. A verified photo is cached by hash, is not downloaded again for the same hash (a failed download is tried at most 3 times) and is sent with the state as a `data:image/...;base64,` address. The preload script and the page validate this address again. The CSP of the app window already allows `data:` for images, and the window does not connect to other servers.
- When you switch to a frequency, its background window closes before the app window loads (two clients never run with the same session), and the window for the previous frequency opens 3 seconds later. All background windows close when the app window closes and when the app quits. While the window is minimized to the tray the background windows keep running.
- If desktop notifications are on for that frequency in Settings > Notifications, a silent system notification is shown for a message that mentions you and for a direct message (the notification level and the Do not disturb rule apply). Pressing the notification switches to that frequency.

Privacy: each background window stays connected to its server with your session. The server sees you as online and receives the poll requests, and the other members see you as online too. The background window sends no messages and writes no read markers.

The counts belong to the session: the client counts unread messages on this device, not on the server. When the app starts again, the background windows count again from the last read marker (up to the last 50 messages per room and direct conversation).

## Screen sharing picker

When the web app calls `getDisplayMedia`, the main process opens its own picker window (`src/picker/`). The picker shows screens and windows with thumbnails and names. It only opens if there was real user input (a click or a key press) in the last few seconds, and only the source the user picked is granted. If the user cancels, the request is denied. The old `chromeMediaSource: 'desktop'` call cannot bypass the picker. The option to share system audio is only shown on Windows, because according to the Electron documentation system audio capture (`loopback`) is currently only supported on Windows. The web app requests the audio with the `restrictOwnAudio` constraint, and Electron then leaves the app's own sound out of the capture: the conversation, notification sounds and Telsiz DJ playing in Telsiz do not reach the shared audio. On older Windows versions that cannot separate it, all system audio is captured.

## Requirements

- Node.js 22 and npm
- On Linux a graphical session, or `xvfb-run` for the smoke test
- The server code at the repository root (the tests start a real Telsiz server)

## Commands

All commands run in the `desktop/` folder.

| Command | What it does |
| --- | --- |
| `npm ci` | Installs the dependencies: the development tools (electron, electron-builder, playwright) and the runtime dependencies that go into the package, electron-updater and uiohook-napi (hold to talk key hook, see Push to talk in the background) |
| `npm run hazirla` | Copies the `public/` files to `app/`, writes the integrity manifest, generates icons in `build/` |
| `npm start` | Runs the preparation and opens the app in development mode |
| `npm test` | Unit tests (no Electron needed, the forwarding logic is tested against a real local server) |
| `npm run test:duman` | Playwright `_electron` smoke test (on Linux `xvfb-run -a npm run test:duman`) |
| `npm run derle:win` | Windows NSIS installer and portable exe, `latest.yml` and the installer `.blockmap` file (`dist/`) |
| `npm run derle:linux` | Linux AppImage and .deb, `latest-linux.yml` (`dist/`) |

By default the smoke test opens the app in development mode. If the `TELSIZ_UYGULAMA` environment variable points to a packaged executable (for example `dist/linux-unpacked/telsiz-masaustu` or `dist/win-unpacked/Telsiz.exe`), the test uses it. The test starts a Telsiz server on the first free port between 4300 and 4349 and opens the app with an empty user data folder.

The test opens the app with the `TELSIZ_TANI_GUNLUGU` environment variable. When it holds an absolute file path, the main process writes its startup steps (single instance lock, integrity check, windows, page loads, child process crashes) to that file and to stderr, and reports an error that stops the startup in the log instead of a blocking error box (`src/lib/diagnostics.js`). Without the variable the user sees the error in an error box as usual. The test also sets `TELSIZ_PLAYWRIGHT=1`: when the Node.js inspector is active, the app does not open its first window until Playwright has connected and called `__playwright_run()` in the main process (`src/lib/automation.js`). Playwright does not inject its own loader into a packaged app, so when the connection landed in the middle of the first navigation (on Windows) the navigation event never reached Playwright and the launch waited forever. If the call does not arrive within 30 seconds the app opens anyway. When a test fails, the main process log, the app output, the launch error and a screenshot are written under `duman-sonuclar/`. With `DEBUG=pw:protocol` and `DEBUG_FILE`, Playwright also writes its protocol log to that file.

Build outputs:

- `Telsiz-Kurulum-<version>.exe` (Windows installer)
- `Telsiz-<version>-tasinabilir.exe` (Windows portable)
- `Telsiz-<version>-linux-x86_64.AppImage`
- `telsiz-masaustu_<version>_amd64.deb`
- `latest.yml`, `Telsiz-Kurulum-<version>.exe.blockmap` and `latest-linux.yml` (auto update info, see below)

## File layout

| Path | Contents |
| --- | --- |
| `src/main.js` | Main process: windows, scheme, session policies, menu, tray, shortcuts, IPC |
| `src/preload.js` | Preload script of the app window (`window.telsizDesktop`) |
| `src/connect/`, `src/connect-preload.js` | Frequency address screen (first frequency and Add a frequency) |
| `src/picker/`, `src/picker-preload.js` | Screen sharing picker |
| `src/lib/` | Pure modules independent of Electron: address validation, frequency list, background counting, shortcut and push to talk setting validation, the hold to talk key hook lifecycle (`ptt-hook.js`) and key mapping (`hook-keys.js`), whitelist, forwarding, CSP, navigation, permissions, screen sharing decisions, integrity, settings, strings, diagnostics log, automation gate, updates |
| `scripts/hazirla.js` | Build preparation |
| `scripts/simge.js` | Icon generation from the Arcade logo (`public/favicon.svg`), without dependencies |
| `scripts/guncelleme-dosyalari.js` | Checks that the packages named in `latest.yml` and `latest-linux.yml` exist and that their size and sha512 match (CI and release workflow) |
| `test/` | Unit tests |
| `e2e/duman.test.js` | Smoke test |
| `electron-builder.json` | Packaging configuration |

The texts of the desktop menu, tray, server address screen and picker are in `src/lib/strings.js`. They are shown in Turkish if the system language is Turkish, otherwise in English. The desktop specific texts of the web app are the keys with the `desktop.` prefix in `public/i18n.js`.

## Web app integration

`public/js/20-desktop.js` only activates if `window.telsizDesktop` exists:

- On global shortcut events it calls the `toggleMute` and `toggleDeafen` functions.
- On push to talk shortcut (`pttToggle`) and hold to talk hook events it uses the push to talk path in `public/voice.js` with the `external` source (`voice.pttDown('external')`, `voice.pttUp('external')`). It reports the voice room state to the main process with `setVoiceActive` (see Push to talk in the background).
- It blocks the PWA install prompt.
- `window.TelsizDesktopUI.renderShortcutSettings(container)` draws the global shortcut section, `window.TelsizDesktopUI.renderAppSettings(container)` draws the active frequency, minimize to tray and updates section.
- Shows a dismissible strip in the bottom right corner for a downloaded update or a new version notice.
- The frequency band and menu (`public/js/24-frekans.js`) manage the list on the desktop with the frequency calls below instead of the browser's local storage, and get the status of frequencies that are not open from `window.telsizArkaPlan`.

The `window.telsizDesktop` API:

| Member | Description |
| --- | --- |
| `version`, `platform` | App version and operating system (`win32`, `linux`) |
| `getServer()` | Server origin from the settings |
| `changeServer()` | Opens the frequency address window (Add a frequency) |
| `getSettings()` | `server`, `closeToTray`, `trayAvailable`, `shortcuts`, `registered`, `ptt` (`{ mode, holdKey }`), `pttHook` (`{ available, reason, running, error }`) |
| `setShortcuts(map)` | `{ toggleMute, toggleDeafen, pttToggle }`, values are Electron accelerator strings or `null` |
| `onShortcut(cb)` | `cb('toggleMute', 'toggleDeafen' or 'pttToggle')`, the returned function unsubscribes |
| `setPtt(setting)` | `{ mode: 'toggle' or 'hold', holdKey }`, `{ ok: false, code: 'unavailable' }` if the module cannot be loaded while hold to talk is turned on |
| `setVoiceActive(bool)` | `true` while the page is in a voice room in push to talk mode, `false` otherwise (the hold to talk hook only runs while it is `true`) |
| `onPttHold(cb)` | `cb('start')` (start talking) or `cb('end')` (stop talking) from the hold to talk hook, the returned function unsubscribes |
| `setCloseToTray(bool)` | Minimize to the tray when the window is closed |
| `listFrequencies()` | `{ active, items: [{ origin, name, host, active, order }] }`, the active frequency first, `order` is the saved order (the band uses it) |
| `switchFrequency(origin)` | Switches to a frequency in the list, `{ ok }` |
| `addFrequency()` | Opens the frequency address window in add mode |
| `removeFrequency(origin, clearData)` | Removes the frequency from the list, deletes its session data only if `clearData` is `true` |
| `setFrequencyName(name)` | The name of the open frequency learned from the server |
| `updates.getState()` | `{ enabled, mode, kind, current, status, version, percent, lastCheckAt, error, canInstall }` |
| `updates.checkNow()` | Checks now (`{ ok: false, code: 'disabled' }` if the setting is off) |
| `updates.setEnabled(bool)` | The check for updates automatically setting |
| `updates.install()` | Installs the downloaded update and restarts the app |
| `updates.openRelease()` | Opens the GitHub page of the found release in the default browser (the main process decides the address) |
| `updates.onState(cb)` | `cb(state)` when the state changes, the returned function removes the subscription |

`window.telsizArkaPlan` (a separate object): in the app window `{ background: false, getState(), onState(cb) }`, where the state is `{ items: [{ origin, active, state, unread, mention, online, onlineUsers }] }`. In a background window `{ background: true, origin, report(report), open() }`.

Shortcuts made of a letter, number or punctuation key without a modifier, or with Shift only, are not accepted, because a global shortcut takes that key away from every application. F1 to F24 and the volume and media keys can be used on their own.

## Push to talk in the background

The app's own push to talk key only works while the Telsiz window is in front. To talk while a game is in front, the global shortcuts section of Settings > Keybinds offers two ways:

- Press to start, press to stop (default): the `pttToggle` global shortcut. Press it once to start talking and again to stop. A short sound plays when talking starts and stops (if Join and leave sounds in Settings > Voice and video is on). No key is assigned by default, and the shortcut follows the same rules as the other global shortcuts. Outside a voice room the shortcut does nothing. While the microphone is off (muted, deafened or muted for everyone) talking does not start and the stop sound plays.
- Hold to talk (key hook, optional): when turned on, you talk while the chosen key or key combination is held and go quiet when you release it. Global shortcuts only report the press, so the release is received with the [uiohook-napi](https://github.com/SnosMe/uiohook-napi) key hook. While hold to talk is on, the press to start, press to stop shortcut is not registered. The hold to talk key can also be a single letter or number, because the hook does not take the key away from other applications. A hold to talk key that would also fire with the Toggle microphone or Deafen shortcut is not accepted.

In Voice activity mode the shortcut does not switch to push to talk mode, it acts like Toggle microphone and plays the same start or stop sound. The hold to talk hook is never started in Voice activity mode.

On the page both ways use the push to talk path in `public/voice.js` with a separate source (`external`), there is no new microphone path. The window's own push to talk key, the on-screen Push to talk button and the desktop source are tracked separately: when one is released while another is held, talking continues. When the window loses focus or is hidden, only the sources inside the window are released, the desktop source stays on. Leaving the voice room or changing the input mode releases every source.

The key hook and privacy:

- The hook only runs while hold to talk is on, a key is assigned and the page has reported that it is in a voice room in push to talk mode (`src/lib/ptt-hook.js`). It is stopped when the setting is turned off, when you leave the room, or when the window reloads or closes. If it is stopped while you talk, talking ends.
- The hook sees every key event on the operating system but only handles the chosen key. Events are handled only in the main process, by comparing the key code with the assigned key, and are not stored. Only `start` (start talking) and `end` (stop talking) go to the page, and the preload script passes no other value. Key codes and other keys never go to the page, the server or the log. Mouse events are not listened to.
- Some antivirus programs may warn about applications that use a key hook. While hold to talk is off, the native module is not loaded at all.
- If the module cannot be loaded or the hook cannot be started, the app does not crash, the option shows as unavailable in Settings with the reason.

Platform notes:

- The package uses the prebuilt Node-API binaries of uiohook-napi (`prebuilds/win32-x64`, `prebuilds/linux-x64`). electron-builder does not build native modules from source (`npmRebuild: false`) and unpacks the module outside the asar archive (`asarUnpack`).
- On Linux the hook uses X11 (XRecord). The module connects to the X11 display when it is loaded, and if `DISPLAY` is not set the module is not loaded at all and the option shows as unavailable. It is not guaranteed to work in Wayland sessions. The module needs the `libXtst.so.6` and `libXt.so.6` libraries. If they are missing, the option shows as unavailable.
- On Windows the hook may not see keys while a window running as administrator is in front.
- Dependency: uiohook-napi 1.5.5 (MIT). The package contains the libuiohook library in compiled form. The libuiohook source files carry the LGPL 3.0 or later license, and the source code ships with the package (`node_modules/uiohook-napi/libuiohook`).

## Updates

The app checks for new versions on the GitHub release page (`src/lib/updates.js`). How it works depends on the package type:

| Package | Behavior |
| --- | --- |
| Windows installer (`Telsiz-Kurulum-<version>.exe`) | electron-updater downloads the new version in the background. It is installed only when the user chooses Restart and update, it is never installed by itself on quit. |
| Linux AppImage (`APPIMAGE` environment variable) | Same as the installer, the AppImage file is replaced with the new version. |
| Windows portable (`PORTABLE_EXECUTABLE_DIR` environment variable), .deb and development mode | The latest stable release is read from the GitHub API (`/repos/Yerlifan/telsiz/releases/latest`). If it is newer, a New version available strip and a button that opens the release page are shown. No file is downloaded. |

- The App section of the settings page has the Check for updates automatically switch (on by default), a Check now button, the version and the result of the last check. The Help menu has Check for updates, and when an update is downloaded or a new version is found, the matching action appears in the app menu and at the top of the tray menu.
- While the switch is on, the first check runs 30 seconds after start and then every 6 hours. While it is off, no request is sent to GitHub and the electron-updater module is not even loaded. Unattended runs (smoke test, `TELSIZ_TANI_GUNLUGU`) do no scheduled checks.
- electron-updater verifies the sha512 of the downloaded file against `latest.yml` or `latest-linux.yml` in the release. Pre-releases and older versions are not installed. The page cannot pass any address or file path over IPC: the release page is opened in the main process only with a validated address under `https://github.com/Yerlifan/telsiz/releases/`.
- Privacy: checking connects to GitHub. GitHub can see the IP address and the app version (the `User-Agent` of the request). Nothing else is sent, the request uses a cookieless session separate from the server sessions.
- Trust: the packages are not code signed. The integrity of updates rests on the security of the GitHub account and repository: anyone who can change the release files can also change `latest.yml`. The repository owners and everyone with write access should therefore have two factor authentication (2FA) turned on. A user who does not accept this can turn the switch off, download releases by hand and verify them with `SHA256SUMS.txt`.

Publishing: the `publish` setting in `electron-builder.json` (GitHub, `Yerlifan/telsiz`) makes electron-builder write `latest.yml`, `latest-linux.yml` and `app-update.yml` inside the app. The build always runs with `--publish never`, electron-builder uploads nothing. The release workflow (`release.yml`) adds the files to the release with a narrow whitelist: `latest.yml`, `latest-linux.yml` and `Telsiz-Kurulum-<version>.exe.blockmap`. The AppImage block map is embedded in the file, there is no separate `.blockmap` file. `latest-linux.yml` also lists the .deb package, the AppImage updater only picks the AppImage file. Before publishing, `scripts/guncelleme-dosyalari.js` checks that every file named in the info files is in the release with the same name and a matching sha512, otherwise updates would fail with a 404 error.

## Settings and data

The desktop settings (active frequency, frequency list, minimize to tray, shortcuts, push to talk mode and hold to talk key, automatic update checks) are in `ayarlar.json` in the app data folder (format 2, a format 1 file is converted to a list when read). This folder is `%APPDATA%\Telsiz` on Windows and `~/.config/Telsiz` on Linux. The local data of the web app is in the same folder, in a separate session partition for every frequency (server).

## Known limitations

- The app is not signed. On first start Windows SmartScreen may show "Windows protected your PC". Choose "More info" and then "Run anyway". The downloaded file can be verified with `SHA256SUMS.txt` on the release page.
- Updates are unsigned, their integrity rests on the security of the GitHub account and repository (see Updates). The portable exe and the .deb are not updated by themselves, a new version is only announced. Update checks work while the repository is public.
- Hold to talk only works with the optional key hook (see Push to talk in the background). The behavior of the hook with real key events is not covered by the automated tests: the unit tests check the hook with a fake module, and the smoke test loads, starts and stops the real module under xvfb.
- Whether global shortcuts and the key hook work in Wayland sessions on Linux has not been verified.
- According to the Electron documentation, Windows notifications need a Start menu shortcut of the app. The installer creates this shortcut, in the portable version notifications may not appear.
- To run the AppImage, first run `chmod +x Telsiz-<version>-linux-x86_64.AppImage`. Some distributions need FUSE support to be installed for AppImages. On distributions that restrict unprivileged user namespaces with AppArmor (for example Ubuntu 24.04), the AppImage may not start because the Chromium sandbox cannot start. In that case use the .deb package, which installs the required AppArmor profile. The `--no-sandbox` flag, which turns the sandbox off, is not recommended.
- Chromium background timer throttling is turned off (`disable-background-timer-throttling`) so that voice activity detection keeps working while the window is in the background. Page visibility does not change, notifications still only appear while the window is hidden.

## Continuous integration

`.github/workflows/desktop.yml` runs the unit tests on pull requests and pushes to `main`, builds the Linux and Windows packages and runs the smoke test with the packaged build (under xvfb on Linux). The artifact names are `telsiz-desktop-windows` and `telsiz-desktop-linux`. Next to the packages, `latest.yml` and the installer `.blockmap` file (Windows) and `latest-linux.yml` (Linux) are uploaded and checked with `scripts/guncelleme-dosyalari.js`. The workflow is also called from the release workflow through `workflow_call` and does not publish anything itself.
