'use strict'

// Hesaplar ve oturumlar: kurulum ve davet kodu, kullanıcı adı kuralları,
// ön giriş, authKey ile kayıt ve giriş, türetme parametreleri, hız sınırları, token'ın diskte
// saklanmaması, kalıcılık, çıkış, engelleme, parola değiştirme ve sıfırlama, kişisel anahtarlar,
// kimlik kaydı, profiller, kullanıcı adı değiştirme ve hesap silme.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const h = require('./server-yardimci')
const auth = require('../src/auth')

const { PASSWORD, SETUP_CODE, KDF } = h

function register (ctx, name, opts) {
  return h.post(ctx, '/api/register', null, h.registerBody(name, opts))
}

function prelogin (ctx, name, headers) {
  return h.request(ctx, 'POST', '/api/prelogin', { headers, body: { name } })
}

// Geçici parolanın authKey değeri: ön girişin bildirdiği tuz ve N ile türetilir
async function tempAuthKey (ctx, name, password) {
  const kdf = (await prelogin(ctx, name)).data.kdf
  return h.deriveKeys(password, kdf.salt, kdf.N).authKey
}

function loginRaw (ctx, name, authKey, headers) {
  return h.request(ctx, 'POST', '/api/login', { headers, body: { name, authKey } })
}

function readState (ctx) {
  return JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'state.json'), 'utf8'))
}

describe('ortak türetme test vektörü', () => {
  it('Node türetmesi ortak vektörle aynı authKey değerini üretir', async () => {
    const v = h.VECTOR
    const salt = Buffer.from(v.saltHex, 'hex')
    assert.equal(salt.toString('base64url'), v.saltB64url)
    assert.equal(await auth.deriveAuthKey(v.password, salt, v.N), v.authKey)
    // Bileşik (NFD) yazım NFC'ye çevrildiği için aynı sonucu verir
    assert.equal(await auth.deriveAuthKey(v.password.normalize('NFD'), salt, v.N), v.authKey)
    // Testlerdeki bağımsız istemci türetmesi de vektörle aynıdır (alan ayrımı dahil)
    assert.deepEqual(h.deriveKeys(v.password, v.saltB64url, v.N), { master: v.master, authKey: v.authKey, wrapKey: v.wrapKey })
    assert.notEqual(await auth.deriveAuthKey('Parola-Ornek 1', salt, v.N), v.authKey)
    await assert.rejects(auth.deriveAuthKey(v.password, salt, 1024), TypeError)
    await assert.rejects(auth.deriveAuthKey(v.password, Buffer.alloc(8), v.N), TypeError)
  })

  it('sıfırlama kimlik bilgileri: geçici paroladan aynı türetmeyle authKey, karması saklanır', async () => {
    const creds = await auth.newCredentials(1024)
    assert.match(creds.tempPassword, /^[A-Za-z0-9]{12}$/)
    assert.equal(creds.kdf.N, auth.KDF_DEFAULT_N)
    assert.equal(auth.KDF_DEFAULT_N, 65536)
    assert.equal(creds.kdf.r, 8)
    assert.equal(creds.kdf.p, 1)
    assert.ok(auth.cleanKdf(creds.kdf))
    const authKey = h.deriveKeys(creds.tempPassword, creds.kdf.salt, creds.kdf.N).authKey
    assert.equal(await auth.verifyPassword(authKey, creds.passHash), true)
    assert.equal(await auth.verifyPassword(creds.tempPassword, creds.passHash), false)
  })
})

