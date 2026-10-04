'use strict'

// İstek iletme (src/lib/proxy.js): başlık süzgeçleri ve gerçek bir yerel Telsiz sunucusuna karşı
// Electron olmadan uçtan uca iletme (Node fetch, Electron'daki session.fetch yerine).
// Kayıt, mesaj gönderme ve listeleme, long-poll, dosya yükleme ve indirme akışı, X-Token ve
// Accept-Language iletimi, hata durumları, yönlendirme yasağı, süre sınırı ve iptal denetlenir.

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const http = require('node:http')
const proxy = require('../src/lib/proxy')
const { createChatServer } = require('../../src/app')
const h = require('../../test/server-yardimci')
const { listenInRange, sleep } = require('./yardimci')

const APP = 'telsiz://app'

// Electron protocol.handle isteğinin benzeri
function appRequest (method, urlPath, opts) {
  const o = opts || {}
  let body = null
  if (o.json !== undefined) body = new Blob([JSON.stringify(o.json)]).stream()
  else if (o.bytes !== undefined) body = new Blob([o.bytes]).stream()
  else if (o.stream) body = o.stream
  const headers = new Headers(o.headers || {})
  if (o.json !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
  if (o.token) headers.set('x-token', o.token)
  return {
    url: 'telsiz://app' + urlPath,
    method,
    headers,
    body,
    initiatorOrigin: o.initiator === undefined ? APP : o.initiator,
    mode: o.mode || 'cors',
    signal: o.signal
  }
}

async function json (response) {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch (err) {
    return null
  }
}

test('istek başlık süzgeci', () => {
  const out = proxy.requestHeaders(new Headers({
    'X-Token': 'abcDEF_123-xyz',
    'Content-Type': 'application/json',
    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
    Cookie: 'a=b',
    Origin: 'telsiz://app',
    Referer: 'telsiz://app/',
    Authorization: 'Bearer x',
    Host: 'kotu.com',
    'X-Forwarded-For': '1.2.3.4',
    'Content-Length': '5'
  }))
  assert.deepEqual(out, { 'x-token': 'abcDEF_123-xyz', 'content-type': 'application/json', 'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8' })
  assert.deepEqual(proxy.requestHeaders({ 'content-type': 'application/octet-stream' }), { 'content-type': 'application/octet-stream' })
  assert.deepEqual(proxy.requestHeaders({ 'content-type': 'application/json; charset=utf-8' }), { 'content-type': 'application/json; charset=utf-8' })
  assert.deepEqual(proxy.requestHeaders({ 'content-type': 'text/html' }), {})
  assert.deepEqual(proxy.requestHeaders({ 'content-type': 'application/json\r\nX: y' }), {})
  assert.deepEqual(proxy.requestHeaders({ 'x-token': 'a b' }), {})
  assert.deepEqual(proxy.requestHeaders({ 'x-token': 'x'.repeat(513) }), {})
  assert.deepEqual(proxy.requestHeaders({ 'accept-language': 'tr<script>' }), {})
  assert.deepEqual(proxy.requestHeaders(null), {})
})

test('yanıt başlık süzgeci', () => {
  const out = proxy.responseHeaders(new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': '42',
    'Cache-Control': 'no-store',
    'Retry-After': '30',
    'Set-Cookie': 'a=b',
    'Access-Control-Allow-Origin': '*',
    Location: 'https://kotu.com/',
    Refresh: '0; url=https://kotu.com/',
    'Content-Security-Policy': "default-src *",
    Link: '<https://kotu.com/x.js>; rel=preload'
  }))
  assert.equal(out['Content-Type'], 'application/json; charset=utf-8')
  assert.equal(out['Content-Length'], '42')
  assert.equal(out['Cache-Control'], 'no-store')
  assert.equal(out['Retry-After'], '30')
  assert.equal(out['Content-Security-Policy'], "default-src 'none'; sandbox; frame-ancestors 'none'")
  assert.equal(out['X-Content-Type-Options'], 'nosniff')
  for (const name of Object.keys(out)) assert.ok(!/set-cookie|access-control|location|refresh|^link$/i.test(name), name)
  assert.equal(proxy.responseHeaders({ 'content-type': 'text/html' })['Content-Type'], 'application/octet-stream')
  assert.equal(proxy.responseHeaders({ 'content-type': 'image/svg+xml' })['Content-Type'], 'application/octet-stream')
  assert.equal(proxy.responseHeaders({})['Content-Type'], 'application/octet-stream')
  assert.equal(proxy.responseHeaders({})['Cache-Control'], 'no-store')
  const gz = proxy.responseHeaders({ 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '10' })
  assert.equal(gz['Content-Length'], undefined)
  assert.equal(gz['content-encoding'], undefined)
  assert.equal(proxy.responseHeaders({ 'content-encoding': 'identity', 'content-length': '10' })['Content-Length'], '10')
  assert.equal(proxy.responseHeaders({ 'content-length': '-1' })['Content-Length'], undefined)
})

