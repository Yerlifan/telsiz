'use strict'

// Özel roller: rol oluşturma, düzenleme, sıralama ve silme (yalnızca sahip), üyeye rol verme, izinlerin
// uç noktalara etkisi (mesaj silme, engelleme, ses odası denetimi, oda yönetimi, Telsiz DJ), rütbe kuralı,
// meta alanları ve kalıcılık.

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const h = require('./server-yardimci')

const TEXT = 1
const VOICE = 3

async function community () {
  const ctx = await h.startServer()
  const owner = await h.setupOwner(ctx)
  const admin = await h.addUser(ctx, owner.token, 'yonetici')
  const mod = await h.addUser(ctx, owner.token, 'moderator')
  const dj = await h.addUser(ctx, owner.token, 'dj')
  const member = await h.addUser(ctx, owner.token, 'uye')
  const member2 = await h.addUser(ctx, owner.token, 'uye2')
  await h.makeAdmin(ctx, owner.token, admin.user.id)
  return { ctx, owner, admin, mod, dj, member, member2 }
}

async function relogin (ctx, name) {
  const res = await h.login(ctx, name)
  h.expectStatus(res, 200)
  return res.data.token
}

function createRole (ctx, token, body) {
  return h.post(ctx, '/api/roles/create', token, Object.assign({ name: 'Moderatör', color: 'blue', perms: [] }, body))
}

function giveRole (ctx, token, userId, roleId) {
  return h.post(ctx, '/api/users/custom-role', token, { userId, roleId })
}

async function metaOf (ctx, token) {
  return (await h.stateOf(ctx, token)).meta
}

function userIn (meta, id) {
  return meta.users.find((u) => u.id === id)
}

