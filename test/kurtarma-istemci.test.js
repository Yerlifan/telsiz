'use strict'

// Kurtarma kodunun istemci tarafı (public/js/16-identity.js, istek 14): kayıtta kodun üretilmesi, Parolamı Unuttum
// akışı (recoverAccount aynı gizli anahtarı yeni parolayla ve yeni kodla yeniden sarar, istek gövdeleri doğru, 409
// keys_changed gelince anahtarlar yeniden istenir), Ayarlar'dan kod oluşturma ve kaldırma, parola değişikliğinde
// kodun isteğe bağlı yenilenmesi, kaydedildiği onaylanmayan kodun bayrağı ve kilitli katman (kod penceresi Esc ile
// kapanmaz). Modüller tarayıcıdaki gibi ortak bir genel ortamda Node vm bağlamında yüklenir, ağ ve parola türetme
// taklit edilir (sifre-sifirlama-istemci.test.js kalıbı).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const nodeCrypto = require('node:crypto')

const PUB = path.join(__dirname, '..', 'public')
const FILES = ['vendor/nacl-fast.min.js', 'vendor/scrypt.js', 'i18n.js', 'crypto.js', 'js/01-core.js', 'js/02-state-dom.js', 'js/03-auth.js', 'js/16-identity.js', 'js/41-kurtarma.js']
const SOURCES = FILES.map((file) => ({ file, code: fs.readFileSync(path.join(PUB, file), 'utf8') }))
const KDF = { salt: Buffer.alloc(16, 7).toString('base64url'), N: 16384, r: 8, p: 1 }

