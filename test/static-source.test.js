'use strict'

// Statik dosya soyutlaması (src/static-source.js) ve çalışma ortamı bilgisi (src/runtime.js).
// Disk kaynağı ile tek dosya uygulamasına (SEA) gömülü dosyalardan okuyan kaynak aynı sunucu
// üzerinden karşılaştırılır: beyaz liste, yol geçişi korumaları, durum kodları, başlıklar (CSP
// ve ETag dahil) ve gövdeler iki durumda birebir aynı olmalıdır. SEA kaynağı, derleme betiğinin
// (scripts/sea-derle.js) ürettiği varlıklar ve derleme bilgisiyle, node:sea ile aynı getAsset
// arayüzüne sahip bir nesne üzerinden kurulur.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const h = require('./server-yardimci')
const runtime = require('../src/runtime')
const { createDiskSource, createSeaSource, defaultSource, isSource } = require('../src/static-source')
const { stageAssets } = require('../scripts/sea-derle')

const ROOT = path.join(__dirname, '..')
// Karşılaştırmada yok sayılan, isteğe ve zamana bağlı başlıklar
const VOLATILE_HEADERS = new Set(['date', 'connection', 'keep-alive'])

function tempDir (t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => h.removeRoot(dir))
  return dir
}

// node:sea ile aynı biçimde çalışan sahte modül: getAsset(anahtar) ArrayBuffer kopyası,
// getAsset(anahtar, 'utf8') metin döner, anahtar yoksa hata fırlatır
function fakeSea (assets) {
  return {
    isSea: () => true,
    getAsset (key, encoding) {
      if (!Object.prototype.hasOwnProperty.call(assets, key)) throw new Error('No matching asset found: ' + key)
      const buf = fs.readFileSync(assets[key])
      if (encoding) return new TextDecoder(encoding).decode(buf)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)
    }
  }
}

// publicDir klasöründen derleme betiğiyle varlıklar hazırlanır ve SEA kaynağı kurulur
function seaSourceFor (t, publicDir) {
  const stage = tempDir(t, 'telsiz-sea-hazirlik-')
  const staged = stageAssets(publicDir, stage, '9.9.9-deneme', 'linux-x64')
  const sea = fakeSea(staged.assets)
  const info = runtime.parseBuildInfo(sea.getAsset(runtime.BUILD_ASSET, 'utf8'))
  return { source: createSeaSource(sea, info.files), info, staged }
}

function comparable (res) {
  const headers = {}
  for (const name of Object.keys(res.headers).sort()) {
    if (!VOLATILE_HEADERS.has(name)) headers[name] = res.headers[name]
  }
  return { status: res.status, headers, body: res.buffer.toString('base64') }
}

async function compareServers (diskCtx, seaCtx, requests) {
  for (const item of requests) {
    const opts = item.headers ? { headers: item.headers } : undefined
    const disk = await h.request(diskCtx, item.method, item.path, opts)
    const sea = await h.request(seaCtx, item.method, item.path, opts)
    assert.deepEqual(comparable(sea), comparable(disk), item.method + ' ' + item.path)
  }
}

const ATTEMPTS = [
  '/gizli.txt', '/app.js', '/../server.js', '/%2e%2e/server.js', '/%2E%2E/server.js', '/vendor/../server.js',
  '/vendor/../../server.js', '/icons/../gizli.txt', '/./crypto.js', '//crypto.js', '/crypto.js/', '/CRYPTO.JS',
  '/crypto.js%00.png', '/..%2fserver.js', '/..\\server.js', '/veri/state.json', '/server.js', '/index.htm',
  '/js/../server.js', '/js/..%2fserver.js', '/js/%2e%2e/server.js', '/js/..\\server.js', '/js/gizli.txt',
  '/js/alt/ic.js', '/js/alt%2fic.js', '/js/Ayarlar.js', '/js/yok.js', '/js/con.js', '/css/gizli.txt',
  '/css/skins/alt/ic.css', '/fonts/gizli.js', '/fonts/ofl.txt', '/fonts/OFL.TXT', '/telsiz-build.json',
  '/public/index.html', '/' + runtime.BUILD_ASSET, '/style.css', '/manifest.json', '/api', '/js/'
]

