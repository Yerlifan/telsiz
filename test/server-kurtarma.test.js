'use strict'

// Kurtarma kodu (istek 14): kayıtta ve Ayarlar'da kod kurulumu, /api/me/recovery (karma beklerken kod veya parola
// değişirse await sonrası yeniden denetimler), oturumsuz /api/recover/keys ve /api/recover uçları, aynı yanıt ve
// aynı maliyetle ad taraması koruması, ayrı hız sınırı sayaçları, kurtarmadan sonra kimlik anahtarının korunması,
// sıfırlama, hesap silme ve normalleştirmede kaydın silinmesi.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const h = require('./server-yardimci')
const auth = require('../src/auth')

const { PASSWORD, KDF } = h

// İstemcinin kurtarma türetmesinin bağımsız Node karşılığı (public/crypto.js recovery.derive)
function recoveryAuthKey (secret) {
  return crypto.createHash('sha512').update(Buffer.from('telsiz-recovery-v1/auth', 'utf8')).update(secret).digest().subarray(0, 32).toString('hex')
}

// Rastgele kurtarma kodu: sır, sunucuya giden kurulum ({ authKey, wrappedKey }) ve doğrulama anahtarı
function newCode () {
  const secret = crypto.randomBytes(16)
  const authKey = recoveryAuthKey(secret)
  return { authKey, setup: { authKey, wrappedKey: h.keyPair().wrappedKey } }
}

function readState (ctx) {
  return JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'state.json'), 'utf8'))
}

async function diskUser (ctx, id) {
  await ctx.server.flush()
  return readState(ctx).users.find((u) => u.id === id)
}

// Davetle kayıt, isteğe bağlı kurtarma koduyla
async function addUserWithCode (ctx, ownerToken, name, code, headers) {
  const inviteCode = await h.inviteCodeOf(ctx, ownerToken)
  const body = h.registerBody(name, { inviteCode, extra: code ? { recovery: code.setup } : {} })
  const res = await h.request(ctx, 'POST', '/api/register', { headers, body })
  h.expectStatus(res, 200)
  return Object.assign(res.data, { keys: { publicKey: body.publicKey, wrappedKey: body.wrappedKey } })
}

function recoverKeys (ctx, name, key, headers, extra) {
  return h.request(ctx, 'POST', '/api/recover/keys', { headers, body: Object.assign({ name, recoveryAuthKey: key }, extra || {}) })
}

// Kurtarma gövdesi: yeni parola (yeni tuz), aynı açık anahtar, yeniden sarılmış özel anahtar ve yeni kod
function recoverBody (name, key, publicKey, newPassword, extra) {
  const kdf = { salt: crypto.randomBytes(16).toString('base64url'), N: 16384, r: 8, p: 1 }
  const next = newCode()
  const body = Object.assign({
    name,
    recoveryAuthKey: key,
    publicKey,
    newAuthKey: h.deriveKeys(newPassword, kdf.salt, kdf.N).authKey,
    kdf,
    wrappedKey: h.keyPair().wrappedKey,
    recovery: next.setup
  }, extra || {})
  return { body, next, kdf }
}

function recover (ctx, body, headers) {
  return h.request(ctx, 'POST', '/api/recover', { headers, body })
}

// auth.hashPassword çağrılarını test serbest bırakana kadar bekletir. Sunucu aynı süreçte çalışır ve işlevi her
// çağrıda auth nesnesinden okur, böylece await sonrası yeniden denetimler zamanlamaya bağlı olmadan sınanır.
// passThrough() sonrasındaki çağrılar beklemeden çalışır, restore() özgün işlevi geri koyar ve bekleyenleri bırakır.
function holdHashes () {
  const original = auth.hashPassword
  const held = []
  let holding = true
  auth.hashPassword = function (...args) {
    if (!holding) return original.apply(auth, args)
    return new Promise((resolve, reject) => {
      const entry = { done: false }
      entry.run = () => {
        if (entry.done) return
        entry.done = true
        original.apply(auth, args).then(resolve, reject)
      }
      held.push(entry)
    })
  }
  return {
    waitHeld: (count) => h.waitFor(() => held.length >= count, { label: count + ' karma bekliyor' }),
    release: (i) => held[i].run(),
    passThrough () {
      holding = false
    },
    restore () {
      holding = false
      auth.hashPassword = original
      for (const entry of held) entry.run()
    }
  }
}

