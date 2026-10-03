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

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

const FIXTURE = {
  'index.html': '<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Telsiz</title></head><body>deneme</body></html>\n',
  'app.js': "'use strict'\n",
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
  signalLimit: 100000
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
  const res = await post(ctx, '/api/register', null, { name: name || 'Sahip', password: PASSWORD, setupCode: SETUP_CODE })
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
  const res = await post(ctx, '/api/register', null, { name, password: password || PASSWORD, inviteCode })
  expectStatus(res, 200)
  return res.data
}

async function login (ctx, name, password) {
  return post(ctx, '/api/login', null, { name, password: password || PASSWORD })
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

// Bir oturumun poll durumunu izleyen istemci
function poller (ctx, token, initial) {
  const st = { boot: initial.boot, seq: initial.seq, mv: initial.metaVersion, sig: initial.sigSeq }
  return {
    st,
    url () {
      return '/api/poll?since=' + st.seq + '&mv=' + st.mv + '&sig=' + st.sig + '&boot=' + st.boot
    },
    apply (data) {
      st.boot = data.boot
      st.seq = data.seq
      if (data.meta) st.mv = data.metaVersion
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
