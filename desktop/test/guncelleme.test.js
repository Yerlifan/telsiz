'use strict'

// Otomatik güncelleme (src/lib/updates.js): sürüm karşılaştırma, GitHub sürüm yanıtının
// doğrulanması, çalışma biçiminin (kurucu, taşınabilir, AppImage, .deb) algılanması, durum makinesi
// ve IPC girdileri, ayarın varsayılanı. Ayrıca yayın iş akışının güncelleme dosyalarını taşıdığı ve
// scripts/guncelleme-dosyalari.js denetimi.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const EventEmitter = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const updates = require('../src/lib/updates')
const settingsStore = require('../src/lib/settings-store')
const guncellemeDosyalari = require('../scripts/guncelleme-dosyalari')

const DESKTOP_DIR = path.join(__dirname, '..')
const ROOT_DIR = path.join(DESKTOP_DIR, '..')

function tempDir (name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-guncelleme-' + name + '-'))
}

function release (extra) {
  return Object.assign({ tag_name: 'v2.1.0', html_url: 'https://github.com/Yerlifan/telsiz/releases/tag/v2.1.0', draft: false, prerelease: false, name: 'Telsiz 2.1.0' }, extra || {})
}

function jsonResponse (status, body, headers) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (headers || {})[name.toLowerCase()] || null },
    text: () => Promise.resolve(text)
  }
}

// Zamanlayıcıları kaydeden sahte saat
function fakeTimers () {
  const list = []
  return {
    list,
    setTimeout: (fn, ms) => {
      const timer = { type: 'timeout', fn, ms, cleared: false }
      list.push(timer)
      return timer
    },
    clearTimeout: (timer) => {
      if (timer) timer.cleared = true
    },
    setInterval: (fn, ms) => {
      const timer = { type: 'interval', fn, ms, cleared: false }
      list.push(timer)
      return timer
    },
    clearInterval: (timer) => {
      if (timer) timer.cleared = true
    },
    active: () => list.filter((timer) => !timer.cleared)
  }
}

function controller (overrides) {
  const settings = { autoUpdate: true }
  const calls = { fetch: [], load: 0, changes: [], saved: [], beforeInstall: 0 }
  const timers = fakeTimers()
  const opts = Object.assign({
    mode: { mode: 'notify', kind: 'portable' },
    current: '2.0.1',
    getEnabled: () => settings.autoUpdate,
    saveEnabled: (value) => {
      settings.autoUpdate = value
      calls.saved.push(value)
    },
    fetch: (url, init) => {
      calls.fetch.push({ url, init })
      return Promise.resolve(jsonResponse(200, release()))
    },
    loadUpdater: () => {
      calls.load++
      throw new Error('electron-updater bu testte yüklenmemeli')
    },
    onChange: (snapshot, statusChanged) => calls.changes.push({ status: snapshot.status, statusChanged }),
    beforeInstall: () => {
      calls.beforeInstall++
    },
    now: () => 1700000000000,
    timers
  }, overrides || {})
  return { settings, calls, timers, c: updates.createController(opts) }
}

test('sürüm karşılaştırma anlamsal sürüm kurallarına uyar', () => {
  assert.deepEqual(updates.parseVersion('v2.0.1'), { major: 2, minor: 0, patch: 1, pre: [], text: '2.0.1' })
  assert.deepEqual(updates.parseVersion('2.1.0-beta.1').pre, ['beta', '1'])
  for (const bad of ['', '2', '2.0', '2.0.1.4', '02.0.1', '2.0.1+build', '2.0.1-01', 'x2.0.1', ' 2.0.1', null, 7, '2.0.1-', '1234567.0.0']) {
    assert.equal(updates.parseVersion(bad), null, String(bad))
  }
  const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0', '2.0.10', '10.0.0']
  for (const i of ordered.keys()) {
    for (const j of ordered.keys()) {
      assert.equal(updates.compareVersions(ordered[i], ordered[j]), Math.sign(i - j), ordered[i] + ' ? ' + ordered[j])
    }
  }
  assert.equal(updates.compareVersions('v2.0.1', '2.0.1'), 0)
  assert.equal(updates.compareVersions('2.0.1', 'bozuk'), null)
  assert.equal(updates.isNewer('2.0.2', '2.0.1'), true)
  assert.equal(updates.isNewer('2.0.1', '2.0.1'), false)
  assert.equal(updates.isNewer('2.0.0', '2.0.1'), false)
  assert.equal(updates.isNewer('2.1.0', '2.1.0-beta.1'), true)
  assert.equal(updates.isNewer('bozuk', '2.0.1'), false)
})

