'use strict'

// Arkadaşlar ve engellemeler: durum makinesi, otomatik kabul, engelleme etkileri,
// üst sınırlar, hız sınırı, kişiye özel meta, sürümü ve yalnızca ilgili kullanıcının uyanması.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./server-yardimci')

// Sahip ve üç üyeli bir sunucu
async function group (options) {
  const ctx = await h.startServer(options)
  const owner = await h.setupOwner(ctx)
  const ayse = await h.addUser(ctx, owner.token, 'ayse')
  const mehmet = await h.addUser(ctx, owner.token, 'mehmet')
  const ali = await h.addUser(ctx, owner.token, 'ali')
  return { ctx, owner, ayse, mehmet, ali }
}

function act (ctx, who, action, body) {
  return h.post(ctx, '/api/' + action, who.token, body)
}

async function privateOf (ctx, who) {
  return (await h.stateOf(ctx, who.token)).private
}

function lists (p) {
  return { friends: p.friends, incoming: p.incoming, outgoing: p.outgoing, blocked: p.blocked }
}

const EMPTY = { friends: [], incoming: [], outgoing: [], blocked: [] }

describe('arkadaşlık durum makinesi', () => {
  it('istek, kabul, kaldırma, ret ve iptal', async () => {
    const { ctx, owner, ayse, mehmet } = await group()
    try {
      const st = await h.stateOf(ctx, ayse.token)
      assert.deepEqual(st.private, { friends: [], incoming: [], outgoing: [], blocked: [], dms: [], allowMemberDms: true, status: 'online' })
      assert.equal(typeof st.pmv, 'number')

      const sent = await act(ctx, ayse, 'friends/request', { name: 'mehmet' })
      h.expectStatus(sent, 200)
      assert.deepEqual(sent.data, { ok: true, userId: mehmet.user.id, state: 'pending' })
      assert.deepEqual(lists(await privateOf(ctx, ayse)), Object.assign({}, EMPTY, { outgoing: [mehmet.user.id] }))
      assert.deepEqual(lists(await privateOf(ctx, mehmet)), Object.assign({}, EMPTY, { incoming: [ayse.user.id] }))
      assert.deepEqual(lists(await privateOf(ctx, owner)), EMPTY)
      h.expectStatus(await act(ctx, ayse, 'friends/request', { name: 'MEHMET' }), 409, 'already_pending')
      h.expectStatus(await act(ctx, ayse, 'friends/request', { userId: mehmet.user.id }), 409, 'already_pending')
      // Gönderen kendi isteğini kabul edemez, alıcı giden olmayan isteği iptal edemez
      h.expectStatus(await act(ctx, ayse, 'friends/accept', { userId: mehmet.user.id }), 404, 'request_not_found')
      h.expectStatus(await act(ctx, mehmet, 'friends/remove', { userId: ayse.user.id }), 404, 'not_friends')

      const accepted = await act(ctx, mehmet, 'friends/accept', { userId: ayse.user.id })
      h.expectStatus(accepted, 200)
      assert.equal(accepted.data.state, 'friends')
      assert.deepEqual(lists(await privateOf(ctx, ayse)), Object.assign({}, EMPTY, { friends: [mehmet.user.id] }))
      assert.deepEqual(lists(await privateOf(ctx, mehmet)), Object.assign({}, EMPTY, { friends: [ayse.user.id] }))
      h.expectStatus(await act(ctx, mehmet, 'friends/accept', { userId: ayse.user.id }), 404, 'request_not_found')
      h.expectStatus(await act(ctx, ayse, 'friends/request', { name: 'mehmet' }), 409, 'already_friends')
      h.expectStatus(await act(ctx, mehmet, 'friends/request', { name: 'ayse' }), 409, 'already_friends')

      h.expectStatus(await act(ctx, ayse, 'friends/remove', { userId: mehmet.user.id }), 200)
      assert.deepEqual(lists(await privateOf(ctx, ayse)), EMPTY)
      assert.deepEqual(lists(await privateOf(ctx, mehmet)), EMPTY)
      h.expectStatus(await act(ctx, ayse, 'friends/remove', { userId: mehmet.user.id }), 404, 'not_friends')

      // Ret
      h.expectStatus(await act(ctx, mehmet, 'friends/request', { userId: ayse.user.id }), 200)
      h.expectStatus(await act(ctx, ayse, 'friends/decline', { userId: mehmet.user.id }), 200)
      assert.deepEqual(lists(await privateOf(ctx, ayse)), EMPTY)
      assert.deepEqual(lists(await privateOf(ctx, mehmet)), EMPTY)
      h.expectStatus(await act(ctx, ayse, 'friends/decline', { userId: mehmet.user.id }), 404, 'request_not_found')

      // Giden isteği iptal
      h.expectStatus(await act(ctx, ayse, 'friends/request', { name: 'mehmet' }), 200)
      h.expectStatus(await act(ctx, ayse, 'friends/remove', { userId: mehmet.user.id }), 200)
      assert.deepEqual(lists(await privateOf(ctx, mehmet)), EMPTY)
    } finally {
      await ctx.cleanup()
    }
  })

  it('karşı taraf zaten istek göndermişse otomatik kabul', async () => {
    const { ctx, ayse, mehmet } = await group()
    try {
      h.expectStatus(await act(ctx, ayse, 'friends/request', { name: 'mehmet' }), 200)
      const back = await act(ctx, mehmet, 'friends/request', { name: 'ayse' })
      h.expectStatus(back, 200)
      assert.deepEqual(back.data, { ok: true, userId: ayse.user.id, state: 'friends' })
      assert.deepEqual(lists(await privateOf(ctx, ayse)), Object.assign({}, EMPTY, { friends: [mehmet.user.id] }))
      assert.deepEqual(lists(await privateOf(ctx, mehmet)), Object.assign({}, EMPTY, { friends: [ayse.user.id] }))
    } finally {
      await ctx.cleanup()
    }
  })

  it('geçersiz hedefler: kendisi, bilinmeyen, geçersiz ad, sunucudan engelli, silinmiş', async () => {
    const { ctx, owner, ayse, mehmet, ali } = await group()
    try {
      h.expectStatus(await act(ctx, ayse, 'friends/request', { name: 'ayse' }), 400, 'self')
      h.expectStatus(await act(ctx, ayse, 'friends/request', { userId: ayse.user.id }), 400, 'self')
      h.expectStatus(await act(ctx, ayse, 'friends/request', { name: 'hayalet' }), 404, 'user_not_found')
      h.expectStatus(await act(ctx, ayse, 'friends/request', { name: 'Ayşe' }), 400, 'invalid_name')
      h.expectStatus(await act(ctx, ayse, 'friends/request', {}), 400, 'invalid_name')
      h.expectStatus(await act(ctx, ayse, 'friends/request', { userId: 999 }), 404, 'user_not_found')
      h.expectStatus(await act(ctx, ayse, 'friends/request', { userId: 'abc' }), 404, 'user_not_found')
      h.expectStatus(await act(ctx, ayse, 'friends/accept', { userId: 999 }), 404, 'user_not_found')

      h.expectStatus(await act(ctx, ayse, 'friends/request', { name: 'mehmet' }), 200)
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: mehmet.user.id, banned: true }), 200)
      h.expectStatus(await act(ctx, ali, 'friends/request', { name: 'mehmet' }), 404, 'user_not_found')
      // Sunucudan engellenmiş kişiye giden istek yine iptal edilebilir
      h.expectStatus(await act(ctx, ayse, 'friends/remove', { userId: mehmet.user.id }), 200)

      h.expectStatus(await act(ctx, ali, 'friends/request', { name: 'ayse' }), 200)
      h.expectStatus(await h.post(ctx, '/api/me/delete', ali.token, { authKey: h.authKeyFor(h.PASSWORD) }), 200)
      // Silinen hesabın istekleri de silinir
      assert.deepEqual(lists(await privateOf(ctx, ayse)), EMPTY)
      h.expectStatus(await act(ctx, ayse, 'friends/request', { userId: ali.user.id }), 404, 'user_not_found')
    } finally {
      await ctx.cleanup()
    }
  })

  it('üst sınırlar ve istek hız sınırı', async () => {
    const ctx = await h.startServer({ maxPendingRequests: 2, maxFriends: 1, friendRequestLimit: 3, friendRequestWindowMs: 60000 })
    try {
      const owner = await h.setupOwner(ctx)
      const users = []
      for (const name of ['u1', 'u2', 'u3', 'u4']) users.push(await h.addUser(ctx, owner.token, name))
      const [u1, u2, u3, u4] = users
      h.expectStatus(await act(ctx, u1, 'friends/request', { name: 'u2' }), 200)
      h.expectStatus(await act(ctx, u1, 'friends/request', { name: 'u3' }), 200)
      h.expectStatus(await act(ctx, u1, 'friends/request', { name: 'u4' }), 409, 'too_many_pending')
      h.expectStatus(await act(ctx, u2, 'friends/accept', { userId: u1.user.id }), 200)
      // u1 arkadaş sınırında: kabul ve yeni istek reddedilir
      h.expectStatus(await act(ctx, u3, 'friends/accept', { userId: u1.user.id }), 409, 'too_many_friends')
      h.expectStatus(await act(ctx, u1, 'friends/request', { name: 'u4' }), 429, 'rate_limited')
      h.expectStatus(await act(ctx, u4, 'friends/request', { name: 'u1' }), 200)
      h.expectStatus(await act(ctx, u1, 'friends/accept', { userId: u4.user.id }), 409, 'too_many_friends')
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('engellemeler', () => {
  it('engel arkadaşlığı ve istekleri siler, iki yönde de istek gönderilemez, bilgi sızmaz', async () => {
    const { ctx, ayse, mehmet, ali } = await group()
    try {
      h.expectStatus(await act(ctx, ayse, 'friends/request', { name: 'mehmet' }), 200)
      h.expectStatus(await act(ctx, mehmet, 'friends/accept', { userId: ayse.user.id }), 200)
      h.expectStatus(await act(ctx, ali, 'friends/request', { name: 'ayse' }), 200)

      const blocked = await act(ctx, ayse, 'blocks/add', { userId: mehmet.user.id })
      h.expectStatus(blocked, 200)
      assert.equal(blocked.data.state, 'blocked')
      assert.deepEqual(lists(await privateOf(ctx, ayse)), Object.assign({}, EMPTY, { incoming: [ali.user.id], blocked: [mehmet.user.id] }))
      // Engellenen kişi yalnızca arkadaşlığın bittiğini görür, engel listesinde kimse yoktur
      assert.deepEqual(lists(await privateOf(ctx, mehmet)), EMPTY)

      const fromBlocked = await act(ctx, mehmet, 'friends/request', { name: 'ayse' })
      const toBlocked = await act(ctx, ayse, 'friends/request', { name: 'mehmet' })
      const missing = await act(ctx, mehmet, 'friends/request', { name: 'hayalet' })
      h.expectStatus(fromBlocked, 403, 'request_failed')
      h.expectStatus(toBlocked, 403, 'request_failed')
      h.expectStatus(missing, 404, 'user_not_found')
      assert.equal(fromBlocked.data.error, toBlocked.data.error)
      assert.ok(!/engel/i.test(fromBlocked.data.error))

      // Bekleyen istek varken engelleme isteği de siler
      h.expectStatus(await act(ctx, ayse, 'blocks/add', { userId: ali.user.id }), 200)
      assert.deepEqual(lists(await privateOf(ctx, ali)), EMPTY)
      assert.deepEqual((await privateOf(ctx, ayse)).blocked, [mehmet.user.id, ali.user.id].sort((x, y) => x - y))

      // Tekrar engellemek ve olmayan engeli kaldırmak hata vermez
      h.expectStatus(await act(ctx, ayse, 'blocks/add', { userId: mehmet.user.id }), 200)
      h.expectStatus(await act(ctx, mehmet, 'blocks/remove', { userId: ayse.user.id }), 200)
      h.expectStatus(await act(ctx, ayse, 'blocks/add', { userId: ayse.user.id }), 400, 'self')
      h.expectStatus(await act(ctx, ayse, 'blocks/add', { userId: 999 }), 404, 'user_not_found')
      h.expectStatus(await act(ctx, ayse, 'blocks/remove', { userId: 'x' }), 400, 'bad_request')

      h.expectStatus(await act(ctx, ayse, 'blocks/remove', { userId: mehmet.user.id }), 200)
      assert.deepEqual((await privateOf(ctx, ayse)).blocked, [ali.user.id])
      h.expectStatus(await act(ctx, mehmet, 'friends/request', { name: 'ayse' }), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('ilişki yokken engellenen kişinin kişiye özel meta sürümü değişmez', async () => {
    const { ctx, ayse, mehmet } = await group()
    try {
      const before = await h.stateOf(ctx, mehmet.token)
      const ayseBefore = await h.stateOf(ctx, ayse.token)
      h.expectStatus(await act(ctx, ayse, 'blocks/add', { userId: mehmet.user.id }), 200)
      const after = await h.stateOf(ctx, mehmet.token)
      assert.equal(after.pmv, before.pmv)
      assert.deepEqual(after.private, before.private)
      assert.ok((await h.stateOf(ctx, ayse.token)).pmv > ayseBefore.pmv)
    } finally {
      await ctx.cleanup()
    }
  })

  it('arkadaşlık ve engel kayıtları yeniden başlatmadan sonra kalır', async () => {
    const g = await group()
    let ctx = g.ctx
    try {
      h.expectStatus(await act(ctx, g.ayse, 'friends/request', { name: 'mehmet' }), 200)
      h.expectStatus(await act(ctx, g.mehmet, 'friends/accept', { userId: g.ayse.user.id }), 200)
      h.expectStatus(await act(ctx, g.ali, 'friends/request', { name: 'mehmet' }), 200)
      h.expectStatus(await act(ctx, g.ayse, 'blocks/add', { userId: g.owner.user.id }), 200)
      h.expectStatus(await act(ctx, g.ayse, 'me/settings', { allowMemberDms: false }), 200)
      const before = await privateOf(ctx, g.mehmet)
      ctx = await ctx.restart()
      assert.deepEqual(await privateOf(ctx, g.mehmet), before)
      const ayse = await privateOf(ctx, g.ayse)
      assert.deepEqual(ayse.blocked, [g.owner.user.id])
      assert.equal(ayse.allowMemberDms, false)
      h.expectStatus(await act(ctx, g.owner, 'friends/request', { name: 'ayse' }), 403, 'request_failed')
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('veri dosyasındaki kayıtlar', () => {
  it('geçersiz, yinelenen ve engelle çelişen arkadaşlık kayıtları açılışta temizlenir', async () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const g = await group()
    let ctx = g.ctx
    try {
      await ctx.stop()
      const file = path.join(ctx.dataDir, 'state.json')
      const disk = JSON.parse(fs.readFileSync(file, 'utf8'))
      const [o, a, m, l] = [g.owner.user.id, g.ayse.user.id, g.mehmet.user.id, g.ali.user.id]
      disk.friendships = [
        { a, b: m, state: 'friends', from: a, createdAt: 1 },
        { a: m, b: a, state: 'pending', from: m, createdAt: 2 },
        { a, b: a, state: 'friends', from: a, createdAt: 3 },
        { a, b: 999, state: 'friends', from: a, createdAt: 4 },
        { a: o, b: l, state: 'kardes', from: o, createdAt: 5 },
        { a: o, b: l, state: 'pending', from: m, createdAt: 6 },
        { a: l, b: o, state: 'pending', from: l },
        { a: a, b: l, state: 'friends', from: a, createdAt: 7 },
        'bozuk',
        null
      ]
      disk.blocks = [{ by: l, user: a, createdAt: 8 }, { by: l, user: a, createdAt: 9 }, { by: a, user: a }, { by: 999, user: a }, 42]
      fs.writeFileSync(file, JSON.stringify(disk))
      ctx = await ctx.restart()
      assert.ok(ctx.log.lines.warn.some((line) => /arkadaşlık veya engel/.test(line)))
      const ayse = await privateOf(ctx, g.ayse)
      assert.deepEqual(lists(ayse), Object.assign({}, EMPTY, { friends: [m] }))
      assert.deepEqual(lists(await privateOf(ctx, g.ali)), Object.assign({}, EMPTY, { outgoing: [o], blocked: [a] }))
      assert.deepEqual(lists(await privateOf(ctx, g.owner)), Object.assign({}, EMPTY, { incoming: [l] }))
      await ctx.server.flush()
      const cleaned = JSON.parse(fs.readFileSync(file, 'utf8'))
      assert.equal(cleaned.friendships.length, 2)
      assert.deepEqual(cleaned.blocks.map((r) => [r.by, r.user]), [[l, a]])
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('kişiye özel meta', () => {
  it('ayar: sunucu üyelerinden özel mesaj kabul etme', async () => {
    const { ctx, ayse } = await group()
    try {
      for (const bad of [{}, { allowMemberDms: 'false' }, { allowMemberDms: 0 }, { allowMemberDms: null }]) {
        h.expectStatus(await act(ctx, ayse, 'me/settings', bad), 400, 'bad_request')
      }
      h.expectStatus(await act(ctx, ayse, 'me/settings', { allowMemberDms: false }), 200)
      assert.equal((await privateOf(ctx, ayse)).allowMemberDms, false)
      h.expectStatus(await act(ctx, ayse, 'me/settings', { allowMemberDms: true }), 200)
      assert.equal((await privateOf(ctx, ayse)).allowMemberDms, true)
    } finally {
      await ctx.cleanup()
    }
  })

  it('poll: sürüm farklıysa private gelir, değişiklikte yalnızca ilgili kullanıcıların bekleyenleri uyanır', async () => {
    const { ctx, ayse, mehmet, ali } = await group({ pollTimeoutMs: 1500 })
    try {
      // Üçü de çevrimiçi olduktan sonra alınan durumlar aynı meta sürümünü taşır
      for (const who of [ayse, mehmet, ali]) await h.stateOf(ctx, who.token)
      const pa = h.poller(ctx, ayse.token, await h.stateOf(ctx, ayse.token))
      const pm = h.poller(ctx, mehmet.token, await h.stateOf(ctx, mehmet.token))
      const pl = h.poller(ctx, ali.token, await h.stateOf(ctx, ali.token))
      assert.equal(pa.st.mv, pl.st.mv)
      // pmv verilmezse private hemen gelir
      const noPmv = await h.get(ctx, '/api/poll?since=' + pl.st.seq + '&mv=' + pl.st.mv + '&sig=0&boot=' + pl.st.boot, ali.token)
      assert.deepEqual(noPmv.data.private, (await h.stateOf(ctx, ali.token)).private)
      assert.equal(noPmv.data.pmv, pl.st.pmv)
      assert.equal('meta' in noPmv.data, false)

      await h.waitFor(() => ctx.server.stats().waiters === 0)
      const waitA = pa.poll()
      const waitM = pm.poll()
      const waitL = pl.poll()
      await h.waitFor(() => ctx.server.stats().waiters === 3)
      const started = Date.now()
      h.expectStatus(await act(ctx, ayse, 'friends/request', { name: 'mehmet' }), 200)
      const [ra, rm] = await Promise.all([waitA, waitM])
      assert.ok(Date.now() - started < 1000)
      assert.deepEqual(ra.data.private.outgoing, [mehmet.user.id])
      assert.deepEqual(rm.data.private.incoming, [ayse.user.id])
      assert.deepEqual(ra.data.events, [])
      assert.deepEqual(rm.data.events, [])
      // Üçüncü kullanıcının bekleyeni uyanmaz, zaman aşımında private içermeyen boş yanıt alır
      assert.equal(ctx.server.stats().waiters, 1)
      const rl = await waitL
      assert.ok(Date.now() - started >= 1000)
      assert.equal('private' in rl.data, false)
      assert.deepEqual(rl.data.events, [])
      assert.equal(rl.data.pmv, pl.st.pmv)
    } finally {
      await ctx.cleanup()
    }
  })

  it('resync yanıtı private ve pmv içerir', async () => {
    const { ctx, ayse } = await group()
    try {
      const st = await h.stateOf(ctx, ayse.token)
      const res = await h.get(ctx, '/api/poll?since=0&mv=0&pmv=0&sig=0&boot=0000000000000000', ayse.token)
      assert.equal(res.data.resync, true)
      assert.equal(res.data.pmv, st.pmv)
      assert.deepEqual(res.data.private, st.private)
    } finally {
      await ctx.cleanup()
    }
  })
})
