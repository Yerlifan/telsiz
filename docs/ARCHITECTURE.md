# Telsiz architecture

[Türkçe](MIMARI.md) | [English](ARCHITECTURE.md)

This document describes the Telsiz server, the client, the encryption design, the voice, screen sharing and Telsiz DJ infrastructure, the desktop app and the release process. The last section lists plainly what the system protects and what it does not. For installation see [DEPLOYMENT.md](DEPLOYMENT.md), and for the visual design see [DESIGN.md](DESIGN.md).

## Overview

Telsiz has three parts: a single process Node.js server, a web client that runs in the browser without a build step, and an optional desktop app that carries the same client inside itself. The server stores accounts, rooms and encrypted content and distributes events between clients. Encryption and decryption happen only in the client. Audio and screen video flow directly between people, and the server only relays the encrypted messages that set up those connections.

```text
 Browser or desktop app                             Telsiz server (Node.js)
 +----------------------------------+   HTTPS     +-----------------------------+
 | public/js/01..23, crypto.js      |  JSON API   | src/app.js   endpoints      |
 | keys exist only here             |<----------->| src/hub.js   long polling   |
 | encrypt, decrypt, search         | long poll   | src/store.js JSON and JSONL |
 +----------------------------------+             +-----------------------------+
        ^        WebRTC (DTLS-SRTP)
        |   audio and screen, peer to peer
        v
 +----------------------------------+
 | other participants               |
 +----------------------------------+
```

## Server

The server runs on Node.js 20 or newer and uses only the built-in modules of Node.js, so `package.json` has no runtime dependencies. The entry point `server.js` reads and validates environment variables, adds the `telsiz.env` file next to it to the environment when running as a single file, sets up the HTTP server with `createChatServer` from `src/app.js`, and on SIGINT or SIGTERM finishes pending writes and exits.

`src/app.js` defines all API endpoints under `/api/`. Authorization is checked on the server at every endpoint, bodies are read with a size limit, and every field goes through type and length checks. There are rate limits per account and per IP address (sign in, registration, messages, uploads, administration, friend requests, typing notifications, voice signals and DJ writes). Session tokens are sent in the `X-Token` header and only their hashes are kept on disk. Behind a reverse proxy, the client address is read only from headers sent by proxies in the `GUVENILIR_VEKIL` list.

Static files are served only from an allowlist: fixed files, and files in the `js/`, `css/`, `css/skins/` and `fonts/` folders whose names match a strict pattern. Path traversal is not possible. The Content Security Policy of the HTML page allows scripts, styles, fonts and connections only from its own origin, allows frames only from `https://www.youtube-nocookie.com`, and prevents the page from being framed by another site. API responses and downloaded files are sent with separate policies that cannot run scripts. There are no CORS headers.

API error messages are in Turkish or English according to the `Accept-Language` header of the request, and console and log messages according to the `DIL` setting or the system language (`src/i18n.js`). In the single file build (`telsiz.exe` and the Linux binaries) the app files are embedded in the executable and read through `src/static-source.js` with the same allowlist.

## Real time communication

Real time communication uses only plain HTTP requests with long polling. The reason is that WebSocket and Server-Sent Events support could not be verified in environments such as game console browsers. The client sends a `GET /api/poll` request. If there is something new, the server answers right away, otherwise it holds the request for about 25 seconds and returns an empty answer when the time runs out.

`src/hub.js` keeps the following in memory: presence, a ring of recent events, the meta version (rooms, members, roles), each user's private meta version (friends, requests, blocks, the direct message list), typing status, voice rosters and voice signal queues. A poll request carries the versions the client knows (`since`, `mv`, `pmv`, `tv`, `muv`, `sig`) and the boot id of the server (`boot`). The server sends only the parts that changed. If the client is too far behind, or the server has restarted, the answer carries a resync flag and the client loads its state again from the start.

Every event has an audience: either all members or only specific users. Direct message events go only to the two members of the conversation and never appear in the poll answer of a user outside the audience. A user with the invisible status appears offline to others. Two people with a block between them do not see each other's typing status.

## Persistence

`src/store.js` keeps all data in plain files in the data folder.