describe('kurtarma kodu kaydı', () => {
  it('kayıtta saklanır, karma ve sarılmış anahtar hiçbir yanıtta dönmez, yeniden başlatmada kalır', async () => {
    let ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const code = newCode()
      const ua = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' }
      const ayse = await addUserWithCode(ctx, owner.token, 'ayse', code, ua)
      const st = await h.stateOf(ctx, ayse.token)
      assert.deepEqual(Object.keys(st.recovery).sort(), ['createdAt', 'label'])
      assert.equal(st.recovery.label, 'Chrome, Windows')
      assert.ok(Math.abs(st.recovery.createdAt - Date.now()) < 60000)
      assert.equal((await h.stateOf(ctx, owner.token)).recovery, null)
      const disk = await diskUser(ctx, ayse.user.id)
      assert.deepEqual(Object.keys(disk.recovery).sort(), ['createdAt', 'hash', 'label', 'v', 'wrappedKey'])
      assert.equal(disk.recovery.v, 1)
      assert.equal(disk.recovery.wrappedKey, code.setup.wrappedKey)
      assert.match(disk.recovery.hash, /^scrypt\$1024\$8\$1\$/)
      assert.equal(await auth.verifyPassword(code.authKey, disk.recovery.hash), true)
      assert.ok(auth.isRecoveryRecord(disk.recovery))
      // Kodun authKey'i ve sarılmış anahtarı başkalarına giden hiçbir yanıtta yok
      const texts = [
        (await h.get(ctx, '/api/state', owner.token)).text,
        (await h.get(ctx, '/api/state', ayse.token)).text,
        (await h.get(ctx, '/api/profiles?ids=' + ayse.user.id, owner.token)).text,
        (await h.login(ctx, 'ayse')).text
      ]
      for (const text of texts) {
        assert.ok(!text.includes(code.setup.wrappedKey))
        assert.ok(!text.includes(disk.recovery.hash))
        assert.ok(!text.includes(code.authKey))
      }
      assert.ok(!fs.readFileSync(path.join(ctx.dataDir, 'state.json'), 'utf8').includes(code.authKey))
      ctx = await ctx.restart()
      assert.deepEqual((await h.stateOf(ctx, ayse.token)).recovery, st.recovery)
      h.expectStatus(await recoverKeys(ctx, 'ayse', code.authKey), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('kayıtta biçimi bozuk kurtarma kurulumu 400 bad_keys, verilmezse kod yok', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const inviteCode = await h.inviteCodeOf(ctx, owner.token)
      const bad = [
        {},
        'kod',
        [newCode().setup],
        { authKey: 'f'.repeat(63), wrappedKey: h.keyPair().wrappedKey },
        { authKey: 'F'.repeat(64), wrappedKey: h.keyPair().wrappedKey },
        { authKey: 'f'.repeat(64), wrappedKey: '1w.kisa.kisa' },
        { authKey: 'f'.repeat(64) }
      ]
      for (const recovery of bad) {
        h.expectStatus(await h.post(ctx, '/api/register', null, h.registerBody('ayse', { inviteCode, extra: { recovery } })), 400, 'bad_keys')
      }
      const plain = await addUserWithCode(ctx, owner.token, 'ayse', null)
      assert.equal((await h.stateOf(ctx, plain.token)).recovery, null)
      const withNull = await h.post(ctx, '/api/register', null, h.registerBody('veli', { inviteCode, extra: { recovery: null } }))
      h.expectStatus(withNull, 200)
      assert.equal((await h.stateOf(ctx, withNull.data.token)).recovery, null)
      h.expectStatus(await recoverKeys(ctx, 'veli', newCode().authKey), 401, 'bad_recovery')
    } finally {
      await ctx.cleanup()
    }
  })

  it('normalleştirme: alanı olmayan eski kayıt null olur, bozuk kayıt ve anahtarsız hesabın kaydı silinir', async () => {
    let ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const a = await addUserWithCode(ctx, owner.token, 'ayse', newCode())
      const b = await addUserWithCode(ctx, owner.token, 'veli', newCode())
      const c = await addUserWithCode(ctx, owner.token, 'can', newCode())
      await ctx.stop()
      const file = path.join(ctx.dataDir, 'state.json')
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      const byId = (id) => data.users.find((u) => u.id === id)
      delete byId(owner.user.id).recovery
      byId(a.user.id).recovery.v = 2
      byId(b.user.id).recovery.extra = true
      byId(c.user.id).publicKey = null
      byId(c.user.id).wrappedKey = null
      fs.writeFileSync(file, JSON.stringify(data))
      ctx = await h.startServer({}, ctx.root)
      for (const user of [a, b, c]) {
        h.expectStatus(await recoverKeys(ctx, user.user.name, newCode().authKey), 401, 'bad_recovery')
        assert.equal((await diskUser(ctx, user.user.id)).recovery, null)
      }
      assert.equal((await h.stateOf(ctx, owner.token)).recovery, null)
      // isRecoveryRecord kuralları
      const good = (await diskUser(ctx, owner.user.id)).passHash
      const rec = { v: 1, hash: good, wrappedKey: h.keyPair().wrappedKey, createdAt: 5, label: null }
      assert.equal(auth.isRecoveryRecord(rec), true)
      assert.equal(auth.isRecoveryRecord(Object.assign({}, rec, { label: 'Firefox, Linux' })), true)
      for (const broken of [
        null, 'kayit', [], Object.assign({}, rec, { v: '1' }), Object.assign({}, rec, { hash: 'scrypt$x' }),
        Object.assign({}, rec, { wrappedKey: 'x' }), Object.assign({}, rec, { createdAt: -1 }), Object.assign({}, rec, { createdAt: '5' }),
        Object.assign({}, rec, { label: '' }), Object.assign({}, rec, { label: 'a\nb' }), Object.assign({}, rec, { label: 'x'.repeat(61) })
      ]) {
        assert.equal(auth.isRecoveryRecord(broken), false, JSON.stringify(broken))
      }
      const partial = Object.assign({}, rec)
      delete partial.label
      assert.equal(auth.isRecoveryRecord(partial), false)
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('POST /api/me/recovery', () => {
  it('parolayla oluşturur, yeniler ve kaldırır, eski kod geçmez', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const authKey = h.authKeyFor(PASSWORD)
      assert.equal((await h.stateOf(ctx, owner.token)).recovery, null)
      const first = newCode()
      const created = await h.post(ctx, '/api/me/recovery', owner.token, { authKey, recovery: first.setup })
      h.expectStatus(created, 200)
      assert.deepEqual(Object.keys(created.data.recovery).sort(), ['createdAt', 'label'])
      assert.deepEqual((await h.stateOf(ctx, owner.token)).recovery, created.data.recovery)
      const keys = await recoverKeys(ctx, 'sahip', first.authKey)
      h.expectStatus(keys, 200)
      assert.deepEqual(keys.data, { publicKey: (await h.stateOf(ctx, owner.token)).keys.publicKey, wrappedKey: first.setup.wrappedKey })
      // Yenileme: eski kod geçersiz
      const second = newCode()
      h.expectStatus(await h.post(ctx, '/api/me/recovery', owner.token, { authKey, recovery: second.setup }), 200)
      h.expectStatus(await recoverKeys(ctx, 'sahip', first.authKey), 401, 'bad_recovery')
      h.expectStatus(await recoverKeys(ctx, 'sahip', second.authKey), 200)
      // Kaldırma
      const removed = await h.post(ctx, '/api/me/recovery', owner.token, { authKey, recovery: null })
      h.expectStatus(removed, 200)
      assert.equal(removed.data.recovery, null)
      assert.equal((await h.stateOf(ctx, owner.token)).recovery, null)
      h.expectStatus(await recoverKeys(ctx, 'sahip', second.authKey), 401, 'bad_recovery')
      assert.equal((await diskUser(ctx, owner.user.id)).recovery, null)
      // Gövde denetimi
      h.expectStatus(await h.post(ctx, '/api/me/recovery', owner.token, { authKey }), 400, 'bad_request')
      h.expectStatus(await h.post(ctx, '/api/me/recovery', owner.token, { authKey, recovery: { authKey: 'x' } }), 400, 'bad_keys')
      h.expectStatus(await h.post(ctx, '/api/me/recovery', null, { authKey, recovery: null }), 401, 'invalid_token')
    } finally {
      await ctx.cleanup()
    }
  })

  it('hatalı parola 401 ve hesap işlemleri sayacı, sınır dolunca 429', async () => {
    const ctx = await h.startServer({ loginFailLimit: 3 })
    try {
      const owner = await h.setupOwner(ctx)
      const wrong = h.authKeyFor('yanlis-parola')
      for (const i of h.times(3)) {
        h.expectStatus(await h.post(ctx, '/api/me/recovery', owner.token, { authKey: wrong, recovery: newCode().setup }), 401, 'bad_credentials')
      }
      h.expectStatus(await h.post(ctx, '/api/me/recovery', owner.token, { authKey: h.authKeyFor(PASSWORD), recovery: newCode().setup }), 429, 'rate_limited')
      // Aynı sayaç parola değiştirmeyi de durdurur (hesap işlemleri 'p:' sayacı)
      h.expectStatus(await h.post(ctx, '/api/me/password', owner.token, { oldAuthKey: h.authKeyFor(PASSWORD), newAuthKey: h.authKeyFor('yeni-parola-1'), kdf: KDF, wrappedKey: h.keyPair().wrappedKey }), 429, 'rate_limited')
      assert.equal((await h.stateOf(ctx, owner.token)).recovery, null)
    } finally {
      await ctx.cleanup()
    }
  })

  it('parola sıfırlanmış hesapta 409 password_change_required, anahtarsız hesapta 409 no_keys', async () => {
    let ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const member = await addUserWithCode(ctx, owner.token, 'ayse', newCode())
      const res = await h.post(ctx, '/api/users/reset-password', owner.token, { userId: member.user.id })
      h.expectStatus(res, 200)
      const pre = await h.post(ctx, '/api/prelogin', null, { name: 'ayse' })
      const temp = h.deriveKeys(res.data.tempPassword, pre.data.kdf.salt, pre.data.kdf.N).authKey
      const relog = await h.post(ctx, '/api/login', null, { name: 'ayse', authKey: temp })
      h.expectStatus(relog, 200)
      h.expectStatus(await h.post(ctx, '/api/me/recovery', relog.data.token, { authKey: temp, recovery: newCode().setup }), 409, 'password_change_required')
      // Sıfırlanmamış ama anahtarı olmayan eski kayıt
      const veli = await addUserWithCode(ctx, owner.token, 'veli', null)
      await ctx.stop()
      const file = path.join(ctx.dataDir, 'state.json')
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      const rec = data.users.find((u) => u.id === veli.user.id)
      rec.publicKey = null
      rec.wrappedKey = null
      fs.writeFileSync(file, JSON.stringify(data))
      ctx = await h.startServer({}, ctx.root)
      h.expectStatus(await h.post(ctx, '/api/me/recovery', veli.token, { authKey: h.authKeyFor(PASSWORD), recovery: newCode().setup }), 409, 'no_keys')
    } finally {
      await ctx.cleanup()
    }
  })

  it('parola değişince kod geçerli kalır, istenirse yeni parolayla birlikte yenilenir', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const member = await addUserWithCode(ctx, owner.token, 'ayse', newCode())
      const code = newCode()
      h.expectStatus(await h.post(ctx, '/api/me/recovery', member.token, { authKey: h.authKeyFor(PASSWORD), recovery: code.setup }), 200)
      const change = { oldAuthKey: h.authKeyFor(PASSWORD), newAuthKey: h.authKeyFor('yeni-parola-1'), kdf: KDF, wrappedKey: h.keyPair().wrappedKey }
      const plain = await h.post(ctx, '/api/me/password', member.token, change)
      h.expectStatus(plain, 200)
      assert.notEqual(plain.data.recovery, null)
      h.expectStatus(await recoverKeys(ctx, 'ayse', code.authKey), 200)
      // Yeni kodla birlikte değişiklik: eski kod geçmez
      const next = newCode()
      const renew = { oldAuthKey: h.authKeyFor('yeni-parola-1'), newAuthKey: h.authKeyFor('yeni-parola-2'), kdf: KDF, wrappedKey: h.keyPair().wrappedKey }
      h.expectStatus(await h.post(ctx, '/api/me/password', member.token, Object.assign({ recovery: { authKey: 'x' } }, renew)), 400, 'bad_keys')
      const renewed = await h.post(ctx, '/api/me/password', member.token, Object.assign({ recovery: next.setup }, renew))
      h.expectStatus(renewed, 200)
      assert.deepEqual(Object.keys(renewed.data.recovery).sort(), ['createdAt', 'label'])
      h.expectStatus(await recoverKeys(ctx, 'ayse', code.authKey), 401, 'bad_recovery')
      const keys = await recoverKeys(ctx, 'ayse', next.authKey)
      h.expectStatus(keys, 200)
      assert.equal(keys.data.wrappedKey, next.setup.wrappedKey)
    } finally {
      await ctx.cleanup()
    }
  })

  it('iki cihazdan aynı anda yeni kod: önce kaydedilen kalır, öteki 409 keys_changed alır ve kaydedilmez', async () => {
    const ctx = await h.startServer()
    let hold = null
    try {
      const owner = await h.setupOwner(ctx)
      const phone = await h.login(ctx, 'sahip')
      h.expectStatus(phone, 200)
      const authKey = h.authKeyFor(PASSWORD)
      const first = newCode()
      const second = newCode()
      hold = holdHashes()
      // İki istek de parola denetiminden geçip kod karmasında bekler, ikisi de aynı (boş) kaydı görmüştür
      const a = h.post(ctx, '/api/me/recovery', owner.token, { authKey, recovery: first.setup })
      await hold.waitHeld(1)
      const b = h.post(ctx, '/api/me/recovery', phone.data.token, { authKey, recovery: second.setup })
      await hold.waitHeld(2)
      hold.release(0)
      const ra = await a
      h.expectStatus(ra, 200)
      hold.release(1)
      h.expectStatus(await b, 409, 'keys_changed')
      hold.restore()
      hold = null
      // Önce kaydedilen kod geçerli, ötekinin gösterdiği kod sunucuda yok
      assert.deepEqual((await h.stateOf(ctx, phone.data.token)).recovery, ra.data.recovery)
      h.expectStatus(await recoverKeys(ctx, 'sahip', first.authKey), 200)
      h.expectStatus(await recoverKeys(ctx, 'sahip', second.authKey), 401, 'bad_recovery')
      assert.equal((await diskUser(ctx, owner.user.id)).recovery.wrappedKey, first.setup.wrappedKey)
    } finally {
      if (hold) hold.restore()
      await ctx.cleanup()
    }
  })

  it('kod karması hesaplanırken parola değişirse 401 bad_credentials, kod kaydedilmez', async () => {
    const ctx = await h.startServer({ loginFailLimit: 1 })
    let hold = null
    try {
      const owner = await h.setupOwner(ctx)
      const code = newCode()
      hold = holdHashes()
      const pending = h.post(ctx, '/api/me/recovery', owner.token, { authKey: h.authKeyFor(PASSWORD), recovery: code.setup })
      await hold.waitHeld(1)
      // Aynı oturumdan parola değişikliği kod karması beklerken tamamlanır (bu oturum açık kalır)
      hold.passThrough()
      const change = { oldAuthKey: h.authKeyFor(PASSWORD), newAuthKey: h.authKeyFor('yeni-parola-1'), kdf: KDF, wrappedKey: h.keyPair().wrappedKey }
      h.expectStatus(await h.post(ctx, '/api/me/password', owner.token, change), 200)
      hold.release(0)
      h.expectStatus(await pending, 401, 'bad_credentials')
      hold.restore()
      hold = null
      assert.equal((await h.stateOf(ctx, owner.token)).recovery, null)
      h.expectStatus(await recoverKeys(ctx, 'sahip', code.authKey), 401, 'bad_recovery')
      assert.equal((await diskUser(ctx, owner.user.id)).recovery, null)
      // Ret await sonrası denetimden geldi: hesap işlemleri sayacı artmadı (sınır 1), yeni parolayla kod kurulur.
      // Kurtarma sayaçları ayrıdır ve yukarıdaki 401 ile dolduğu için kod burada /api/recover/keys ile denenmez.
      const renewed = await h.post(ctx, '/api/me/recovery', owner.token, { authKey: h.authKeyFor('yeni-parola-1'), recovery: code.setup })
      h.expectStatus(renewed, 200)
      assert.deepEqual((await h.stateOf(ctx, owner.token)).recovery, renewed.data.recovery)
    } finally {
      if (hold) hold.restore()
      await ctx.cleanup()
    }
  })
})

