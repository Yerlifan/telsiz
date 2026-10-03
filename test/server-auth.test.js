'use strict'

// Hesaplar ve oturumlar: kurulum kodu, davet kodu, ad ve parola kuralları, giriş,
// hız sınırları, token'ın diskte saklanmaması, kalıcılık, çıkış, engelleme, parola işlemleri.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const h = require('./server-yardimci')

const { PASSWORD, SETUP_CODE } = h

describe('kurulum ve kayıt', () => {
  it('kurulum kodu ile sahip oluşturulur, kod yeniden kullanılamaz', async () => {
    const ctx = await h.startServer()
    try {
      assert.equal(ctx.server.setupCode, SETUP_CODE)
      let info = await h.get(ctx, '/api/info')
      h.expectStatus(info, 200)
      assert.equal(info.data.setupRequired, true)
      assert.equal(info.data.serverName, 'Telsiz')
      assert.deepEqual(info.data.limits, {
        nameMin: 2,
        nameMax: 20,
        passwordMin: 8,
        passwordMax: 128,
        messageMaxChars: 2000,
        maxBodyChars: 24000,
        uploadMaxBytes: 25 * 1024 * 1024 + 16,
        maxUploadsPerMessage: 10,
        channelNameMax: 30,
        serverNameMax: 40
      })

      // Kod büyük/küçük harf ve tire duyarsız, O ve 0, I/L ve 1 eşlenir
      const wrong = await h.post(ctx, '/api/register', null, { name: 'Sahip', password: PASSWORD, setupCode: 'ABCDE-FGHJM' })
      h.expectStatus(wrong, 403, 'bad_code')
      const missing = await h.post(ctx, '/api/register', null, { name: 'Sahip', password: PASSWORD })
      h.expectStatus(missing, 403, 'bad_code')

      const ok = await h.post(ctx, '/api/register', null, { name: 'Sahip', password: PASSWORD, setupCode: ' abcde fghjk ' })
      h.expectStatus(ok, 200)
      assert.equal(typeof ok.data.token, 'string')
      assert.deepEqual(ok.data.user, { id: 1, name: 'Sahip', role: 'owner' })
      assert.equal(ctx.server.setupCode, null)

      info = await h.get(ctx, '/api/info')
      assert.equal(info.data.setupRequired, false)

      // Sahip varken kurulum kodu artık işe yaramaz, davet kodu gerekir
      const again = await h.post(ctx, '/api/register', null, { name: 'İkinci', password: PASSWORD, setupCode: SETUP_CODE })
      h.expectStatus(again, 403, 'bad_code')
    } finally {
      await ctx.cleanup()
    }
  })

  it('Crockford eşlemesi: O→0, I ve L→1', async () => {
    const ctx = await h.startServer({ setupCode: '01ABC-DE1FG' })
    try {
      const res = await h.post(ctx, '/api/register', null, { name: 'Sahip', password: PASSWORD, setupCode: 'oiabc-delfg' })
      h.expectStatus(res, 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('aynı anda iki kurulum isteğinden yalnızca biri sahip olur', async () => {
    const ctx = await h.startServer()
    try {
      const results = await Promise.all([
        h.post(ctx, '/api/register', null, { name: 'Birinci', password: PASSWORD, setupCode: SETUP_CODE }),
        h.post(ctx, '/api/register', null, { name: 'İkinci', password: PASSWORD, setupCode: SETUP_CODE })
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

      h.expectStatus(await h.post(ctx, '/api/register', null, { name: 'Ayşe', password: PASSWORD, inviteCode: 'ZZZZZ-ZZZZZ' }), 403, 'bad_code')
      h.expectStatus(await h.post(ctx, '/api/register', null, { name: 'Ayşe', password: PASSWORD }), 403, 'bad_code')
      h.expectStatus(await h.post(ctx, '/api/register', null, { name: 'Ayşe', password: PASSWORD, inviteCode: 12345 }), 403, 'bad_code')

      const res = await h.post(ctx, '/api/register', null, { name: 'Ayşe', password: PASSWORD, inviteCode: code.toLowerCase() })
      h.expectStatus(res, 200)
      assert.deepEqual(res.data.user, { id: 2, name: 'Ayşe', role: 'member' })

      const rotated = await h.post(ctx, '/api/invite/rotate', owner.token)
      h.expectStatus(rotated, 200)
      assert.notEqual(rotated.data.inviteCode, code)
      h.expectStatus(await h.post(ctx, '/api/register', null, { name: 'Mehmet', password: PASSWORD, inviteCode: code }), 403, 'bad_code')
      h.expectStatus(await h.post(ctx, '/api/register', null, { name: 'Mehmet', password: PASSWORD, inviteCode: rotated.data.inviteCode }), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('ad doğrulama ve Türkçe büyük/küçük harf çakışması', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx, 'İnci')
      const code = await h.inviteCodeOf(ctx, owner.token)
      const register = (name) => h.post(ctx, '/api/register', null, { name, password: PASSWORD, inviteCode: code })

      for (const bad of ['a', 'x'.repeat(21), 'ali<b>', 'ali@veli', '', '   ', 42, null, ['ali'], { a: 1 }, 'a\u0000']) {
        h.expectStatus(await register(bad), 400, 'invalid_name')
      }
      // 'İnci' ile 'inci' Türkçe kurallarla aynı ad
      h.expectStatus(await register('inci'), 409, 'name_taken')
      h.expectStatus(await register('İNCİ'), 409, 'name_taken')

      h.expectStatus(await register('Işık'), 200)
      h.expectStatus(await register('ışık'), 409, 'name_taken')
      h.expectStatus(await register('IŞIK'), 409, 'name_taken')

      // Denetim karakterleri silinir, boşluklar teklenir
      const cleaned = await register('  Ali \u200B  Veli  ')
      h.expectStatus(cleaned, 200)
      assert.equal(cleaned.data.user.name, 'Ali Veli')
      h.expectStatus(await register('ali veli'), 409, 'name_taken')

      // 20 kod noktası sınırı (emoji olmayan çok baytlı harfler)
      h.expectStatus(await register('ş'.repeat(20)), 200)
      h.expectStatus(await register('ğ'.repeat(21)), 400, 'invalid_name')
    } finally {
      await ctx.cleanup()
    }
  })

  it('parola uzunluğu', async () => {
    const ctx = await h.startServer()
    try {
      const reg = (password) => h.post(ctx, '/api/register', null, { name: 'Sahip', password, setupCode: SETUP_CODE })
      h.expectStatus(await reg('1234567'), 400, 'weak_password')
      h.expectStatus(await reg('x'.repeat(129)), 400, 'weak_password')
      h.expectStatus(await reg(12345678), 400, 'weak_password')
      h.expectStatus(await reg(undefined), 400, 'weak_password')
      h.expectStatus(await reg('ü'.repeat(128)), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('kullanıcı sayısı üst sınırı 503 server_full', async () => {
    const ctx = await h.startServer({ maxUsers: 2 })
    try {
      const owner = await h.setupOwner(ctx)
      await h.addUser(ctx, owner.token, 'Ayşe')
      const code = await h.inviteCodeOf(ctx, owner.token)
      h.expectStatus(await h.post(ctx, '/api/register', null, { name: 'Mehmet', password: PASSWORD, inviteCode: code }), 503, 'server_full')
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('giriş ve hız sınırları', () => {
  it('başarılı ve başarısız giriş, genel hata metni', async () => {
    const ctx = await h.startServer()
    try {
      await h.setupOwner(ctx)
      const ok = await h.login(ctx, 'sahip')
      h.expectStatus(ok, 200)
      assert.deepEqual(ok.data.user, { id: 1, name: 'Sahip', role: 'owner' })

      const wrongPass = await h.login(ctx, 'Sahip', 'yanlis-parola')
      const noUser = await h.login(ctx, 'Hayalet', PASSWORD)
      const badName = await h.login(ctx, '<>', PASSWORD)
      for (const res of [wrongPass, noUser, badName]) {
        h.expectStatus(res, 401, 'bad_credentials')
        assert.equal(res.data.error, 'Kullanıcı adı veya parola hatalı.')
      }
      h.expectStatus(await h.post(ctx, '/api/login', null, { name: 'Sahip', password: 12345678 }), 401, 'bad_credentials')
    } finally {
      await ctx.cleanup()
    }
  })

  it('IP başına deneme sınırı (kayıt ve giriş birlikte sayılır)', async () => {
    const ctx = await h.startServer({ authLimit: 3 })
    try {
      const ip1 = { 'x-forwarded-for': '203.0.113.7' }
      const ip2 = { 'cf-connecting-ip': '198.51.100.9' }
      const attempt = (headers) => h.request(ctx, 'POST', '/api/login', { headers, body: { name: 'Yok', password: PASSWORD } })
      h.expectStatus(await h.request(ctx, 'POST', '/api/register', { headers: ip1, body: { name: 'Sahip', password: PASSWORD, setupCode: SETUP_CODE } }), 200)
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

  it('hesap başına başarısız giriş sınırı, başarılı girişte sıfırlanır', async () => {
    const ctx = await h.startServer({ loginFailLimit: 3 })
    try {
      await h.setupOwner(ctx)
      const fromIp = (n) => ({ 'x-forwarded-for': '192.0.2.' + n })
      const tryLogin = (password, n) => h.request(ctx, 'POST', '/api/login', { headers: fromIp(n), body: { name: 'Sahip', password } })
      h.expectStatus(await tryLogin('yanlis-1', 1), 401)
      h.expectStatus(await tryLogin('yanlis-2', 2), 401)
      h.expectStatus(await tryLogin(PASSWORD, 3), 200)
      // Başarılı giriş sayacı sıfırladı
      h.expectStatus(await tryLogin('yanlis-3', 4), 401)
      h.expectStatus(await tryLogin('yanlis-4', 5), 401)
      h.expectStatus(await tryLogin('yanlis-5', 6), 401)
      // Doğru parola da farklı IP'den gelse bile reddedilir
      h.expectStatus(await tryLogin(PASSWORD, 7), 429, 'rate_limited')
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('oturumlar', () => {
  it('token diskte düz saklanmaz, oturum yeniden başlatmadan sonra geçerli', async () => {
    let ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const second = await h.login(ctx, 'Sahip')
      await ctx.server.flush()
      const text = fs.readFileSync(path.join(ctx.dataDir, 'state.json'), 'utf8')
      assert.ok(!text.includes(owner.token))
      assert.ok(!text.includes(second.data.token))
      assert.ok(!text.includes(PASSWORD))
      const hash = crypto.createHash('sha256').update(owner.token).digest('hex')
      const disk = JSON.parse(text)
      assert.ok(disk.sessions.some((s) => s.hash === hash && s.userId === 1))
      assert.match(disk.users[0].passHash, /^scrypt\$1024\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
      for (const s of disk.sessions) assert.deepEqual(Object.keys(s).sort(), ['createdAt', 'hash', 'lastUsed', 'userId'])

      ctx = await ctx.restart()
      const st = await h.stateOf(ctx, owner.token)
      assert.deepEqual(st.me, { id: 1, name: 'Sahip', role: 'owner' })
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
      const other = await h.login(ctx, 'Sahip')
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
      const second = await h.login(ctx, 'Sahip')
      const third = await h.login(ctx, 'Sahip')
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
      const idle = await h.login(ctx, 'Sahip')
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
      const member = await h.addUser(ctx, owner.token, 'Ayşe')
      const st = await h.stateOf(ctx, member.token)
      const p = h.poller(ctx, member.token, st)
      const waiting = h.nextRequest(ctx.server, '/api/poll')
      const pending = p.poll()
      await waiting
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: member.user.id, banned: true }), 200)
      h.expectStatus(await pending, 403, 'banned')
      h.expectStatus(await h.get(ctx, '/api/state', member.token), 401, 'invalid_token')

      h.expectStatus(await h.login(ctx, 'Ayşe'), 403, 'banned')
      h.expectStatus(await h.login(ctx, 'Ayşe', 'yanlis-parola'), 401, 'bad_credentials')

      const meta = (await h.stateOf(ctx, owner.token)).meta
      assert.ok(!meta.users.some((u) => u.id === member.user.id))

      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: member.user.id, banned: false }), 200)
      h.expectStatus(await h.login(ctx, 'Ayşe'), 200)
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: member.user.id, banned: 'evet' }), 400, 'bad_request')
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: 999, banned: true }), 404, 'user_not_found')
    } finally {
      await ctx.cleanup()
    }
  })

  it('sahip parola sıfırlar, geçici parola çalışır, eski oturumlar düşer', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const member = await h.addUser(ctx, owner.token, 'Ayşe')
      const res = await h.post(ctx, '/api/users/reset-password', owner.token, { userId: member.user.id })
      h.expectStatus(res, 200)
      assert.equal(res.data.ok, true)
      assert.match(res.data.tempPassword, /^[A-Za-z0-9]{12}$/)
      h.expectStatus(await h.get(ctx, '/api/state', member.token), 401, 'invalid_token')
      h.expectStatus(await h.login(ctx, 'Ayşe'), 401)
      h.expectStatus(await h.login(ctx, 'Ayşe', res.data.tempPassword), 200)
      h.expectStatus(await h.post(ctx, '/api/users/reset-password', owner.token, { userId: owner.user.id }), 403, 'forbidden')
      h.expectStatus(await h.post(ctx, '/api/users/reset-password', owner.token, { userId: 77 }), 404, 'user_not_found')
    } finally {
      await ctx.cleanup()
    }
  })

  it('kendi parolasını değiştirme: eski parola, zayıf parola, diğer oturumlar', async () => {
    const ctx = await h.startServer({ loginFailLimit: 3 })
    try {
      const owner = await h.setupOwner(ctx)
      const other = await h.login(ctx, 'Sahip')
      h.expectStatus(await h.post(ctx, '/api/me/password', owner.token, { oldPassword: PASSWORD, newPassword: 'kısa' }), 400, 'weak_password')
      const wrong = await h.post(ctx, '/api/me/password', owner.token, { oldPassword: 'yanlis-parola', newPassword: 'yeni-parola-1' })
      h.expectStatus(wrong, 401, 'bad_credentials')
      // Eski parola hatası oturumu düşürmez
      h.expectStatus(await h.get(ctx, '/api/state', owner.token), 200)

      h.expectStatus(await h.post(ctx, '/api/me/password', owner.token, { oldPassword: PASSWORD, newPassword: 'yeni-parola-1' }), 200)
      h.expectStatus(await h.get(ctx, '/api/state', owner.token), 200)
      h.expectStatus(await h.get(ctx, '/api/state', other.data.token), 401, 'invalid_token')
      h.expectStatus(await h.login(ctx, 'Sahip'), 401)
      h.expectStatus(await h.login(ctx, 'Sahip', 'yeni-parola-1'), 200)

      // Hesap başına hatalı deneme sınırı burada da uygulanır
      for (const i of h.times(3)) {
        h.expectStatus(await h.post(ctx, '/api/me/password', owner.token, { oldPassword: 'hatali-' + i, newPassword: 'yeni-parola-2' }), 401)
      }
      h.expectStatus(await h.post(ctx, '/api/me/password', owner.token, { oldPassword: 'yeni-parola-1', newPassword: 'yeni-parola-2' }), 429, 'rate_limited')
    } finally {
      await ctx.cleanup()
    }
  })
})
