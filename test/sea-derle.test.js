'use strict'

// Tek dosya uygulaması derlemesi (scripts/sea-derle.js): hedef algılama, çıktı adı, public/
// klasörünün taranması (sabit liste yoktur), varlıkların hazırlanması ve derleme bilgisi.
// Uçtan uca derleme ve duman testi (gerçek bir ikili üretip scripts/sea-duman.js ile denetler)
// uzun sürdüğü ve yaklaşık 120 MB yer kapladığı için isteğe bağlıdır: TELSIZ_SEA_TEST=1 ile
// çalışır, Node.js SEA desteği veya postject yoksa atlanır. CI'da exe.yml aynı denetimi yapar.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { isBuiltin } = require('node:module')
const sea = require('../scripts/sea-derle')
const runtime = require('../src/runtime')

const ROOT = path.join(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'sea-derle.js')
// Uçtan uca testin bağlantı noktası (duman testinin varsayılanı 4220, CI ile çakışmasın diye farklı)
const E2E_PORT = 4224

function tempDir (t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'telsiz-sea-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  return dir
}

function elfHeader (machine, cls, data) {
  const buf = Buffer.alloc(64)
  buf.set([0x7f, 0x45, 0x4c, 0x46, cls || 2, data || 1, 1, 0])
  buf.writeUInt16LE(machine, 18)
  return buf
}

function peHeader (machine) {
  const buf = Buffer.alloc(512)
  buf.write('MZ', 0, 'latin1')
  buf.writeUInt32LE(0x80, 0x3c)
  buf.writeUInt32LE(0x00004550, 0x80)
  buf.writeUInt16LE(machine, 0x84)
  return buf
}

