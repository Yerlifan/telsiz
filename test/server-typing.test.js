'use strict'

// Yazıyor bildirimi: istek ve seçenek doğrulaması, kullanıcı başına hız sınırı, hedef kitle (yazı
// kanalında herkes, özel mesajda yalnızca iki üye), üçüncü kişiye hiçbir yoldan sızmaması, engel
// ilişkisi, süre dolunca kendiliğinden düşme, poll'da typing ve tv, yalnızca görünümü değişen
// kullanıcıların bekleyenlerinin uyanması ve diske hiç yazılmaması.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const h = require('./server-yardimci')
const { createChatServer, DEFAULTS } = require('../src/app')

async function group (options) {
  const ctx = await h.startServer(options)
  const owner = await h.setupOwner(ctx)
  const ayse = await h.addUser(ctx, owner.token, 'ayse')
  const mehmet = await h.addUser(ctx, owner.token, 'mehmet')
  const ali = await h.addUser(ctx, owner.token, 'ali')
  // İlk oturumlu istek kullanıcıyı çevrimiçi yapar ve meta yayınıyla bekleyenleri uyandırır,
  // bu yüzden herkes poll'lar başlamadan çevrimiçi olur
  for (const who of [owner, ayse, mehmet, ali]) await h.stateOf(ctx, who.token)
  return { ctx, owner, ayse, mehmet, ali }
}

function typing (ctx, who, body, headers) {
  return h.request(ctx, 'POST', '/api/typing', { token: who.token, body, headers })
}

async function startTyping (ctx, who, channelId) {
  const res = await typing(ctx, who, { channelId })
  h.expectStatus(res, 200)
  assert.deepEqual(res.data, { ok: true })
}

async function stopTyping (ctx, who, channelId) {
  const res = await typing(ctx, who, { channelId, stop: true })
  h.expectStatus(res, 200)
  assert.deepEqual(res.data, { ok: true })
}

async function openDm (ctx, from, to) {
  const res = await h.post(ctx, '/api/dms/open', from.token, { userId: to.user.id })
  h.expectStatus(res, 200)
  return res.data.dm.id
}

async function typingOf (ctx, who) {
  return (await h.stateOf(ctx, who.token)).typing
}

// Her kullanıcı için güncel durumdan başlayan poll istemcisi
async function pollersFor (ctx, list) {
  const out = []
  for (const who of list) out.push(h.poller(ctx, who.token, await h.stateOf(ctx, who.token)))
  return out
}

// Poll'ları başlatır ve hepsi sunucuda beklemeye alınana kadar bekler
async function waiting (ctx, list) {
  const base = ctx.server.stats().waiters
  const pending = list.map((p) => p.poll())
  await h.waitFor(() => ctx.server.stats().waiters === base + list.length, { label: 'bekleyen poll' })
  return pending
}

// Uyanmaması gereken bekleyenlere zaman tanınır, ardından bekleyen sayısı denetlenir
async function expectWaiters (ctx, count) {
  await h.sleep(100)
  assert.equal(ctx.server.stats().waiters, count)
}

