'use strict'

// Parola sıfırlamasından sonra istemci (public/js/16-identity.js): geçici parolayla girişte yeni kimlik anahtarı
// üretilip geçici parolayla sarılmaz (/api/me/keys çağrılmaz). Yeni anahtar çifti parola değişikliğiyle birlikte
// üretilir ve yalnızca yeni parolanın sarma anahtarıyla sarılır, geçici parolayı bilen onu açamaz. Modüller
// tarayıcıdaki gibi ortak bir genel ortamda Node vm bağlamında yüklenir, ağ ve parola türetme taklit edilir.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const nodeCrypto = require('node:crypto')

const PUB = path.join(__dirname, '..', 'public')
const FILES = ['vendor/nacl-fast.min.js', 'vendor/scrypt.js', 'i18n.js', 'crypto.js', 'js/01-core.js', 'js/02-state-dom.js', 'js/03-auth.js', 'js/16-identity.js']
const SOURCES = FILES.map((file) => ({ file, code: fs.readFileSync(path.join(PUB, file), 'utf8') }))
const KDF = { salt: Buffer.alloc(16, 7).toString('base64url'), N: 16384, r: 8, p: 1 }

function makeStorage () {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v))
    },
    removeItem: (k) => {
      map.delete(k)
    }
  }
}

function load () {
  const sandbox = vm.createContext({})
  sandbox.self = sandbox
  sandbox.window = sandbox
  sandbox.setTimeout = setTimeout
  sandbox.clearTimeout = clearTimeout
  sandbox.crypto = nodeCrypto.webcrypto
  sandbox.TextEncoder = TextEncoder
  sandbox.TextDecoder = TextDecoder
  sandbox.localStorage = makeStorage()
  sandbox.sessionStorage = makeStorage()
  sandbox.navigator = { languages: ['tr-TR'], language: 'tr-TR', userAgent: 'node' }
  sandbox.document = { documentElement: { lang: 'tr' }, readyState: 'loading', hidden: false, title: 'Telsiz', addEventListener () {} }
  sandbox.location = { origin: 'https://kankalar.ornek.com', hash: '', pathname: '/', search: '' }
  sandbox.history = { replaceState () {} }
  sandbox.console = { warn () {}, log () {}, error () {} }
  for (const src of SOURCES) vm.runInContext(src.code, sandbox, { filename: src.file })
  const run = (code) => vm.runInContext(code, sandbox)
  // Parola türetme taklidi: parolaya bağlı, belirlenimci authKey ve wrapKey (scrypt'in yavaşlığı olmadan)
  run(`deriveKeys = function (password, kdf) {
    const text = 'test|' + password
    const bytes = new Uint8Array(text.length)
    let i = 0
    while (i < text.length) {
      bytes[i] = text.charCodeAt(i) & 255
      i += 1
    }
    const h = window.nacl.hash(bytes)
    return Promise.resolve({ authKey: Array.from(h.subarray(0, 32)).join('.'), wrapKey: h.slice(32, 64) })
  }`)
  sandbox.__requests = []
  sandbox.__responses = {}
  run(`request = function (method, path, opts) {
    __requests.push({ path: path, body: opts && opts.body })
    return Promise.resolve(__responses[path] || { status: 200, data: {} })
  }
  api = function (method, path, body) {
    __requests.push({ path: path, body: body })
    return Promise.resolve(__responses[path] || { status: 200, data: {} })
  }
  afterIdentityChange = function () {}`)
  return { sandbox, run }
}

test('geçici parolayla girişte yeni anahtar üretilmez ve geçici parolayla sarılıp yüklenmez', async () => {
  const { sandbox, run } = load()
  sandbox.__responses['/api/prelogin'] = { status: 200, data: { kdf: KDF } }
  sandbox.__responses['/api/login'] = { status: 200, data: { token: 't1', user: { id: 4, name: 'ece' }, keys: { publicKey: null, wrappedKey: null }, resetPending: true } }
  const result = await run("loginWithPassword('ece', 'GeciciParola12')")
  assert.equal(result.ok, true)
  assert.equal(result.keysReset, false)
  assert.deepEqual(sandbox.__requests.map((r) => r.path), ['/api/prelogin', '/api/login'], 'POST /api/me/keys yok')
})

test('sıfırlamadan sonra parola değişikliği yeni anahtar çiftini yalnızca yeni parolayla sarar', async () => {
  const { sandbox, run } = load()
  sandbox.__responses['/api/prelogin'] = { status: 200, data: { kdf: KDF } }
  run("state.me = { id: 4, name: 'ece' }")
  run('setServerKeys({ publicKey: null, wrappedKey: null }, true)')
  const result = await run("changePasswordRequest('GeciciParola12', 'YeniParolam-2026')")
  assert.equal(result.ok, true)
  assert.equal(result.keysReset, true)
  const sent = sandbox.__requests.filter((r) => r.path === '/api/me/password')
  assert.equal(sent.length, 1)
  const body = sent[0].body
  assert.equal(typeof body.publicKey, 'string')
  assert.equal(typeof body.wrappedKey, 'string')
  assert.equal(sandbox.__requests.some((r) => r.path === '/api/me/keys'), false)
  const wrapKeyOf = async (password) => (await run('deriveKeys(' + JSON.stringify(password) + ')')).wrapKey
  sandbox.__wrapped = body.wrappedKey
  sandbox.__pk = body.publicKey
  sandbox.__newKey = await wrapKeyOf('YeniParolam-2026')
  sandbox.__tempKey = await wrapKeyOf('GeciciParola12')
  assert.ok(run('window.E2EE.identity.unwrap(__wrapped, __newKey, __pk)'), 'yeni parola açar')
  assert.equal(run('window.E2EE.identity.unwrap(__wrapped, __tempKey, __pk)'), null, 'geçici parola açamaz')
  assert.equal(run('identityState.resetPending'), false)
  assert.equal(run('identityState.keys.publicKey'), body.publicKey)
})

