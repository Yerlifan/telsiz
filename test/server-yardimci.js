'use strict'

// Sunucu testlerinin ortak yardımcıları. Bu dosya bir test dosyası değildir (adı .test.js ile bitmez).
// Her sunucu os.tmpdir() altında geçici bir kök klasörde çalışır:
//   <kök>/public   statik dosyalar (gerçek public klasörüne bağımlılık olmasın diye)
//   <kök>/veri     veri klasörü
//   <kök>/server.js  yol geçişi denemelerinin hedefi, asla sunulmamalı

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { createChatServer } = require('../src/app')

const SETUP_CODE = 'ABCDE-FGHJK'
const PASSWORD = 'parola-123'
const SECRET_TEXT = 'GIZLI-ICERIK-SUNULMAMALI'

// İstemci ve sunucu testlerinin birlikte kullandığı ortak türetme test vektörü
const VECTOR = {
  password: 'Parola-\u00d6rnek 1',
  saltHex: '000102030405060708090a0b0c0d0e0f',
  saltB64url: 'AAECAwQFBgcICQoLDA0ODw',
  N: 16384,
  master: '85a938adac85194b58a6154560b1349e3109149f45a5bc687f04a3d84ff1dbf6',
  authKey: 'ddfe2a33db778dcc5ab649cabff09f25e8b1a4aa32d62d4b36ac75e591245595',
  wrapKey: 'fdb8d3c6f1cf1ab6e1fdecef82533767ee48e009c6f4a870b35241e002cf5dc9'
}

// Testlerde kayıt olan hesapların istemci tarafı türetme ayarları (sunucunun kabul ettiği en düşük N)
const KDF = Object.freeze({ salt: VECTOR.saltB64url, N: 16384, r: 8, p: 1 })

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
// woff2 dosyalarının ilk baytları ('wOF2')
const WOFF2_BYTES = Buffer.from('774f4632000100000000', 'hex')

const FIXTURE = {
  'index.html': '<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Telsiz</title></head><body>deneme</body></html>\n',
  // Arayüz modülleri js/ altına taşındı, kökteki app.js artık beyaz listede değil ve sunulmamalı
  'app.js': SECRET_TEXT,
  'crypto.js': "'use strict'\n",
  'emoji.js': "'use strict'\nwindow.EMOJI_DATA = []\n",
  'voice.js': "'use strict'\n",
  'sw.js': "'use strict'\n",
  'style.css': 'body { color: #fff }\n',
  'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>\n',
  'icons/icon-192.png': PNG_BYTES,
  'icons/icon-512.png': PNG_BYTES,
  'icons/apple-touch-icon.png': PNG_BYTES,
  'vendor/nacl-fast.min.js': '// nacl\n',
  'vendor/TWEETNACL-LICENSE.txt': 'Unlicense\n',
  'vendor/scrypt.js': '// scrypt\n',
  'vendor/SCRYPT-JS-LICENSE.txt': 'MIT\n',
  'i18n.js': "'use strict'\n",
  'theme-init.js': "'use strict'\n",
  'js/ayarlar.js': "'use strict'\n",
  'js/ses-paneli-2.js': "'use strict'\n",
  'css/tokens.css': ':root{}\n',
  'css/skins/arcade.css': ':root{}\n',
  'css/gizli.txt': SECRET_TEXT,
  'css/skins/alt/ic.css': SECRET_TEXT,
  'js/gizli.txt': SECRET_TEXT,
  'js/alt/ic.js': SECRET_TEXT,
  'fonts/inter-latin-ext.woff2': WOFF2_BYTES,
  'fonts/OFL.txt': 'SIL Open Font License\n',
  'fonts/Lisans-2.txt': 'Lisans\n',
  'fonts/gizli.js': SECRET_TEXT,
  'gizli.txt': SECRET_TEXT
}

