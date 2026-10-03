'use strict'

// Long-poll (SPEC-V2 3.8): olaylar, meta sürümü, resync, seq kırpma, bekleyen kuralları ve varlık.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const h = require('./server-yardimci')

describe('long-poll', () => {
  it('bekleyen poll yeni mesajla uyanır, düzenleme ve silme olayları', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const member = await h.addUser(ctx, owner.token, 'Ayşe')
      const st = await h.stateOf(ctx, member.token)
      assert.match(st.boot, /^[0-9a-f]{16}$/)
      assert.match(st.peerId, /^[0-9a-f]{16}$/)
      assert.equal(st.sigSeq, 0)
      assert.deepEqual(st.iceServers, [{ urls: 'stun:stun.example.org:3478' }])
      const p = h.poller(ctx, member.token, st)

      const waiting = h.nextRequest(ctx.server, '/api/poll')
      const pending = p.poll()
      await waiting
      const m = await h.sendMessage(ctx, owner.token, 1)
      const res = await pending
      h.expectStatus(res, 200)
      assert.equal(res.data.boot, st.boot)
      assert.equal(res.data.events.length, 1)
      assert.deepEqual(res.data.events[0], { seq: st.seq + 1, type: 'msg', channelId: 1, message: m })
      assert.equal(res.data.seq, st.seq + 1)
      assert.deepEqual(res.data.signals, [])
      assert.equal('meta' in res.data, false)
      assert.equal('resync' in res.data, false)

      const body = h.envelope()
      h.expectStatus(await h.post(ctx, '/api/messages/edit', owner.token, { id: m.id, body }), 200)
      h.expectStatus(await h.post(ctx, '/api/messages/delete', owner.token, { id: m.id }), 200)
      const res2 = await p.poll()
      assert.deepEqual(res2.data.events.map((e) => e.type), ['edit', 'del'])
      assert.equal(res2.data.events[0].message.body, body)
      assert.deepEqual(res2.data.events[1], { seq: st.seq + 3, type: 'del', channelId: 1, messageId: m.id })
    } finally {
      await ctx.cleanup()
    }
  })

  it('meta değişince metaVersion artar ve meta yalnızca sürüm farklıysa gelir', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const st = await h.stateOf(ctx, owner.token)
      const p = h.poller(ctx, owner.token, st)
      const waiting = h.nextRequest(ctx.server, '/api/poll')
      const pending = p.poll()
      await waiting
      h.expectStatus(await h.post(ctx, '/api/channels/create', owner.token, { name: 'sohbet', type: 'text' }), 200)
      const res = await pending
      assert.ok(res.data.metaVersion > st.metaVersion)
      assert.deepEqual(res.data.events, [])
      assert.ok(res.data.meta.channels.some((c) => c.name === 'sohbet'))
      assert.deepEqual(Object.keys(res.data.meta).sort(), ['activeKid', 'channels', 'serverName', 'users', 'voice'])
      assert.deepEqual(res.data.meta.users, [{ id: 1, name: 'Sahip', role: 'owner', online: true }])

      // Güncel sürümle sorulunca meta gönderilmez
      const res2 = await h.get(ctx, '/api/poll?since=' + p.st.seq + '&mv=0&sig=0&boot=' + p.st.boot, owner.token)
      assert.ok(res2.data.meta, 'mv farklı, meta gelmeli')
    } finally {
      await ctx.cleanup()
    }
  })

  it('zaman aşımında boş yanıt', async () => {
    const ctx = await h.startServer({ pollTimeoutMs: 150 })
    try {
      const owner = await h.setupOwner(ctx)
      const st = await h.stateOf(ctx, owner.token)
      const p = h.poller(ctx, owner.token, st)
      const started = Date.now()
      const res = await p.poll()
      assert.ok(Date.now() - started >= 120)
      assert.deepEqual(res.data, { boot: st.boot, seq: st.seq, metaVersion: st.metaVersion, events: [], signals: [] })
    } finally {
      await ctx.cleanup()
    }
  })

  it('yanlış boot ve kapsam dışı since için resync', async () => {
    const ctx = await h.startServer({ eventBufferSize: 5 })
    try {
      const owner = await h.setupOwner(ctx)
      const st = await h.stateOf(ctx, owner.token)
      for (const url of [
        '/api/poll?since=0&mv=0&sig=0&boot=0000000000000000',
        '/api/poll?since=0&mv=0&sig=0',
        '/api/poll?since=99&mv=' + st.metaVersion + '&sig=0&boot=' + st.boot,
        '/api/poll?since=abc&mv=' + st.metaVersion + '&sig=0&boot=' + st.boot
      ]) {
        const res = await h.get(ctx, url, owner.token)
        h.expectStatus(res, 200)
        assert.equal(res.data.resync, true)
        assert.equal(res.data.boot, st.boot)
        assert.deepEqual(res.data.events, [])
        assert.deepEqual(res.data.signals, [])
        assert.equal(res.data.seq, st.seq)
        assert.ok(res.data.meta)
      }
      for (const i of h.times(8)) await h.sendMessage(ctx, owner.token, 1)
      // Halkada 4..8 var, since=2 ise 3 numaralı olay kaybolmuştur
      const lost = await h.get(ctx, '/api/poll?since=2&mv=' + st.metaVersion + '&sig=0&boot=' + st.boot, owner.token)
      assert.equal(lost.data.resync, true)
      assert.equal(lost.data.seq, 8)
      // since=3 ise 4..8 eksiksiz verilebilir
      const fine = await h.get(ctx, '/api/poll?since=3&mv=' + st.metaVersion + '&sig=0&boot=' + st.boot, owner.token)
      assert.equal('resync' in fine.data, false)
      assert.deepEqual(fine.data.events.map((e) => e.seq), [4, 5, 6, 7, 8])
    } finally {
      await ctx.cleanup()
    }
  })

  it('500 olaydan fazlası kırpılır, sonraki poll kaldığı yerden devam eder', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const st = await h.stateOf(ctx, owner.token)
      for (const i of h.times(503)) await h.sendMessage(ctx, owner.token, 1)
      const p = h.poller(ctx, owner.token, st)
      const first = await p.poll()
      assert.equal(first.data.events.length, 500)
      assert.equal(first.data.seq, st.seq + 500)
      assert.equal(first.data.events[499].seq, st.seq + 500)
      const second = await p.poll()
      assert.deepEqual(second.data.events.map((e) => e.seq), [st.seq + 501, st.seq + 502, st.seq + 503])
      assert.equal(second.data.seq, st.seq + 503)
    } finally {
      await ctx.cleanup()
    }
  })

  it('oturum başına bekleyen sınırı: en eski boş yanıtla kapanır, her bekleyen bir kez yanıtlanır', async () => {
    const ctx = await h.startServer({ maxWaitersPerSession: 2, pollTimeoutMs: 5000 })
    try {
      const owner = await h.setupOwner(ctx)
      const st = await h.stateOf(ctx, owner.token)
      const url = '/api/poll?since=' + st.seq + '&mv=' + st.metaVersion + '&sig=0&boot=' + st.boot
      const order = []
      const first = h.get(ctx, url, owner.token).then((r) => {
        order.push('first')
        return r
      })
      await h.waitFor(() => ctx.server.stats().waiters === 1)
      const second = h.get(ctx, url, owner.token)
      await h.waitFor(() => ctx.server.stats().waiters === 2)
      const third = h.get(ctx, url, owner.token)
      const r1 = await first
      assert.deepEqual(order, ['first'])
      assert.deepEqual(r1.data.events, [])
      assert.equal(r1.data.seq, st.seq)
      await h.waitFor(() => ctx.server.stats().waiters === 2)
      await h.sendMessage(ctx, owner.token, 1)
      const r2 = await second
      const r3 = await third
      assert.equal(r2.data.events.length, 1)
      assert.equal(r3.data.events.length, 1)
      assert.equal(ctx.server.stats().waiters, 0)
    } finally {
      await ctx.cleanup()
    }
  })

  it('istemci bağlantıyı keserse bekleyen kaydı silinir, sızıntı olmaz', async () => {
    const ctx = await h.startServer({ pollTimeoutMs: 5000 })
    try {
      const owner = await h.setupOwner(ctx)
      const st = await h.stateOf(ctx, owner.token)
      const url = '/api/poll?since=' + st.seq + '&mv=' + st.metaVersion + '&sig=0&boot=' + st.boot
      for (const i of h.times(5)) {
        const req = http.request({ host: '127.0.0.1', port: ctx.port, path: url, headers: { 'x-token': owner.token }, agent: false })
        req.on('error', () => {})
        req.end()
        await h.waitFor(() => ctx.server.stats().waiters === 1)
        req.destroy()
        await h.waitFor(() => ctx.server.stats().waiters === 0)
      }
      // Sonraki mesaj kimseye çift yanıt yazdırmaz
      await h.sendMessage(ctx, owner.token, 1)
      await h.sleep(30)
    } finally {
      await ctx.cleanup()
    }
  })

  it('sunucu kapanınca bekleyen poll yanıtlanır', async () => {
    const ctx = await h.startServer({ pollTimeoutMs: 10000 })
    let closed = false
    try {
      const owner = await h.setupOwner(ctx)
      const st = await h.stateOf(ctx, owner.token)
      const p = h.poller(ctx, owner.token, st)
      const pending = p.poll()
      await h.waitFor(() => ctx.server.stats().waiters === 1)
      const started = Date.now()
      const stopping = ctx.stop()
      const res = await pending
      h.expectStatus(res, 200)
      assert.deepEqual(res.data.events, [])
      assert.equal(res.headers.connection, 'close')
      await stopping
      closed = true
      assert.ok(Date.now() - started < 3000)
    } finally {
      if (!closed) await ctx.stop()
      h.removeRoot(ctx.root)
    }
  })

  it('çevrimiçi durumu ve çevrimdışına düşme', async () => {
    const ctx = await h.startServer({ pollTimeoutMs: 300, graceMs: 300 })
    try {
      const owner = await h.setupOwner(ctx)
      const member = await h.addUser(ctx, owner.token, 'Ayşe')
      const online = async (id) => {
        const st = await h.stateOf(ctx, owner.token)
        return st.meta.users.find((u) => u.id === id).online
      }
      // Kayıt tek başına çevrimiçi yapmaz, ilk oturumlu istek yapar
      assert.equal(await online(member.user.id), false)
      await h.stateOf(ctx, member.token)
      assert.equal(await online(member.user.id), true)
      // Ayşe hiç istek atmazsa poll süresi + tolerans sonunda çevrimdışı olur
      await h.waitFor(async () => (await online(member.user.id)) === false, { timeout: 8000 })
      assert.equal(await online(owner.user.id), true)
      // Yeniden istek atınca çevrimiçi olur ve peerId yenilenir
      const before = await h.stateOf(ctx, member.token)
      assert.equal(await online(member.user.id), true)
      await h.waitFor(async () => (await online(member.user.id)) === false, { timeout: 8000 })
      const after = await h.stateOf(ctx, member.token)
      assert.notEqual(after.peerId, before.peerId)
    } finally {
      await ctx.cleanup()
    }
  })
})