describe('POST /api/recover/keys', () => {
  it('hesap yok, kod yok ve kod yanlış durumlarında aynı 401 yanıtı, doğru kodla anahtarlar', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const code = newCode()
      const ayse = await addUserWithCode(ctx, owner.token, 'ayse', code)
      await addUserWithCode(ctx, owner.token, 'veli', null)
      const cases = [
        await recoverKeys(ctx, 'hayalet', code.authKey),
        await recoverKeys(ctx, 'veli', code.authKey),
        await recoverKeys(ctx, 'ayse', newCode().authKey),
        await recoverKeys(ctx, 'ayse', 'x'),
        await recoverKeys(ctx, 'ayse', null),
        await recoverKeys(ctx, 'Geçersiz Ad', code.authKey),
        await h.post(ctx, '/api/recover/keys', null, {})
      ]
      for (const res of cases) {
        h.expectStatus(res, 401, 'bad_recovery')
        assert.equal(res.text, cases[0].text)
      }
      assert.equal(cases[0].data.error, 'Wrong username or recovery code.')
      const tr = await recoverKeys(ctx, 'hayalet', code.authKey, { 'accept-language': 'tr' })
      assert.equal(tr.data.error, 'Kullanıcı adı veya kurtarma kodu hatalı.')
      const ok = await recoverKeys(ctx, 'AYSE', code.authKey)
      h.expectStatus(ok, 200)
      assert.deepEqual(ok.data, { publicKey: ayse.keys.publicKey, wrappedKey: code.setup.wrappedKey })
      // Kod tek başına giriş yapmaz, oturum açmaz
      assert.equal(ok.data.token, undefined)
    } finally {
      await ctx.cleanup()
    }
  })

  it('var olmayan hesapta da karma hesaplanır (karma sırası doluysa 503)', async () => {
    const ctx = await h.startServer({ scryptN: 16384, hashConcurrency: 1, hashQueueMax: 1 })
    try {
      const attempts = []
      for (const i of h.times(16)) attempts.push(recoverKeys(ctx, 'yok', 'f'.repeat(64), { 'x-forwarded-for': '198.51.100.' + (i + 1) }))
      const results = await Promise.all(attempts)
      assert.ok(results.some((r) => r.status === 503 && r.data.code === 'server_busy'), 'karma hesaplanmadı')
      for (const r of results) assert.ok(r.status === 503 || r.status === 401, String(r.status))
    } finally {
      await ctx.cleanup()
    }
  })

  it('kurtarma sayaçları girişten ayrıdır: kod denemeleri girişi kilitlemez, adres başına sınır 429', async () => {
    const ctx = await h.startServer({ loginFailLimit: 3 })
    try {
      const owner = await h.setupOwner(ctx)
      const code = newCode()
      await addUserWithCode(ctx, owner.token, 'ayse', code)
      const ip = (n) => ({ 'x-forwarded-for': '192.0.2.' + n })
      for (const i of h.times(3)) h.expectStatus(await recoverKeys(ctx, 'ayse', newCode().authKey, ip(1)), 401, 'bad_recovery')
      h.expectStatus(await recoverKeys(ctx, 'ayse', code.authKey, ip(1)), 429, 'rate_limited')
      // Aynı adresten giriş etkilenmez, başka adresten doğru kod çalışır
      h.expectStatus(await h.login(ctx, 'ayse', PASSWORD, ip(1)), 200)
      h.expectStatus(await recoverKeys(ctx, 'ayse', code.authKey, ip(2)), 200)
      // Hatalı girişler de kurtarmayı kilitlemez
      for (const i of h.times(3)) h.expectStatus(await h.login(ctx, 'ayse', 'yanlis-' + i, ip(3)), 401)
      h.expectStatus(await h.login(ctx, 'ayse', PASSWORD, ip(3)), 429, 'rate_limited')
      h.expectStatus(await recoverKeys(ctx, 'ayse', code.authKey, ip(3)), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('hesap adı sınırı dolunca giriş cihazı işareti olan cihaz kodunu deneyebilir', async () => {
    const ctx = await h.startServer({ loginFailLimit: 2 })
    try {
      const owner = await h.setupOwner(ctx)
      const code = newCode()
      const ayse = await addUserWithCode(ctx, owner.token, 'ayse', code)
      for (const i of h.times(4)) h.expectStatus(await recoverKeys(ctx, 'ayse', newCode().authKey, { 'x-forwarded-for': '198.51.100.' + (i + 1) }), 401)
      h.expectStatus(await recoverKeys(ctx, 'ayse', code.authKey, { 'x-forwarded-for': '203.0.113.9' }), 429, 'rate_limited')
      h.expectStatus(await recoverKeys(ctx, 'ayse', code.authKey, { 'x-forwarded-for': '203.0.113.9' }, { device: ayse.device }), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('adres başına genel kimlik sınırı (authLimiter) uygulanır', async () => {
    const ctx = await h.startServer({ authLimit: 3 })
    try {
      const owner = await h.setupOwner(ctx, 'sahip')
      assert.ok(owner.token)
      const ip = { 'x-forwarded-for': '192.0.2.77' }
      h.expectStatus(await recoverKeys(ctx, 'sahip', 'f'.repeat(64), ip), 401)
      h.expectStatus(await recoverKeys(ctx, 'sahip', 'f'.repeat(64), ip), 401)
      h.expectStatus(await recover(ctx, recoverBody('sahip', 'f'.repeat(64), h.keyPair().publicKey, 'yeni-parola-1').body, ip), 401)
      const limited = await recoverKeys(ctx, 'sahip', 'f'.repeat(64), ip)
      h.expectStatus(limited, 429, 'rate_limited')
      assert.ok(Number(limited.headers['retry-after']) >= 1)
    } finally {
      await ctx.cleanup()
    }
  })

  it('engelli hesap yalnızca doğru koddan sonra 403 alır', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const code = newCode()
      const ayse = await addUserWithCode(ctx, owner.token, 'ayse', code)
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: ayse.user.id, banned: true }), 200)
      h.expectStatus(await recoverKeys(ctx, 'ayse', newCode().authKey), 401, 'bad_recovery')
      h.expectStatus(await recoverKeys(ctx, 'ayse', code.authKey), 403, 'banned')
      const { body } = recoverBody('ayse', code.authKey, ayse.keys.publicKey, 'yeni-parola-1')
      h.expectStatus(await recover(ctx, body), 403, 'banned')
      h.expectStatus(await h.login(ctx, 'ayse'), 403, 'banned')
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('POST /api/recover', () => {
  it('yeni parola ve yeni kod, açık anahtar ve kimlik kaydı aynı kalır, eski oturumlar ve cihaz işaretleri düşer', async () => {
    const ctx = await h.startServer({ loginFailLimit: 3 })
    try {
      const owner = await h.setupOwner(ctx)
      const code = newCode()
      const ayse = await addUserWithCode(ctx, owner.token, 'ayse', code)
      h.expectStatus(await h.post(ctx, '/api/me/identity', ayse.token, { identity: h.envelope() }), 200)
      const second = await h.login(ctx, 'ayse')
      const before = await diskUser(ctx, ayse.user.id)
      const pvBefore = (await h.stateOf(ctx, owner.token)).meta.users.find((u) => u.id === ayse.user.id).pv
      // Birkaç hatalı giriş: kurtarma bu sayaçları sıfırlar
      h.expectStatus(await h.login(ctx, 'ayse', 'yanlis-1'), 401)
      h.expectStatus(await h.login(ctx, 'ayse', 'yanlis-2'), 401)

      const { body, next, kdf } = recoverBody('ayse', code.authKey, ayse.keys.publicKey, 'yeni-parola-1')
      const res = await recover(ctx, body)
      h.expectStatus(res, 200)
      assert.deepEqual(Object.keys(res.data).sort(), ['device', 'keys', 'recovery', 'token', 'user'])
      assert.deepEqual(res.data.user, { id: ayse.user.id, name: 'ayse', role: 'member' })
      assert.deepEqual(res.data.keys, { publicKey: ayse.keys.publicKey, wrappedKey: body.wrappedKey })
      assert.deepEqual(Object.keys(res.data.recovery).sort(), ['createdAt', 'label'])
      assert.match(res.data.device, /^[0-9a-f]{24}\.[A-Za-z0-9_-]{43}$/)

      // Eski oturumlar kapandı, yeni oturum çalışıyor
      h.expectStatus(await h.get(ctx, '/api/state', ayse.token), 401, 'invalid_token')
      h.expectStatus(await h.get(ctx, '/api/state', second.data.token), 401, 'invalid_token')
      const st = await h.stateOf(ctx, res.data.token)
      assert.equal(st.resetPending, undefined)
      assert.deepEqual(st.keys, res.data.keys)
      // Eski parola ve eski kod geçmez, yeni parola ve yeni kod geçer
      h.expectStatus(await h.login(ctx, 'ayse'), 401, 'bad_credentials')
      h.expectStatus(await recoverKeys(ctx, 'ayse', code.authKey), 401, 'bad_recovery')
      const pre = await h.post(ctx, '/api/prelogin', null, { name: 'ayse' })
      assert.deepEqual(pre.data.kdf, kdf)
      h.expectStatus(await h.login(ctx, 'ayse', 'yeni-parola-1'), 200)
      const keys = await recoverKeys(ctx, 'ayse', next.authKey)
      h.expectStatus(keys, 200)
      assert.equal(keys.data.wrappedKey, next.setup.wrappedKey)
      // Disk: değişenler ve değişmeyenler
      const after = await diskUser(ctx, ayse.user.id)
      assert.notEqual(after.passHash, before.passHash)
      assert.notEqual(after.credEpoch, before.credEpoch)
      assert.deepEqual(after.kdf, kdf)
      assert.equal(after.wrappedKey, body.wrappedKey)
      assert.equal(after.recovery.wrappedKey, next.setup.wrappedKey)
      assert.equal(after.publicKey, before.publicKey)
      assert.equal(after.identity, before.identity)
      assert.equal(after.pv, before.pv)
      assert.equal(after.resetPending, false)
      assert.equal((await h.stateOf(ctx, owner.token)).meta.users.find((u) => u.id === ayse.user.id).pv, pvBefore)
      // Önceki giriş cihazı işareti geçersiz (dönem değişti)
      assert.equal(auth.loginDeviceId(readState(ctx).serverSecret, ayse.user.id, after.credEpoch, ayse.device), null)
      assert.notEqual(auth.loginDeviceId(readState(ctx).serverSecret, ayse.user.id, after.credEpoch, res.data.device), null)
      // Hatalı giriş sayacı sıfırlandı: iki hatalı denemeden sonra yine üç hak var
      h.expectStatus(await h.login(ctx, 'ayse', 'yanlis-3'), 401)
      h.expectStatus(await h.login(ctx, 'ayse', 'yanlis-4'), 401)
      h.expectStatus(await h.login(ctx, 'ayse', 'yeni-parola-1'), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('gövde doğrulaması, farklı açık anahtar 409 keys_changed, yanlış kod 401', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const code = newCode()
      const ayse = await addUserWithCode(ctx, owner.token, 'ayse', code)
      const base = recoverBody('ayse', code.authKey, ayse.keys.publicKey, 'yeni-parola-1').body
      const variants = [
        [{ newAuthKey: 'x' }, 400, 'bad_auth_key'],
        [{ kdf: { salt: 'x', N: 16384, r: 8, p: 1 } }, 400, 'bad_kdf'],
        [{ kdf: Object.assign({}, base.kdf, { N: 1024 }) }, 400, 'bad_kdf'],
        [{ publicKey: 'x' }, 400, 'bad_keys'],
        [{ wrappedKey: 'x' }, 400, 'bad_keys'],
        [{ recovery: null }, 400, 'bad_keys'],
        [{ recovery: { authKey: 'f'.repeat(64) } }, 400, 'bad_keys'],
        [{ recoveryAuthKey: newCode().authKey }, 401, 'bad_recovery'],
        [{ name: 'hayalet' }, 401, 'bad_recovery'],
        [{ publicKey: h.keyPair().publicKey }, 409, 'keys_changed']
      ]
      for (const [extra, status, codeName] of variants) {
        h.expectStatus(await recover(ctx, Object.assign({}, base, extra)), status, codeName)
      }
      // Hiçbiri hesabı değiştirmedi
      h.expectStatus(await h.login(ctx, 'ayse'), 200)
      h.expectStatus(await recoverKeys(ctx, 'ayse', code.authKey), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('aynı kodla aynı anda gelen iki istekten yalnızca biri başarılı olur', async () => {
    const ctx = await h.startServer({ scryptN: 16384 })
    try {
      const owner = await h.setupOwner(ctx)
      const code = newCode()
      const ayse = await addUserWithCode(ctx, owner.token, 'ayse', code)
      const a = recoverBody('ayse', code.authKey, ayse.keys.publicKey, 'yeni-parola-1').body
      const b = recoverBody('ayse', code.authKey, ayse.keys.publicKey, 'yeni-parola-2').body
      const results = await Promise.all([recover(ctx, a), recover(ctx, b)])
      const statuses = results.map((r) => r.status).sort()
      assert.deepEqual(statuses, [200, 401], results.map((r) => r.text).join(' | '))
      const loser = results.find((r) => r.status === 401)
      assert.equal(loser.data.code, 'bad_recovery')
      const winner = results.find((r) => r.status === 200)
      const winnerPassword = winner === results[0] ? 'yeni-parola-1' : 'yeni-parola-2'
      const winnerBody = winner === results[0] ? a : b
      const pre = await h.post(ctx, '/api/prelogin', null, { name: 'ayse' })
      assert.equal(pre.data.kdf.salt, winnerBody.kdf.salt)
      const authKey = h.deriveKeys(winnerPassword, pre.data.kdf.salt, pre.data.kdf.N).authKey
      h.expectStatus(await h.post(ctx, '/api/login', null, { name: 'ayse', authKey }), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('sahibin parola sıfırlaması ve hesap silme kurtarma kodunu siler', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const codeA = newCode()
      const codeB = newCode()
      const ayse = await addUserWithCode(ctx, owner.token, 'ayse', codeA)
      const veli = await addUserWithCode(ctx, owner.token, 'veli', codeB)
      h.expectStatus(await h.post(ctx, '/api/users/reset-password', owner.token, { userId: ayse.user.id }), 200)
      h.expectStatus(await recoverKeys(ctx, 'ayse', codeA.authKey), 401, 'bad_recovery')
      assert.equal((await diskUser(ctx, ayse.user.id)).recovery, null)
      h.expectStatus(await h.post(ctx, '/api/me/delete', veli.token, { authKey: h.authKeyFor(PASSWORD) }), 200)
      h.expectStatus(await recoverKeys(ctx, 'veli', codeB.authKey), 401, 'bad_recovery')
      assert.equal((await diskUser(ctx, veli.user.id)).recovery, null)
      // Ad yeniden alınınca eski kod yeni hesapta işe yaramaz
      await addUserWithCode(ctx, owner.token, 'veli', null)
      h.expectStatus(await recoverKeys(ctx, 'veli', codeB.authKey), 401, 'bad_recovery')
    } finally {
      await ctx.cleanup()
    }
  })

  it('sıfırlamadan sonra yeni anahtar çifti kurulurken eski kayıt kalmaz, yeni kod parola değişikliğiyle kurulabilir', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const member = await addUserWithCode(ctx, owner.token, 'ayse', newCode())
      const res = await h.post(ctx, '/api/users/reset-password', owner.token, { userId: member.user.id })
      const pre = await h.post(ctx, '/api/prelogin', null, { name: 'ayse' })
      const temp = h.deriveKeys(res.data.tempPassword, pre.data.kdf.salt, pre.data.kdf.N).authKey
      const relog = await h.post(ctx, '/api/login', null, { name: 'ayse', authKey: temp })
      const pair = h.keyPair()
      const code = newCode()
      const change = { oldAuthKey: temp, newAuthKey: h.authKeyFor('yeni-parola-1'), kdf: KDF, publicKey: pair.publicKey, wrappedKey: pair.wrappedKey, recovery: code.setup }
      const changed = await h.post(ctx, '/api/me/password', relog.data.token, change)
      h.expectStatus(changed, 200)
      assert.notEqual(changed.data.recovery, null)
      const keys = await recoverKeys(ctx, 'ayse', code.authKey)
      h.expectStatus(keys, 200)
      assert.deepEqual(keys.data, { publicKey: pair.publicKey, wrappedKey: code.setup.wrappedKey })
    } finally {
      await ctx.cleanup()
    }
  })
})
