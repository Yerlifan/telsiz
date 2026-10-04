# Contribution guide

[Türkçe](CONTRIBUTING.md) | [English](CONTRIBUTING.en.md)

Thank you for wanting to contribute to Telsiz. Telsiz is a self-hosted, end-to-end encrypted and open source app for text and voice communication. Bug reports, test results from real devices (including phone, tablet, TV and game console browsers), translation and documentation fixes and code contributions are welcome. The project is maintained in Turkish and English. You can write issues and pull request descriptions in either language, while interface texts and documents are always updated in both languages together.

## Code of conduct

Everyone is expected to be able to contribute in a respectful and constructive environment. Be patient with people of every level of experience and direct your criticism at code and ideas, not at people. Insults, harassment, discrimination and sharing personal information without permission are not accepted. Comments and contributions that do not follow these principles may be edited, closed or blocked by the repository owner.

## Security vulnerabilities

Do not report security vulnerabilities as a public issue, discussion or pull request. Use the private reporting path described in [SECURITY.md](SECURITY.md) instead.

## Bug reports and feature requests

Open bugs and feature requests in the Issues tab of the repository on GitHub, using the bug report and feature request forms. In a bug report, describe the device and browser, the version or commit you use, the installation path (npm, single file, Docker, repository or desktop app), the steps to reproduce the bug, the behavior you expected and the behavior you saw. Before opening one, check whether an issue on the same topic already exists.

Do not add message contents, key codes, invite links, setup codes, passwords, tunnel addresses or files from the data folder to issues. Make sure this information is not visible in screenshots either.

## Development environment

Development needs git and Node.js 20 or newer. CI runs the checks and tests on Ubuntu and Windows with Node.js 20, 22 and 24.

1. Fork the repository to your own account on GitHub.
2. Clone your fork to your computer.
3. Run `npm ci` in the project folder.
4. Confirm that everything passes with `npm run denetle` and `npm test`.

`npm ci` installs only the development tools, at the exact versions in `package-lock.json`: `acorn` for the checker, `playwright` for the end-to-end tests and `postject` for the single file build. This step is not needed to run the server.

When trying the app by hand, start the server with a separate data folder to protect your real data. On Linux and macOS:

```sh
VERI_KLASORU=/tmp/telsiz-deneme node server.js
```

In the Windows command prompt:

```bat
set "VERI_KLASORU=%TEMP%\telsiz-deneme"
node server.js
```

To try several users on the same computer, open `http://localhost:3000` in different browser profiles or private windows. The browser stores the session and the key per address, so tabs in the same profile use the same account. Voice chat and screen sharing work only on https addresses and on `localhost`.

## Tests and checks

| Command | Purpose |
| --- | --- |
| `npm start` | Starts the server (`node server.js`) |
| `npm run denetle` | Checks writing, syntax, security, i18n and document parity rules (`scripts/denetle.js`) |
| `npm run lint` | Same as `npm run denetle` |
| `npm test` | Runs the unit and server tests in the `test/` folder |
| `npm run test:e2e` | Runs the end-to-end tests in the `e2e/` folder with Chromium, one after another |
| `npm run exe` | Builds the single file server for this system into `dist/` (`scripts/sea-derle.js`) |
| `npm run exe:duman` | Smoke tests the built single file server (`scripts/sea-duman.js`) |

The test commands find the test files that run with `node:test` through `scripts/test-calistir.js`. This script removes the differences in folder and file pattern handling between Node.js versions and operating systems.

The end-to-end tests open a real Chromium browser with Playwright. You can download the browser with `npx playwright install chromium`. On Linux the browser may also need system libraries, which CI installs with `npx playwright install --with-deps chromium`. The tests run in Chromium by default. If the `TELSIZ_E2E_BROWSER` environment variable is `firefox` or `webkit`, that browser is used (download it first with `npx playwright install firefox` or `webkit`). The voice room, screen sharing and Telsiz DJ files, which need a fake microphone and screen capture, are skipped in these two browsers, and CI runs all three. If Playwright cannot find its own installation, the `TELSIZ_E2E_CHROMIUM` environment variable gives the path to Chromium, and the other options are described at the top of `e2e/yardimci.js`. Failing tests write screenshots to the `e2e-sonuclar/` folder.