test('hedef adres her zaman ayarlardaki sunucudur', () => {
  const origin = 'https://telsiz.ornek.com'
  assert.equal(proxy.targetUrl(origin, new URL('telsiz://app/api/poll?since=1&mv=2')), 'https://telsiz.ornek.com/api/poll?since=1&mv=2')
  assert.equal(proxy.targetUrl(origin, new URL('telsiz://app/api/uploads/abc%2F')), 'https://telsiz.ornek.com/api/uploads/abc%2F')
  assert.equal(proxy.targetUrl(origin, new URL('telsiz://app/api/../x')), null)
  assert.equal(proxy.targetUrl(origin, new URL('telsiz://app/api//kotu.com/x')), 'https://telsiz.ornek.com/api//kotu.com/x')
  assert.equal(proxy.targetUrl(origin, new URL('telsiz://app/js/01-core.js')), null)
  assert.equal(proxy.targetUrl(origin, new URL('telsiz://app/apix')), null)
  assert.equal(proxy.targetUrl(origin, new URL('telsiz://app/api?' + 'a'.repeat(9000))), null)
  assert.equal(proxy.isApiPath('/api'), true)
  assert.equal(proxy.isApiPath('/api/'), true)
  assert.equal(proxy.isApiPath('/apix'), false)
  assert.equal(proxy.headerTimeout('POST', '/api/uploads'), proxy.UPLOAD_HEADER_TIMEOUT_MS)
  assert.equal(proxy.headerTimeout('GET', '/api/poll'), proxy.HEADER_TIMEOUT_MS)
})

test('yerel ret: köken, gezinme, yöntem, uzun adres', async () => {
  let calls = 0
  const handle = proxy.createApiProxy({ origin: 'http://127.0.0.1:4300', fetch: async () => { calls++ } })
  assert.equal((await handle(appRequest('GET', '/api/info', { initiator: 'telsiz://baglan' }))).status, 403)
  assert.equal((await handle(appRequest('GET', '/api/info', { initiator: null }))).status, 403)
  assert.equal((await handle(appRequest('GET', '/api/info', { initiator: 'null' }))).status, 403)
  assert.equal((await handle(appRequest('GET', '/api/info', { mode: 'navigate' }))).status, 403)
  const put = await handle(appRequest('PUT', '/api/info'))
  assert.equal(put.status, 405)
  assert.equal(put.headers.get('allow'), 'GET, HEAD, POST')
  assert.equal((await json(put)).code, 'method_not_allowed')
  assert.equal((await handle(appRequest('DELETE', '/api/info'))).status, 405)
  assert.equal((await handle(appRequest('GET', '/api/x?' + 'a'.repeat(9000)))).status, 414)
  assert.equal(calls, 0)
  assert.throws(() => proxy.createApiProxy({ fetch: () => {} }), TypeError)
})

