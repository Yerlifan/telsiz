# Telsiz deployment guide

[Türkçe](KURULUM.md) | [English](DEPLOYMENT.md)

This document explains how to run the Telsiz server on your own computer or on a server, how to put it online, how to back it up and how to update it. For a short introduction and a quick start see [README.en.md](../README.en.md), and for how the system works see [ARCHITECTURE.md](ARCHITECTURE.md).

In the interface every Telsiz server appears as a **frequency**: the server you set up, with its own name, rooms and members, is one frequency. Users can join several frequencies and switch between them from the frequency name in the top bar. In this document "server" means the program and the machine that runs it.

## Requirements

The server is a single process with no runtime dependencies. The table below summarizes what each installation path needs.

| Installation path | Needs |
| --- | --- |
| npm package | Node.js 20 or newer |
| From the repository (`baslat.bat`, `baslat.sh`, systemd) | git or a repository archive, Node.js 20 or newer |
| Windows single file | Windows x64, no Node.js needed |
| Linux single file | Linux x64 or arm64, no Node.js needed |
| Docker | Docker, optionally Docker Compose |

No single file server is published for macOS. On macOS use the npm package, `baslat.sh` or Docker. To put the server online you also need an https address (see [HTTPS](#https)). On the user side a current browser is enough.

## Installation paths

Whichever way the server is started, at startup it prints the version, the server name, the full path of the data folder, the setup code if there is no owner account yet, and the addresses to reach it. The default port is 3000.

### npm package

```sh
npx telsiz
```

For a permanent installation:

```sh
npm install -g telsiz
telsiz
```

The data folder is the `veri` folder inside the folder where the command runs, and nothing is written into the `node_modules` folder where the package is installed. Always run the command in the same folder, or give a fixed path with `VERI_KLASORU` (`DATA_DIR`):

```sh
DATA_DIR=/srv/telsiz-data npx telsiz
```

### Windows single file

1. Download `telsiz-<version>-server-windows-x64.exe` and `SHA256SUMS.txt` from the [Releases](https://github.com/Yerlifan/telsiz/releases) page on GitHub.
2. Put the file in an empty folder of its own, for example `C:\Telsiz`.
3. Double click the file. Because the file is not code signed, Windows SmartScreen may show a warning. In that case choose "More info" and then "Run anyway".
4. The window that opens is the server itself and must stay open while Telsiz is in use. Press Ctrl+C in the window to stop it.

The data folder is the `veri` folder next to the file. If startup stops with an error, the window does not close right away, it closes with the Enter key after you read the error. For settings you can place a `telsiz.env` file next to it (see [Settings](#settings)).

### Linux single file

Download `telsiz-<version>-server-linux-x64` for x64, or `telsiz-<version>-server-linux-arm64` for arm64 (for example Raspberry Pi).

```sh
chmod +x telsiz-<version>-server-linux-x64
./telsiz-<version>-server-linux-x64
```

As with the Windows build, the data folder and the `telsiz.env` file are next to the executable.

### From the repository

```sh
git clone https://github.com/Yerlifan/telsiz.git
cd telsiz
./baslat.sh
```

`baslat.sh` (Linux and macOS) and `baslat.bat` (Windows) check that Node.js is installed and at least version 20, change to the folder of the script and run `node server.js`. The data folder is the `veri` folder in the repository folder. The beginning of each script contains ready lines for common settings (`SUNUCU_ADI`, `PORT` and the TURN settings). Double clicking `baslat.bat` is enough, and the window must stay open while the server runs. Arguments given to the script are passed to the server, for example `./baslat.sh reset-password deniz`.

The `node server.js` or `npm start` command can also be used directly.

### Docker

The published image is built as `ghcr.io/yerlifan/telsiz` for linux/amd64 and linux/arm64, with a version tag (for example `2.0.0`) and the `latest` tag.

```sh
docker run -d --name telsiz --restart unless-stopped -p 127.0.0.1:3000:3000 -v telsiz-veri:/data ghcr.io/yerlifan/telsiz:latest
docker logs telsiz
```

The image runs as the non root `node` user, keeps data in the `/data` volume and includes a health check that probes `/api/info`. The command above publishes the port only to this machine, and a reverse proxy or a tunnel faces the internet. You can also build the image yourself from the repository:

```sh
docker build -t telsiz .
```

### Docker Compose

[deploy/docker-compose.yml](../deploy/docker-compose.yml) builds the image from the repository and starts a container with a read only root file system and all capabilities dropped. For Telsiz only:

```sh
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml logs telsiz
```

If the DNS record of your domain points to this server and ports 80 and 443 are open, the same file can also start Caddy for automatic HTTPS:

```sh
TELSIZ_ALAN_ADI=telsiz.example.com docker compose -f deploy/docker-compose.yml --profile caddy up -d
```

The Compose file gives the Caddy container a fixed address and writes that address into the `GUVENILIR_VEKIL` setting. If you do not use Caddy and run your own reverse proxy on the host itself, set the Docker gateway address as described in the comments of the file.

### systemd

[deploy/telsiz.service](../deploy/telsiz.service) is a hardened unit file that keeps the code in `/opt/telsiz` and the data in `/var/lib/telsiz`, and lets the server listen only on `127.0.0.1:3000`. The installation steps are written at the top of the file:

```sh
sudo git clone https://github.com/Yerlifan/telsiz.git /opt/telsiz
sudo useradd --system --home /var/lib/telsiz --shell /usr/sbin/nologin telsiz
sudo cp /opt/telsiz/deploy/telsiz.service /etc/systemd/system/telsiz.service
sudo systemctl daemon-reload
sudo systemctl enable --now telsiz
sudo journalctl -u telsiz
```

The unit file expects Node.js at `/usr/bin/node`. Check the path with `command -v node`. A reverse proxy such as Caddy or nginx faces the internet.

## Step by step with a VPS and a domain

This section walks through setting up a frequency on a rented virtual server (VPS) with your own domain and automatic HTTPS. A short version of the same guide is also on the introduction page that visitors who are not signed in see, under "Set up your own frequency".

1. **Rent a VPS.** Ubuntu 24.04 with 1 to 2 GB of memory is enough. Pick a plan with KVM virtualization, a static IPv4 address and open ports 80 and 443.
2. **Point your domain to the VPS.** Add an A record in your domain panel: Name `@` (or a subdomain such as `telsiz`), Value the IP address of the VPS. If you use Cloudflare, the record must be "DNS only" (grey cloud), otherwise Caddy cannot get a certificate. Check that the record has spread, the answer should show the IP address of the VPS:

   ```sh
   nslookup example.com
   ```

3. **Connect to the VPS.** Connect with the IP address and password from your provider, then change the password first:

   ```sh
   ssh root@IP
   passwd
   ```

4. **Install Telsiz.** Install Docker, download the repository and start Telsiz with Caddy. Caddy gets and renews the HTTPS certificate by itself:

   ```sh
   curl -fsSL https://get.docker.com | sh
   git clone https://github.com/Yerlifan/telsiz.git && cd telsiz
   TELSIZ_ALAN_ADI=example.com docker compose -f deploy/docker-compose.yml --profile caddy up -d
   ```

5. **Create the owner account.** Find the setup code in the log, open `https://example.com` and create the owner account. Then write the frequency introduction in Settings > General and share the invite link:

   ```sh
   docker compose -f deploy/docker-compose.yml logs telsiz
   ```

Other ways: if you do not want a rented server, use the [Windows single file](#windows-single-file) or [Linux single file](#linux-single-file) server or the [npm package](#npm-package) (`npx telsiz`). These suit trying it on your local network or through a [tunnel](#tunnel). See [Updating](#updating) and [Backups](#backups) for updates and backups.

## Settings

The server is configured with environment variables. Each setting has a Turkish name and an English alias, and if both are set the Turkish name wins. If a value is invalid, the server does not start and prints which setting is wrong.

| Setting | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | The port to listen on (1 to 65535). |
| `HOST` | `0.0.0.0` | The address to listen on. `127.0.0.1` is recommended when the reverse proxy is on the same machine. Inside a container `0.0.0.0` is required. |
| `SUNUCU_ADI` (`SERVER_NAME`) | `Telsiz` | The initial name, used only on first setup, at most 40 characters. |
| `VERI_KLASORU` (`DATA_DIR`) | `veri` | The data folder. The default is the `veri` folder in the working folder, or next to the file for the single file server. |
| `MAKS_YUKLEME_MB` (`MAX_UPLOAD_MB`) | `25` | The size limit of a single file (MB), at most 1024. |
| `YUKLEME_KOTASI_MB` (`UPLOAD_QUOTA_MB`) | `2048` | The total limit for all uploads (MB). It cannot be smaller than the single file limit. |
| `KULLANICI_YUKLEME_KOTASI_MB` (`USER_UPLOAD_QUOTA_MB`) | `512` | The total limit for one user's uploads that are still stored (message attachments, the profile picture, files not sent yet), in MB. When it is full, uploads are refused with a 507 error, and the person frees space by deleting older messages with files. It cannot be smaller than the single file limit, and when not set it is raised to the single file limit. |
| `MAKS_TOPLAM_MESAJ` (`MAX_TOTAL_MESSAGES`) | `500000` | The total number of messages stored across all rooms and direct message conversations (1 to 100000000), which protects the server's memory. When it is exceeded, new messages are not refused: the oldest messages of the conversations with the most messages are removed together with their attachments. The limit of 20000 messages per room still applies. |
| `STUN_URL` | `stun:stun.l.google.com:19302` | Comma separated `stun:` or `stuns:` addresses. If the variable is set to an empty string, no STUN server is used. |
| `TURN_URL` | empty | Comma separated `turn:` or `turns:` addresses. |
| `TURN_KULLANICI` (`TURN_USERNAME`) | empty | TURN username. |
| `TURN_SIFRE` (`TURN_PASSWORD`) | empty | TURN password. |
| `GUVENILIR_VEKIL` (`TRUSTED_PROXY`) | `loopback` | Proxies allowed to supply the client address in the `X-Forwarded-For` and `CF-Connecting-IP` headers. Values: `loopback`, `none`, an IP address or a CIDR block, comma separated, at most 64 entries. |
| `DIL` (`TELSIZ_LANG`) | system language | The language of console and log messages: `tr` or `en`. API error messages always follow the language of the request. |

The number of rooms (50 text and voice rooms together), direct message conversations per person (500) and accounts (500) are fixed limits that cannot be changed with environment variables.

### telsiz.env

The single file server (Windows and Linux) reads the `telsiz.env` file next to the executable. The file can be written with an editor such as Notepad. Each line holds `NAME=value`, and lines that start with `#` are comments. Spaces around the value and matching quotes are removed, and there are no end of line comments. Only the settings in the table above are read, and unknown names are ignored with a warning. If the same setting is also defined as an environment variable, the environment variable wins. The file can be at most 16 KB.

```ini
# Telsiz settings
SERVER_NAME=Friday Night
PORT=3000
TELSIZ_LANG=en
```

The npm package, the repository copy and the Docker image do not read `telsiz.env`. For those installations, settings are given as environment variables.

## First run

1. Start the server. If there is no owner account yet, a setup code appears in the console inside a frame made of equals signs. In Docker it is shown by `docker logs telsiz`, and with systemd by `journalctl -u telsiz`.
2. Open the server address in a browser. On the computer that runs the server the address is `http://localhost:3000`, and the console also lists the addresses on the same network.
3. On the setup screen, enter the setup code, your username and your password. A username can contain lowercase English letters, digits, underscores and dots. This account is the owner of the server, that is of this frequency.
4. Telsiz creates an encryption key for the group and shows the invite screen. Copy the invite link. If needed, also write down the key code.
5. Send the invite link to your friends. A person who opens the link registers with their own username and password, and the key is added to their browser automatically.

The setup code is valid only until the owner account is created and changes every time the server starts. The invite link carries the invite code and the group key in the part of the address after the `#` sign. Browsers do not send this part to the server, but anyone who sees the link also learns the key. Copy the invite link while you are on the tunnel or permanent https address, because the link uses the address that is open at that moment.

## Owner and admin settings

The settings of the frequency (the server) are in the "Frequency settings" group of the full screen settings view in the app. Settings open from the avatar menu at the top right.

| Place | Who | Contents |
| --- | --- | --- |
| Settings > General | Owner and admins (some fields owner only) | Frequency name (owner only), frequency photo (owner only, admins see the preview), frequency introduction (owner only, admins see it read only), frequency summary, in the Music bot section the switches for Telsiz DJ, the YouTube source and restricted mode (owner only), in the Voice rooms and cameras section the voice room capacity, cameras and the per-room camera limit (owner only, admins see them read only), and in the Server information section the machine and usage information with a capacity recommendation |
| Settings > Rooms | Owner, admins and roles with the manage rooms permission | Creating, renaming, reordering and deleting text and voice rooms. The last text room cannot be deleted. |
| Settings > Members | Owner, admins and roles with the ban permission | Changing roles and giving a member a custom role (owner only), banning, unbanning and kicking people ranked lower, resetting a password with a temporary password (owner only) |
| Settings > Roles | Owner only | Creating, naming, coloring, turning permissions on and off for, ordering and deleting custom roles |
| Settings > Invite | Owner and admins | Copying the invite link and renewing the invite code. A renewed code invalidates old links. |
| Settings > Privacy and security > Encryption keys | Owner and admins | Creating a new group key |

The frequency introduction is plain text of at most 600 characters and 6 lines. When someone who is not signed in opens the frequency address in a browser, they first see the introduction page: the frequency name, this text, a short description of Telsiz, links to download the desktop app and to set up a frequency, and the Sign in and Join with an invite buttons. This text is public and not encrypted (the `about` field of the `GET /api/info` response), do not write anything secret in it. People who arrive through an invite link, a server that is not set up yet, the desktop app and browsers that signed in before skip the introduction page.

The frequency photo can be a PNG, JPEG or WebP image (the server checks the file signature and does not accept SVG) and has the same size limit as profile pictures (1 MB by default). Before uploading, the app crops the chosen image to a square from its center and scales it down to 256x256. Like the frequency name, the photo is public and not encrypted: it is served without a session at `GET /api/server-icon`, and its hash is in the `serverIcon` field of the `GET /api/info` response. Only the desktop app shows the photos of other frequencies, in the browser the stations of other frequencies keep the first letter. The photo lives in the data folder under `server-icon/` and is part of the backup.

Telsiz DJ and the YouTube source are on by default. If the YouTube source is turned off, only shared audio files play. Since the server cannot see the encrypted DJ state, this restriction is applied on the members' devices. If Telsiz DJ is turned off completely, the server rejects DJ state writes. When restricted mode is on, the server rejects DJ state writes from others while someone with the DJ permission (the owner, an admin or a role with the DJ permission) is in the room, and everyone can write if no such person is in the room.

### Custom roles

Besides the owner and admin roles, the owner can create up to 20 custom roles in Settings > Roles. Each role has a name (at most 24 characters), one of eight colors and a selection of the permissions below. A member can have one custom role, given by the owner in Settings > Members. The owner and admins already have every permission.

| Permission | What it allows |
| --- | --- |
| Delete messages | Deleting other people's messages in text rooms (nobody can delete someone else's direct messages) |
| Ban members | Banning, unbanning and kicking members ranked lower |
| Moderate voice rooms | Muting someone ranked lower for everyone, turning off their camera or removing them from the voice room |
| Manage rooms | Creating, renaming, reordering and deleting text and voice rooms |
| Manage the Telsiz DJ queue | Managing the queue while restricted mode is on and they are in the room, while people without the permission only listen |

The rank order is the owner, admins, custom roles in the order of the Settings > Roles list, and members without a role at the bottom. Banning, kicking and voice room moderation only apply to someone ranked lower than yourself, and the owner can never be kicked. A mute for everyone is stored on the account and stays when the person leaves and joins again or the server restarts. Since audio flows directly between people, the mute is applied by the clients: the muted person's app keeps their microphone off and the other apps do not play that person's audio. Someone using a modified client can bypass this on their own device. The Turn off camera button shows on the person's voice card and profile card only while their camera is on. Turning it off is a one time action: the person's app stops the camera and tells them, and they can turn it on again. A person removed from a voice room can join again, use banning to keep someone out.

Kicking someone from the frequency (Settings > Members > Kick) deletes the account: all of the person's sessions are signed out and their open app says they were kicked from the frequency, the username becomes free, and their messages stay with a deleted author. The person can only come back by registering again with an invite code, as a new account. Use banning to keep someone out. A kicked or banned person still knows the group encryption key. To protect new messages, create a new key in Settings > Privacy and security > Encryption keys.

The three settings in the Voice rooms and cameras section apply to each voice room separately and are stored on the server (`state.json`, the `voice` field). The voice room capacity is 8 by default and can be set between 2 and 12 people. A lower capacity applies to new joins only, nobody in the room is removed. Cameras are on by default, and turning them off also turns off cameras that are on. The number of cameras that can be on at the same time per room is 4 by default, can be set between 1 and 12 and cannot be larger than the capacity. Saved changes reach open apps right away. Since voice and video flow directly between people, these limits protect the members' upload speed rather than the server: in a full mesh everyone with their camera on sends their video separately to every other person in the room.

The owner and admins see the Server information section (`GET /api/server-info`): processor model and core count, load average, total and free memory, the cgroup memory limit when running in a container, free and total space of the disk that holds the data folder, Node.js version, platform, uptime, upload and message usage, people online, in voice and with their camera on, and the TURN status. The recommendation is calculated from the members' typical upload speed (5 Mbps by default, stored only in the owner's browser), and the interface says that it is an estimate. The formulas are in [ARCHITECTURE.md](ARCHITECTURE.md#voice-room-limits-and-server-information). The hints show when free disk space is less than the rest of the upload quota, when the memory the message cap would take is more than half of the usable memory, a high load average and the TURN status. The Apply recommendation button fills the values into the form, saving is up to the owner.

A new group key protects only the messages that follow. The old key must stay in the keyring on the devices, because older messages are read with it. After a new key, everyone needs to receive the new invite link.

## HTTPS

Browsers enable features such as the microphone, screen capture, service workers and installing as an app only in a secure context. A secure context is an address that starts with `https://`, and `http://localhost` and `http://127.0.0.1` also count as secure. Therefore:

1. On the computer that runs the server, everything works at `http://localhost:3000`.
2. When another device on the same network connects with an address such as `http://192.168.1.20:3000`, messaging, file sharing and encryption work, but voice chat, screen sharing and installing as an app do not.
3. Every other use needs an https address: your own domain with a reverse proxy, or a tunnel.

On a home network `http://` connection the content is still end-to-end encrypted, but session information travels unencrypted on the network, and an active attacker on the same network could modify the app code.

## Reverse proxy

For a permanent address, let the server listen only locally with `HOST=127.0.0.1` and put a reverse proxy that terminates TLS in front of it. The two examples in the repository can be used directly:

| File | Description |
| --- | --- |
| [deploy/Caddyfile](../deploy/Caddyfile) | Caddy obtains and renews the certificate by itself. Replace `telsiz.ornek.com` with your own domain. |
| [deploy/nginx.conf](../deploy/nginx.conf) | An nginx server block that redirects HTTP to HTTPS and uses Certbot certificates. |

Whichever proxy you use, keep the following in mind:

1. **Long requests.** When there are no new events, the server holds a request for about 25 seconds (long polling). The read timeout of the proxy must be longer than that. The nginx example uses 75 seconds, and Caddy does not time out these requests.
2. **Upload size.** The request body limit of the proxy must be slightly above `MAKS_YUKLEME_MB`. Both examples use 30 MB for the default of 25 MB.
3. **Client address.** Rate limits are applied per client IP. The server trusts the `X-Forwarded-For` and `CF-Connecting-IP` headers only on connections from addresses in the `GUVENILIR_VEKIL` list. The default `loopback` value is correct for a proxy on the same machine. The proxy must remove or overwrite these headers when a client sends them, and both examples do so.
4. **HSTS.** Both examples add a `Strict-Transport-Security` header. If you plan to use the domain without https later, remove that line.

## Tunnel

For a quick https address without a domain or an open port, a Cloudflare quick tunnel can be used. No account is needed, but the `cloudflared` program must be installed.

1. Start the server.
2. In another window run the `tunel.bat` (Windows) or `tunel.sh` (Linux and macOS) script from the repository. If `cloudflared` is missing, the script explains how to install it. On Windows the suggested command is `winget install --id Cloudflare.cloudflared`.
3. In a few seconds an address like `https://....trycloudflare.com` appears in the output. Open Telsiz at that address and copy the invite link while you are on it.

If you run the npm package or the single file server, the scripts are not next to you. In that case run the command that the server prints in the console:

```sh
cloudflared tunnel --url http://localhost:3000
```

If the server uses a port other than 3000, give the tunnel the same value, for example `PORT=4000 ./tunel.sh`. The address of a quick tunnel changes on every run. When it changes, everyone has to sign in again at the new address, and an installed Telsiz app stays bound to the old address. The tunnel provider terminates the TLS connection on its side. The content stays end-to-end encrypted, but in the web version the app code passes through the tunnel, so the provider also becomes a trusted part of code delivery.

## Voice connectivity: STUN and TURN

Audio, screen video and camera video flow directly between people over WebRTC. For devices to find each other, Google's public STUN server (`stun:stun.l.google.com:19302`) is used by default. This means devices that join voice chat contact that STUN server. With `STUN_URL` you can set your own STUN server, or turn STUN off by setting the variable to an empty string. With STUN off, devices on different networks may not be able to connect.

Some networks block direct connections and need a TURN server. The server prints at startup whether TURN is configured. You can run your own TURN server or use a TURN service:

```sh
TURN_URL=turn:turn.example.com:3478 TURN_USERNAME=user TURN_PASSWORD=secret npx telsiz
```

The TURN credentials are sent to the browser of every signed in person who joins a voice room, because the browser sets up the connection. Use a TURN account reserved for Telsiz. Audio and video relayed through TURN are protected by WebRTC's own encryption (DTLS-SRTP). If the TURN server runs on the same machine as Telsiz, relayed audio and camera video go through this machine's connection, so capacity then also depends on the server's upload speed.

## Backups

All persistent data is in the data folder. The "data folder" line that the console prints at startup shows the full path.

| Path | Contents |
| --- | --- |
| `state.json` | Accounts (password hashes and wrapped personal keys), session hashes, rooms, roles, the invite code, friendships, server settings |
| `state.json.bak` | The previous valid `state.json` |
| `messages/<room>.jsonl` | Encrypted message envelopes for each room and direct message conversation |
| `uploads/<id>.bin` | Encrypted files and profile pictures |
| `server-icon/<hash>.bin` | The frequency photo (not encrypted, public) |
| `.kilit` | The lock of the running process, not needed in a backup |

Message and file contents are encrypted, but account information and metadata are plain text. Store backups as carefully as the data folder itself. The encryption keys are not on the server but on the users' devices. A backup does not reveal messages to someone who does not know the key, but a group that loses its key cannot recover its messages from a backup either.

For a consistent backup, stop the server, copy the whole folder and start the server again. On Linux, for example:

```sh
tar czf telsiz-backup.tgz -C /var/lib/telsiz .
```

For a Docker volume:

```sh
docker stop telsiz
docker run --rm -v telsiz-veri:/data:ro -v "$(pwd)":/backup alpine tar czf /backup/telsiz-backup.tgz -C /data .
docker start telsiz
```

To restore, replace the contents of the folder with the backup while the server is stopped. In a Docker volume the files must be owned by the `node` user of the container:

```sh
docker run --rm -v telsiz-veri:/data -v "$(pwd)":/backup alpine sh -c "tar xzf /backup/telsiz-backup.tgz -C /data && chown -R 1000:1000 /data"
```

## Updating

Back up the data folder and read the release notes ([CHANGELOG.en.md](../CHANGELOG.en.md)) before updating.

| Installation | Update |
| --- | --- |
| npm (`npx`) | `npx telsiz@latest` |
| npm (global install) | `npm install -g telsiz@latest` and restart the server |
| Single file | Stop the server, replace the executable with the new version, leave the `veri` folder and `telsiz.env` untouched |
| Repository | `git pull` and restart the server |
| Docker | `docker pull ghcr.io/yerlifan/telsiz:latest`, remove the old container and start it again with the same volume |
| Docker Compose | `git pull` and `docker compose -f deploy/docker-compose.yml up -d --build` |
| systemd | `cd /opt/telsiz`, `sudo git pull` and `sudo systemctl restart telsiz` |
| Desktop app (installer, AppImage) | The app downloads the new version itself, it is installed with Restart and update |
| Desktop app (portable, .deb) | Download the new file from the release page the app shows and replace or install it |

The SHA-256 value of every file on the release page is in `SHA256SUMS.txt`. You can verify it with `sha256sum -c SHA256SUMS.txt --ignore-missing` on Linux, or with `Get-FileHash telsiz-<version>-server-windows-x64.exe` in Windows PowerShell. Settings > App in the app shows the version of the server.

## Password reset and troubleshooting

**A member's password.** The owner creates a temporary password in Settings > Members. The person's sessions are closed.

**The owner's password.** Stop the server and run the reset command with the same data folder. The command prints a temporary password.

```sh
npx telsiz reset-password <username>
node server.js sifre-sifirla <username>
./telsiz-<version>-server-linux-x64 reset-password <username>
sudo -u telsiz env VERI_KLASORU=/var/lib/telsiz node /opt/telsiz/server.js reset-password <username>
```

A password reset also resets the person's personal security key. The person creates a new key at the next sign in, can no longer read their old direct messages, and the people they talk to see a warning that the key changed.

**Port already in use.** The server may already be running in another window. Close that window or choose another port with `PORT`.

**Data folder in use.** Two processes cannot use the same data folder. If this error appears while the server is not running, delete the `.kilit` file named in the error message and try again.

**Voice does not connect.** Check that the address is https or localhost, that the browser has microphone permission and, if needed, that a TURN server is configured.

**The camera does not turn on.** The camera also works only on https or localhost and needs the browser's camera permission. The server's security header (`Permissions-Policy: camera=(self)`) opens the camera only to Telsiz's own page. If a reverse proxy changes this header, the camera is blocked. If the owner turned cameras off or the room's camera limit is reached, the button says so.