The desktop app has its own dependencies and tests. Run the commands in the `desktop/` folder: `npm ci`, `npm test` for the unit tests and `npm run test:duman` for the smoke test of the packaged or development build (on Linux `xvfb-run -a npm run test:duman`). Details are in [desktop/README.en.md](desktop/README.en.md).

CI also checks the shell scripts with ShellCheck and POSIX syntax checks, builds the Docker image and starts a container, and builds and smoke tests the single file server for Windows, Linux x64 and Linux arm64.

## Project layout

The server is a Node.js application with no runtime dependencies that keeps its data in JSON and JSONL files. Real time communication uses only HTTP long polling. The client is made of plain script files without a build step and is written with at most ES2017 syntax for compatibility with older WebKit based console browsers. The detailed architecture is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| Path | Purpose |
| --- | --- |
| `server.js` | Entry point: environment variables, `telsiz.env`, startup, banner, the `sifre-sifirla` command, shutdown |
| `src/app.js` | `createChatServer(options)`, routing, API endpoints, permissions, rate limits, uploads |
| `src/store.js` | Persistence: `state.json`, JSONL message files per room, uploads, the lock file |
| `src/auth.js` | Password hashing, name validation, sessions, rate limiter, trusted proxies |
| `src/hub.js` | Presence, the event ring, long poll waiters, voice rosters and signal queues, typing status |
| `src/social.js` | Friendships, blocks and direct message rules |
| `src/music.js` | The encrypted in-memory room states of Telsiz DJ |
| `src/http-util.js`, `src/static-source.js` | Security headers, CSP, body reading, the static file allowlist |
| `src/i18n.js`, `src/runtime.js`, `src/env-file.js` | Server texts, version and single file information, the `telsiz.env` reader |
| `public/index.html` | Single page markup and the SVG icon sprite |
| `public/crypto.js` | `window.E2EE`: key code, envelopes, file encryption, personal keys, pinning |
| `public/voice.js` | `window.VoiceClient`: the WebRTC voice and screen sharing engine |
| `public/music.js`, `public/dj/youtube.js` | The Telsiz DJ engine and the YouTube player adapter |
| `public/i18n.js` | The Turkish and English dictionaries of the client |
| `public/theme-init.js`, `public/css/` | Theme preloader, tokens, layout, components and themes ([docs/DESIGN.md](docs/DESIGN.md)) |
| `public/sw.js` | Service worker, the cache of the app shell |
| `public/vendor/` | TweetNaCl-js 1.0.3 and scrypt-js 3.0.1, never modified |
| `desktop/` | Electron desktop app |
| `deploy/` | Docker Compose, Caddy, nginx and systemd examples |
| `scripts/` | Checker, test runner, single file build, release notes |
| `test/`, `e2e/` | Unit and server tests, end-to-end tests |

The client modules are numbered files under `public/js/` and are loaded in this order in `index.html`. They all share the same global scope, and a later module can use the functions of earlier ones.

| Module | Purpose |
| --- | --- |
| `01-core.js` | Constants, storage keys, `t()`, server requests, formatting helpers |
| `02-state-dom.js` | App state, element cache, DOM helpers, the layer stack, notifications |
| `03-auth.js` | Startup, setup, invite, sign in, registration and key screens |
| `04-meta.js` | Top bar, drawing the frequency band, the Stations list and sheet, room info, the On air list, room selection |
| `05-poll.js` | The long poll loop, event handling, notifications |
| `06-messages.js` | Message decryption, message nodes, paging, editing and deleting |
| `07-attachments.js` | Inline images, file cards, the image viewer |
| `08-composer.js` | Message box, sending, preparing attachments, the upload queue |
| `09-emoji.js` | Emoji picker |
| `10-voice.js` | Voice interface and the radio card |
| `11-settings.js` | Full screen settings view |
| `12-init.js` | Sheets, window size, PWA, event binding and startup |
| `13-profile.js` | Profiles, the profile card, the status menu |
| `14-social.js` | Friends, blocking, the view mode |
| `15-dm.js` | Direct messages and the safety number |
| `16-identity.js` | Key derivation from the password and the personal identity key |
| `17-search.js` | Search on the device |
| `18-mentions.js` | @ mentions and the suggestion list |
| `19-typing.js` | Typing indicator |
| `20-desktop.js` | Desktop app integration |
| `21-band.js` | Frequency band interaction (switching between frequencies: click, needle, keyboard, wheel, gamepad) |
| `22-cast.js` | Screen sharing interface |
| `23-dj.js` | Telsiz DJ interface |
| `24-frekans.js` | Frequencies: the frequency stations of the band (status, unread and mention counts), the Frequencies sheet, the frequency menu, add and remove, carrying the list and its order in the address fragment in the browser, main process calls and background status on the desktop |
| `25-arka-plan.js` | The client mode in the background windows of the desktop app: long-poll without an interface, counting unread messages and mentions, reporting to the main process |

