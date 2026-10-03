'use strict'

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { once } = require('node:events')
const { createChatServer } = require('../server.js')

// Testler gerçek public klasörüne bağlı kalmasın diye geçici bir statik klasör kullanılır.
const FIXTURE = {
  'index.html': '<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Sohbet</title></head><body>deneme</body></html>',
  'app.js': "'use strict'\nconsole.log('deneme')\n",
  'style.css': 'body { color: #fff }\n',
  'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/></svg>'
}
const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sohbet-test-'))
for (const name of Object.keys(FIXTURE)) fs.writeFileSync(path.join(publicDir, name), FIXTURE[name])
process.on('exit', () => fs.rmSync(publicDir, { recursive: true, force: true }))

const FAST = { pollTimeoutMs: 300, graceMs: 200, sweepIntervalMs: 50 }
// Uzun bekleyen poll gerektiren testlerde kimse kendiliğinden çevrimdışına düşmesin.
const SLOW = { pollTimeoutMs: 5000, graceMs: 60000, sweepIntervalMs: 50 }

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

// Aynı yanıtın iki kez sonlandırılmasını veya kapanmış bağlantıya yanıt yazılmasını yakalar.
function trackResponses (server) {
  const problems = []
  server.prependListener('request', (req, res) => {
    let ends = 0
    let closedEarly = false
    res.on('close', () => {
      if (!res.writableFinished) closedEarly = true
    })
    const end = res.end
    res.end = function trackedEnd (...args) {
      ends += 1
      if (ends > 1) problems.push(`çift yanıt: ${req.method} ${req.url}`)
      if (closedEarly) problems.push(`kapanmış bağlantıya yanıt: ${req.method} ${req.url}`)
      return end.apply(this, args)
    }
  })
  return problems
}

async function startServer (options) {
  const server = createChatServer(Object.assign({ publicDir, joinLimit: 1000 }, FAST, options))
  const problems = trackResponses(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  return { server, base, problems }
}

async function stopServer (ctx) {
  ctx.server.closeAllConnections()
  await new Promise(resolve => ctx.server.close(() => resolve()))
  assert.deepEqual(ctx.problems, [])
}

// Sunucudaki istek işleyicisi çalıştıktan sonra çözülür, böylece poll'un beklemeye alındığı bilinir.
function nextRequest (server, prefix) {
  return new Promise(resolve => {
    function onRequest (req, res) {
      if (!req.url.startsWith(prefix)) return
      server.removeListener('request', onRequest)
      setImmediate(() => resolve({ req, res }))
    }
    server.on('request', onRequest)
  })
}

async function request (base, method, urlPath, options) {
  const opts = options || {}
  const headers = Object.assign({}, opts.headers)
  if (opts.token) headers['x-token'] = opts.token
  const init = { method, headers }
  if (opts.signal) init.signal = opts.signal
  if (opts.body !== undefined) init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
  const res = await fetch(base + urlPath, init)
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch (err) {
    data = null
  }
  return { status: res.status, headers: res.headers, text, data }
}

function join (base, nick, extra, headers) {
  return request(base, 'POST', '/api/join', { body: Object.assign({ nick }, extra), headers })
}

async function joinOk (base, nick, extra) {
  const result = await join(base, nick, extra)
  assert.equal(result.status, 200, result.text)
  return result.data
}

function poll (base, token, since, options) {
  return request(base, 'GET', `/api/poll?since=${since}`, Object.assign({ token }, options))
}

function send (base, token, text) {
  return request(base, 'POST', '/api/send', { token, body: { text } })
}

function leave (base, token) {
  return request(base, 'POST', '/api/leave', { token })
}

function resume (base, token, headers) {
  return request(base, 'POST', '/api/resume', { body: { token }, headers })
}

// Koşul sağlanana kadar poll eder, gelen tüm mesajları biriktirir.
async function pollUntil (base, token, since, predicate) {
  const deadline = Date.now() + 5000
  const seen = []
  let cursor = since
  while (Date.now() < deadline) {
    const result = await poll(base, token, cursor)
    assert.equal(result.status, 200, result.text)
    for (const message of result.data.messages) seen.push(message)
    cursor = result.data.lastId
    if (predicate(seen)) return { messages: seen, last: result.data }
  }
  throw new Error('Beklenen mesaj zamanında gelmedi.')
}

function hasSystem (messages, text) {
  return messages.some(message => message.type === 'system' && message.text === text)
}

function rawRequest (base, method, rawPath, options) {
  const opts = options || {}
  const target = new URL(base)
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      method,
      path: rawPath,
      headers: opts.headers || {},
      agent: opts.agent || false
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    for (const chunk of opts.chunks || []) req.write(chunk)
    req.end()
  })
}

