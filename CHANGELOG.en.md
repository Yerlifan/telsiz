# Changelog

Notable changes in Telsiz releases are listed in this file. Version numbers follow [Semantic Versioning](https://semver.org/). Turkish version: [CHANGELOG.md](CHANGELOG.md).

## [Unreleased]

### New features

- Voice and video calls in direct messages: two friends can call each other with the Voice Call or Video Call button in the conversation header. A 2 second ring plays on all of the callee's open devices and an incoming call card opens with Accept and Decline buttons, plus Accept Without Camera for video calls (no ring in Do not disturb). During the call the top of the conversation shows both people's cameras or profile photos, with the conversation below. The call setup messages are encrypted with the two people's personal keys, and call information never enters the public meta. Calls are only possible between friends and while the other person's key is verified. Voice room moderation and the server mute do not reach private calls, and the owner's camera setting applies. Blocking, removing a friend, a ban and deleting the account end the call. New server settings: `callRingMs`, `callLimit`, `callWindowMs`.

### Changes

- The audio option for screen sharing appears in one place. The Also share audio switch in Telsiz's share window was removed: audio is always requested, and whether it is shared is chosen in the window where the source is picked, the audio option in the browser's own picker or the Also share system audio box in the desktop app's picker (Windows only). This box is now checked by default: a full screen share carries the whole computer's audio, and Telsiz's own sounds (the conversation, notifications, Telsiz DJ) are left out, so the people talking do not hear themselves echo back. Before, the desktop app needed both options turned on for audio to be shared.

### Fixes

- While sharing, Change source requested the new source without audio, so a share that started with audio lost it when the source changed. Audio is now requested when the source changes too.

### Security

- After a password reset the new personal key is created only while changing the password, in the same request, and is wrapped with the new password. While the account is on the temporary password the server does not store a key pair, so someone who knows the temporary password cannot choose or open the person's new key. If they use the temporary password before the person does, the person can no longer sign in with it and notices. A stale tab's request is refused and the tab reloads the current keys from the server.
- Sign in device token against lockout attacks: a successful sign in gives the device a token tied to the password hash. When the per account name failed sign in limit (20 per 15 minutes across all addresses) is reached, only sign ins without a token stop, and a device that signed in before can keep trying. Changing the password invalidates old tokens.
- Rate limit tables drop the least recently used entry when full instead of refusing new clients. As a result, a table flooded by many distinct clients can reset older counters.
- At most `hashConcurrency` (2) password hashes run at once and at most `hashQueueMax` (32) requests wait, the rest get 503 `server_busy`. Many sign in attempts cannot stall disk work.
- Upload slots: an account and an address can run at most 2 uploads at once, and the last free slot goes only to an account and address holding none (both refused with `busy_reserved`). Uploads must keep an average of at least `uploadMinBytesPerSec` (32 KB/s), shared between concurrent uploads of the same account or address. The default `maxConcurrentUploads` is 6 instead of 4. The client waits and retries on `busy_reserved` and waits one minute once when it hits the upload limit (429). A file's refused requests count against one budget, so wasted data is limited to 8 MiB for small files and to four times the file size for large ones.
- Stored message bodies are limited in total to `maxTotalMessages` times 1500 characters. When the limit is exceeded the oldest messages of the person storing the most body text are dropped, so other people's messages are not deleted because of them.
- The size of Telsiz DJ writes sent to everyone is limited per user, and voice room state changes have a separate, stricter limit (`voiceLimit`, 30 per 10 s).
- Protection against group key rollback: a key that was replaced on a device is retired and never used to encrypt again. An unknown key id reported by the server cannot retire any key.
- The `#frekanslar=` part of a link cannot add a fake frequency with a familiar name: a new frequency carrying the name of another listed frequency or of the open frequency is added without a name, new frequencies go to the end of the list, and the person is told their addresses.
- In direct message calls the camera turns on only by the person's own choice (Accept Without Camera). The callee's decline is hidden from the caller until the ring time ends, so the caller cannot tell a decline from no answer.
- Trimming leading and trailing dots and spaces from attachment file names runs in linear time (removes a regular expression slowdown with long names).
- The data folder lock also works across containers sharing the volume, and the running server renews the lock regularly.
- Docker: the example commands and the Compose file put the Docker gateway in `GUVENILIR_VEKIL`. Before, with `docker run`, and in Compose through a proxy or tunnel on the host, every client counted as one address. The server writes a warning once when a forwarding header arrives from an untrusted local address. Backup commands create the archive readable only by its owner (`umask 077`).
- Password key derivation is four times stronger: new accounts and password changes use scrypt N=65536 (was 16384). Accounts created by earlier versions are upgraded in the background after sign in, with the same password and the same private key (`POST /api/me/kdf`), and other sessions stay signed in. If the server is compromised, guessing passwords offline costs four times as much. Sign in takes about one second on a desktop.
- When the name of a frequency added by a link is compared, look-alike letters from other alphabets (for example Cyrillic а), digits (1 and 0), capital I and lowercase l, accents, invisible characters, spaces and punctuation are ignored, so a familiar name cannot be imitated this way.
- When a rate limit table is full, counters that are currently at their limit (blocking) are not dropped. Filling the table with many distinct clients no longer resets an account's failed sign in counter.

## [2.3.0]

### New features

- Notifications: a short list of events above the radio card in the left column. When someone in the same voice room starts sharing their screen it is listed with a Watch button and removed when the share ends. Joining and leaving voice rooms are listed too.
- The Stations list shows the people in each voice room below it: avatar, name, mute and camera icons, and a ring around the avatar of the person speaking.
- Fit and Fill buttons on the camera grid. The choice is kept separately from screen sharing, Fill by default.
- The font size can be set by hand between 12 and 28 pixels with the slider in Settings > Appearance (Custom).
- Hovering over someone sharing their screen in the crew of the radio card shows a Watch stream button (always visible on touch screens).
- Right clicking the Microphone button (Shift+F10 on the keyboard) switches between Push to talk and Voice activity.
- Kicking from the frequency: the Kick button in Settings > Members deletes the person's account after a confirmation (`POST /api/users/kick`). Their sessions are signed out and their open app says they were kicked from the frequency, the username becomes free, and their messages stay with a deleted author. To come back, they need to register again with an invite code. The permission and rank rule is the same as for banning (the Ban members permission also covers kicking), and the owner can never be kicked.
- Turn off camera in voice room moderation: someone with the voice room moderation permission can turn off the open camera of a person ranked lower from the voice card or the profile card (`POST /api/voice/moderate`, the `camera-off` action). The button shows only while the person's camera is on. Turning it off is a one time action: the person's app stops the camera and tells them, and they can turn it on again.
- Advanced noise suppression (RNNoise): non-speech sounds such as keyboard clicks and hum are suppressed on the device before they reach others. It sits next to the browser's noise suppression switch in Settings > Voice and video > Voice processing, is on by default and turns on and off without restarting the microphone. The WebAssembly build of RNNoise (`@shiguredo/rnnoise-wasm` 2022.2.0, BSD-3-Clause and Apache-2.0) ships with the app and runs in an AudioWorklet. If the browser does not support AudioWorklet or WebAssembly, or the files cannot be loaded, the audio continues without a gap with the browser's own processing. `'wasm-unsafe-eval'`, which allows only WebAssembly compilation, was added to the page's Content Security Policy (server and desktop app). If a reverse proxy writes this header itself, it needs the same keyword.
- Push to talk in the desktop app while Telsiz is in the background (for example while a game is open): a push to talk row was added to the global shortcuts on the Settings > Keybinds page. In the default "press to start, press to stop" mode, pressing once starts talking, pressing again stops, and a short sound plays. If the optional "Hold to talk (key hook)" option is turned on, you talk while the chosen key is held and go quiet when you release it. The hook only runs while you are in a voice room in push to talk mode, it sees every key event on the system but only handles the chosen key, and key codes never go to the page or the log. In Voice activity mode the shortcut toggles the microphone. The uiohook-napi 1.5.5 dependency was added to the desktop app.
- In the desktop app (Windows and Linux) a thin title strip in the theme color replaces the native title bar and menu bar: the minimize, maximize and close buttons take the background and text color of the theme and change with it. The app menus (Telsiz, Edit, View, Help) open from the buttons on the left of the strip, and menu shortcuts keep working. In full screen the strip goes away.
- The voice of people in a voice room can be boosted up to 200%: the Volume slider on the person's volume card and profile card goes from 0 to 200. Up to 100% the voice plays from the audio element as before, above it that person's voice is boosted with a gain node in the audio context and passes through a limiter that softens hard clipping. With speakers, Chromium's echo cancellation may not take the boosted voice into account.
- Sound notifications: a distinct 2 second sound plays when someone joins or leaves the voice room, when someone starts a screen share, when a direct message or a friend request arrives and when you drop out of the voice room (`public/js/31-sesler.js`). The sounds are not played from files, they are synthesized with Web Audio (short bell, marimba and glass melodies). Settings > Notifications has a slider for the volume of all notification sounds (40% by default, quiet) and buttons to play each sound. Voice room sounds follow the Voice room sounds setting and stay silent for other people's actions while you are deafened. The direct message and friend request sounds follow the message and request sounds setting and the Do not disturb status. A screen share that is already running when you join does not play a sound. The background windows of the desktop app play no sounds.

### Changes

- The default font size is 15 pixels instead of 16 (Normal). All measurements shrink with the font size.
- Top bar: the On air chip is now called Online and sits right next to the frequency information, Search is exactly in the middle, and Direct messages and Friends sit right to the left of the profile button.
- The frequency band is 3.5rem high instead of 4rem, and the needle knob is smaller.
- On wide screens the tuned station card at the bottom left was removed (the room name and the encryption state are in the conversation header, Encryption details and Manage room are in Settings). The radio card sits at the very bottom of the left column.
- The buttons of the radio card are in two rows: Camera, Microphone and Deafen on top, Screen and Leave below. Each button has its own color.
- Enlarge and Telsiz DJ are wide labeled buttons in a separate row below the crew instead of items at the end of the crew. Enlarge shows the number of cameras on.
- The voice activity strip is a single line, half as tall.
- The avatars in the crew of the radio card are 3.125rem instead of 2.75rem, and camera tiles are 4.75rem instead of 4.25rem.
- While the camera grid is open the right column (Stations) stays in place, the stage only covers the conversation column and the latest messages stay open below the stage.
- While Telsiz DJ is playing the Stations list is at the top of the right column and the DJ card below it.
- On wide screens Settings is centered together with its sidebar and content, slightly to the left.
- On wide screens the screen share notice no longer opens separately at the top right, it is in the Notifications list.
- Role names start with a capital letter: Owner, Admin, Member.
- Every word in button, menu item, tab and chip labels starts with a capital letter in both languages (for example Direct Messages, Try Again, Remove From Room). English uses standard Title Case, and Turkish conjunctions such as ve, ile and veya stay lowercase. The header lines follow the same style: "Frekans · 9 Üye · Şifreli", "Açık · 4 Çevrimiçi", "Yazı Odası" and "Uçtan Uca Şifreli".
- Someone else's screen share is no longer shown in the top bar (the "X is live · Watch" chip was removed). The "Your screen is live · Stop" chip of your own share stays.
- The crew of the radio card is centered, and three people fit on one row while a camera is on.
- The Join and leave sounds setting in Voice and Video is now called Voice room sounds, and the Message sound section in Notifications is now Notification sounds. Join and leave sounds are no longer cut off when you leave the voice room, and dropping out of the voice room plays the disconnect sound instead of the leave sound.

### Fixes

- In the desktop app the Full screen button of the stage did not cover the whole screen (the app denied the full screen permission). The full screen permission is now granted only to the app's main frame, and the YouTube player cannot go full screen.

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