test('yalnızca projenin sürüm sayfaları açılabilir', () => {
  for (const good of ['https://github.com/Yerlifan/telsiz/releases/tag/v2.1.0', 'https://github.com/Yerlifan/telsiz/releases/latest']) {
    assert.equal(updates.isReleasePageUrl(good), true, good)
  }
  for (const bad of [
    'http://github.com/Yerlifan/telsiz/releases/tag/v2.1.0',
    'https://github.com/Yerlifan/telsiz/releases/download/v2.1.0/Telsiz-Kurulum-2.1.0.exe',
    'https://github.com/Yerlifan/telsiz/releases/tag/v2.1.0?x=1',
    'https://github.com/Yerlifan/telsiz/releases/tag/v2.1.0#a',
    'https://github.com/Yerlifan/telsiz/releases/tag/../../../kotu/repo',
    'https://github.com/Yerlifan/telsiz/releases/',
    'https://github.com/Baskasi/telsiz/releases/tag/v2.1.0',
    'https://github.com.kotu.com/Yerlifan/telsiz/releases/tag/v2.1.0',
    'https://user@github.com/Yerlifan/telsiz/releases/tag/v2.1.0',
    'https://github.com/Yerlifan/telsiz/releases/tag/' + 'a'.repeat(300),
    'javascript:alert(1)',
    null,
    {}
  ]) {
    assert.equal(updates.isReleasePageUrl(bad), false, String(bad))
  }
  assert.equal(updates.releasePageFor('2.1.0'), 'https://github.com/Yerlifan/telsiz/releases/tag/v2.1.0')
})

test('çalışma biçimi: kurucu ve AppImage otomatik, taşınabilir ve .deb bildirim', () => {
  assert.deepEqual(updates.detectMode({ platform: 'win32', env: {}, isPackaged: true }), { mode: 'auto', kind: 'nsis' })
  assert.deepEqual(updates.detectMode({ platform: 'win32', env: { PORTABLE_EXECUTABLE_DIR: 'C:\\Araclar' }, isPackaged: true }), { mode: 'notify', kind: 'portable' })
  assert.deepEqual(updates.detectMode({ platform: 'win32', env: { PORTABLE_EXECUTABLE_DIR: '' }, isPackaged: true }), { mode: 'auto', kind: 'nsis' })
  assert.deepEqual(updates.detectMode({ platform: 'linux', env: { APPIMAGE: '/home/a/Telsiz.AppImage' }, isPackaged: true }), { mode: 'auto', kind: 'appimage' })
  assert.deepEqual(updates.detectMode({ platform: 'linux', env: {}, isPackaged: true }), { mode: 'notify', kind: 'deb' })
  assert.deepEqual(updates.detectMode({ platform: 'darwin', env: {}, isPackaged: true }), { mode: 'notify', kind: 'other' })
  assert.deepEqual(updates.detectMode({ platform: 'win32', env: {}, isPackaged: false }), { mode: 'notify', kind: 'dev' })
  assert.deepEqual(updates.detectMode({ platform: 'linux', env: { APPIMAGE: '/x' } }), { mode: 'notify', kind: 'dev' })
  assert.deepEqual(updates.detectMode(), { mode: 'notify', kind: 'dev' })
})

