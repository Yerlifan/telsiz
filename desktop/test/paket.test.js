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
  assert.equal(desktop.dependencies, undefined)
  assert.deepEqual(Object.keys(desktop.devDependencies).sort(), ['electron', 'electron-builder', 'playwright'])
  for (const value of Object.values(desktop.devDependencies)) assert.match(value, /^\d+\.\d+\.\d+$/)
  assert.equal(hazirla.checkVersions(ROOT_DIR, DESKTOP_DIR), root.version)
  const lock = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'package-lock.json'), 'utf8'))
  assert.equal(lock.packages[''].version, desktop.version)
  for (const name of Object.keys(desktop.devDependencies)) assert.equal(lock.packages['node_modules/' + name].version, desktop.devDependencies[name])
})

test('electron-builder yapılandırması: artifact adları, simgeler, sigortalar, yayın yok', () => {
  const config = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'electron-builder.json'), 'utf8'))
  assert.equal(config.nsis.artifactName, 'Telsiz-Kurulum-${version}.${ext}')
  assert.equal(config.portable.artifactName, 'Telsiz-${version}-tasinabilir.${ext}')
  assert.deepEqual(config.win.target.map((t) => t.target), ['nsis', 'portable'])
  assert.deepEqual(config.linux.target.map((t) => t.target), ['AppImage', 'deb'])
  assert.equal(config.publish, null)
  assert.equal(config.electronFuses.runAsNode, false)
  assert.equal(config.electronFuses.enableNodeOptionsEnvironmentVariable, false)
  assert.equal(config.electronFuses.onlyLoadAppFromAsar, true)
  assert.equal(config.electronFuses.enableEmbeddedAsarIntegrityValidation, true)
  assert.equal(config.electronFuses.grantFileProtocolExtraPrivileges, false)
  assert.deepEqual(config.files, ['package.json', 'src/**/*', 'app/**/*', 'build/runtime/**/*'])
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'package.json'), 'utf8'))
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
    assert.deepEqual(saved, { server: 'https://telsiz.ornek.com', closeToTray: true, shortcuts: { toggleMute: 'CommandOrControl+Shift+M', toggleDeafen: null } })
    assert.deepEqual(settingsStore.load(file), saved)
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
  assert.equal(strings.translator('tr')('connect.connecting', { name: 'Kankalar' }), 'Kankalar sunucusuna bağlanılıyor...')
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