function makeStorage () {
  const map = new Map()
  return {
    map,
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
  run(`deriveKeys = function (password, kdf, onPercent) {
    const text = 'test|' + password
    const bytes = new Uint8Array(text.length)
    let i = 0
    while (i < text.length) {
      bytes[i] = text.charCodeAt(i) & 255
      i += 1
    }
    const h = window.nacl.hash(bytes)
    if (typeof onPercent === 'function') onPercent(100)
    return Promise.resolve({ authKey: Array.from(h.subarray(0, 32)).join('.'), wrapKey: h.slice(32, 64) })
  }`)
  // Yanıtlar yola göre verilir, dizi verilirse sırayla tüketilir
  sandbox.__requests = []
  sandbox.__responses = {}
  run(`__answer = function (path) {
    const r = __responses[path]
    if (Array.isArray(r)) return Promise.resolve(r.length > 1 ? r.shift() : r[0])
    return Promise.resolve(r || { status: 200, data: {} })
  }
  request = function (method, path, opts) {
    __requests.push({ path: path, body: opts && opts.body, token: opts && opts.token })
    return __answer(path)
  }
  api = function (method, path, body) {
    __requests.push({ path: path, body: body })
    return __answer(path)
  }
  afterIdentityChange = function () {}`)
  return { sandbox, run }
}

// Taklit edilen paroladan türetilen sarma anahtarı
async function wrapKeyOf (run, password) {
  return (await run('deriveKeys(' + JSON.stringify(password) + ')')).wrapKey
}

// Hesabın kimlik anahtarı ve kurtarma kodu, sunucunun /api/recover/keys yanıtı
function account (sandbox, run) {
  run('__pair = window.E2EE.identity.generate()')
  run('__code = window.E2EE.recovery.generate()')
  run('__rk = window.E2EE.recovery.derive(window.E2EE.recovery.parse(__code).secret)')
  const keys = run('({ publicKey: __pair.publicKey, wrappedKey: window.E2EE.identity.wrap(__pair.secretKey, __rk.wrapKey) })')
  return { code: run('__code'), authKey: run('__rk.authKey'), keys, publicKey: keys.publicKey, secretHex: Buffer.from(run('__pair.secretKey')).toString('hex') }
}

test('kayıt: hesapla birlikte kurtarma kodu üretilir, kod aynı gizli anahtarı açar ve sonuçta döner', async () => {
  const { sandbox, run } = load()
  sandbox.__responses['/api/register'] = { status: 200, data: { token: 't1', user: { id: 4, name: 'ece' }, device: 'a'.repeat(24) + '.' + 'b'.repeat(43) } }
  const result = await run("registerAccount('ece', 'Parolam-2026', 'inviteCode', 'ABCDE-FGHJK')")
  assert.equal(result.ok, true)
  assert.match(result.recoveryCode, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/)
  const sent = sandbox.__requests.filter((r) => r.path === '/api/register')[0].body
  assert.deepEqual(Object.keys(sent.recovery).sort(), ['authKey', 'wrappedKey'])
  sandbox.__codeText = result.recoveryCode
  run('__rk = window.E2EE.recovery.derive(window.E2EE.recovery.parse(__codeText).secret)')
  assert.equal(sent.recovery.authKey, run('__rk.authKey'))
  sandbox.__wrapped = sent.recovery.wrappedKey
  sandbox.__pk = sent.publicKey
  const viaCode = run('window.E2EE.identity.unwrap(__wrapped, __rk.wrapKey, __pk)')
  assert.ok(viaCode, 'kurtarma kodu kimlik anahtarını açar')
  sandbox.__key = await wrapKeyOf(run, 'Parolam-2026')
  sandbox.__wrapped2 = sent.wrappedKey
  const viaPassword = run('window.E2EE.identity.unwrap(__wrapped2, __key, __pk)')
  assert.equal(Buffer.from(viaCode).toString('hex'), Buffer.from(viaPassword).toString('hex'), 'aynı gizli anahtar')
  // Kodun authKey'i parolanınkinden farklıdır
  assert.notEqual(sent.recovery.authKey, sent.authKey)
  // Kod sunucuda kaydedildi, kişi onaylayana kadar onaylanmamış sayılır (oluşturma zamanı henüz bilinmiyor)
  assert.deepEqual(JSON.parse(sandbox.localStorage.getItem('telsiz.recoveryUnsaved')), { 'u:4': 0 })
})

test('recoverAccount aynı gizli anahtarı yeni parolayla ve yeni kodla yeniden sarar, istek gövdeleri doğru', async () => {
  const { sandbox, run } = load()
  const acc = account(sandbox, run)
  run("rememberLoginDevice('ece', '" + 'c'.repeat(24) + '.' + 'd'.repeat(43) + "')")
  sandbox.__responses['/api/recover/keys'] = { status: 200, data: acc.keys }
  sandbox.__responses['/api/recover'] = { status: 200, data: { token: 't2', user: { id: 4, name: 'ece', role: 'member' }, keys: acc.keys, device: 'e'.repeat(24) + '.' + 'f'.repeat(43), recovery: { createdAt: 5, label: null } } }
  const percents = []
  sandbox.__onPercent = (p) => percents.push(p)
  const result = await run('recoverAccount(\'ece\', ' + JSON.stringify(acc.code.toLowerCase().replace(/-/g, ' ')) + ", 'YeniParolam-2026', __onPercent)")
  assert.equal(result.ok, true)
  assert.equal(result.token, 't2')
  assert.deepEqual(sandbox.__requests.map((r) => r.path), ['/api/recover/keys', '/api/recover'])
  const keysBody = JSON.parse(JSON.stringify(sandbox.__requests[0].body))
  assert.deepEqual(keysBody, { name: 'ece', recoveryAuthKey: acc.authKey, device: 'c'.repeat(24) + '.' + 'd'.repeat(43) })
  assert.equal(sandbox.__requests[0].token, '')
  const body = sandbox.__requests[1].body
  assert.deepEqual(Object.keys(body).sort(), ['device', 'kdf', 'name', 'newAuthKey', 'publicKey', 'recovery', 'recoveryAuthKey', 'wrappedKey'])
  assert.equal(body.recoveryAuthKey, acc.authKey)
  assert.equal(body.publicKey, acc.publicKey)
  assert.equal(body.kdf.N, 65536)
  assert.equal(body.newAuthKey, (await run("deriveKeys('YeniParolam-2026')")).authKey)
  assert.ok(percents.includes(100))
  // Yeni parolanın sarma anahtarı aynı gizli anahtarı açar
  sandbox.__key = await wrapKeyOf(run, 'YeniParolam-2026')
  sandbox.__w = body.wrappedKey
  sandbox.__pk = acc.publicKey
  assert.equal(Buffer.from(run('window.E2EE.identity.unwrap(__w, __key, __pk)')).toString('hex'), acc.secretHex)
  // Yeni kod sonuçta döner, eskisinden farklıdır, kurulumu yeni koddan türetilir ve aynı gizli anahtarı sarar
  assert.notEqual(result.code, acc.code)
  sandbox.__newCode = result.code
  run('__nk = window.E2EE.recovery.derive(window.E2EE.recovery.parse(__newCode).secret)')
  assert.equal(body.recovery.authKey, run('__nk.authKey'))
  sandbox.__rw = body.recovery.wrappedKey
  assert.equal(Buffer.from(run('window.E2EE.identity.unwrap(__rw, __nk.wrapKey, __pk)')).toString('hex'), acc.secretHex)
  assert.equal(run('window.E2EE.identity.unwrap(__rw, __rk.wrapKey, __pk)'), null, 'eski kod yeni kaydı açamaz')
  // Kimlik ve yeni giriş cihazı işareti bu cihazda saklanır
  assert.equal(run('identityState.pairUser'), '4')
  assert.equal(Buffer.from(run('identityState.pair.secretKey')).toString('hex'), acc.secretHex)
  assert.equal(run("loginDeviceOf('ece')"), 'e'.repeat(24) + '.' + 'f'.repeat(43))
  // Yeni kod onaylanana kadar onaylanmamış sayılır, bayrak sunucudaki oluşturma zamanını taşır
  assert.deepEqual(JSON.parse(sandbox.localStorage.getItem('telsiz.recoveryUnsaved')), { 'u:4': 5 })
})

test('409 keys_changed gelince anahtarlar yeniden istenir ve güncel anahtarla yeniden denenir', async () => {
  const { sandbox, run } = load()
  const old = account(sandbox, run)
  // Başka bir cihaz bu arada kodla yeni kaydı kurmuş: ikinci yanıt aynı kodla açılan güncel kayıt
  run('__pair = window.E2EE.identity.generate()')
  const fresh = run('({ publicKey: __pair.publicKey, wrappedKey: window.E2EE.identity.wrap(__pair.secretKey, __rk.wrapKey) })')
  sandbox.__responses['/api/recover/keys'] = [{ status: 200, data: old.keys }, { status: 200, data: fresh }]
  sandbox.__responses['/api/recover'] = [
    { status: 409, data: { code: 'keys_changed', error: 'x' } },
    { status: 200, data: { token: 't3', user: { id: 4, name: 'ece' }, keys: fresh, device: '' } }
  ]
  const result = await run('recoverAccount(\'ece\', ' + JSON.stringify(old.code) + ", 'YeniParolam-2026')")
  assert.equal(result.ok, true)
  assert.deepEqual(sandbox.__requests.map((r) => r.path), ['/api/recover/keys', '/api/recover', '/api/recover/keys', '/api/recover'])
  assert.equal(sandbox.__requests[1].body.publicKey, old.publicKey)
  assert.equal(sandbox.__requests[3].body.publicKey, fresh.publicKey)
  // Parola bir kez türetilir, iki istekte aynı ayar kullanılır
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.__requests[3].body.kdf)), JSON.parse(JSON.stringify(sandbox.__requests[1].body.kdf)))
})