function assertSecurityHeaders (headers) {
  assert.equal(headers.get('x-content-type-options'), 'nosniff')
  assert.equal(headers.get('referrer-policy'), 'no-referrer')
  assert.equal(headers.get('x-frame-options'), 'DENY')
}

function assertJsonHeaders (headers) {
  assert.equal(headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(headers.get('cache-control'), 'no-store')
  assertSecurityHeaders(headers)
}

describe('statik dosyalar ve güvenlik başlıkları', () => {
  let ctx
  before(async () => {
    ctx = await startServer()
  })
  after(() => stopServer(ctx))

  it('ana sayfa HTML, CSP ve güvenlik başlıklarıyla sunulur', async () => {
    for (const urlPath of ['/', '/index.html', '/?v=1']) {
      const result = await request(ctx.base, 'GET', urlPath)
      assert.equal(result.status, 200)
      assert.equal(result.text, FIXTURE['index.html'])
      assert.equal(result.headers.get('content-type'), 'text/html; charset=utf-8')
      assert.equal(result.headers.get('content-security-policy'), CSP)
      assert.equal(result.headers.get('cache-control'), 'no-cache')
      assertSecurityHeaders(result.headers)
    }
  })

  it('betik, stil ve simge doğru içerik türüyle sunulur', async () => {
    const expected = {
      '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
      '/style.css': ['style.css', 'text/css; charset=utf-8'],
      '/favicon.svg': ['favicon.svg', 'image/svg+xml']
    }
    for (const urlPath of Object.keys(expected)) {
      const result = await request(ctx.base, 'GET', urlPath)
      assert.equal(result.status, 200)
      assert.equal(result.text, FIXTURE[expected[urlPath][0]])
      assert.equal(result.headers.get('content-type'), expected[urlPath][1])
      assert.equal(result.headers.get('cache-control'), 'no-cache')
      assert.equal(result.headers.get('content-security-policy'), null)
      assertSecurityHeaders(result.headers)
    }
  })

  it('HEAD isteği gövdesiz yanıtlanır, diğer yöntemler 405 alır', async () => {
    const head = await request(ctx.base, 'HEAD', '/app.js')
    assert.equal(head.status, 200)
    assert.equal(head.text, '')
    assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(FIXTURE['app.js'])))
    const post = await request(ctx.base, 'POST', '/', { body: 'x' })
    assert.equal(post.status, 405)
    assertSecurityHeaders(post.headers)
  })

  it('beyaz liste dışındaki yollar düz metin 404 alır', async () => {
    const result = await request(ctx.base, 'GET', '/olmayan-sayfa')
    assert.equal(result.status, 404)
    assert.equal(result.headers.get('content-type'), 'text/plain; charset=utf-8')
    assertSecurityHeaders(result.headers)
  })

  it('yol geçişi denemeleri 404 alır ve dosya sızmaz', async () => {
    const attempts = [
      '/../server.js',
      '/%2e%2e/server.js',
      '/%2E%2E/%2E%2E/etc/passwd',
      '/..%2fserver.js',
      '/public/../server.js',
      '/server.js',
      '/package.json',
      '/test/server.test.js',
      '//server.js',
      '/app.js/../server.js',
      '/index.html%00.js'
    ]
    for (const attempt of attempts) {
      const result = await rawRequest(ctx.base, 'GET', attempt)
      assert.equal(result.status, 404, attempt)
      assert.ok(!result.body.includes('createChatServer'), attempt)
      assert.equal(result.headers['x-content-type-options'], 'nosniff')
    }
  })

  it('bilinmeyen API yolu 404, yanlış yöntem 405 JSON hatası döner', async () => {
    const missing = await request(ctx.base, 'GET', '/api/olmayan')
    assert.equal(missing.status, 404)
    assert.equal(missing.data.code, 'not_found')
    assert.equal(typeof missing.data.error, 'string')
    assertJsonHeaders(missing.headers)

    const wrongGet = await request(ctx.base, 'GET', '/api/join')
    assert.equal(wrongGet.status, 405)
    assert.equal(wrongGet.data.code, 'method_not_allowed')
    assertJsonHeaders(wrongGet.headers)

    const wrongPost = await request(ctx.base, 'POST', '/api/info', { body: {} })
    assert.equal(wrongPost.status, 405)
    assert.equal(wrongPost.data.code, 'method_not_allowed')
  })
})