test('ağ hatası, yönlendirme ve süre sınırı ağ hatası olarak döner', async () => {
  const failing = proxy.createApiProxy({ origin: 'http://127.0.0.1:4300', fetch: async () => { throw new Error('net::ERR_CONNECTION_REFUSED') } })
  const res = await failing(appRequest('GET', '/api/info'))
  assert.equal(res.type, 'error')
  assert.equal(res.status, 0)
  let init = null
  const slow = proxy.createApiProxy({
    origin: 'http://127.0.0.1:4300',
    headerTimeoutMs: 50,
    fetch: (url, i) => {
      init = i
      return new Promise((resolve, reject) => i.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    }
  })
  const started = Date.now()
  assert.equal((await slow(appRequest('GET', '/api/poll'))).type, 'error')
  assert.ok(Date.now() - started < 2000)
  assert.equal(init.redirect, 'error')
  assert.equal(init.credentials, 'omit')
  assert.equal(init.cache, 'no-store')
  const odd = proxy.createApiProxy({ origin: 'http://127.0.0.1:4300', fetch: async () => ({ status: 0, headers: new Headers(), body: null }) })
  assert.equal((await odd(appRequest('GET', '/api/info'))).type, 'error')
})

// ------------------------------------------------------------------ gerçek sunucu

const real = { server: null, port: 0, root: null, origin: '', handle: null, upstream: [] }

before(async () => {
  real.root = h.makeRoot()
  real.server = await createChatServer({
    dataDir: path.join(real.root, 'veri'),
    publicDir: path.join(real.root, 'public'),
    setupCode: h.SETUP_CODE,
    scryptN: 1024,
    pollTimeoutMs: 3000,
    authLimit: 100000,
    messageLimit: 100000,
    uploadLimit: 100000,
    uploadMaxBytes: 2 * 1024 * 1024 + 16,
    log: null
  })
  real.server.on('request', (req) => real.upstream.push({ method: req.method, url: req.url, headers: req.headers }))
  real.port = await listenInRange(real.server)
  real.origin = 'http://127.0.0.1:' + real.port
  real.handle = proxy.createApiProxy({ origin: real.origin, fetch: (url, init) => fetch(url, init) })
})

after(async () => {
  if (real.server) await new Promise((resolve) => real.server.close(() => resolve()))
  h.removeRoot(real.root)
})

const session = { token: null, channelId: null, state: null }

test('kayıt, durum ve mesajlar vekil üzerinden çalışır', async () => {
  const info = await real.handle(appRequest('GET', '/api/info'))
  assert.equal(info.status, 200)
  assert.equal(info.headers.get('content-security-policy'), "default-src 'none'; sandbox; frame-ancestors 'none'")
  assert.equal((await json(info)).setupRequired, true)

  const register = await real.handle(appRequest('POST', '/api/register', { json: h.registerBody('kurucu', { setupCode: h.SETUP_CODE }) }))
  assert.equal(register.status, 200)
  session.token = (await json(register)).token
  const unauthorized = await real.handle(appRequest('GET', '/api/state'))
  assert.equal(unauthorized.status, 401)
  const state = await json(await real.handle(appRequest('GET', '/api/state', { token: session.token })))
  session.state = state
  session.channelId = state.meta.channels.find((c) => c.type === 'text').id

  const sent = await real.handle(appRequest('POST', '/api/messages', { token: session.token, json: { channelId: session.channelId, body: h.envelope() } }))
  assert.equal(sent.status, 200)
  const message = (await json(sent)).message
  const list = await json(await real.handle(appRequest('GET', '/api/messages?channel=' + session.channelId + '&limit=10', { token: session.token })))
  assert.ok(list.messages.some((m) => m.id === message.id))

  // Sunucuya giden istekte yalnızca izinli başlıklar vardır
  const last = real.upstream.filter((r) => r.url.startsWith('/api/messages?')).pop()
  assert.equal(last.headers['x-token'], session.token)
  assert.equal(last.headers.cookie, undefined)
  assert.equal(last.headers.origin, undefined)
  assert.equal(last.headers.referer, undefined)
})

test('Accept-Language ve hata yanıtları aynen döner', async () => {
  const tr = await real.handle(appRequest('POST', '/api/messages', { token: session.token, headers: { 'accept-language': 'tr' }, json: { channelId: session.channelId, body: 'x' } }))
  const en = await real.handle(appRequest('POST', '/api/messages', { token: session.token, headers: { 'accept-language': 'en' }, json: { channelId: session.channelId, body: 'x' } }))
  assert.equal(tr.status, 400)
  assert.equal(en.status, 400)
  const trBody = await json(tr)
  const enBody = await json(en)
  assert.equal(trBody.code, enBody.code)
  assert.notEqual(trBody.error, enBody.error)
  assert.equal((await real.handle(appRequest('GET', '/api/yok', { token: session.token }))).status, 404)
  const wrongMethod = await real.handle(appRequest('GET', '/api/messages/edit', { token: session.token }))
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.get('allow'), 'POST')
  const bad = await real.handle(appRequest('POST', '/api/messages', { token: session.token, json: { channelId: 999999, body: h.envelope() } }))
  assert.equal(bad.status, 404)
  // HEAD gövdesiz döner
  const head = await real.handle(appRequest('HEAD', '/api/info'))
  assert.equal(head.status, 405)
  assert.equal(head.body, null)
})

test('long-poll yanıtı vekil üzerinden bekler ve olayla döner', async () => {
  const st = session.state
  const poller = h.poller({ port: real.port }, session.token, st)
  await poller.poll()
  const url = poller.url()
  const started = Date.now()
  const pending = real.handle(appRequest('GET', url, { token: session.token }))
  await sleep(300)
  await h.sendMessage({ port: real.port }, session.token, session.channelId)
  const res = await pending
  assert.equal(res.status, 200)
  const data = await json(res)
  assert.ok(data.seq > poller.st.seq)
  assert.ok(Date.now() - started >= 250)
})