test('ikinci kez keys_changed veya yanlış kod: hata metni, istek sayısı sınırlı', async () => {
  const { sandbox, run } = load()
  const acc = account(sandbox, run)
  sandbox.__responses['/api/recover/keys'] = { status: 200, data: acc.keys }
  sandbox.__responses['/api/recover'] = { status: 409, data: { code: 'keys_changed', error: 'x' } }
  const twice = await run('recoverAccount(\'ece\', ' + JSON.stringify(acc.code) + ", 'YeniParolam-2026')")
  assert.equal(twice.ok, false)
  assert.equal(sandbox.__requests.length, 4)
  assert.equal(twice.error(), 'Hesabın anahtarları değişti, yeniden deneyin.')
  sandbox.__requests.length = 0
  sandbox.__responses['/api/recover/keys'] = { status: 401, data: { code: 'bad_recovery', error: 'server' } }
  const wrong = await run('recoverAccount(\'ece\', ' + JSON.stringify(acc.code) + ", 'YeniParolam-2026')")
  assert.equal(wrong.ok, false)
  assert.equal(wrong.field, 'code')
  assert.equal(wrong.error(), 'Kullanıcı adı veya kurtarma kodu hatalı.')
  assert.deepEqual(sandbox.__requests.map((r) => r.path), ['/api/recover/keys'], 'yanlış kodda yeni parola gönderilmez')
  // Sunucunun verdiği kayıt kodla açılmıyorsa (bozuk veya sahte kayıt) yeni parola gönderilmez
  sandbox.__requests.length = 0
  run('__other = window.E2EE.identity.generate()')
  sandbox.__responses['/api/recover/keys'] = { status: 200, data: { publicKey: run('__other.publicKey'), wrappedKey: acc.keys.wrappedKey } }
  const forged = await run('recoverAccount(\'ece\', ' + JSON.stringify(acc.code) + ", 'YeniParolam-2026')")
  assert.equal(forged.ok, false)
  assert.deepEqual(sandbox.__requests.map((r) => r.path), ['/api/recover/keys'])
})

