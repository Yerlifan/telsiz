# Changelog

Notable changes in Telsiz releases are listed in this file. Version numbers follow [Semantic Versioning](https://semver.org/). Turkish version: [CHANGELOG.md](CHANGELOG.md).

## [2.0.0]

The first public release of Telsiz: open source, end-to-end encrypted text and voice communication that runs on your own server or on a hosting service. It works on any device with a browser, and the server has no runtime dependencies.

### Encryption and privacy

- Text channel messages, files and images, profile information (display name, about me, custom status, profile picture) and the connection setup messages of voice chat are encrypted in the browser with the group key (TweetNaCl-js, XSalsa20-Poly1305). The server stores and relays this content only in encrypted form.
- Direct messages are encrypted with the personal keys of the two people (X25519). The other person's key can be verified with a safety number, it is pinned on first sight and a warning is shown when it changes.
- The password is never sent to the server. The browser derives an authentication key from the password with scrypt, and the server stores a scrypt hash of that key. The personal private key is stored wrapped with a key derived from the password.
- The group key travels in the part of the invite link after the # sign, which browsers do not send to the server. The key can also be entered by hand.
- A new group key can be created, and the new key protects the messages that follow. Keys for older messages are kept in the keyring on the device.
- The location and other metadata of photos are removed before they are sent.
- Message search and @ mentions run entirely in the browser, the server never sees the search text or the message content.

### Server security

- Authorization checks on the server at every endpoint, type and length checks on every input, limits on bodies, queues and counts.
- Rate limits per account and per IP address (sign in, registration, messages, uploads, administration, friend requests, voice signals).
- Session tokens are stored on disk only as hashes, and comparisons run in constant time.
- A strict Content Security Policy (CSP), security headers and no CORS headers. Static files are served only from an allowlist, and path traversal attempts are rejected.
- Behind a reverse proxy, the client address is read only from headers sent by trusted proxies (`GUVENILIR_VEKIL` or `TRUSTED_PROXY`).
- Data files are written atomically, and a corrupt data file is never overwritten.

### Text communication

- Multiple text channels, persistent and encrypted message history (the last 20000 messages per channel), paging through the history.
- Editing and deleting messages.
- Sharing files and images: up to 10 files per message, a default limit of 25 MB per file and a configurable total quota, inline images, an image viewer, file cards, paste and drag and drop.
- Emoji picker with categories, recently used emoji and keyboard navigation.
- @ mentions with a suggestion list. Owners and admins can mention everyone in text channels.
- Unread message and mention counters.
- Typing indicator. You can turn off sending your own typing status.
- Message search in this channel or conversation, in all text channels or in direct messages, with filters for a person and for messages with images or files, and jumping from a result to the message in context.
- Desktop notifications and a message sound, with a notification level (all messages, only mentions and direct messages, or none).

### Voice communication

- Multiple voice channels with up to 8 people per channel. Audio flows directly between people over WebRTC (DTLS-SRTP) and does not pass through the server.
- Speaking indicator, mute, deafen, per person volume and an overall output volume.
- Two input modes: voice activity (automatic or manual sensitivity threshold) and push to talk (with a release delay and an on screen push to talk button).
- Key bindings for push to talk, mute and deafen: a keyboard key, a mouse side button or a gamepad button.
- Microphone selection and test, an input level meter, echo cancellation, noise suppression and automatic gain options, join and leave sounds.
- Your own TURN server can be configured for networks that need it (`TURN_URL`, `TURN_KULLANICI`, `TURN_SIFRE`).

### People, profiles and direct messages

- Friend requests (send, accept, decline, withdraw), a friends list and removing friends.
- Blocking: channel messages of a blocked person are collapsed, their voice is muted on your side and they cannot send you direct messages.
- Direct messages with a conversation list and unread counters. You can stop accepting direct messages from server members.
- Profiles: display name, about me, profile color, a profile picture that can be cropped, a custom status and a status (online, idle, do not disturb, invisible), and a profile card.

### Accounts and administration

- Roles: owner, admin and member. The owner account is created with a one time setup code shown in the server console, other accounts are created with an invite code.
- Creating, renaming, reordering and deleting channels. The last text channel cannot be deleted.
- Changing the server name and renewing the invite code.
- Member management: changing roles, banning and unbanning, resetting a password with a temporary password.
- Account settings: changing the password and the username, deleting the account, viewing and signing out active sessions.
- If the owner forgets the password, it can be reset from the command line while the server is stopped: `sifre-sifirla` or `reset-password`.

### Appearance and languages

- Three themes (Arcade, Night Frequency, Turquoise and Copper), each with a dark and a light mode and an option to follow the system setting.
- Font size, compact message view and reduced motion settings.
- Turkish and English interface. Server error messages follow the language of the request, and console messages follow the `DIL` setting or the system language.

### Installation and running

- Installing as an app (PWA): it opens in its own window on phones, tablets and computers (https is required).
- Real time communication uses HTTP long polling, WebSocket is not needed.
- The server runs on Node.js 20 or newer, has no runtime dependencies and keeps its data in JSON and JSONL files.
- npm package: `npx telsiz`. The data folder is the `veri` folder in the folder where the command is run.
- Standalone server: a single file for Windows (x64) and Linux (x64, arm64) that contains Node.js and the app files. The data folder is the `veri` folder next to the file, and settings can also be read from a `telsiz.env` file next to it. The window does not close right away when starting fails.
- Docker image `ghcr.io/yerlifan/telsiz` (linux/amd64 and linux/arm64) with a non root user, a persistent data volume and a health check. Docker Compose, systemd, Caddy and nginx examples are in the `deploy/` folder.
- `baslat.bat` and `tunel.bat` for Windows, `baslat.sh` and `tunel.sh` for Linux and macOS. The tunnel scripts open a temporary https address with a Cloudflare quick tunnel.
- `SHA256SUMS.txt` to verify the release files.

### Desktop app

- A desktop app for Windows and Linux. The app files are shipped inside the app and verified against a sha256 manifest at startup, they are not downloaded from the server.
- The server address must use https (http://localhost is allowed for a server on the same computer). Requests to the server go through the main process of the app.
- Only microphone, notification and clipboard write permissions are granted, all other permissions are denied.
- Global shortcuts for mute and deafen, and an option to minimize to the system tray on close.

### Known limitations

- In the web version the app code comes from the server. An active attacker who controls the server or an intermediary that terminates the HTTPS connection could serve modified code. In the desktop app the app code ships inside the app, so the server cannot change it.
- The server sees metadata: who wrote, when, in which channel and how much. Channel names, usernames and the typing status are not encrypted.
- The group key is shared by everyone on the server and there is no forward secrecy. A new key protects only the messages that follow.
- In voice chat people can see each other's IP address.
- Voice chat and installing the app require https (except at the localhost address on the computer that runs the server).
- The standalone server and the desktop app are not code signed, so Windows may show a warning on first start. The desktop app has no automatic updates and no global push to talk shortcut that works while held down.
- No standalone server or desktop package is published for macOS. On macOS use `npx telsiz`, `baslat.sh` or Docker.
