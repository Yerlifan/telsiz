'use strict'

// HTTP katmanı: statik beyaz liste, yol geçişi denemeleri, güvenlik başlıkları ve CSP,
// dinamik manifest, bozuk JSON, büyük gövde, bilinmeyen yollar ve bozuk girdilere dayanıklılık.

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./server-yardimci')

const HTML_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; frame-src https://www.youtube-nocookie.com"
const API_CSP = "default-src 'none'; frame-ancestors 'none'"

function assertSecurityHeaders (res) {
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
  assert.equal(res.headers['referrer-policy'], 'no-referrer')
  assert.equal(res.headers['x-frame-options'], 'DENY')
  assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin')
  assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin')
  assert.equal(res.headers['permissions-policy'], 'camera=(self), geolocation=(), microphone=(self)')
  for (const name of Object.keys(res.headers)) assert.ok(!name.startsWith('access-control-'), name)
}

describe('statik dosyalar ve güvenlik başlıkları', () => {
  let ctx
  let owner
  before(async () => {
    ctx = await h.startServer({ serverName: 'Çok Uzun Sunucu Adı Deneme' })
    owner = await h.setupOwner(ctx)
  })
  after(async () => {
    await ctx.cleanup()
  })

  it('beyaz listedeki dosyalar doğru türle sunulur', async () => {
    const expected = {
      '/': 'text/html; charset=utf-8',
      '/index.html': 'text/html; charset=utf-8',
      '/crypto.js': 'text/javascript; charset=utf-8',
      '/emoji.js': 'text/javascript; charset=utf-8',
      '/voice.js': 'text/javascript; charset=utf-8',
      '/music.js': 'text/javascript; charset=utf-8',
      '/dj/youtube.js': 'text/javascript; charset=utf-8',
      '/sw.js': 'text/javascript; charset=utf-8',
      '/style.css': 'text/css; charset=utf-8',
      '/favicon.svg': 'image/svg+xml',
      '/icons/icon-192.png': 'image/png',
      '/icons/icon-512.png': 'image/png',
      '/icons/apple-touch-icon.png': 'image/png',
      '/vendor/nacl-fast.min.js': 'text/javascript; charset=utf-8',
      '/vendor/TWEETNACL-LICENSE.txt': 'text/plain; charset=utf-8',
      '/vendor/scrypt.js': 'text/javascript; charset=utf-8',
      '/vendor/SCRYPT-JS-LICENSE.txt': 'text/plain; charset=utf-8',
      '/i18n.js': 'text/javascript; charset=utf-8',
      '/theme-init.js': 'text/javascript; charset=utf-8',
      '/js/ayarlar.js': 'text/javascript; charset=utf-8',
      '/js/ses-paneli-2.js': 'text/javascript; charset=utf-8',
      '/css/tokens.css': 'text/css; charset=utf-8',
      '/css/skins/arcade.css': 'text/css; charset=utf-8',
      '/fonts/inter-latin-ext.woff2': 'font/woff2',
      '/fonts/OFL.txt': 'text/plain; charset=utf-8',
      '/fonts/Lisans-2.txt': 'text/plain; charset=utf-8'
    }
    for (const urlPath of Object.keys(expected)) {
      const res = await h.get(ctx, urlPath)
      assert.equal(res.status, 200, urlPath)
      assert.equal(res.headers['content-type'], expected[urlPath], urlPath)
      assert.equal(res.headers['cache-control'], 'no-cache', urlPath)
      assertSecurityHeaders(res)
    }
    const html = await h.get(ctx, '/')
    assert.equal(html.headers['content-security-policy'], HTML_CSP)
    assert.match(html.text, /<title>Telsiz<\/title>/)
    const sw = await h.get(ctx, '/sw.js')
    assert.equal(sw.headers['content-security-policy'], HTML_CSP)
    const js = await h.get(ctx, '/crypto.js?v=2')
    assert.equal(js.status, 200)
    assert.equal(js.headers['content-security-policy'], API_CSP)

    const head = await h.request(ctx, 'HEAD', '/index.html')
    assert.equal(head.status, 200)
    assert.equal(head.buffer.length, 0)
    assert.equal(head.headers['content-length'], String(Buffer.byteLength(html.text)))

    // ETag ile yeniden doğrulama
    const etag = html.headers.etag
    assert.ok(etag)
    const cached = await h.request(ctx, 'GET', '/', { headers: { 'if-none-match': etag } })
    assert.equal(cached.status, 304)
    assert.equal(cached.buffer.length, 0)

    const post = await h.request(ctx, 'POST', '/index.html', { body: 'x' })
    assert.equal(post.status, 405)
    assert.equal(post.headers.allow, 'GET, HEAD')
  })

  it('beyaz liste dışındaki yollar ve yol geçişi denemeleri sunulmaz', async () => {
    const attempts = [
      '/gizli.txt',
      // Eski tek dosyalık arayüz (modüller artık /js/ altında)
      '/app.js',
      '/app.js?v=2',
      '/../server.js',
      '/%2e%2e/server.js',
      '/%2E%2E/server.js',
      '/vendor/../server.js',
      // Telsiz DJ yardımcı klasöründe yalnızca youtube.js sunulur
      '/dj/gizli.js',
      '/dj/',
      '/dj/../server.js',
      '/dj/youtube.html',
      '/vendor/../../server.js',
      '/icons/../gizli.txt',
      '/./crypto.js',
      '//crypto.js',
      '/crypto.js/',
      '/CRYPTO.JS',
      '/crypto.js%00.png',
      '/..%2fserver.js',
      '/..\\server.js',
      '/veri/state.json',
      '/manifest.json',
      '/server.js',
      '/index.htm',
      'http://127.0.0.1/../server.js',
      // Desenle sunulan klasörler: yalnızca desene uyan, alt klasörü olmayan dosyalar
      '/js/../server.js',
      '/js/..%2fserver.js',
      '/js/%2e%2e/server.js',
      '/js/..\\server.js',
      '/js/../gizli.txt',
      '/js/gizli.txt',
      '/js/alt/ic.js',
      '/js/alt%2fic.js',
      '/js/Ayarlar.js',
      '/js/ayarlar.JS',
      '/js/ayarlar.js.map',
      '/js/.js',
      '/js/',
      '/js',
      '/js/yok.js',
      '/js/con.js',
      '/js/ayarlar.js%00',
      '/js/ayar_lar.js',
      '/js/ayarlar.js/',
      '/css/../server.js',
      '/css/%2e%2e/server.js',
      '/css/gizli.txt',
      '/css/tokens.js',
      '/css/skins/../../server.js',
      '/css/skins/..%2f..%2fserver.js',
      '/css/skins/alt/ic.css',
      '/css/skins/Arcade.css',
      '/css/skins/con.css',
      '/css/alt/skins/arcade.css',
      '/js//ayarlar.js',
      '/fonts/../server.js',
      '/fonts/gizli.js',
      '/fonts/OFL.TXT.woff2',
      '/fonts/Inter-Latin.woff2',
      '/fonts/inter-latin-ext.woff',
      '/fonts/yok.woff2',
      '/fonts/../../gizli.txt',
      '/fonts/%2e%2e/gizli.txt',
      '/fonts/..txt',
      '/fonts/O.F.L.txt',
      // Ad yalnızca büyük/küçük harf farkıyla eşleşiyorsa harf duyarsız dosya sistemlerinde de bulunmaz
      '/fonts/ofl.txt',
      '/fonts/lisans-2.txt',
      '/vendor/scrypt.min.js',
      '/vendor/../vendor/scrypt.js',
      '/theme-init.js/'
    ]
    for (const urlPath of attempts) {
      const res = await h.get(ctx, urlPath)
      assert.equal(res.status, 404, urlPath)
      assert.ok(!res.text.includes(h.SECRET_TEXT), urlPath)
      assertSecurityHeaders(res)
    }
    // 404 metni isteğin diline göre
    assert.equal((await h.get(ctx, '/js/yok.js')).text, 'Page not found.')
    const trMissing = await h.request(ctx, 'GET', '/js/yok.js', { headers: { 'accept-language': 'tr' } })
    assert.equal(trMissing.text, 'Sayfa bulunamadı.')
    const trMethod = await h.request(ctx, 'POST', '/js/ayarlar.js', { body: 'x', headers: { 'accept-language': 'tr' } })
    assert.equal(trMethod.status, 405)
    assert.equal(trMethod.text, 'Bu adres bu istek yöntemini desteklemiyor.')
    for (const urlPath of ['/api/uploads/../../state.json', '/api/uploads/..%2f..%2fstate.json', '/api/../server.js', '/api/uploads/../../veri/state.json']) {
      const res = await h.get(ctx, urlPath, owner.token)
      assert.equal(res.status, 404, urlPath)
      assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
      assert.ok(!res.text.includes('passHash'), urlPath)
      assert.ok(!res.text.includes(h.SECRET_TEXT), urlPath)
    }
  })

  it('dinamik manifest', async () => {
    const res = await h.get(ctx, '/manifest.webmanifest')
    assert.equal(res.status, 200)
    assert.match(res.headers['content-type'], /^application\/manifest\+json/)
    assert.equal(res.headers['cache-control'], 'no-cache')
    assertSecurityHeaders(res)
    assert.deepEqual(res.data, {
      name: 'Çok Uzun Sunucu Adı Deneme',
      short_name: 'Çok Uzun Sun',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#0f1015',
      theme_color: '#0f1015',
      lang: 'en',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
      ]
    })
    assert.equal(res.headers.vary, 'Accept-Language')
    // Dil isteğin Accept-Language başlığından gelir
    for (const [header, lang] of [['tr-TR,tr;q=0.9,en;q=0.8', 'tr'], ['en-US,en;q=0.9,tr;q=0.5', 'en'], ['de-DE, tr;q=0.4', 'tr']]) {
      const localized = await h.request(ctx, 'GET', '/manifest.webmanifest', { headers: { 'accept-language': header } })
      assert.equal(localized.data.lang, lang, header)
    }
    h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { serverName: 'Kankalar' }), 200)
    const renamed = await h.get(ctx, '/manifest.webmanifest')
    assert.equal(renamed.data.name, 'Kankalar')
    assert.equal(renamed.data.short_name, 'Kankalar')
  })

  it('API yanıtlarında JSON başlıkları ve CSP, CORS yok', async () => {
    for (const res of [
      await h.get(ctx, '/api/info'),
      await h.get(ctx, '/api/state', owner.token),
      await h.get(ctx, '/api/state'),
      await h.get(ctx, '/api/yok'),
      await h.request(ctx, 'OPTIONS', '/api/info', { headers: { origin: 'https://kotu.example', 'access-control-request-method': 'POST' } })
    ]) {
      assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
      assert.equal(res.headers['cache-control'], 'no-store')
      assert.equal(res.headers['content-security-policy'], API_CSP)
      assertSecurityHeaders(res)
      assert.equal(typeof res.data.code === 'string' || res.status === 200, true)
    }
  })

  it('bilinmeyen API yolu 404, yanlış metod 405', async () => {
    h.expectStatus(await h.get(ctx, '/api/yok'), 404, 'not_found')
    h.expectStatus(await h.get(ctx, '/api'), 404, 'not_found')
    h.expectStatus(await h.get(ctx, '/api/'), 404, 'not_found')
    const wrong = await h.get(ctx, '/api/login')
    h.expectStatus(wrong, 405, 'method_not_allowed')
    assert.equal(wrong.headers.allow, 'POST')
    const wrong2 = await h.request(ctx, 'PUT', '/api/messages', { body: {} })
    h.expectStatus(wrong2, 405, 'method_not_allowed')
    assert.equal(wrong2.headers.allow, 'GET, POST')
    assert.equal(typeof wrong.data.error, 'string')
  })

  it('bozuk JSON 400, nesne olmayan gövde 400, Content-Type yok sayılır', async () => {
    for (const body of ['{bozuk', '[1,2]', '"metin"', '42', 'null', 'true', '\u0000']) {
      const res = await h.request(ctx, 'POST', '/api/login', { body })
      h.expectStatus(res, 400, 'bad_request')
      assert.equal(typeof res.data.error, 'string')
      assert.ok(!res.text.includes('at '), 'yığın izi olmamalı')
    }
    const loginBody = JSON.stringify({ name: 'sahip', authKey: h.authKeyFor(h.PASSWORD) })
    const plain = await h.request(ctx, 'POST', '/api/login', {
      body: loginBody,
      headers: { 'content-type': 'text/plain' }
    })
    h.expectStatus(plain, 200)
    const bom = await h.request(ctx, 'POST', '/api/login', { body: '\uFEFF' + loginBody })
    h.expectStatus(bom, 200)
  })

  it('büyük JSON gövdesi 413', async () => {
    const big = JSON.stringify({ name: 'x'.repeat(70000), authKey: 'y' })
    const res = await h.request(ctx, 'POST', '/api/login', { body: big })
    h.expectStatus(res, 413, 'too_large')
    assert.equal(res.headers.connection, 'close')
    // Sunucu ayakta
    h.expectStatus(await h.get(ctx, '/api/info'), 200)
  })

  it('bozuk girdiler süreci düşürmez ve 500 üretmez', async () => {
    const weird = [{}, { a: 1 }, { id: { toString: 'x' } }, { id: [1] }, { id: 1e309 }, { id: -5 }, { id: '1e3' },
      { channelId: {}, body: [] }, { name: {}, type: [] }, { userId: '9'.repeat(30), role: {} },
      { to: {}, data: {} }, { muted: null, deafened: null }, { serverName: {}, activeKid: {} },
      { oldAuthKey: {}, newAuthKey: [], kdf: { salt: {}, N: [] }, wrappedKey: {} }, { authKey: 1, kdf: [], publicKey: {} },
      { identity: {}, allowMemberDms: 'evet', ids: [] }, { __proto__: { admin: true } }, { constructor: { prototype: {} } }]
    const routes = ['/api/messages', '/api/messages/edit', '/api/messages/delete', '/api/channels/create',
      '/api/channels/update', '/api/channels/delete', '/api/users/role', '/api/users/ban', '/api/users/kick',
      '/api/users/reset-password', '/api/me/password', '/api/settings', '/api/voice/join',
      '/api/voice/state', '/api/voice/signal', '/api/voice/leave', '/api/register', '/api/login', '/api/prelogin',
      '/api/username-available', '/api/me/keys', '/api/me/identity', '/api/me/username', '/api/me/settings',
      '/api/friends/request', '/api/friends/accept', '/api/friends/decline', '/api/friends/remove',
      '/api/blocks/add', '/api/blocks/remove', '/api/dms/open', '/api/me/delete', '/api/typing']
    for (const route of routes) {
      for (const body of weird) {
        const res = await h.post(ctx, route, owner.token, body)
        assert.ok(res.status >= 200 && res.status < 500, route + ' ' + res.status + ' ' + res.text)
        assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
      }
    }
    for (const q of ['?channel[]=1', '?channel=1&limit[]=2', '?channel=%ZZ', '?before=1&before=2&channel=1', '?channel=1&around=%ZZ',
      '?channel=1&around[]=1', '?channel=1&around=' + '9'.repeat(40), '?channel=1&around=1&around=2', '?around=1']) {
      const res = await h.get(ctx, '/api/messages' + q, owner.token)
      assert.ok(res.status < 500, q)
    }
    for (const q of ['?since[]=1', '?since=%ZZ', '?since=1e9&mv=-1&sig=abc&pmv=x&boot=' + 'z'.repeat(5000), '?since=0&tv=-1', '?since=0&tv[]=1&tv=%ZZ']) {
      const res = await h.get(ctx, '/api/poll' + q, owner.token)
      assert.ok(res.status < 500, q)
    }
    for (const q of ['', '?ids=', '?ids=1,,2', '?ids=%ZZ', '?ids[]=1', '?ids=-1', '?ids=' + '9'.repeat(40), '?ids=1&ids=2']) {
      const res = await h.get(ctx, '/api/profiles' + q, owner.token)
      assert.ok(res.status < 500, q)
    }
    h.expectStatus(await h.get(ctx, '/api/state', owner.token), 200)
  })
})

