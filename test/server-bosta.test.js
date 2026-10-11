'use strict'

// Otomatik boşta (src/hub.js, GET /api/poll?idle=0|1): oturum başına boşta bayrağı, kişinin bütün etkin oturumları
// boştaysa başkalarına Boşta görünmesi, elle seçilen durumların korunması, görünmez kişide meta sürümünün değişmemesi,
// oturum düşünce yeniden hesaplama, geçersiz değerler, boşa geçiş sınırı ve diske hiçbir şey yazılmaması.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const h = require('./server-yardimci')
const { createChatServer, DEFAULTS } = require('../src/app')

// Poll sorgusu yalnızca idle taşır: boot verilmediği için yanıt hemen yeniden eşitleme olarak döner
async function report (ctx, token, value) {
  const res = await h.get(ctx, '/api/poll?idle=' + encodeURIComponent(value), token)
  h.expectStatus(res, 200)
  assert.equal(res.data.resync, true)
  return res.data
}

// Sahibin gördüğü kayıt: { online, status } ve meta sürümü
async function seen (ctx, viewerToken, userId) {
  const st = await h.stateOf(ctx, viewerToken)
  const u = st.meta.users.find((x) => x.id === userId)
  return { online: u.online, status: u.status, mv: st.metaVersion }
}

function view (record) {
  return { online: record.online, status: record.status }
}

async function setStatus (ctx, token, status) {
  h.expectStatus(await h.post(ctx, '/api/me/status', token, { status }), 200)
}

