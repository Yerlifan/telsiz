'use strict'

// Özel mesajlar: konuşma açma kuralları, yetki, zarf biçimi ayrımı, engel etkileri,
// olay hedef kitlesi, yüklemelerin yalnızca iki üyeye açık olması ve kalıcılık.
// Üçüncü bir kullanıcının (sahip dahil) özel mesaj olaylarını, içeriğini ve yüklemelerini
// hiçbir yoldan alamadığı burada kanıtlanır.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const h = require('./server-yardimci')

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

async function openDm (ctx, from, to) {
  const res = await act(ctx, from, 'dms/open', { userId: to.user.id })
  h.expectStatus(res, 200)
  assert.deepEqual(Object.keys(res.data.dm).sort(), ['id', 'userId'])
  assert.equal(res.data.dm.userId, to.user.id)
  return res.data.dm.id
}

async function sendDm (ctx, who, dmId, opts) {
  const o = opts || {}
  const body = { channelId: dmId, body: o.body || h.dmEnvelope() }
  if (o.uploads) body.uploads = o.uploads
  const res = await act(ctx, who, 'messages', body)
  h.expectStatus(res, 200)
  return res.data.message
}

async function privateOf (ctx, who) {
  return (await h.stateOf(ctx, who.token)).private
}

describe('özel mesaj açma kuralları', () => {
  it('arkadaşlık veya üye izni, engeller, mevcut konuşma ve kişiye özel meta', async () => {
    const { ctx, owner, ayse, mehmet, ali } = await group()
    try {
      const dmId = await openDm(ctx, ayse, mehmet)
      assert.equal(await openDm(ctx, ayse, mehmet), dmId)
      assert.equal(await openDm(ctx, mehmet, ayse), dmId)
      assert.deepEqual((await privateOf(ctx, ayse)).dms, [{ id: dmId, userId: mehmet.user.id, lastMessageId: null, lastMessageAt: null }])
      assert.deepEqual((await privateOf(ctx, mehmet)).dms, [{ id: dmId, userId: ayse.user.id, lastMessageId: null, lastMessageAt: null }])
      assert.deepEqual((await privateOf(ctx, ali)).dms, [])

      // Hedef üyelerden özel mesaj kabul etmiyorsa yalnızca arkadaşları yeni konuşma açabilir
      h.expectStatus(await act(ctx, ali, 'me/settings', { allowMemberDms: false }), 200)
      const denied = await act(ctx, ayse, 'dms/open', { userId: ali.user.id })
      h.expectStatus(denied, 403, 'dm_not_allowed')
      h.expectStatus(await act(ctx, ayse, 'friends/request', { name: 'ali' }), 200)
      h.expectStatus(await act(ctx, ayse, 'dms/open', { userId: ali.user.id }), 403, 'dm_not_allowed')
      h.expectStatus(await act(ctx, ali, 'friends/accept', { userId: ayse.user.id }), 200)
      const withAli = await openDm(ctx, ayse, ali)
      assert.notEqual(withAli, dmId)
      // Kendisi üyelerden kabul etmese de başkasına açabilir (hedefin ayarı geçerlidir)
      await openDm(ctx, ali, owner)

      // İki yönde de engel varsa açılamaz, mevcut konuşma da dönmez
      h.expectStatus(await act(ctx, mehmet, 'blocks/add', { userId: ayse.user.id }), 200)
      h.expectStatus(await act(ctx, ayse, 'dms/open', { userId: mehmet.user.id }), 403, 'dm_not_allowed')
      h.expectStatus(await act(ctx, mehmet, 'dms/open', { userId: ayse.user.id }), 403, 'dm_not_allowed')
      h.expectStatus(await act(ctx, mehmet, 'blocks/remove', { userId: ayse.user.id }), 200)
      assert.equal(await openDm(ctx, mehmet, ayse), dmId)

      h.expectStatus(await act(ctx, ayse, 'dms/open', { userId: ayse.user.id }), 400, 'self')
      h.expectStatus(await act(ctx, ayse, 'dms/open', { userId: 999 }), 404, 'user_not_found')
      h.expectStatus(await act(ctx, ayse, 'dms/open', {}), 404, 'user_not_found')
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: mehmet.user.id, banned: true }), 200)
      h.expectStatus(await act(ctx, ayse, 'dms/open', { userId: mehmet.user.id }), 403, 'dm_not_allowed')
    } finally {
      await ctx.cleanup()
    }
  })

  it('konuşmalar kanal listesinde, kanal yönetiminde ve seste yer almaz', async () => {
    const { ctx, owner, ayse, mehmet } = await group({ maxChannels: 5 })
    try {
      const dmId = await openDm(ctx, ayse, mehmet)
      const meta = (await h.stateOf(ctx, owner.token)).meta
      assert.ok(!meta.channels.some((c) => c.id === dmId))
      assert.ok(!(String(dmId) in meta.voice))
      h.expectStatus(await act(ctx, owner, 'channels/update', { id: dmId, name: 'ele geçirildi' }), 404, 'channel_not_found')
      h.expectStatus(await act(ctx, owner, 'channels/delete', { id: dmId }), 404, 'channel_not_found')
      h.expectStatus(await act(ctx, ayse, 'voice/join', { channelId: dmId }), 404, 'channel_not_found')
      // Konuşmalar kanal üst sınırına sayılmaz (4 varsayılan + 1 yeni = 5)
      await openDm(ctx, ayse, owner)
      h.expectStatus(await act(ctx, owner, 'channels/create', { name: 'yeni', type: 'text' }), 200)
      h.expectStatus(await act(ctx, owner, 'channels/create', { name: 'fazla', type: 'text' }), 409, 'too_many_channels')
    } finally {
      await ctx.cleanup()
    }
  })

  it('kullanıcı başına konuşma üst sınırı', async () => {
    const { ctx, owner, ayse, mehmet, ali } = await group({ maxDmsPerUser: 2 })
    try {
      await openDm(ctx, ayse, mehmet)
      await openDm(ctx, ayse, ali)
      h.expectStatus(await act(ctx, ayse, 'dms/open', { userId: owner.user.id }), 409, 'too_many_dms')
      h.expectStatus(await act(ctx, owner, 'dms/open', { userId: ayse.user.id }), 409, 'too_many_dms')
      await openDm(ctx, owner, mehmet)
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('özel mesaj yetkisi ve zarf biçimi', () => {
  it('yazı kanalı yalnızca 1., özel konuşma yalnızca 2. zarfı kabul eder', async () => {
    const { ctx, ayse, mehmet } = await group({ maxBodyChars: 200 })
    try {
      const dmId = await openDm(ctx, ayse, mehmet)
      const nonce = 'A'.repeat(32)
      const good = '2.' + nonce + '.' + 'B'.repeat(24)
      h.expectStatus(await act(ctx, ayse, 'messages', { channelId: dmId, body: good }), 200)
      const atLimit = '2.' + nonce + '.' + 'B'.repeat(200 - 35)
      assert.equal(atLimit.length, 200)
      h.expectStatus(await act(ctx, ayse, 'messages', { channelId: dmId, body: atLimit }), 200)
      for (const body of [h.envelope(), '2.' + nonce.slice(1) + '.' + 'B'.repeat(24), '2.' + nonce + '.' + 'B'.repeat(23),
        '2.' + nonce + '.' + 'B'.repeat(24) + '=', '2.' + nonce + '.' + 'B'.repeat(24) + '\n', atLimit + 'B', '3.' + nonce + '.' + 'B'.repeat(24),
        'merhaba', 42, null]) {
        h.expectStatus(await act(ctx, ayse, 'messages', { channelId: dmId, body }), 400, 'bad_body')
      }
      // Yazı kanalı özel mesaj zarfını reddeder
      h.expectStatus(await act(ctx, ayse, 'messages', { channelId: 1, body: good }), 400, 'bad_body')
      h.expectStatus(await act(ctx, ayse, 'messages', { channelId: 1, body: h.envelope() }), 200)
      // Düzenlemede de aynı ayrım
      const dmMsg = await sendDm(ctx, ayse, dmId)
      h.expectStatus(await act(ctx, ayse, 'messages/edit', { id: dmMsg.id, body: h.envelope() }), 400, 'bad_body')
      h.expectStatus(await act(ctx, ayse, 'messages/edit', { id: dmMsg.id, body: h.dmEnvelope() }), 200)
      const textMsg = await h.sendMessage(ctx, ayse.token, 1)
      h.expectStatus(await act(ctx, ayse, 'messages/edit', { id: textMsg.id, body: h.dmEnvelope() }), 400, 'bad_body')
    } finally {
      await ctx.cleanup()
    }
  })

  it('okuma, düzenleme ve silme yalnızca iki üyeye, başkasının mesajını yönetici de silemez', async () => {
    const { ctx, owner, ayse, mehmet, ali } = await group()
    try {
      const admin = await h.addUser(ctx, owner.token, 'yonetici')
      await h.makeAdmin(ctx, owner.token, admin.user.id)
      const dmId = await openDm(ctx, ayse, mehmet)
      const m1 = await sendDm(ctx, ayse, dmId)
      const m2 = await sendDm(ctx, mehmet, dmId)

      for (const who of [ayse, mehmet]) {
        const list = await h.get(ctx, '/api/messages?channel=' + dmId, who.token)
        h.expectStatus(list, 200)
        assert.deepEqual(list.data.messages.map((m) => m.id), [m1.id, m2.id])
      }
      for (const who of [owner, admin, ali]) {
        h.expectStatus(await h.get(ctx, '/api/messages?channel=' + dmId, who.token), 404, 'channel_not_found')
        h.expectStatus(await act(ctx, who, 'messages', { channelId: dmId, body: h.dmEnvelope() }), 404, 'channel_not_found')
        h.expectStatus(await act(ctx, who, 'messages/edit', { id: m1.id, body: h.dmEnvelope() }), 404, 'message_not_found')
        h.expectStatus(await act(ctx, who, 'messages/delete', { id: m1.id }), 404, 'message_not_found')
      }
      h.expectStatus(await act(ctx, mehmet, 'messages/edit', { id: m1.id, body: h.dmEnvelope() }), 403, 'forbidden')
      h.expectStatus(await act(ctx, mehmet, 'messages/delete', { id: m1.id }), 403, 'forbidden')
      h.expectStatus(await act(ctx, ayse, 'messages/delete', { id: m1.id }), 200)
      const list = await h.get(ctx, '/api/messages?channel=' + dmId, mehmet.token)
      assert.deepEqual(list.data.messages.map((m) => m.id), [m2.id])
      assert.deepEqual((await privateOf(ctx, ayse)).dms[0].lastMessageId, m2.id)
      assert.equal((await privateOf(ctx, ayse)).dms[0].lastMessageAt, m2.createdAt)
    } finally {
      await ctx.cleanup()
    }
  })

  it('engel, sunucu engeli ve hesap silme yeni mesajı durdurur, geçmiş görünür kalır', async () => {
    const { ctx, owner, ayse, mehmet, ali } = await group()
    try {
      const dmId = await openDm(ctx, ayse, mehmet)
      const mine = await sendDm(ctx, ayse, dmId)
      const theirs = await sendDm(ctx, mehmet, dmId)
      h.expectStatus(await act(ctx, mehmet, 'blocks/add', { userId: ayse.user.id }), 200)
      // Engel iki yönde de yeni mesajı durdurur
      for (const from of [ayse, mehmet]) {
        h.expectStatus(await act(ctx, from, 'messages', { channelId: dmId, body: h.dmEnvelope() }), 403, 'dm_not_allowed')
      }
      h.expectStatus(await act(ctx, ayse, 'messages/edit', { id: mine.id, body: h.dmEnvelope() }), 403, 'dm_not_allowed')
      h.expectStatus(await act(ctx, mehmet, 'messages/edit', { id: theirs.id, body: h.dmEnvelope() }), 403, 'dm_not_allowed')
      const history = await h.get(ctx, '/api/messages?channel=' + dmId, ayse.token)
      assert.deepEqual(history.data.messages.map((m) => m.id), [mine.id, theirs.id])
      h.expectStatus(await act(ctx, ayse, 'messages/delete', { id: mine.id }), 200)
      h.expectStatus(await act(ctx, mehmet, 'blocks/remove', { userId: ayse.user.id }), 200)
      await sendDm(ctx, ayse, dmId)

      // Hedef üyelerden mesaj kabul etmeyi sonradan kapatsa da mevcut konuşma sürer
      h.expectStatus(await act(ctx, mehmet, 'me/settings', { allowMemberDms: false }), 200)
      await sendDm(ctx, ayse, dmId)

      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: mehmet.user.id, banned: true }), 200)
      h.expectStatus(await act(ctx, ayse, 'messages', { channelId: dmId, body: h.dmEnvelope() }), 403, 'dm_not_allowed')
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: mehmet.user.id, banned: false }), 200)

      const withAli = await openDm(ctx, ayse, ali)
      await sendDm(ctx, ali, withAli)
      h.expectStatus(await act(ctx, ali, 'me/delete', { authKey: h.authKeyFor(h.PASSWORD) }), 200)
      h.expectStatus(await act(ctx, ayse, 'messages', { channelId: withAli, body: h.dmEnvelope() }), 403, 'dm_not_allowed')
      const aliHistory = await h.get(ctx, '/api/messages?channel=' + withAli, ayse.token)
      assert.equal(aliHistory.data.messages.length, 1)
      assert.equal(aliHistory.data.messages[0].authorId, ali.user.id)
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('olay hedef kitlesi ve yüklemeler', () => {
  it('üçüncü kullanıcı (sahip dahil) özel mesaj olaylarını ve yüklemelerini asla alamaz', async () => {
    const { ctx, owner, ayse, mehmet, ali } = await group({ pollTimeoutMs: 1200 })
    try {
      const dmId = await openDm(ctx, ayse, mehmet)
      for (const who of [owner, ayse, mehmet, ali]) await h.stateOf(ctx, who.token)
      const initial = {}
      const pollers = {}
      for (const [label, who] of [['owner', owner], ['ayse', ayse], ['mehmet', mehmet], ['ali', ali]]) {
        initial[label] = await h.stateOf(ctx, who.token)
        pollers[label] = h.poller(ctx, who.token, initial[label])
      }
      const seen = { owner: [], ayse: [], mehmet: [], ali: [] }
      const texts = { owner: '', ayse: '', mehmet: '', ali: '' }
      function record (label, res) {
        h.expectStatus(res, 200)
        texts[label] += res.text
        for (const e of res.data.events) seen[label].push(e)
      }

      // Üçüncü kişiler beklerken özel mesaj trafiği oluşur
      const waitAli = pollers.ali.poll()
      const waitOwner = pollers.owner.poll()
      await h.waitFor(() => ctx.server.stats().waiters === 2)
      const fileBytes = crypto.randomBytes(300)
      const up = await h.upload(ctx, ayse.token, fileBytes)
      h.expectStatus(up, 200)
      const uploadId = up.data.id
      // Bağlanmadan önce yalnızca yükleyen indirebilir
      h.expectStatus(await h.get(ctx, '/api/uploads/' + uploadId, mehmet.token), 404, 'upload_not_found')
      const secretBodies = [h.dmEnvelope(40), h.dmEnvelope(41), h.dmEnvelope(42)]
      const m1 = await sendDm(ctx, ayse, dmId, { body: secretBodies[0], uploads: [uploadId] })
      const m2 = await sendDm(ctx, mehmet, dmId, { body: secretBodies[1] })
      h.expectStatus(await act(ctx, ayse, 'messages/edit', { id: m1.id, body: secretBodies[2] }), 200)
      h.expectStatus(await act(ctx, mehmet, 'messages/delete', { id: m2.id }), 200)
      // Üçüncü kişilerin bekleyenleri uyanmadı
      await h.sleep(100)
      assert.equal(ctx.server.stats().waiters, 2)
      // Yazı kanalı mesajı herkese gider
      const textMsg = await h.sendMessage(ctx, ali.token, 1)
      record('ali', await waitAli)
      record('owner', await waitOwner)

      // Üyeler tüm olayları sırayla alır
      for (const label of ['ayse', 'mehmet']) {
        record(label, await pollers[label].poll())
        const kinds = seen[label].filter((e) => e.channelId === dmId).map((e) => e.type + ':' + (e.message ? e.message.id : e.messageId))
        assert.deepEqual(kinds, ['msg:' + m1.id, 'msg:' + m2.id, 'edit:' + m1.id, 'del:' + m2.id], label)
        assert.ok(seen[label].some((e) => e.type === 'msg' && e.message.id === textMsg.id))
      }
      const lastSeq = pollers.ayse.st.seq

      // Üçüncü kişiler: yeniden yakalama (since=başlangıç), resync ve zaman aşımı yanıtları
      for (const [label, who] of [['ali', ali], ['owner', owner]]) {
        const st = initial[label]
        record(label, await h.get(ctx, '/api/poll?since=' + st.seq + '&mv=' + st.metaVersion + '&pmv=' + st.pmv + '&sig=0&boot=' + st.boot, who.token))
        record(label, await h.get(ctx, '/api/poll?since=0&mv=0&pmv=0&sig=0&boot=' + st.boot, who.token))
        record(label, await h.get(ctx, '/api/poll?since=0&mv=0&sig=0&boot=yanlis', who.token))
        const timeout = await pollers[label].poll()
        record(label, timeout)
        assert.equal(timeout.data.seq, lastSeq)
        assert.deepEqual(seen[label].map((e) => e.channelId), seen[label].map(() => 1), label)
        assert.ok(seen[label].some((e) => e.type === 'msg' && e.message.id === textMsg.id), label)
        for (const body of secretBodies) assert.ok(!texts[label].includes(body), label)
        assert.ok(!texts[label].includes(uploadId), label)
        const st2 = await h.get(ctx, '/api/state', who.token)
        for (const body of secretBodies) assert.ok(!st2.text.includes(body))
        assert.deepEqual(st2.data.private.dms, [])
      }

      // Yükleme yalnızca iki üyeye açıktır
      for (const who of [ayse, mehmet]) {
        const res = await h.get(ctx, '/api/uploads/' + uploadId, who.token)
        h.expectStatus(res, 200)
        assert.deepEqual(res.buffer, fileBytes)
      }
      for (const who of [owner, ali]) {
        h.expectStatus(await h.get(ctx, '/api/uploads/' + uploadId, who.token), 404, 'upload_not_found')
      }
      // Mesaj silinince dosya da silinir
      h.expectStatus(await act(ctx, ayse, 'messages/delete', { id: m1.id }), 200)
      h.expectStatus(await h.get(ctx, '/api/uploads/' + uploadId, ayse.token), 404, 'upload_not_found')
    } finally {
      await ctx.cleanup()
    }
  })

  it('500 olay sınırı görünür olaylara uygulanır, görünmeyen olaylar atlanır', async () => {
    const { ctx, ayse, mehmet, ali } = await group()
    try {
      const dmId = await openDm(ctx, ayse, mehmet)
      const st = await h.stateOf(ctx, ali.token)
      for (const i of h.times(3)) await sendDm(ctx, ayse, dmId)
      const textIds = []
      for (const i of h.times(2)) textIds.push((await h.sendMessage(ctx, ayse.token, 1)).id)
      for (const i of h.times(3)) await sendDm(ctx, mehmet, dmId)
      const url = '/api/poll?since=' + st.seq + '&mv=' + st.metaVersion + '&pmv=' + st.pmv + '&sig=0&boot=' + st.boot
      const res = await h.get(ctx, url, ali.token)
      assert.deepEqual(res.data.events.map((e) => e.message.id), textIds)
      assert.equal(res.data.seq, st.seq + 8)
    } finally {
      await ctx.cleanup()
    }
  })

  it('üyeleri geçersiz konuşma kaydı içeren veri dosyasıyla başlatılmaz, veri ezilmez', async () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const { createChatServer } = require('../src/app')
    const g = await group()
    try {
      await openDm(g.ctx, g.ayse, g.mehmet)
      await g.ctx.stop()
      const file = path.join(g.ctx.dataDir, 'state.json')
      const good = fs.readFileSync(file, 'utf8')
      for (const members of [[g.ayse.user.id], [g.ayse.user.id, 999], [g.ayse.user.id, g.ayse.user.id], 'x', null]) {
        const broken = JSON.parse(good)
        broken.channels.find((c) => c.type === 'dm').members = members
        const text = JSON.stringify(broken)
        fs.writeFileSync(file, text)
        await assert.rejects(createChatServer({ dataDir: g.ctx.dataDir, scryptN: 1024, log: null }), (err) => err.code === 'corrupt')
        assert.equal(fs.readFileSync(file, 'utf8'), text)
      }
      fs.writeFileSync(file, good)
    } finally {
      h.removeRoot(g.ctx.root)
    }
  })

  it('özel mesajlar ve konuşmalar yeniden başlatmadan sonra kalır', async () => {
    const g = await group()
    let ctx = g.ctx
    try {
      const dmId = await openDm(ctx, g.ayse, g.mehmet)
      const m = await sendDm(ctx, g.ayse, dmId)
      ctx = await ctx.restart()
      assert.equal(await openDm(ctx, g.mehmet, g.ayse), dmId)
      const list = await h.get(ctx, '/api/messages?channel=' + dmId, g.mehmet.token)
      assert.deepEqual(list.data.messages.map((x) => x.id), [m.id])
      assert.deepEqual((await privateOf(ctx, g.ayse)).dms, [{ id: dmId, userId: g.mehmet.user.id, lastMessageId: m.id, lastMessageAt: m.createdAt }])
      h.expectStatus(await h.get(ctx, '/api/messages?channel=' + dmId, g.ali.token), 404, 'channel_not_found')
      // Yeni kanal kimlikleri konuşma kimlikleriyle çakışmaz
      const created = await h.post(ctx, '/api/channels/create', g.owner.token, { name: 'yeni', type: 'text' })
      assert.ok(created.data.channel.id > dmId)
    } finally {
      await ctx.cleanup()
    }
  })
})