describe('veri güvenliği', () => {
  it('bozuk state.json ve yedeği varsa StoreError, veri ezilmez', async () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const { createChatServer } = require('../src/app')
    const root = h.makeRoot()
    try {
      const dataDir = path.join(root, 'veri')
      fs.mkdirSync(dataDir, { recursive: true })
      const garbage = '{"version": 2, "users": [bozuk'
      fs.writeFileSync(path.join(dataDir, 'state.json'), garbage)
      fs.writeFileSync(path.join(dataDir, 'state.json.bak'), 'bu da bozuk')
      const isCorrupt = (err) => err.name === 'StoreError' && err.code === 'corrupt' && /bozuk/.test(err.message)
      await assert.rejects(createChatServer({ dataDir, scryptN: 1024, log: null }), isCorrupt)
      assert.equal(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'), garbage)
      assert.equal(fs.readFileSync(path.join(dataDir, 'state.json.bak'), 'utf8'), 'bu da bozuk')
      assert.deepEqual(fs.readdirSync(dataDir).sort(), ['state.json', 'state.json.bak'])
    } finally {
      h.removeRoot(root)
    }
  })

  it('geçersiz kullanıcı kaydı içeren state.json ile başlatılmaz', async () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const { createChatServer } = require('../src/app')
    const root = h.makeRoot()
    try {
      const dataDir = path.join(root, 'veri')
      fs.mkdirSync(dataDir, { recursive: true })
      const state = {
        version: 2,
        serverName: 'Deneme',
        inviteCode: 'ABCDE-FGHJK',
        activeKid: null,
        counters: { user: 1, channel: 1, message: 0 },
        users: [{ id: 1, name: 'Sahip', role: 'kral', passHash: 'x' }],
        sessions: [],
        channels: [{ id: 1, name: 'genel', type: 'text', position: 0, createdAt: 0 }],
        uploads: []
      }
      const text = JSON.stringify(state)
      fs.writeFileSync(path.join(dataDir, 'state.json'), text)
      await assert.rejects(createChatServer({ dataDir, scryptN: 1024, log: null }), (err) => err.code === 'corrupt')
      assert.equal(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'), text)
      assert.ok(!fs.existsSync(path.join(dataDir, '.kilit')))
    } finally {
      h.removeRoot(root)
    }
  })

  it('geçersiz seçenekler TypeError', async () => {
    const { createChatServer } = require('../src/app')
    await assert.rejects(createChatServer({}), TypeError)
    await assert.rejects(createChatServer({ dataDir: 'x', scryptN: 1000 }), TypeError)
    await assert.rejects(createChatServer({ dataDir: 'x', pollTimeoutMs: 0 }), TypeError)
    await assert.rejects(createChatServer({ dataDir: 'x', setupCode: 'ÜÜÜ' }), TypeError)
  })
})