describe('otomatik boşta', () => {
  it('iki oturumdan biri boştaysa kişi Çevrimiçi, ikisi de boştaysa Boşta görünür, dönüş hemen işlenir', async () => {
    const ctx = await h.startServer({ idleGapMs: 60000 })
    try {
      const owner = await h.setupOwner(ctx)
      const ayse = await h.addUser(ctx, owner.token, 'ayse')
      const second = (await h.login(ctx, 'ayse')).data.token
      await h.stateOf(ctx, ayse.token)
      await h.stateOf(ctx, second)
      const id = ayse.user.id
      assert.deepEqual(view(await seen(ctx, owner.token, id)), { online: true, status: 'online' })

      await report(ctx, ayse.token, '1')
      assert.deepEqual(view(await seen(ctx, owner.token, id)), { online: true, status: 'online' }, 'bir oturum hâlâ etkin')

      // Bekleyen poll ikinci oturum da boşa geçince yeni metayla uyanır
      const st = await h.stateOf(ctx, owner.token)
      const p = h.poller(ctx, owner.token, st)
      const waiting = h.nextRequest(ctx.server, '/api/poll')
      const pending = p.poll()
      await waiting
      await report(ctx, second, '1')
      const res = await pending
      h.expectStatus(res, 200)
      assert.ok(res.data.metaVersion > st.metaVersion)
      const woke = res.data.meta.users.find((u) => u.id === id)
      assert.equal(woke.online, true)
      assert.equal(woke.status, 'idle')

      // Kişinin kendi elle seçtiği durum değişmez, kendi metasında Boşta görünür
      const own = await h.stateOf(ctx, ayse.token)
      assert.equal(own.me.status, 'online')
      assert.equal(own.private.status, 'online')
      assert.equal(own.meta.users.find((u) => u.id === id).status, 'idle')

      // idle verilmeyen poll (eski istemci) bayrağa dokunmaz
      h.expectStatus(await h.get(ctx, '/api/poll', second), 200)
      assert.equal((await seen(ctx, owner.token, id)).status, 'idle')

      // Boştan dönüş sınır beklenmeden hemen işlenir
      await report(ctx, second, '0')
      assert.deepEqual(view(await seen(ctx, owner.token, id)), { online: true, status: 'online' })
      await report(ctx, second, '1')
      assert.equal((await seen(ctx, owner.token, id)).status, 'online', 'boşa geçiş sınırı (60 sn) dolmadı')

      // Yeni açılan oturum boşta değildir
      const third = (await h.login(ctx, 'ayse')).data.token
      await report(ctx, ayse.token, '1')
      assert.equal((await seen(ctx, owner.token, id)).status, 'online')
      await h.stateOf(ctx, third)
      assert.equal((await seen(ctx, owner.token, id)).status, 'online')
    } finally {
      await ctx.cleanup()
    }
  })

  it('elle seçilen Boşta, Rahatsız etmeyin ve Görünmez değişmez, görünmez kişinin geçişleri meta sürümünü artırmaz', async () => {
    const ctx = await h.startServer({ idleGapMs: 100 })
    try {
      const owner = await h.setupOwner(ctx)
      const ayse = await h.addUser(ctx, owner.token, 'ayse')
      const id = ayse.user.id
      await h.stateOf(ctx, ayse.token)
      await report(ctx, ayse.token, '1')
      assert.deepEqual(view(await seen(ctx, owner.token, id)), { online: true, status: 'idle' })

      // Rahatsız etmeyin: otomatik boşta görünmez ve geçişleri meta sürümünü artırmaz
      await setStatus(ctx, ayse.token, 'dnd')
      let before = await seen(ctx, owner.token, id)
      assert.deepEqual(view(before), { online: true, status: 'dnd' })
      await report(ctx, ayse.token, '0')
      await h.sleep(120)
      await report(ctx, ayse.token, '1')
      let after = await seen(ctx, owner.token, id)
      assert.deepEqual(view(after), { online: true, status: 'dnd' })
      assert.equal(after.mv, before.mv)

      // Elle seçilen Boşta oturumlar etkinken de Boşta kalır
      await setStatus(ctx, ayse.token, 'idle')
      await report(ctx, ayse.token, '0')
      assert.deepEqual(view(await seen(ctx, owner.token, id)), { online: true, status: 'idle' })

      // Görünmez: çevrimdışı görünür, boşta geçişleri hiçbir şey sızdırmaz
      await setStatus(ctx, ayse.token, 'invisible')
      before = await seen(ctx, owner.token, id)
      assert.deepEqual(view(before), { online: false, status: 'offline' })
      await h.sleep(120)
      await report(ctx, ayse.token, '1')
      await report(ctx, ayse.token, '0')
      await h.sleep(120)
      await report(ctx, ayse.token, '1')
      after = await seen(ctx, owner.token, id)
      assert.deepEqual(view(after), { online: false, status: 'offline' })
      assert.equal(after.mv, before.mv)

      // Çevrimiçi seçilince oturumun boşta bayrağı hemen görünür
      await setStatus(ctx, ayse.token, 'online')
      assert.deepEqual(view(await seen(ctx, owner.token, id)), { online: true, status: 'idle' })
    } finally {
      await ctx.cleanup()
    }
  })

  it('oturum kapanınca ve düşünce toplu durum yeniden hesaplanır', async () => {
    const ctx = await h.startServer({ pollTimeoutMs: 300, graceMs: 300 })
    try {
      const owner = await h.setupOwner(ctx)
      const ayse = await h.addUser(ctx, owner.token, 'ayse')
      const id = ayse.user.id
      const second = (await h.login(ctx, 'ayse')).data.token
      const third = (await h.login(ctx, 'ayse')).data.token
      await report(ctx, ayse.token, '1')
      await report(ctx, second, '0')
      await report(ctx, third, '0')
      assert.equal((await seen(ctx, owner.token, id)).status, 'online')

      // Etkin oturumlardan biri kapanır, öteki hâlâ etkin
      h.expectStatus(await h.post(ctx, '/api/logout', third), 200)
      assert.equal((await seen(ctx, owner.token, id)).status, 'online')

      // Kalan etkin oturum istek atmayı bırakınca düşer, boştaki oturum istek attıkça kişi Boşta görünür
      const record = await h.waitFor(async () => {
        await report(ctx, ayse.token, '1')
        const r = await seen(ctx, owner.token, id)
        return r.status === 'idle' ? r : null
      }, { timeout: 8000, label: 'etkin oturum düşünce Boşta' })
      assert.equal(record.online, true)

      // Düşen oturum yeniden istek atınca (bayrağı boşta değil) kişi yeniden Çevrimiçi görünür
      await h.stateOf(ctx, second)
      assert.equal((await seen(ctx, owner.token, id)).status, 'online')

      // Boştaki son etkin oturum da kapanınca kişi çevrimdışıdır
      h.expectStatus(await h.post(ctx, '/api/logout', second), 200)
      assert.equal((await seen(ctx, owner.token, id)).status, 'idle')
      h.expectStatus(await h.post(ctx, '/api/logout', ayse.token), 200)
      assert.deepEqual(view(await seen(ctx, owner.token, id)), { online: false, status: 'offline' })
    } finally {
      await ctx.cleanup()
    }
  })

  it('geçersiz değer yok sayılır, boşa geçiş sınırı uygulanır, diske hiçbir şey yazılmaz', async () => {
    const ctx = await h.startServer({ idleGapMs: 400 })
    try {
      const owner = await h.setupOwner(ctx)
      const ayse = await h.addUser(ctx, owner.token, 'ayse')
      const id = ayse.user.id
      await h.stateOf(ctx, ayse.token)
      await h.stateOf(ctx, owner.token)
      // state.json gecikmeli (200 ms) yazılır: bekleyen yazım bitince içerik alınır
      const stateFile = path.join(ctx.dataDir, 'state.json')
      await h.waitFor(() => fs.existsSync(stateFile), { label: 'state.json' })
      await h.sleep(500)
      const saved = fs.readFileSync(stateFile)

      for (const bad of ['evet', 'true', '2', '', ' 1', '01']) {
        await report(ctx, ayse.token, bad)
        assert.equal((await seen(ctx, owner.token, id)).status, 'online', 'geçersiz değer: ' + JSON.stringify(bad))
      }
      await report(ctx, ayse.token, '1')
      assert.equal((await seen(ctx, owner.token, id)).status, 'idle')
      await report(ctx, ayse.token, '0')
      assert.equal((await seen(ctx, owner.token, id)).status, 'online')
      // Son geçişten 400 ms geçmeden gelen boşa geçiş yok sayılır, istemci sonraki poll'da yeniden bildirir
      await report(ctx, ayse.token, '1')
      assert.equal((await seen(ctx, owner.token, id)).status, 'online')
      await h.sleep(450)
      await report(ctx, ayse.token, '1')
      assert.equal((await seen(ctx, owner.token, id)).status, 'idle')

      await h.sleep(500)
      assert.ok(fs.readFileSync(stateFile).equals(saved), 'state.json değişmemeli')
      assert.ok(!fs.readFileSync(stateFile, 'utf8').includes('idleAt'))
    } finally {
      await ctx.cleanup()
    }
  })

  it('varsayılan sınır 5 sn, geçersiz seçenek reddedilir', async () => {
    assert.equal(DEFAULTS.idleGapMs, 5000)
    const root = h.makeRoot()
    try {
      const dataDir = path.join(root, 'veri')
      for (const bad of [{ idleGapMs: 0 }, { idleGapMs: 1.5 }, { idleGapMs: '5000' }]) {
        await assert.rejects(createChatServer(Object.assign({ dataDir, scryptN: 1024, log: null }, bad)), /idleGapMs/, JSON.stringify(bad))
      }
      assert.equal(fs.existsSync(dataDir), false)
    } finally {
      h.removeRoot(root)
    }
  })
})
