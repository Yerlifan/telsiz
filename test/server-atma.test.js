'use strict'

// Frekanstan atma (POST /api/users/kick): izin ve rütbe kuralı engellemeyle aynıdır, sahip hiçbir zaman atılamaz.
// Atma hesabı siler: bekleyen poll 401 kicked alır, oturumlar kapanır, ad yeniden kayıt için serbest kalır,
// mesajlar kalır ve yazarı silinmiş görünür. Silinmiş hesap yeniden hedef olamaz. Yanıt diske yazıldıktan sonra gelir.

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const h = require('./server-yardimci')

const TEXT = 1
const VOICE = 3

function kick (ctx, token, userId) {
  return h.post(ctx, '/api/users/kick', token, { userId })
}

function createRole (ctx, token, body) {
  return h.post(ctx, '/api/roles/create', token, Object.assign({ name: 'Moderatör', color: 'blue', perms: [] }, body))
}

function giveRole (ctx, token, userId, roleId) {
  return h.post(ctx, '/api/users/custom-role', token, { userId, roleId })
}

function diskState (ctx) {
  return JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'state.json'), 'utf8'))
}

async function metaOf (ctx, token) {
  return (await h.stateOf(ctx, token)).meta
}

describe('frekanstan atma', () => {
  let ctx
  let owner, admin, mod, dj, member
  let modRole, djRole
  before(async () => {
    ctx = await h.startServer()
    owner = await h.setupOwner(ctx)
    admin = await h.addUser(ctx, owner.token, 'yonetici')
    mod = await h.addUser(ctx, owner.token, 'moderator')
    dj = await h.addUser(ctx, owner.token, 'dj')
    member = await h.addUser(ctx, owner.token, 'uye')
    await h.makeAdmin(ctx, owner.token, admin.user.id)
    modRole = (await createRole(ctx, owner.token, { name: 'Moderatör', perms: ['ban'] })).data.role
    djRole = (await createRole(ctx, owner.token, { name: 'DJ', color: 'purple', perms: ['dj'] })).data.role
    h.expectStatus(await giveRole(ctx, owner.token, mod.user.id, modRole.id), 200)
    h.expectStatus(await giveRole(ctx, owner.token, dj.user.id, djRole.id), 200)
  })
  after(async () => {
    await ctx.cleanup()
  })

  it('engelleme izni olmayan atamaz (403), bilinmeyen veya eksik hedef 404', async () => {
    for (const actor of [member, dj]) {
      h.expectStatus(await kick(ctx, actor.token, member.user.id), 403, 'forbidden')
    }
    h.expectStatus(await kick(ctx, owner.token, 9999), 404, 'user_not_found')
    h.expectStatus(await h.post(ctx, '/api/users/kick', owner.token, {}), 404, 'user_not_found')
    h.expectStatus(await h.post(ctx, '/api/users/kick', null, { userId: member.user.id }), 401, 'invalid_token')
  })

  it('rütbe: kendini ve üst ya da aynı rütbedekini atamaz, sahip hiçbir zaman atılamaz', async () => {
    for (const actor of [owner, admin, mod]) {
      h.expectStatus(await kick(ctx, actor.token, actor.user.id), 403, 'forbidden')
      h.expectStatus(await kick(ctx, actor.token, owner.user.id), 403, 'forbidden')
    }
    for (const target of [admin, mod]) {
      h.expectStatus(await kick(ctx, mod.token, target.user.id), 403, 'forbidden')
    }
    // DJ rolü listede Moderatör'ün üstüne çıkınca Moderatör onu atamaz
    h.expectStatus(await h.post(ctx, '/api/roles/update', owner.token, { id: djRole.id, position: 0 }), 200)
    h.expectStatus(await kick(ctx, mod.token, dj.user.id), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/roles/update', owner.token, { id: modRole.id, position: 0 }), 200)
    // Hiçbiri gerçekleşmedi: herkes hâlâ listede
    const meta = await metaOf(ctx, owner.token)
    for (const u of [owner, admin, mod, dj, member]) assert.ok(meta.users.some((x) => x.id === u.user.id), u.user.name)
  })

  it('atılanın hesabı silinir: bekleyen poll 401 kicked, jetonları 401, mesajları kalır, ses odasından düşer', async () => {
    const second = await h.login(ctx, 'uye')
    h.expectStatus(second, 200)
    const m = await h.sendMessage(ctx, member.token, TEXT)
    h.expectStatus(await h.post(ctx, '/api/voice/join', member.token, { channelId: VOICE }), 200)
    const st = await h.stateOf(ctx, member.token)
    const p = h.poller(ctx, member.token, st)
    const waiting = h.nextRequest(ctx.server, '/api/poll')
    const pending = p.poll()
    await waiting

    const res = await kick(ctx, mod.token, member.user.id)
    h.expectStatus(res, 200)
    assert.deepEqual(res.data, { ok: true })
    // Yanıt geldiğinde silme diske yazılmıştır
    const disk = diskState(ctx)
    const saved = disk.users.find((u) => u.id === member.user.id)
    assert.equal(saved.deleted, true)
    assert.equal(saved.name, '')
    assert.equal(saved.passHash, null)
    assert.equal(disk.sessions.some((s) => s.userId === member.user.id), false)

    h.expectStatus(await pending, 401, 'kicked')
    h.expectStatus(await h.get(ctx, '/api/state', member.token), 401, 'invalid_token')
    h.expectStatus(await h.get(ctx, '/api/state', second.data.token), 401, 'invalid_token')
    h.expectStatus(await h.login(ctx, 'uye'), 401, 'bad_credentials')

    const meta = await metaOf(ctx, owner.token)
    assert.ok(!meta.users.some((u) => u.id === member.user.id))
    assert.deepEqual(meta.voice[String(VOICE)], [])
    const list = await h.get(ctx, '/api/messages?channel=' + TEXT, owner.token)
    assert.deepEqual(list.data.messages.filter((x) => x.id === m.id).map((x) => x.authorId), [member.user.id])

    // Silinmiş hesap yeniden hedef olamaz
    h.expectStatus(await kick(ctx, owner.token, member.user.id), 404, 'user_not_found')
    h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: member.user.id, banned: true }), 404, 'user_not_found')
  })

  it('ad yeniden kayıt için serbest kalır, dönen kişi davet koduyla yeni bir hesap açar', async () => {
    const code = await h.inviteCodeOf(ctx, owner.token)
    const available = await h.post(ctx, '/api/username-available', null, { name: 'uye', code })
    h.expectStatus(available, 200)
    assert.deepEqual(available.data, { available: true, valid: true })
    const again = await h.addUser(ctx, owner.token, 'uye')
    assert.notEqual(again.user.id, member.user.id)
    assert.equal(again.user.role, 'member')
    h.expectStatus(await h.login(ctx, 'uye'), 200)
    const meta = await metaOf(ctx, owner.token)
    assert.equal(meta.users.find((u) => u.id === again.user.id).roleId, null)
  })

  it('engellenmiş bir hesap da atılabilir, engellenenler listesinden düşer', async () => {
    const target = await h.addUser(ctx, owner.token, 'uye2')
    h.expectStatus(await h.post(ctx, '/api/users/ban', admin.token, { userId: target.user.id, banned: true }), 200)
    assert.deepEqual((await h.stateOf(ctx, owner.token)).bannedUsers.map((u) => u.id), [target.user.id])
    h.expectStatus(await kick(ctx, admin.token, target.user.id), 200)
    assert.deepEqual((await h.stateOf(ctx, owner.token)).bannedUsers, [])
    h.expectStatus(await h.login(ctx, 'uye2'), 401, 'bad_credentials')
  })
})