test('eski durumdaki ikinci sekme sunucudaki anahtarları yeniden yükler, yeni çift üretmez, mevcut çifti yeniden sarar', async () => {
  const { sandbox, run } = load()
  sandbox.__responses['/api/prelogin'] = { status: 200, data: { kdf: KDF } }
  run("state.me = { id: 4, name: 'ece' }")
  // Bu sekme sıfırlama sonrası anahtarsız durumu görür, ilk sekme ise çifti yeni parolayla kurmuştur
  run('setServerKeys({ publicKey: null, wrappedKey: null }, true)')
  sandbox.__firstKey = (await run("deriveKeys('YeniParolam-2026')")).wrapKey
  run('__pair = window.E2EE.identity.generate()')
  const serverKeys = run('({ publicKey: __pair.publicKey, wrappedKey: window.E2EE.identity.wrap(__pair.secretKey, __firstKey) })')
  sandbox.__responses['/api/state'] = { status: 200, data: { keys: serverKeys } }
  const result = await run("changePasswordRequest('YeniParolam-2026', 'BaskaParola-2027')")
  assert.equal(result.ok, true)
  assert.equal(result.keysReset, undefined)
  const sent = sandbox.__requests.filter((r) => r.path === '/api/me/password')
  assert.equal(sent.length, 1)
  assert.equal('publicKey' in sent[0].body, false, 'yeni açık anahtar gönderilmez')
  sandbox.__wrapped = sent[0].body.wrappedKey
  sandbox.__newKey = (await run("deriveKeys('BaskaParola-2027')")).wrapKey
  const opened = run('window.E2EE.identity.unwrap(__wrapped, __newKey, __pair.publicKey)')
  assert.ok(opened, 'yeni parola hesabın mevcut özel anahtarını açar')
  assert.equal(run('identityState.keys.publicKey'), serverKeys.publicKey)
  assert.equal(run('identityState.resetPending'), false)
})

test('sunucu bad_keys dönerse anahtar durumu yeniden yüklenir', async () => {
  const { sandbox, run } = load()
  sandbox.__responses['/api/prelogin'] = { status: 200, data: { kdf: KDF } }
  run("state.me = { id: 4, name: 'ece' }")
  sandbox.__responses['/api/state'] = { status: 200, data: { keys: { publicKey: null, wrappedKey: null }, resetPending: true } }
  // İstek yolda iken başka bir sekme çifti kurar: sunucu reddeder, sonraki durum yüklemesi çifti gösterir
  const later = run('({ publicKey: window.E2EE.identity.generate().publicKey, wrappedKey: null })')
  sandbox.__later = later
  sandbox.__responses['/api/me/password'] = { status: 400, data: { code: 'bad_keys' } }
  run(`api = (function (inner) {
    return function (method, path, body) {
      const res = inner(method, path, body)
      if (path === '/api/me/password') __responses['/api/state'] = { status: 200, data: { keys: __later } }
      return res
    }
  })(api)`)
  const result = await run("changePasswordRequest('GeciciParola12', 'YeniParolam-2026')")
  assert.equal(result.ok, false)
  assert.equal(sandbox.__requests.filter((r) => r.path === '/api/state').length, 2)
  assert.equal(run('identityState.keys.publicKey'), later.publicKey)
  assert.equal(run('identityState.resetPending'), false)
})

test('parola değişikliğinden sonra sunucunun verdiği yeni giriş cihazı işareti saklanır ve sonraki girişte gönderilir', async () => {
  const { sandbox, run } = load()
  const oldDevice = 'a'.repeat(24) + '.' + 'B'.repeat(43)
  const newDevice = 'c'.repeat(24) + '.' + 'D'.repeat(43)
  sandbox.__responses['/api/prelogin'] = { status: 200, data: { kdf: KDF } }
  run("state.me = { id: 4, name: 'ece' }")
  run('rememberLoginDevice(' + JSON.stringify('ece') + ', ' + JSON.stringify(oldDevice) + ')')
  run('setServerKeys({ publicKey: null, wrappedKey: null }, true)')
  sandbox.__responses['/api/me/password'] = { status: 200, data: { ok: true, device: newDevice } }
  const result = await run("changePasswordRequest('GeciciParola12', 'YeniParolam-2026')")
  assert.equal(result.ok, true)
  assert.equal(run("loginDeviceOf('ece')"), newDevice)
  sandbox.__responses['/api/login'] = { status: 401, data: { code: 'bad_credentials' } }
  await run("loginWithPassword('ece', 'YeniParolam-2026')")
  const sent = sandbox.__requests.filter((r) => r.path === '/api/login')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].body.device, newDevice)
})