test('GitHub sürüm yanıtı doğrulanır: taslak, ön sürüm ve bozuk alanlar reddedilir', () => {
  assert.deepEqual(updates.parseRelease(release(), '2.0.1'), { ok: true, version: '2.1.0', url: 'https://github.com/Yerlifan/telsiz/releases/tag/v2.1.0', newer: true })
  assert.equal(updates.parseRelease(release(), '2.1.0').newer, false)
  assert.equal(updates.parseRelease(release(), '3.0.0').newer, false)
  // html_url geçersizse doğrulanmış sürümden kurulan adres kullanılır
  assert.equal(updates.parseRelease(release({ html_url: 'https://kotu.example/x' }), '2.0.1').url, 'https://github.com/Yerlifan/telsiz/releases/tag/v2.1.0')
  assert.equal(updates.parseRelease(release({ html_url: undefined }), '2.0.1').url, 'https://github.com/Yerlifan/telsiz/releases/tag/v2.1.0')
  for (const bad of [
    release({ draft: true }),
    release({ prerelease: true }),
    release({ draft: undefined }),
    release({ prerelease: 'false' }),
    release({ tag_name: 'v2.2.0-beta.1' }),
    release({ tag_name: 'en-yeni' }),
    release({ tag_name: 5 }),
    [release()],
    null,
    'v2.1.0'
  ]) {
    assert.deepEqual(updates.parseRelease(bad, '2.0.1'), { ok: false, code: 'invalid' })
  }
})

test('hafif denetim: istek biçimi, yanıt kodları, boyut sınırı ve zaman aşımı', async () => {
  const seen = []
  const ok = await updates.checkLatestRelease((url, init) => {
    seen.push({ url, init })
    return Promise.resolve(jsonResponse(200, release({ tag_name: 'v2.0.2', html_url: 'https://github.com/Yerlifan/telsiz/releases/tag/v2.0.2' })))
  }, '2.0.1')
  assert.deepEqual(ok, { ok: true, version: '2.0.2', url: 'https://github.com/Yerlifan/telsiz/releases/tag/v2.0.2', newer: true })
  assert.equal(seen[0].url, 'https://api.github.com/repos/Yerlifan/telsiz/releases/latest')
  assert.equal(seen[0].init.credentials, 'omit')
  assert.equal(seen[0].init.redirect, 'error')
  assert.equal(seen[0].init.cache, 'no-store')
  assert.equal(seen[0].init.headers['User-Agent'], 'Telsiz/2.0.1')
  assert.ok(seen[0].init.signal)

  const code = async (fetchFn) => (await updates.checkLatestRelease(fetchFn, '2.0.1', { timeoutMs: 50 })).code
  assert.equal(await code(() => Promise.resolve(jsonResponse(404, {}))), 'not_found')
  assert.equal(await code(() => Promise.resolve(jsonResponse(403, {}))), 'rate_limited')
  assert.equal(await code(() => Promise.resolve(jsonResponse(429, {}))), 'rate_limited')
  assert.equal(await code(() => Promise.resolve(jsonResponse(500, {}))), 'http')
  assert.equal(await code(() => Promise.resolve(jsonResponse(200, '{bozuk'))), 'invalid')
  assert.equal(await code(() => Promise.resolve(jsonResponse(200, release(), { 'content-length': String(2 * 1024 * 1024) }))), 'invalid')
  assert.equal(await code(() => Promise.resolve(jsonResponse(200, 'x'.repeat(updates.MAX_RESPONSE_BYTES + 1)))), 'invalid')
  assert.equal(await code(() => Promise.resolve(jsonResponse(200, release({ draft: true })))), 'invalid')
  assert.equal(await code(() => Promise.reject(new Error('net::ERR_NAME_NOT_RESOLVED'))), 'network')
  // Yanıt gelmezse istek iptal edilir
  assert.equal(await code((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      reject(err)
    })
  })), 'timeout')
})