// Testlerin çoğu hız sınırlarına takılmasın diye sınırlar yüksek tutulur, gereken testler düşürür.
const TEST_DEFAULTS = {
  scryptN: 1024,
  setupCode: SETUP_CODE,
  pollTimeoutMs: 3000,
  graceMs: 3000,
  sweepIntervalMs: 25,
  iceServers: [{ urls: 'stun:stun.example.org:3478' }],
  authLimit: 100000,
  loginFailLimit: 100000,
  messageLimit: 100000,
  uploadLimit: 100000,
  adminLimit: 100000,
  signalLimit: 100000,
  friendRequestLimit: 100000
}

// İstemci türetmesinin testlerdeki bağımsız Node uygulaması
function deriveKeys (password, saltB64url, n) {
  const master = crypto.scryptSync(Buffer.from(password.normalize('NFC'), 'utf8'), Buffer.from(saltB64url, 'base64url'), 32, {
    N: n || 16384,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024
  })
  const domain = (label) => crypto.createHash('sha512').update(Buffer.from(label, 'utf8')).update(master).digest().subarray(0, 32).toString('hex')
  return { master: master.toString('hex'), authKey: domain('telsiz-auth-v1'), wrapKey: domain('telsiz-wrap-v1') }
}

const derived = new Map()
function authKeyFor (password, saltB64url, n) {
  const salt = saltB64url || KDF.salt
  const key = [password, salt, n || 16384].join('|')
  if (!derived.has(key)) derived.set(key, deriveKeys(password, salt, n).authKey)
  return derived.get(key)
}

function b64urlRandom (bytes) {
  return crypto.randomBytes(bytes).toString('base64url')
}

// Sunucunun kabul ettiği biçimde rastgele açık anahtar ve sarılmış özel anahtar
function keyPair () {
  return { publicKey: b64urlRandom(32), wrappedKey: '1w.' + b64urlRandom(24) + '.' + b64urlRandom(48) }
}

// Kayıt gövdesi: kullanıcı adı, authKey, türetme ayarları ve anahtarlar
function registerBody (name, opts) {
  const o = opts || {}
  const keys = keyPair()
  const body = {
    name,
    authKey: authKeyFor(o.password || PASSWORD),
    kdf: KDF,
    publicKey: keys.publicKey,
    wrappedKey: keys.wrappedKey
  }
  if (o.setupCode !== undefined) body.setupCode = o.setupCode
  if (o.inviteCode !== undefined) body.inviteCode = o.inviteCode
  return Object.assign(body, o.extra || {})
}

function makeRoot () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-test-'))
  const publicDir = path.join(root, 'public')
  for (const name of Object.keys(FIXTURE)) {
    const file = path.join(publicDir, ...name.split('/'))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, FIXTURE[name])
  }
  fs.writeFileSync(path.join(root, 'server.js'), SECRET_TEXT)
  return root
}

function removeRoot (root) {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
}

// Aynı yanıtın iki kez sonlandırılmasını veya kapanmış bağlantıya yanıt yazılmasını yakalar.
function trackResponses (server) {
  const problems = []
  server.prependListener('request', (req, res) => {
    let ends = 0
    const end = res.end
    res.end = function trackedEnd (...args) {
      ends += 1
      if (ends > 1) problems.push('çift yanıt: ' + req.method + ' ' + req.url)
      return end.apply(this, args)
    }
  })
  return problems
}

function makeLog () {
  const lines = { info: [], warn: [], error: [] }
  return {
    lines,
    info: (text) => lines.info.push(String(text)),
    warn: (text) => lines.warn.push(String(text)),
    error: (text) => lines.error.push(String(text))
  }
}

function listen (server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(server.address().port)
    })
  })
}

function closeServer (server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
}