describe('/api/info', () => {
  let ctx
  before(async () => {
    ctx = await startServer({ room: 'Test Odası' })
  })
  after(() => stopServer(ctx))

  it('oda bilgilerini döner', async () => {
    const result = await request(ctx.base, 'GET', '/api/info')
    assert.equal(result.status, 200)
    assertJsonHeaders(result.headers)
    assert.deepEqual(result.data, {
      room: 'Test Odası',
      passwordRequired: false,
      maxMessageLength: 1000,
      nickMin: 2,
      nickMax: 20
    })
  })
})

describe('takma ad doğrulama', () => {
  let ctx
  before(async () => {
    ctx = await startServer()
  })
  after(() => stopServer(ctx))

  it('geçersiz takma adlar 400 invalid_nick alır', async () => {
    const invalid = ['a', ' b ', 'x'.repeat(21), 'ab<c', 'ab:cd', 'ab/cd', 'emoji😀', '\u0007\u0007', '   ', 123, null, ['ab']]
    for (const nick of invalid) {
      const result = await join(ctx.base, nick)
      assert.equal(result.status, 400, JSON.stringify(nick))
      assert.equal(result.data.code, 'invalid_nick')
      assert.match(result.data.error, /Takma ad/)
      assertJsonHeaders(result.headers)
    }
    const missing = await request(ctx.base, 'POST', '/api/join', { body: {} })
    assert.equal(missing.status, 400)
    assert.equal(missing.data.code, 'invalid_nick')
  })

  it('kontrol karakterleri silinir, boşluklar sadeleşir', async () => {
    const control = await joinOk(ctx.base, 'Ay\u0000şe\u202E')
    assert.equal(control.nick, 'Ayşe')
    const spaces = await joinOk(ctx.base, '  Ali \t  Veli  ')
    assert.equal(spaces.nick, 'Ali Veli')
    const nfc = await joinOk(ctx.base, 'Cém')
    assert.equal(nfc.nick, 'Cém')
  })

  it('Türkçe harfler, rakam, nokta, alt çizgi ve kısa çizgi kabul edilir', async () => {
    const state = await joinOk(ctx.base, 'Çağrı_Ş.-1')
    assert.equal(state.nick, 'Çağrı_Ş.-1')
    assert.equal(typeof state.token, 'string')
    assert.ok(state.token.length >= 32)
    const last = state.messages[state.messages.length - 1]
    assert.equal(last.type, 'system')
    assert.equal(last.nick, 'Çağrı_Ş.-1')
    assert.equal(last.text, 'Çağrı_Ş.-1 sohbete katıldı')
    assert.equal(last.id, state.lastId)
    assert.equal(typeof last.ts, 'number')
  })
})

describe('şifreli oda', () => {
  let ctx
  before(async () => {
    ctx = await startServer({ password: 'gizli şifre' })
  })
  after(() => stopServer(ctx))

  it('info şifre gerektiğini bildirir', async () => {
    const result = await request(ctx.base, 'GET', '/api/info')
    assert.equal(result.data.passwordRequired, true)
  })

  it('eksik veya hatalı şifre 401 wrong_password alır', async () => {
    for (const extra of [{}, { password: 'yanlış' }, { password: 'gizli şifre ' }, { password: 42 }]) {
      const result = await join(ctx.base, 'Mehmet', extra)
      assert.equal(result.status, 401)
      assert.equal(result.data.code, 'wrong_password')
      assert.equal(result.data.error, 'Oda şifresi hatalı.')
    }
  })

  it('şifre takma addan önce denetlenir', async () => {
    const result = await join(ctx.base, 'x', { password: 'yanlış' })
    assert.equal(result.status, 401)
    assert.equal(result.data.code, 'wrong_password')
  })

  it('doğru şifreyle katılım başarılı olur', async () => {
    const state = await joinOk(ctx.base, 'Mehmet', { password: 'gizli şifre' })
    assert.equal(state.nick, 'Mehmet')
    assert.ok(state.users.includes('Mehmet'))
  })
})

describe('takma ad çakışması ve kullanıcı listesi', () => {
  let ctx
  before(async () => {
    ctx = await startServer()
  })
  after(() => stopServer(ctx))

  it('Türkçe büyük-küçük harf eşleşmesi 409 nick_taken verir', async () => {
    await joinOk(ctx.base, 'IŞIK')
    for (const nick of ['ışık', 'Işık', 'IŞIK']) {
      const result = await join(ctx.base, nick)
      assert.equal(result.status, 409, nick)
      assert.equal(result.data.code, 'nick_taken')
      assert.equal(result.data.error, 'Bu takma ad şu anda kullanımda.')
    }
    await joinOk(ctx.base, 'İlker')
    const dotted = await join(ctx.base, 'ilker')
    assert.equal(dotted.status, 409)
  })

  it('kullanıcı listesi Türkçe sıralanır', async () => {
    const names = ['Zeynep', 'Çağla', 'Ömer', 'Can', 'Deniz']
    let state = null
    for (const name of names) state = await joinOk(ctx.base, name)
    const listed = state.users.filter(user => names.includes(user))
    assert.deepEqual(listed, ['Can', 'Çağla', 'Deniz', 'Ömer', 'Zeynep'])
  })
})

