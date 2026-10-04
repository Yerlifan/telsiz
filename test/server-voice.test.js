'use strict'

// Ses: kadrolar, tek oturum kuralı, kanal doluluğu, sinyal yönlendirme, onay ve yetki, çevrimdışına düşme.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./server-yardimci')

async function threeUsers (options) {
  const ctx = await h.startServer(options)
  const owner = await h.setupOwner(ctx)
  const ayse = await h.addUser(ctx, owner.token, 'ayse')
  const mehmet = await h.addUser(ctx, owner.token, 'mehmet')
  return { ctx, owner, ayse, mehmet }
}

function join (ctx, token, channelId) {
  return h.post(ctx, '/api/voice/join', token, { channelId })
}

describe('ses kanalları', () => {
  it('katılma, kadro, durum ve ayrılma', async () => {
    const { ctx, owner, ayse } = await threeUsers()
    try {
      const ownerState = await h.stateOf(ctx, owner.token)
      const first = await join(ctx, owner.token, 3)
      h.expectStatus(first, 200)
      assert.equal(first.data.ok, true)
      assert.equal(first.data.peerId, ownerState.peerId)
      assert.deepEqual(first.data.members, [])
      assert.deepEqual(first.data.iceServers, [{ urls: 'stun:stun.example.org:3478' }])

      const ayseState = await h.stateOf(ctx, ayse.token)
      const second = await join(ctx, ayse.token, 3)
      h.expectStatus(second, 200)
      assert.deepEqual(second.data.members, [{ userId: owner.user.id, peerId: ownerState.peerId, muted: false, deafened: false, camera: false }])

      h.expectStatus(await h.post(ctx, '/api/voice/state', ayse.token, { muted: true, deafened: false }), 200)
      let meta = (await h.stateOf(ctx, owner.token)).meta
      assert.deepEqual(meta.voice['3'], [
        { userId: owner.user.id, peerId: ownerState.peerId, muted: false, deafened: false, camera: false },
        { userId: ayse.user.id, peerId: ayseState.peerId, muted: true, deafened: false, camera: false }
      ])
      assert.deepEqual(meta.voice['4'], [])

      for (const bad of [{}, { muted: 'evet', deafened: false }, { muted: true }, { muted: 1, deafened: 0 }]) {
        h.expectStatus(await h.post(ctx, '/api/voice/state', ayse.token, bad), 400, 'bad_request')
      }
      // Yazı kanalına ve olmayan kanala katılınamaz
      h.expectStatus(await join(ctx, ayse.token, 1), 404, 'channel_not_found')
      h.expectStatus(await join(ctx, ayse.token, 99), 404, 'channel_not_found')

      // Başka ses kanalına geçmek öncekinden çıkarır
      h.expectStatus(await join(ctx, ayse.token, 4), 200)
      meta = (await h.stateOf(ctx, owner.token)).meta
      assert.deepEqual(meta.voice['3'].map((m) => m.userId), [owner.user.id])
      assert.deepEqual(meta.voice['4'], [{ userId: ayse.user.id, peerId: ayseState.peerId, muted: false, deafened: false, camera: false }])

      h.expectStatus(await h.post(ctx, '/api/voice/leave', ayse.token), 200)
      h.expectStatus(await h.post(ctx, '/api/voice/leave', ayse.token), 200)
      meta = (await h.stateOf(ctx, owner.token)).meta
      assert.deepEqual(meta.voice['4'], [])
    } finally {
      await ctx.cleanup()
    }
  })

  it('kanal doluysa 409 voice_full', async () => {
    const { ctx, owner, ayse, mehmet } = await threeUsers({ maxVoicePerChannel: 2 })
    try {
      h.expectStatus(await join(ctx, owner.token, 3), 200)
      h.expectStatus(await join(ctx, ayse.token, 3), 200)
      h.expectStatus(await join(ctx, mehmet.token, 3), 409, 'voice_full')
      // Zaten içerideki kişinin yeniden katılması doluluğa takılmaz
      h.expectStatus(await join(ctx, ayse.token, 3), 200)
      h.expectStatus(await h.post(ctx, '/api/voice/leave', ayse.token), 200)
      h.expectStatus(await join(ctx, mehmet.token, 3), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('tek oturum kuralı: aynı kullanıcı başka oturumdan katılınca önceki oturum çıkar', async () => {
    const { ctx, owner, ayse } = await threeUsers()
    try {
      const phone = await h.login(ctx, 'ayse')
      const pcState = await h.stateOf(ctx, ayse.token)
      const phoneState = await h.stateOf(ctx, phone.data.token)
      assert.notEqual(pcState.peerId, phoneState.peerId)
      h.expectStatus(await join(ctx, ayse.token, 3), 200)
      h.expectStatus(await join(ctx, phone.data.token, 4), 200)
      const meta = (await h.stateOf(ctx, owner.token)).meta
      assert.deepEqual(meta.voice['3'], [])
      assert.deepEqual(meta.voice['4'].map((m) => m.peerId), [phoneState.peerId])
      // Önceki oturum artık seste değil, sinyal gönderemez
      h.expectStatus(await h.post(ctx, '/api/voice/signal', ayse.token, { to: phoneState.peerId, data: h.envelope() }), 403, 'not_in_voice')
    } finally {
      await ctx.cleanup()
    }
  })

  it('ses kanalı silinince üyeleri sesten çıkar', async () => {
    const { ctx, owner, ayse } = await threeUsers()
    try {
      h.expectStatus(await join(ctx, ayse.token, 4), 200)
      h.expectStatus(await h.post(ctx, '/api/channels/delete', owner.token, { id: 4 }), 200)
      const meta = (await h.stateOf(ctx, owner.token)).meta
      assert.deepEqual(Object.keys(meta.voice), ['3'])
      assert.deepEqual(meta.voice['3'], [])
      h.expectStatus(await h.post(ctx, '/api/voice/signal', ayse.token, { to: '0123456789abcdef', data: h.envelope() }), 403, 'not_in_voice')
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('ses sinyalleri', () => {
  it('yönlendirme, onay, yetki ve aynı kanal kuralı', async () => {
    const { ctx, owner, ayse, mehmet } = await threeUsers()
    try {
      const ownerState = await h.stateOf(ctx, owner.token)
      const ayseState = await h.stateOf(ctx, ayse.token)
      const mehmetState = await h.stateOf(ctx, mehmet.token)
      const signal = (token, to, data) => h.post(ctx, '/api/voice/signal', token, { to, data: data || h.envelope() })

      // Seste olmayan gönderemez
      h.expectStatus(await signal(owner.token, ayseState.peerId), 403, 'not_in_voice')
      h.expectStatus(await join(ctx, owner.token, 3), 200)
      // Alıcı seste değil
      h.expectStatus(await signal(owner.token, ayseState.peerId), 404, 'peer_not_found')
      h.expectStatus(await join(ctx, ayse.token, 3), 200)
      h.expectStatus(await join(ctx, mehmet.token, 4), 200)
      // Başka ses kanalındaki kişiye gönderilemez
      h.expectStatus(await signal(owner.token, mehmetState.peerId), 404, 'peer_not_found')
      h.expectStatus(await signal(owner.token, ownerState.peerId), 404, 'peer_not_found')
      h.expectStatus(await signal(owner.token, 'ffffffffffffffff'), 404, 'peer_not_found')
      // Biçim denetimi
      for (const body of [
        { to: ayseState.peerId, data: 'düz metin' },
        { to: ayseState.peerId, data: 42 },
        { to: ayseState.peerId },
        { to: 'AYSE', data: h.envelope() },
        { to: 12, data: h.envelope() },
        // maxSignalChars (32000) aşılıyor
        { to: ayseState.peerId, data: h.envelope(24000) }
      ]) {
        h.expectStatus(await h.post(ctx, '/api/voice/signal', owner.token, body), 400, 'bad_signal')
      }

      // Bekleyen poll yalnızca alıcıda uyanır
      const pAyse = h.poller(ctx, ayse.token, ayseState)
      const pMehmet = h.poller(ctx, mehmet.token, mehmetState)
      // Meta değişiklikleri önce tüketilir
      await pAyse.poll()
      await pMehmet.poll()
      const waiting = h.nextRequest(ctx.server, '/api/poll')
      const ayseWait = pAyse.poll()
      await waiting
      const data1 = h.envelope()
      h.expectStatus(await signal(owner.token, ayseState.peerId, data1), 200)
      const got = await ayseWait
      assert.deepEqual(got.data.signals, [{ seq: 1, from: ownerState.peerId, data: data1 }])
      assert.deepEqual(got.data.events, [])

      // Onaylanmayan sinyal yeniden gelir, onaylanan bir daha gelmez
      const data2 = h.envelope()
      h.expectStatus(await signal(owner.token, ayseState.peerId, data2), 200)
      const unacked = await h.get(ctx, '/api/poll?since=' + pAyse.st.seq + '&mv=' + pAyse.st.mv + '&sig=0&boot=' + pAyse.st.boot, ayse.token)
      assert.deepEqual(unacked.data.signals.map((s) => s.seq), [1, 2])
      const acked = await h.get(ctx, '/api/poll?since=' + pAyse.st.seq + '&mv=' + pAyse.st.mv + '&sig=1&boot=' + pAyse.st.boot, ayse.token)
      assert.deepEqual(acked.data.signals.map((s) => s.seq), [2])
      // sig=0 artık 1 numarayı geri getirmez (onay ile silindi)
      const after = await h.get(ctx, '/api/poll?since=' + pAyse.st.seq + '&mv=' + pAyse.st.mv + '&sig=0&boot=' + pAyse.st.boot, ayse.token)
      assert.deepEqual(after.data.signals.map((s) => s.seq), [2])
      const state2 = await h.stateOf(ctx, ayse.token)
      assert.equal(state2.sigSeq, 2)

      // Mehmet hiçbir sinyal almadı
      const mehmetPoll = await h.get(ctx, '/api/poll?since=' + pMehmet.st.seq + '&mv=0&sig=0&boot=' + pMehmet.st.boot, mehmet.token)
      assert.ok(mehmetPoll.data.meta)
      assert.deepEqual(mehmetPoll.data.signals, [])

      // Sesten çıkınca kuyruk boşalır
      h.expectStatus(await h.post(ctx, '/api/voice/leave', ayse.token), 200)
      const cleared = await h.get(ctx, '/api/poll?since=' + pAyse.st.seq + '&mv=0&sig=0&boot=' + pAyse.st.boot, ayse.token)
      assert.deepEqual(cleared.data.signals, [])
    } finally {
      await ctx.cleanup()
    }
  })

  it('kuyruk en fazla 200 sinyal tutar, poll en fazla 100 verir', async () => {
    const { ctx, owner, ayse } = await threeUsers()
    try {
      await h.stateOf(ctx, owner.token)
      const ayseState = await h.stateOf(ctx, ayse.token)
      h.expectStatus(await join(ctx, owner.token, 3), 200)
      h.expectStatus(await join(ctx, ayse.token, 3), 200)
      const data = h.envelope()
      for (const i of h.times(205)) {
        h.expectStatus(await h.post(ctx, '/api/voice/signal', owner.token, { to: ayseState.peerId, data }), 200)
      }
      const base = '/api/poll?since=0&mv=0&boot=' + ayseState.boot + '&sig='
      const r1 = await h.get(ctx, base + '0', ayse.token)
      assert.equal(r1.data.signals.length, 100)
      assert.equal(r1.data.signals[0].seq, 6)
      const r2 = await h.get(ctx, base + '105', ayse.token)
      assert.deepEqual([r2.data.signals[0].seq, r2.data.signals.length], [106, 100])
    } finally {
      await ctx.cleanup()
    }
  })

  it('sinyal hız sınırı', async () => {
    const { ctx, owner, ayse } = await threeUsers({ signalLimit: 3, signalWindowMs: 60000 })
    try {
      const ayseState = await h.stateOf(ctx, ayse.token)
      h.expectStatus(await join(ctx, owner.token, 3), 200)
      h.expectStatus(await join(ctx, ayse.token, 3), 200)
      for (const i of h.times(3)) {
        h.expectStatus(await h.post(ctx, '/api/voice/signal', owner.token, { to: ayseState.peerId, data: h.envelope() }), 200)
      }
      h.expectStatus(await h.post(ctx, '/api/voice/signal', owner.token, { to: ayseState.peerId, data: h.envelope() }), 429, 'rate_limited')
    } finally {
      await ctx.cleanup()
    }
  })

  it('çevrimdışına düşen oturum sesten sessizce çıkarılır', async () => {
    const { ctx, owner, ayse } = await threeUsers({ pollTimeoutMs: 100, graceMs: 100 })
    try {
      h.expectStatus(await join(ctx, ayse.token, 3), 200)
      h.expectStatus(await join(ctx, owner.token, 3), 200)
      // Sahip istek atmaya devam eder, Ayşe susar
      await h.waitFor(async () => {
        const meta = (await h.stateOf(ctx, owner.token)).meta
        return meta.voice['3'].length === 1 && meta.voice['3'][0].userId === owner.user.id
      }, { timeout: 8000 })
      const meta = (await h.stateOf(ctx, owner.token)).meta
      assert.equal(meta.users.find((u) => u.id === ayse.user.id).online, false)
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('ses sinyal zarfı sınırı', () => {
  // Ek L1.10: ekran paylaşımının görüntülü SDP'si için varsayılan sınır 32000 karakterdir
  it('varsayılan maxSignalChars 32000: tam sınırdaki zarf geçer, bir fazlası reddedilir', async () => {
    const { ctx, owner, ayse } = await threeUsers()
    try {
      const ayseState = await h.stateOf(ctx, ayse.token)
      h.expectStatus(await join(ctx, owner.token, 3), 200)
      h.expectStatus(await join(ctx, ayse.token, 3), 200)
      const make = (n) => {
        const head = '1.0123456789abcdef.' + 'A'.repeat(32) + '.'
        return head + 'B'.repeat(n - head.length)
      }
      assert.equal(make(32000).length, 32000)
      h.expectStatus(await h.post(ctx, '/api/voice/signal', owner.token, { to: ayseState.peerId, data: make(32000) }), 200)
      h.expectStatus(await h.post(ctx, '/api/voice/signal', owner.token, { to: ayseState.peerId, data: make(32001) }), 400, 'bad_signal')
    } finally {
      await ctx.cleanup()
    }
  })
})