// Sunucu başlatır. options: createChatServer seçenekleri (testin varsayılanlarının üzerine yazılır).
async function startServer (options, root) {
  const dir = root || makeRoot()
  const log = makeLog()
  const config = Object.assign({
    dataDir: path.join(dir, 'veri'),
    publicDir: path.join(dir, 'public'),
    log
  }, TEST_DEFAULTS, options || {})
  const server = await createChatServer(config)
  const problems = trackResponses(server)
  const port = await listen(server)
  const ctx = {
    server,
    root: dir,
    dataDir: config.dataDir,
    config,
    port,
    log,
    problems,
    allowErrors: false,
    async stop () {
      await closeServer(server)
      assert.deepEqual(problems, [])
      if (!ctx.allowErrors) assert.deepEqual(log.lines.error, [])
    },
    async cleanup () {
      try {
        await ctx.stop()
      } finally {
        removeRoot(dir)
      }
    },
    // Aynı veri klasörüyle yeniden başlatır (önceki sunucu kapatılır)
    async restart (more) {
      await ctx.stop()
      return startServer(Object.assign({}, options || {}, more || {}), dir)
    }
  }
  return ctx
}

function parseJson (text) {
  try {
    return JSON.parse(text)
  } catch (err) {
    return null
  }
}

// Ham HTTP isteği (yol olduğu gibi gönderilir, normalleştirilmez). Her istek yeni bağlantı kullanır.
function request (ctx, method, urlPath, opts) {
  const o = opts || {}
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, o.headers)
    if (o.token) headers['x-token'] = o.token
    let payload = null
    if (o.raw !== undefined) payload = Buffer.isBuffer(o.raw) ? o.raw : Buffer.from(o.raw)
    else if (o.body !== undefined) payload = Buffer.from(typeof o.body === 'string' ? o.body : JSON.stringify(o.body), 'utf8')
    if (payload && headers['content-length'] === undefined) headers['content-length'] = String(payload.length)
    const req = http.request({ host: '127.0.0.1', port: ctx.port, method, path: urlPath, headers, agent: false }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const buffer = Buffer.concat(chunks)
        const text = buffer.toString('utf8')
        resolve({ status: res.statusCode, headers: res.headers, buffer, text, data: parseJson(text) })
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    if (o.onRequest) o.onRequest(req)
    if (payload) req.end(payload)
    else req.end()
  })
}

function get (ctx, urlPath, token) {
  return request(ctx, 'GET', urlPath, { token })
}

function post (ctx, urlPath, token, body) {
  return request(ctx, 'POST', urlPath, { token, body: body === undefined ? {} : body })
}

function expectStatus (res, status, code) {
  assert.equal(res.status, status, res.text)
  if (code !== undefined) assert.equal(res.data && res.data.code, code, res.text)
}

async function setupOwner (ctx, name) {
  const res = await post(ctx, '/api/register', null, registerBody(name || 'sahip', { setupCode: SETUP_CODE }))
  expectStatus(res, 200)
  return res.data
}

async function stateOf (ctx, token) {
  const res = await get(ctx, '/api/state', token)
  expectStatus(res, 200)
  return res.data
}

async function inviteCodeOf (ctx, staffToken) {
  const st = await stateOf(ctx, staffToken)
  assert.equal(typeof st.inviteCode, 'string')
  return st.inviteCode
}

async function addUser (ctx, ownerToken, name, password) {
  const inviteCode = await inviteCodeOf(ctx, ownerToken)
  const res = await post(ctx, '/api/register', null, registerBody(name, { password, inviteCode }))
  expectStatus(res, 200)
  return res.data
}

// İstemcinin giriş akışı: ön giriş, paroladan authKey türetme, giriş
async function login (ctx, name, password, headers) {
  const pre = await request(ctx, 'POST', '/api/prelogin', { headers, body: { name } })
  expectStatus(pre, 200)
  const kdf = pre.data.kdf
  const authKey = authKeyFor(password || PASSWORD, kdf.salt, kdf.N)
  return request(ctx, 'POST', '/api/login', { headers, body: { name, authKey } })
}