describe('uzun yoklama (long-polling)', () => {
  let ctx
  before(async () => {
    ctx = await startServer(SLOW)
  })
  after(() => stopServer(ctx))

  it('bekleyen poll yeni mesajla zaman aşımından önce uyanır', async () => {
    const ayse = await joinOk(ctx.base, 'Ayşe')
    const burak = await joinOk(ctx.base, 'Burak')
    const arrived = nextRequest(ctx.server, '/api/poll')
    const started = Date.now()
    const pending = poll(ctx.base, ayse.token, burak.lastId)
    await arrived
    const sent = await send(ctx.base, burak.token, 'merhaba')
    assert.equal(sent.status, 200)
    assert.equal(sent.data.ok, true)
    const result = await pending
    assert.ok(Date.now() - started < SLOW.pollTimeoutMs)
    assert.equal(result.status, 200)
    assertJsonHeaders(result.headers)
    assert.equal(result.data.messages.length, 1)
    const message = result.data.messages[0]
    assert.equal(message.id, sent.data.id)
    assert.equal(message.type, 'chat')
    assert.equal(message.nick, 'Burak')
    assert.equal(message.text, 'merhaba')
    assert.equal(result.data.lastId, sent.data.id)
    assert.deepEqual(result.data.users, ['Ayşe', 'Burak'])
  })

  it('yeni mesaj tüm bekleyenleri kendi since değerlerine göre uyandırır', async () => {
    const cem = await joinOk(ctx.base, 'Cem')
    const derya = await joinOk(ctx.base, 'Derya')
    const first = nextRequest(ctx.server, '/api/poll')
    const cemPoll = poll(ctx.base, cem.token, derya.lastId)
    await first
    const second = nextRequest(ctx.server, '/api/poll')
    const deryaPoll = poll(ctx.base, derya.token, derya.lastId)
    await second
    const sent = await send(ctx.base, cem.token, 'herkese selam')
    const results = await Promise.all([cemPoll, deryaPoll])
    for (const result of results) {
      assert.equal(result.status, 200)
      assert.deepEqual(result.data.messages.map(message => message.id), [sent.data.id])
    }
  })

  it('bir token için en fazla iki bekleyen olur, üçüncüsü en eskisini boş yanıtla kapatır', async () => {
    const emre = await joinOk(ctx.base, 'Emre')
    const since = emre.lastId
    const started = Date.now()
    const polls = []
    while (polls.length < 3) {
      const arrived = nextRequest(ctx.server, '/api/poll')
      polls.push(poll(ctx.base, emre.token, since))
      await arrived
    }
    const oldest = await polls[0]
    assert.ok(Date.now() - started < SLOW.pollTimeoutMs)
    assert.equal(oldest.status, 200)
    assert.deepEqual(oldest.data.messages, [])
    assert.equal(oldest.data.lastId, since)
    const sent = await send(ctx.base, emre.token, 'üçüncü')
    for (const pending of polls.slice(1)) {
      const result = await pending
      assert.deepEqual(result.data.messages.map(message => message.id), [sent.data.id])
    }
  })

  it('istemci bağlantıyı kapatınca bekleyen kayıt silinir ve ona yanıt yazılmaz', async () => {
    const fatma = await joinOk(ctx.base, 'Fatma')
    const gokhan = await joinOk(ctx.base, 'Gökhan')
    const controller = new AbortController()
    const arrived = nextRequest(ctx.server, '/api/poll')
    const aborted = poll(ctx.base, fatma.token, gokhan.lastId, { signal: controller.signal }).then(() => null, err => err)
    const { res } = await arrived
    const closed = once(res, 'close')
    controller.abort()
    await closed
    const error = await aborted
    assert.ok(error instanceof Error)
    assert.equal(error.name, 'AbortError')

    const again = nextRequest(ctx.server, '/api/poll')
    const pending = poll(ctx.base, fatma.token, gokhan.lastId)
    await again
    const sent = await send(ctx.base, gokhan.token, 'hâlâ burada mısın')
    const result = await pending
    assert.deepEqual(result.data.messages.map(message => message.id), [sent.data.id])
    assert.equal(res.writableEnded, false)
    assert.deepEqual(ctx.problems, [])
  })
})

