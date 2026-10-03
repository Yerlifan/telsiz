'use strict'

// Rol yetkileri matrisi (SPEC-V2 3.5 tablosunun her satırı), kanal işlemleri ve ayarlar.

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./server-yardimci')

const KID = '0123456789abcdef'

// Sahip, iki yönetici ve iki üyeli bir sunucu kurar.
async function community (options) {
  const ctx = await h.startServer(options)
  const owner = await h.setupOwner(ctx)
  const admin = await h.addUser(ctx, owner.token, 'Yönetici')
  const admin2 = await h.addUser(ctx, owner.token, 'Yönetici İki')
  const member = await h.addUser(ctx, owner.token, 'Üye')
  const member2 = await h.addUser(ctx, owner.token, 'Üye İki')
  await h.makeAdmin(ctx, owner.token, admin.user.id)
  await h.makeAdmin(ctx, owner.token, admin2.user.id)
  return { ctx, owner, admin, admin2, member, member2 }
}

function channelByName (meta, name) {
  return meta.channels.find((c) => c.name === name)
}

describe('rol yetkileri matrisi', () => {
  let c
  before(async () => {
    c = await community()
  })
  after(async () => {
    await c.ctx.cleanup()
  })

  it('kanal oluştur, yeniden adlandır, sırala, sil: sahip ve yönetici evet, üye hayır', async () => {
    const ctx = c.ctx
    for (const actor of [c.owner, c.admin]) {
      const created = await h.post(ctx, '/api/channels/create', actor.token, { name: 'deneme-' + actor.user.id, type: 'text' })
      h.expectStatus(created, 200)
      const id = created.data.channel.id
      h.expectStatus(await h.post(ctx, '/api/channels/update', actor.token, { id, name: 'yeni-' + actor.user.id }), 200)
      h.expectStatus(await h.post(ctx, '/api/channels/update', actor.token, { id, position: 0 }), 200)
      h.expectStatus(await h.post(ctx, '/api/channels/delete', actor.token, { id }), 200)
    }
    const meta = (await h.stateOf(ctx, c.member.token)).meta
    const genel = channelByName(meta, 'genel')
    h.expectStatus(await h.post(ctx, '/api/channels/create', c.member.token, { name: 'üye-kanalı', type: 'text' }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/channels/update', c.member.token, { id: genel.id, name: 'ele geçirildi' }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/channels/update', c.member.token, { id: genel.id, position: 1 }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/channels/delete', c.member.token, { id: genel.id }), 403, 'forbidden')
  })

  it('başkasının mesajını silme: sahip ve yönetici evet, üye hayır', async () => {
    const ctx = c.ctx
    const m1 = await h.sendMessage(ctx, c.member.token, 1)
    const m2 = await h.sendMessage(ctx, c.member.token, 1)
    const m3 = await h.sendMessage(ctx, c.owner.token, 1)
    h.expectStatus(await h.post(ctx, '/api/messages/delete', c.member2.token, { id: m1.id }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/messages/delete', c.member.token, { id: m3.id }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/messages/delete', c.owner.token, { id: m1.id }), 200)
    h.expectStatus(await h.post(ctx, '/api/messages/delete', c.admin.token, { id: m2.id }), 200)
    h.expectStatus(await h.post(ctx, '/api/messages/delete', c.admin.token, { id: m3.id }), 200)
  })

  it('kendi mesajını düzenleme ve silme: herkes evet, başkasınınkini düzenleme kimse', async () => {
    const ctx = c.ctx
    for (const actor of [c.owner, c.admin, c.member]) {
      const m = await h.sendMessage(ctx, actor.token, 1)
      const edited = await h.post(ctx, '/api/messages/edit', actor.token, { id: m.id, body: h.envelope() })
      h.expectStatus(edited, 200)
      assert.equal(typeof edited.data.message.editedAt, 'number')
      h.expectStatus(await h.post(ctx, '/api/messages/delete', actor.token, { id: m.id }), 200)
    }
    const theirs = await h.sendMessage(ctx, c.member.token, 1)
    for (const actor of [c.owner, c.admin, c.member2]) {
      h.expectStatus(await h.post(ctx, '/api/messages/edit', actor.token, { id: theirs.id, body: h.envelope() }), 403, 'forbidden')
    }
  })

  it('davet kodunu görme ve yenileme: sahip ve yönetici evet, üye hayır', async () => {
    const ctx = c.ctx
    for (const actor of [c.owner, c.admin]) {
      const st = await h.stateOf(ctx, actor.token)
      assert.equal(typeof st.inviteCode, 'string')
      const rotated = await h.post(ctx, '/api/invite/rotate', actor.token)
      h.expectStatus(rotated, 200)
      assert.equal(typeof rotated.data.inviteCode, 'string')
    }
    const st = await h.stateOf(ctx, c.member.token)
    assert.equal('inviteCode' in st, false)
    h.expectStatus(await h.post(ctx, '/api/invite/rotate', c.member.token), 403, 'forbidden')
  })

  it('etkin anahtar kimliği: sahip ve yönetici evet, üye hayır', async () => {
    const ctx = c.ctx
    h.expectStatus(await h.post(ctx, '/api/settings', c.owner.token, { activeKid: KID }), 200)
    assert.equal((await h.stateOf(ctx, c.member.token)).meta.activeKid, KID)
    h.expectStatus(await h.post(ctx, '/api/settings', c.admin.token, { activeKid: 'fedcba9876543210' }), 200)
    assert.equal((await h.stateOf(ctx, c.member.token)).meta.activeKid, 'fedcba9876543210')
    h.expectStatus(await h.post(ctx, '/api/settings', c.admin.token, { activeKid: null }), 200)
    h.expectStatus(await h.post(ctx, '/api/settings', c.member.token, { activeKid: KID }), 403, 'forbidden')
    for (const bad of ['ABCDEF0123456789', '0123', 123, true, KID + '0']) {
      h.expectStatus(await h.post(ctx, '/api/settings', c.owner.token, { activeKid: bad }), 400, 'bad_kid')
    }
  })

  it('sunucu adını değiştirme: yalnızca sahip', async () => {
    const ctx = c.ctx
    h.expectStatus(await h.post(ctx, '/api/settings', c.owner.token, { serverName: '  Kankalar  ' }), 200)
    assert.equal((await h.get(ctx, '/api/info')).data.serverName, 'Kankalar')
    assert.equal((await h.stateOf(ctx, c.member.token)).meta.serverName, 'Kankalar')
    h.expectStatus(await h.post(ctx, '/api/settings', c.admin.token, { serverName: 'Yöneticinin' }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/settings', c.admin.token, { serverName: 'Yöneticinin', activeKid: KID }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/settings', c.member.token, { serverName: 'Üyenin' }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/settings', c.owner.token, { serverName: 'x'.repeat(41) }), 400, 'invalid_server_name')
    h.expectStatus(await h.post(ctx, '/api/settings', c.owner.token, { serverName: '   ' }), 400, 'invalid_server_name')
    h.expectStatus(await h.post(ctx, '/api/settings', c.owner.token, {}), 400, 'bad_request')
    assert.equal((await h.get(ctx, '/api/info')).data.serverName, 'Kankalar')
  })

  it('yönetici yapma ve üyeliğe indirme: yalnızca sahip, sahibin rolü değişmez', async () => {
    const ctx = c.ctx
    h.expectStatus(await h.post(ctx, '/api/users/role', c.admin.token, { userId: c.member.user.id, role: 'admin' }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/users/role', c.member.token, { userId: c.member.user.id, role: 'admin' }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/users/role', c.owner.token, { userId: c.owner.user.id, role: 'member' }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/users/role', c.owner.token, { userId: c.member.user.id, role: 'owner' }), 400, 'bad_request')
    h.expectStatus(await h.post(ctx, '/api/users/role', c.owner.token, { userId: 999, role: 'admin' }), 404, 'user_not_found')

    h.expectStatus(await h.post(ctx, '/api/users/role', c.owner.token, { userId: c.member.user.id, role: 'admin' }), 200)
    let meta = (await h.stateOf(ctx, c.member.token)).meta
    assert.equal(meta.users.find((u) => u.id === c.member.user.id).role, 'admin')
    assert.equal((await h.stateOf(ctx, c.member.token)).me.role, 'admin')
    h.expectStatus(await h.post(ctx, '/api/users/role', c.owner.token, { userId: c.member.user.id, role: 'member' }), 200)
    meta = (await h.stateOf(ctx, c.member.token)).meta
    assert.equal(meta.users.find((u) => u.id === c.member.user.id).role, 'member')
  })

  it('engelleme: sahip herkesi (kendisi hariç), yönetici yalnızca üyeleri, üye hiç kimseyi', async () => {
    const ctx = c.ctx
    const ban = (actor, target, banned) => h.post(ctx, '/api/users/ban', actor.token, { userId: target.user.id, banned })
    h.expectStatus(await ban(c.member, c.member2, true), 403, 'forbidden')
    h.expectStatus(await ban(c.admin, c.admin2, true), 403, 'forbidden')
    h.expectStatus(await ban(c.admin, c.owner, true), 403, 'forbidden')
    h.expectStatus(await ban(c.admin, c.admin, true), 403, 'forbidden')
    h.expectStatus(await ban(c.owner, c.owner, true), 403, 'forbidden')

    h.expectStatus(await ban(c.admin, c.member2, true), 200)
    h.expectStatus(await ban(c.admin, c.member2, false), 200)
    h.expectStatus(await ban(c.owner, c.admin2, true), 200)
    h.expectStatus(await h.login(ctx, 'Yönetici İki'), 403, 'banned')
    // Yönetici, engelli bir yöneticinin engelini de kaldıramaz
    h.expectStatus(await ban(c.admin, c.admin2, false), 403, 'forbidden')
    h.expectStatus(await ban(c.owner, c.admin2, false), 200)
    const again = await h.login(ctx, 'Yönetici İki')
    h.expectStatus(again, 200)
    c.admin2.token = again.data.token
  })

  it('başkasının parolasını sıfırlama: yalnızca sahip (kendisi hariç)', async () => {
    const ctx = c.ctx
    h.expectStatus(await h.post(ctx, '/api/users/reset-password', c.admin.token, { userId: c.member2.user.id }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/users/reset-password', c.member.token, { userId: c.member2.user.id }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/users/reset-password', c.owner.token, { userId: c.owner.user.id }), 403, 'forbidden')
    const res = await h.post(ctx, '/api/users/reset-password', c.owner.token, { userId: c.admin2.user.id })
    h.expectStatus(res, 200)
    const relog = await h.login(ctx, 'Yönetici İki', res.data.tempPassword)
    h.expectStatus(relog, 200)
  })
})

describe('kanallar', () => {
  it('oluşturma, ad kuralları, aynı türde aynı ad, sıralama, son yazı kanalı', async () => {
    const ctx = await h.startServer({ maxChannels: 7 })
    try {
      const owner = await h.setupOwner(ctx)
      let meta = (await h.stateOf(ctx, owner.token)).meta
      assert.deepEqual(meta.channels, [
        { id: 1, name: 'genel', type: 'text', position: 0 },
        { id: 2, name: 'oyun', type: 'text', position: 1 },
        { id: 3, name: 'Ses 1', type: 'voice', position: 0 },
        { id: 4, name: 'Ses 2', type: 'voice', position: 1 }
      ])
      assert.deepEqual(meta.voice, { 3: [], 4: [] })

      const create = (name, type) => h.post(ctx, '/api/channels/create', owner.token, { name, type })
      h.expectStatus(await create('', 'text'), 400, 'invalid_channel_name')
      h.expectStatus(await create('x'.repeat(31), 'text'), 400, 'invalid_channel_name')
      h.expectStatus(await create('kötü/ad', 'text'), 400, 'invalid_channel_name')
      h.expectStatus(await create('müzik', 'video'), 400, 'invalid_channel_type')
      h.expectStatus(await create('GENEL', 'text'), 409, 'channel_exists')
      h.expectStatus(await create('İSTANBUL', 'text'), 200)
      h.expectStatus(await create('istanbul', 'text'), 409, 'channel_exists')
      // Farklı türde aynı ad serbest
      const sameName = await create('genel', 'voice')
      h.expectStatus(sameName, 200)
      assert.deepEqual(sameName.data.channel, { id: 6, name: 'genel', type: 'voice', position: 2 })
      h.expectStatus(await create('x', 'voice'), 200)
      h.expectStatus(await create('fazla', 'text'), 409, 'too_many_channels')

      // Yeniden sıralama aynı türde yeniden numaralandırır
      const moved = await h.post(ctx, '/api/channels/update', owner.token, { id: 5, position: 0 })
      h.expectStatus(moved, 200)
      assert.equal(moved.data.channel.position, 0)
      meta = (await h.stateOf(ctx, owner.token)).meta
      assert.deepEqual(meta.channels.filter((ch) => ch.type === 'text').map((ch) => [ch.id, ch.position]), [[5, 0], [1, 1], [2, 2]])
      h.expectStatus(await h.post(ctx, '/api/channels/update', owner.token, { id: 5, position: 99 }), 400, 'bad_request')
      h.expectStatus(await h.post(ctx, '/api/channels/update', owner.token, { id: 5, position: 1.5 }), 400, 'bad_request')
      h.expectStatus(await h.post(ctx, '/api/channels/update', owner.token, { id: 5, position: 7 }), 200)
      meta = (await h.stateOf(ctx, owner.token)).meta
      assert.deepEqual(meta.channels.filter((ch) => ch.type === 'text').map((ch) => [ch.id, ch.position]), [[1, 0], [2, 1], [5, 2]])
      h.expectStatus(await h.post(ctx, '/api/channels/update', owner.token, { id: 5, name: 'oyun' }), 409, 'channel_exists')
      h.expectStatus(await h.post(ctx, '/api/channels/update', owner.token, { id: 5, name: 'İstanbul ' }), 200)
      h.expectStatus(await h.post(ctx, '/api/channels/update', owner.token, { id: 5 }), 400, 'bad_request')
      h.expectStatus(await h.post(ctx, '/api/channels/update', owner.token, { id: 404, name: 'yok' }), 404, 'channel_not_found')

      // Son yazı kanalı silinemez
      h.expectStatus(await h.post(ctx, '/api/channels/delete', owner.token, { id: 2 }), 200)
      h.expectStatus(await h.post(ctx, '/api/channels/delete', owner.token, { id: 5 }), 200)
      h.expectStatus(await h.post(ctx, '/api/channels/delete', owner.token, { id: 1 }), 409, 'last_text_channel')
      h.expectStatus(await h.post(ctx, '/api/channels/delete', owner.token, { id: 3 }), 200)
      h.expectStatus(await h.post(ctx, '/api/channels/delete', owner.token, { id: 404 }), 404, 'channel_not_found')
      meta = (await h.stateOf(ctx, owner.token)).meta
      assert.deepEqual(meta.channels.map((ch) => [ch.id, ch.type, ch.position]), [[1, 'text', 0], [4, 'voice', 0], [6, 'voice', 1], [7, 'voice', 2]])
    } finally {
      await ctx.cleanup()
    }
  })

  it('kanal silinince mesajları gider, yazı kanalı yeniden başlatmadan sonra da yok', async () => {
    let ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      await h.sendMessage(ctx, owner.token, 2)
      await h.sendMessage(ctx, owner.token, 2)
      h.expectStatus(await h.post(ctx, '/api/channels/delete', owner.token, { id: 2 }), 200)
      h.expectStatus(await h.get(ctx, '/api/messages?channel=2', owner.token), 404, 'channel_not_found')
      ctx = await ctx.restart()
      const meta = (await h.stateOf(ctx, owner.token)).meta
      assert.ok(!meta.channels.some((ch) => ch.id === 2))
      const created = await h.post(ctx, '/api/channels/create', owner.token, { name: 'yeni', type: 'text' })
      h.expectStatus(created, 200)
      assert.equal(created.data.channel.id, 5)
      const list = await h.get(ctx, '/api/messages?channel=5', owner.token)
      assert.deepEqual(list.data, { messages: [], hasMore: false })
    } finally {
      await ctx.cleanup()
    }
  })

  it('yönetici işlem sınırı 429', async () => {
    const ctx = await h.startServer({ adminLimit: 2 })
    try {
      const owner = await h.setupOwner(ctx)
      h.expectStatus(await h.post(ctx, '/api/invite/rotate', owner.token), 200)
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { activeKid: KID }), 200)
      h.expectStatus(await h.post(ctx, '/api/channels/create', owner.token, { name: 'yeni', type: 'text' }), 429, 'rate_limited')
    } finally {
      await ctx.cleanup()
    }
  })
})