test('kod biçimi istemcide denetlenir: grup anahtarı kodu ve hatalı kodlar istek göndermez', async () => {
  const { sandbox, run } = load()
  const group = run('window.E2EE.generateKeyCode()')
  const cases = [
    [group, 'Bu bir frekans anahtarı, kurtarma kodu değil.'],
    ['', 'Kurtarma kodunu yazın.'],
    ['ABCD', 'Kod 28 karakter olmalı.'],
    ['U'.repeat(28), 'Kodda geçersiz karakter var.']
  ]
  for (const [code, text] of cases) {
    const result = await run('recoverAccount(\'ece\', ' + JSON.stringify(code) + ", 'YeniParolam-2026')")
    assert.equal(result.ok, false)
    assert.equal(result.field, 'code')
    assert.equal(result.error(), text)
  }
  assert.equal(sandbox.__requests.length, 0)
  run("window.I18N.setLang('en')")
  const en = await run('recoverAccount(\'ece\', ' + JSON.stringify(group) + ", 'x')")
  assert.equal(en.error(), 'This is a frequency key, not a recovery code.')
})

test('Ayarlar: kod parolayla oluşturulur ve kaldırılır, sunucu bilgisi güncellenir', async () => {
  const { sandbox, run } = load()
  sandbox.__responses['/api/prelogin'] = { status: 200, data: { kdf: KDF } }
  run("state.me = { id: 4, name: 'ece' }")
  run('__pair = window.E2EE.identity.generate()')
  sandbox.__key = await wrapKeyOf(run, 'Parolam-2026')
  const keys = run('({ publicKey: __pair.publicKey, wrappedKey: window.E2EE.identity.wrap(__pair.secretKey, __key) })')
  sandbox.__keys = keys
  run('setServerKeys(__keys, false, null)')
  assert.equal(run('identityState.recoveryKnown'), true)
  assert.equal(run('identityState.recovery'), null)
  sandbox.__responses['/api/me/recovery'] = { status: 200, data: { ok: true, recovery: { createdAt: 1700000000000, label: 'Chrome, Linux' } } }
  // Bu cihazda kimlik yok: parolayla açılır ve saklanır
  const created = await run("recoveryChangeRequest('Parolam-2026', true)")
  assert.equal(created.ok, true)
  const sent = sandbox.__requests.filter((r) => r.path === '/api/me/recovery')[0].body
  assert.equal(sent.authKey, (await run("deriveKeys('Parolam-2026')")).authKey)
  sandbox.__c = created.code
  run('__ck = window.E2EE.recovery.derive(window.E2EE.recovery.parse(__c).secret)')
  assert.equal(sent.recovery.authKey, run('__ck.authKey'))
  sandbox.__rw = sent.recovery.wrappedKey
  assert.equal(Buffer.from(run('window.E2EE.identity.unwrap(__rw, __ck.wrapKey, __pair.publicKey)')).toString('hex'), Buffer.from(run('__pair.secretKey')).toString('hex'))
  assert.deepEqual(JSON.parse(JSON.stringify(run('identityState.recovery'))), { createdAt: 1700000000000, label: 'Chrome, Linux' })
  assert.ok(run('hasIdentity()'), 'açılan kimlik bu cihazda saklandı')
  assert.equal(run('recoveryUnsavedOf(4)'), 1700000000000)
  assert.equal(run('recoveryUnsaved()'), true)
  // Kaldırma
  sandbox.__responses['/api/me/recovery'] = { status: 200, data: { ok: true, recovery: null } }
  const removed = await run("recoveryChangeRequest('Parolam-2026', false)")
  assert.equal(removed.ok, true)
  assert.equal(removed.code, null)
  const last = sandbox.__requests.filter((r) => r.path === '/api/me/recovery').pop().body
  assert.equal(last.recovery, null)
  assert.equal(run('identityState.recovery'), null)
  assert.equal(run('recoveryUnsavedOf(4)'), null, 'kaldırılan kodun bayrağı silindi')
  // Yanlış parola: sunucu 401, metin parola hatası
  sandbox.__responses['/api/me/recovery'] = { status: 401, data: { code: 'bad_credentials', error: 'x' } }
  const wrong = await run("recoveryChangeRequest('Yanlis-1', false)")
  assert.equal(wrong.ok, false)
  assert.equal(wrong.error(), 'Parola hatalı.')
  // Sunucu keys_changed derse anahtar bilgisi yeniden yüklenir
  sandbox.__responses['/api/me/recovery'] = { status: 409, data: { code: 'keys_changed', error: 'x' } }
  sandbox.__responses['/api/state'] = { status: 200, data: { keys: keys, recovery: { createdAt: 9, label: null } } }
  const changed = await run("recoveryChangeRequest('Parolam-2026', true)")
  assert.equal(changed.ok, false)
  assert.equal(sandbox.__requests[sandbox.__requests.length - 1].path, '/api/state')
  assert.equal(run('identityState.recovery.createdAt'), 9)
})