test('ayar varsayılanı açıktır, kapatılınca kaydedilir, bozuk değer varsayılana döner', () => {
  assert.equal(settingsStore.defaults().autoUpdate, true)
  assert.equal(settingsStore.sanitize({}).autoUpdate, true)
  assert.equal(settingsStore.sanitize({ autoUpdate: false }).autoUpdate, false)
  assert.equal(settingsStore.sanitize({ autoUpdate: 'false' }).autoUpdate, true)
  assert.equal(settingsStore.sanitize({ autoUpdate: 0 }).autoUpdate, true)
  const root = tempDir('ayar')
  try {
    const file = path.join(root, settingsStore.FILE_NAME)
    // Eski biçimdeki dosyada alan yoktur: açık kabul edilir
    fs.writeFileSync(file, JSON.stringify({ version: 2, server: null, frequencies: [], closeToTray: false }))
    assert.equal(settingsStore.load(file).autoUpdate, true)
    const saved = settingsStore.save(file, Object.assign(settingsStore.load(file), { autoUpdate: false }))
    assert.equal(saved.autoUpdate, false)
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).autoUpdate, false)
    assert.equal(settingsStore.load(file).autoUpdate, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('ayar kapalıyken hiçbir istek yapılmaz, zamanlayıcı kurulmaz, electron-updater yüklenmez', async () => {
  for (const mode of [{ mode: 'notify', kind: 'deb' }, { mode: 'auto', kind: 'nsis' }]) {
    const t = controller({ mode })
    t.settings.autoUpdate = false
    t.c.start()
    assert.deepEqual(t.timers.active(), [])
    assert.deepEqual(await t.c.checkNow(), { ok: false, code: 'disabled' })
    assert.equal(t.calls.fetch.length, 0)
    assert.equal(t.calls.load, 0)
    assert.equal(t.c.snapshot().enabled, false)
    assert.equal(t.c.snapshot().status, 'idle')
  }
})

test('zamanlama: açılıştan kısa süre sonra ve 6 saatte bir, kapatınca durur, gözetimsizde hiç', async () => {
  const t = controller()
  t.c.start()
  const active = t.timers.active()
  assert.deepEqual(active.map((x) => [x.type, x.ms]), [['timeout', updates.STARTUP_DELAY_MS], ['interval', 6 * 60 * 60 * 1000]])
  assert.ok(updates.STARTUP_DELAY_MS >= 5000 && updates.STARTUP_DELAY_MS <= 120000)
  active[0].fn()
  active[0].cleared = true
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(t.calls.fetch.length, 1)
  assert.deepEqual(t.c.setEnabled(false), { ok: true, state: t.c.snapshot() })
  assert.deepEqual(t.calls.saved, [false])
  assert.deepEqual(t.timers.active(), [])
  t.c.setEnabled(true)
  assert.equal(t.timers.active().length, 2)
  t.c.stop()
  assert.deepEqual(t.timers.active(), [])

  const unattended = controller({ schedule: false })
  unattended.c.start()
  assert.deepEqual(unattended.timers.active(), [])
})

test('bildirim kipi: yeni sürüm bulunur, sürüm sayfası doğrulanır, kurulum yapılmaz', async () => {
  const t = controller()
  const result = await t.c.checkNow()
  assert.equal(result.ok, true)
  assert.deepEqual(result.state, {
    enabled: true,
    mode: 'notify',
    kind: 'portable',
    current: '2.0.1',
    status: 'available',
    version: '2.1.0',
    url: 'https://github.com/Yerlifan/telsiz/releases/tag/v2.1.0',
    percent: null,
    lastCheckAt: 1700000000000,
    error: null,
    canInstall: false
  })
  assert.deepEqual(t.calls.changes.map((x) => x.status), ['checking', 'available'])
  assert.equal(t.c.releaseUrl(), 'https://github.com/Yerlifan/telsiz/releases/tag/v2.1.0')
  assert.deepEqual(t.c.install(), { ok: false, code: 'not_ready' })
  assert.equal(t.calls.load, 0)

  const same = controller({ current: '2.1.0' })
  assert.equal((await same.c.checkNow()).state.status, 'up-to-date')
  assert.equal(same.c.releaseUrl(), null)

  const failing = controller({ fetch: () => Promise.resolve(jsonResponse(403, {})) })
  const failed = await failing.c.checkNow()
  assert.deepEqual([failed.ok, failed.code, failed.state.status, failed.state.error], [false, 'rate_limited', 'error', 'rate_limited'])

  // Aynı anda iki denetim tek istek yapar
  const twice = controller()
  await Promise.all([twice.c.checkNow(), twice.c.checkNow()])
  assert.equal(twice.calls.fetch.length, 1)
})

test('IPC girdileri doğrulanır', async () => {
  const t = controller()
  for (const bad of [undefined, null, 'true', 1, {}, []]) {
    assert.deepEqual(t.c.setEnabled(bad), { ok: false, code: 'invalid' })
  }
  assert.deepEqual(t.calls.saved, [])
  assert.equal(t.c.setEnabled(false).state.enabled, false)
  assert.equal(t.c.setEnabled(true).state.enabled, true)
  assert.deepEqual(t.calls.saved, [false, true])
  assert.equal(t.c.releaseUrl(), null)
  assert.deepEqual(t.c.install(), { ok: false, code: 'not_ready' })
})

function fakeUpdater () {
  const u = new EventEmitter()
  u.calls = { check: 0, quit: [], cancel: 0 }
  u.script = null
  u.checkForUpdates = () => {
    u.calls.check++
    if (u.script) u.script()
    return Promise.resolve({ updateInfo: { version: '2.1.0' }, cancellationToken: { cancel: () => { u.calls.cancel++ } } })
  }
  u.quitAndInstall = (silent, runAfter) => u.calls.quit.push([silent, runAfter])
  return u
}

test('otomatik kip: arka planda indirir, yalnızca kullanıcı isteyince kurar', async () => {
  const u = fakeUpdater()
  let loads = 0
  const t = controller({
    mode: { mode: 'auto', kind: 'nsis' },
    loadUpdater: () => {
      loads++
      return u
    }
  })
  u.script = () => {
    u.emit('checking-for-update')
    u.emit('update-available', { version: '2.1.0' })
  }
  const result = await t.c.checkNow()
  assert.equal(loads, 1)
  assert.equal(u.autoDownload, true)
  assert.equal(u.autoInstallOnAppQuit, false)
  assert.equal(u.allowPrerelease, false)
  assert.equal(u.allowDowngrade, false)
  assert.equal(result.state.status, 'downloading')
  assert.equal(result.state.percent, 0)
  assert.deepEqual(t.c.install(), { ok: false, code: 'not_ready' })
  u.emit('download-progress', { percent: 42.7 })
  assert.equal(t.c.snapshot().percent, 42)
  u.emit('download-progress', { percent: 'kotu' })
  assert.equal(t.c.snapshot().percent, 42)
  // İndirme sürerken yeni denetim yapılmaz
  await t.c.checkNow()
  assert.equal(u.calls.check, 1)
  u.emit('update-downloaded', { version: '2.1.0' })
  const snap = t.c.snapshot()
  assert.deepEqual([snap.status, snap.version, snap.canInstall, snap.percent], ['downloaded', '2.1.0', true, 100])
  assert.equal(t.c.releaseUrl(), 'https://github.com/Yerlifan/telsiz/releases/tag/v2.1.0')
  // Hiçbir şey kendiliğinden kurulmaz
  assert.deepEqual(u.calls.quit, [])
  assert.deepEqual(t.c.install(), { ok: true })
  assert.equal(t.calls.beforeInstall, 1)
  assert.deepEqual(u.calls.quit, [[true, true]])
  // Sonraki hata indirilmiş güncellemeyi bozmaz
  u.emit('error', new Error('x'))
  assert.equal(t.c.snapshot().status, 'downloaded')
})

test('otomatik kip: güncel sürüm, hata ve kapatınca indirmenin iptali', async () => {
  const u = fakeUpdater()
  const t = controller({ mode: { mode: 'auto', kind: 'appimage' }, loadUpdater: () => u })
  u.script = () => u.emit('update-not-available', { version: '2.0.1' })
  assert.equal((await t.c.checkNow()).state.status, 'up-to-date')
  u.script = () => u.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
  const failed = await t.c.checkNow()
  assert.deepEqual([failed.state.status, failed.state.error], ['error', 'network'])
  u.script = () => u.emit('update-available', { version: '2.1.0' })
  await t.c.checkNow()
  assert.equal(t.c.snapshot().status, 'downloading')
  t.c.setEnabled(false)
  assert.equal(u.calls.cancel, 1)
  assert.deepEqual([t.c.snapshot().status, t.c.snapshot().version], ['idle', null])

  // electron-updater etkin değilse (null sonuç) hata durumu
  const inactive = fakeUpdater()
  inactive.checkForUpdates = () => Promise.resolve(null)
  const t2 = controller({ mode: { mode: 'auto', kind: 'nsis' }, loadUpdater: () => inactive })
  assert.equal((await t2.c.checkNow()).state.status, 'error')
  // checkForUpdates reddederse
  const rejecting = fakeUpdater()
  rejecting.checkForUpdates = () => Promise.reject(new Error('HttpError: 404'))
  const t3 = controller({ mode: { mode: 'auto', kind: 'nsis' }, loadUpdater: () => rejecting, log: () => {} })
  assert.deepEqual([(await t3.c.checkNow()).state.error], ['not_found'])
})

test('electron-builder yayın ayarı güncelleyicinin GitHub deposuyla aynıdır', () => {
  const config = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'electron-builder.json'), 'utf8'))
  assert.deepEqual(config.publish, { provider: 'github', owner: updates.OWNER, repo: updates.REPO, releaseType: 'release' })
  assert.equal(updates.RELEASES_API, 'https://api.github.com/repos/' + config.publish.owner + '/' + config.publish.repo + '/releases/latest')
})