async function makeAdmin (ctx, ownerToken, userId) {
  expectStatus(await post(ctx, '/api/users/role', ownerToken, { userId, role: 'admin' }), 200)
}

function b64url (bytes) {
  return crypto.randomBytes(bytes).toString('base64url')
}

// Sunucunun kabul ettiği biçimde rastgele bir E2EE zarfı (içerik sunucu için opaktır)
function envelope (extra) {
  return '1.' + crypto.randomBytes(8).toString('hex') + '.' + b64url(24) + '.' + b64url(18 + (extra || 0))
}

// Özel mesaj zarfı: '2.' + nonce + '.' + kutu
function dmEnvelope (extra) {
  return '2.' + b64url(24) + '.' + b64url(18 + (extra || 0))
}

async function sendMessage (ctx, token, channelId, opts) {
  const o = opts || {}
  const res = await post(ctx, '/api/messages', token, Object.assign({ channelId, body: o.body || envelope() }, o.uploads ? { uploads: o.uploads } : {}))
  expectStatus(res, 200)
  return res.data.message
}

async function upload (ctx, token, bytes) {
  return request(ctx, 'POST', '/api/uploads', {
    token,
    raw: bytes,
    headers: { 'content-type': 'application/octet-stream' }
  })
}

// 0..n-1 dizisi (noktalı virgülsüz döngüler için)
function times (n) {
  return Array.from({ length: n }, (_, i) => i)
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Koşul sağlanana kadar bekler (sabit beklemeler yerine)
async function waitFor (check, opts) {
  const o = opts || {}
  const timeout = o.timeout || 5000
  const interval = o.interval || 10
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    last = await check()
    if (last) return last
    await sleep(interval)
  }
  throw new Error('Koşul ' + timeout + ' ms içinde sağlanmadı: ' + (o.label || ''))
}

// Bir oturumun poll durumunu izleyen istemci (yazıyor bilgisini de tv ile izler)
function poller (ctx, token, initial) {
  const st = { boot: initial.boot, seq: initial.seq, mv: initial.metaVersion, pmv: initial.pmv, tv: initial.tv, sig: initial.sigSeq, typing: initial.typing }
  return {
    st,
    url () {
      return '/api/poll?since=' + st.seq + '&mv=' + st.mv + '&pmv=' + st.pmv + '&tv=' + st.tv + '&sig=' + st.sig + '&boot=' + st.boot
    },
    apply (data) {
      st.boot = data.boot
      st.seq = data.seq
      if (data.meta) st.mv = data.metaVersion
      if (data.private) st.pmv = data.pmv
      if (data.typing) {
        st.tv = data.tv
        st.typing = data.typing
      }
      for (const s of data.signals || []) {
        if (s.seq > st.sig) st.sig = s.seq
      }
    },
    async poll () {
      const res = await get(ctx, this.url(), token)
      if (res.status === 200 && res.data) this.apply(res.data)
      return res
    }
  }
}

// İstek işleyicisi çalıştıktan sonra çözülür (ör. poll'un beklemeye alındığı bilinsin diye)
function nextRequest (server, prefix) {
  return new Promise((resolve) => {
    function onRequest (req) {
      if (!req.url.startsWith(prefix)) return
      server.removeListener('request', onRequest)
      setImmediate(() => resolve())
    }
    server.on('request', onRequest)
  })
}

module.exports = {
  SETUP_CODE,
  PASSWORD,
  SECRET_TEXT,
  VECTOR,
  KDF,
  deriveKeys,
  authKeyFor,
  keyPair,
  registerBody,
  dmEnvelope,
  makeRoot,
  removeRoot,
  startServer,
  request,
  get,
  post,
  expectStatus,
  setupOwner,
  stateOf,
  inviteCodeOf,
  addUser,
  login,
  makeAdmin,
  envelope,
  sendMessage,
  upload,
  times,
  sleep,
  waitFor,
  poller,
  nextRequest
}
