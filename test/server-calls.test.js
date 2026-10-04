'use strict'

// Özel mesajda sesli ve görüntülü arama: başlatma kuralları (üyelik, arkadaşlık, engel), aramanın odasına katılma,
// özel görünümde yalnızca iki üyeye görünmesi, herkese açık metaya ve meta sürümüne hiç yansımaması, '2.' sinyal
// zarfı, reddetme ve zil zaman aşımı, engel, arkadaşlıktan çıkarma, yasaklama ve hesap silmenin aramayı bitirmesi,
// ses odası denetiminin ve sunucu susturmasının özel aramaya uzanmaması, kamera sınırı ve sahibin kamera ayarı,
// bir üye ayrılınca aramanın bitmesi, hız sınırı, aynı arayanın tek çalan araması ve iki tarafın aynı anda araması.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const h = require('./server-yardimci')
const { createChatServer, DEFAULTS } = require('../src/app')

// Ayşe ile Mehmet arkadaştır ve aralarında bir özel konuşma vardır. Ali üçüncü kişidir.
async function pair (options) {
  const ctx = await h.startServer(options)
  const owner = await h.setupOwner(ctx)
  const ayse = await h.addUser(ctx, owner.token, 'ayse')
  const mehmet = await h.addUser(ctx, owner.token, 'mehmet')
  const ali = await h.addUser(ctx, owner.token, 'ali')
  // İlk oturumlu istek kullanıcıyı çevrimiçi yapar (meta yayını), ölçümler bundan sonra başlar
  for (const who of [owner, ayse, mehmet, ali]) await h.stateOf(ctx, who.token)
  await befriend(ctx, ayse, mehmet)
  const dmId = await openDm(ctx, ayse, mehmet)
  return { ctx, owner, ayse, mehmet, ali, dmId }
}

async function befriend (ctx, a, b) {
  h.expectStatus(await h.post(ctx, '/api/friends/request', a.token, { userId: b.user.id }), 200)
  h.expectStatus(await h.post(ctx, '/api/friends/accept', b.token, { userId: a.user.id }), 200)
}

async function openDm (ctx, from, to) {
  const res = await h.post(ctx, '/api/dms/open', from.token, { userId: to.user.id })
  h.expectStatus(res, 200)
  return res.data.dm.id
}

function start (ctx, who, dmId, video) {
  const body = { dmId }
  if (video !== undefined) body.video = video
  return h.post(ctx, '/api/calls/start', who.token, body)
}

function decline (ctx, who, dmId) {
  return h.post(ctx, '/api/calls/decline', who.token, { dmId })
}

function join (ctx, who, channelId) {
  return h.post(ctx, '/api/voice/join', who.token, { channelId })
}

async function callOf (ctx, who) {
  return (await h.stateOf(ctx, who.token)).private.call
}

async function peerOf (ctx, who) {
  return (await h.stateOf(ctx, who.token)).peerId
}

// Ayşe arar, ikisi de odaya katılır (etkin arama)
async function activeCall (ctx, ayse, mehmet, dmId, video) {
  h.expectStatus(await start(ctx, ayse, dmId, video), 200)
  h.expectStatus(await join(ctx, ayse, dmId), 200)
  h.expectStatus(await join(ctx, mehmet, dmId), 200)
  assert.equal((await callOf(ctx, ayse)).state, 'active')
}

// Seste olmayan oturumun kamera isteği 403 not_in_voice alır (odadan çıkarıldığının kanıtı)
async function expectOutOfVoice (ctx, who) {
  h.expectStatus(await h.post(ctx, '/api/voice/camera', who.token, { on: false }), 403, 'not_in_voice')
}

// Zil süresi dolunca görünümden hemen kalkan arama, süpürmede silinir ve odadaki oturumlar o zaman çıkarılır
async function waitOutOfVoice (ctx, who) {
  await h.waitFor(async () => (await h.post(ctx, '/api/voice/camera', who.token, { on: false })).status === 403, { label: 'odadan çıkarılma' })
  await expectOutOfVoice(ctx, who)
}

