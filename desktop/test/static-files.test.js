'use strict'

// Paketlenmiş dosyaların beyaz listesi ve CSP (src/lib/static-files.js, src/lib/csp.js).
// Eşdeğerlik gerçek Telsiz sunucusuna karşı denetlenir: aynı yollar için sunucu 200 veriyorsa
// masaüstü de verir (service worker ve PWA bildirimi dışında), sunucu 404 veriyorsa masaüstü de.

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const sf = require('../src/lib/static-files')
const csp = require('../src/lib/csp')
const httpUtil = require('../../src/http-util')
const { createChatServer } = require('../../src/app')
const { listenInRange } = require('./yardimci')

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public')

test('CSP sunucudakiyle birebir aynıdır', () => {
  assert.equal(csp.HTML_CSP, httpUtil.HTML_CSP)
  assert.equal(csp.STATIC_CSP, httpUtil.API_CSP)
  assert.match(csp.HTML_CSP, /connect-src 'self'/)
  assert.match(csp.HTML_CSP, /script-src 'self';/)
  assert.doesNotMatch(csp.HTML_CSP, /unsafe/)
  assert.match(csp.API_CSP, /sandbox/)
  assert.match(csp.CONNECT_CSP, /connect-src 'none'/)
  assert.match(csp.PICKER_CSP, /img-src 'self' data:/)
  assert.doesNotMatch(csp.CONNECT_CSP + csp.PICKER_CSP, /unsafe/)
})

test('güvenlik başlıkları sunucudakiyle aynıdır', async () => {
  const res = sf.staticResponse('GET', '/index.html', new Map([['index.html', Buffer.from('<!doctype html>')]]))
  const fake = { headers: {}, setHeader (name, value) { this.headers[name] = value } }
  httpUtil.setSecurityHeaders(fake)
  for (const name of Object.keys(fake.headers)) assert.equal(res.headers.get(name), fake.headers[name], name)
  assert.equal(res.headers.get('content-security-policy'), httpUtil.HTML_CSP)
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.equal(await res.text(), '<!doctype html>')
})

test('beyaz liste ve yol geçişi', () => {
  assert.equal(sf.resolveStatic('/').file, 'index.html')
  assert.equal(sf.resolveStatic('/js/01-core.js').file, 'js/01-core.js')
  assert.equal(sf.resolveStatic('/css/skins/arcade.css').file, 'css/skins/arcade.css')
  assert.equal(sf.resolveStatic('/fonts/OFL-Rubik.txt').file, 'fonts/OFL-Rubik.txt')
  const blocked = [
    '/sw.js', '/manifest.webmanifest', '/butunluk.json', '/app.js', '/server.js', '/package.json',
    '/js/../server.js', '/js/..%2fserver.js', '/js/%2e%2e/server.js', '/js/alt/ic.js', '/js/X.js', '/js/a.JS',
    '/js/con.js', '/css/nul.css', '/js/', '/js', '/fonts/a.woff', '/vendor/other.js', '//js/01-core.js',
    '/js\\01-core.js', '/index.html/', '/INDEX.html', '', 'js/01-core.js', null, 5
  ]
  for (const p of blocked) assert.equal(sf.resolveStatic(p), null, String(p))
  assert.equal(sf.isServableFile('js/01-core.js'), true)
  assert.equal(sf.isServableFile('sw.js'), false)
  assert.equal(sf.isServableFile('/index.html'), false)
  assert.equal(sf.isServableFile('js/../index.html'), false)
})

test('yanıtlar: yöntem, eksik dosya, HEAD', async () => {
  const files = new Map([['js/01-core.js', Buffer.from('x')]])
  assert.equal(sf.staticResponse('GET', '/js/01-core.js', files).status, 200)
  assert.equal(sf.staticResponse('GET', '/js/02-state-dom.js', files).status, 404)
  assert.equal(sf.staticResponse('GET', '/gizli', files, 'Bulunamadı').status, 404)
  assert.equal(await sf.staticResponse('GET', '/gizli', files, 'Bulunamadı').text(), 'Bulunamadı')
  const post = sf.staticResponse('POST', '/js/01-core.js', files)
  assert.equal(post.status, 405)
  assert.equal(post.headers.get('allow'), 'GET, HEAD')
  assert.equal(sf.staticResponse('POST', '/gizli', files).status, 404)
  const head = sf.staticResponse('HEAD', '/js/01-core.js', files)
  assert.equal(head.status, 200)
  assert.equal(head.body, null)
  assert.equal(head.headers.get('content-length'), '1')
  const page = sf.pageResponse('GET', '/', new Map([['/', { data: Buffer.from('p'), type: sf.HTML_TYPE, csp: csp.CONNECT_CSP }]]))
  assert.equal(page.headers.get('content-security-policy'), csp.CONNECT_CSP)
  assert.equal(sf.pageResponse('GET', '/x', new Map()).status, 404)
})

const real = { server: null, port: 0, root: null }

before(async () => {
  real.root = fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-masaustu-statik-'))
  real.server = await createChatServer({ dataDir: path.join(real.root, 'veri'), publicDir: PUBLIC_DIR, log: null })
  real.port = await listenInRange(real.server)
})

after(async () => {
  if (real.server) await new Promise((resolve) => real.server.close(() => resolve()))
  fs.rmSync(real.root, { recursive: true, force: true })
})

function statusOf (urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: real.port, method: 'GET', path: urlPath, agent: false }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject)
    req.end()
  })
}

function publicFiles () {
  const out = []
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? rel + '/' + entry.name : entry.name
      if (entry.isDirectory()) walk(path.join(dir, entry.name), childRel)
      else out.push(childRel)
    }
  }
  walk(PUBLIC_DIR, '')
  return out
}

test('gerçek sunucuyla eşdeğerlik: public/ dosyaları ve saldırı yolları', async () => {
  const desktopOnlyMissing = new Set(['/sw.js', '/manifest.webmanifest'])
  const paths = publicFiles().map((rel) => '/' + rel).concat([
    '/', '/index.html', '/style.css', '/js/../index.html', '/js/%2e%2e/index.html', '/js/..%2fserver.js',
    '/%2e%2e/package.json', '/js/alt/ic.js', '/js/con.js', '/fonts/con.txt', '/css/skins/', '/INDEX.HTML',
    '/js/01-core.js/', '/vendor/', '/icons/icon-512.png', '/favicon.svg', '/sw.js', '/manifest.webmanifest'
  ])
  const files = new Map(publicFiles().filter((rel) => sf.isServableFile(rel)).map((rel) => [rel, fs.readFileSync(path.join(PUBLIC_DIR, ...rel.split('/')))]))
  for (const p of paths) {
    const serverStatus = await statusOf(p)
    let pathname = p
    try {
      pathname = new URL('telsiz://app' + p).pathname
    } catch (err) {
      pathname = p
    }
    const desktopStatus = sf.staticResponse('GET', pathname, files).status
    if (desktopOnlyMissing.has(p)) {
      assert.equal(desktopStatus, 404, p)
      continue
    }
    // Sunucu yolu normalleştirmeden eşler, masaüstünde Chromium normalleştirir: normalleştirilmiş
    // yol sunucuda da aynı sonucu vermelidir
    const expected = pathname === p ? serverStatus : await statusOf(pathname)
    assert.equal(desktopStatus, expected, p + ' (' + pathname + ')')
  }
})