describe('özel roller: yönetim', () => {
  let c
  before(async () => {
    c = await community()
  })
  after(async () => {
    await c.ctx.cleanup()
  })

  it('yalnızca sahip rol oluşturur, rol metada yayımlanır, izinler sıralı ve tekrarsız tutulur', async () => {
    const { ctx } = c
    for (const actor of [c.admin, c.member]) {
      h.expectStatus(await createRole(ctx, actor.token, {}), 403, 'forbidden')
    }
    const res = await createRole(ctx, c.owner.token, { name: '  Moderatör  ', perms: ['voice', 'messages'] })
    h.expectStatus(res, 200)
    assert.deepEqual(res.data.role, { id: res.data.role.id, name: 'Moderatör', color: 'blue', perms: ['messages', 'voice'] })
    const meta = await metaOf(ctx, c.member.token)
    assert.deepEqual(meta.roles, [res.data.role])
    h.expectStatus(await h.post(ctx, '/api/roles/delete', c.owner.token, { id: res.data.role.id }), 200)
  })

  it('geçersiz ad, renk, izin ve yinelenen ad reddedilir', async () => {
    const { ctx } = c
    h.expectStatus(await createRole(ctx, c.owner.token, { name: '' }), 400, 'invalid_role_name')
    h.expectStatus(await createRole(ctx, c.owner.token, { name: 'x'.repeat(25) }), 400, 'invalid_role_name')
    h.expectStatus(await createRole(ctx, c.owner.token, { color: '#ff0000' }), 400, 'bad_request')
    h.expectStatus(await createRole(ctx, c.owner.token, { perms: ['admin'] }), 400, 'bad_request')
    h.expectStatus(await createRole(ctx, c.owner.token, { perms: ['ban', 'ban'] }), 400, 'bad_request')
    h.expectStatus(await createRole(ctx, c.owner.token, { perms: 'ban' }), 400, 'bad_request')
    const first = await createRole(ctx, c.owner.token, { name: 'DJ' })
    h.expectStatus(first, 200)
    h.expectStatus(await createRole(ctx, c.owner.token, { name: 'dj' }), 409, 'role_exists')
    h.expectStatus(await h.post(ctx, '/api/roles/delete', c.owner.token, { id: first.data.role.id }), 200)
  })

  it('düzenleme ve sıralama: position rütbeyi değiştirir, silinen rolün üyeleri rolsüz kalır', async () => {
    const { ctx } = c
    const a = (await createRole(ctx, c.owner.token, { name: 'Bir' })).data.role
    const b = (await createRole(ctx, c.owner.token, { name: 'İki', color: 'green' })).data.role
    h.expectStatus(await h.post(ctx, '/api/roles/update', c.admin.token, { id: a.id, name: 'Yeni' }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/roles/update', c.owner.token, { id: a.id }), 400, 'bad_request')
    h.expectStatus(await h.post(ctx, '/api/roles/update', c.owner.token, { id: 9999, name: 'Yok' }), 404, 'role_not_found')
    h.expectStatus(await h.post(ctx, '/api/roles/update', c.owner.token, { id: a.id, name: 'İki' }), 409, 'role_exists')
    const upd = await h.post(ctx, '/api/roles/update', c.owner.token, { id: b.id, name: 'Üst', color: 'red', perms: ['dj'], position: 0 })
    h.expectStatus(upd, 200)
    let meta = await metaOf(ctx, c.owner.token)
    assert.deepEqual(meta.roles.map((r) => r.id), [b.id, a.id])
    assert.deepEqual(meta.roles[0], { id: b.id, name: 'Üst', color: 'red', perms: ['dj'] })
    h.expectStatus(await giveRole(ctx, c.owner.token, c.member.user.id, b.id), 200)
    assert.equal(userIn(await metaOf(ctx, c.owner.token), c.member.user.id).roleId, b.id)
    h.expectStatus(await h.post(ctx, '/api/roles/delete', c.owner.token, { id: b.id }), 200)
    meta = await metaOf(ctx, c.owner.token)
    assert.deepEqual(meta.roles.map((r) => r.id), [a.id])
    assert.equal(userIn(meta, c.member.user.id).roleId, null)
    h.expectStatus(await h.post(ctx, '/api/roles/delete', c.owner.token, { id: a.id }), 200)
  })

  it('rol verme: yalnızca sahip, sahibe verilemez, bilinmeyen rol 404, null rolü kaldırır', async () => {
    const { ctx } = c
    const role = (await createRole(ctx, c.owner.token, { name: 'Rol' })).data.role
    h.expectStatus(await giveRole(ctx, c.admin.token, c.member.user.id, role.id), 403, 'forbidden')
    h.expectStatus(await giveRole(ctx, c.owner.token, c.owner.user.id, role.id), 403, 'forbidden')
    h.expectStatus(await giveRole(ctx, c.owner.token, c.member.user.id, 9999), 404, 'role_not_found')
    h.expectStatus(await h.post(ctx, '/api/users/custom-role', c.owner.token, { userId: c.member.user.id }), 400, 'bad_request')
    h.expectStatus(await giveRole(ctx, c.owner.token, c.member.user.id, role.id), 200)
    h.expectStatus(await giveRole(ctx, c.owner.token, c.member.user.id, null), 200)
    assert.equal(userIn(await metaOf(ctx, c.owner.token), c.member.user.id).roleId, null)
    h.expectStatus(await h.post(ctx, '/api/roles/delete', c.owner.token, { id: role.id }), 200)
  })
})

describe('özel roller: izinler ve rütbe', () => {
  let c
  let modRole
  let djRole
  before(async () => {
    c = await community()
    modRole = (await createRole(c.ctx, c.owner.token, { name: 'Moderatör', perms: ['messages', 'ban', 'voice', 'channels'] })).data.role
    djRole = (await createRole(c.ctx, c.owner.token, { name: 'DJ', color: 'purple', perms: ['dj'] })).data.role
    h.expectStatus(await giveRole(c.ctx, c.owner.token, c.mod.user.id, modRole.id), 200)
    h.expectStatus(await giveRole(c.ctx, c.owner.token, c.dj.user.id, djRole.id), 200)
  })
  after(async () => {
    await c.ctx.cleanup()
  })

  it('mesaj silme izni: yazı odasında başkasının mesajını siler, izinsiz rol silemez', async () => {
    const { ctx } = c
    const m1 = await h.sendMessage(ctx, c.member.token, TEXT)
    const m2 = await h.sendMessage(ctx, c.admin.token, TEXT)
    h.expectStatus(await h.post(ctx, '/api/messages/delete', c.dj.token, { id: m1.id }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/messages/delete', c.mod.token, { id: m1.id }), 200)
    h.expectStatus(await h.post(ctx, '/api/messages/delete', c.mod.token, { id: m2.id }), 200)
  })

  it('oda yönetimi izni: oda oluşturur, düzenler ve siler, izinsiz rol yapamaz', async () => {
    const { ctx } = c
    h.expectStatus(await h.post(ctx, '/api/channels/create', c.dj.token, { name: 'dj-odasi', type: 'text' }), 403, 'forbidden')
    const created = await h.post(ctx, '/api/channels/create', c.mod.token, { name: 'mod-odasi', type: 'text' })
    h.expectStatus(created, 200)
    h.expectStatus(await h.post(ctx, '/api/channels/update', c.mod.token, { id: created.data.channel.id, name: 'mod-odasi-2' }), 200)
    h.expectStatus(await h.post(ctx, '/api/channels/delete', c.mod.token, { id: created.data.channel.id }), 200)
  })

  it('engelleme izni: rolsüz üyeyi engeller, sahip, yönetici ve üst roldekiler engellenemez', async () => {
    const { ctx } = c
    h.expectStatus(await h.post(ctx, '/api/users/ban', c.dj.token, { userId: c.member2.user.id, banned: true }), 403, 'forbidden')
    for (const target of [c.owner, c.admin, c.mod]) {
      h.expectStatus(await h.post(ctx, '/api/users/ban', c.mod.token, { userId: target.user.id, banned: true }), 403, 'forbidden')
    }
    // DJ rolü listede Moderatör'ün altında
    h.expectStatus(await h.post(ctx, '/api/users/ban', c.mod.token, { userId: c.dj.user.id, banned: true }), 200)
    h.expectStatus(await h.post(ctx, '/api/users/ban', c.mod.token, { userId: c.dj.user.id, banned: false }), 200)
    // Engelleme oturumları kapatır, engeli kalkan yeniden girer
    c.dj.token = await relogin(ctx, 'dj')
    h.expectStatus(await h.post(ctx, '/api/users/ban', c.mod.token, { userId: c.member2.user.id, banned: true }), 200)
    const st = await h.stateOf(ctx, c.mod.token)
    assert.deepEqual(st.bannedUsers.map((u) => u.id), [c.member2.user.id])
    assert.equal(st.inviteCode, undefined)
    assert.equal((await h.stateOf(ctx, c.dj.token)).bannedUsers, undefined)
    h.expectStatus(await h.post(ctx, '/api/users/ban', c.mod.token, { userId: c.member2.user.id, banned: false }), 200)
    c.member2.token = await relogin(ctx, 'uye2')
    // Sıralama değişince rütbe de değişir: DJ üste çıkınca Moderatör onu engelleyemez
    h.expectStatus(await h.post(ctx, '/api/roles/update', c.owner.token, { id: djRole.id, position: 0 }), 200)
    h.expectStatus(await h.post(ctx, '/api/users/ban', c.mod.token, { userId: c.dj.user.id, banned: true }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/roles/update', c.owner.token, { id: modRole.id, position: 0 }), 200)
  })

  it('ses odası denetimi: herkes için susturma metada ve kadroda görünür, kalıcıdır, çıkarma odadan atar', async () => {
    const { ctx } = c
    h.expectStatus(await h.post(ctx, '/api/voice/join', c.member.token, { channelId: VOICE }), 200)
    h.expectStatus(await h.post(ctx, '/api/voice/moderate', c.dj.token, { userId: c.member.user.id, action: 'mute' }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/voice/moderate', c.mod.token, { userId: c.member.user.id, action: 'sustur' }), 400, 'bad_request')
    h.expectStatus(await h.post(ctx, '/api/voice/moderate', c.mod.token, { userId: c.mod.user.id, action: 'mute' }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/voice/moderate', c.mod.token, { userId: c.admin.user.id, action: 'mute' }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/voice/moderate', c.mod.token, { userId: c.member.user.id, action: 'mute' }), 200)
    let meta = await metaOf(ctx, c.owner.token)
    assert.equal(userIn(meta, c.member.user.id).voiceMuted, true)
    assert.equal(meta.voice[String(VOICE)][0].muted, true)
    // Kişi mikrofonunu açtığını bildirse de susturulmuş görünür
    h.expectStatus(await h.post(ctx, '/api/voice/state', c.member.token, { muted: false, deafened: false }), 200)
    meta = await metaOf(ctx, c.owner.token)
    assert.equal(meta.voice[String(VOICE)][0].muted, true)
    h.expectStatus(await h.post(ctx, '/api/voice/moderate', c.mod.token, { userId: c.member.user.id, action: 'unmute' }), 200)
    h.expectStatus(await h.post(ctx, '/api/voice/state', c.member.token, { muted: false, deafened: false }), 200)
    meta = await metaOf(ctx, c.owner.token)
    assert.equal(userIn(meta, c.member.user.id).voiceMuted, false)
    assert.equal(meta.voice[String(VOICE)][0].muted, false)
    h.expectStatus(await h.post(ctx, '/api/voice/moderate', c.mod.token, { userId: c.member.user.id, action: 'disconnect' }), 200)
    meta = await metaOf(ctx, c.owner.token)
    assert.deepEqual(meta.voice[String(VOICE)], [])
    h.expectStatus(await h.post(ctx, '/api/voice/moderate', c.mod.token, { userId: c.member.user.id, action: 'disconnect' }), 409, 'target_not_in_voice')
    // Susturma odaya katılmadan önce de verilebilir, katılınca kadroda susturulmuş görünür
    h.expectStatus(await h.post(ctx, '/api/voice/moderate', c.mod.token, { userId: c.member.user.id, action: 'mute' }), 200)
    h.expectStatus(await h.post(ctx, '/api/voice/join', c.member.token, { channelId: VOICE }), 200)
    meta = await metaOf(ctx, c.owner.token)
    assert.equal(meta.voice[String(VOICE)][0].muted, true)
    h.expectStatus(await h.post(ctx, '/api/voice/moderate', c.mod.token, { userId: c.member.user.id, action: 'unmute' }), 200)
    h.expectStatus(await h.post(ctx, '/api/voice/leave', c.member.token, {}), 200)
  })

  it('Telsiz DJ kısıtı: odada DJ izni olan varken yalnızca o yazar, yoksa herkes yazar, ayarı yalnızca sahip değiştirir', async () => {
    const { ctx } = c
    h.expectStatus(await h.post(ctx, '/api/settings', c.admin.token, { music: { restricted: true } }), 403, 'forbidden')
    h.expectStatus(await h.post(ctx, '/api/settings', c.owner.token, { music: { restricted: true } }), 200)
    assert.equal((await metaOf(ctx, c.member.token)).music.restricted, true)
    h.expectStatus(await h.post(ctx, '/api/voice/join', c.member.token, { channelId: VOICE }), 200)
    const first = await h.post(ctx, '/api/music/state', c.member.token, { channelId: VOICE, expect: 0, env: h.envelope() })
    h.expectStatus(first, 200)
    h.expectStatus(await h.post(ctx, '/api/voice/join', c.dj.token, { channelId: VOICE }), 200)
    const blocked = await h.post(ctx, '/api/music/state', c.member.token, { channelId: VOICE, expect: first.data.v, env: h.envelope() })
    h.expectStatus(blocked, 403, 'dj_restricted')
    assert.equal(typeof blocked.data.now, 'number')
    const byDj = await h.post(ctx, '/api/music/state', c.dj.token, { channelId: VOICE, expect: first.data.v, env: h.envelope() })
    h.expectStatus(byDj, 200)
    h.expectStatus(await h.post(ctx, '/api/voice/leave', c.dj.token, {}), 200)
    h.expectStatus(await h.post(ctx, '/api/music/state', c.member.token, { channelId: VOICE, expect: byDj.data.v, env: h.envelope() }), 200)
    h.expectStatus(await h.post(ctx, '/api/settings', c.owner.token, { music: { restricted: false } }), 200)
    h.expectStatus(await h.post(ctx, '/api/voice/leave', c.member.token, {}), 200)
  })
})

describe('özel roller: kalıcılık ve eski veri', () => {
  it('roller, verilen roller ve ses susturması yeniden başlatmadan sonra korunur, bozuk kayıtlar düzeltilir', async () => {
    const ctx = await h.startServer()
    let next = null
    try {
      const owner = await h.setupOwner(ctx)
      const member = await h.addUser(ctx, owner.token, 'uye')
      const role = (await createRole(ctx, owner.token, { name: 'Moderatör', perms: ['voice'] })).data.role
      h.expectStatus(await giveRole(ctx, owner.token, member.user.id, role.id), 200)
      h.expectStatus(await h.post(ctx, '/api/voice/moderate', owner.token, { userId: member.user.id, action: 'mute' }), 200)
      await ctx.server.flush()
      await ctx.stop()
      const file = path.join(ctx.dataDir, 'state.json')
      const disk = JSON.parse(fs.readFileSync(file, 'utf8'))
      assert.deepEqual(disk.roles, [{ id: role.id, name: 'Moderatör', color: 'blue', perms: ['voice'] }])
      assert.equal(disk.counters.role, role.id)
      next = await h.startServer({}, ctx.root)
      let meta = (await h.stateOf(next, owner.token)).meta
      assert.deepEqual(meta.roles, [role])
      assert.equal(userIn(meta, member.user.id).roleId, role.id)
      assert.equal(userIn(meta, member.user.id).voiceMuted, true)
      await next.stop()
      // Bozuk rol kaydı atılır, ona bağlı üye rolsüz kalır
      disk.roles = [{ id: role.id, name: '', color: 'blue', perms: [] }, { id: 77, name: 'Geçerli', color: 'pink', perms: ['dj', 'yok'] }]
      fs.writeFileSync(file, JSON.stringify(disk))
      next = await h.startServer({}, ctx.root)
      meta = (await h.stateOf(next, owner.token)).meta
      assert.deepEqual(meta.roles, [{ id: 77, name: 'Geçerli', color: 'pink', perms: ['dj'] }])
      assert.equal(userIn(meta, member.user.id).roleId, null)
      await next.server.flush()
      const fixed = JSON.parse(fs.readFileSync(file, 'utf8'))
      assert.equal(fixed.counters.role, 77)
      await next.stop()
      // Rol alanları hiç olmayan eski veri dosyası
      delete fixed.roles
      delete fixed.counters.role
      for (const u of fixed.users) {
        delete u.roleId
        delete u.voiceMuted
      }
      fs.writeFileSync(file, JSON.stringify(fixed))
      next = await h.startServer({}, ctx.root)
      meta = (await h.stateOf(next, owner.token)).meta
      assert.deepEqual(meta.roles, [])
      assert.equal(userIn(meta, member.user.id).roleId, null)
      assert.equal(userIn(meta, member.user.id).voiceMuted, false)
      const again = await createRole(next, owner.token, { name: 'Yeni' })
      h.expectStatus(again, 200)
      assert.equal(again.data.role.id, 1)
    } finally {
      if (next) await next.cleanup()
      else await ctx.cleanup()
    }
  })
})
