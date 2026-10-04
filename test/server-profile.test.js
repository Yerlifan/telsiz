'use strict'

// Profil zarfı ve profil resmi, durum ve görünmezlik, oturum listesi, etiketleri ve kapatma,
// engellenen ve eski kullanıcıların adları.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const auth = require('../src/auth')
const h = require('./server-yardimci')

const UA = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  ps5: 'Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  chromeIpad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  operaWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0',
  edgeXbox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  firefoxIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/605.1.15',
  chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
}

async function group (options) {
  const ctx = await h.startServer(options)
  const owner = await h.setupOwner(ctx)
  const ayse = await h.addUser(ctx, owner.token, 'ayse')
  const mehmet = await h.addUser(ctx, owner.token, 'mehmet')
  return { ctx, owner, ayse, mehmet }
}

async function uploadId (ctx, token, size) {
  const res = await h.upload(ctx, token, crypto.randomBytes(size || 300))
  h.expectStatus(res, 200)
  return res.data.id
}

function setProfile (ctx, token, profile, avatarUploadId) {
  return h.post(ctx, '/api/me/profile', token, { profile, avatarUploadId })
}

async function profileOf (ctx, token, id) {
  const res = await h.get(ctx, '/api/profiles?ids=' + id, token)
  h.expectStatus(res, 200)
  return res.data.profiles[0] || null
}

async function metaUser (ctx, token, id) {
  const st = await h.stateOf(ctx, token)
  return st.meta.users.find((u) => u.id === id) || null
}

function uploadFile (ctx, id) {
  return path.join(ctx.dataDir, 'uploads', id + '.bin')
}