describe('boş poll zaman aşımı', () => {
  let ctx
  before(async () => {
    ctx = await startServer()
  })
  after(() => stopServer(ctx))

  it('yeni mesaj yoksa pollTimeoutMs sonunda boş liste döner', async () => {
    const hande = await joinOk(ctx.base, 'Hande')
    const started = Date.now()
    const result = await poll(ctx.base, hande.token, hande.lastId)
    const elapsed = Date.now() - started
    assert.equal(result.status, 200)
    assert.ok(elapsed >= FAST.pollTimeoutMs - 20, `geçen süre ${elapsed}`)
    assert.ok(elapsed < SLOW.pollTimeoutMs, `geçen süre ${elapsed}`)
    assert.deepEqual(result.data.messages, [])
    assert.equal(result.data.lastId, hande.lastId)
    assert.deepEqual(result.data.users, ['Hande'])
  })
})

describe('geçersiz token', () => {
  let ctx
  before(async () => {
    ctx = await startServer()
  })
  after(() => stopServer(ctx))

  it('poll, send, leave ve resume 401 invalid_token alır', async () => {
    const results = [
      await poll(ctx.base, 'yok', 0),
      await request(ctx.base, 'GET', '/api/poll?since=0'),
      await send(ctx.base, 'yok', 'merhaba'),
      await request(ctx.base, 'POST', '/api/send', { body: { text: 'merhaba' } }),
      await leave(ctx.base, 'yok'),
      await resume(ctx.base, 'yok'),
      await request(ctx.base, 'POST', '/api/resume', { body: { token: 123 } })
    ]
    for (const result of results) {
      assert.equal(result.status, 401)
      assert.equal(result.data.code, 'invalid_token')
      assert.equal(result.data.error, 'Oturum bulunamadı, lütfen yeniden katıl.')
      assertJsonHeaders(result.headers)
    }
  })
})

describe('mesaj metni', () => {
  let ctx
  before(async () => {
    ctx = await startServer({ sendLimit: 100 })
  })
  after(() => stopServer(ctx))

  async function sendAndRead (token, text) {
    const sent = await send(ctx.base, token, text)
    assert.equal(sent.status, 200, sent.text)
    const result = await poll(ctx.base, token, sent.data.id - 1)
    return result.data.messages.find(message => message.id === sent.data.id)
  }

  it('kontrol ve yön karakterleri silinir, satır sonları sadeleşir', async () => {
    const ilker = await joinOk(ctx.base, 'İlker')
    const message = await sendAndRead(ilker.token, '  a\u0000b\u0007c\u202Ed\u200Be\uFEFFf\u2066g\u007Fh\r\ni\rj\tk  ')
    assert.equal(message.text, 'abcdefgh\ni\nj\tk')
    assert.equal(message.type, 'chat')
    assert.equal(message.nick, 'İlker')
  })

  it('kod noktası olarak 1000 karaktere kadar kabul edilir', async () => {
    const jale = await joinOk(ctx.base, 'Jale')
    const plain = await sendAndRead(jale.token, 'x'.repeat(1000))
    assert.equal(plain.text.length, 1000)
    const emoji = await sendAndRead(jale.token, '😀'.repeat(1000))
    assert.equal(Array.from(emoji.text).length, 1000)
  })

  it('boş, yalnızca temizlenen karakterlerden oluşan veya fazla uzun metin 400 alır', async () => {
    const kaan = await joinOk(ctx.base, 'Kaan')
    for (const text of ['', '   \n  ', '\u200B\u0000\uFEFF', 'x'.repeat(1001), '😀'.repeat(1001), 42, null]) {
      const result = await send(ctx.base, kaan.token, text)
      assert.equal(result.status, 400, JSON.stringify(text))
      assert.equal(result.data.code, 'invalid_text')
      assert.equal(result.data.error, 'Mesaj boş olamaz ve 1000 karakteri geçemez.')
    }
  })
})

describe('gönderme hız sınırı', () => {
  let ctx
  before(async () => {
    ctx = await startServer({ sendLimit: 3, sendWindowMs: 60000 })
  })
  after(() => stopServer(ctx))

  it('sınır aşılınca 429 rate_limited döner, sayaç kişiye özeldir', async () => {
    const lale = await joinOk(ctx.base, 'Lale')
    const murat = await joinOk(ctx.base, 'Murat')
    for (const i of [1, 2, 3]) {
      const result = await send(ctx.base, lale.token, `mesaj ${i}`)
      assert.equal(result.status, 200)
    }
    const limited = await send(ctx.base, lale.token, 'bir tane daha')
    assert.equal(limited.status, 429)
    assert.equal(limited.data.code, 'rate_limited')
    assert.equal(limited.data.error, 'Çok hızlı mesaj gönderiyorsun, biraz bekle.')
    const other = await send(ctx.base, murat.token, 'ben gönderebilirim')
    assert.equal(other.status, 200)
  })
})