| File | Contents and how it is written |
| --- | --- |
| `state.json` | Accounts, session hashes, rooms, roles, the invite code, friendships, blocks, server settings. Written atomically by writing a temporary file and renaming it, and before each write the current valid version is kept as `state.json.bak`. |
| `messages/<id>.jsonl` | One encrypted message record per line for each room and direct message conversation. The last 20000 messages per room are kept. |
| `uploads/<id>.bin` | Encrypted files and profile pictures. The total size is limited by `YUKLEME_KOTASI_MB`, and uploads not attached to a message are removed after one hour. |
| `.kilit` | The lock of the running process. It prevents a second process from opening the same data folder. |

If `state.json` is corrupt, the server tries to recover from `state.json.bak`. If it can, it first keeps the corrupt file as `state.json.bozuk-<time>` and logs what happened, and if it cannot, it refuses to start. Message bodies are opaque envelopes to the server and are never logged. Telsiz DJ states, presence, typing status and voice rosters exist only in memory and are reset when the server restarts.

## Client

The client is made of plain script files in the `public/` folder. There is no build step, package manager or framework. For compatibility with older WebKit based console browsers the code uses at most ES2017 syntax, and network requests use `XMLHttpRequest`. The page is written only with `createElement` and `textContent`, and no DOM is built from HTML strings.

