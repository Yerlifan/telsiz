'use strict'

// Güvenlikle ilgili değişikliklerin dayanıklılığı ve genel kaynak sınırları:
// başarı yanıtı state.json diske yazıldıktan sonra gelir, yazım hatasında 500 döner ve değişiklik
// bellekte kalıp sonradan yazılır. Kullanıcı başına yükleme kotası ve toplam mesaj sınırı.
// Sabit beklemeler yerine yanıt geldiği anda diskteki dosya okunur, sayaçlar başarılı taşımaları sayar.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const auth = require('../src/auth')
const i18n = require('../src/i18n')
const h = require('./server-yardimci')

function diskState (ctx) {
  return JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'state.json'), 'utf8'))
}

function diskUser (ctx, id) {
  return diskState(ctx).users.find((u) => u.id === id)
}

function patchRename (replacement) {
  const original = fs.promises.rename
  fs.promises.rename = replacement(original)
  return () => {
    fs.promises.rename = original
  }
}

function isStateFile (to) {
  return path.basename(String(to)) === 'state.json'
}

// İsteği gönderir, yanıt geldiği anda (zamanlayıcılar araya girmeden) diskteki durumu okur
async function postAndRead (ctx, urlPath, token, body) {
  const res = await h.post(ctx, urlPath, token, body)
  return { res, disk: diskState(ctx) }
}

async function ownerAndMember (ctx) {
  const owner = await h.setupOwner(ctx)
  const member = await h.addUser(ctx, owner.token, 'uye')
  // Önceki kayıt ve giriş yazımları bitsin, aşağıdaki denetimler yalnızca isteğin etkisini görsün
  await ctx.server.flush()
  return { owner, member }
}