If a new client module is added, it is also added to the script list in `index.html` and to the shell list in `public/sw.js`.

## Code rules

Most of the following rules are checked automatically by `npm run denetle` and are required in CI. The checker scans the files tracked in git and new files not excluded by `.gitignore`, and skips `node_modules`, `public/vendor/` and build output.

1. No text file contains the em dash (U+2014) or the en dash (U+2013). Use a normal hyphen (-), a comma or a colon where needed.
2. Invisible characters and characters that change text direction (zero width characters, the no-break space, direction marks, a BOM inside a file) are not used. If code needs one, write it with a `\u` escape.
3. All JavaScript files, including the server, scripts, tests and the desktop app, are written without semicolons (StandardJS style). Lines do not start with an opening parenthesis, an opening bracket or a backtick, because without semicolons such a line can join the previous one. Indentation is two spaces and strings use single quotes.
4. Client code under `public/` is a plain script without modules and must parse with ES2017 syntax. Optional chaining, the nullish coalescing operator, class fields, `import` and `\p{...}` regular expression escapes are not used.
5. In the client, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, the `Function` constructor, `structuredClone`, `.replaceAll`, `Object.hasOwn` and `.at()` are forbidden. The page is written only with `createElement` and `textContent`. Network requests use `XMLHttpRequest`, and `fetch` is allowed only in `public/sw.js`.
6. HTML files contain no `style` attribute, no `on...` event attributes, no `<style>` element and no `<script>` with a body, because the Content Security Policy blocks them.
7. Files under `public/vendor/` are never modified. The checker verifies the sha256 values of `nacl-fast.min.js` and `scrypt.js`.
8. `.bat` files are saved without a BOM and with CRLF line endings, and none of their lines contains a semicolon. `.sh` files are saved without a BOM and with LF line endings only, and are stored in git with the executable mode (100755).
9. JSON files must be valid JSON.
10. Markdown documents use no semicolons in prose. Code examples go into code blocks or inline code.
11. Real time communication uses only long polling. WebSocket or Server-Sent Events are not added.
12. No runtime dependency is added, and `package.json` has no `dependencies` field. If a new development dependency is needed, discuss it in an issue first. Versions are pinned exactly, without range operators.
13. Comments are written in Turkish and kept sparse. Identifiers, JSON fields and API paths are in English. Turkish characters (ç, ğ, ı, İ, ö, ş, ü) are used directly.
14. Stylesheets are written to work in older WebKit based browsers too: layout uses flexbox and margins, and `grid`, flex `gap`, `clamp()`, `:is()`, `:where()`, `aspect-ratio` and `inset` are not used. Details are in [docs/DESIGN.md](docs/DESIGN.md).
15. Tests must also pass on Windows. Paths are joined with `path.join`, temporary folders are created under `os.tmpdir()`, nothing is assumed about line endings and tests do not rely on process signals such as SIGINT.

## Bilingual rules

Every text a user sees exists in the Turkish and English dictionaries together. The client dictionaries are in `public/i18n.js` and the server dictionaries in `src/i18n.js`. The checker enforces the following:

1. The key sets of the two languages are exactly the same and no value is empty.
2. The `{name}` style parameters of a key are the same in both languages.
3. Plural texts are defined with two keys ending in `_one` and `_other`.
4. Keys in `t('...')` calls and in `data-i18n` attributes exist in the dictionary.
5. Client code and code under `src/` contain no literal text with Turkish specific letters. Such texts are added to the dictionary and used through `t()`.

Documents are kept in both languages too. Every Turkish document in the `DOC_PAIRS` list in `scripts/denetle.js` must have its English pair, and both documents must have the same number of `## ` headings. For example `README.md` and `README.en.md`, or `docs/MIMARI.md` and `docs/ARCHITECTURE.md`. A pull request that changes a document updates its pair with the same content.