test('parola değişikliği: kod istenirse aynı istekle yenilenir, istenmezse gönderilmez', async () => {
  const { sandbox, run } = load()
  sandbox.__responses['/api/prelogin'] = { status: 200, data: { kdf: KDF } }
  run("state.me = { id: 4, name: 'ece' }")
  run('__pair = window.E2EE.identity.generate()')
  sandbox.__key = await wrapKeyOf(run, 'Parolam-2026')
  const keys = run('({ publicKey: __pair.publicKey, wrappedKey: window.E2EE.identity.wrap(__pair.secretKey, __key) })')
  sandbox.__responses['/api/state'] = { status: 200, data: { keys: keys, recovery: { createdAt: 3, label: null } } }
  sandbox.__responses['/api/me/password'] = { status: 200, data: { ok: true, device: '', recovery: { createdAt: 3, label: null } } }
  const plain = await run("changePasswordRequest('Parolam-2026', 'YeniParolam-2026')")
  assert.equal(plain.ok, true)
  assert.equal(plain.recoveryCode, undefined)
  assert.equal(run('recoveryUnsavedOf(4)'), null, 'kod yenilenmeyince bayrak yazılmaz')
  const first = sandbox.__requests.filter((r) => r.path === '/api/me/password')[0].body
  assert.equal('recovery' in first, false)
  sandbox.__responses['/api/me/password'] = { status: 200, data: { ok: true, device: '', recovery: { createdAt: 7, label: 'Firefox, Linux' } } }
  const renewed = await run("changePasswordRequest('Parolam-2026', 'BaskaParola-2027', null, { renewRecovery: true })")
  assert.equal(renewed.ok, true)
  const second = sandbox.__requests.filter((r) => r.path === '/api/me/password')[1].body
  sandbox.__c = renewed.recoveryCode
  run('__ck = window.E2EE.recovery.derive(window.E2EE.recovery.parse(__c).secret)')
  assert.equal(second.recovery.authKey, run('__ck.authKey'))
  sandbox.__rw = second.recovery.wrappedKey
  assert.ok(run('window.E2EE.identity.unwrap(__rw, __ck.wrapKey, __pair.publicKey)'), 'yeni kod aynı kimliği açar')
  assert.equal(run('identityState.recovery.createdAt'), 7)
  assert.equal(run('recoveryUnsavedOf(4)'), 7)
})

