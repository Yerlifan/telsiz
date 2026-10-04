'use strict'

// Derleme hazırlığı, bütünlük bildirimi, simgeler, ayarlar, metinler ve paket yapılandırması
// (scripts/hazirla.js, scripts/simge.js, src/lib/integrity.js, settings-store.js, strings.js)

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const integrity = require('../src/lib/integrity')
const settingsStore = require('../src/lib/settings-store')
const updates = require('../src/lib/updates')
const strings = require('../src/lib/strings')
const hazirla = require('../scripts/hazirla')
const simge = require('../scripts/simge')

const DESKTOP_DIR = path.join(__dirname, '..')
// Uzun ve kısa tire (U+2014, U+2013) ve noktalı virgül metinlerde kullanılmaz
const FORBIDDEN_PROSE = new RegExp('[' + String.fromCharCode(0x2014, 0x2013) + ';]')
const ROOT_DIR = path.join(DESKTOP_DIR, '..')

function tempDir (name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-masaustu-' + name + '-'))
}

function writeTree (root, files) {
  for (const rel of Object.keys(files)) {
    const file = path.join(root, ...rel.split('/'))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, files[rel])
  }
}

test('masaüstü sürümü kök sürümle aynıdır ve bağımlılıklar tam sabittir', () => {
  const root = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'))
  const desktop = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'package.json'), 'utf8'))
  assert.equal(desktop.name, 'telsiz-masaustu')
  assert.equal(desktop.version, root.version)
  assert.equal(desktop.private, true)
  // Çalışma zamanı bağımlılıkları: electron-updater (electron-builder 26 ile eşleşen sürüm) ve basılı tut
  // tuş kancası için uiohook-napi (yerel modül, yalnızca gerektiğinde yüklenir)
  assert.deepEqual(desktop.dependencies, { 'electron-updater': '6.8.10', 'uiohook-napi': '1.5.5' })
  assert.deepEqual(Object.keys(desktop.devDependencies).sort(), ['electron', 'electron-builder', 'playwright'])
  for (const value of Object.values(desktop.devDependencies).concat(Object.values(desktop.dependencies))) assert.match(value, /^\d+\.\d+\.\d+$/)
  assert.equal(hazirla.checkVersions(ROOT_DIR, DESKTOP_DIR), root.version)
  const lock = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'package-lock.json'), 'utf8'))
  assert.equal(lock.packages[''].version, desktop.version)
  const all = Object.assign({}, desktop.devDependencies, desktop.dependencies)
  for (const name of Object.keys(all)) assert.equal(lock.packages['node_modules/' + name].version, all[name])
  assert.deepEqual(lock.packages[''].dependencies, desktop.dependencies)
  // electron-updater ve uiohook-napi kilit dosyasında geliştirme bağımlılığı olarak işaretlenmez (pakete girer)
  assert.notEqual(lock.packages['node_modules/electron-updater'].dev, true)
  assert.notEqual(lock.packages['node_modules/uiohook-napi'].dev, true)
  assert.equal(lock.packages['node_modules/uiohook-napi'].license, 'MIT')
})

test('uiohook-napi: derlenmiş Node-API ikilileri hedef platformlar için pakette, paketlemede açılır', () => {
  const config = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'electron-builder.json'), 'utf8'))
  // Yerel modül asar dışına açılır (Electron .node dosyasını asar içinden yükleyemez)
  assert.deepEqual(config.asarUnpack, ['node_modules/uiohook-napi/**/*'])
  // Paketteki hazır Node-API ikilileri kullanılır, electron-builder yerel modülleri kaynaktan derlemez
  // (derleme X11 geliştirme başlıkları ve derleyici isterdi, Node-API ikilisi Electron ile de çalışır)
  assert.equal(config.npmRebuild, false)
  const dir = path.join(DESKTOP_DIR, 'node_modules', 'uiohook-napi')
  assert.ok(fs.existsSync(dir), 'uiohook-napi kurulu değil (desktop/ içinde npm ci çalıştırın)')
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  assert.equal(pkg.version, '1.5.5')
  assert.equal(pkg.license, 'MIT')
  // Windows ve Linux derlemeleri x64'tür (electron-builder.json), bu ikililer pakette olmalıdır
  for (const target of ['win32-x64', 'linux-x64']) {
    const file = path.join(dir, 'prebuilds', target, 'uiohook-napi.node')
    assert.ok(fs.existsSync(file) && fs.statSync(file).size > 10000, target)
  }
  assert.deepEqual(config.win.target.map((t) => t.arch), [['x64'], ['x64']])
  assert.deepEqual(config.linux.target.map((t) => t.arch), [['x64'], ['x64']])
})