describe('yazıyor bildirimi: doğrulama ve hız sınırı', () => {
  it('varsayılanlar 30 / 10 sn ve 6 sn, geçersiz seçenekler reddedilir', async () => {
    assert.equal(DEFAULTS.typingLimit, 30)
    assert.equal(DEFAULTS.typingWindowMs, 10000)
    assert.equal(DEFAULTS.typingTtlMs, 6000)
    const root = h.makeRoot()
    try {
      const dataDir = path.join(root, 'veri')
      for (const bad of [{ typingTtlMs: 0 }, { typingTtlMs: 2147483648 }, { typingTtlMs: 1.5 }, { typingLimit: 0 }, { typingWindowMs: '10000' }]) {
        await assert.rejects(createChatServer(Object.assign({ dataDir, scryptN: 1024, log: null }, bad)), TypeError, JSON.stringify(bad))
      }
      assert.equal(fs.existsSync(dataDir), false)
    } finally {
      h.removeRoot(root)
    }
  })

  it('istek doğrulaması: oturum, yöntem, stop türü ve okunamayan kanallar', async () => {
    const { ctx, ayse, mehmet, ali } = await group()
    try {
      const dmId = await openDm(ctx, ayse, mehmet)
      h.expectStatus(await h.request(ctx, 'POST', '/api/typing', { body: { channelId: 1 } }), 401, 'invalid_token')
      h.expectStatus(await h.get(ctx, '/api/typing', ayse.token), 405, 'method_not_allowed')
      for (const stop of [1, 'true', null, {}]) {
        h.expectStatus(await typing(ctx, ayse, { channelId: 1, stop }), 400, 'bad_request')
      }
      // Ses kanalı, olmayan kanal, başkasının özel konuşması ve geçersiz kimlikler bulunamaz
      for (const channelId of [3, 999, dmId, undefined, null, 'abc', -1, 1.5, '01']) {
        h.expectStatus(await typing(ctx, ali, { channelId }), 404, 'channel_not_found')
      }
      assert.deepEqual(await typingOf(ctx, mehmet), {})
      // Kimlik dizge olarak da kabul edilir, yazmayan kişinin bırakması sorun değildir
      await startTyping(ctx, ayse, '1')
      assert.deepEqual(await typingOf(ctx, mehmet), { 1: [ayse.user.id] })
      await stopTyping(ctx, ayse, 1)
      await stopTyping(ctx, ayse, 1)
      assert.deepEqual(await typingOf(ctx, mehmet), {})
      // stop: false başlatmadır
      h.expectStatus(await typing(ctx, ayse, { channelId: 1, stop: false }), 200)
      assert.deepEqual(await typingOf(ctx, mehmet), { 1: [ayse.user.id] })
    } finally {
      await ctx.cleanup()
    }
  })

  it('hız sınırı kullanıcı başınadır, başlatma ve bırakma birlikte sayılır, metin isteğin dilinde', async () => {
    const { ctx, ayse, mehmet } = await group()
    try {
      for (const i of h.times(30)) {
        const body = i % 2 === 0 ? { channelId: 1 } : { channelId: 1, stop: true }
        h.expectStatus(await typing(ctx, ayse, body), 200)
      }
      const limited = await typing(ctx, ayse, { channelId: 1 }, { 'accept-language': 'tr' })
      h.expectStatus(limited, 429, 'rate_limited')
      const retry = Number(limited.headers['retry-after'])
      assert.ok(retry >= 1 && retry <= 10, String(retry))
      assert.equal(limited.data.error, 'Yazıyor bilgisi çok sık gönderiliyor, lütfen biraz bekleyin.')
      const english = await typing(ctx, ayse, { channelId: 1, stop: true }, { 'accept-language': 'en-US' })
      h.expectStatus(english, 429, 'rate_limited')
      assert.equal(english.data.error, 'Typing updates are being sent too often. Please wait a moment.')
      // Başka kullanıcı etkilenmez
      await startTyping(ctx, mehmet, 1)
    } finally {
      await ctx.cleanup()
    }
  })

  it('pencere geçince yeniden izin verilir (kısa pencere ayarı)', async () => {
    const { ctx, ayse } = await group({ typingLimit: 2, typingWindowMs: 300 })
    try {
      await startTyping(ctx, ayse, 1)
      await startTyping(ctx, ayse, 1)
      h.expectStatus(await typing(ctx, ayse, { channelId: 1 }), 429, 'rate_limited')
      await h.sleep(350)
      await startTyping(ctx, ayse, 1)
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('yazıyor bildirimi: hedef kitle ve uyanma', () => {
  it('yazı kanalında herkes görür, kendisi listede yok, yalnızca görünümü değişenler uyanır', async () => {
    const { ctx, owner, ayse, mehmet } = await group({ pollTimeoutMs: 8000 })
    try {
      const [po, pa, pm] = await pollersFor(ctx, [owner, ayse, mehmet])
      for (const p of [po, pa, pm]) {
        assert.deepEqual(p.st.typing, {})
        assert.equal(p.st.tv, 1)
      }
      const w1 = await waiting(ctx, [po, pa, pm])
      await startTyping(ctx, ayse, 1)
      for (const res of [await w1[0], await w1[2]]) {
        h.expectStatus(res, 200)
        assert.deepEqual(res.data.typing, { 1: [ayse.user.id] })
        assert.equal(res.data.tv, 2)
        assert.deepEqual(res.data.events, [])
        assert.equal('meta' in res.data, false)
        assert.equal('private' in res.data, false)
      }
      // Yazanın kendi bekleyeni uyanmaz, süre yenilemesi kimseyi uyandırmaz
      const w2 = await waiting(ctx, [po, pm])
      await startTyping(ctx, ayse, 1)
      await expectWaiters(ctx, 3)
      assert.deepEqual(await typingOf(ctx, ayse), {})

      // İkinci yazan: liste yazmaya başlama sırasıyla, yazan diğerini görür
      await startTyping(ctx, mehmet, 1)
      assert.deepEqual((await w1[1]).data.typing, { 1: [mehmet.user.id] })
      assert.deepEqual((await w2[0]).data.typing, { 1: [ayse.user.id, mehmet.user.id] })
      await expectWaiters(ctx, 1)

      // Bırakan görünümden çıkar: görünümü değişen sahip ve mehmet uyanır, ayşe beklemeye devam eder
      const w3 = await waiting(ctx, [po, pa])
      await stopTyping(ctx, ayse, 1)
      assert.deepEqual((await w3[0]).data.typing, { 1: [mehmet.user.id] })
      assert.deepEqual((await w2[1]).data.typing, {})
      await expectWaiters(ctx, 1)

      // Mesaj gönderen yazanlardan düşer, olay ve typing aynı yanıtta gelir
      const w4 = await waiting(ctx, [po, pm])
      const m = await h.sendMessage(ctx, mehmet.token, 1)
      for (const res of [await w4[0], await w3[1]]) {
        assert.deepEqual(res.data.events.map((e) => e.message.id), [m.id])
        assert.deepEqual(res.data.typing, {})
      }
      // Gönderenin kendi görünümü değişmedi, olayı typing olmadan alır
      const own = await w4[1]
      assert.deepEqual(own.data.events.map((e) => e.message.id), [m.id])
      assert.equal('typing' in own.data, false)
      assert.equal(ctx.server.stats().typing, 0)
    } finally {
      await ctx.cleanup()
    }
  })

  it('özel mesajda yalnızca iki üye görür, üçüncü kişiye (sahip dahil) hiçbir yoldan sızmaz', async () => {
    const { ctx, owner, ayse, mehmet, ali } = await group({ pollTimeoutMs: 8000 })
    try {
      const dmId = await openDm(ctx, ayse, mehmet)
      const [po, pa, pm, pl] = await pollersFor(ctx, [owner, ayse, mehmet, ali])
      const w = await waiting(ctx, [po, pm, pl, pa])
      await startTyping(ctx, ayse, dmId)
      const rm = await w[1]
      assert.deepEqual(rm.data.typing, { [dmId]: [ayse.user.id] })
      assert.equal(rm.data.tv, 2)
      // Üçüncü kişilerin ve yazanın bekleyenleri uyanmadı
      await expectWaiters(ctx, 3)
      // Karşı taraf da yazınca yalnızca ayşe uyanır
      await startTyping(ctx, mehmet, dmId)
      assert.deepEqual((await w[3]).data.typing, { [dmId]: [mehmet.user.id] })
      await expectWaiters(ctx, 2)

      // Üçüncü kişiler: durum, eski tv ile poll, resync ve konuşmaya yazma denemesi
      const texts = []
      for (const who of [owner, ali]) {
        const st = await h.stateOf(ctx, who.token)
        assert.deepEqual(st.typing, {})
        assert.equal(st.tv, 1)
        const stale = await h.get(ctx, '/api/poll?since=' + st.seq + '&mv=' + st.metaVersion + '&pmv=' + st.pmv + '&tv=0&sig=0&boot=' + st.boot, who.token)
        h.expectStatus(stale, 200)
        assert.deepEqual(stale.data.typing, {})
        assert.equal(stale.data.tv, 1)
        const resync = await h.get(ctx, '/api/poll?since=0&mv=0&pmv=0&tv=0&sig=0&boot=yanlis', who.token)
        assert.equal(resync.data.resync, true)
        assert.deepEqual(resync.data.typing, {})
        h.expectStatus(await typing(ctx, who, { channelId: dmId }), 404, 'channel_not_found')
        h.expectStatus(await typing(ctx, who, { channelId: dmId, stop: true }), 404, 'channel_not_found')
        texts.push(stale.text, resync.text)
      }
      assert.equal(ctx.server.stats().waiters, 2)

      // Yazı kanalındaki yazma üçüncü kişilere gider, özel konuşma bilgisi yine yoktur
      await startTyping(ctx, ayse, 1)
      for (const res of [await w[0], await w[2]]) {
        assert.deepEqual(res.data.typing, { 1: [ayse.user.id] })
        texts.push(res.text)
      }
      for (const text of texts) assert.ok(!text.includes('"' + dmId + '":'), text)
      assert.deepEqual(await typingOf(ctx, mehmet), { 1: [ayse.user.id], [dmId]: [ayse.user.id] })
      assert.deepEqual(await typingOf(ctx, ayse), { [dmId]: [mehmet.user.id] })
    } finally {
      await ctx.cleanup()
    }
  })

  it('engel ilişkisinde iki yönde de görünmez, engel değişince görünüm yenilenir', async () => {
    const { ctx, owner, ayse, mehmet } = await group({ pollTimeoutMs: 8000 })
    try {
      const dmId = await openDm(ctx, ayse, mehmet)
      await startTyping(ctx, ayse, 1)
      await startTyping(ctx, ayse, dmId)
      const [pm] = await pollersFor(ctx, [mehmet])
      assert.deepEqual(pm.st.typing, { 1: [ayse.user.id], [dmId]: [ayse.user.id] })

      // Engelleyince engelleyenin görünümü hemen yenilenir (yazı kanalı ve özel konuşma)
      const w1 = await waiting(ctx, [pm])
      h.expectStatus(await h.post(ctx, '/api/blocks/add', mehmet.token, { userId: ayse.user.id }), 200)
      assert.deepEqual((await w1[0]).data.typing, {})

      // Engellenenin yazması engelleyeni uyandırmaz ve görünmez, başkaları görür
      const w2 = await waiting(ctx, [pm])
      await stopTyping(ctx, ayse, 1)
      await startTyping(ctx, ayse, 1)
      await expectWaiters(ctx, 1)
      assert.deepEqual(await typingOf(ctx, mehmet), {})
      assert.deepEqual(await typingOf(ctx, owner), { 1: [ayse.user.id] })
      // Engellenen de engelleyenin yazmasını görmez
      await startTyping(ctx, mehmet, 2)
      assert.deepEqual(await typingOf(ctx, ayse), {})
      assert.deepEqual(await typingOf(ctx, owner), { 1: [ayse.user.id], 2: [mehmet.user.id] })
      await expectWaiters(ctx, 1)

      // Engelli özel konuşmada iki taraf da yazmaya başlayamaz, bırakmak serbesttir
      for (const who of [ayse, mehmet]) {
        h.expectStatus(await typing(ctx, who, { channelId: dmId }), 403, 'dm_not_allowed')
        await stopTyping(ctx, who, dmId)
      }

      // Engel kalkınca yeniden görünür, görünümü değişenler uyanır
      const pa = (await pollersFor(ctx, [ayse]))[0]
      const w3 = await waiting(ctx, [pa])
      h.expectStatus(await h.post(ctx, '/api/blocks/remove', mehmet.token, { userId: ayse.user.id }), 200)
      assert.deepEqual((await w2[0]).data.typing, { 1: [ayse.user.id] })
      assert.deepEqual((await w3[0]).data.typing, { 2: [mehmet.user.id] })
      await startTyping(ctx, ayse, dmId)
      assert.deepEqual(await typingOf(ctx, mehmet), { 1: [ayse.user.id], [dmId]: [ayse.user.id] })
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('yazıyor bildirimi: süre, poll alanları ve kalıcılık', () => {
  it('süre dolunca kendiliğinden düşer ve bekleyenler uyanır, yenilenen bildirim düşmez (kısa süre ayarı)', async () => {
    const { ctx, owner, ayse } = await group({ typingTtlMs: 1000, pollTimeoutMs: 8000 })
    try {
      const [po] = await pollersFor(ctx, [owner])
      const w1 = await waiting(ctx, [po])
      const started = Date.now()
      await startTyping(ctx, ayse, 1)
      assert.deepEqual((await w1[0]).data.typing, { 1: [ayse.user.id] })
      // Süre dolmadan yenilenir, bitiş yenilemeden itibaren sayılır
      await h.sleep(300)
      await startTyping(ctx, ayse, 1)
      const refreshed = Date.now()
      const w2 = await waiting(ctx, [po])
      const res = await w2[0]
      assert.deepEqual(res.data.typing, {})
      assert.deepEqual(res.data.events, [])
      assert.ok(Date.now() - refreshed >= 800, String(Date.now() - refreshed))
      assert.ok(Date.now() - started >= 1200, String(Date.now() - started))
      assert.equal(ctx.server.stats().typing, 0)
      assert.deepEqual(await typingOf(ctx, ayse), {})
      assert.deepEqual(await typingOf(ctx, owner), {})
    } finally {
      await ctx.cleanup()
    }
  })

  it('poll: tv verilmezse yazıyor bilgisi gelmez ve uyandırmaz, eski tv hemen yanıtlanır, durum ve resync typing içerir', async () => {
    const { ctx, owner, ayse } = await group({ pollTimeoutMs: 400 })
    try {
      const st = await h.stateOf(ctx, owner.token)
      assert.deepEqual(st.typing, {})
      assert.equal(st.tv, 1)
      const base = '/api/poll?since=' + st.seq + '&mv=' + st.metaVersion + '&pmv=' + st.pmv + '&sig=0&boot=' + st.boot
      const pending = h.get(ctx, base, owner.token)
      await h.waitFor(() => ctx.server.stats().waiters === 1)
      const typedAt = Date.now()
      await startTyping(ctx, ayse, 1)
      const quiet = await pending
      assert.ok(Date.now() - typedAt >= 200, 'tv olmadan uyanmamalı')
      assert.deepEqual(quiet.data, { boot: st.boot, seq: st.seq, metaVersion: st.metaVersion, pmv: st.pmv, tv: 2, events: [], signals: [] })
      // Geçersiz tv de izlemiyor sayılır
      for (const tv of ['abc', '-1', '1.5']) {
        const res = await h.get(ctx, base + '&tv=' + tv, owner.token)
        assert.equal('typing' in res.data, false, tv)
        assert.equal(res.data.tv, 2)
      }
      // Güncel tv beklenir, eski tv hemen yanıtlanır
      const current = await h.get(ctx, base + '&tv=2', owner.token)
      assert.equal('typing' in current.data, false)
      const started = Date.now()
      const stale = await h.get(ctx, base + '&tv=1', owner.token)
      assert.ok(Date.now() - started < 300)
      assert.deepEqual(stale.data.typing, { 1: [ayse.user.id] })
      assert.equal(stale.data.tv, 2)
      // Resync ve durum yanıtı
      const resync = await h.get(ctx, '/api/poll?since=0&mv=0&sig=0&boot=yanlis', owner.token)
      assert.equal(resync.data.resync, true)
      assert.deepEqual(resync.data.typing, { 1: [ayse.user.id] })
      assert.equal(resync.data.tv, 2)
      const again = await h.stateOf(ctx, owner.token)
      assert.deepEqual(again.typing, { 1: [ayse.user.id] })
      assert.equal(again.tv, 2)
    } finally {
      await ctx.cleanup()
    }
  })

  it('diske yazılmaz, kanal silinince, son oturum kapanınca ve sunucu engelinde düşer', async () => {
    const { ctx, owner, ayse, mehmet, ali } = await group()
    try {
      const created = await h.post(ctx, '/api/channels/create', owner.token, { name: 'gecici', type: 'text' })
      h.expectStatus(created, 200)
      const tempId = created.data.channel.id
      await h.sendMessage(ctx, owner.token, tempId)
      const second = await h.login(ctx, 'ayse')
      h.expectStatus(second, 200)
      await ctx.server.flush()
      const stateFile = path.join(ctx.dataDir, 'state.json')
      const messagesDir = path.join(ctx.dataDir, 'messages')
      const stateBefore = fs.readFileSync(stateFile, 'utf8')
      const filesBefore = fs.readdirSync(messagesDir).sort()
      const contentBefore = filesBefore.map((name) => fs.readFileSync(path.join(messagesDir, name), 'utf8'))

      await startTyping(ctx, ayse, tempId)
      await startTyping(ctx, mehmet, 1)
      await startTyping(ctx, ali, 1)
      await stopTyping(ctx, ali, 1)
      await startTyping(ctx, ali, 2)
      await startTyping(ctx, ayse, 1)
      await ctx.server.flush()
      assert.equal(fs.readFileSync(stateFile, 'utf8'), stateBefore)
      assert.deepEqual(fs.readdirSync(messagesDir).sort(), filesBefore)
      assert.deepEqual(filesBefore.map((name) => fs.readFileSync(path.join(messagesDir, name), 'utf8')), contentBefore)
      assert.equal(ctx.server.stats().typing, 4)
      assert.deepEqual(await typingOf(ctx, owner), { 1: [mehmet.user.id, ayse.user.id], 2: [ali.user.id], [tempId]: [ayse.user.id] })

      // Kanal silinince o kanalın yazanları düşer
      h.expectStatus(await h.post(ctx, '/api/channels/delete', owner.token, { id: tempId }), 200)
      assert.deepEqual(await typingOf(ctx, owner), { 1: [mehmet.user.id, ayse.user.id], 2: [ali.user.id] })
      // Başka oturumu kalan kullanıcı düşmez, son oturumunu kapatan düşer
      h.expectStatus(await h.post(ctx, '/api/logout', second.data.token), 200)
      h.expectStatus(await h.post(ctx, '/api/logout', mehmet.token), 200)
      assert.deepEqual(await typingOf(ctx, owner), { 1: [ayse.user.id], 2: [ali.user.id] })
      // Sunucudan engellenen kullanıcı düşer
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: ali.user.id, banned: true }), 200)
      assert.deepEqual(await typingOf(ctx, owner), { 1: [ayse.user.id] })
      assert.equal(ctx.server.stats().typing, 1)
    } finally {
      await ctx.cleanup()
    }
  })
})