describe('SEA derlemesi: yardımcılar', () => {
  it('ikili biçimi ve mimarisi başlıktan algılanır', () => {
    assert.equal(sea.detectTarget(elfHeader(0x3e)), 'linux-x64')
    assert.equal(sea.detectTarget(elfHeader(0xb7)), 'linux-arm64')
    assert.equal(sea.detectTarget(elfHeader(0x28)), null)
    assert.equal(sea.detectTarget(elfHeader(0x3e, 1)), null)
    assert.equal(sea.detectTarget(elfHeader(0x3e, 2, 2)), null)
    assert.equal(sea.detectTarget(peHeader(0x8664)), 'windows-x64')
    assert.equal(sea.detectTarget(peHeader(0xaa64)), 'windows-arm64')
    assert.equal(sea.detectTarget(peHeader(0x14c)), null)
    const macho = Buffer.alloc(64)
    macho.writeUInt32LE(0xfeedfacf, 0)
    assert.equal(sea.detectTarget(macho), 'macos')
    assert.equal(sea.detectTarget(Buffer.alloc(64)), null)
    assert.equal(sea.detectTarget(Buffer.alloc(10)), null)
    assert.equal(sea.detectTarget('MZ'), null)
    const brokenPe = peHeader(0x8664)
    brokenPe.writeUInt32LE(0x10000, 0x3c)
    assert.equal(sea.detectTarget(brokenPe), null)
    // Bu testi çalıştıran node ikilisi kendi sistemi olarak algılanır
    const host = sea.hostTarget()
    if (host) {
      const fd = fs.openSync(process.execPath, 'r')
      const head = Buffer.alloc(65536)
      const count = fs.readSync(fd, head, 0, head.length, 0)
      fs.closeSync(fd)
      assert.equal(sea.detectTarget(head.subarray(0, count)), host)
    }
  })

  it('hedef adları ve çıktı adı', () => {
    assert.deepEqual(sea.TARGETS, ['linux-x64', 'linux-arm64', 'windows-x64'])
    assert.equal(sea.hostTarget('linux', 'x64'), 'linux-x64')
    assert.equal(sea.hostTarget('linux', 'arm64'), 'linux-arm64')
    assert.equal(sea.hostTarget('win32', 'x64'), 'windows-x64')
    assert.equal(sea.hostTarget('win32', 'arm64'), null)
    assert.equal(sea.hostTarget('darwin', 'arm64'), null)
    assert.equal(sea.hostTarget('linux', 'ia32'), null)
    assert.equal(sea.outputName('2.0.0', 'windows-x64'), 'telsiz-2.0.0-server-windows-x64.exe')
    assert.equal(sea.outputName('2.0.0', 'linux-x64'), 'telsiz-2.0.0-server-linux-x64')
    assert.equal(sea.outputName('2.1.0-beta.1', 'linux-arm64'), 'telsiz-2.1.0-beta.1-server-linux-arm64')
    assert.equal(sea.SEA_FUSE, 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2')
  })

  it('public klasörü taranır: alt klasörler dahil, nokta ile başlayanlar atlanır, sıralı', (t) => {
    const dir = tempDir(t)
    const files = ['index.html', 'js/02-b.js', 'js/01-a.js', 'css/skins/arcade.css', 'fonts/OFL-X.txt', '.DS_Store', '.gizli/x.js', 'js/.taslak.js']
    for (const name of files) {
      const file = path.join(dir, ...name.split('/'))
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, name)
    }
    const found = sea.collectPublicFiles(dir).map((f) => f.rel)
    assert.deepEqual(found, ['css/skins/arcade.css', 'fonts/OFL-X.txt', 'index.html', 'js/01-a.js', 'js/02-b.js'])
  })

  it('gömülemeyecek adlar ve sembolik bağlantılar hata verir', (t) => {
    const dir = tempDir(t)
    fs.writeFileSync(path.join(dir, 'index.html'), 'x')
    fs.writeFileSync(path.join(dir, 'boşluk var.js'), 'x')
    assert.throws(() => sea.collectPublicFiles(dir), /boşluk var\.js adı gömülemez/)
    fs.rmSync(path.join(dir, 'boşluk var.js'))
    if (process.platform !== 'win32') {
      fs.symlinkSync('index.html', path.join(dir, 'baglanti.html'))
      assert.throws(() => sea.collectPublicFiles(dir), /baglanti\.html sembolik bağlantı/)
    }
  })

  it('varlıklar hazırlanır: kopyalar özgün dosyalarla aynı, derleme bilgisi sunucunun okuyacağı biçimde', (t) => {
    const stage = tempDir(t)
    const publicCopy = path.join(tempDir(t), 'public')
    fs.cpSync(path.join(ROOT, 'public'), publicCopy, { recursive: true, preserveTimestamps: true })
    const staged = sea.stageAssets(publicCopy, stage, '2.0.0', 'linux-x64')
    const expected = sea.collectPublicFiles(publicCopy).map((f) => f.rel)
    assert.equal(staged.count, expected.length)
    const info = runtime.parseBuildInfo(fs.readFileSync(staged.assets[runtime.BUILD_ASSET], 'utf8'))
    assert.equal(info.version, '2.0.0')
    assert.deepEqual(Array.from(info.files.keys()), expected)
    assert.deepEqual(Object.keys(staged.assets).sort(), expected.map((rel) => runtime.PUBLIC_PREFIX + rel).concat([runtime.BUILD_ASSET]).sort())
    let total = 0
    for (const rel of expected) {
      const original = path.join(publicCopy, ...rel.split('/'))
      const copy = fs.readFileSync(staged.assets[runtime.PUBLIC_PREFIX + rel])
      assert.ok(copy.equals(fs.readFileSync(original)), rel)
      const meta = info.files.get(rel)
      assert.equal(meta.size, copy.length, rel)
      assert.equal(meta.mtime, Math.floor(fs.statSync(original).mtimeMs), rel)
      total += copy.length
    }
    assert.equal(staged.bytes, total)
    const raw = JSON.parse(fs.readFileSync(staged.assets[runtime.BUILD_ASSET], 'utf8'))
    assert.deepEqual([raw.name, raw.target, raw.node], ['telsiz', 'linux-x64', process.version])
  })

  it('index.html yoksa derleme durur', (t) => {
    const dir = tempDir(t)
    fs.writeFileSync(path.join(dir, 'a.js'), 'x')
    assert.throws(() => sea.stageAssets(dir, tempDir(t), '2.0.0', 'linux-x64'), /index\.html bulunamadı/)
  })

  it('komut satırı: yardım, tanınmayan argüman, bilinmeyen hedef, eksik node ikilisi', () => {
    const run = (...args) => spawnSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8' })
    const help = run('--yardim')
    assert.equal(help.status, 0)
    assert.match(help.stdout, /Kullanım/)
    const unknown = run('--bilinmeyen')
    assert.equal(unknown.status, 2)
    assert.match(unknown.stderr, /Tanınmayan argüman/)
    const missingValue = run('--hedef')
    assert.equal(missingValue.status, 2)
    assert.match(missingValue.stderr, /bir değer bekliyor/)
    const badTarget = run('--hedef', 'macos-arm64', '--node-ikilisi', process.execPath)
    assert.equal(badTarget.status, 1)
    assert.match(badTarget.stderr, /(Bilinmeyen hedef|varlık desteğini)/)
    const host = sea.hostTarget()
    const other = sea.TARGETS.find((target) => target !== host)
    const noBinary = run('--hedef', other)
    assert.equal(noBinary.status, 1)
    assert.match(noBinary.stderr, /(--node-ikilisi ile verilmelidir|varlık desteğini)/)
    // Yanlış mimarideki ikili reddedilir (bu node ikilisi başka bir hedef olarak verilir)
    const wrongBinary = run('--hedef', other, '--node-ikilisi', process.execPath)
    assert.equal(wrongBinary.status, 1)
    assert.match(wrongBinary.stderr, /(node ikilisi değil|varlık desteğini)/)
  })
})

describe('SEA derlemesi: uçtan uca (isteğe bağlı)', () => {
  it('ikili derlenir ve duman testinden geçer', async (t) => {
    if (process.env.TELSIZ_SEA_TEST !== '1') {
      t.skip('TELSIZ_SEA_TEST=1 verilmedi (derleme uzun sürer, CI\'da exe.yml çalıştırır)')
      return
    }
    if (!isBuiltin('node:sea') || !sea.hostTarget()) {
      t.skip('Bu Node.js sürümü veya sistem tek dosya uygulamasını desteklemiyor')
      return
    }
    try {
      require.resolve('postject')
    } catch (err) {
      t.skip('postject kurulu değil (npm ci)')
      return
    }
    const outDir = tempDir(t, 'telsiz-sea-cikti-')
    const result = await sea.buildSea({ outDir, log: () => {} })
    assert.equal(path.basename(result.file), sea.outputName(result.version, sea.hostTarget()))
    assert.equal(sea.sha256File(result.file), result.sha256)
    assert.deepEqual(fs.readdirSync(outDir), [path.basename(result.file)])
    const smoke = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'sea-duman.js'), result.file, '--port', String(E2E_PORT)], { encoding: 'utf8', timeout: 300000 })
    assert.equal(smoke.status, 0, smoke.stdout + smoke.stderr)
    assert.match(smoke.stdout, /Duman testi başarılı/)
  })
})