test('electron-builder yapılandırması: artifact adları, simgeler, sigortalar, güncelleme bilgisi', () => {
  const config = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'electron-builder.json'), 'utf8'))
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'package.json'), 'utf8'))
  assert.equal(config.nsis.artifactName, 'Telsiz-Kurulum-${version}.${ext}')
  assert.equal(config.portable.artifactName, 'Telsiz-${version}-tasinabilir.${ext}')
  assert.deepEqual(config.win.target.map((t) => t.target), ['nsis', 'portable'])
  assert.deepEqual(config.linux.target.map((t) => t.target), ['AppImage', 'deb'])
  // Yayın yapılandırması yalnızca latest.yml, latest-linux.yml ve app-update.yml üretmek içindir.
  // Yükleme her zaman --publish never ile kapalıdır, dosyaları release.yml yükler.
  assert.deepEqual(config.publish, updates.PUBLISH_CONFIG)
  assert.equal(config.appImage.artifactName, 'Telsiz-${version}-linux-${arch}.${ext}')
  assert.equal(config.nsis.differentialPackage, undefined)
  for (const script of Object.keys(pkg.scripts).filter((name) => name.startsWith('derle:'))) assert.match(pkg.scripts[script], /--publish never$/, script)
  assert.equal(config.electronFuses.runAsNode, false)
  assert.equal(config.electronFuses.enableNodeOptionsEnvironmentVariable, false)
  assert.equal(config.electronFuses.onlyLoadAppFromAsar, true)
  assert.equal(config.electronFuses.enableEmbeddedAsarIntegrityValidation, true)
  assert.equal(config.electronFuses.grantFileProtocolExtraPrivileges, false)
  assert.deepEqual(config.files, ['package.json', 'src/**/*', 'app/**/*', 'build/runtime/**/*'])
  assert.equal(pkg.desktopName, config.appId + '.desktop')
  assert.ok(fs.existsSync(path.join(DESKTOP_DIR, pkg.main)))
})