test('sıfırlamadan sonra yeni anahtar çifti kurulurken kurtarma kodu da yeni çifti sarar', async () => {
  const { sandbox, run } = load()
  sandbox.__responses['/api/prelogin'] = { status: 200, data: { kdf: KDF } }
  run("state.me = { id: 4, name: 'ece' }")
  sandbox.__responses['/api/state'] = { status: 200, data: { keys: { publicKey: null, wrappedKey: null }, resetPending: true, recovery: null } }
  sandbox.__responses['/api/me/password'] = { status: 200, data: { ok: true, device: '', recovery: { createdAt: 1, label: null } } }
  const result = await run("changePasswordRequest('GeciciParola12', 'YeniParolam-2026', null, { renewRecovery: true })")
  assert.equal(result.ok, true)
  assert.equal(result.keysReset, true)
  const body = sandbox.__requests.filter((r) => r.path === '/api/me/password')[0].body
  sandbox.__c = result.recoveryCode
  sandbox.__rw = body.recovery.wrappedKey
  sandbox.__pk = body.publicKey
  run('__ck = window.E2EE.recovery.derive(window.E2EE.recovery.parse(__c).secret)')
  const viaCode = run('window.E2EE.identity.unwrap(__rw, __ck.wrapKey, __pk)')
  assert.ok(viaCode)
  assert.equal(Buffer.from(viaCode).toString('hex'), Buffer.from(run('identityState.pair.secretKey')).toString('hex'))
})

test('hatırlatma bayrağı kişi başına bir kez yazılır, kod metni dosyası sunucu ve kişi bilgisini taşır', () => {
  const { sandbox, run } = load()
  assert.equal(run('recoveryReminded(4)'), false)
  run('markRecoveryReminded(4)')
  assert.equal(run('recoveryReminded(4)'), true)
  assert.equal(run('recoveryReminded(5)'), false)
  assert.deepEqual(JSON.parse(sandbox.localStorage.getItem('telsiz.recoveryReminded')), { 'u:4': 1 })
  run("state.serverName = 'Kankalar'")
  assert.equal(run('recoveryServerText()'), 'Kankalar (https://kankalar.ornek.com)')
  assert.equal(run("forgotOwnerCommand('ece')"), 'node server.js sifre-sifirla ece')
  assert.equal(run("forgotOwnerCommand('')"), 'node server.js sifre-sifirla <kullanıcı adı>')
  run("window.I18N.setLang('en')")
  assert.equal(run("forgotOwnerCommand('Geçersiz Ad')"), 'node server.js sifre-sifirla <username>')
})