describe('güvenlikle ilgili değişikliklerin dayanıklılığı', () => {
  it('çıkış, oturum kapatma ve parola değişikliği yanıtı diske yazıldıktan sonra gelir', async () => {
    const ctx = await h.startServer()
    try {
      const { owner } = await ownerAndMember(ctx)

      const extra = (await h.login(ctx, 'sahip')).data.token
      await ctx.server.flush()
      const extraHash = auth.hashToken(extra)
      assert.ok(diskState(ctx).sessions.some((s) => s.hash === extraHash))
      let r = await postAndRead(ctx, '/api/logout', extra)
      h.expectStatus(r.res, 200)
      assert.equal(r.disk.sessions.some((s) => s.hash === extraHash), false)

      const second = (await h.login(ctx, 'sahip')).data.token
      await ctx.server.flush()
      assert.equal(diskState(ctx).sessions.filter((s) => s.userId === owner.user.id).length, 2)
      r = await postAndRead(ctx, '/api/me/sessions/revoke', owner.token, { others: true })
      h.expectStatus(r.res, 200)
      assert.equal(r.res.data.revoked, 1)
      assert.deepEqual(r.disk.sessions.filter((s) => s.userId === owner.user.id).map((s) => s.hash), [auth.hashToken(owner.token)])
      h.expectStatus(await h.get(ctx, '/api/state', second), 401, 'invalid_token')

      await h.login(ctx, 'sahip')
      await ctx.server.flush()
      const oldHash = diskUser(ctx, owner.user.id).passHash
      const kdf = { salt: crypto.randomBytes(16).toString('base64url'), N: 16384, r: 8, p: 1 }
      r = await postAndRead(ctx, '/api/me/password', owner.token, {
        oldAuthKey: h.authKeyFor(h.PASSWORD), newAuthKey: crypto.randomBytes(32).toString('hex'), kdf, wrappedKey: h.keyPair().wrappedKey
      })
      h.expectStatus(r.res, 200)
      const saved = r.disk.users.find((u) => u.id === owner.user.id)
      assert.notEqual(saved.passHash, oldHash)
      assert.deepEqual(saved.kdf, kdf)
      assert.equal(r.disk.sessions.filter((s) => s.userId === owner.user.id).length, 1)
    } finally {
      await ctx.cleanup()
    }
  })

  it('engelleme, sunucudan engelleme, rol, parola sıfırlama, davet kodu ve grup anahtarı diske yazılmadan yanıtlanmaz', async () => {
    const ctx = await h.startServer()
    try {
      const { owner, member } = await ownerAndMember(ctx)
      const memberId = member.user.id

      let r = await postAndRead(ctx, '/api/blocks/add', owner.token, { userId: memberId })
      h.expectStatus(r.res, 200)
      assert.equal(r.res.data.state, 'blocked')
      assert.ok(r.disk.blocks.some((b) => b.by === owner.user.id && b.user === memberId))

      r = await postAndRead(ctx, '/api/users/role', owner.token, { userId: memberId, role: 'admin' })
      h.expectStatus(r.res, 200)
      assert.equal(r.disk.users.find((u) => u.id === memberId).role, 'admin')
      h.expectStatus(await h.post(ctx, '/api/users/role', owner.token, { userId: memberId, role: 'member' }), 200)

      const oldHash = diskUser(ctx, memberId).passHash
      r = await postAndRead(ctx, '/api/users/reset-password', owner.token, { userId: memberId })
      h.expectStatus(r.res, 200)
      assert.notEqual(r.disk.users.find((u) => u.id === memberId).passHash, oldHash)
      assert.equal(r.disk.sessions.some((s) => s.userId === memberId), false)

      r = await postAndRead(ctx, '/api/users/ban', owner.token, { userId: memberId, banned: true })
      h.expectStatus(r.res, 200)
      assert.equal(r.disk.users.find((u) => u.id === memberId).banned, true)

      r = await postAndRead(ctx, '/api/invite/rotate', owner.token)
      h.expectStatus(r.res, 200)
      assert.equal(r.disk.inviteCode, r.res.data.inviteCode)

      const kid = crypto.randomBytes(8).toString('hex')
      r = await postAndRead(ctx, '/api/settings', owner.token, { activeKid: kid })
      h.expectStatus(r.res, 200)
      assert.equal(r.disk.activeKid, kid)
    } finally {
      await ctx.cleanup()
    }
  })

  it('hesap silme yanıtı diske yazıldıktan sonra gelir', async () => {
    const ctx = await h.startServer()
    try {
      const { member } = await ownerAndMember(ctx)
      const r = await postAndRead(ctx, '/api/me/delete', member.token, { authKey: h.authKeyFor(h.PASSWORD) })
      h.expectStatus(r.res, 200)
      const saved = r.disk.users.find((u) => u.id === member.user.id)
      assert.equal(saved.deleted, true)
      assert.equal(saved.passHash, null)
      assert.equal(r.disk.sessions.some((s) => s.userId === member.user.id), false)
    } finally {
      await ctx.cleanup()
    }
  })

  it('aynı anda gelen istekler ortak yazımı paylaşır', async () => {
    const ctx = await h.startServer()
    let renames = 0
    const restore = patchRename((original) => async function (from, to) {
      const result = await original.call(this, from, to)
      if (isStateFile(to)) renames++
      return result
    })
    try {
      const { owner } = await ownerAndMember(ctx)
      renames = 0
      const results = await Promise.all(h.times(8).map(() => h.post(ctx, '/api/invite/rotate', owner.token)))
      for (const res of results) h.expectStatus(res, 200)
      const disk = diskState(ctx)
      // Son yanıtın kodu diskte, yazım sayısı istek sayısından az veya eşit (istekler ayrı bağlantılarla
      // geldiği için kaç yazımda birleşecekleri zamanlamaya bağlıdır)
      assert.ok(results.some((res) => res.data.inviteCode === disk.inviteCode))
      assert.ok(renames >= 1 && renames <= 8, String(renames))
    } finally {
      restore()
      await ctx.cleanup()
    }
  })

  it('durum yazılamazsa 500 server_error döner, değişiklik bellekte kalır ve sonra yazılır', async () => {
    const ctx = await h.startServer()
    ctx.allowErrors = true
    let failing = false
    const restore = patchRename((original) => async function (from, to) {
      if (failing && isStateFile(to)) {
        const err = new Error('disk hatası (test)')
        err.code = 'EIO'
        throw err
      }
      return original.call(this, from, to)
    })
    try {
      const { owner, member } = await ownerAndMember(ctx)
      const extra = (await h.login(ctx, 'uye')).data.token
      await ctx.server.flush()
      failing = true

      for (const lang of ['tr', 'en']) {
        const res = await h.request(ctx, 'POST', '/api/users/role', {
          token: owner.token,
          headers: { 'accept-language': lang },
          body: { userId: member.user.id, role: lang === 'tr' ? 'admin' : 'member' }
        })
        h.expectStatus(res, 500, 'server_error')
        assert.equal(res.data.error, i18n.t(lang, 'errors.server_error'))
      }
      h.expectStatus(await h.post(ctx, '/api/users/role', owner.token, { userId: member.user.id, role: 'admin' }), 500, 'server_error')
      h.expectStatus(await h.post(ctx, '/api/logout', extra), 500, 'server_error')
      // Bellekteki etki geri alınmaz: oturum kapanmıştır, rol değişmiştir
      h.expectStatus(await h.get(ctx, '/api/state', extra), 401, 'invalid_token')
      const st = await h.stateOf(ctx, owner.token)
      assert.equal(st.meta.users.find((u) => u.id === member.user.id).role, 'admin')
      assert.equal(diskUser(ctx, member.user.id).role, 'member')
      assert.ok(ctx.log.lines.error.length > 0)

      failing = false
      // Sürmekte olan bir yeniden deneme hata bayrağı kalkmadan önce başlamış olabilir, flush başarılı olana kadar denenir
      await h.waitFor(() => ctx.server.flush().then(() => true, () => false))
      assert.equal(diskUser(ctx, member.user.id).role, 'admin')
      assert.equal(diskState(ctx).sessions.some((s) => s.hash === auth.hashToken(extra)), false)
    } finally {
      restore()
      await ctx.cleanup()
    }
  })
})