describe('profil zarfı', () => {
  it('zarf doğrulaması, profil sürümü, profil listesi ve meta', async () => {
    const { ctx, owner, ayse } = await group()
    try {
      const bad = [undefined, 42, '', 'duz metin', h.dmEnvelope(), '1.' + 'z'.repeat(16) + '.' + 'a'.repeat(32) + '.' + 'b'.repeat(30),
        h.envelope(6000), { a: 1 }, ['1.']]
      for (const profile of bad) {
        h.expectStatus(await setProfile(ctx, ayse.token, profile, null), 400, 'bad_profile')
      }
      // avatarUploadId alanı zorunludur (null ile profil resmi yok demektir)
      h.expectStatus(await h.post(ctx, '/api/me/profile', ayse.token, { profile: null }), 400, 'bad_avatar')
      const before = await metaUser(ctx, owner.token, ayse.user.id)
      const profile = h.envelope(200)
      const res = await setProfile(ctx, ayse.token, profile, null)
      h.expectStatus(res, 200)
      assert.equal(res.data.pv, before.pv + 1)
      const after = await metaUser(ctx, owner.token, ayse.user.id)
      assert.equal(after.pv, before.pv + 1)
      const listed = await profileOf(ctx, owner.token, ayse.user.id)
      assert.equal(listed.profile, profile)
      assert.equal(listed.avatarUploadId, null)
      assert.equal(listed.pv, after.pv)
      // En uzun izin verilen zarf
      const longest = h.envelope(4400)
      assert.ok(longest.length <= 6000 && longest.length > 5800, String(longest.length))
      h.expectStatus(await setProfile(ctx, ayse.token, longest, null), 200)
      // Değişiklik yoksa sürüm artmaz
      const same = await setProfile(ctx, ayse.token, longest, null)
      h.expectStatus(same, 200)
      assert.equal(same.data.pv, after.pv + 1)
      // null profili siler
      h.expectStatus(await setProfile(ctx, ayse.token, null, null), 200)
      assert.equal((await profileOf(ctx, owner.token, ayse.user.id)).profile, null)
      h.expectStatus(await h.post(ctx, '/api/me/profile', null, { profile: null, avatarUploadId: null }), 401, 'invalid_token')
      // Profil zarfları günlüğe yazılmaz
      const logged = JSON.stringify(ctx.log.lines)
      assert.ok(!logged.includes(profile) && !logged.includes(longest))
    } finally {
      await ctx.cleanup()
    }
  })

  it('profil isteği hız sınırına tabidir', async () => {
    const ctx = await h.startServer({ adminLimit: 2 })
    try {
      const owner = await h.setupOwner(ctx)
      h.expectStatus(await setProfile(ctx, owner.token, h.envelope(), null), 200)
      h.expectStatus(await h.post(ctx, '/api/me/status', owner.token, { status: 'idle' }), 200)
      h.expectStatus(await setProfile(ctx, owner.token, h.envelope(), null), 429, 'rate_limited')
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('profil resmi', () => {
  it('sahiplik, bağlı olmama, boyut sınırı ve mesaja eklenememe', async () => {
    const { ctx, owner, ayse } = await group({ avatarMaxBytes: 1000 })
    try {
      const own = await uploadId(ctx, ayse.token)
      const others = await uploadId(ctx, owner.token)
      const bound = await uploadId(ctx, ayse.token)
      const big = await uploadId(ctx, ayse.token, 1001)
      const text = (await h.stateOf(ctx, ayse.token)).meta.channels.find((c) => c.type === 'text')
      await h.sendMessage(ctx, ayse.token, text.id, { uploads: [bound] })
      for (const id of [others, bound, 'a'.repeat(32), 'yok', 42, {}, own.toUpperCase()]) {
        h.expectStatus(await setProfile(ctx, ayse.token, h.envelope(), id), 400, 'bad_avatar')
      }
      h.expectStatus(await setProfile(ctx, ayse.token, h.envelope(), big), 413, 'avatar_too_large')
      h.expectStatus(await setProfile(ctx, ayse.token, h.envelope(), own), 200)
      assert.equal((await profileOf(ctx, owner.token, ayse.user.id)).avatarUploadId, own)
      // Profil resmi mesaja eklenemez ve başka bir profilde kullanılamaz
      const send = await h.post(ctx, '/api/messages', ayse.token, { channelId: text.id, body: h.envelope(), uploads: [own] })
      h.expectStatus(send, 400, 'bad_uploads')
      h.expectStatus(await setProfile(ctx, owner.token, h.envelope(), own), 400, 'bad_avatar')
      // Herkes indirebilir
      for (const token of [owner.token, ayse.token]) {
        const res = await h.get(ctx, '/api/uploads/' + own, token)
        assert.equal(res.status, 200)
        assert.equal(res.headers['content-type'], 'application/octet-stream')
        assert.equal(res.headers['content-disposition'], 'attachment')
      }
      h.expectStatus(await h.get(ctx, '/api/uploads/' + own), 401, 'invalid_token')
    } finally {
      await ctx.cleanup()
    }
  })

  it('değişen eski profil resmi silinir, profil resmi yetim taramasında silinmez, yeniden başlatmada kalır', async () => {
    const { ctx: first, owner, ayse } = await group({ orphanUploadTtlMs: 100 })
    let ctx = first
    try {
      const a = await uploadId(ctx, ayse.token)
      h.expectStatus(await setProfile(ctx, ayse.token, h.envelope(), a), 200)
      const loose = await uploadId(ctx, ayse.token)
      // Bağlanmamış yükleme süre dolunca silinir, profil resmi kalır
      await h.waitFor(async () => (await h.get(ctx, '/api/uploads/' + loose, ayse.token)).status === 404, { timeout: 5000 })
      assert.equal((await h.get(ctx, '/api/uploads/' + a, owner.token)).status, 200)
      const b = await uploadId(ctx, ayse.token)
      h.expectStatus(await setProfile(ctx, ayse.token, h.envelope(), b), 200)
      await h.waitFor(() => !fs.existsSync(uploadFile(ctx, a)))
      h.expectStatus(await h.get(ctx, '/api/uploads/' + a, ayse.token), 404, 'upload_not_found')
      assert.equal((await h.get(ctx, '/api/uploads/' + b, owner.token)).status, 200)
      // Aynı resim yeniden gönderilebilir, null ile kaldırılır ve silinir
      h.expectStatus(await setProfile(ctx, ayse.token, h.envelope(), b), 200)
      ctx = await ctx.restart()
      assert.equal((await profileOf(ctx, owner.token, ayse.user.id)).avatarUploadId, b)
      assert.equal((await h.get(ctx, '/api/uploads/' + b, owner.token)).status, 200)
      await h.sleep(300)
      assert.equal((await h.get(ctx, '/api/uploads/' + b, owner.token)).status, 200)
      h.expectStatus(await setProfile(ctx, ayse.token, null, null), 200)
      await h.waitFor(() => !fs.existsSync(uploadFile(ctx, b)))
      assert.equal((await profileOf(ctx, owner.token, ayse.user.id)).avatarUploadId, null)
    } finally {
      await ctx.cleanup()
    }
  })

  it('engellenen hesabın profil resmi ve profili gizlenir, silinen hesabınki silinir', async () => {
    const { ctx, owner, ayse, mehmet } = await group()
    try {
      const a = await uploadId(ctx, ayse.token)
      const m = await uploadId(ctx, mehmet.token)
      h.expectStatus(await setProfile(ctx, ayse.token, h.envelope(), a), 200)
      h.expectStatus(await setProfile(ctx, mehmet.token, h.envelope(), m), 200)
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: ayse.user.id, banned: true }), 200)
      h.expectStatus(await h.get(ctx, '/api/uploads/' + a, mehmet.token), 404, 'upload_not_found')
      assert.equal(await profileOf(ctx, mehmet.token, ayse.user.id), null)
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: ayse.user.id, banned: false }), 200)
      assert.equal((await h.get(ctx, '/api/uploads/' + a, mehmet.token)).status, 200)

      h.expectStatus(await h.post(ctx, '/api/me/delete', mehmet.token, { authKey: h.authKeyFor(h.PASSWORD) }), 200)
      await h.waitFor(() => !fs.existsSync(uploadFile(ctx, m)))
      h.expectStatus(await h.get(ctx, '/api/uploads/' + m, owner.token), 404, 'upload_not_found')
      await ctx.server.flush()
      const disk = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'state.json'), 'utf8'))
      const gone = disk.users.find((u) => u.id === mehmet.user.id)
      assert.deepEqual([gone.profile, gone.avatarUploadId, gone.deleted], [null, null, true])
      assert.ok(!disk.uploads.some((r) => r.id === m))
    } finally {
      await ctx.cleanup()
    }
  })

  it('veri dosyasındaki geçersiz profil resmi bağlantısı açılışta kaldırılır', async () => {
    let { ctx, owner, ayse } = await group()
    try {
      const a = await uploadId(ctx, ayse.token)
      const other = await uploadId(ctx, owner.token)
      h.expectStatus(await setProfile(ctx, ayse.token, h.envelope(), a), 200)
      await ctx.stop()
      const file = path.join(ctx.dataDir, 'state.json')
      const disk = JSON.parse(fs.readFileSync(file, 'utf8'))
      const user = disk.users.find((u) => u.id === ayse.user.id)
      assert.equal(disk.uploads.find((r) => r.id === a).profileUserId, ayse.user.id)
      // Başkasının yüklemesine işaret eden bağlantı ve sahte profil işareti
      user.avatarUploadId = other
      disk.uploads.find((r) => r.id === a).profileUserId = 99
      user.profile = 'bozuk'
      user.status = 'uykuda'
      fs.writeFileSync(file, JSON.stringify(disk))
      ctx = await ctx.restart()
      assert.ok(ctx.log.lines.warn.some((line) => /profil resmi/.test(line)))
      const listed = await profileOf(ctx, owner.token, ayse.user.id)
      assert.deepEqual([listed.avatarUploadId, listed.profile], [null, null])
      assert.equal((await h.stateOf(ctx, ayse.token)).me.status, 'online')
      // Sahte işaret kaldırıldı, eski resim artık yalnızca yükleyene açık
      h.expectStatus(await h.get(ctx, '/api/uploads/' + a, owner.token), 404, 'upload_not_found')
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('durum ve görünmezlik', () => {
  it('durumlar meta ve kişiye özel metada, görünmez kullanıcı başkalarına çevrimdışı', async () => {
    let { ctx, owner, ayse } = await group()
    try {
      for (const status of [undefined, null, 'offline', 'ONLINE', 'mesgul', 1, {}]) {
        h.expectStatus(await h.post(ctx, '/api/me/status', ayse.token, { status }), 400, 'bad_status')
      }
      let st = await h.stateOf(ctx, ayse.token)
      assert.equal(st.me.status, 'online')
      assert.equal(st.private.status, 'online')
      assert.deepEqual(await metaUser(ctx, owner.token, ayse.user.id), { id: ayse.user.id, name: 'ayse', role: 'member', roleId: null, voiceMuted: false, online: true, status: 'online', pv: 0 })
      for (const status of ['idle', 'dnd']) {
        const res = await h.post(ctx, '/api/me/status', ayse.token, { status })
        h.expectStatus(res, 200)
        assert.equal(res.data.status, status)
        const seen = await metaUser(ctx, owner.token, ayse.user.id)
        assert.deepEqual([seen.online, seen.status], [true, status])
      }
      h.expectStatus(await h.post(ctx, '/api/me/status', ayse.token, { status: 'invisible' }), 200)
      const hidden = await metaUser(ctx, owner.token, ayse.user.id)
      assert.deepEqual([hidden.online, hidden.status], [false, 'offline'])
      st = await h.stateOf(ctx, ayse.token)
      assert.equal(st.me.status, 'invisible')
      assert.equal(st.private.status, 'invisible')
      // Görünmez durum başka hiçbir kullanıcıya gönderilmez
      const ownerView = await h.get(ctx, '/api/state', owner.token)
      assert.ok(!ownerView.text.includes('invisible'))
      // Durum kalıcıdır
      ctx = await ctx.restart()
      assert.equal((await h.stateOf(ctx, ayse.token)).me.status, 'invisible')
      const again = await metaUser(ctx, owner.token, ayse.user.id)
      assert.deepEqual([again.online, again.status], [false, 'offline'])
      h.expectStatus(await h.post(ctx, '/api/me/status', ayse.token, { status: 'online' }), 200)
      const back = await metaUser(ctx, owner.token, ayse.user.id)
      assert.deepEqual([back.online, back.status], [true, 'online'])
    } finally {
      await ctx.cleanup()
    }
  })

  it('durum değişikliği başkalarının poll yanıtında meta ile gelir, kendi oturumlarına private ile', async () => {
    const { ctx, owner, ayse } = await group()
    try {
      const ownerSt = await h.stateOf(ctx, owner.token)
      const ayseSt = await h.stateOf(ctx, ayse.token)
      const ownerPoll = h.poller(ctx, owner.token, await h.stateOf(ctx, owner.token))
      const aysePoll = h.poller(ctx, ayse.token, ayseSt)
      assert.ok(ownerSt.metaVersion >= 1)
      const waiting = h.nextRequest(ctx.server, '/api/poll')
      const pending = ownerPoll.poll()
      await waiting
      h.expectStatus(await h.post(ctx, '/api/me/status', ayse.token, { status: 'dnd' }), 200)
      const res = await pending
      assert.equal(res.data.meta.users.find((u) => u.id === ayse.user.id).status, 'dnd')
      assert.equal(res.data.private, undefined)
      const own = await aysePoll.poll()
      assert.equal(own.data.private.status, 'dnd')
    } finally {
      await ctx.cleanup()
    }
  })

  it('görünmez kullanıcının çevrimiçi olup olmadığı meta sürümünden anlaşılmaz', async () => {
    // Varlık penceresi 600 ms: sahip sürekli istek yaptığı için yük altında da çevrimiçi kalır
    const { ctx, owner, ayse } = await group({ pollTimeoutMs: 300, graceMs: 300 })
    try {
      h.expectStatus(await h.post(ctx, '/api/me/status', ayse.token, { status: 'invisible' }), 200)
      const mv = async () => (await h.stateOf(ctx, owner.token)).metaVersion
      // Mehmet hiç bağlanmadı, sahip sürekli istek yapar (çevrimiçi kalır). Sayım sahibin
      // isteğinden hemen sonra yapıldığı için tek etkin oturum sahibinkidir.
      await h.waitFor(async () => {
        await mv()
        return ctx.server.stats().activeSessions === 1
      }, { timeout: 8000, label: 'ayse çevrimdışına düşer' })
      const before = await mv()
      // Ayşe geri gelir: başkalarının metası değişmez
      await h.stateOf(ctx, ayse.token)
      assert.equal(ctx.server.stats().activeSessions, 2)
      assert.equal(await mv(), before)
      const seen = await metaUser(ctx, owner.token, ayse.user.id)
      assert.deepEqual([seen.online, seen.status], [false, 'offline'])
      // Karşılaştırma: görünür kullanıcının bağlanması meta sürümünü artırır
      await h.stateOf(ctx, (await h.login(ctx, 'mehmet')).data.token)
      assert.ok(await mv() > before)
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('oturumlar', () => {
  it('sessionLabel: User-Agent dizgesinden dil bağımsız kısa etiket', () => {
    const expected = {
      chromeWindows: 'Chrome, Windows',
      safariIphone: 'Safari, iPhone',
      firefoxLinux: 'Firefox, Linux',
      edgeWindows: 'Edge, Windows',
      chromeAndroid: 'Chrome, Android',
      ps5: 'PlayStation 5',
      samsung: 'Samsung Internet, Android',
      chromeIpad: 'Chrome, iPad',
      safariMac: 'Safari, macOS',
      operaWindows: 'Opera, Windows',
      edgeXbox: 'Edge, Xbox',
      firefoxIphone: 'Firefox, iPhone',
      chromeOs: 'Chrome, ChromeOS'
    }
    for (const key of Object.keys(expected)) assert.equal(auth.sessionLabel(UA[key]), expected[key], key)
    for (const ua of [undefined, null, '', 'curl/8.4.0', 'node', 42, 'x'.repeat(100000)]) {
      assert.equal(auth.sessionLabel(ua), null, String(ua).slice(0, 20))
    }
    assert.equal(auth.sessionLabel('x'.repeat(600) + ' Firefox/130.0'), null)
    for (const label of Object.values(expected)) assert.ok(auth.isSessionLabel(label))
    for (const bad of ['', 'x'.repeat(61), 'a\nb', 42, null]) assert.equal(auth.isSessionLabel(bad), false)
  })

  it('liste: etiket, bu cihaz, kimlik token karmasının başı, token hiçbir yerde yok', async () => {
    let ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const phone = await h.login(ctx, 'sahip', h.PASSWORD, { 'user-agent': UA.safariIphone })
      const pc = await h.login(ctx, 'sahip', h.PASSWORD, { 'user-agent': UA.chromeWindows })
      const res = await h.get(ctx, '/api/me/sessions', pc.data.token)
      h.expectStatus(res, 200)
      const list = res.data.sessions
      assert.equal(list.length, 3)
      for (const s of list) {
        assert.deepEqual(Object.keys(s).sort(), ['createdAt', 'current', 'id', 'label', 'lastUsed'])
        assert.match(s.id, /^[0-9a-f]{16}$/)
      }
      const idOf = (token) => crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
      assert.deepEqual(list[0], Object.assign({}, list[0], { id: idOf(pc.data.token), label: 'Chrome, Windows', current: true }))
      const byId = new Map(list.map((s) => [s.id, s]))
      assert.equal(byId.get(idOf(phone.data.token)).label, 'Safari, iPhone')
      assert.equal(byId.get(idOf(phone.data.token)).current, false)
      assert.equal(byId.get(idOf(owner.token)).label, null)
      for (const token of [owner.token, phone.data.token, pc.data.token]) {
        assert.ok(!res.text.includes(token))
        assert.ok(!res.text.includes(crypto.createHash('sha256').update(token).digest('hex')))
      }
      // Etiket kalıcıdır, User-Agent'ın kendisi diske yazılmaz
      await ctx.server.flush()
      const text = fs.readFileSync(path.join(ctx.dataDir, 'state.json'), 'utf8')
      assert.ok(!text.includes('Mozilla'))
      ctx = await ctx.restart()
      const again = await h.get(ctx, '/api/me/sessions', phone.data.token)
      assert.equal(again.data.sessions[0].label, 'Safari, iPhone')
      assert.equal(again.data.sessions[0].current, true)
      h.expectStatus(await h.get(ctx, '/api/me/sessions'), 401, 'invalid_token')
    } finally {
      await ctx.cleanup()
    }
  })

  it('kapatma: tek oturum, diğerleri, yalnızca kendi oturumları, bekleyen poll 401', async () => {
    const { ctx, owner, ayse } = await group()
    try {
      const second = await h.login(ctx, 'sahip', h.PASSWORD, { 'user-agent': UA.firefoxLinux })
      const third = await h.login(ctx, 'sahip', h.PASSWORD, { 'user-agent': UA.ps5 })
      const idOf = (token) => crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
      const badBodies = [{}, { id: 'xyz' }, { id: idOf(second.data.token), others: true }, { others: 'true' }, { id: idOf(second.data.token).toUpperCase() },
        { others: false }, { id: 'xyz', others: true }, { id: null, others: true }, { id: idOf(second.data.token), others: false }, { id: 42 }]
      for (const body of badBodies) {
        h.expectStatus(await h.post(ctx, '/api/me/sessions/revoke', owner.token, body), 400, 'bad_request')
      }
      // Başka kullanıcının oturumu bulunamaz ve kapanmaz
      h.expectStatus(await h.post(ctx, '/api/me/sessions/revoke', owner.token, { id: idOf(ayse.token) }), 404, 'session_not_found')
      h.expectStatus(await h.get(ctx, '/api/state', ayse.token), 200)

      const st = await h.stateOf(ctx, second.data.token)
      const p = h.poller(ctx, second.data.token, st)
      const waiting = h.nextRequest(ctx.server, '/api/poll')
      const pending = p.poll()
      await waiting
      const one = await h.post(ctx, '/api/me/sessions/revoke', owner.token, { id: idOf(second.data.token) })
      h.expectStatus(one, 200)
      assert.equal(one.data.revoked, 1)
      h.expectStatus(await pending, 401, 'invalid_token')
      h.expectStatus(await h.get(ctx, '/api/state', second.data.token), 401, 'invalid_token')
      h.expectStatus(await h.get(ctx, '/api/state', third.data.token), 200)

      const others = await h.post(ctx, '/api/me/sessions/revoke', owner.token, { others: true })
      h.expectStatus(others, 200)
      assert.equal(others.data.revoked, 1)
      h.expectStatus(await h.get(ctx, '/api/state', third.data.token), 401, 'invalid_token')
      h.expectStatus(await h.get(ctx, '/api/state', owner.token), 200)
      const list = (await h.get(ctx, '/api/me/sessions', owner.token)).data.sessions
      assert.equal(list.length, 1)
      assert.equal(list[0].current, true)
      // Bu cihazın oturumu da kimliğiyle kapatılabilir (çıkış gibi)
      h.expectStatus(await h.post(ctx, '/api/me/sessions/revoke', owner.token, { id: list[0].id }), 200)
      h.expectStatus(await h.get(ctx, '/api/state', owner.token), 401, 'invalid_token')
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('engellenen ve eski kullanıcılar', () => {
  it('formerUsers herkese, bannedUsers yalnızca sahip ve yöneticiye', async () => {
    const { ctx, owner, ayse, mehmet } = await group()
    try {
      const ali = await h.addUser(ctx, owner.token, 'ali')
      let st = await h.stateOf(ctx, ayse.token)
      assert.deepEqual(st.formerUsers, [])
      assert.equal(st.bannedUsers, undefined)
      assert.deepEqual((await h.stateOf(ctx, owner.token)).bannedUsers, [])
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: mehmet.user.id, banned: true }), 200)
      h.expectStatus(await h.post(ctx, '/api/me/delete', ali.token, { authKey: h.authKeyFor(h.PASSWORD) }), 200)
      st = await h.stateOf(ctx, ayse.token)
      assert.deepEqual(st.formerUsers, [{ id: mehmet.user.id, name: 'mehmet' }])
      assert.equal(st.bannedUsers, undefined)
      assert.ok(!st.meta.users.some((u) => u.id === mehmet.user.id || u.id === ali.user.id))
      await h.makeAdmin(ctx, owner.token, ayse.user.id)
      st = await h.stateOf(ctx, ayse.token)
      assert.deepEqual(st.bannedUsers, [{ id: mehmet.user.id, name: 'mehmet', role: 'member' }])
      h.expectStatus(await h.post(ctx, '/api/users/ban', ayse.token, { userId: mehmet.user.id, banned: false }), 200)
      st = await h.stateOf(ctx, owner.token)
      assert.deepEqual([st.bannedUsers, st.formerUsers], [[], []])
    } finally {
      await ctx.cleanup()
    }
  })
})