test('onaylanmayan kod: bayrak sunucudaki kodla eşleşir, onayla, kaldırmayla veya başka cihazdaki yeni kodla biter', () => {
  const { sandbox, run } = load()
  const flags = () => JSON.parse(sandbox.localStorage.getItem('telsiz.recoveryUnsaved') || 'null')
  run("state.me = { id: 4, name: 'ece' }")
  // Sunucu bilgisi gelmeden karar verilmez
  run('recoveryIssued(4, null)')
  assert.equal(run('recoveryUnsaved()'), false)
  assert.deepEqual(flags(), { 'u:4': 0 })
  // Oluşturma zamanı bilinmeden yazılan bayrak sunucudaki kodu benimser, durum satırı uyarıyı da gösterir
  run("setServerKeys(null, false, { createdAt: 1700, label: 'Chrome, Linux' })")
  assert.equal(run('recoveryUnsaved()'), true)
  assert.deepEqual(flags(), { 'u:4': 1700 })
  assert.match(run('recoveryStatusText()'), /oluşturuldu\. Bu kodu kaydettiğinizi onaylamadınız\. Kodu bir yere yazmadıysanız yeni kod oluşturun\.$/)
  assert.match(run('recoverySignature()'), /\|1$/)
  // Başka bir kişinin bayrağı bu kişiyi etkilemez
  run('recoveryIssued(9, 50)')
  assert.deepEqual(flags(), { 'u:4': 1700, 'u:9': 50 })
  // Kod başka bir cihazda yeniden oluşturuldu: bayrak bu kişi için silinir
  run('setServerRecovery({ createdAt: 1800, label: null })')
  assert.equal(run('recoveryUnsaved()'), false)
  assert.deepEqual(flags(), { 'u:9': 50 })
  assert.match(run('recoveryStatusText()'), /oluşturuldu\.$/)
  // Bu cihazda yeni kod, Devam ile onay
  run('recoveryIssued(4, 1900)')
  run('setServerRecovery({ createdAt: 1900, label: null })')
  assert.equal(run('recoveryUnsaved()'), true)
  run('recoveryConfirmed(4)')
  assert.equal(run('recoveryUnsaved()'), false)
  assert.deepEqual(flags(), { 'u:9': 50 })
  // Kod sunucuda yok (kaldırıldı veya sahip sıfırladı): uyarı yok
  run('recoveryIssued(4, 2000)')
  run('setServerRecovery(null)')
  assert.equal(run('recoveryUnsaved()'), false)
  assert.equal(run('recoverySignature().slice(-2)'), '|0')
  // Bu sekmenin sunucu bilgisi eski (kod başka bir sekmede verildi): bayrak korunur, bilgi gelince uyarı çıkar
  run('setServerRecovery({ createdAt: 1900, label: null })')
  assert.equal(run('recoveryUnsaved()'), false)
  assert.equal(run('recoveryUnsavedOf(4)'), 2000)
  run('setServerRecovery({ createdAt: 2000, label: null })')
  assert.equal(run('recoveryUnsaved()'), true)
  // Son bayrak gidince depolama anahtarı da silinir
  run('recoveryConfirmed(4)')
  run('recoveryConfirmed(9)')
  assert.equal(sandbox.localStorage.getItem('telsiz.recoveryUnsaved'), null)
  run("window.I18N.setLang('en')")
  run('recoveryIssued(4, 2100)')
  run('setServerRecovery({ createdAt: 2100, label: null })')
  assert.match(run('recoveryStatusText()'), /You didn't confirm that you saved this code\. If you didn't write it down, create a new code\.$/)
})

test('kilitli katman (kod penceresi) Esc, oyun kolu ve kapat yollarıyla kapanmaz, program kapatınca kapanır', () => {
  const { sandbox, run } = load()
  run("__closed = 0; __layer = { name: 'kilitli', el: {}, level: 3, focus: false, locked: true, onClose: function () { __closed += 1 } }; openLayer(__layer)")
  // Esc ve kişinin kapatma yolları (odağı geri vererek kapatma) yok sayılır, Esc başka işleyiciye de geçmez
  sandbox.__esc = { key: 'Escape', defaultPrevented: false, preventDefault () { this.defaultPrevented = true } }
  run('onLayerKeydown(__esc)')
  assert.equal(sandbox.__esc.defaultPrevented, true)
  run('closeLayer(__layer, true)')
  run('closeLayer(__layer)')
  assert.equal(run('findLayer("kilitli") === __layer'), true)
  assert.equal(run('__closed'), 0)
  // Kendi düğmesi kilidi açınca kapanır
  run('__layer.locked = false; closeLayer(__layer, true)')
  assert.equal(run('findLayer("kilitli")'), null)
  assert.equal(run('__closed'), 1)
  // Program odağı geri vermeden kapatınca (oturum kapanması) kilide bakılmaz
  run("__layer2 = { name: 'kilitli2', el: {}, level: 3, focus: false, locked: true, onClose: function () { __closed += 1 } }; openLayer(__layer2)")
  run('closeAllLayers()')
  assert.equal(run('findLayer("kilitli2")'), null)
  assert.equal(run('__closed'), 2)
})