test('yayın iş akışı güncelleme dosyalarını taşır, beyaz liste dar kalır', () => {
  const release = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', 'release.yml'), 'utf8').replace(/\r\n/g, '\n')
  const desktop = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', 'desktop.yml'), 'utf8').replace(/\r\n/g, '\n')
  // Masaüstü artifact'lerinden yalnızca paketler, iki bilgi dosyası ve kurucunun .blockmap dosyası alınır
  assert.ok(release.includes('*.exe | *.AppImage | *.deb) add "${file}" ;;'))
  assert.ok(release.includes('latest.yml | latest-linux.yml | "Telsiz-Kurulum-${VERSION}.exe.blockmap") add "${file}" ;;'))
  assert.ok(release.includes('updater_files=("latest.yml" "latest-linux.yml" "Telsiz-Kurulum-${VERSION}.exe.blockmap")'))
  assert.ok(release.includes('node desktop/scripts/guncelleme-dosyalari.js dagitim --version "${VERSION}" --require latest.yml,latest-linux.yml'))
  assert.doesNotMatch(release, /\*\.yml\)|\*\.blockmap\)|builder-debug/)
  assert.ok(release.includes('sha256sum -- > "${RUNNER_TEMP}/SHA256SUMS.txt"'))
  // Masaüstü iş akışı dosyaları üretir, denetler ve yükler, kendisi hiçbir şey yayımlamaz
  for (const needle of ['desktop/dist/latest-linux.yml', 'desktop/dist/latest.yml', 'desktop/dist/Telsiz-Kurulum-*.exe.blockmap', '--require latest-linux.yml', '--require latest.yml']) {
    assert.ok(desktop.includes(needle), needle)
  }
  assert.doesNotMatch(desktop, /--publish (always|onTag)|GH_TOKEN/)
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'package.json'), 'utf8'))
  assert.ok(desktop.includes('npm run derle:linux') && desktop.includes('npm run derle:win'))
  assert.match(pkg.scripts['derle:linux'], /--publish never$/)
  assert.match(pkg.scripts['derle:win'], /--publish never$/)
})