test('hazırlık yalnızca beyaz listedeki dosyaları kopyalar ve bildirimi yazar', () => {
  const root = tempDir('hazirla')
  try {
    const pub = path.join(root, 'public')
    writeTree(pub, {
      'index.html': '<!doctype html>',
      'sw.js': 'self.x = 1',
      'gizli.txt': 'GIZLI',
      'js/01-core.js': 'a',
      'js/alt/ic.js': 'GIZLI',
      'js/X.js': 'GIZLI',
      'css/skins/arcade.css': 'b',
      'fonts/OFL.txt': 'c',
      'icons/icon-192.png': Buffer.from([1, 2, 3])
    })
    // Sembolik bağlantı Windows'ta yönetici hakkı isteyebilir, oluşturulamazsa bu kısım atlanır
    try {
      fs.symlinkSync(path.join(root, 'public', 'gizli.txt'), path.join(pub, 'js', 'bag.js'))
    } catch (err) {
      if (err.code !== 'EPERM') throw err
    }
    const app = path.join(root, 'app')
    const result = hazirla.prepareApp(pub, app)
    assert.deepEqual(result.copied, ['css/skins/arcade.css', 'fonts/OFL.txt', 'icons/icon-192.png', 'index.html', 'js/01-core.js'])
    assert.ok(result.skipped.includes('sw.js'))
    assert.ok(!fs.existsSync(path.join(app, 'sw.js')))
    assert.ok(!fs.existsSync(path.join(app, 'js', 'bag.js')))
    const files = integrity.loadVerifiedFiles(app)
    assert.equal(files.get('js/01-core.js').toString(), 'a')
    assert.equal(files.size, 5)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('hazırlık gerçek public/ klasöründen gelişmiş gürültü engelleme dosyalarını pakete koyar', () => {
  const root = tempDir('rnnoise')
  try {
    const app = path.join(root, 'app')
    const result = hazirla.prepareApp(path.join(ROOT_DIR, 'public'), app)
    const expected = {
      'rnnoise-worklet.js': null,
      'vendor/rnnoise/rnnoise.wasm': '8b60a2ab88fdae2d1a9f940249d0eb072f28ba8e796f7304347b4e07839c8853',
      'vendor/rnnoise/RNNOISE-LICENSE.txt': 'd597473329bdc1807197a303be09e79882159ea858daa9f06ce780592877534e',
      'vendor/rnnoise/RNNOISE-WASM-LICENSE.txt': 'a6cba85bc92e0cff7a450b1d873c0eaa2e9fc96bf472df0247a26bec77bf3ff9'
    }
    for (const rel of Object.keys(expected)) {
      assert.ok(result.copied.includes(rel), rel)
      const entry = result.manifest.files[rel]
      assert.ok(entry, 'bildirimde: ' + rel)
      if (expected[rel]) assert.equal(entry.sha256, expected[rel], rel)
    }
    assert.ok(!result.skipped.some((rel) => rel.indexOf('rnnoise') !== -1), result.skipped.join(', '))
    const files = integrity.loadVerifiedFiles(app)
    assert.equal(files.get('vendor/rnnoise/rnnoise.wasm').length, 152656)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('bütünlük: değiştirilmiş, eksik veya sahte bildirim açılışı durdurur', () => {
  const root = tempDir('butunluk')
  try {
    const pub = path.join(root, 'public')
    writeTree(pub, { 'index.html': '<!doctype html>', 'js/01-core.js': 'a', 'crypto.js': 'c' })
    const app = path.join(root, 'app')
    hazirla.prepareApp(pub, app)
    fs.writeFileSync(path.join(app, 'js', '01-core.js'), 'b')
    assert.throws(() => integrity.loadVerifiedFiles(app), (err) => err.name === 'IntegrityError' && err.files.includes('js/01-core.js'))
    fs.writeFileSync(path.join(app, 'js', '01-core.js'), 'a')
    fs.rmSync(path.join(app, 'crypto.js'))
    assert.throws(() => integrity.loadVerifiedFiles(app), (err) => err.files.includes('crypto.js'))
    fs.writeFileSync(path.join(app, 'crypto.js'), 'c')
    assert.equal(integrity.loadVerifiedFiles(app).size, 3)

    const manifestPath = path.join(app, integrity.MANIFEST_NAME)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const traversal = JSON.parse(JSON.stringify(manifest))
    traversal.files['../package.json'] = { sha256: '0'.repeat(64), size: 1 }
    fs.writeFileSync(manifestPath, JSON.stringify(traversal))
    assert.throws(() => integrity.loadVerifiedFiles(app), (err) => err.files.includes('../package.json'))
    const noIndex = JSON.parse(JSON.stringify(manifest))
    delete noIndex.files['index.html']
    fs.writeFileSync(manifestPath, JSON.stringify(noIndex))
    assert.throws(() => integrity.loadVerifiedFiles(app), /index\.html/)
    fs.writeFileSync(manifestPath, '{bozuk')
    assert.throws(() => integrity.loadVerifiedFiles(app), /not valid JSON/)
    fs.writeFileSync(manifestPath, JSON.stringify({ version: 2, files: {} }))
    assert.throws(() => integrity.loadVerifiedFiles(app), /unknown format/)
    fs.rmSync(manifestPath)
    assert.throws(() => integrity.loadVerifiedFiles(app), /could not be read/)
    assert.throws(() => integrity.buildManifest([{ file: 'sw.js', data: Buffer.from('x') }]), /whitelisted/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('ayarlar doğrulanarak okunur ve atomik yazılır', () => {
  const root = tempDir('ayarlar')
  try {
    const file = path.join(root, 'alt', settingsStore.FILE_NAME)
    assert.deepEqual(settingsStore.load(file), settingsStore.defaults())
    const saved = settingsStore.save(file, { server: 'https://telsiz.ornek.com', closeToTray: true, shortcuts: { toggleMute: 'ctrl+shift+m', toggleDeafen: null } })
    assert.deepEqual(saved, { server: 'https://telsiz.ornek.com', frequencies: [{ origin: 'https://telsiz.ornek.com', name: null, lastUsed: 0 }], closeToTray: true, shortcuts: { toggleMute: 'CommandOrControl+Shift+M', toggleDeafen: null, pttToggle: null }, ptt: { mode: 'toggle', holdKey: null }, autoUpdate: true })
    assert.deepEqual(settingsStore.load(file), saved)
    // Bas konuş: varsayılan bas aç, bas kapat. Basılı tut ve tuşu saklanır, geçersiz ayar varsayılana döner.
    assert.deepEqual(settingsStore.defaults().ptt, { mode: 'toggle', holdKey: null })
    const hold = settingsStore.save(file, Object.assign({}, saved, { shortcuts: { pttToggle: 'ctrl+alt+v' }, ptt: { mode: 'hold', holdKey: 'shift+v' } }))
    assert.deepEqual(hold.ptt, { mode: 'hold', holdKey: 'Shift+V' })
    assert.equal(hold.shortcuts.pttToggle, 'CommandOrControl+Alt+V')
    assert.deepEqual(settingsStore.load(file).ptt, { mode: 'hold', holdKey: 'Shift+V' })
    for (const bad of [{ mode: 'kanca' }, { mode: 'hold', holdKey: 'VolumeUp' }, { mode: 'hold', holdKey: 'V', keycode: 47 }, 'hold', ['hold']]) {
      fs.writeFileSync(file, JSON.stringify(Object.assign({}, saved, { ptt: bad })))
      assert.deepEqual(settingsStore.load(file).ptt, { mode: 'toggle', holdKey: null }, JSON.stringify(bad))
    }
    // Eski ayar dosyası (ptt ve pttToggle yok) okunur
    fs.writeFileSync(file, JSON.stringify({ version: 2, server: 'https://telsiz.ornek.com', shortcuts: { toggleMute: 'F9', toggleDeafen: null } }))
    const old = settingsStore.load(file)
    assert.deepEqual(old.shortcuts, { toggleMute: 'F9', toggleDeafen: null, pttToggle: null })
    assert.deepEqual(old.ptt, { mode: 'toggle', holdKey: null })
    settingsStore.save(file, saved)
    assert.deepEqual(fs.readdirSync(path.dirname(file)), [settingsStore.FILE_NAME])
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    fs.writeFileSync(file, JSON.stringify({ server: 'http://kotu.com', closeToTray: 'evet', shortcuts: { toggleMute: 'A' } }))
    assert.deepEqual(settingsStore.load(file), settingsStore.defaults())
    fs.writeFileSync(file, '{bozuk')
    assert.deepEqual(settingsStore.load(file), settingsStore.defaults())
    fs.writeFileSync(file, 'x'.repeat(settingsStore.MAX_BYTES + 1))
    assert.deepEqual(settingsStore.load(file), settingsStore.defaults())
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('masaüstü metinleri iki dilde eşittir', () => {
  const tr = strings.MESSAGES.tr
  const en = strings.MESSAGES.en
  assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort())
  const params = (text) => Array.from(text.matchAll(/\{([A-Za-z_]+)\}/g)).map((m) => m[1]).sort().join()
  for (const key of Object.keys(tr)) {
    assert.ok(tr[key].trim() !== '' && en[key].trim() !== '', key)
    assert.equal(params(tr[key]), params(en[key]), key)
    assert.doesNotMatch(tr[key] + en[key], FORBIDDEN_PROSE, key)
  }
  assert.equal(strings.pickLang(['tr-TR', 'en-US']), 'tr')
  assert.equal(strings.pickLang(['tr']), 'tr')
  assert.equal(strings.pickLang(['tr_TR']), 'tr')
  assert.equal(strings.pickLang(['en-US', 'tr-TR']), 'en')
  assert.equal(strings.pickLang(['', 'tr']), 'tr')
  assert.equal(strings.pickLang(['de-DE']), 'en')
  assert.equal(strings.pickLang(['trk']), 'en')
  assert.equal(strings.pickLang([]), 'en')
  assert.equal(strings.translator('tr')('connect.connecting', { name: 'Kankalar' }), 'Kankalar frekansına bağlanılıyor...')
  assert.equal(strings.translator('xx')('menu.quit'), 'Quit')
  assert.equal(strings.translator('en')('yok.anahtar'), 'yok.anahtar')
  const sub = strings.subset('tr', 'connect.')
  assert.ok(Object.keys(sub).length > 10 && Object.keys(sub).every((k) => k.startsWith('connect.')))
})

test('simgeler: PNG, ICO ve SVG alt kümesi', () => {
  const rgba = Buffer.alloc(3 * 2 * 4)
  for (const i of rgba.keys()) rgba[i] = (i * 37) & 0xff
  const png = simge.encodePng(3, 2, rgba)
  const decoded = simge.decodePng(png)
  assert.equal(decoded.width, 3)
  assert.equal(decoded.height, 2)
  assert.ok(decoded.data.equals(rgba))
  const real = simge.decodePng(fs.readFileSync(path.join(ROOT_DIR, 'public', 'icons', 'icon-192.png')))
  assert.equal(real.width, 192)
  const broken = Buffer.from(png)
  broken[20] ^= 0xff
  assert.throws(() => simge.decodePng(broken), /CRC/)
  assert.throws(() => simge.decodePng(Buffer.from('nope')), /not a PNG/)

  const svg = fs.readFileSync(path.join(ROOT_DIR, 'public', 'favicon.svg'), 'utf8')
  const scene = simge.parseLogoSvg(svg)
  assert.ok(scene.shapes.length >= 1)
  const tile = simge.rasterize(scene, 32, { tile: true })
  assert.equal(tile[3], 0, 'köşe saydam')
  assert.equal(tile[(16 * 32 + 16) * 4 + 3], 255, 'orta opak')
  assert.throws(() => simge.parseLogoSvg('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>'), /Unsupported SVG element: path/)
  assert.throws(() => simge.parseLogoSvg('<svg viewBox="0 0 1 1"><rect width="1" height="1" fill="red"/></svg>'), /color/)

  const out = tempDir('simge')
  try {
    const written = simge.generateIcons(svg, out)
    assert.ok(written.includes('icon.ico') && written.includes('icon.png') && written.includes('runtime/tray-16.png'))
    const dir = simge.readIcoDirectory(fs.readFileSync(path.join(out, 'icon.ico')))
    assert.deepEqual(dir.map((e) => e.width), simge.ICO_SIZES)
    assert.deepEqual(dir.map((e) => e.png), simge.ICO_SIZES.map((s) => s >= 256))
    for (const size of simge.LINUX_SIZES) assert.equal(simge.decodePng(fs.readFileSync(path.join(out, 'icons', size + 'x' + size + '.png'))).width, size)
    assert.equal(simge.decodePng(fs.readFileSync(path.join(out, 'icon.png'))).width, 512)
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
})