describe('kurulum ve kayıt', () => {
  it('kurulum kodu ile sahip oluşturulur, kod yeniden kullanılamaz', async () => {
    const ctx = await h.startServer()
    try {
      assert.equal(ctx.server.setupCode, SETUP_CODE)
      let info = await h.get(ctx, '/api/info')
      h.expectStatus(info, 200)
      assert.equal(info.data.setupRequired, true)
      assert.equal(info.data.serverName, 'Telsiz')
      assert.equal(info.data.version, require('../package.json').version)
      assert.deepEqual(info.data.limits, {
        nameMin: 2,
        nameMax: 32,
        passwordMin: 8,
        passwordMax: 128,
        messageMaxChars: 2000,
        maxBodyChars: 24000,
        uploadMaxBytes: 25 * 1024 * 1024 + 16,
        maxUploadsPerMessage: 10,
        channelNameMax: 30,
        serverNameMax: 40,
        aboutMax: 600,
        aboutMaxLines: 6,
        maxProfileChars: 6000,
        avatarMaxBytes: 1024 * 1024 + 16,
        serverIconMaxBytes: 1024 * 1024 + 16,
        voiceCapacityMin: 2,
        voiceCapacityMax: 12,
        maxCamerasMin: 1,
        maxCamerasMax: 12
      })

      // Kod büyük/küçük harf ve tire duyarsız, O ve 0, I/L ve 1 eşlenir
      h.expectStatus(await register(ctx, 'sahip', { setupCode: 'ABCDE-FGHJM' }), 403, 'bad_code')
      h.expectStatus(await register(ctx, 'sahip', {}), 403, 'bad_code')

      const ok = await register(ctx, 'sahip', { setupCode: ' abcde fghjk ' })
      h.expectStatus(ok, 200)
      assert.equal(typeof ok.data.token, 'string')
      assert.deepEqual(ok.data.user, { id: 1, name: 'sahip', role: 'owner' })
      assert.equal(ctx.server.setupCode, null)

      info = await h.get(ctx, '/api/info')
      assert.equal(info.data.setupRequired, false)

      // Sahip varken kurulum kodu artık işe yaramaz, davet kodu gerekir
      h.expectStatus(await register(ctx, 'ikinci', { setupCode: SETUP_CODE }), 403, 'bad_code')
    } finally {
      await ctx.cleanup()
    }
  })

  it('Crockford eşlemesi: O→0, I ve L→1', async () => {
    const ctx = await h.startServer({ setupCode: '01ABC-DE1FG' })
    try {
      h.expectStatus(await register(ctx, 'sahip', { setupCode: 'oiabc-delfg' }), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('aynı anda iki kurulum isteğinden yalnızca biri sahip olur', async () => {
    const ctx = await h.startServer()
    try {
      const results = await Promise.all([
        register(ctx, 'birinci', { setupCode: SETUP_CODE }),
        register(ctx, 'ikinci', { setupCode: SETUP_CODE })
      ])
      const statuses = results.map((r) => r.status).sort()
      assert.deepEqual(statuses, [200, 403])
      const owner = results.find((r) => r.status === 200)
      const st = await h.stateOf(ctx, owner.data.token)
      assert.equal(st.meta.users.filter((u) => u.role === 'owner').length, 1)
      assert.equal(st.meta.users.length, 1)
    } finally {
      await ctx.cleanup()
    }
  })

  it('davet kodu ile kayıt, yanlış kod ve davet kodu yenileme', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const code = await h.inviteCodeOf(ctx, owner.token)
      assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)

      h.expectStatus(await register(ctx, 'ayse', { inviteCode: 'ZZZZZ-ZZZZZ' }), 403, 'bad_code')
      h.expectStatus(await register(ctx, 'ayse', {}), 403, 'bad_code')
      h.expectStatus(await register(ctx, 'ayse', { inviteCode: 12345 }), 403, 'bad_code')
      // Yanlış kodla alınmış bir adın varlığı sızmaz (kod denetimi ad çakışmasından önce)
      h.expectStatus(await register(ctx, 'sahip', { inviteCode: 'ZZZZZ-ZZZZZ' }), 403, 'bad_code')

      const res = await register(ctx, 'ayse', { inviteCode: code.toLowerCase() })
      h.expectStatus(res, 200)
      assert.deepEqual(res.data.user, { id: 2, name: 'ayse', role: 'member' })

      const rotated = await h.post(ctx, '/api/invite/rotate', owner.token)
      h.expectStatus(rotated, 200)
      assert.notEqual(rotated.data.inviteCode, code)
      h.expectStatus(await register(ctx, 'mehmet', { inviteCode: code }), 403, 'bad_code')
      h.expectStatus(await register(ctx, 'mehmet', { inviteCode: rotated.data.inviteCode }), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('kullanıcı adı kuralları: küçük İngilizce harf, rakam, alt çizgi ve nokta', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const inviteCode = await h.inviteCodeOf(ctx, owner.token)
      const reg = (name) => register(ctx, name, { inviteCode })

      const bad = ['a', 'x'.repeat(33), '.ali', 'ali.', 'ali..veli', '..', 'ayşe', 'ışık', 'ali veli', ' ali', 'ali ',
        'ali-veli', 'ali@veli', 'ali/veli', '', 42, null, ['ali'], { a: 1 }, 'ali\u0000', 'ali\u200b', '\u212aelvin',
        'İnci', 'x'.repeat(65)]
      for (const name of bad) {
        h.expectStatus(await reg(name), 400, 'invalid_name')
      }
      for (const name of ['ali.veli_42', 'x'.repeat(32), '__', 'a.b', '42']) {
        const res = await reg(name)
        h.expectStatus(res, 200)
        assert.equal(res.data.user.name, name)
      }
      // İngilizce büyük harfler küçültülür, tekillik doğrudan karşılaştırmayla
      const upper = await reg('MeHmet')
      h.expectStatus(upper, 200)
      assert.equal(upper.data.user.name, 'mehmet')
      h.expectStatus(await reg('mehmet'), 409, 'name_taken')
      h.expectStatus(await reg('MEHMET'), 409, 'name_taken')
      h.expectStatus(await reg('sahip'), 409, 'name_taken')
    } finally {
      await ctx.cleanup()
    }
  })

  it('kayıt gövdesi: authKey, türetme ayarları ve anahtar biçimleri doğrulanır', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const inviteCode = await h.inviteCodeOf(ctx, owner.token)
      const reg = (extra) => register(ctx, 'ayse', { inviteCode, extra })

      for (const authKey of ['A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 123, null, undefined, PASSWORD]) {
        h.expectStatus(await reg({ authKey }), 400, 'bad_auth_key')
      }
      const kdf = (patch) => Object.assign({}, KDF, patch)
      const badKdf = [undefined, null, [], 'kdf', kdf({ N: 1024 }), kdf({ N: 16385 }), kdf({ N: 131072 }), kdf({ N: '16384' }),
        kdf({ r: 4 }), kdf({ p: 2 }), kdf({ r: undefined }), kdf({ salt: KDF.salt.slice(1) }), kdf({ salt: KDF.salt + 'A' }),
        kdf({ salt: KDF.salt + '==' }), kdf({ salt: 'AAAAAAAAAAAAAAAAAAAAAB' }), kdf({ salt: 'AAAAAAAAAAAAAAAAAAAA+A' }),
        kdf({ salt: 1234 })]
      for (const value of badKdf) {
        h.expectStatus(await reg({ kdf: value }), 400, 'bad_kdf')
      }
      const pair = h.keyPair()
      const badKeys = [
        { publicKey: undefined },
        { publicKey: pair.publicKey.slice(1) },
        { publicKey: pair.publicKey + 'A' },
        { publicKey: pair.publicKey.slice(0, 42) + '+' },
        { publicKey: 'A'.repeat(42) + 'B' },
        { wrappedKey: undefined },
        { wrappedKey: '2w.' + pair.wrappedKey.slice(3) },
        { wrappedKey: '1w.' + 'A'.repeat(31) + '.' + 'B'.repeat(64) },
        { wrappedKey: '1w.' + 'A'.repeat(32) + '.' + 'B'.repeat(59) },
        { wrappedKey: '1w.' + 'A'.repeat(32) + '.' + 'B'.repeat(71) },
        { wrappedKey: pair.wrappedKey + '\n' },
        { wrappedKey: 42 }
      ]
      for (const extra of badKeys) {
        h.expectStatus(await reg(extra), 400, 'bad_keys')
      }
      // Desteklenen diğer N değerleri kabul edilir
      const ok = await reg({ kdf: kdf({ N: 65536 }) })
      h.expectStatus(ok, 200)
      const pre = await prelogin(ctx, 'ayse')
      assert.deepEqual(pre.data, { kdf: { salt: KDF.salt, N: 65536, r: 8, p: 1 } })
      h.expectStatus(await register(ctx, 'mehmet', { inviteCode, extra: { kdf: kdf({ N: 32768 }) } }), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('kullanıcı sayısı üst sınırı 503 server_full', async () => {
    const ctx = await h.startServer({ maxUsers: 2 })
    try {
      const owner = await h.setupOwner(ctx)
      await h.addUser(ctx, owner.token, 'ayse')
      const inviteCode = await h.inviteCodeOf(ctx, owner.token)
      h.expectStatus(await register(ctx, 'mehmet', { inviteCode }), 503, 'server_full')
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('ön giriş', () => {
  it('sahte ayarın N değeri eski ayarlı hesapların payını izler, ad başına sabittir', () => {
    const secret = auth.newServerSecret()
    const names = h.times(2000).map((i) => 'ad' + i)
    const share = (p) => names.filter((n) => auth.preloginKdf(secret, n, p).N === 16384).length / names.length
    assert.equal(share(0), 0)
    assert.equal(share(1), 1)
    assert.ok(Math.abs(share(0.3) - 0.3) < 0.05, String(share(0.3)))
    const a = auth.preloginKdf(secret, 'hayalet', 1)
    const b = auth.preloginKdf(secret, 'hayalet', 0)
    assert.deepEqual(auth.preloginKdf(secret, 'hayalet', 1), a)
    // Eski ve yeni N için tuz da farklıdır (gerçek bir yükseltme gibi)
    assert.notEqual(a.salt, b.salt)
    assert.deepEqual([a.N, b.N], [16384, 65536])
    // Geçersiz bir ad girdisi eski ayarın sahte tuzunu üretemez (varlık kehaneti olmasın)
    for (const probe of ['hayalet\u0000eski', 'prelogin-legacy:hayalet', 'legacy:hayalet']) {
      assert.notEqual(auth.preloginKdf(secret, probe, 0).salt, a.salt)
      assert.notEqual(auth.preloginSalt(secret, probe), a.salt)
    }
  })

  it('sahte ayarın eski N payı yalnızca azalır: hesap ayarını zayıflatsa da sahte yanıtlar eski N\'ye dönmez', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const names = h.times(40).map((i) => 'yok' + i)
      const fakeNs = async () => Promise.all(names.map(async (n) => (await prelogin(ctx, n)).data.kdf.N))
      assert.ok((await fakeNs()).every((n) => n === 16384))
      // Sahip yükseltir: pay 0, bütün sahte yanıtlar yeni N
      const kdf = { salt: crypto.randomBytes(16).toString('base64url'), N: 65536, r: 8, p: 1 }
      const newKey = h.deriveKeys(h.PASSWORD, kdf.salt, kdf.N).authKey
      h.expectStatus(await h.post(ctx, '/api/me/kdf', owner.token, { oldAuthKey: h.authKeyFor(h.PASSWORD), oldSalt: h.KDF.salt, newAuthKey: newKey, kdf, wrappedKey: h.keyPair().wrappedKey }), 200)
      assert.ok((await fakeNs()).every((n) => n === 65536))
      // Sahip parolasını eski N ile değiştirir (pay yeniden 1 olur): sahte yanıtlar değişmez
      h.expectStatus(await h.post(ctx, '/api/me/password', owner.token, { oldAuthKey: newKey, newAuthKey: h.authKeyFor(h.PASSWORD), kdf: h.KDF, wrappedKey: h.keyPair().wrappedKey }), 200)
      assert.ok((await fakeNs()).every((n) => n === 65536))
      // Yeniden başlatmadan sonra da
      const again = await ctx.restart()
      const after = await Promise.all(names.map(async (n) => (await prelogin(again, n)).data.kdf.N))
      assert.ok(after.every((n) => n === 65536))
      await again.cleanup()
    } catch (err) {
      await ctx.cleanup()
      throw err
    }
  })

  it('var olan ve olmayan hesap yanıtları aynı biçimde, sahte tuz ad başına sabit', async () => {
    let ctx = await h.startServer()
    try {
      await h.setupOwner(ctx)
      const real = await prelogin(ctx, 'sahip')
      h.expectStatus(real, 200)
      assert.deepEqual(real.data, { kdf: { salt: KDF.salt, N: 16384, r: 8, p: 1 } })
      // Büyük harf küçültülür
      assert.deepEqual((await prelogin(ctx, 'SAHIP')).data, real.data)

      const fake = await prelogin(ctx, 'hayalet')
      h.expectStatus(fake, 200)
      assert.deepEqual(Object.keys(fake.data), ['kdf'])
      assert.deepEqual(Object.keys(fake.data.kdf), Object.keys(real.data.kdf))
      assert.match(fake.data.kdf.salt, /^[A-Za-z0-9_-]{22}$/)
      assert.equal(Buffer.from(fake.data.kdf.salt, 'base64url').length, 16)
      // Tek hesap eski ayarlı (pay 1): sahte ayar da eski N'yi taşır, N hesabın varlığını ele vermez
      assert.deepEqual([fake.data.kdf.N, fake.data.kdf.r, fake.data.kdf.p], [16384, 8, 1])
      assert.equal(fake.text.length, real.text.length)
      assert.deepEqual(Object.keys(fake.headers).sort(), Object.keys(real.headers).sort())

      // Deterministik: aynı ad aynı tuz, farklı ad farklı tuz, sunucu sırrına bağlı
      assert.deepEqual((await prelogin(ctx, 'hayalet')).data, fake.data)
      assert.deepEqual((await prelogin(ctx, 'HAYALET')).data, fake.data)
      assert.notEqual((await prelogin(ctx, 'hayalet2')).data.kdf.salt, fake.data.kdf.salt)
      await ctx.server.flush()
      const disk = readState(ctx)
      assert.match(disk.serverSecret, /^[0-9a-f]{64}$/)
      const expected = crypto.createHmac('sha256', Buffer.from(disk.serverSecret, 'hex')).update('prelogin-legacy:hayalet').digest().subarray(0, 16).toString('base64url')
      assert.equal(fake.data.kdf.salt, expected)
      // Geçersiz adlar da biçimce aynı yanıtı alır
      const invalid = await prelogin(ctx, 'Ayşe Yılmaz')
      h.expectStatus(invalid, 200)
      assert.match(invalid.data.kdf.salt, /^[A-Za-z0-9_-]{22}$/)

      // Sunucu sırrı yeniden başlatmadan sonra aynıdır, hiçbir yanıtta görünmez
      ctx = await ctx.restart()
      assert.deepEqual((await prelogin(ctx, 'hayalet')).data, fake.data)
      const owner = await h.login(ctx, 'sahip')
      h.expectStatus(owner, 200)
      for (const res of [await h.get(ctx, '/api/info'), await h.get(ctx, '/api/state', owner.data.token), owner, fake]) {
        assert.ok(!res.text.includes(disk.serverSecret))
      }

      for (const name of [undefined, null, 42, ['sahip'], { name: 'sahip' }, 'x'.repeat(65)]) {
        h.expectStatus(await h.post(ctx, '/api/prelogin', null, { name }), 400, 'bad_request')
      }
    } finally {
      await ctx.cleanup()
    }
  })

  it('ön giriş ve ad uygunluğu ayrı bir IP sayacıyla sınırlanır', async () => {
    const ctx = await h.startServer({ authLimit: 3 })
    try {
      const ip = { 'x-forwarded-for': '203.0.113.8' }
      h.expectStatus(await prelogin(ctx, 'a1', ip), 200)
      h.expectStatus(await h.request(ctx, 'POST', '/api/username-available', { headers: ip, body: { name: 'abc', code: SETUP_CODE } }), 200)
      h.expectStatus(await prelogin(ctx, 'a2', ip), 200)
      h.expectStatus(await prelogin(ctx, 'a3', ip), 429, 'rate_limited')
      h.expectStatus(await prelogin(ctx, 'a3', { 'x-forwarded-for': '203.0.113.9' }), 200)
      // Giriş ve kayıt sayacı etkilenmez
      h.expectStatus(await h.request(ctx, 'POST', '/api/register', { headers: ip, body: h.registerBody('sahip', { setupCode: SETUP_CODE }) }), 200)
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('kullanıcı adı uygunluğu', () => {
  it('geçerli kurulum veya davet kodu olmadan sorgulanamaz', async () => {
    const ctx = await h.startServer()
    try {
      const ask = (name, code) => h.post(ctx, '/api/username-available', null, { name, code })
      // Sahip yokken kurulum kodu gerekir
      h.expectStatus(await ask('sahip'), 403, 'bad_code')
      h.expectStatus(await ask('sahip', 'ZZZZZ-ZZZZZ'), 403, 'bad_code')
      let res = await ask('sahip', SETUP_CODE)
      h.expectStatus(res, 200)
      assert.deepEqual(res.data, { available: true, valid: true })

      const owner = await h.setupOwner(ctx)
      const inviteCode = await h.inviteCodeOf(ctx, owner.token)
      // Sahip oluştuktan sonra kurulum kodu geçersiz, davet kodu gerekir
      h.expectStatus(await ask('sahip', SETUP_CODE), 403, 'bad_code')
      h.expectStatus(await ask('sahip'), 403, 'bad_code')
      res = await ask('sahip', inviteCode.toLowerCase())
      assert.deepEqual(res.data, { available: false, valid: true })
      assert.deepEqual((await ask('SAHIP', inviteCode)).data, { available: false, valid: true })
      assert.deepEqual((await ask('ayse', inviteCode)).data, { available: true, valid: true })
      for (const name of ['Ayşe', 'a', '.ali', 42, null]) {
        assert.deepEqual((await ask(name, inviteCode)).data, { available: false, valid: false })
      }
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('giriş ve hız sınırları', () => {
  it('başarılı ve başarısız giriş, genel hata metni, anahtarlar girişte döner', async () => {
    const ctx = await h.startServer()
    try {
      const body = h.registerBody('sahip', { setupCode: SETUP_CODE })
      h.expectStatus(await h.post(ctx, '/api/register', null, body), 200)
      const ok = await h.login(ctx, 'sahip')
      h.expectStatus(ok, 200)
      assert.deepEqual(ok.data.user, { id: 1, name: 'sahip', role: 'owner' })
      assert.deepEqual(ok.data.keys, { publicKey: body.publicKey, wrappedKey: body.wrappedKey })
      assert.deepEqual(Object.keys(ok.data).sort(), ['device', 'keys', 'token', 'user'])

      const wrongPass = await h.login(ctx, 'sahip', 'yanlis-parola')
      const noUser = await h.login(ctx, 'hayalet', PASSWORD)
      const badName = await loginRaw(ctx, '<>', h.authKeyFor(PASSWORD))
      for (const res of [wrongPass, noUser, badName]) {
        h.expectStatus(res, 401, 'bad_credentials')
        assert.equal(res.data.error, 'Incorrect username or password.')
      }
      // Türkçe tarayıcıda aynı kod, Türkçe metin
      const trWrong = await h.login(ctx, 'sahip', 'yanlis-parola', { 'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8' })
      h.expectStatus(trWrong, 401, 'bad_credentials')
      assert.equal(trWrong.data.error, 'Kullanıcı adı veya parola hatalı.')
      // Parolanın kendisi veya biçimsiz authKey kabul edilmez
      for (const authKey of [PASSWORD, h.authKeyFor(PASSWORD).toUpperCase(), 12345678, null, '']) {
        h.expectStatus(await loginRaw(ctx, 'sahip', authKey), 401, 'bad_credentials')
      }
      h.expectStatus(await loginRaw(ctx, 'SAHIP', h.authKeyFor(PASSWORD)), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('IP başına deneme sınırı (kayıt ve giriş birlikte sayılır)', async () => {
    const ctx = await h.startServer({ authLimit: 3 })
    try {
      const ip1 = { 'x-forwarded-for': '203.0.113.7' }
      const ip2 = { 'cf-connecting-ip': '198.51.100.9' }
      const attempt = (headers) => loginRaw(ctx, 'yok', h.authKeyFor(PASSWORD), headers)
      h.expectStatus(await h.request(ctx, 'POST', '/api/register', { headers: ip1, body: h.registerBody('sahip', { setupCode: SETUP_CODE }) }), 200)
      h.expectStatus(await attempt(ip1), 401)
      h.expectStatus(await attempt(ip1), 401)
      const limited = await attempt(ip1)
      h.expectStatus(limited, 429, 'rate_limited')
      assert.ok(Number(limited.headers['retry-after']) >= 1)
      // Başka bir istemci IP'si etkilenmez
      h.expectStatus(await attempt(ip2), 401)
    } finally {
      await ctx.cleanup()
    }
  })

  it('hesap başına başarısız giriş sınırı adrese bağlıdır, başarılı girişte sıfırlanır', async () => {
    const ctx = await h.startServer({ loginFailLimit: 3 })
    try {
      await h.setupOwner(ctx)
      const fromIp = (n) => ({ 'x-forwarded-for': '192.0.2.' + n })
      const tryLogin = (password, n) => h.login(ctx, 'sahip', password, fromIp(n))
      h.expectStatus(await tryLogin('yanlis-1', 1), 401)
      h.expectStatus(await tryLogin('yanlis-2', 1), 401)
      h.expectStatus(await tryLogin(PASSWORD, 1), 200)
      // Başarılı giriş sayacı sıfırladı
      h.expectStatus(await tryLogin('yanlis-3', 1), 401)
      h.expectStatus(await tryLogin('yanlis-4', 1), 401)
      h.expectStatus(await tryLogin('yanlis-5', 1), 401)
      // Aynı adresten doğru parola da reddedilir
      h.expectStatus(await tryLogin(PASSWORD, 1), 429, 'rate_limited')
      // Hatalı denemeler hesabı başka adreslerden girişe kilitlemez
      h.expectStatus(await tryLogin(PASSWORD, 2), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('hesap adı sınırı dolunca yalnızca giriş cihazı işareti olan istek denenebilir', async () => {
    // Varsayılan sınır: hesap ve adres başına 10, hesap adı başına bütün adreslerden toplam 20 hatalı deneme
    const ctx = await h.startServer({ loginFailLimit: 10 })
    try {
      await h.setupOwner(ctx)
      const first = await h.login(ctx, 'sahip', PASSWORD, { 'x-forwarded-for': '192.0.2.1' })
      h.expectStatus(first, 200)
      const device = first.data.device
      assert.match(device, /^[0-9a-f]{24}\.[A-Za-z0-9_-]{43}$/)
      const authKey = h.authKeyFor(PASSWORD)
      const withDevice = (key, ip, value) => h.request(ctx, 'POST', '/api/login', { headers: { 'x-forwarded-for': ip }, body: { name: 'sahip', authKey: key, device: value } })
      // Saldırgan her denemeyi farklı adresten yapar, hesap ve adres sınırına hiç takılmaz
      for (const i of h.times(20)) h.expectStatus(await loginRaw(ctx, 'sahip', 'f'.repeat(64), { 'x-forwarded-for': '198.51.100.' + (i + 1) }), 401)
      // Hesap adı sınırı doldu: yeni adreslerden yapılan işaretsiz denemeler parolayı sınamadan reddedilir
      for (const i of h.times(5)) h.expectStatus(await loginRaw(ctx, 'sahip', 'e'.repeat(64), { 'x-forwarded-for': '198.51.100.' + (i + 100) }), 429, 'rate_limited')
      // İşaretsiz giriş doğru parolayla ve yeni bir adresten de reddedilir
      h.expectStatus(await loginRaw(ctx, 'sahip', authKey, { 'x-forwarded-for': '203.0.113.50' }), 429, 'rate_limited')
      // Sahte veya başka hesaba ait işaret işe yaramaz
      const forged = device.slice(0, 25) + (device[25] === 'A' ? 'B' : 'A') + device.slice(26)
      h.expectStatus(await withDevice(authKey, '203.0.113.51', forged), 429, 'rate_limited')
      // Daha önce giriş yapmış cihaz doğru parolayla girer ve aynı işareti geri alır
      const again = await withDevice(authKey, '203.0.113.52', device)
      h.expectStatus(again, 200)
      assert.equal(again.data.device, device)
      // Saldırı sürerken de cihaz girebilir
      h.expectStatus(await loginRaw(ctx, 'sahip', 'f'.repeat(64), { 'x-forwarded-for': '203.0.113.60' }), 429, 'rate_limited')
      h.expectStatus(await withDevice(authKey, '203.0.113.61', device), 200)
      // İşaretin kendi sınırı vardır
      for (const i of h.times(10)) h.expectStatus(await withDevice('f'.repeat(64), '203.0.113.' + (70 + i), device), 401)
      h.expectStatus(await withDevice(authKey, '203.0.113.53', device), 429, 'rate_limited')
    } finally {
      await ctx.cleanup()
    }
  })

  it('parola değişince veya sıfırlanınca önceki giriş cihazı işaretleri geçersiz olur', async () => {
    const ctx = await h.startServer({ loginFailLimit: 10 })
    try {
      const owner = await h.setupOwner(ctx)
      const withDevice = (name, key, ip, value) => h.request(ctx, 'POST', '/api/login', { headers: { 'x-forwarded-for': ip }, body: { name, authKey: key, device: value } })
      // Parolayı bilen biri birden çok işaret biriktirir
      const collected = [owner.device]
      for (const i of h.times(2)) {
        const res = await h.login(ctx, 'sahip', PASSWORD, { 'x-forwarded-for': '192.0.2.' + (i + 1) })
        h.expectStatus(res, 200)
        collected.push(res.data.device)
      }
      // Normal giriş işareti korur
      const kept = await withDevice('sahip', h.authKeyFor(PASSWORD), '192.0.2.9', owner.device)
      h.expectStatus(kept, 200)
      assert.equal(kept.data.device, owner.device)
      // Kişi parolasını değiştirir, bu cihaz yeni işaret alır
      const newKey = h.authKeyFor('yeni-parola-123')
      const changed = await h.post(ctx, '/api/me/password', owner.token, { oldAuthKey: h.authKeyFor(PASSWORD), newAuthKey: newKey, kdf: KDF, wrappedKey: h.keyPair().wrappedKey })
      h.expectStatus(changed, 200)
      const fresh = changed.data.device
      assert.match(fresh, /^[0-9a-f]{24}\.[A-Za-z0-9_-]{43}$/)
      assert.ok(!collected.includes(fresh))
      // Hesap adı sınırı farklı adreslerden doldurulur
      for (const i of h.times(20)) h.expectStatus(await loginRaw(ctx, 'sahip', 'f'.repeat(64), { 'x-forwarded-for': '198.51.100.' + (i + 1) }), 401)
      // Biriktirilen eski işaretler işaretsiz istek sayılır: kendi deneme hakları yoktur
      for (const [i, old] of collected.entries()) {
        h.expectStatus(await withDevice('sahip', 'e'.repeat(64), '203.0.113.' + (i + 1), old), 429, 'rate_limited')
        h.expectStatus(await withDevice('sahip', newKey, '203.0.113.' + (i + 20), old), 429, 'rate_limited')
      }
      // Yeni işaretle kişi girer ve aynı işareti geri alır
      const again = await withDevice('sahip', newKey, '203.0.113.50', fresh)
      h.expectStatus(again, 200)
      assert.equal(again.data.device, fresh)

      // Sahibin sıfırladığı hesapta da önceki işaret geçersizdir, girişte yenisi verilir
      const member = await h.addUser(ctx, again.data.token, 'ayse')
      const reset = await h.post(ctx, '/api/users/reset-password', again.data.token, { userId: member.user.id })
      h.expectStatus(reset, 200)
      const tempKey = (await tempAuthKey(ctx, 'ayse', reset.data.tempPassword))
      const afterReset = await withDevice('ayse', tempKey, '192.0.2.30', member.device)
      h.expectStatus(afterReset, 200)
      assert.match(afterReset.data.device, /^[0-9a-f]{24}\.[A-Za-z0-9_-]{43}$/)
      assert.notEqual(afterReset.data.device, member.device)
    } finally {
      await ctx.cleanup()
    }
  })

  it('kayıt yanıtı giriş cihazı işareti içerir', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      assert.match(owner.device, /^[0-9a-f]{24}\.[A-Za-z0-9_-]{43}$/)
    } finally {
      await ctx.cleanup()
    }
  })

  it('parola karması sırası doluysa giriş 503 server_busy alır', async () => {
    const ctx = await h.startServer({ scryptN: 16384, hashConcurrency: 1, hashQueueMax: 1 })
    try {
      const attempts = []
      for (const i of h.times(16)) attempts.push(loginRaw(ctx, 'yok', 'f'.repeat(64), { 'x-forwarded-for': '198.51.100.' + (i + 1) }))
      const results = await Promise.all(attempts)
      const busy = results.filter((r) => r.status === 503)
      assert.ok(busy.length > 0, 'sıra sınırı uygulanmadı')
      for (const r of busy) {
        assert.equal(r.data.code, 'server_busy')
        assert.equal(r.headers['retry-after'], '1')
      }
      for (const r of results) assert.ok(r.status === 503 || r.status === 401, String(r.status))
      // Sıra boşalınca girişler yine işlenir
      h.expectStatus(await loginRaw(ctx, 'yok', 'f'.repeat(64)), 401)
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('hız sınırlayıcı anahtar tablosu', () => {
  it('tablo doluyken yeni anahtar reddedilmez, en uzun süredir kullanılmayan düşer', () => {
    const limiter = new auth.RateLimiter(2, 600000, 3)
    for (const key of ['a', 'b', 'c']) assert.equal(limiter.consume(key, 1000), 0)
    // a yeniden kullanıldı, en eski b oldu
    assert.equal(limiter.consume('a', 1001), 0)
    assert.equal(limiter.consume('yeni', 1002), 0)
    assert.equal(limiter.hits.has('b'), false)
    assert.equal(limiter.hits.size, 3)
    // a sınırına ulaştı ve tabloda kaldı
    assert.ok(limiter.consume('a', 1003) > 0)
  })

  it('tablo farklı anahtarlarla doldurulunca sınırdaki (engelleyen) sayaç düşmez', () => {
    const limiter = new auth.RateLimiter(2, 600000, 4)
    // Kurbanın sayacı sınırda ve tablodaki en eski anahtar
    limiter.hit('n:kurban', 1000)
    limiter.hit('n:kurban', 1001)
    for (const i of h.times(50)) assert.equal(limiter.consume('sahte' + i, 2000 + i), 0)
    assert.ok(limiter.blocked('n:kurban', 3000) > 0)
    assert.equal(limiter.hits.size, 4)
    // Süresi dolan sayaç ise düşebilir
    assert.equal(limiter.consume('yeni', 1000 + 600000), 0)
    assert.equal(limiter.hits.has('n:kurban'), false)
  })

  it('resetPrefix yalnızca öneki eşleşen anahtarları siler', () => {
    const limiter = new auth.RateLimiter(1, 600000)
    for (const key of ['n:ali|1.2.3.4', 'n:ali|5.6.7.8', 'n:alio|1.2.3.4']) limiter.hit(key, 1000)
    limiter.resetPrefix('n:ali|')
    assert.deepEqual(Array.from(limiter.hits.keys()), ['n:alio|1.2.3.4'])
  })
})

describe('oturumlar', () => {
  it('token ve authKey diskte düz saklanmaz, oturum yeniden başlatmadan sonra geçerli', async () => {
    let ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const second = await h.login(ctx, 'sahip')
      await ctx.server.flush()
      const text = fs.readFileSync(path.join(ctx.dataDir, 'state.json'), 'utf8')
      assert.ok(!text.includes(owner.token))
      assert.ok(!text.includes(second.data.token))
      assert.ok(!text.includes(PASSWORD))
      assert.ok(!text.includes(h.authKeyFor(PASSWORD)))
      const hash = crypto.createHash('sha256').update(owner.token).digest('hex')
      const disk = JSON.parse(text)
      assert.ok(disk.sessions.some((s) => s.hash === hash && s.userId === 1))
      const user = disk.users[0]
      assert.match(user.passHash, /^scrypt\$1024\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
      assert.deepEqual(user.kdf, KDF)
      assert.equal(await auth.verifyPassword(h.authKeyFor(PASSWORD), user.passHash), true)
      assert.equal(user.identity, null)
      assert.equal(user.allowMemberDms, true)
      assert.deepEqual(disk.friendships, [])
      assert.deepEqual(disk.blocks, [])
      for (const s of disk.sessions) assert.deepEqual(Object.keys(s).sort(), ['createdAt', 'hash', 'label', 'lastUsed', 'userId'])

      ctx = await ctx.restart()
      const st = await h.stateOf(ctx, owner.token)
      assert.deepEqual(st.me, { id: 1, name: 'sahip', role: 'owner', status: 'online' })
      assert.deepEqual(Object.keys(st.keys), ['publicKey', 'wrappedKey'])
      assert.equal(ctx.server.setupCode, null)
    } finally {
      await ctx.cleanup()
    }
  })

  it('geçersiz token 401 invalid_token', async () => {
    const ctx = await h.startServer()
    try {
      await h.setupOwner(ctx)
      h.expectStatus(await h.get(ctx, '/api/state'), 401, 'invalid_token')
      h.expectStatus(await h.get(ctx, '/api/state', 'x'.repeat(43)), 401, 'invalid_token')
      h.expectStatus(await h.get(ctx, '/api/state', 'kisa'), 401, 'invalid_token')
      h.expectStatus(await h.get(ctx, '/api/state', 'x'.repeat(5000)), 401, 'invalid_token')
    } finally {
      await ctx.cleanup()
    }
  })

  it('logout oturumu siler', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const other = await h.login(ctx, 'sahip')
      h.expectStatus(await h.post(ctx, '/api/logout', owner.token), 200)
      h.expectStatus(await h.get(ctx, '/api/state', owner.token), 401, 'invalid_token')
      h.expectStatus(await h.get(ctx, '/api/state', other.data.token), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('kullanıcı başına oturum sınırı aşılınca en eski oturum silinir', async () => {
    const ctx = await h.startServer({ maxSessionsPerUser: 2 })
    try {
      const first = await h.setupOwner(ctx)
      const second = await h.login(ctx, 'sahip')
      const third = await h.login(ctx, 'sahip')
      h.expectStatus(await h.get(ctx, '/api/state', first.token), 401, 'invalid_token')
      h.expectStatus(await h.get(ctx, '/api/state', second.data.token), 200)
      h.expectStatus(await h.get(ctx, '/api/state', third.data.token), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('oturum süresi kayar, kullanılmayan oturum düşer', async () => {
    const ctx = await h.startServer({ sessionTtlMs: 1000 })
    try {
      const used = await h.setupOwner(ctx)
      const idle = await h.login(ctx, 'sahip')
      const start = Date.now()
      while (Date.now() - start < 1600) {
        h.expectStatus(await h.get(ctx, '/api/state', used.token), 200)
        await h.sleep(50)
      }
      h.expectStatus(await h.get(ctx, '/api/state', idle.data.token), 401, 'invalid_token')
      h.expectStatus(await h.get(ctx, '/api/state', used.token), 200)
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('engelleme ve parola işlemleri', () => {
  it('engellenen kullanıcının oturumları düşer, bekleyen poll 403 alır, girişte 403', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const member = await h.addUser(ctx, owner.token, 'ayse')
      const st = await h.stateOf(ctx, member.token)
      const p = h.poller(ctx, member.token, st)
      const waiting = h.nextRequest(ctx.server, '/api/poll')
      const pending = p.poll()
      await waiting
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: member.user.id, banned: true }), 200)
      h.expectStatus(await pending, 403, 'banned')
      h.expectStatus(await h.get(ctx, '/api/state', member.token), 401, 'invalid_token')

      h.expectStatus(await h.login(ctx, 'ayse'), 403, 'banned')
      h.expectStatus(await h.login(ctx, 'ayse', 'yanlis-parola'), 401, 'bad_credentials')

      const meta = (await h.stateOf(ctx, owner.token)).meta
      assert.ok(!meta.users.some((u) => u.id === member.user.id))

      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: member.user.id, banned: false }), 200)
      h.expectStatus(await h.login(ctx, 'ayse'), 200)
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: member.user.id, banned: 'evet' }), 400, 'bad_request')
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: 999, banned: true }), 404, 'user_not_found')
    } finally {
      await ctx.cleanup()
    }
  })

  it('sahip parola sıfırlar: Node türetmesiyle yeni tuz ve authKey, anahtarlar silinir, oturumlar düşer', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const member = await h.addUser(ctx, owner.token, 'ayse')
      const pk = h.keyPair().publicKey
      h.expectStatus(await h.post(ctx, '/api/me/identity', member.token, { identity: h.envelope() }), 200)
      const pvBefore = (await h.stateOf(ctx, owner.token)).meta.users.find((u) => u.id === member.user.id).pv

      const res = await h.post(ctx, '/api/users/reset-password', owner.token, { userId: member.user.id })
      h.expectStatus(res, 200)
      assert.equal(res.data.ok, true)
      assert.match(res.data.tempPassword, /^[A-Za-z0-9]{12}$/)
      h.expectStatus(await h.get(ctx, '/api/state', member.token), 401, 'invalid_token')

      // Yeni rastgele tuz, varsayılan parametreler
      const pre = await prelogin(ctx, 'ayse')
      assert.notEqual(pre.data.kdf.salt, KDF.salt)
      assert.deepEqual([pre.data.kdf.N, pre.data.kdf.r, pre.data.kdf.p], [65536, 8, 1])
      // Sunucunun Node türetmesi, istemci türetmesiyle (vektörle doğrulanmış) aynı authKey'i üretir
      const authKey = h.deriveKeys(res.data.tempPassword, pre.data.kdf.salt, pre.data.kdf.N).authKey
      await ctx.server.flush()
      const diskUser = readState(ctx).users.find((u) => u.id === member.user.id)
      assert.equal(await auth.verifyPassword(authKey, diskUser.passHash), true)
      assert.deepEqual([diskUser.publicKey, diskUser.wrappedKey, diskUser.identity], [null, null, null])

      h.expectStatus(await h.login(ctx, 'ayse'), 401)
      const relog = await loginRaw(ctx, 'ayse', authKey)
      h.expectStatus(relog, 200)
      assert.deepEqual(relog.data.keys, { publicKey: null, wrappedKey: null })
      assert.equal(relog.data.resetPending, true)
      assert.equal((await h.stateOf(ctx, relog.data.token)).resetPending, true)
      const profiles = await h.get(ctx, '/api/profiles?ids=' + member.user.id, owner.token)
      assert.equal(profiles.data.profiles[0].publicKey, null)
      assert.equal(profiles.data.profiles[0].identity, null)
      assert.ok(profiles.data.profiles[0].pv > pvBefore)
      // Kimlik kaydı anahtar olmadan yüklenemez. Geçici parolayı sıfırlayan da bilir: anahtar çifti geçici parolayla
      // yüklenemez, yalnızca yeni parolayla birlikte kurulur
      h.expectStatus(await h.post(ctx, '/api/me/identity', relog.data.token, { identity: h.envelope() }), 409, 'no_keys')
      const pair = h.keyPair()
      h.expectStatus(await h.post(ctx, '/api/me/keys', relog.data.token, { publicKey: pk, wrappedKey: pair.wrappedKey }), 409, 'password_change_required')
      const change = { oldAuthKey: authKey, newAuthKey: h.authKeyFor('yeni-parola-1'), kdf: KDF }
      h.expectStatus(await h.post(ctx, '/api/me/password', relog.data.token, Object.assign({ publicKey: 'x', wrappedKey: pair.wrappedKey }, change)), 400, 'bad_keys')
      h.expectStatus(await h.post(ctx, '/api/me/password', relog.data.token, Object.assign({ publicKey: pk, wrappedKey: pair.wrappedKey }, change)), 200)
      h.expectStatus(await h.post(ctx, '/api/me/keys', relog.data.token, pair), 409, 'keys_exist')
      assert.equal((await h.stateOf(ctx, relog.data.token)).resetPending, undefined)
      h.expectStatus(await loginRaw(ctx, 'ayse', authKey), 401, 'bad_credentials')
      const again = await h.login(ctx, 'ayse', 'yeni-parola-1')
      assert.deepEqual(again.data.keys, { publicKey: pk, wrappedKey: pair.wrappedKey })
      assert.equal(again.data.resetPending, undefined)
      const after = await h.get(ctx, '/api/profiles?ids=' + member.user.id, owner.token)
      assert.equal(after.data.profiles[0].publicKey, pk)

      h.expectStatus(await h.post(ctx, '/api/users/reset-password', owner.token, { userId: owner.user.id }), 403, 'forbidden')
      h.expectStatus(await h.post(ctx, '/api/users/reset-password', owner.token, { userId: 77 }), 404, 'user_not_found')
    } finally {
      await ctx.cleanup()
    }
  })

  it('anahtar çifti olan hesap yeni açık anahtar taşıyan parola değişikliğini reddeder (eski durumdaki ikinci sekme)', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const member = await h.addUser(ctx, owner.token, 'ayse')
      const res = await h.post(ctx, '/api/users/reset-password', owner.token, { userId: member.user.id })
      h.expectStatus(res, 200)
      const pre = await prelogin(ctx, 'ayse')
      const authKey = h.deriveKeys(res.data.tempPassword, pre.data.kdf.salt, pre.data.kdf.N).authKey
      const relog = await loginRaw(ctx, 'ayse', authKey)
      h.expectStatus(relog, 200)
      // İlk sekme sıfırlamayı tamamlar: yeni çift yeni parolayla kurulur
      const first = h.keyPair()
      const firstAuthKey = h.authKeyFor('yeni-parola-1')
      h.expectStatus(await h.post(ctx, '/api/me/password', relog.data.token, { oldAuthKey: authKey, newAuthKey: firstAuthKey, kdf: KDF, publicKey: first.publicKey, wrappedKey: first.wrappedKey }), 200)
      // Aynı oturumdaki ikinci sekme hâlâ anahtarsız durumu görür ve yeniden yeni çift gönderir
      const second = h.keyPair()
      const stale = { oldAuthKey: firstAuthKey, newAuthKey: h.authKeyFor('yeni-parola-2'), kdf: KDF, publicKey: second.publicKey, wrappedKey: second.wrappedKey }
      h.expectStatus(await h.post(ctx, '/api/me/password', relog.data.token, stale), 400, 'bad_keys')
      // Aynı açık anahtar da kabul edilmez: çifti olan hesapta yalnızca yeniden sarma gönderilir
      h.expectStatus(await h.post(ctx, '/api/me/password', relog.data.token, Object.assign({}, stale, { publicKey: first.publicKey })), 400, 'bad_keys')
      const st = await h.stateOf(ctx, relog.data.token)
      assert.deepEqual(st.keys, { publicKey: first.publicKey, wrappedKey: first.wrappedKey })
      h.expectStatus(await loginRaw(ctx, 'ayse', firstAuthKey), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('kendi parolasını değiştirme: eski authKey, yeni ayarlar, yeniden sarılmış anahtar, diğer oturumlar', async () => {
    const ctx = await h.startServer({ loginFailLimit: 3 })
    try {
      const body = h.registerBody('sahip', { setupCode: SETUP_CODE })
      const owner = (await h.post(ctx, '/api/register', null, body)).data
      const other = await h.login(ctx, 'sahip')
      const newSalt = crypto.randomBytes(16).toString('base64url')
      const newKdf = { salt: newSalt, N: 32768, r: 8, p: 1 }
      const newAuthKey = crypto.randomBytes(32).toString('hex')
      const rewrapped = h.keyPair().wrappedKey
      const change = (patch) => h.post(ctx, '/api/me/password', owner.token, Object.assign({
        oldAuthKey: h.authKeyFor(PASSWORD), newAuthKey, kdf: newKdf, wrappedKey: rewrapped
      }, patch))

      h.expectStatus(await change({ newAuthKey: 'kisa' }), 400, 'bad_auth_key')
      h.expectStatus(await change({ newAuthKey: undefined }), 400, 'bad_auth_key')
      h.expectStatus(await change({ kdf: { salt: newSalt, N: 1024, r: 8, p: 1 } }), 400, 'bad_kdf')
      h.expectStatus(await change({ wrappedKey: undefined }), 400, 'bad_keys')
      h.expectStatus(await change({ wrappedKey: 'bozuk' }), 400, 'bad_keys')
      const wrong = await change({ oldAuthKey: h.authKeyFor('yanlis-parola') })
      h.expectStatus(wrong, 401, 'bad_credentials')
      // Eski parola hatası oturumu düşürmez
      h.expectStatus(await h.get(ctx, '/api/state', owner.token), 200)

      h.expectStatus(await change({}), 200)
      h.expectStatus(await h.get(ctx, '/api/state', owner.token), 200)
      h.expectStatus(await h.get(ctx, '/api/state', other.data.token), 401, 'invalid_token')
      assert.deepEqual((await prelogin(ctx, 'sahip')).data, { kdf: newKdf })
      h.expectStatus(await loginRaw(ctx, 'sahip', h.authKeyFor(PASSWORD)), 401)
      const relog = await loginRaw(ctx, 'sahip', newAuthKey)
      h.expectStatus(relog, 200)
      // Aynı özel anahtar yeni parolayla sarılmıştır, açık anahtar değişmez
      assert.deepEqual(relog.data.keys, { publicKey: body.publicKey, wrappedKey: rewrapped })

      // Hesap başına hatalı deneme sınırı burada da uygulanır
      for (const i of h.times(3)) {
        h.expectStatus(await change({ oldAuthKey: h.authKeyFor('hatali-' + i), newAuthKey: h.authKeyFor('yeni') }), 401)
      }
      h.expectStatus(await change({ oldAuthKey: newAuthKey }), 429, 'rate_limited')
    } finally {
      await ctx.cleanup()
    }
  })

  it('sıfırlamadan sonra anahtarsız hesapta parola değiştirme sarılmış anahtar almaz', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const member = await h.addUser(ctx, owner.token, 'ayse')
      const reset = await h.post(ctx, '/api/users/reset-password', owner.token, { userId: member.user.id })
      const relog = await h.login(ctx, 'ayse', reset.data.tempPassword)
      h.expectStatus(relog, 200)
      const oldAuthKey = (await tempAuthKey(ctx, 'ayse', reset.data.tempPassword))
      const base = { oldAuthKey, newAuthKey: h.authKeyFor('yeni-parola-1'), kdf: KDF }
      h.expectStatus(await h.post(ctx, '/api/me/password', relog.data.token, Object.assign({ wrappedKey: h.keyPair().wrappedKey }, base)), 400, 'bad_keys')
      h.expectStatus(await h.post(ctx, '/api/me/password', relog.data.token, base), 200)
      const after = await h.login(ctx, 'ayse', 'yeni-parola-1')
      h.expectStatus(after, 200)
      assert.deepEqual(after.data.keys, { publicKey: null, wrappedKey: null })
      // Yeni parolayla girildikten sonra anahtar çifti yüklenebilir (yalnızca yeni parolayı bilen girebilir)
      h.expectStatus(await h.post(ctx, '/api/me/keys', after.data.token, h.keyPair()), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('geçici parolayı bilen sahip kişinin yeni kimlik anahtarını sessizce kuramaz', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const member = await h.addUser(ctx, owner.token, 'ayse')
      const reset = await h.post(ctx, '/api/users/reset-password', owner.token, { userId: member.user.id })
      const tempKey = (await tempAuthKey(ctx, 'ayse', reset.data.tempPassword))
      // Sahip geçici parolayla kişiden önce girer ve kendi anahtar çiftini yüklemeye çalışır
      const planted = await loginRaw(ctx, 'ayse', tempKey)
      h.expectStatus(planted, 200)
      h.expectStatus(await h.post(ctx, '/api/me/keys', planted.data.token, h.keyPair()), 409, 'password_change_required')
      h.expectStatus(await h.post(ctx, '/api/logout', planted.data.token, {}), 200)
      // Kişi girer, anahtar yoktur ve yeni parolayla kendi çiftini kurar, sahibin oturumları kapanır
      const victim = await loginRaw(ctx, 'ayse', tempKey)
      assert.deepEqual(victim.data.keys, { publicKey: null, wrappedKey: null })
      const ownerSide = await loginRaw(ctx, 'ayse', tempKey)
      const pair = h.keyPair()
      h.expectStatus(await h.post(ctx, '/api/me/password', victim.data.token, Object.assign({ oldAuthKey: tempKey, newAuthKey: h.authKeyFor('kisinin-parolasi'), kdf: KDF }, pair)), 200)
      h.expectStatus(await h.get(ctx, '/api/state', ownerSide.data.token), 401, 'invalid_token')
      h.expectStatus(await loginRaw(ctx, 'ayse', tempKey), 401, 'bad_credentials')
    } finally {
      await ctx.cleanup()
    }
  })

  it('eski kayıtlar: yükseltmeden önce sıfırlanmış, anahtarı olmayan hesap yeni parola bekler', async () => {
    let ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const member = await h.addUser(ctx, owner.token, 'ayse')
      await ctx.stop()
      const statePath = path.join(ctx.dataDir, 'state.json')
      const data = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      const rec = data.users.find((u) => u.id === member.user.id)
      // Yükseltmeden önce sıfırlanmış hesap: anahtar yok, resetPending alanı yok
      rec.publicKey = null
      rec.wrappedKey = null
      delete rec.resetPending
      delete data.users.find((u) => u.id === owner.user.id).resetPending
      fs.writeFileSync(statePath, JSON.stringify(data))
      ctx = await h.startServer({}, ctx.root)
      const relog = await h.login(ctx, 'ayse')
      assert.equal(relog.data.resetPending, true)
      h.expectStatus(await h.post(ctx, '/api/me/keys', relog.data.token, h.keyPair()), 409, 'password_change_required')
      const ownerLogin = await h.login(ctx, 'sahip')
      assert.equal(ownerLogin.data.resetPending, undefined)
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('kişisel anahtarlar, kimlik kaydı ve profiller', () => {
  it('kimlik kaydı biçim ve uzunluk doğrulaması, profil sürümü artar', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const body = h.registerBody('ayse', { inviteCode: await h.inviteCodeOf(ctx, owner.token) })
      const member = (await h.post(ctx, '/api/register', null, body)).data
      const kid = '0123456789abcdef'
      const nonce = 'A'.repeat(32)
      const bad = [undefined, null, 42, 'kimlik', h.dmEnvelope(), '1.' + kid.toUpperCase() + '.' + nonce + '.' + 'B'.repeat(24),
        '1.' + kid + '.' + nonce + '.' + 'B'.repeat(2000 - 52 + 1), h.envelope() + ' ']
      for (const identity of bad) {
        h.expectStatus(await h.post(ctx, '/api/me/identity', member.token, { identity }), 400, 'bad_identity')
      }
      const meta0 = (await h.stateOf(ctx, owner.token)).meta
      assert.equal(meta0.users.find((u) => u.id === member.user.id).pv, 0)
      const identity = '1.' + kid + '.' + nonce + '.' + 'B'.repeat(2000 - 52)
      assert.equal(identity.length, 2000)
      h.expectStatus(await h.post(ctx, '/api/me/identity', member.token, { identity }), 200)
      const meta1 = (await h.stateOf(ctx, owner.token)).meta
      assert.equal(meta1.users.find((u) => u.id === member.user.id).pv, 1)

      const res = await h.get(ctx, '/api/profiles?ids=' + member.user.id + ',' + owner.user.id, owner.token)
      h.expectStatus(res, 200)
      const mine = res.data.profiles.find((p) => p.id === member.user.id)
      assert.deepEqual(mine, { id: member.user.id, pv: 1, profile: null, avatarUploadId: null, publicKey: body.publicKey, identity })
      // Sarılmış özel anahtar yalnızca sahibine (giriş ve durum yanıtında) gider
      assert.ok(!res.text.includes(body.wrappedKey))
      const ownerState = await h.get(ctx, '/api/state', owner.token)
      assert.ok(!ownerState.text.includes(body.wrappedKey))
      assert.deepEqual((await h.stateOf(ctx, member.token)).keys, { publicKey: body.publicKey, wrappedKey: body.wrappedKey })
      // Anahtar çifti varken yeni anahtar yüklenemez
      h.expectStatus(await h.post(ctx, '/api/me/keys', member.token, h.keyPair()), 409, 'keys_exist')
      h.expectStatus(await h.post(ctx, '/api/me/keys', member.token, { publicKey: 'x', wrappedKey: 'y' }), 400, 'bad_keys')
    } finally {
      await ctx.cleanup()
    }
  })

  it('profil listesi: kimlik ayrıştırma, yineleme, bilinmeyen, engelli ve silinmiş hesaplar', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const ayse = await h.addUser(ctx, owner.token, 'ayse')
      const mehmet = await h.addUser(ctx, owner.token, 'mehmet')
      const ali = await h.addUser(ctx, owner.token, 'ali')
      for (const q of ['', '?ids=', '?ids=abc', '?ids=1,,2', '?ids=0', '?ids=-1', '?ids=1.5', '?ids=' + h.times(101).map((i) => i + 1).join(',')]) {
        h.expectStatus(await h.get(ctx, '/api/profiles' + q, owner.token), 400, 'bad_request')
      }
      h.expectStatus(await h.get(ctx, '/api/profiles?ids=1'), 401, 'invalid_token')
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: mehmet.user.id, banned: true }), 200)
      h.expectStatus(await h.post(ctx, '/api/me/delete', ali.token, { authKey: h.authKeyFor(PASSWORD) }), 200)
      const ids = [ayse.user.id, ayse.user.id, mehmet.user.id, ali.user.id, 99, owner.user.id]
      const res = await h.get(ctx, '/api/profiles?ids=' + ids.join(','), ayse.token)
      h.expectStatus(res, 200)
      assert.deepEqual(res.data.profiles.map((p) => p.id), [ayse.user.id, owner.user.id])
      for (const p of res.data.profiles) {
        assert.deepEqual(Object.keys(p).sort(), ['avatarUploadId', 'id', 'identity', 'profile', 'publicKey', 'pv'])
      }
      const hundred = await h.get(ctx, '/api/profiles?ids=' + h.times(100).map((i) => i + 1).join(','), ayse.token)
      h.expectStatus(hundred, 200)
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('eski veya eksik hesap kayıtları', () => {
  it('anahtar alanları olmayan hesap açılışta tamamlanır, giriş için sıfırlama gerekir', async () => {
    let ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const ayse = await h.addUser(ctx, owner.token, 'ayse')
      await ctx.stop()
      const file = path.join(ctx.dataDir, 'state.json')
      const disk = JSON.parse(fs.readFileSync(file, 'utf8'))
      const user = disk.users.find((u) => u.id === ayse.user.id)
      for (const field of ['kdf', 'publicKey', 'wrappedKey', 'identity', 'allowMemberDms', 'pv', 'deleted', 'key']) delete user[field]
      disk.users.find((u) => u.id === owner.user.id).kdf = { salt: 'bozuk', N: 16384, r: 8, p: 1 }
      delete disk.serverSecret
      delete disk.friendships
      delete disk.blocks
      fs.writeFileSync(file, JSON.stringify(disk))
      ctx = await ctx.restart()
      assert.ok(ctx.log.lines.warn.some((line) => /anahtar türetme ayarları geçersiz/.test(line)))
      // Eksik ayarlı hesaplar için ön giriş sahte tuz verir, giriş başarısız olur
      assert.notEqual((await prelogin(ctx, 'ayse')).data.kdf.salt, KDF.salt)
      h.expectStatus(await loginRaw(ctx, 'ayse', h.authKeyFor(PASSWORD)), 401, 'bad_credentials')
      h.expectStatus(await loginRaw(ctx, 'sahip', h.authKeyFor(PASSWORD)), 401, 'bad_credentials')
      // Mevcut oturum çalışır, sıfırlama hesabı yeniden kullanılabilir yapar
      const st = await h.stateOf(ctx, ayse.token)
      assert.deepEqual(st.keys, { publicKey: null, wrappedKey: null })
      assert.equal(st.private.allowMemberDms, true)
      const reset = await h.post(ctx, '/api/users/reset-password', owner.token, { userId: ayse.user.id })
      h.expectStatus(reset, 200)
      h.expectStatus(await h.login(ctx, 'ayse', reset.data.tempPassword), 200)
      await ctx.server.flush()
      const fixed = readState(ctx)
      assert.match(fixed.serverSecret, /^[0-9a-f]{64}$/)
      assert.deepEqual(fixed.friendships, [])
      assert.equal(fixed.users.find((u) => u.id === owner.user.id).kdf, null)
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('kullanıcı adı değiştirme ve hesap silme', () => {
  it('kullanıcı adı authKey ile değişir, eski ad serbest kalır', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const ayse = await h.addUser(ctx, owner.token, 'ayse')
      const authKey = h.authKeyFor(PASSWORD)
      const change = (name, key) => h.post(ctx, '/api/me/username', ayse.token, { name, authKey: key || authKey })
      h.expectStatus(await change('ayse.yilmaz', h.authKeyFor('yanlis-parola')), 401, 'bad_credentials')
      h.expectStatus(await change('Ayşe'), 400, 'invalid_name')
      h.expectStatus(await change('sahip'), 409, 'name_taken')
      const res = await change('Ayse.Yilmaz')
      h.expectStatus(res, 200)
      assert.deepEqual(res.data.user, { id: ayse.user.id, name: 'ayse.yilmaz', role: 'member' })
      h.expectStatus(await change('ayse.yilmaz'), 200)
      const meta = (await h.stateOf(ctx, owner.token)).meta
      assert.equal(meta.users.find((u) => u.id === ayse.user.id).name, 'ayse.yilmaz')
      h.expectStatus(await h.login(ctx, 'ayse'), 401)
      h.expectStatus(await h.login(ctx, 'ayse.yilmaz'), 200)
      assert.notEqual((await prelogin(ctx, 'ayse')).data.kdf.salt, KDF.salt)
      // Eski ad başka bir hesap tarafından alınabilir
      await h.addUser(ctx, owner.token, 'ayse')
    } finally {
      await ctx.cleanup()
    }
  })

  it('hesap silme: sahip silemez, ad serbest kalır, mesajlar kalır, oturumlar düşer', async () => {
    let ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const ayse = await h.addUser(ctx, owner.token, 'ayse')
      const second = await h.login(ctx, 'ayse')
      const m = await h.sendMessage(ctx, ayse.token, 1)
      const authKey = h.authKeyFor(PASSWORD)
      h.expectStatus(await h.post(ctx, '/api/me/delete', owner.token, { authKey }), 403, 'owner_cannot_delete')
      h.expectStatus(await h.post(ctx, '/api/me/delete', ayse.token, { authKey: h.authKeyFor('yanlis-parola') }), 401, 'bad_credentials')
      h.expectStatus(await h.post(ctx, '/api/me/delete', ayse.token, {}), 401, 'bad_credentials')
      h.expectStatus(await h.post(ctx, '/api/me/delete', ayse.token, { authKey }), 200)
      h.expectStatus(await h.get(ctx, '/api/state', ayse.token), 401, 'invalid_token')
      h.expectStatus(await h.get(ctx, '/api/state', second.data.token), 401, 'invalid_token')
      h.expectStatus(await h.login(ctx, 'ayse'), 401, 'bad_credentials')
      const meta = (await h.stateOf(ctx, owner.token)).meta
      assert.ok(!meta.users.some((u) => u.id === ayse.user.id))
      const list = await h.get(ctx, '/api/messages?channel=1', owner.token)
      assert.deepEqual(list.data.messages.map((x) => [x.id, x.authorId]), [[m.id, ayse.user.id]])
      // Sahip silinmiş hesabın parolasını sıfırlayamaz, rol veremez
      h.expectStatus(await h.post(ctx, '/api/users/reset-password', owner.token, { userId: ayse.user.id }), 404, 'user_not_found')
      h.expectStatus(await h.post(ctx, '/api/users/role', owner.token, { userId: ayse.user.id, role: 'admin' }), 404, 'user_not_found')
      await ctx.server.flush()
      const diskUser = readState(ctx).users.find((u) => u.id === ayse.user.id)
      assert.equal(diskUser.deleted, true)
      assert.equal(diskUser.name, '')
      assert.equal(diskUser.passHash, null)
      // Ad yeniden kullanılabilir, yeni hesap yeni kimlik alır, yeniden başlatma sorun çıkarmaz
      const again = await h.addUser(ctx, owner.token, 'ayse')
      assert.notEqual(again.user.id, ayse.user.id)
      ctx = await ctx.restart()
      h.expectStatus(await h.login(ctx, 'ayse'), 200)
      const meta2 = (await h.stateOf(ctx, owner.token)).meta
      assert.deepEqual(meta2.users.map((u) => u.name).sort(), ['ayse', 'sahip'])
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('türetme gücü yükseltmesi', () => {
  // Aynı parolayla yeni tuz ve N, aynı özel anahtarın yeniden sarılmış hâli (istemci upgradeKdf)
  function upgradeBody (password, n, extra) {
    const kdf = { salt: crypto.randomBytes(16).toString('base64url'), N: n || 65536, r: 8, p: 1 }
    return Object.assign({
      oldAuthKey: h.authKeyFor(password || h.PASSWORD),
      oldSalt: h.KDF.salt,
      newAuthKey: h.deriveKeys(password || h.PASSWORD, kdf.salt, kdf.N).authKey,
      kdf,
      wrappedKey: h.keyPair().wrappedKey
    }, extra || {})
  }

  it('eski ayarlı hesap aynı parolayla güçlenir, diğer oturumlar açık kalır, eski authKey geçmez', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const other = await h.login(ctx, 'sahip')
      h.expectStatus(other, 200)
      const body = upgradeBody()
      const res = await h.post(ctx, '/api/me/kdf', owner.token, body)
      h.expectStatus(res, 200)
      assert.match(res.data.device, /^[0-9a-f]+\.[A-Za-z0-9_-]+$/)
      // Diğer oturum kapanmadı
      h.expectStatus(await h.get(ctx, '/api/state', other.data.token), 200)
      const pre = await prelogin(ctx, 'sahip')
      assert.deepEqual(pre.data.kdf, body.kdf)
      const st = readState(ctx)
      assert.equal(st.users[0].wrappedKey, body.wrappedKey)
      // Giriş cihazı dönemi karmanın kendisi değil, özetidir: eski zayıf karma diskte kalmaz
      assert.match(st.users[0].credEpoch, /^[0-9a-f]{64}$/)
      h.expectStatus(await loginRaw(ctx, 'sahip', body.newAuthKey), 200)
      h.expectStatus(await loginRaw(ctx, 'sahip', h.authKeyFor(h.PASSWORD)), 401, 'bad_credentials')
      // Ayar yalnızca güçlenir: aynı N ile ikinci yükseltme reddedilir
      const again = upgradeBody(h.PASSWORD, 65536, { oldAuthKey: body.newAuthKey })
      h.expectStatus(await h.post(ctx, '/api/me/kdf', owner.token, again), 400, 'bad_kdf')
    } finally {
      await ctx.cleanup()
    }
  })

  it('yükseltme diğer cihazların giriş işaretini geçersiz kılmaz, saldırı sürerken o cihaz yine girebilir', async () => {
    const ctx = await h.startServer({ loginFailLimit: 10 })
    try {
      const owner = await h.setupOwner(ctx)
      const other = await h.login(ctx, 'sahip', h.PASSWORD, { 'x-forwarded-for': '192.0.2.1' })
      h.expectStatus(other, 200)
      const otherDevice = other.data.device
      const body = upgradeBody()
      h.expectStatus(await h.post(ctx, '/api/me/kdf', owner.token, body), 200)
      // Saldırgan hesap adı sınırını doldurur, işaretsiz girişler durur
      for (const i of h.times(20)) await loginRaw(ctx, 'sahip', 'f'.repeat(64), { 'x-forwarded-for': '198.51.100.' + (i + 1) })
      h.expectStatus(await loginRaw(ctx, 'sahip', body.newAuthKey, { 'x-forwarded-for': '203.0.113.50' }), 429, 'rate_limited')
      // Diğer cihazın yükseltmeden önce aldığı işaret geçerlidir ve korunur
      const again = await h.request(ctx, 'POST', '/api/login', { headers: { 'x-forwarded-for': '203.0.113.51' }, body: { name: 'sahip', authKey: body.newAuthKey, device: otherDevice } })
      h.expectStatus(again, 200)
      assert.equal(again.data.device, otherDevice)
    } finally {
      await ctx.cleanup()
    }
  })

  it('yükseltme yalnızca varsayılan N\'ye ve bir kez yapılır, değişmiş tuzla gelen istek hatalı deneme sayılmaz', async () => {
    const ctx = await h.startServer({ loginFailLimit: 2 })
    try {
      const owner = await h.setupOwner(ctx)
      h.expectStatus(await h.post(ctx, '/api/me/kdf', owner.token, upgradeBody(h.PASSWORD, 32768)), 400, 'bad_kdf')
      // Başka bir cihaz yükseltmiş gibi: eski tuz tutmuyor, sayaç artmaz (sınır 2 olduğu hâlde üç kez denenir)
      for (const i of h.times(3)) h.expectStatus(await h.post(ctx, '/api/me/kdf', owner.token, upgradeBody(h.PASSWORD, 65536, { oldSalt: 'A'.repeat(22) + i })), 409, 'bad_kdf')
      h.expectStatus(await h.post(ctx, '/api/me/kdf', owner.token, upgradeBody()), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('parola değişince cihaz dönemi rastgele bir değer olur, hesap silinince dönem de silinir', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const ayse = await h.addUser(ctx, owner.token, 'ayse')
      const kdf = { salt: crypto.randomBytes(16).toString('base64url'), N: 65536, r: 8, p: 1 }
      const newKey = h.deriveKeys('yeni-parola-1', kdf.salt, kdf.N).authKey
      h.expectStatus(await h.post(ctx, '/api/me/password', ayse.token, { oldAuthKey: h.authKeyFor(h.PASSWORD), newAuthKey: newKey, kdf, wrappedKey: h.keyPair().wrappedKey }), 200)
      await ctx.server.flush()
      assert.match(readState(ctx).users.find((u) => u.id === ayse.user.id).credEpoch, /^[0-9a-f]{32}$/)
      h.expectStatus(await h.post(ctx, '/api/me/delete', ayse.token, { authKey: newKey }), 200)
      await ctx.server.flush()
      const gone = readState(ctx).users.find((u) => u.id === ayse.user.id)
      assert.equal(gone.deleted, true)
      assert.equal('credEpoch' in gone, false)
    } finally {
      await ctx.cleanup()
    }
  })

  it('zayıflatma, hatalı parola, eksik veya fazla anahtar alanı ve geçici parola reddedilir', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const ayse = await h.addUser(ctx, owner.token, 'ayse')
      // Aynı N (16384) yükseltme sayılmaz
      h.expectStatus(await h.post(ctx, '/api/me/kdf', ayse.token, upgradeBody(h.PASSWORD, 16384)), 400, 'bad_kdf')
      h.expectStatus(await h.post(ctx, '/api/me/kdf', ayse.token, upgradeBody(h.PASSWORD, 65536, { oldAuthKey: h.authKeyFor('yanlis-parola') })), 401, 'bad_credentials')
      h.expectStatus(await h.post(ctx, '/api/me/kdf', ayse.token, upgradeBody(h.PASSWORD, 65536, { wrappedKey: undefined })), 400, 'bad_keys')
      h.expectStatus(await h.post(ctx, '/api/me/kdf', ayse.token, upgradeBody(h.PASSWORD, 65536, { publicKey: h.keyPair().publicKey })), 400, 'bad_keys')
      // Hiçbiri hesabı değiştirmedi
      assert.equal((await prelogin(ctx, 'ayse')).data.kdf.N, 16384)
      // Geçici paroladaki hesap önce parolasını değiştirmelidir
      const reset = await h.post(ctx, '/api/users/reset-password', owner.token, { userId: ayse.user.id })
      h.expectStatus(reset, 200)
      const tempKey = await tempAuthKey(ctx, 'ayse', reset.data.tempPassword)
      const login = await loginRaw(ctx, 'ayse', tempKey)
      h.expectStatus(login, 200)
      const body = upgradeBody(h.PASSWORD, 65536, { oldAuthKey: tempKey, wrappedKey: undefined })
      h.expectStatus(await h.post(ctx, '/api/me/kdf', login.data.token, body), 409, 'password_change_required')
    } finally {
      await ctx.cleanup()
    }
  })
})