test('dosya yükleme ve indirme akış olarak geçer', async () => {
  const bytes = Buffer.alloc(700 * 1024 + 3)
  for (const i of bytes.keys()) bytes[i] = (i * 7 + 3) & 0xff
  const up = await real.handle(appRequest('POST', '/api/uploads', { token: session.token, headers: { 'content-type': 'application/octet-stream' }, bytes }))
  assert.equal(up.status, 200)
  const result = await json(up)
  assert.equal(result.size, bytes.length)
  const down = await real.handle(appRequest('GET', '/api/uploads/' + result.id, { token: session.token }))
  assert.equal(down.status, 200)
  assert.equal(down.headers.get('content-type'), 'application/octet-stream')
  assert.equal(down.headers.get('content-length'), String(bytes.length))
  assert.equal(down.headers.get('content-disposition'), 'attachment')
  const got = Buffer.from(await down.arrayBuffer())
  assert.ok(got.equals(bytes))
  // Başka bir istemcinin yüklemesi indirilemez (sunucu kararı aynen döner)
  assert.equal((await real.handle(appRequest('GET', '/api/uploads/' + result.id))).status, 401)
})

test('çok büyük yükleme sunucunun sınırıyla reddedilir, vekil sınırı ağ hatası verir', async () => {
  const big = Buffer.alloc(2 * 1024 * 1024 + 100)
  const res = await real.handle(appRequest('POST', '/api/uploads', { token: session.token, headers: { 'content-type': 'application/octet-stream' }, bytes: big }))
  assert.ok(res.status === 413 || res.type === 'error', String(res.status))
  const limited = proxy.createApiProxy({ origin: real.origin, fetch: (url, init) => fetch(url, init), maxRequestBytes: 1000 })
  const over = await limited(appRequest('POST', '/api/uploads', { token: session.token, headers: { 'content-type': 'application/octet-stream' }, bytes: Buffer.alloc(5000) }))
  assert.equal(over.type, 'error')
})

test('sayfa indirmeyi iptal ederse sunucuya giden istek kesilir', async () => {
  let closed = false
  const slowServer = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/octet-stream')
    res.write(Buffer.alloc(1024))
    const timer = setInterval(() => res.write(Buffer.alloc(1024)), 20)
    res.on('close', () => {
      clearInterval(timer)
      closed = true
    })
  })
  const port = await listenInRange(slowServer)
  try {
    const handle = proxy.createApiProxy({ origin: 'http://127.0.0.1:' + port, fetch: (url, init) => fetch(url, init) })
    const res = await handle(appRequest('GET', '/api/uploads/x'))
    const reader = res.body.getReader()
    await reader.read()
    await reader.cancel()
    const end = Date.now() + 3000
    while (!closed && Date.now() < end) await sleep(20)
    assert.equal(closed, true)
  } finally {
    slowServer.closeAllConnections()
    await new Promise((resolve) => slowServer.close(() => resolve()))
  }
})

test('yönlendirme izlenmez ve X-Token başka adrese gitmez', async () => {
  const seen = []
  const target = http.createServer((req, res) => {
    seen.push(req.headers['x-token'])
    res.end('{}')
  })
  const targetPort = await listenInRange(target)
  const redirector = http.createServer((req, res) => {
    res.statusCode = 302
    res.setHeader('location', 'http://127.0.0.1:' + targetPort + '/calinti')
    res.end()
  })
  const port = await listenInRange(redirector)
  try {
    const handle = proxy.createApiProxy({ origin: 'http://127.0.0.1:' + port, fetch: (url, init) => fetch(url, init) })
    const res = await handle(appRequest('GET', '/api/info', { token: 'gizli-token-123' }))
    assert.equal(res.type, 'error')
    assert.deepEqual(seen, [])
  } finally {
    await new Promise((resolve) => redirector.close(() => resolve()))
    await new Promise((resolve) => target.close(() => resolve()))
  }
})

test('sunucu HTML veya betik döndürse bile sayfaya ikili veri olarak geçer', async () => {
  const evil = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html')
    res.setHeader('set-cookie', 'a=b')
    res.end('<script>alert(1)</script>')
  })
  const port = await listenInRange(evil)
  try {
    const handle = proxy.createApiProxy({ origin: 'http://127.0.0.1:' + port, fetch: (url, init) => fetch(url, init) })
    const res = await handle(appRequest('GET', '/api/info'))
    assert.equal(res.headers.get('content-type'), 'application/octet-stream')
    assert.match(res.headers.get('content-security-policy'), /sandbox/)
    assert.equal(res.headers.get('set-cookie'), null)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    await res.text()
  } finally {
    await new Promise((resolve) => evil.close(() => resolve()))
  }
})