test('npm yayını trusted publishing (OIDC) ile yapılır, NPM_TOKEN yalnızca yedektir', () => {
  const release = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', 'release.yml'), 'utf8').replace(/\r\n/g, '\n')
  const job = release.slice(release.indexOf('\n  npm:\n'))
  assert.match(job, /id-token: write/)
  assert.match(job, /NPM_CLI_VERSION: 11\.\d+\.\d+/)
  const [, minor, patch] = /NPM_CLI_VERSION: 11\.(\d+)\.(\d+)/.exec(job)
  // npm belgelerine göre trusted publishing npm CLI 11.5.1 veya sonrasını gerektirir
  assert.ok(Number(minor) > 5 || (Number(minor) === 5 && Number(patch) >= 1))
  assert.match(job, /npm install --global "npm@\$\{NPM_CLI_VERSION\}"/)
  assert.match(job, /npm publish --provenance --access public/)
  assert.match(job, /npm view "telsiz@\$\{VERSION\}" version/)
  assert.doesNotMatch(job, /HAS_NPM_TOKEN|if: env\./)
  assert.match(job, /package-manager-cache: false/)
})

function writeInfo (dir, name, lines) {
  fs.writeFileSync(path.join(dir, name), lines.join('\n') + '\n')
}

function sha (data) {
  return crypto.createHash('sha512').update(data).digest('base64')
}

