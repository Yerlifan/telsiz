# Changelog

Notable changes in Telsiz releases are listed in this file. Version numbers follow [Semantic Versioning](https://semver.org/). Turkish version: [CHANGELOG.md](CHANGELOG.md).

## [Unreleased]

### Fixes

- When system audio was shared with a screen share, the conversation in Telsiz was also captured and listeners heard their own voices back. The share audio is now requested with the `restrictOwnAudio` constraint: the desktop app and browsers that support it remove the sounds Telsiz itself plays (the conversation, notification sounds, Telsiz DJ) from the shared audio. On older Windows versions that cannot separate it, all system audio is still shared.

## [2.2.0]

### New features

- Custom roles: the owner creates roles in Settings > Roles with any name and one of eight colors (at most 20), turns their permissions on one by one and orders them. Roles are given to members in Settings > Members, and a member can have one role. The role name shows as a badge on the profile card and in the On air list.
- Role permissions: delete messages, ban members, moderate voice rooms, manage rooms and manage the Telsiz DJ queue. The owner and admins have every permission. A role higher in the list has more authority, and banning and voice room moderation only apply to people ranked lower.
- Voice room moderation: a permitted person can mute someone for everyone or remove them from the voice room from the crew or the profile card. The mute stays when the person leaves and joins again. Since audio flows directly between people, the mute is applied by the clients: the muted person's microphone is turned off and the other devices do not play that person's audio.
- Telsiz DJ restricted mode: when the owner turns it on, only people with the DJ permission manage the queue while one of them is in the room, and others listen. If no such person is in the room, everyone can manage it. The rule is enforced by the server.
- A Remove from list submenu in the desktop app's Telsiz > Frequencies menu: the frequency is removed after a confirmation dialog, optionally together with its sign-in and data on this device.

### Changes

- The right column (Stations and the Telsiz DJ card) is 17rem wide instead of 14.5rem.
- The "For you" volume slider on the Telsiz DJ card shows the volume and mute changed with the YouTube player's own controls. Sound turned down in the player can be turned up again with the slider.

### Fixes

- When the encryption key was added after signing in (for example at the first sign-in in the desktop app), Telsiz DJ stayed on the "the encryption key of this frequency is not on this device" notice. The music state is opened again once the key is added.

## [2.1.0]

### New features

- Multiple frequencies: every Telsiz server is a frequency, and you can join several. The top band lists the frequencies you joined: open or closed, online count, unread and mention counts. Text and voice rooms are in the Stations list on the right. The Frequencies page adds frequencies and removes them from the list.
- The desktop app opens saved frequencies in their own session partitions and counts unread messages and mentions in the background for up to 8 frequencies that are not open. It can show notifications for mentions and direct messages in those frequencies.
- The desktop app updates from GitHub releases. The Windows installer and the AppImage download and install the update, the portable build and the .deb package announce the new version. It can be turned off in Settings.
- Frequency landing page: a visitor who is not signed in sees the frequency name, the owner's about text, Telsiz's features, the desktop download link and a VPS and domain setup guide. The owner writes the about text in Settings > General. The text is public and not encrypted.
- Frequency photo: the owner can upload a photo for each frequency (PNG, JPEG or WebP, up to 1 MB). The photo replaces the letter emblem on the frequency button, the band, the Frequencies page, the sign-in screen and the landing page. The desktop app also shows the photos of other frequencies. The photo is public and not encrypted.
- Telsiz DJ: a track added with `/çal` is announced in the text room where the command was typed. The announcement is end-to-end encrypted.
- Telsiz DJ docked player: while Settings or another window is open, or on narrow screens while the DJ sheet is closed, the YouTube player stays visible in a corner and the music keeps playing. Music stops when you leave the voice room, the DJ is turned off or the queue ends.
- Camera in voice rooms: everyone can turn on their own camera (off by default, 360p at 15 fps). The crew avatar of someone with their camera on becomes live video, and Expand shows all cameras in a grid. While your own camera is on, an always visible indicator is shown. Video flows between people encrypted with DTLS-SRTP and does not go through the Telsiz server. The server only knows whose camera is on and enforces the limit.
- The owner can change the voice room capacity (2 to 12 people, 8 by default), whether cameras are allowed and the number of cameras that can be on at the same time in a room (4 by default) in Settings > General.
- Server information and recommendation: in Settings > General the owner and admins see the processor, memory (including the container limit), disk, usage and TURN status. A recommended room capacity and camera limit are calculated from the members' typical upload speed, and the screen says that the values are estimates.
- Shared footer on the sign-in page (desktop app, GitHub link, license and version) and a radio themed doodle background.
- Per-user upload quota (`KULLANICI_YUKLEME_KOTASI_MB`, default 512 MB) and a total message cap across all rooms (`MAKS_TOPLAM_MESAJ`, default 500000). When the total cap is exceeded, the oldest messages of the busiest rooms are removed.

### Changes

- For security related actions such as changing a password, signing out, revoking sessions, deleting an account, blocking, changing a role, rotating the invite code and changing the group key, the response is sent after the change is written to disk and fsynced.
- The default font size is 16 pixels. A size chosen earlier is kept.
- While Telsiz DJ is playing, the DJ card sits at the top of the right column and the Stations list stays visible below it.
- The npm package is published with GitHub OIDC trusted publishing instead of a token, with provenance.
- End-to-end tests also run in Firefox and WebKit besides Chromium. Playwright was updated to 1.63.0.

### Fixes

- The chat column stayed limited to 46rem on wide screens because the rule that removed the limit came before the rule that set it. The column now takes all the width left by the side columns.
- At the 16 pixel font size, the narrower DJ column made the YouTube player smaller than 200 pixels and it paused. The player area now stays at least 200x200 at every font size.

## [2.0.1]

### Fixes

- In the desktop app, YouTube videos of Telsiz DJ failed with "Error 153: Video player configuration error". The app now adds the server origin as the Referer of the YouTube player frame request. The same information is sent as in the web version.
- If a user is blocked, signs out, has their session revoked or deletes their account while uploading a file, the upload is no longer saved. The session is checked again when the upload finishes, and running uploads of a closed session are aborted.
- Resending a message whose response was lost no longer creates a second message. Every send carries a client id (`clientMessageId`), and the server returns the first message for a repeated send. Repeats of messages with attachments no longer fail with `bad_uploads`.
- Direct conversations with deleted accounts stay as history but no longer count toward the active conversation limit.
- When two server processes start on the same data folder at nearly the same time, only one of them takes the data lock, the other does not start.
- The service worker deletes only Telsiz's own old caches and leaves the caches of other apps on the same origin alone.

### Changes

- Server binaries are named `telsiz-<version>-server-windows-x64.exe`, `telsiz-<version>-server-linux-x64` and `telsiz-<version>-server-linux-arm64` so they are easy to tell apart from the desktop app on the release page.
- The GitHub actions in the CI and release workflows were upgraded to versions that run on Node.js 24.

## [2.0.0]

The first public release of Telsiz: open source, end-to-end encrypted text and voice communication that runs on your own server or on a hosting service. It works on any device with a browser, and the server has no runtime dependencies.

### Frequency layout

- A new interface layout: rooms sit as stations on a horizontal frequency band at the top of the screen, and a needle above the band shows the open conversation. The needle can be dragged with a mouse or a finger and dropped on the nearest station. Unread and mention badges sit on the corners of stations, and a voice room with someone speaking in it pulses.
- A single conversation column in the middle, and on wide screens a left info column and an inbox card that collects unread messages on other frequencies.
- A radio card that opens when you join a voice room: the people in the room, a halo around the speaker, a large Push to talk button, and Microphone, Deafen, Screen and Leave buttons.
- Direct messages and friends in the Personal group of the band, people in a sheet opened from the On air strip in the top bar, and profile, status and settings in the avatar menu at the top right.
- The band works with the keyboard (arrow keys, Home, End, Enter), the wheel (horizontal scrolling only) and a gamepad (L1 and R1). On phones the band scrolls with a finger, the All sheet lists every station and the radio card sticks to the bottom of the screen. At TV width text grows, and a hint bar appears when a gamepad is detected.
- Avatars are soft squares in every theme.

### Encryption and privacy

- Text room messages, files and images, profile information (display name, about me, custom status, profile picture), the connection setup messages of voice chat and screen sharing, and the Telsiz DJ state are encrypted in the browser with the group key (TweetNaCl-js, XSalsa20-Poly1305). The server stores and relays this content only in encrypted form.
- Direct messages are encrypted with the personal keys of the two people (X25519). The other person's key can be verified with a safety number, it is pinned on first sight and a warning is shown when it changes.
- The password is never sent to the server. The browser derives an authentication key from the password with scrypt, and the server stores a scrypt hash of that key. The personal private key is stored wrapped with a key derived from the password.
- The group key travels in the part of the invite link after the # sign, which browsers do not send to the server. The key can also be entered by hand.
- A new group key can be created, and the new key protects the messages that follow. Keys for older messages are kept in the keyring on the device.
- Photos other than GIFs are re-encoded before they are sent, which removes metadata including the location.
- Message search and @ mentions run entirely in the browser, the server never sees the search text or the message content.

### Server security

- Authorization checks on the server at every endpoint, type and length checks on every input, limits on bodies, queues and counts.
- Rate limits per account and per IP address (sign in, registration, messages, uploads, administration, friend requests, typing notifications, voice signals, Telsiz DJ writes).
- Session tokens are stored on disk only as hashes, and comparisons run in constant time.
- A strict Content Security Policy (CSP), security headers and no CORS headers. The only allowed frame is the YouTube embedded player (`youtube-nocookie.com`). Static files are served only from an allowlist, and path traversal attempts are rejected.
- Behind a reverse proxy, the client address is read only from headers sent by trusted proxies (`GUVENILIR_VEKIL` or `TRUSTED_PROXY`).
- Data files are written atomically. If a corrupt `state.json` is recovered from the backup it is first copied to a separate file, and if it cannot be recovered the server does not start.

### Text communication

- Multiple text rooms, persistent and encrypted message history (the last 20000 messages per room), paging through the history.
- Editing and deleting messages.
- Sharing files and images: up to 10 files per message, a default limit of 25 MB per file and a configurable total quota, inline images, an image viewer, file cards, paste and drag and drop.
- Emoji picker with categories, recently used emoji and keyboard navigation.
- @ mentions with a suggestion list. Owners and admins can mention everyone in text rooms.
- Unread message and mention counters.
- Typing indicator. You can turn off sending your own typing status.
- Message search in this room or conversation, in all text rooms or in direct messages, with filters for a person and for messages with images or files, and jumping from a result to the message in context.
- Desktop notifications and a message sound, with a notification level (all messages, only mentions and direct messages, or none).

### Voice communication

- Multiple voice rooms with up to 8 people per room. Audio flows directly between people over WebRTC (DTLS-SRTP) and does not pass through the server.
- Speaking indicator, mute, deafen, per person volume and an overall output volume.
- Two input modes: voice activity (automatic or manual sensitivity threshold) and push to talk (with a release delay and an on screen Push to talk button).
- Key bindings for push to talk, mute and deafen: a keyboard key, a mouse side button or a gamepad button.
- Microphone selection and test, an input level meter, echo cancellation, noise suppression and automatic gain options, join and leave sounds.
- Your own TURN server can be configured for networks that need it (`TURN_URL`, `TURN_KULLANICI`, `TURN_SIFRE`).

### Screen sharing

- Sharing a screen, window or tab in a voice room. Video is sent only to people who press Watch.
- Four quality levels (720p at 15 frames per second by default, 720p at 30, 1080p at 15, 1080p at 30), a smooth motion or sharp text preference, and share audio separate from the microphone if the browser provides it.
- A broadcast stage: choosing between several shares, fit and fill, full screen, a collapsed chat strip, a preview for the person sharing and a "Your screen is live" chip visible on every station.
- In the desktop app, its own screen and window picker with thumbnails, and an option to share system audio on Windows.

### Telsiz DJ

- A built-in music bot in voice rooms. Everyone hears the track at the same time on their own device, and position drift is corrected automatically.
- Adding tracks: `/play` and a YouTube link in the message box, or "Play in DJ" on an audio file in a message. The other commands are `/skip`, `/pause`, `/resume`, `/queue` and `/stop`, and in the Turkish interface `/çal`, `/geç`, `/duraklat`, `/devam`, `/kuyruk` and `/dur`.
- A DJ card with the player, a position bar, the queue, a personal volume and muting the DJ only on your own device.
- YouTube tracks load in the official YouTube embedded player, and only after the person gives consent on that device. Consent can be withdrawn in Settings > Privacy and security. Shared audio files play without consent.
- The DJ state is encrypted with the group key and kept only in memory on the server. The owner can turn off Telsiz DJ or only the YouTube source in Settings > General.

### People, profiles and direct messages

- Friend requests (send, accept, decline, withdraw), a friends list and removing friends.
- Blocking: text room messages of a blocked person are collapsed, their voice is muted on your side and they cannot send you direct messages.
- Direct messages with a conversation list and unread counters. You can stop accepting direct messages from server members.
- Profiles: display name, about me, profile color, a profile picture that can be cropped, a custom status and a status (online, idle, do not disturb, invisible), and a profile card.

### Accounts and administration

- Roles: owner, admin and member. The owner account is created with a one time setup code shown in the server console, other accounts are created with an invite code.
- Creating, renaming, reordering and deleting rooms. The last text room cannot be deleted.
- Changing the server name and renewing the invite code.
- Member management: changing roles, banning and unbanning, resetting a password with a temporary password.
- Account settings: changing the password and the username, deleting the account, viewing and signing out active sessions.
- If the owner forgets the password, it can be reset from the command line while the server is stopped: `sifre-sifirla` or `reset-password`.

### Appearance and languages

- Three themes (Arcade, Night Frequency, Turquoise and Copper), each with a dark and a light mode and an option to follow the system setting.
- A full screen settings view, font size, compact message view and reduced motion settings.
- Turkish and English interface. Server error messages follow the language of the request, and console messages follow the `DIL` setting or the system language.

### Installation and running

- Installing as an app (PWA): it opens in its own window on phones, tablets and computers (https is required).
- Real time communication uses HTTP long polling, WebSocket is not needed.
- The server runs on Node.js 20 or newer, has no runtime dependencies and keeps its data in JSON and JSONL files.
- npm package: `npx telsiz`. The data folder is the `veri` folder in the folder where the command is run.
- Standalone server: a single file for Windows (x64) and Linux (x64, arm64) that contains Node.js and the app files. The data folder is the `veri` folder next to the file, and settings can also be read from a `telsiz.env` file next to it. The window does not close right away when starting fails.
- Docker image `ghcr.io/yerlifan/telsiz` (linux/amd64 and linux/arm64) with a non root user, a persistent data volume and a health check. Docker Compose, systemd, Caddy and nginx examples are in the `deploy/` folder.
- `baslat.bat` and `tunel.bat` for Windows, `baslat.sh` and `tunel.sh` for Linux and macOS. The tunnel scripts open a temporary https address with a Cloudflare quick tunnel.
- `SHA256SUMS.txt` to verify the release files. Third party actions in the GitHub Actions workflows are pinned by commit SHA.

### Desktop app

- A desktop app for Windows and Linux. The app files are shipped inside the app and verified against a sha256 manifest at startup, they are not downloaded from the server.
- The server address must use https (http://localhost is allowed for a server on the same computer). Requests to the server go through the main process of the app.
- Only microphone, notification and clipboard write permissions are granted, all other permissions are denied. Screen capture is granted only through the app's picker. The only frame that can open is the YouTube player of Telsiz DJ.
- Global shortcuts for mute and deafen, and an option to minimize to the system tray on close.

### Known limitations

- In the web version the app code comes from the server. An active attacker who controls the server or an intermediary that terminates the HTTPS connection could serve modified code. In the desktop app the app code ships inside the app, so the server cannot change it.
- The server sees metadata: who wrote, when, in which room and how much, who is online and who is in which voice room. Room names, usernames and the typing status are not encrypted.
- A malicious server can replay and hide messages and roll back edits. Text rooms have no sender signatures, so anyone with the group key can create messages in another member's name.
- The group key is shared by everyone on the server and there is no forward secrecy. A new key protects only the messages that follow.
- In voice chat and screen sharing people can see each other's IP address. The full mesh design is meant for small groups.
- The IP address and tracking data of a device that gives consent for a YouTube track go to Google.
- Voice chat, screen sharing and installing the app require https (except at the localhost address on the computer that runs the server).
- The standalone server and the desktop app are not code signed, so Windows may show a warning on first start. The desktop app has no automatic updates and no global push to talk shortcut that works while held down.
- No standalone server or desktop package is published for macOS. On macOS use `npx telsiz`, `baslat.sh` or Docker.
- The full list of limits is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#limits).