## Security sensitive areas

Changes that touch the following areas need extra review. In these pull requests, explain the security impact of the change, back the change with tests and expect the review to take longer.

| Area | Why it is sensitive |
| --- | --- |
| `public/crypto.js`, `public/js/16-identity.js` | Key code, key derivation, envelope formats, personal keys and pinning. If a format changes, stored history may become unreadable. |
| `public/voice.js` | Encryption of voice and screen sharing signals, verification of sender and recipient, replay protection |
| `public/music.js`, `public/dj/youtube.js` | Validation of the encrypted DJ state, isolation of the YouTube frame and the consent rule |
| `src/auth.js`, `src/app.js` | Password hashing, sessions, permissions, rate limits, trusted proxies |
| Uploads (`src/app.js`, `src/store.js`, `public/js/07-attachments.js`, `public/js/08-composer.js`) | Size and quota limits, download permissions, file name cleanup, removal of photo metadata |
| `src/http-util.js`, `src/static-source.js` | Security headers, Content Security Policy, the static file allowlist |
| `public/sw.js` | Cached content, and making sure `/api/` requests are never cached |
| `desktop/src/` | Integrity verification, the proxy, permissions, IPC and navigation rules, update checks (`desktop/src/lib/updates.js`) |
| `.github/workflows/release.yml`, `desktop/electron-builder.json` | The whitelist of files that go into a release, the auto update info files, the authentication of the npm publish |

Discuss a proposal that changes the encryption protocol (key code, key derivation, envelope or plaintext format) in an issue before writing code.

## Branches and pull requests

1. Create a new branch from `main` in your fork.
2. Keep the change small and focused on one topic.
3. Add or update tests if behavior changed.
4. Run `npm run denetle`.
5. Run `npm test`.
6. For changes that affect the interface, also run `npm run test:e2e`.
7. For changes that affect the desktop app, run `npm test` in the `desktop/` folder.
8. Open the pull request against the `main` branch of this repository and fill in the sections of the pull request template.
9. Check that the CI checks pass and respond to review comments.

Send unrelated changes as separate pull requests. For a change in user visible behavior, also update the README files, for an architectural change `docs/MIMARI.md` and `docs/ARCHITECTURE.md`, and for notable changes that go into a release both CHANGELOG files. Before starting a large change, opening an issue to discuss the approach is recommended so your effort is not wasted.

## Releases

The repository owner publishes releases: `package.json`, `desktop/package.json` and both CHANGELOG files are updated, and a tag starting with `v` (for example `v2.1.0`) is pushed for the commit on `main`. `.github/workflows/release.yml` does the rest:

- After the checks and tests, the server binaries and the desktop packages are built. Only whitelisted files are added to the GitHub Release: the server binaries, the desktop packages, the auto update info (`latest.yml`, `latest-linux.yml`, `Telsiz-Kurulum-<version>.exe.blockmap`) and a `SHA256SUMS.txt` for all of them. `desktop/scripts/guncelleme-dosyalari.js` checks that the packages named in the info files are in the release with the same names and matching sha512 values.
- The Docker image is published as `ghcr.io/yerlifan/telsiz`.
- The npm package `telsiz` is published without a token through npm trusted publishing (OIDC) and with provenance. A trusted publisher is configured in the package settings on npmjs.com: GitHub Actions, `Yerlifan/telsiz`, workflow file `release.yml`, no environment. According to the npm docs this requires npm CLI 11.5.1 or later and Node.js 22.14.0 or later, the job installs a pinned npm 11 version and checks both. If the `NPM_TOKEN` secret is defined it is only a fallback: npm tries OIDC first. After the first successful OIDC publish, `NPM_TOKEN` can be deleted and token publishing can be turned off for the package on npmjs.com ("Require two-factor authentication and disallow tokens"). If the workflow file is renamed, the trusted publisher setting must be changed too.

Since desktop updates are unsigned, their integrity rests on the security of the GitHub account and repository. The repository owner and everyone with write access should have two factor authentication (2FA) turned on. Update checks work while the repository is public.

## License

Your contributions are distributed under the MIT license of the project, see the [LICENSE](LICENSE) file for details. TweetNaCl-js (Unlicense) and scrypt-js (MIT) under `public/vendor/` and the fonts under `public/fonts/` (SIL Open Font License) are distributed under their own licenses.