test('güncelleme bilgi dosyalarının denetimi (scripts/guncelleme-dosyalari.js)', () => {
  const dir = tempDir('dosyalar')
  try {
    const exe = Buffer.from('kurucu')
    const appimage = Buffer.from('appimage')
    fs.writeFileSync(path.join(dir, 'Telsiz-Kurulum-2.1.0.exe'), exe)
    fs.writeFileSync(path.join(dir, 'Telsiz-Kurulum-2.1.0.exe.blockmap'), 'b')
    fs.writeFileSync(path.join(dir, 'Telsiz-2.1.0-linux-x86_64.AppImage'), appimage)
    writeInfo(dir, 'latest.yml', ['version: 2.1.0', 'files:', '  - url: Telsiz-Kurulum-2.1.0.exe', '    sha512: ' + sha(exe), '    size: ' + exe.length, 'path: Telsiz-Kurulum-2.1.0.exe', 'sha512: ' + sha(exe), "releaseDate: '2026-10-04T12:16:04.358Z'"])
    writeInfo(dir, 'latest-linux.yml', ['version: 2.1.0', 'files:', '  - url: Telsiz-2.1.0-linux-x86_64.AppImage', '    sha512: ' + sha(appimage), '    size: ' + appimage.length, '    blockMapSize: 10', 'path: Telsiz-2.1.0-linux-x86_64.AppImage', 'sha512: ' + sha(appimage)])
    const ok = guncellemeDosyalari.verifyDir(dir, { version: '2.1.0', require: ['latest.yml', 'latest-linux.yml'] })
    assert.deepEqual(ok.errors, [])
    assert.deepEqual(ok.referenced, ['Telsiz-2.1.0-linux-x86_64.AppImage', 'Telsiz-Kurulum-2.1.0.exe', 'Telsiz-Kurulum-2.1.0.exe.blockmap'])
    assert.match(guncellemeDosyalari.verifyDir(dir, { version: '2.1.1' }).errors.join('\n'), /beklenen 2\.1\.1/)
    assert.match(guncellemeDosyalari.verifyDir(dir, { require: ['latest-mac.yml'] }).errors.join('\n'), /Bilinmeyen/)

    fs.rmSync(path.join(dir, 'Telsiz-Kurulum-2.1.0.exe.blockmap'))
    assert.match(guncellemeDosyalari.verifyDir(dir, {}).errors.join('\n'), /fark indirmesi/)
    fs.writeFileSync(path.join(dir, 'Telsiz-Kurulum-2.1.0.exe.blockmap'), 'b')
    fs.writeFileSync(path.join(dir, 'Telsiz-2.1.0-linux-x86_64.AppImage'), 'degisti!')
    assert.match(guncellemeDosyalari.verifyDir(dir, {}).errors.join('\n'), /sha512 tutmuyor: Telsiz-2\.1\.0-linux-x86_64\.AppImage/)
    fs.rmSync(path.join(dir, 'Telsiz-2.1.0-linux-x86_64.AppImage'))
    assert.match(guncellemeDosyalari.verifyDir(dir, {}).errors.join('\n'), /adı geçen dosya yok/)
    writeInfo(dir, 'latest-linux.yml', ['version: 2.1.0', 'files:', '  - url: ../disari.AppImage', '    sha512: x'])
    assert.match(guncellemeDosyalari.verifyDir(dir, {}).errors.join('\n'), /geçersiz dosya adı/)
    fs.rmSync(path.join(dir, 'latest-linux.yml'))
    assert.match(guncellemeDosyalari.verifyDir(dir, { require: ['latest-linux.yml'] }).errors.join('\n'), /Eksik güncelleme bilgi dosyası: latest-linux.yml/)
    assert.deepEqual(guncellemeDosyalari.parseArgs(['d', '--version', '1.0.0', '--require', 'latest.yml,latest-linux.yml']), { dir: 'd', version: '1.0.0', require: ['latest.yml', 'latest-linux.yml'] })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