`index.html` is a single page. First `theme-init.js` applies the theme before the first paint, then the encryption libraries (`vendor/nacl-fast.min.js`, `vendor/scrypt.js`), the dictionaries (`i18n.js`), the encryption helpers (`crypto.js`), emoji data, the Telsiz DJ engine (`music.js`, `dj/youtube.js`), the voice engine (`voice.js`) and the numbered modules from `public/js/01-core.js` to `25-arka-plan.js` are loaded. The list of module responsibilities is in [CONTRIBUTING.en.md](../CONTRIBUTING.en.md#project-layout).

The interface uses the Frequency layout: a top bar, the frequency band where the joined frequencies (each a separate Telsiz server) are arranged as stations (`24-frekans.js`, pressing a station switches to that frequency), the conversation column in the middle, and on wide screens the radio card and room info on the left and the list of text and voice rooms of the open frequency (Stations, a sheet opened from the Stations button on narrow screens) on the right. In the desktop app hidden background windows count the unread messages of frequencies that are not open (`25-arka-plan.js`, [desktop/README.en.md](../desktop/README.en.md)). Details are in [DESIGN.md](DESIGN.md). The service worker (`sw.js`) caches only the app shell and never touches `/api/` requests.

Data stored on the device lives in the browser's local storage: the session token, the group keyring (`telsiz.keys`), the personal identity key, pinned contact keys, theme and voice settings, and the YouTube consent. The search index exists only in the memory of the session and is never written to disk.

## Encryption

The only cryptographic primitives come from TweetNaCl-js 1.0.3: `secretbox` (XSalsa20-Poly1305) for symmetric encryption, `box` (a shared key over X25519 and XSalsa20-Poly1305) for direct messages, SHA-512 for hashing, and the secure random number generator of the browser. Key derivation from passwords uses scrypt-js 3.0.1. Both libraries sit unmodified under `public/vendor/`, and the checker verifies their sha256 values.

### Group key and envelopes

The group key is a 16 byte random secret. Users see it as a 28 character key code: 26 data characters in Crockford base32 and two checksum characters, in seven groups of four. When a code is typed, case, hyphens and spaces do not matter, and the checksum catches most typing errors. Two values are derived from the secret with domain separated SHA-512: an 8 byte key id (`kid`) and a 32 byte encryption key.

Text room messages, profiles, identity bindings, voice signals and the Telsiz DJ state use the same envelope format: `1.<kid>.<nonce>.<ciphertext>`. The nonce is 24 random bytes for every envelope. The plaintext carries fields that bind the content to its context, for example the author id and the room id in a message. The client checks these fields in every envelope it decrypts, so the server cannot move an envelope to another room or another author.

Files and images are each encrypted with their own random key and nonce. The file key, name, type and dimensions travel inside the encrypted plaintext of the message, and the server sees only the size of the encrypted file. Photos other than GIFs are re-encoded with a canvas before upload, which removes metadata including the location.

A new group key can be created. The new key becomes the active key and protects the content that follows, while older keys stay in the keyring on the device to read older messages. The group key travels in the part of the invite link after the `#` sign, which browsers do not send to the server.

### Password and account

The password is never sent to the server. The client derives a 32 byte master value with `scrypt(password, salt, N=16384, r=8, p=1)` and produces two keys from it with domain separated SHA-512: the authentication key (`authKey`) that is sent to the server, and the wrapping key (`wrapKey`) that never leaves the device. The server treats `authKey` as a password equivalent and stores a scrypt hash of it. For a username that does not exist, the pre-login endpoint (`/api/prelogin`) returns a fake but consistent salt derived from a server secret, so the answer does not reveal whether the user exists.

### Personal keys and direct messages

Every user has an X25519 identity key pair. The private key is stored on the server wrapped with `wrapKey` (the `1w.` format), so it can be unlocked with the password on every device. The unlocked key exists only in memory and in the local storage of that device.

So that a server without the group key cannot replace personal keys, each user publishes their public key with an identity binding sealed with the group key. The client uses a person's key only if that binding opens, the user id is correct and the key matches the one on the server. Keys are pinned on first sight. If a known key changes, a warning appears in the conversation and sending stays off until the user accepts the new key. Two people can verify each other by comparing a 60 digit safety number derived from their ids and public keys.

The direct message envelope has the format `2.<nonce>.<ciphertext>` and is encrypted with a shared key computed from both parties' keys with `box.before`. The server accepts only the `1.` format in text rooms and only the `2.` format in direct message conversations. There are no group direct messages and no private voice calls.

If a password is reset by the owner, an admin or the command line, the server deletes the person's public key, wrapped key and identity binding. The person creates a new key pair at the next sign in and can no longer read their old direct messages. When a person changes their own password, the same private key is wrapped again with the new password and direct messages stay readable.

## Voice

Audio flows over WebRTC as a full mesh: each person in a voice room opens a separate connection to every other person and sends their audio to each one separately. Audio is protected by WebRTC's mandatory encryption (DTLS-SRTP) and does not pass through the server. Up to 8 people can join a voice room.

Connection setup (SDP offers, answers and ICE candidates) is sent with `POST /api/voice/signal` and arrives in the recipient's poll answer. Every signal is encrypted with the group key, and its plaintext carries the peer ids of the sender and the recipient, a connection id and an increasing sequence number. The recipient checks the active key, the sender and recipient pairing and the sequence number, and drops old or repeated signals. A server without the group key therefore cannot change the connection setup or redirect it to someone else. STUN and TURN addresses come from the server when joining a voice room.

Microphone audio passes through a WebAudio pipeline. A detection branch measures the sound without delay, while the audio branch passes the gate with a short look-ahead delay, so syllable onsets are not cut in voice activity mode. In push to talk mode the microphone is open only while the assigned key, mouse side button, gamepad button or on screen button is held. Speaking is detected on each device from the local audio level. Mute and deafen states are reported to the server so they can be shown to the others.

## Screen sharing

Screen sharing is built on top of the voice connections. The person sharing picks a screen, window or tab with `getDisplayMedia` and sends an encrypted share announcement to the room. The video track is added only to the connections with people who pressed Watch. The watch request and stopping to watch are also encrypted signals. Adding or removing the video track on a connection uses WebRTC renegotiation.

The person sharing chooses one of four quality levels: 720p at 15 frames per second (the default), 720p at 30, 1080p at 15 and 1080p at 30. The preference for smooth motion or sharp text is passed to the browser as a content hint. If the browser provides tab or system audio, the share audio can also be sent as a track separate from the microphone. In a full mesh, the upload bandwidth of the person sharing is used separately for each viewer. In the desktop app, the app's own screen and window picker opens instead of the browser picker.

## Telsiz DJ

Telsiz DJ keeps a single music session for each voice room: the current track, the queue, whether it is playing or paused, and an anchor (a server time and a position in the track) used to compute the shared position. The whole state is one envelope encrypted with the group key. The plaintext is bound to the room id and the music context, and it is strictly validated after decryption.

The server (`src/music.js`) keeps this envelope only in memory and cannot see its contents. What the server knows is a version counter, the acceptance time, the size of the envelope and the ids of the users who wrote it. Writes are compare-and-swap: the client sends the version it expects, if that version is not current the write is not applied and the current record is returned, and the client applies its operation again on top of the new state. Only people in that voice room can write. The state of an empty room is removed after 30 minutes.

Each device plays the music in its own player and computes the position from the anchor. If the drift exceeds 1.5 seconds, the position is corrected silently. Shared audio files are encrypted uploads like message attachments and are decrypted and played on the device. YouTube tracks play in the official YouTube embedded player inside an isolated frame from the `youtube-nocookie.com` origin. No Google code runs in the app's own origin, and the YouTube API scripts are not loaded. The frame is never loaded before the person gives consent on that device, and the consent can be withdrawn in Settings > Privacy and security.

If the server owner turns off Telsiz DJ, the server rejects DJ writes. If the YouTube source is turned off, the restriction is applied on the members' devices, since the server cannot see the encrypted state.

## Desktop app

The desktop app (`desktop/`) is built with Electron for Windows and Linux. In the web version the interface code comes from the server on every visit. In the desktop app the files in the `public/` folder are copied into the app at build time, the sha256 value of each one is written to an integrity manifest, and the app verifies every file at startup. The page loads from the privileged `telsiz://app/` scheme and no interface file is downloaded from the server.

The page's API requests are forwarded to the configured server by a proxy in the main process. Only the required headers pass, redirects are not followed, and no cookies or cache are used. The server address must be `https://`, with the only exception being a server on the same computer. Windows run with context isolation and the sandbox on. Permissions are limited to the microphone, notifications and writing to the clipboard, and screen capture is granted only through the app's own picker. The only allowed subframe is the YouTube player of Telsiz DJ: a direct child frame of the app window's main frame, and only for the `https://www.youtube-nocookie.com` origin. Frames inside it and all other subframes are blocked. In the packaged app, Electron fuses turn off the Node.js mode and the `NODE_OPTIONS` variable. The detailed security architecture is in [desktop/README.en.md](../desktop/README.en.md).

## Packaging and releases

| Format | How it is produced |
| --- | --- |
| npm package `telsiz` | The `files` list in `package.json` contains only `server.js`, `src/`, `public/`, the license and the documents. The `bin` field maps the `telsiz` command to `server.js`. Publishing uses provenance. |
| Single file server | `scripts/sea-derle.js` bundles the server code into one CommonJS file with `scripts/paketle.js`, embeds the `public/` files as assets and builds a Node.js single executable application (SEA). The targets are `windows-x64`, `linux-x64` and `linux-arm64`. `scripts/sea-duman.js` tests the build with a real start. |
| Docker image | The `Dockerfile` uses the official Node.js 22 Alpine image, copies only runtime files and runs as a non root user. It is published as `ghcr.io/yerlifan/telsiz` for linux/amd64 and linux/arm64. |
| Desktop packages | electron-builder produces a Windows NSIS installer and a portable exe, and a Linux AppImage and .deb. |

GitHub Actions workflows:

| Workflow | Purpose |
| --- | --- |
| `ci.yml` | Checker and tests (Ubuntu and Windows, Node.js 20, 22 and 24), end-to-end tests with Chromium, shell script checks, building and running the Docker image |
| `exe.yml` | Building and smoke testing the single file server (with QEMU for linux-arm64) |
| `desktop.yml` | Unit tests of the desktop app, packaging, and a smoke test of the packaged build |
| `release.yml` | Runs when a tag starting with `v` is pushed: checks that the tag matches the `package.json` version and the CHANGELOG files, runs the tests, attaches all files and a combined `SHA256SUMS.txt` to the GitHub Release, and publishes the Docker image and (if `NPM_TOKEN` is set) the npm package |

Third party actions in the workflows are pinned by commit SHA rather than by tag. Release notes are extracted from the two CHANGELOG files with `scripts/surum-notlari.js`.

## Limits

Telsiz is designed to hide content from the server, but it does not hide everything, and like any software it cannot be guaranteed to be free of vulnerabilities. The project has not had an independent security audit. The known limits are as follows.

**Metadata the server sees.** The server cannot see message, file, profile or DJ content, but it does see: which user is online when and their status (including the invisible status), usernames, room names and the room list, roles, who writes to which room and direct message conversation, when and with what size, edit and delete events, the sizes of uploaded files, friendship and block relations, typing status (who is typing in which conversation and when), who is in which voice room and their mute and deafen state, the timing and size of voice signals, which voice rooms have a Telsiz DJ state, the size of the DJ envelope and who updates it and when, session labels derived from the browser's user agent (for example the browser and operating system name), and the IP addresses of connecting devices. Display names, about me, custom status text and profile pictures are encrypted.

**Code delivery in the web version.** In the web version the app code comes from the server on every visit. An active attacker who takes over the server, or an intermediary that terminates the HTTPS connection (a reverse proxy or a tunnel provider), could serve modified code and steal keys. This is the known limit of every end-to-end encrypted app that runs in a browser. The desktop app removes this risk because it carries the interface inside itself.

**The group key.** The group key is shared by everyone on the server. Anyone who knows the key can read all group content as long as they can reach the encrypted data. There is no forward secrecy. Someone removed from the group still knows the old key, and a new key protects only the content that follows. Anyone who sees the invite link learns the key.

**Direct messages.** Direct messages have no forward secrecy either, and the same identity keys are used for a long time. A member who has the group key and also runs the server, or colludes with it, could publish a fake identity binding. On the first conversation the key is not pinned yet, so such a man in the middle attack goes unnoticed. A later change is caught by the key change warning thanks to pinning on first sight, while an attack on the first conversation is caught only by comparing safety numbers. Verify the safety number over another channel for important conversations. When a password is reset, old direct messages can no longer be read.

**A malicious server and integrity.** The server cannot open envelopes, but it can serve the envelopes it stores however it likes. The plaintext of a message carries the author and the room id, but no message id or version. A malicious server can therefore replay or duplicate an old message, hide messages, and roll back an edit by showing the earlier version of a message. Text rooms have no sender signatures, and content is authenticated only with the shared group key. Anyone who has the group key, for example a member colluding with the server, can create messages in another member's name.

**Key renewal and removing members.** The client accepts content sealed with any key in its keyring, not only the active key. A member removed from the group still knows the old key, so with the server's help they can add new content sealed with the old key, and they can read history protected by the old key. When a member is removed, create a new group key to protect the messages that follow and share the new invite link only with the remaining members.

**Keys stored on the device.** Group keys, the personal identity key and the session token are in the browser's local storage. Anyone with access to the device or the browser profile can access them too.

**Voice and screen sharing.** Because audio and video flow directly between people, participants can see each other's IP address. In a full mesh each person sends their audio and shared video to every recipient separately. The design is therefore meant for small groups, and a voice room is limited to 8 people. The default STUN server belongs to Google, and devices that join a voice room contact it. If TURN is configured, its username and password are static and are sent to every signed in person who joins a voice room.

**Search.** Search runs only on the device, over history fetched page by page from the server and decrypted. At most 20000 messages per room are scanned, messages whose key is not on the device cannot be searched, and scanning takes time for large histories.

**YouTube.** When consent is given for a YouTube track, the player loads from Google's servers. Google sees the IP address of that device and which video is played, may collect tracking data and may show ads. The device of a person who does not give consent does not connect to YouTube. No request goes to Google for file tracks. When the server owner turns off the YouTube source, this is enforced on the members' devices. Since the DJ state is encrypted, the server cannot enforce it on the content, and a modified client could still add a YouTube track to the queue.

**Telsiz DJ author information.** The "added by" information in the queue is checked against the author records reported by the server. A malicious server could show this information wrongly, but it cannot change the contents of the tracks.

**Availability.** The server can withhold or delay messages, delete accounts and stop the service. End-to-end encryption protects the confidentiality of content, it does not guarantee that the server keeps running.

**Resource use.** The upload quota is shared by the whole server, and there is no per user storage quota. Even with rate limits, a signed in member can use up the shared quota and server resources. Share the server only with people you trust.

**Shared files.** Files of any type can be shared. Since the server cannot see the contents of files, no malware scanning is possible.

**Unsigned binaries.** The single file server and the desktop app are not code signed. Windows SmartScreen may show a warning on first start. Files can be verified with `SHA256SUMS.txt` on the release page. The Node.js base image of the Docker image is selected by a version tag and is not pinned by digest. The npm package is published with the `NPM_TOKEN` secret and with provenance. The Node.js binary used for the linux-arm64 build is verified against `SHASUMS256.txt` from nodejs.org, and no GPG signature is checked. The desktop app has no automatic updates. No single file server or desktop package is published for macOS.

**Use on a home network without https.** On an `http://` connection the content is still end-to-end encrypted, but session information travels unencrypted on the network, and an active attacker on the same network could modify the app code.