// Gövdesi parça parça gönderilen (boyutu bildirilmeyen) yükleme
function streamedUpload (ctx, token, bytes) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: ctx.port,
      method: 'POST',
      path: '/api/uploads',
      headers: { 'x-token': token, 'content-type': 'application/octet-stream' },
      agent: false
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode, text, data: JSON.parse(text) })
      })
    })
    req.on('error', (err) => {
      if (err && (err.code === 'ECONNRESET' || err.code === 'EPIPE')) return
      reject(err)
    })
    req.end(bytes)
  })
}

function listUploads (ctx) {
  return fs.readdirSync(path.join(ctx.dataDir, 'uploads')).filter((name) => name.endsWith('.bin'))
}

describe('genel kaynak sınırları', () => {
  it('kullanıcı başına yükleme kotası: dolunca 507 user_quota_full, başka kullanıcı etkilenmez, silinen dosya yer açar', async () => {
    const ctx = await h.startServer({ uploadMaxBytes: 1000, uploadQuotaBytes: 100000, userUploadQuotaBytes: 2000 })
    try {
      const owner = await h.setupOwner(ctx)
      const member = await h.addUser(ctx, owner.token, 'uye')
      const first = await h.upload(ctx, owner.token, crypto.randomBytes(900))
      h.expectStatus(first, 200)
      h.expectStatus(await h.upload(ctx, owner.token, crypto.randomBytes(900)), 200)
      for (const lang of ['tr', 'en']) {
        const res = await h.request(ctx, 'POST', '/api/uploads', {
          token: owner.token,
          raw: crypto.randomBytes(900),
          headers: { 'content-type': 'application/octet-stream', 'accept-language': lang }
        })
        h.expectStatus(res, 507, 'user_quota_full')
        assert.equal(res.data.error, i18n.t(lang, 'errors.user_quota_full'))
        assert.notEqual(res.data.error, i18n.t(lang, 'errors.quota_full'))
      }
      // Boyut bildirilmeden gönderilip okunurken kota aşılırsa
      h.expectStatus(await streamedUpload(ctx, owner.token, crypto.randomBytes(900)), 507, 'user_quota_full')
      h.expectStatus(await h.upload(ctx, member.token, crypto.randomBytes(900)), 200)

      const m = await h.sendMessage(ctx, owner.token, 1, { uploads: [first.data.id] })
      h.expectStatus(await h.post(ctx, '/api/messages/delete', owner.token, { id: m.id }), 200)
      h.expectStatus(await h.upload(ctx, owner.token, crypto.randomBytes(900)), 200)
      h.expectStatus(await h.upload(ctx, owner.token, crypto.randomBytes(900)), 507, 'user_quota_full')
    } finally {
      await ctx.cleanup()
    }
  })

  it('kullanıcı kotası yeniden başlatmadan sonra kayıtlı yüklemelerden hesaplanır, verilmezse tek dosya sınırından küçük olmaz', async () => {
    const ctx = await h.startServer({ uploadMaxBytes: 1000, uploadQuotaBytes: 100000, userUploadQuotaBytes: 1500 })
    let next = null
    try {
      const owner = await h.setupOwner(ctx)
      const id = (await h.upload(ctx, owner.token, crypto.randomBytes(900))).data.id
      await h.sendMessage(ctx, owner.token, 1, { uploads: [id] })
      next = await ctx.restart()
      const relog = (await h.login(next, 'sahip')).data.token
      h.expectStatus(await h.upload(next, relog, crypto.randomBytes(900)), 507, 'user_quota_full')
      h.expectStatus(await h.upload(next, relog, crypto.randomBytes(500)), 200)
    } finally {
      if (next) await next.cleanup()
      else await ctx.cleanup()
    }

    const big = await h.startServer({ uploadMaxBytes: 600 * 1024 * 1024, uploadQuotaBytes: 1024 * 1024 * 1024 })
    try {
      const owner = await h.setupOwner(big)
      // Varsayılan 512 MB kota 600 MB tek dosya sınırına yükseltilir: bildirilen 550 MB kota yüzünden reddedilmez
      const res = await new Promise((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port: big.port,
          method: 'POST',
          path: '/api/uploads',
          headers: { 'x-token': owner.token, 'content-length': String(550 * 1024 * 1024) },
          agent: false
        })
        req.on('error', reject)
        req.on('response', (r) => {
          r.resume()
          req.destroy()
          resolve(r.statusCode)
        })
        req.write(crypto.randomBytes(10))
        // Gövde tamamlanmadan bağlantı kesilir, sunucu kotayı aşmayan isteği reddetmeden okumaya başlamıştır
        h.waitFor(() => big.server.stats().activeUploads === 1).then(() => {
          req.destroy()
          resolve('okunuyor')
        }, reject)
      })
      assert.equal(res, 'okunuyor')
    } finally {
      await big.cleanup()
    }
  })

  it('toplam mesaj sınırı: en büyük kanalın en eski mesajı düşer, eki silinir, silme olayı gider', async () => {
    const ctx = await h.startServer({ maxTotalMessages: 5 })
    try {
      const owner = await h.setupOwner(ctx)
      const initial = await h.stateOf(ctx, owner.token)
      const p = h.poller(ctx, owner.token, initial)
      const up = await h.upload(ctx, owner.token, crypto.randomBytes(100))
      h.expectStatus(up, 200)
      const a1 = await h.sendMessage(ctx, owner.token, 1, { uploads: [up.data.id] })
      const a2 = await h.sendMessage(ctx, owner.token, 1)
      const a3 = await h.sendMessage(ctx, owner.token, 1)
      const b1 = await h.sendMessage(ctx, owner.token, 2)
      const b2 = await h.sendMessage(ctx, owner.token, 2)
      assert.equal(listUploads(ctx).length, 1)
      // Altıncı mesaj: iki kanal eşit (3 ve 3), en eski mesajı daha eski olan 1. kanaldan a1 düşer
      const b3 = await h.sendMessage(ctx, owner.token, 2)
      const ids = async (channel) => (await h.get(ctx, '/api/messages?channel=' + channel, owner.token)).data.messages.map((m) => m.id)
      assert.deepEqual(await ids(1), [a2.id, a3.id])
      assert.deepEqual(await ids(2), [b1.id, b2.id, b3.id])
      await h.waitFor(() => listUploads(ctx).length === 0)
      const events = []
      await h.waitFor(async () => {
        const res = await p.poll()
        for (const e of (res.data && res.data.events) || []) events.push(e)
        return events.some((e) => e.type === 'del' && e.messageId === a1.id)
      })

      // Yeni mesaj reddedilmez: kanallar yine eşit (3 ve 3), en eski mesaj (a2) düşer
      const a4 = await h.sendMessage(ctx, owner.token, 1)
      assert.deepEqual(await ids(1), [a3.id, a4.id])
      assert.deepEqual(await ids(2), [b1.id, b2.id, b3.id])

      // Düşen mesajlar yeniden başlatmadan sonra geri gelmez
      const next = await ctx.restart()
      try {
        const token = (await h.login(next, 'sahip')).data.token
        const after = async (channel) => (await h.get(next, '/api/messages?channel=' + channel, token)).data.messages.map((m) => m.id)
        assert.deepEqual(await after(1), [a3.id, a4.id])
        assert.deepEqual(await after(2), [b1.id, b2.id, b3.id])
      } finally {
        await next.cleanup()
      }
    } catch (err) {
      await ctx.cleanup().catch(() => {})
      throw err
    }
  })

  it('maxTotalMessages ve userUploadQuotaBytes pozitif tam sayı olmalıdır', async () => {
    const { createChatServer, DEFAULTS } = require('../src/app')
    assert.equal(DEFAULTS.maxTotalMessages, 500000)
    assert.equal(DEFAULTS.userUploadQuotaBytes, 512 * 1024 * 1024)
    for (const bad of [0, -1, 1.5, '10']) {
      await assert.rejects(createChatServer({ dataDir: 'kullanilmaz', maxTotalMessages: bad }), /maxTotalMessages must be a positive integer/)
      await assert.rejects(createChatServer({ dataDir: 'kullanilmaz', userUploadQuotaBytes: bad }), /userUploadQuotaBytes must be a positive integer/)
    }
  })
})

describe('yedekleme belgeleri', () => {
  it('belgelenen yedek komutları arşivi yalnızca sahibinin okuyabileceği biçimde oluşturur', () => {
    // Arşiv parola özetlerini ve sarılmış kişisel anahtarları içerir, 0700 veri klasörünün korumasını kaybetmemelidir
    for (const file of ['docs/DEPLOYMENT.md', 'docs/KURULUM.md']) {
      const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
      const lines = text.split('\n').filter((line) => /\btar czf\b/.test(line))
      assert.ok(lines.length >= 2, file)
      for (const line of lines) assert.match(line, /umask 077 && tar czf /, file)
    }
  })
})