describe('disk ve SEA kaynakları aynı yanıtları verir', () => {
  it('test klasöründe: beyaz liste, yol geçişi denemeleri, başlıklar, ETag, HEAD ve 405', async (t) => {
    const diskCtx = await h.startServer()
    t.after(() => diskCtx.cleanup())
    const { source, info } = seaSourceFor(t, path.join(diskCtx.root, 'public'))
    // SEA kaynağı başka bir kökte çalışır, public klasörü olmadan da dosyaları sunabilmelidir
    const seaCtx = await h.startServer({ staticSource: source })
    t.after(() => seaCtx.cleanup())
    fs.rmSync(path.join(seaCtx.root, 'public'), { recursive: true, force: true })

    // Fikstürdeki her dosya gömülür (sabit liste yoktur), sunulup sunulmayacağına beyaz liste karar verir
    assert.deepEqual(Array.from(info.files.keys()).sort(), Object.keys(h.FIXTURE).sort())
    const requests = []
    for (const name of Object.keys(h.FIXTURE).concat(['', 'manifest.webmanifest'])) {
      requests.push({ method: 'GET', path: '/' + name })
      requests.push({ method: 'HEAD', path: '/' + name })
    }
    for (const attempt of ATTEMPTS) requests.push({ method: 'GET', path: attempt })
    requests.push({ method: 'POST', path: '/index.html' })
    requests.push({ method: 'GET', path: '/crypto.js?v=2' })
    await compareServers(diskCtx, seaCtx, requests)

    // ETag iki kaynakta aynı (boyut ve değişiklik zamanı), 304 yanıtları da aynı
    const html = await h.get(seaCtx, '/')
    assert.equal(html.status, 200)
    assert.equal(html.headers.etag, (await h.get(diskCtx, '/')).headers.etag)
    await compareServers(diskCtx, seaCtx, [
      { method: 'GET', path: '/', headers: { 'if-none-match': html.headers.etag } },
      { method: 'GET', path: '/', headers: { 'if-none-match': 'W/"0-0"' } }
    ])
    const cached = await h.request(seaCtx, 'GET', '/', { headers: { 'if-none-match': html.headers.etag } })
    assert.equal(cached.status, 304)
    const secret = await h.get(seaCtx, '/js/gizli.txt')
    assert.equal(secret.status, 404)
    assert.ok(!secret.text.includes(h.SECRET_TEXT))
  })

  it('gerçek public klasöründeki her dosya iki kaynakta aynı sunulur, arayüz dosyaları eksiksiz gömülür', async (t) => {
    // Arayüz dosyaları geliştirme sırasında değişebileceği için önce bir kopyası alınır
    const copyRoot = tempDir(t, 'telsiz-public-kopya-')
    const publicCopy = path.join(copyRoot, 'public')
    fs.cpSync(path.join(ROOT, 'public'), publicCopy, { recursive: true, preserveTimestamps: true })
    const diskCtx = await h.startServer({ publicDir: publicCopy })
    t.after(() => diskCtx.cleanup())
    const { source, info } = seaSourceFor(t, publicCopy)
    const seaCtx = await h.startServer({ staticSource: source })
    t.after(() => seaCtx.cleanup())

    const files = Array.from(info.files.keys())
    assert.ok(files.includes('index.html'))
    assert.ok(files.some((f) => /^js\/[0-9a-z-]+\.js$/.test(f)), 'en az bir /js/ modülü gömülmeli')
    assert.ok(files.includes('vendor/nacl-fast.min.js'))
    const requests = files.map((f) => ({ method: 'GET', path: '/' + f }))
    requests.push({ method: 'GET', path: '/' })
    await compareServers(diskCtx, seaCtx, requests)
    // index.html'in bağlandığı her yerel betik ve stil dosyası SEA kaynağında 200 döner
    const html = fs.readFileSync(path.join(publicCopy, 'index.html'), 'utf8')
    const refs = Array.from(html.matchAll(/(?:src|href)="(\/?[A-Za-z0-9._/-]+\.(?:js|css|svg|png|webmanifest))"/g)).map((m) => '/' + m[1].replace(/^\//, ''))
    assert.ok(refs.length > 0)
    for (const ref of refs) {
      const res = await h.get(seaCtx, ref)
      assert.equal(res.status, 200, ref)
    }
  })
})

describe('statik dosya kaynakları', () => {
  it('SEA kaynağı yalnızca derleme bilgisindeki geçerli yolları açar, boyut uyuşmazlığı hata verir', async (t) => {
    const dir = tempDir(t, 'telsiz-sea-kaynak-')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'merhaba')
    const assets = { 'public/js/a.js': path.join(dir, 'a.txt'), 'public/b.css': path.join(dir, 'a.txt') }
    const files = new Map([['js/a.js', { size: 7, mtime: 1000 }], ['b.css', { size: 99, mtime: 2000 }]])
    const source = createSeaSource(fakeSea(assets), files)
    assert.equal(source.kind, 'sea')
    assert.equal(isSource(source), true)
    const opened = await source.open('js/a.js')
    assert.deepEqual([opened.size, opened.mtimeMs], [7, 1000])
    assert.equal((await opened.read()).toString('utf8'), 'merhaba')
    await opened.close()
    for (const bad of ['js/../a.js', '../js/a.js', '/js/a.js', 'js//a.js', 'js\\a.js', 'yok.js', '', 'constructor', '__proto__', null, 5]) {
      assert.equal(await source.open(bad), null, String(bad))
    }
    const mismatch = await source.open('b.css')
    await assert.rejects(mismatch.read(), /size does not match/)
    assert.throws(() => createSeaSource({}, files), TypeError)
    assert.throws(() => createSeaSource(fakeSea(assets), {}), TypeError)
  })

  it('disk kaynağı: dosya, klasör, yok ve geçersiz yollar', async (t) => {
    const dir = tempDir(t, 'telsiz-disk-kaynak-')
    fs.mkdirSync(path.join(dir, 'js', 'klasor.js'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'js', 'a.js'), 'abc')
    const source = createDiskSource(dir)
    assert.equal(source.kind, 'disk')
    const opened = await source.open('js/a.js')
    assert.equal(opened.size, 3)
    assert.equal(Number.isSafeInteger(opened.mtimeMs), true)
    assert.equal((await opened.read()).toString('utf8'), 'abc')
    await opened.close()
    for (const bad of ['js/klasor.js', 'js/yok.js', 'js/a.js/x', '../a.js', 'js/../js/a.js', '']) {
      assert.equal(await source.open(bad), null, bad)
    }
    assert.throws(() => createDiskSource(''), TypeError)
  })

  it('disk kaynağı yalnızca büyük/küçük harf farkıyla eşleşen adları bulmaz (harf duyarsız dosya sistemleri)', async (t) => {
    if (process.platform === 'win32') {
      t.skip('Windows\'ta sembolik bağlantı oluşturmak yetki gerektirir')
      return
    }
    const dir = tempDir(t, 'telsiz-disk-harf-')
    fs.mkdirSync(path.join(dir, 'fonts'))
    fs.writeFileSync(path.join(dir, 'fonts', 'OFL.txt'), 'lisans')
    // Harf duyarsız bir sistemde 'ofl.txt' istenince açılan dosyanın gerçek adı 'OFL.txt' olur,
    // bu durum bağlantıyla taklit edilir
    fs.symlinkSync('OFL.txt', path.join(dir, 'fonts', 'ofl.txt'))
    fs.symlinkSync('OFL.txt', path.join(dir, 'fonts', 'Lisans.txt'))
    const source = createDiskSource(dir)
    assert.equal(await source.open('fonts/ofl.txt'), null)
    const exact = await source.open('fonts/OFL.txt')
    assert.equal(exact.size, 6)
    await exact.close()
    // Tamamen farklı adlı bir bağlantı (ör. paket yöneticisinin bağlantısı) olduğu gibi kabul edilir
    const other = await source.open('fonts/Lisans.txt')
    assert.equal(other.size, 6)
    await other.close()
  })

  it('varsayılan kaynak: publicDir verilirse o klasör, verilmezse sunucunun yanındaki public klasörü', () => {
    assert.equal(runtime.isSea(), false)
    const fallback = defaultSource(null)
    assert.equal(fallback.kind, 'disk')
    assert.equal(fallback.root, path.join(ROOT, 'public'))
    const given = defaultSource(path.join('a', 'b'))
    assert.equal(given.root, path.resolve('a', 'b'))
  })

  it('createChatServer geçersiz staticSource ve publicDir değerlerini reddeder', async () => {
    const { createChatServer } = require('../src/app')
    await assert.rejects(createChatServer({ dataDir: path.join(os.tmpdir(), 'kullanilmaz'), staticSource: {} }), /invalid staticSource/)
    await assert.rejects(createChatServer({ dataDir: path.join(os.tmpdir(), 'kullanilmaz'), publicDir: '' }), /invalid publicDir/)
  })
})

describe('çalışma ortamı bilgisi', () => {
  it('testlerde SEA değildir, sürüm package.json sürümüdür', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    assert.equal(runtime.isSea(), false)
    assert.equal(runtime.seaApi(), null)
    assert.equal(runtime.buildInfo(), null)
    assert.equal(runtime.version(), pkg.version)
  })

  it('gömülü dosya yolları yalnızca güvenli göreli yollardır', () => {
    for (const ok of ['index.html', 'js/01-core.js', 'css/skins/arcade.css', 'fonts/OFL-Figtree.txt', 'a_b.c-d']) {
      assert.equal(runtime.isAssetFile(ok), true, ok)
    }
    for (const bad of ['', '/index.html', 'js/', 'js//a.js', '../a', 'a/../b', './a', 'a/.', 'a\\b', 'c:/x', 'a b', 'ç.js', null, 1, 'x'.repeat(513)]) {
      assert.equal(runtime.isAssetFile(bad), false, String(bad))
    }
  })

  it('derleme bilgisi doğrulanır', () => {
    const good = runtime.parseBuildInfo(JSON.stringify({ version: '2.0.0', files: { 'index.html': { size: 3, mtime: 5 } } }))
    assert.equal(good.version, '2.0.0')
    assert.deepEqual(Array.from(good.files.entries()), [['index.html', { size: 3, mtime: 5 }]])
    const bad = [
      '{',
      'null',
      '[]',
      JSON.stringify({ files: {} }),
      JSON.stringify({ version: '', files: {} }),
      JSON.stringify({ version: 'x'.repeat(65), files: {} }),
      JSON.stringify({ version: '2.0.0' }),
      JSON.stringify({ version: '2.0.0', files: [] }),
      JSON.stringify({ version: '2.0.0', files: { '../server.js': { size: 1, mtime: 1 } } }),
      JSON.stringify({ version: '2.0.0', files: { 'a.js': { size: -1, mtime: 1 } } }),
      JSON.stringify({ version: '2.0.0', files: { 'a.js': { size: 1, mtime: 1.5 } } }),
      JSON.stringify({ version: '2.0.0', files: { 'a.js': null } })
    ]
    for (const text of bad) assert.throws(() => runtime.parseBuildInfo(text), /SEA build info/, text)
  })
})