describe('özel mesaj araması: başlatma kuralları', () => {
  it('varsayılan ayarlar, geçersiz seçenekler reddedilir', async () => {
    assert.equal(DEFAULTS.callRingMs, 45000)
    assert.equal(DEFAULTS.callLimit, 10)
    assert.equal(DEFAULTS.callWindowMs, 60000)
    const root = h.makeRoot()
    try {
      const dataDir = path.join(root, 'veri')
      for (const bad of [{ callRingMs: 0 }, { callRingMs: 2147483648 }, { callRingMs: 1.5 }, { callLimit: 0 }, { callWindowMs: '60000' }]) {
        await assert.rejects(createChatServer(Object.assign({ dataDir, scryptN: 1024, log: null }, bad)), TypeError, JSON.stringify(bad))
      }
      assert.equal(fs.existsSync(dataDir), false)
    } finally {
      h.removeRoot(root)
    }
  })

  it('üye olmayan için konuşma yoktur (404), girdiler sıkı doğrulanır', async () => {
    const { ctx, owner, ayse, ali, dmId } = await pair()
    try {
      h.expectStatus(await start(ctx, ali, dmId), 404, 'channel_not_found')
      h.expectStatus(await start(ctx, owner, dmId), 404, 'channel_not_found')
      h.expectStatus(await decline(ctx, ali, dmId), 404, 'channel_not_found')
      h.expectStatus(await join(ctx, ali, dmId), 404, 'channel_not_found')
      // Olmayan konuşma, yazı ve ses odası, geçersiz kimlik
      for (const id of [99, 1, 3, 0, -1, 'abc', null, undefined, {}]) {
        h.expectStatus(await start(ctx, ayse, id), 404, 'channel_not_found')
      }
      for (const video of ['evet', 1, null, {}]) {
        h.expectStatus(await start(ctx, ayse, dmId, video), 400, 'bad_request')
      }
      // Çağrı yokken üye olmayan katılamaz, üye de katılamaz
      h.expectStatus(await join(ctx, ayse, dmId), 404, 'channel_not_found')
      assert.equal(await callOf(ctx, ayse), null)
    } finally {
      await ctx.cleanup()
    }
  })

  it('arkadaş olmayan arayamaz (403 call_not_allowed), engelde 403 dm_not_allowed', async () => {
    const { ctx, ayse, mehmet, ali, dmId } = await pair()
    try {
      const withAli = await openDm(ctx, ayse, ali)
      h.expectStatus(await start(ctx, ayse, withAli), 403, 'call_not_allowed')
      h.expectStatus(await start(ctx, ali, withAli, true), 403, 'call_not_allowed')
      h.expectStatus(await join(ctx, ayse, withAli), 404, 'channel_not_found')
      const en = await h.request(ctx, 'POST', '/api/calls/start', { token: ayse.token, body: { dmId: withAli }, headers: { 'accept-language': 'en' } })
      h.expectStatus(en, 403, 'call_not_allowed')
      assert.equal(en.data.error, 'You can only call your friends.')
      const tr = await h.request(ctx, 'POST', '/api/calls/start', { token: ayse.token, body: { dmId: withAli }, headers: { 'accept-language': 'tr' } })
      assert.equal(tr.data.error, 'Yalnızca arkadaşlarınızı arayabilirsiniz.')

      // Engel iki yönde de aramayı kapatır (engel arkadaşlığı da siler)
      h.expectStatus(await h.post(ctx, '/api/blocks/add', mehmet.token, { userId: ayse.user.id }), 200)
      h.expectStatus(await start(ctx, ayse, dmId), 403, 'dm_not_allowed')
      h.expectStatus(await start(ctx, mehmet, dmId), 403, 'dm_not_allowed')
      h.expectStatus(await h.post(ctx, '/api/blocks/remove', mehmet.token, { userId: ayse.user.id }), 200)
      h.expectStatus(await start(ctx, ayse, dmId), 403, 'call_not_allowed')
      await befriend(ctx, ayse, mehmet)
      h.expectStatus(await start(ctx, ayse, dmId), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('video verilmezse arama sesli sayılır (video false)', async () => {
    const { ctx, ayse, mehmet, dmId } = await pair()
    try {
      const res = await start(ctx, ayse, dmId)
      h.expectStatus(res, 200)
      assert.equal(res.data.call.video, false)
      assert.equal((await callOf(ctx, mehmet)).video, false)
      assert.equal((await callOf(ctx, ayse)).video, false)
    } finally {
      await ctx.cleanup()
    }
  })

  it('yasaklı karşı taraf aranamaz', async () => {
    const { ctx, owner, ayse, mehmet, dmId } = await pair()
    try {
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: mehmet.user.id, banned: true }), 200)
      h.expectStatus(await start(ctx, ayse, dmId), 403, 'dm_not_allowed')
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('özel mesaj araması: akış ve gizlilik', () => {
  it('çalan arama, özel görünüm yalnızca iki üyede, katılma ve etkin arama', async () => {
    const { ctx, owner, ayse, mehmet, ali, dmId } = await pair()
    try {
      const ayseState = await h.stateOf(ctx, ayse.token)
      const mehmetState = await h.stateOf(ctx, mehmet.token)
      const aliPmv = (await h.stateOf(ctx, ali.token)).pmv
      const ownerPmv = (await h.stateOf(ctx, owner.token)).pmv

      const res = await start(ctx, ayse, dmId, true)
      h.expectStatus(res, 200)
      assert.deepEqual(Object.keys(res.data).sort(), ['call', 'ok'])
      const call = res.data.call
      assert.deepEqual(Object.keys(call).sort(), ['answeredAt', 'createdAt', 'dmId', 'members', 'ringUntil', 'role', 'state', 'userId', 'video'])
      assert.deepEqual([call.dmId, call.userId, call.video, call.state, call.role, call.answeredAt, call.members], [dmId, mehmet.user.id, true, 'ringing', 'caller', null, []])
      assert.equal(call.ringUntil - call.createdAt, DEFAULTS.callRingMs)

      // Aranan kendi görünümünde aramayı görür, üçüncü kişinin ve sahibin görünümü değişmez
      const incoming = await callOf(ctx, mehmet)
      assert.deepEqual([incoming.dmId, incoming.userId, incoming.role, incoming.state, incoming.video], [dmId, ayse.user.id, 'callee', 'ringing', true])
      const aliState = await h.stateOf(ctx, ali.token)
      assert.equal(aliState.private.call, null)
      assert.equal(aliState.pmv, aliPmv)
      const ownerState = await h.stateOf(ctx, owner.token)
      assert.equal(ownerState.private.call, null)
      assert.equal(ownerState.pmv, ownerPmv)
      assert.ok(!JSON.stringify(ownerState).includes('ringUntil'))

      // Arayan odaya katılır: arananın görünümünde odadaki kişi görünür
      const joined = await join(ctx, ayse, dmId)
      h.expectStatus(joined, 200)
      assert.deepEqual(Object.keys(joined.data).sort(), ['iceServers', 'members', 'ok', 'peerId'])
      assert.equal(joined.data.peerId, ayseState.peerId)
      assert.deepEqual(joined.data.members, [])
      assert.deepEqual((await callOf(ctx, mehmet)).members, [{ userId: ayse.user.id, peerId: ayseState.peerId, muted: false, deafened: false, camera: false }])
      h.expectStatus(await join(ctx, ali, dmId), 404, 'channel_not_found')

      // Aranan katılınca arama etkin olur
      const answered = await join(ctx, mehmet, dmId)
      h.expectStatus(answered, 200)
      assert.deepEqual(answered.data.members, [{ userId: ayse.user.id, peerId: ayseState.peerId, muted: false, deafened: false, camera: false }])
      const active = await callOf(ctx, ayse)
      assert.equal(active.state, 'active')
      assert.equal(typeof active.answeredAt, 'number')
      assert.deepEqual(active.members.map((m) => m.peerId), [ayseState.peerId, mehmetState.peerId])
      assert.equal((await callOf(ctx, mehmet)).state, 'active')
      assert.equal(await callOf(ctx, ali), null)
      assert.equal((await h.stateOf(ctx, ali.token)).pmv, aliPmv)
      // Ses durumu özel görünüme yansır
      h.expectStatus(await h.post(ctx, '/api/voice/state', ayse.token, { muted: true, deafened: false }), 200)
      assert.equal((await callOf(ctx, mehmet)).members[0].muted, true)
    } finally {
      await ctx.cleanup()
    }
  })

  it('arama başlayınca iki üyenin bekleyen poll\'u uyanır', async () => {
    const { ctx, ayse, mehmet, dmId } = await pair()
    try {
      const pAyse = h.poller(ctx, ayse.token, await h.stateOf(ctx, ayse.token))
      const pMehmet = h.poller(ctx, mehmet.token, await h.stateOf(ctx, mehmet.token))
      const waiting = h.nextRequest(ctx.server, '/api/poll')
      const mehmetWait = pMehmet.poll()
      await waiting
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      const got = await mehmetWait
      assert.equal(got.data.private.call.state, 'ringing')
      assert.equal(got.data.private.call.role, 'callee')
      assert.equal(got.data.meta, undefined)
      const own = await pAyse.poll()
      assert.equal(own.data.private.call.role, 'caller')
      assert.equal(own.data.meta, undefined)
    } finally {
      await ctx.cleanup()
    }
  })

  it('özel görünümde etkin arama daha yeni çalan aramanın önündedir', async () => {
    const { ctx, ayse, mehmet, ali, dmId } = await pair()
    try {
      await befriend(ctx, ali, ayse)
      const withAli = await openDm(ctx, ali, ayse)
      await activeCall(ctx, ayse, mehmet, dmId)
      await h.sleep(5)
      h.expectStatus(await start(ctx, ali, withAli), 200)
      const shown = await callOf(ctx, ayse)
      assert.deepEqual([shown.dmId, shown.state], [dmId, 'active'])
      assert.equal((await callOf(ctx, ali)).dmId, withAli)
      // Etkin arama bitince çalan arama görünür
      h.expectStatus(await decline(ctx, mehmet, dmId), 200)
      const next = await callOf(ctx, ayse)
      assert.deepEqual([next.dmId, next.state, next.role], [withAli, 'ringing', 'callee'])
    } finally {
      await ctx.cleanup()
    }
  })

  it('meta ve meta sürümü hiçbir arama adımında değişmez, sunucu bilgileri saymaz', async () => {
    const { ctx, owner, ayse, mehmet, ali, dmId } = await pair()
    try {
      const before = await h.stateOf(ctx, ali.token)
      const check = async (label) => {
        const now = await h.stateOf(ctx, ali.token)
        assert.equal(now.metaVersion, before.metaVersion, label)
        assert.deepEqual(now.meta, before.meta, label)
        assert.ok(!(String(dmId) in now.meta.voice), label)
        assert.equal(now.pmv, before.pmv, label)
      }
      h.expectStatus(await start(ctx, ayse, dmId, true), 200)
      await check('başlatma')
      h.expectStatus(await join(ctx, ayse, dmId), 200)
      await check('arayanın katılması')
      h.expectStatus(await join(ctx, mehmet, dmId), 200)
      await check('arananın katılması')
      h.expectStatus(await h.post(ctx, '/api/voice/state', mehmet.token, { muted: true, deafened: true }), 200)
      await check('ses durumu')
      h.expectStatus(await h.post(ctx, '/api/voice/camera', ayse.token, { on: true }), 200)
      await check('kamera')
      h.expectStatus(await h.post(ctx, '/api/voice/signal', ayse.token, { to: await peerOf(ctx, mehmet), data: h.dmEnvelope() }), 200)
      await check('sinyal')
      const info = await h.get(ctx, '/api/server-info', owner.token)
      h.expectStatus(info, 200)
      assert.deepEqual(info.data.voice, { inVoice: 0, cameras: 0 })
      h.expectStatus(await h.post(ctx, '/api/voice/leave', mehmet.token), 200)
      await check('ayrılma')
      assert.equal(await callOf(ctx, ayse), null)
    } finally {
      await ctx.cleanup()
    }
  })

  it('özel arama odasında yalnızca \'2.\' zarfı kabul edilir, ses odasında yalnızca \'1.\'', async () => {
    const { ctx, owner, ayse, mehmet, ali, dmId } = await pair()
    try {
      await activeCall(ctx, ayse, mehmet, dmId)
      const mehmetState = await h.stateOf(ctx, mehmet.token)
      const signal = (who, to, data) => h.post(ctx, '/api/voice/signal', who.token, { to, data })
      h.expectStatus(await signal(ayse, mehmetState.peerId, h.envelope()), 400, 'bad_signal')
      h.expectStatus(await signal(ayse, mehmetState.peerId, 'düz metin'), 400, 'bad_signal')
      h.expectStatus(await signal(ayse, mehmetState.peerId, h.dmEnvelope(32000)), 400, 'bad_signal')
      const data = h.dmEnvelope()
      h.expectStatus(await signal(ayse, mehmetState.peerId, data), 200)
      const polled = await h.get(ctx, '/api/poll?since=0&mv=0&sig=0&boot=' + mehmetState.boot, mehmet.token)
      assert.deepEqual(polled.data.signals, [{ seq: 1, from: await peerOf(ctx, ayse), data }])
      // Odada olmayan kişiye sinyal gitmez
      h.expectStatus(await signal(ayse, await peerOf(ctx, ali), h.dmEnvelope()), 404, 'peer_not_found')

      // Ses odasında '2.' zarfı reddedilir
      h.expectStatus(await join(ctx, owner, 3), 200)
      h.expectStatus(await join(ctx, ali, 3), 200)
      h.expectStatus(await signal(owner, await peerOf(ctx, ali), h.dmEnvelope()), 400, 'bad_signal')
      h.expectStatus(await signal(owner, await peerOf(ctx, ali), h.envelope()), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('reddetme ve iptal: kayıt silinir, arayan odadan çıkarılır, işlem tekrarlanabilir', async () => {
    const { ctx, ayse, mehmet, ali, dmId } = await pair()
    try {
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      h.expectStatus(await join(ctx, ayse, dmId), 200)
      const res = await decline(ctx, mehmet, dmId)
      h.expectStatus(res, 200)
      assert.deepEqual(res.data, { ok: true })
      assert.equal(await callOf(ctx, ayse), null)
      assert.equal(await callOf(ctx, mehmet), null)
      await expectOutOfVoice(ctx, ayse)
      // Kayıt yokken de başarılı (bilgi sızdırmaz), üye olmayan için konuşma yoktur
      h.expectStatus(await decline(ctx, mehmet, dmId), 200)
      h.expectStatus(await decline(ctx, ali, dmId), 404, 'channel_not_found')
      // Reddedilen aramanın odasına katılınamaz
      h.expectStatus(await join(ctx, mehmet, dmId), 404, 'channel_not_found')

      // Arayan iptal eder
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      h.expectStatus(await decline(ctx, ayse, dmId), 200)
      assert.equal(await callOf(ctx, mehmet), null)

      // Etkin aramada reddetme aramayı bitirir, iki taraf da odadan çıkarılır
      await activeCall(ctx, ayse, mehmet, dmId)
      h.expectStatus(await decline(ctx, mehmet, dmId), 200)
      assert.equal(await callOf(ctx, ayse), null)
      await expectOutOfVoice(ctx, ayse)
      await expectOutOfVoice(ctx, mehmet)
    } finally {
      await ctx.cleanup()
    }
  })

  it('zil zaman aşımı: cevaplanmayan arama silinir, arayan odadan çıkarılır', async () => {
    const { ctx, ayse, mehmet, dmId } = await pair({ callRingMs: 300 })
    try {
      const res = await start(ctx, ayse, dmId)
      assert.equal(res.data.call.ringUntil - res.data.call.createdAt, 300)
      h.expectStatus(await join(ctx, ayse, dmId), 200)
      await h.waitFor(async () => (await callOf(ctx, ayse)) === null, { label: 'zil zaman aşımı' })
      assert.equal(await callOf(ctx, mehmet), null)
      await waitOutOfVoice(ctx, ayse)
      h.expectStatus(await join(ctx, mehmet, dmId), 404, 'channel_not_found')
    } finally {
      await ctx.cleanup()
    }
  })

  it('zil süresi dolmuş arama süpürmeyi beklemeden yok sayılır', async () => {
    const { ctx, ayse, mehmet, dmId } = await pair({ callRingMs: 150, sweepIntervalMs: 60000 })
    try {
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      h.expectStatus(await join(ctx, ayse, dmId), 200)
      // Önbellekteki görünümler kurulur, ardından zil süresi dolar
      assert.equal((await callOf(ctx, mehmet)).state, 'ringing')
      assert.equal((await callOf(ctx, ayse)).state, 'ringing')
      await h.sleep(250)
      assert.equal(await callOf(ctx, mehmet), null)
      assert.equal(await callOf(ctx, ayse), null)
      // Süresi dolmuş aramaya katılınamaz, kayıt silinir ve arayan odadan çıkarılır
      h.expectStatus(await join(ctx, mehmet, dmId), 404, 'channel_not_found')
      await expectOutOfVoice(ctx, ayse)
      await expectOutOfVoice(ctx, mehmet)

      // Süresi dolmuş arama yeni aramayı engellemez: başlatma yeni bir kayıt oluşturur
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      await h.sleep(250)
      const before = Date.now()
      const fresh = await start(ctx, ayse, dmId)
      h.expectStatus(fresh, 200)
      assert.equal(fresh.data.call.state, 'ringing')
      assert.ok(fresh.data.call.createdAt >= before)
      assert.ok(fresh.data.call.ringUntil > Date.now())

      // Süresi dolmuş arama reddedilince de başarılı döner, süresi dolmuş aramada glare kabulü olmaz
      await h.sleep(250)
      h.expectStatus(await decline(ctx, mehmet, dmId), 200)
      assert.equal(await callOf(ctx, ayse), null)
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      await h.sleep(250)
      const late = await start(ctx, mehmet, dmId)
      h.expectStatus(late, 200)
      assert.equal(late.data.answer, undefined)
      assert.deepEqual([late.data.call.role, late.data.call.state], ['caller', 'ringing'])
    } finally {
      await ctx.cleanup()
    }
  })

  it('arayan odada yokken katılan aranan aramayı etkin yapmaz, zil süresi dolunca çıkarılır', async () => {
    const { ctx, ayse, mehmet, dmId } = await pair({ callRingMs: 300 })
    try {
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      h.expectStatus(await join(ctx, mehmet, dmId), 200)
      const call = await callOf(ctx, mehmet)
      assert.equal(call.state, 'ringing')
      assert.equal(call.answeredAt, null)
      assert.deepEqual(call.members.map((m) => m.userId), [mehmet.user.id])
      await h.waitFor(async () => (await callOf(ctx, mehmet)) === null, { label: 'zil zaman aşımı' })
      await waitOutOfVoice(ctx, mehmet)

      // Arayan sonradan katılırsa arama etkin olur
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      h.expectStatus(await join(ctx, mehmet, dmId), 200)
      h.expectStatus(await join(ctx, ayse, dmId), 200)
      const active = await callOf(ctx, mehmet)
      assert.equal(active.state, 'active')
      assert.equal(typeof active.answeredAt, 'number')
    } finally {
      await ctx.cleanup()
    }
  })

  it('odaya katılmadan oturumu kapatan arayanın çalan araması biter', async () => {
    const { ctx, ayse, mehmet, dmId } = await pair()
    try {
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      assert.equal((await callOf(ctx, mehmet)).state, 'ringing')
      h.expectStatus(await h.post(ctx, '/api/logout', ayse.token), 200)
      assert.equal(await callOf(ctx, mehmet), null)
      h.expectStatus(await join(ctx, mehmet, dmId), 404, 'channel_not_found')

      // Başka oturumu kalan arayanın araması sürer
      const first = await h.login(ctx, 'ayse')
      const second = await h.login(ctx, 'ayse')
      h.expectStatus(await start(ctx, { token: first.data.token }, dmId), 200)
      h.expectStatus(await h.post(ctx, '/api/logout', second.data.token), 200)
      assert.equal((await callOf(ctx, mehmet)).state, 'ringing')
      // Arananın oturumunu kapatması çalan aramayı bitirmez (zil her durumda kaydedilir)
      const phone = await h.login(ctx, 'mehmet')
      h.expectStatus(await h.post(ctx, '/api/logout', mehmet.token), 200)
      assert.equal((await callOf(ctx, { token: phone.data.token })).state, 'ringing')
    } finally {
      await ctx.cleanup()
    }
  })

  it('etkin arama cevaplanınca zil zaman aşımına uğramaz', async () => {
    const { ctx, ayse, mehmet, dmId } = await pair({ callRingMs: 200 })
    try {
      await activeCall(ctx, ayse, mehmet, dmId)
      await h.sleep(400)
      assert.equal((await callOf(ctx, ayse)).state, 'active')
    } finally {
      await ctx.cleanup()
    }
  })

  it('etkin aramada bir üye ayrılınca, başka odaya geçince veya oturumu düşünce diğeri çıkarılır', async () => {
    const { ctx, ayse, mehmet, dmId } = await pair()
    try {
      await activeCall(ctx, ayse, mehmet, dmId)
      h.expectStatus(await h.post(ctx, '/api/voice/leave', ayse.token), 200)
      assert.equal(await callOf(ctx, mehmet), null)
      await expectOutOfVoice(ctx, mehmet)

      // Ses odasına geçmek aramadan çıkarır, arama biter
      await activeCall(ctx, ayse, mehmet, dmId)
      h.expectStatus(await join(ctx, mehmet, 3), 200)
      assert.equal(await callOf(ctx, ayse), null)
      await expectOutOfVoice(ctx, ayse)
      h.expectStatus(await h.post(ctx, '/api/voice/leave', mehmet.token), 200)

      // Çalan aramada arayan ayrılırsa kayıt silinir
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      h.expectStatus(await join(ctx, ayse, dmId), 200)
      h.expectStatus(await h.post(ctx, '/api/voice/leave', ayse.token), 200)
      assert.equal(await callOf(ctx, mehmet), null)

      // Aynı kişinin başka cihazından katılması aramayı bitirmez
      await activeCall(ctx, ayse, mehmet, dmId)
      const phone = await h.login(ctx, 'ayse')
      h.expectStatus(await join(ctx, { token: phone.data.token }, dmId), 200)
      const call = await callOf(ctx, mehmet)
      assert.equal(call.state, 'active')
      assert.deepEqual(call.members.map((m) => m.peerId).sort(), [await peerOf(ctx, { token: phone.data.token }), await peerOf(ctx, mehmet)].sort())
      await expectOutOfVoice(ctx, ayse)

      // Çıkış (oturumun silinmesi) aramayı bitirir
      h.expectStatus(await h.post(ctx, '/api/logout', phone.data.token), 200)
      assert.equal(await callOf(ctx, mehmet), null)
      await expectOutOfVoice(ctx, mehmet)
    } finally {
      await ctx.cleanup()
    }
  })

  it('çevrimdışına düşen üye aramayı bitirir', async () => {
    const { ctx, ayse, mehmet, dmId } = await pair({ pollTimeoutMs: 100, graceMs: 100 })
    try {
      await activeCall(ctx, ayse, mehmet, dmId)
      // Mehmet istek atmaya devam eder, Ayşe susar
      await h.waitFor(async () => (await callOf(ctx, mehmet)) === null, { timeout: 8000, label: 'oturum düşmesi' })
      await expectOutOfVoice(ctx, mehmet)
    } finally {
      await ctx.cleanup()
    }
  })

  it('çevrimiçi kalan kullanıcının aramadaki oturumu kapanınca meta sürümü değişmez', async () => {
    const { ctx, ayse, mehmet, ali, dmId } = await pair()
    try {
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      const phone = { token: (await h.login(ctx, 'ayse')).data.token }
      await h.stateOf(ctx, phone.token)
      h.expectStatus(await join(ctx, phone, dmId), 200)
      h.expectStatus(await join(ctx, mehmet, dmId), 200)
      assert.equal((await callOf(ctx, mehmet)).state, 'active')
      const before = await h.stateOf(ctx, ali.token)
      h.expectStatus(await h.post(ctx, '/api/logout', phone.token), 200)
      assert.equal(await callOf(ctx, mehmet), null)
      const now = await h.stateOf(ctx, ali.token)
      assert.equal(now.metaVersion, before.metaVersion)
      assert.deepEqual(now.meta, before.meta)
    } finally {
      await ctx.cleanup()
    }
  })

  it('çevrimiçi kalan kullanıcının aramadaki oturumu düşünce meta sürümü değişmez', async () => {
    const { ctx, owner, ayse, mehmet, ali, dmId } = await pair({ pollTimeoutMs: 100, graceMs: 100 })
    try {
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      const phone = { token: (await h.login(ctx, 'ayse')).data.token }
      await h.stateOf(ctx, phone.token)
      h.expectStatus(await join(ctx, phone, dmId), 200)
      h.expectStatus(await join(ctx, mehmet, dmId), 200)
      assert.equal((await callOf(ctx, mehmet)).state, 'active')
      const before = await h.stateOf(ctx, ali.token)
      // Telefon susar, diğer oturumlar istek atmaya devam eder
      await h.waitFor(async () => {
        for (const who of [ayse, owner, ali]) await h.stateOf(ctx, who.token)
        return (await callOf(ctx, mehmet)) === null
      }, { timeout: 8000, label: 'oturum düşmesi' })
      const now = await h.stateOf(ctx, ali.token)
      assert.equal(now.metaVersion, before.metaVersion)
      assert.deepEqual(now.meta, before.meta)
    } finally {
      await ctx.cleanup()
    }
  })

  it('ses odasından özel aramaya geçen kişi odadan çıkar ve meta sürümü artar', async () => {
    const { ctx, ayse, ali, dmId } = await pair()
    try {
      h.expectStatus(await join(ctx, ayse, 3), 200)
      const before = await h.stateOf(ctx, ali.token)
      assert.equal(before.meta.voice['3'].length, 1)
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      h.expectStatus(await join(ctx, ayse, dmId), 200)
      const now = await h.stateOf(ctx, ali.token)
      assert.notEqual(now.metaVersion, before.metaVersion)
      assert.equal((now.meta.voice['3'] || []).length, 0)
      assert.ok(!(String(dmId) in now.meta.voice))
    } finally {
      await ctx.cleanup()
    }
  })

  it('aramalar diske yazılmaz, yeniden başlatmada kaybolur', async () => {
    let { ctx, ayse, mehmet, dmId } = await pair()
    try {
      h.expectStatus(await start(ctx, ayse, dmId, true), 200)
      ctx = await ctx.restart()
      for (const name of fs.readdirSync(ctx.dataDir)) {
        const file = path.join(ctx.dataDir, name)
        if (fs.statSync(file).isFile()) assert.ok(!fs.readFileSync(file, 'utf8').includes('ringUntil'), name)
      }
      assert.equal(await callOf(ctx, mehmet), null)
      assert.equal(await callOf(ctx, ayse), null)
      h.expectStatus(await join(ctx, ayse, dmId), 404, 'channel_not_found')
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('özel mesaj araması: bitiren olaylar', () => {
  it('engel çalan ve süren aramayı bitirir', async () => {
    const { ctx, ayse, mehmet, dmId } = await pair()
    try {
      await activeCall(ctx, ayse, mehmet, dmId)
      h.expectStatus(await h.post(ctx, '/api/blocks/add', mehmet.token, { userId: ayse.user.id }), 200)
      assert.equal(await callOf(ctx, ayse), null)
      assert.equal(await callOf(ctx, mehmet), null)
      await expectOutOfVoice(ctx, ayse)
      await expectOutOfVoice(ctx, mehmet)
      h.expectStatus(await join(ctx, ayse, dmId), 404, 'channel_not_found')
    } finally {
      await ctx.cleanup()
    }
  })

  it('arkadaşlıktan çıkarma çalan aramayı bitirir', async () => {
    const { ctx, ayse, mehmet, dmId } = await pair()
    try {
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      h.expectStatus(await join(ctx, ayse, dmId), 200)
      h.expectStatus(await h.post(ctx, '/api/friends/remove', mehmet.token, { userId: ayse.user.id }), 200)
      assert.equal(await callOf(ctx, ayse), null)
      assert.equal(await callOf(ctx, mehmet), null)
      await expectOutOfVoice(ctx, ayse)
      h.expectStatus(await join(ctx, mehmet, dmId), 404, 'channel_not_found')
    } finally {
      await ctx.cleanup()
    }
  })

  it('yasaklama, frekanstan atma ve hesap silme aramayı bitirir', async () => {
    const { ctx, owner, ayse, mehmet, ali, dmId } = await pair()
    try {
      // Aranan hiç katılmadan yasaklanır
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      h.expectStatus(await join(ctx, ayse, dmId), 200)
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: mehmet.user.id, banned: true }), 200)
      assert.equal(await callOf(ctx, ayse), null)
      await expectOutOfVoice(ctx, ayse)

      // Arayan frekanstan atılır
      await befriend(ctx, ali, ayse)
      const withAli = await openDm(ctx, ali, ayse)
      h.expectStatus(await start(ctx, ali, withAli), 200)
      assert.equal((await callOf(ctx, ayse)).dmId, withAli)
      h.expectStatus(await h.post(ctx, '/api/users/kick', owner.token, { userId: ali.user.id }), 200)
      assert.equal(await callOf(ctx, ayse), null)

      // Etkin aramadaki üye hesabını siler
      const zeynep = await h.addUser(ctx, owner.token, 'zeynep')
      await befriend(ctx, ayse, zeynep)
      const withZeynep = await openDm(ctx, ayse, zeynep)
      await activeCall(ctx, ayse, zeynep, withZeynep)
      h.expectStatus(await h.post(ctx, '/api/me/delete', zeynep.token, { authKey: h.authKeyFor(h.PASSWORD) }), 200)
      assert.equal(await callOf(ctx, ayse), null)
      await expectOutOfVoice(ctx, ayse)
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('özel mesaj araması: ses odası kurallarının sınırları', () => {
  it('ses odası denetimi özel aramaya dokunmaz', async () => {
    const { ctx, owner, ayse, mehmet, dmId } = await pair()
    try {
      await activeCall(ctx, ayse, mehmet, dmId, true)
      h.expectStatus(await h.post(ctx, '/api/voice/camera', ayse.token, { on: true }), 200)
      const moderate = (action) => h.post(ctx, '/api/voice/moderate', owner.token, { userId: ayse.user.id, action })
      h.expectStatus(await moderate('disconnect'), 409, 'target_not_in_voice')
      h.expectStatus(await moderate('camera-off'), 409, 'target_not_in_voice')
      const call = await callOf(ctx, mehmet)
      assert.equal(call.state, 'active')
      assert.deepEqual(call.members.map((m) => [m.userId, m.camera, m.muted]), [[ayse.user.id, true, false], [mehmet.user.id, false, false]])
      // Hesap düzeyindeki susturma kaydedilir ama özel aramadaki oturuma uygulanmaz
      h.expectStatus(await moderate('mute'), 200)
      // Mehmet'in ses durumu özel odayı değiştirir, önbellekteki görünüm yeniden kurulur
      h.expectStatus(await h.post(ctx, '/api/voice/state', mehmet.token, { muted: false, deafened: true }), 200)
      const after = await callOf(ctx, mehmet)
      assert.deepEqual(after.members.map((m) => [m.userId, m.muted]), [[ayse.user.id, false], [mehmet.user.id, false]])
      assert.equal(after.members[1].deafened, true)
      h.expectStatus(await h.post(ctx, '/api/voice/state', ayse.token, { muted: false, deafened: false }), 200)
      assert.equal((await callOf(ctx, mehmet)).members[0].muted, false)
    } finally {
      await ctx.cleanup()
    }
  })

  it('sunucu susturması özel aramada uygulanmaz, ses odasında uygulanır', async () => {
    const { ctx, owner, ayse, mehmet, dmId } = await pair()
    try {
      h.expectStatus(await h.post(ctx, '/api/voice/moderate', owner.token, { userId: ayse.user.id, action: 'mute' }), 200)
      await activeCall(ctx, ayse, mehmet, dmId)
      assert.equal((await callOf(ctx, mehmet)).members[0].muted, false)
      h.expectStatus(await h.post(ctx, '/api/voice/state', ayse.token, { muted: false, deafened: false }), 200)
      assert.equal((await callOf(ctx, mehmet)).members[0].muted, false)
      h.expectStatus(await join(ctx, ayse, 3), 200)
      const meta = (await h.stateOf(ctx, owner.token)).meta
      assert.equal(meta.voice['3'][0].muted, true)
    } finally {
      await ctx.cleanup()
    }
  })

  it('kamera sınırı özel aramada 2: frekansın maxCameras ayarı uygulanmaz', async () => {
    const { ctx, owner, ayse, mehmet, dmId } = await pair()
    try {
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { voice: { maxCameras: 1 } }), 200)
      await activeCall(ctx, ayse, mehmet, dmId, true)
      h.expectStatus(await h.post(ctx, '/api/voice/camera', ayse.token, { on: true }), 200)
      h.expectStatus(await h.post(ctx, '/api/voice/camera', mehmet.token, { on: true }), 200)
      assert.deepEqual((await callOf(ctx, ayse)).members.map((m) => m.camera), [true, true])
      // Ses odasında frekansın sınırı geçerlidir
      h.expectStatus(await join(ctx, owner, 3), 200)
      h.expectStatus(await join(ctx, ayse, 3), 200)
      h.expectStatus(await h.post(ctx, '/api/voice/camera', owner.token, { on: true }), 200)
      const limited = await h.post(ctx, '/api/voice/camera', ayse.token, { on: true })
      h.expectStatus(limited, 409, 'camera_limit')
    } finally {
      await ctx.cleanup()
    }
  })

  it('sahip kameraları kapatınca özel aramadaki kameralar kapanır ve yeni kamera reddedilir', async () => {
    const { ctx, owner, ayse, mehmet, dmId } = await pair()
    try {
      await activeCall(ctx, ayse, mehmet, dmId, true)
      h.expectStatus(await h.post(ctx, '/api/voice/camera', ayse.token, { on: true }), 200)
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { voice: { cameras: false } }), 200)
      assert.equal((await callOf(ctx, mehmet)).members[0].camera, false)
      h.expectStatus(await h.post(ctx, '/api/voice/camera', ayse.token, { on: true }), 403, 'camera_disabled')
      h.expectStatus(await h.post(ctx, '/api/voice/camera', mehmet.token, { on: true }), 403, 'camera_disabled')
    } finally {
      await ctx.cleanup()
    }
  })

  it('hız sınırı: başlatma ve reddetme kullanıcı başına sınırlanır', async () => {
    const { ctx, ayse, mehmet, dmId } = await pair({ callLimit: 3, callWindowMs: 60000 })
    try {
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      h.expectStatus(await decline(ctx, ayse, dmId), 200)
      h.expectStatus(await start(ctx, ayse, dmId), 429, 'rate_limited')
      h.expectStatus(await decline(ctx, ayse, dmId), 429, 'rate_limited')
      // Sayaç kullanıcı başınadır
      h.expectStatus(await start(ctx, mehmet, dmId), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('aynı arayanın yeni araması önceki çalan aramasını iptal eder, aynı konuşmada aynı kayıt döner', async () => {
    const { ctx, ayse, mehmet, ali, dmId } = await pair()
    try {
      await befriend(ctx, ayse, ali)
      const withAli = await openDm(ctx, ayse, ali)
      const first = await start(ctx, ayse, dmId, true)
      h.expectStatus(first, 200)
      const again = await start(ctx, ayse, dmId, false)
      assert.deepEqual(again.data, first.data)
      h.expectStatus(await join(ctx, ayse, dmId), 200)

      h.expectStatus(await start(ctx, ayse, withAli), 200)
      assert.equal(await callOf(ctx, mehmet), null)
      h.expectStatus(await join(ctx, mehmet, dmId), 404, 'channel_not_found')
      assert.equal((await callOf(ctx, ali)).role, 'callee')
      assert.equal((await callOf(ctx, ayse)).dmId, withAli)
      // Önceki aramanın odasından çıkarıldı
      await expectOutOfVoice(ctx, ayse)
    } finally {
      await ctx.cleanup()
    }
  })

  it('yeni arama yalnızca arayanın kendi çalan aramalarını iptal eder', async () => {
    const { ctx, ayse, mehmet, ali, dmId } = await pair()
    try {
      await befriend(ctx, ali, ayse)
      const withAli = await openDm(ctx, ali, ayse)
      // Ayşe'ye gelen arama, Ayşe'nin yeni aramasıyla iptal edilmez
      h.expectStatus(await start(ctx, ali, withAli), 200)
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      assert.deepEqual([(await callOf(ctx, ali)).dmId, (await callOf(ctx, ali)).state], [withAli, 'ringing'])
      h.expectStatus(await decline(ctx, ayse, withAli), 200)
      h.expectStatus(await decline(ctx, ayse, dmId), 200)

      // Arayanın süren araması yeni aramayla bitmez (odadan ayrılınca biter)
      await activeCall(ctx, ayse, mehmet, dmId)
      await befriend(ctx, ali, mehmet)
      const am = await openDm(ctx, ali, mehmet)
      h.expectStatus(await start(ctx, mehmet, am), 200)
      assert.equal((await callOf(ctx, ayse)).state, 'active')
      assert.equal((await callOf(ctx, ali)).dmId, am)
    } finally {
      await ctx.cleanup()
    }
  })

  it('kabul eden kişinin kendi çalan araması iptal edilir', async () => {
    const { ctx, ayse, mehmet, ali, dmId } = await pair()
    try {
      await befriend(ctx, mehmet, ali)
      const am = await openDm(ctx, mehmet, ali)
      // İki taraf aynı anda arayınca (glare kabulü)
      h.expectStatus(await start(ctx, mehmet, am), 200)
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      const glare = await start(ctx, mehmet, dmId)
      assert.equal(glare.data.answer, true)
      assert.equal(await callOf(ctx, ali), null)
      h.expectStatus(await join(ctx, ali, am), 404, 'channel_not_found')
      h.expectStatus(await decline(ctx, mehmet, dmId), 200)

      // Aramanın odasına katılarak kabul edince
      h.expectStatus(await start(ctx, mehmet, am), 200)
      h.expectStatus(await start(ctx, ayse, dmId), 200)
      h.expectStatus(await join(ctx, ayse, dmId), 200)
      h.expectStatus(await join(ctx, mehmet, dmId), 200)
      assert.equal(await callOf(ctx, ali), null)
      assert.equal((await callOf(ctx, mehmet)).state, 'active')
    } finally {
      await ctx.cleanup()
    }
  })

  it('iki taraf aynı anda ararsa ikinci arama kabul sayılır', async () => {
    const { ctx, ayse, mehmet, dmId } = await pair()
    try {
      h.expectStatus(await start(ctx, ayse, dmId, true), 200)
      const glare = await start(ctx, mehmet, dmId, false)
      h.expectStatus(glare, 200)
      assert.equal(glare.data.answer, true)
      assert.deepEqual([glare.data.call.role, glare.data.call.state, glare.data.call.userId, glare.data.call.video], ['callee', 'ringing', ayse.user.id, true])
      h.expectStatus(await join(ctx, mehmet, dmId), 200)
      h.expectStatus(await join(ctx, ayse, dmId), 200)
      assert.equal((await callOf(ctx, ayse)).state, 'active')
      // Süren aramada başlatma kaydı olduğu gibi döndürür
      const during = await start(ctx, mehmet, dmId)
      assert.equal(during.data.answer, undefined)
      assert.equal(during.data.call.state, 'active')
      assert.equal(during.data.call.role, 'callee')
    } finally {
      await ctx.cleanup()
    }
  })
})