describe('katılma hız sınırı', () => {
  let ctx
  before(async () => {
    ctx = await startServer({ joinLimit: 3, joinWindowMs: 60000 })
  })
  after(() => stopServer(ctx))

  it('join ve resume aynı IP sayacını paylaşır', async () => {
    await joinOk(ctx.base, 'Nazlı')
    assert.equal((await resume(ctx.base, 'yok')).status, 401)
    assert.equal((await join(ctx.base, 'x')).status, 400)
    const limited = await join(ctx.base, 'Okan')
    assert.equal(limited.status, 429)
    assert.equal(limited.data.code, 'rate_limited')
    assert.equal(limited.data.error, 'Çok fazla deneme yapıldı, bir dakika sonra tekrar dene.')
    const limitedResume = await resume(ctx.base, 'yok')
    assert.equal(limitedResume.status, 429)
  })

  it('tünelden gelen farklı x-forwarded-for ve cf-connecting-ip adresleri ayrı sayılır', async () => {
    const forwarded = { 'x-forwarded-for': '203.0.113.5' }
    let attempts = 0
    while (attempts < 3) {
      assert.equal((await resume(ctx.base, 'yok', forwarded)).status, 401)
      attempts += 1
    }
    assert.equal((await resume(ctx.base, 'yok', forwarded)).status, 429)
    assert.equal((await resume(ctx.base, 'yok', { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' })).status, 429)

    const otherChain = await join(ctx.base, 'Okan', {}, { 'x-forwarded-for': ' 203.0.113.9 , 203.0.113.5' })
    assert.equal(otherChain.status, 200)
    const cloudflare = await join(ctx.base, 'Pelin', {}, { 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.5' })
    assert.equal(cloudflare.status, 200)
  })
})

describe('çevrimiçi durumu', () => {
  let ctx
  before(async () => {
    ctx = await startServer()
  })
  after(() => stopServer(ctx))

  it('poll etmeyen kişi için "ayrıldı", geri dönünce "katıldı" mesajı eklenir', async () => {
    const ayse = await joinOk(ctx.base, 'Ayşe')
    const burak = await joinOk(ctx.base, 'Burak')
    const left = await pollUntil(ctx.base, burak.token, burak.lastId, seen => hasSystem(seen, 'Ayşe sohbetten ayrıldı'))
    const leftMessage = left.messages.find(message => message.text === 'Ayşe sohbetten ayrıldı')
    assert.equal(leftMessage.nick, 'Ayşe')
    assert.ok(!left.last.users.includes('Ayşe'))
    assert.ok(left.last.users.includes('Burak'))
    assert.equal(left.messages.filter(message => message.text === 'Ayşe sohbetten ayrıldı').length, 1)

    const back = await poll(ctx.base, ayse.token, left.last.lastId)
    assert.equal(back.status, 200)
    assert.ok(hasSystem(back.data.messages, 'Ayşe sohbete katıldı'))
    assert.ok(back.data.users.includes('Ayşe'))
  })

  it('çevrimdışı kişi resume ile geri döner', async () => {
    const cem = await joinOk(ctx.base, 'Cem')
    const derya = await joinOk(ctx.base, 'Derya')
    await pollUntil(ctx.base, derya.token, derya.lastId, seen => hasSystem(seen, 'Cem sohbetten ayrıldı'))
    const state = await resume(ctx.base, cem.token)
    assert.equal(state.status, 200)
    assert.equal(state.data.token, cem.token)
    assert.equal(state.data.nick, 'Cem')
    const last = state.data.messages[state.data.messages.length - 1]
    assert.equal(last.text, 'Cem sohbete katıldı')
    assert.equal(last.id, state.data.lastId)
    assert.ok(state.data.users.includes('Cem'))
  })

  it('çevrimdışı kişinin takma adı yeniden alınabilir ve eski token geçersizleşir', async () => {
    const emre = await joinOk(ctx.base, 'Emre')
    const fatma = await joinOk(ctx.base, 'Fatma')
    const seen = await pollUntil(ctx.base, fatma.token, fatma.lastId, list => hasSystem(list, 'Emre sohbetten ayrıldı'))
    const state = await joinOk(ctx.base, 'emre')
    assert.equal(state.nick, 'emre')
    assert.notEqual(state.token, emre.token)
    assert.equal((await poll(ctx.base, emre.token, 0)).status, 401)
    const related = state.messages.filter(message => message.id > seen.last.lastId && message.nick.toLocaleLowerCase('tr-TR') === 'emre')
    assert.deepEqual(related.map(message => message.text), ['emre sohbete katıldı'])
  })
})

describe('ayrılma ve oturum sürdürme', () => {
  let ctx
  before(async () => {
    ctx = await startServer(SLOW)
  })
  after(() => stopServer(ctx))

  it('resume aynı oturumun durumunu döner', async () => {
    const gul = await joinOk(ctx.base, 'Gül')
    const state = await resume(ctx.base, gul.token)
    assert.equal(state.status, 200)
    assertJsonHeaders(state.headers)
    assert.equal(state.data.token, gul.token)
    assert.equal(state.data.nick, 'Gül')
    assert.equal(state.data.room, 'Sohbet')
    assert.equal(state.data.lastId, gul.lastId)
    assert.deepEqual(state.data.messages, gul.messages)
    assert.ok(state.data.users.includes('Gül'))
  })

  it("leave bekleyen poll'u boş yanıtla kapatır, sonra token 401 alır ve takma ad serbest kalır", async () => {
    const hakan = await joinOk(ctx.base, 'Hakan')
    const irem = await joinOk(ctx.base, 'İrem')
    const arrived = nextRequest(ctx.server, '/api/poll')
    const pending = poll(ctx.base, hakan.token, irem.lastId)
    await arrived
    const watchArrived = nextRequest(ctx.server, '/api/poll')
    const watch = poll(ctx.base, irem.token, irem.lastId)
    await watchArrived

    const left = await leave(ctx.base, hakan.token)
    assert.equal(left.status, 200)
    assert.deepEqual(left.data, { ok: true })
    assertJsonHeaders(left.headers)

    const closed = await pending
    assert.equal(closed.status, 200)
    assert.deepEqual(closed.data.messages, [])
    assert.ok(!closed.data.users.includes('Hakan'))

    const seen = await watch
    assert.equal(seen.data.messages.length, 1)
    assert.equal(seen.data.messages[0].type, 'system')
    assert.equal(seen.data.messages[0].text, 'Hakan sohbetten ayrıldı')
    assert.ok(!seen.data.users.includes('Hakan'))

    assert.equal((await poll(ctx.base, hakan.token, 0)).status, 401)
    assert.equal((await send(ctx.base, hakan.token, 'merhaba')).status, 401)
    assert.equal((await leave(ctx.base, hakan.token)).status, 401)
    assert.equal((await resume(ctx.base, hakan.token)).status, 401)
    const again = await joinOk(ctx.base, 'hakan')
    assert.equal(again.nick, 'hakan')
  })
})

describe('bozuk ve büyük istekler', () => {
  let ctx
  before(async () => {
    ctx = await startServer()
  })
  after(() => stopServer(ctx))

  it('bozuk JSON veya nesne olmayan gövde 400 bad_request alır', async () => {
    for (const body of ['{bozuk', '[1,2]', '"metin"', 'null', '42', 'true']) {
      const result = await request(ctx.base, 'POST', '/api/join', { body })
      assert.equal(result.status, 400, body)
      assert.equal(result.data.code, 'bad_request')
      assert.equal(typeof result.data.error, 'string')
      assertJsonHeaders(result.headers)
    }
  })

  it('gövde Content-Type başlığından bağımsız olarak JSON okunur', async () => {
    const result = await request(ctx.base, 'POST', '/api/join', {
      body: JSON.stringify({ nick: 'Kerem' }),
      headers: { 'content-type': 'text/plain' }
    })
    assert.equal(result.status, 200)
    assert.equal(result.data.nick, 'Kerem')
  })

  it('boş gövdeli leave isteği kabul edilir', async () => {
    const leyla = await joinOk(ctx.base, 'Leyla')
    const result = await leave(ctx.base, leyla.token)
    assert.equal(result.status, 200)
  })

  it('maxBodyBytes aşan gövde 413 too_large alır', async () => {
    const big = JSON.stringify({ nick: 'Mert', pad: 'x'.repeat(20000) })
    const result = await request(ctx.base, 'POST', '/api/join', { body: big })
    assert.equal(result.status, 413)
    assert.equal(result.data.code, 'too_large')
    assertJsonHeaders(result.headers)

    const agent = new http.Agent({ keepAlive: true })
    try {
      const chunks = Array.from({ length: 10 }, () => 'x'.repeat(2000))
      const chunked = await rawRequest(ctx.base, 'POST', '/api/send', {
        agent,
        headers: { 'transfer-encoding': 'chunked', 'content-type': 'application/json' },
        chunks
      })
      assert.equal(chunked.status, 413)
      assert.equal(JSON.parse(chunked.body).code, 'too_large')
    } finally {
      agent.destroy()
    }

    const mert = await joinOk(ctx.base, 'Mert')
    assert.equal(mert.nick, 'Mert')
  })
})

describe('geçmiş ve since', () => {
  let ctx
  before(async () => {
    ctx = await startServer(Object.assign({}, SLOW, { historyLimit: 5, sendLimit: 100 }))
  })
  after(() => stopServer(ctx))

  it('geçmiş en fazla historyLimit mesaj tutar', async () => {
    const nil = await joinOk(ctx.base, 'Nil')
    let lastSent = null
    for (const i of [1, 2, 3, 4, 5, 6, 7]) {
      const sent = await send(ctx.base, nil.token, `m${i}`)
      assert.equal(sent.status, 200)
      lastSent = sent.data.id
    }
    const result = await poll(ctx.base, nil.token, 0)
    assert.equal(result.data.messages.length, 5)
    assert.deepEqual(result.data.messages.map(message => message.text), ['m3', 'm4', 'm5', 'm6', 'm7'])
    assert.equal(result.data.lastId, lastSent)

    const onur = await joinOk(ctx.base, 'Onur')
    assert.equal(onur.messages.length, 5)
    assert.equal(onur.messages[4].text, 'Onur sohbete katıldı')
    assert.deepEqual(onur.messages.map(message => message.id), [lastSent - 3, lastSent - 2, lastSent - 1, lastSent, lastSent + 1])
  })

  it('geçersiz veya negatif since 0 sayılır', async () => {
    const pinar = await joinOk(ctx.base, 'Pınar')
    for (const since of ['-5', 'abc', '']) {
      const result = await poll(ctx.base, pinar.token, since)
      assert.equal(result.status, 200)
      assert.equal(result.data.messages.length, 5)
      assert.equal(result.data.messages[4].id, pinar.lastId)
    }
    const missing = await request(ctx.base, 'GET', '/api/poll', { token: pinar.token })
    assert.equal(missing.data.messages.length, 5)
    const partial = await poll(ctx.base, pinar.token, pinar.lastId - 2)
    assert.deepEqual(partial.data.messages.map(message => message.id), [pinar.lastId - 1, pinar.lastId])
  })

  it("lastId'den büyük since lastId'ye indirilir", async () => {
    const riza = await joinOk(ctx.base, 'Rıza')
    const arrived = nextRequest(ctx.server, '/api/poll')
    const pending = poll(ctx.base, riza.token, 999999)
    await arrived
    const sent = await send(ctx.base, riza.token, 'yetişti')
    const result = await pending
    assert.deepEqual(result.data.messages.map(message => message.id), [sent.data.id])
  })
})

describe('oda kapasitesi', () => {
  let ctx
  before(async () => {
    ctx = await startServer({ maxSessions: 2 })
  })
  after(() => stopServer(ctx))

  it('yer yoksa 503 room_full, çevrimdışı en eski oturum silinerek yer açılır', async () => {
    const selin = await joinOk(ctx.base, 'Selin')
    const tarik = await joinOk(ctx.base, 'Tarık')
    const full = await join(ctx.base, 'Umut')
    assert.equal(full.status, 503)
    assert.equal(full.data.code, 'room_full')
    assert.equal(typeof full.data.error, 'string')

    await pollUntil(ctx.base, tarik.token, tarik.lastId, seen => hasSystem(seen, 'Selin sohbetten ayrıldı'))
    const umut = await joinOk(ctx.base, 'Umut')
    assert.equal(umut.nick, 'Umut')
    assert.equal((await poll(ctx.base, selin.token, 0)).status, 401)
  })
})

describe('sunucu kapanışı', () => {
  let ctx
  before(async () => {
    ctx = await startServer(SLOW)
  })
  after(() => stopServer(ctx))

  it("close() bekleyen poll'ları boş yanıtla sonlandırır", async () => {
    const veli = await joinOk(ctx.base, 'Veli')
    const arrived = nextRequest(ctx.server, '/api/poll')
    const started = Date.now()
    const pending = poll(ctx.base, veli.token, veli.lastId)
    await arrived
    const closed = new Promise(resolve => ctx.server.close(() => resolve()))
    const result = await pending
    assert.ok(Date.now() - started < SLOW.pollTimeoutMs)
    assert.equal(result.status, 200)
    assert.deepEqual(result.data.messages, [])
    assert.equal(result.data.lastId, veli.lastId)
    ctx.server.closeAllConnections()
    await closed
    assert.equal(ctx.server.listening, false)
  })
})
