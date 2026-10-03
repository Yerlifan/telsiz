'use strict'

// Mesajlar: gönderme, düzenleme, silme, zarf doğrulaması, kalıcılık, sayfalama (before ve around)
// ve hız sınırı.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./server-yardimci')

describe('mesajlar', () => {
  it('gönderme, düzenleme, silme ve yanıt şekilleri', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const body = h.envelope()
      const sent = await h.post(ctx, '/api/messages', owner.token, { channelId: 1, body })
      h.expectStatus(sent, 200)
      assert.equal(sent.data.ok, true)
      const m = sent.data.message
      assert.deepEqual(Object.keys(m).sort(), ['authorId', 'body', 'channelId', 'createdAt', 'editedAt', 'id', 'uploads'])
      assert.equal(m.channelId, 1)
      assert.equal(m.authorId, 1)
      assert.equal(m.body, body)
      assert.equal(m.editedAt, null)
      assert.deepEqual(m.uploads, [])

      // Kimlik dizge olarak da kabul edilir
      h.expectStatus(await h.post(ctx, '/api/messages', owner.token, { channelId: '2', body: h.envelope() }), 200)

      const newBody = h.envelope(10)
      const edited = await h.post(ctx, '/api/messages/edit', owner.token, { id: m.id, body: newBody })
      h.expectStatus(edited, 200)
      assert.equal(edited.data.message.body, newBody)
      assert.ok(edited.data.message.editedAt >= m.createdAt)

      h.expectStatus(await h.post(ctx, '/api/messages/edit', owner.token, { id: 999, body: newBody }), 404, 'message_not_found')
      h.expectStatus(await h.post(ctx, '/api/messages/delete', owner.token, { id: m.id }), 200)
      h.expectStatus(await h.post(ctx, '/api/messages/delete', owner.token, { id: m.id }), 404, 'message_not_found')
      h.expectStatus(await h.post(ctx, '/api/messages/edit', owner.token, { id: m.id, body: newBody }), 404, 'message_not_found')
      h.expectStatus(await h.post(ctx, '/api/messages/delete', owner.token, { id: 'abc' }), 404, 'message_not_found')
    } finally {
      await ctx.cleanup()
    }
  })

  it('kanal denetimi: ses kanalına ve olmayan kanala mesaj gönderilemez', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      for (const channelId of [3, 4, 99, 0, -1, '1x', null, 1.5]) {
        h.expectStatus(await h.post(ctx, '/api/messages', owner.token, { channelId, body: h.envelope() }), 404, 'channel_not_found')
      }
      h.expectStatus(await h.get(ctx, '/api/messages?channel=3', owner.token), 404, 'channel_not_found')
      h.expectStatus(await h.get(ctx, '/api/messages?channel=99', owner.token), 404, 'channel_not_found')
      h.expectStatus(await h.get(ctx, '/api/messages', owner.token), 404, 'channel_not_found')
    } finally {
      await ctx.cleanup()
    }
  })

  it('zarf deseni ve uzunluk doğrulaması', async () => {
    const ctx = await h.startServer({ maxBodyChars: 200 })
    try {
      const owner = await h.setupOwner(ctx)
      const kid = '0123456789abcdef'
      const nonce = 'A'.repeat(32)
      const good = '1.' + kid + '.' + nonce + '.' + 'B'.repeat(24)
      h.expectStatus(await h.post(ctx, '/api/messages', owner.token, { channelId: 1, body: good }), 200)
      const bad = [
        'merhaba',
        '',
        '2.' + kid + '.' + nonce + '.' + 'B'.repeat(24),
        '1.' + kid.toUpperCase() + '.' + nonce + '.' + 'B'.repeat(24),
        '1.' + kid + '.' + nonce.slice(1) + '.' + 'B'.repeat(24),
        '1.' + kid + '.' + nonce + '.' + 'B'.repeat(23),
        '1.' + kid + '.' + nonce + '.' + 'B'.repeat(23) + '=',
        '1.' + kid + '.' + nonce + '.' + 'B'.repeat(24) + '\n',
        '1.' + kid + '.' + nonce + '.' + 'B'.repeat(200 - 52 + 1),
        123,
        null,
        Array.of('1.' + kid),
        { body: good }
      ]
      for (const body of bad) {
        h.expectStatus(await h.post(ctx, '/api/messages', owner.token, { channelId: 1, body }), 400, 'bad_body')
      }
      const atLimit = '1.' + kid + '.' + nonce + '.' + 'B'.repeat(200 - 52)
      assert.equal(atLimit.length, 200)
      h.expectStatus(await h.post(ctx, '/api/messages', owner.token, { channelId: 1, body: atLimit }), 200)
      const m = await h.sendMessage(ctx, owner.token, 1)
      h.expectStatus(await h.post(ctx, '/api/messages/edit', owner.token, { id: m.id, body: 'düz metin' }), 400, 'bad_body')
    } finally {
      await ctx.cleanup()
    }
  })

  it('mesajlar ve düzenlemeler yeniden başlatmadan sonra kalır', async () => {
    let ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const a = await h.sendMessage(ctx, owner.token, 1)
      const b = await h.sendMessage(ctx, owner.token, 1)
      const c = await h.sendMessage(ctx, owner.token, 2)
      const newBody = h.envelope()
      h.expectStatus(await h.post(ctx, '/api/messages/edit', owner.token, { id: a.id, body: newBody }), 200)
      h.expectStatus(await h.post(ctx, '/api/messages/delete', owner.token, { id: b.id }), 200)
      ctx = await ctx.restart()
      const list = await h.get(ctx, '/api/messages?channel=1', owner.token)
      h.expectStatus(list, 200)
      assert.equal(list.data.messages.length, 1)
      assert.equal(list.data.messages[0].id, a.id)
      assert.equal(list.data.messages[0].body, newBody)
      const other = await h.get(ctx, '/api/messages?channel=2', owner.token)
      assert.deepEqual(other.data.messages.map((m) => m.id), [c.id])
      // Mesaj kimlikleri yeniden kullanılmaz
      const d = await h.sendMessage(ctx, owner.token, 1)
      assert.equal(d.id, c.id + 1)
    } finally {
      await ctx.cleanup()
    }
  })

  it('sayfalama: before, limit ve hasMore', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const ids = []
      for (const i of h.times(7)) ids.push((await h.sendMessage(ctx, owner.token, 1)).id)
      await h.sendMessage(ctx, owner.token, 2)

      let page = await h.get(ctx, '/api/messages?channel=1&limit=3', owner.token)
      h.expectStatus(page, 200)
      assert.deepEqual(page.data.messages.map((m) => m.id), ids.slice(4))
      assert.equal(page.data.hasMore, true)
      page = await h.get(ctx, '/api/messages?channel=1&limit=3&before=' + ids[4], owner.token)
      assert.deepEqual(page.data.messages.map((m) => m.id), ids.slice(1, 4))
      assert.equal(page.data.hasMore, true)
      page = await h.get(ctx, '/api/messages?channel=1&limit=3&before=' + ids[1], owner.token)
      assert.deepEqual(page.data.messages.map((m) => m.id), ids.slice(0, 1))
      assert.equal(page.data.hasMore, false)

      page = await h.get(ctx, '/api/messages?channel=1', owner.token)
      assert.deepEqual(page.data.messages.map((m) => m.id), ids)
      assert.equal(page.data.hasMore, false)
      // limit 1..100 aralığına sıkıştırılır
      page = await h.get(ctx, '/api/messages?channel=1&limit=0', owner.token)
      assert.equal(page.data.messages.length, 1)
      page = await h.get(ctx, '/api/messages?channel=1&limit=5000', owner.token)
      assert.equal(page.data.messages.length, 7)
      h.expectStatus(await h.get(ctx, '/api/messages?channel=1&limit=abc', owner.token), 400, 'bad_request')
      h.expectStatus(await h.get(ctx, '/api/messages?channel=1&before=-3', owner.token), 400, 'bad_request')
    } finally {
      await ctx.cleanup()
    }
  })

  it('sayfalama: around ile mesajın etrafı, hasMore ve hasNewer, sınırlar ve yetki', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const ayse = await h.addUser(ctx, owner.token, 'ayse')
      const mehmet = await h.addUser(ctx, owner.token, 'mehmet')
      const ali = await h.addUser(ctx, owner.token, 'ali')
      const ids = []
      const others = []
      for (const i of h.times(20)) {
        ids.push((await h.sendMessage(ctx, owner.token, 1)).id)
        if (i % 5 === 0) others.push((await h.sendMessage(ctx, owner.token, 2)).id)
      }
      async function around (query) {
        const res = await h.get(ctx, '/api/messages?channel=1&' + query, owner.token)
        h.expectStatus(res, 200)
        assert.deepEqual(Object.keys(res.data).sort(), ['hasMore', 'hasNewer', 'messages'])
        return { ids: res.data.messages.map((m) => m.id), hasMore: res.data.hasMore, hasNewer: res.data.hasNewer }
      }
      // Ortada: limit/2 eski mesaj, mesajın kendisi ve kalan yeni mesajlar
      assert.deepEqual(await around('around=' + ids[10] + '&limit=6'), { ids: ids.slice(7, 13), hasMore: true, hasNewer: true })
      assert.deepEqual(await around('limit=5&around=' + ids[10]), { ids: ids.slice(8, 13), hasMore: true, hasNewer: true })
      assert.deepEqual(await around('around=' + ids[10] + '&limit=2'), { ids: ids.slice(9, 11), hasMore: true, hasNewer: true })
      assert.deepEqual(await around('around=' + ids[10] + '&limit=1'), { ids: [ids[10]], hasMore: true, hasNewer: true })
      // Başa ve sona yakınken pencere öbür yöne kayar, sayfa yine limit kadardır
      assert.deepEqual(await around('around=' + ids[1] + '&limit=6'), { ids: ids.slice(0, 6), hasMore: false, hasNewer: true })
      assert.deepEqual(await around('around=' + ids[0] + '&limit=6'), { ids: ids.slice(0, 6), hasMore: false, hasNewer: true })
      assert.deepEqual(await around('around=' + ids[19] + '&limit=6'), { ids: ids.slice(14), hasMore: true, hasNewer: false })
      assert.deepEqual(await around('around=' + ids[17] + '&limit=6'), { ids: ids.slice(14), hasMore: true, hasNewer: false })
      // Varsayılan limit 50, üst sınır 100, 0 en az 1 sayılır
      assert.deepEqual(await around('around=' + ids[10]), { ids, hasMore: false, hasNewer: false })
      assert.deepEqual(await around('around=' + ids[10] + '&limit=5000'), { ids, hasMore: false, hasNewer: false })
      assert.deepEqual(await around('around=' + ids[10] + '&limit=0'), { ids: [ids[10]], hasMore: true, hasNewer: true })
      // Başka kanalın mesajı veya silinmiş mesaj: aynı konumun (kimliği ondan büyük ilk mesajın) etrafı
      assert.ok(others[2] > ids[10] && others[2] < ids[11])
      assert.deepEqual(await around('around=' + others[2] + '&limit=2'), { ids: ids.slice(10, 12), hasMore: true, hasNewer: true })
      h.expectStatus(await h.post(ctx, '/api/messages/delete', owner.token, { id: ids[10] }), 200)
      assert.deepEqual(await around('around=' + ids[10] + '&limit=4'), { ids: [ids[8], ids[9], ids[11], ids[12]], hasMore: true, hasNewer: true })
      // Kanalın ilk mesajından küçük ve son mesajından büyük kimlikler
      assert.deepEqual(await around('around=0&limit=2'), { ids: ids.slice(0, 2), hasMore: false, hasNewer: true })
      assert.deepEqual(await around('around=999999&limit=2'), { ids: ids.slice(18), hasMore: true, hasNewer: false })
      // Boş kanal
      const created = await h.post(ctx, '/api/channels/create', owner.token, { name: 'bos', type: 'text' })
      const empty = await h.get(ctx, '/api/messages?channel=' + created.data.channel.id + '&around=1', owner.token)
      assert.deepEqual(empty.data, { messages: [], hasMore: false, hasNewer: false })

      // before ve varsayılan yanıt değişmedi, boş around verilmemiş sayılır
      const page = await h.get(ctx, '/api/messages?channel=1&limit=3&before=' + ids[5], owner.token)
      assert.deepEqual(Object.keys(page.data).sort(), ['hasMore', 'messages'])
      assert.deepEqual(page.data.messages.map((m) => m.id), ids.slice(2, 5))
      const latest = await h.get(ctx, '/api/messages?channel=1&limit=2&around=', owner.token)
      assert.deepEqual(latest.data, { messages: latest.data.messages, hasMore: true })
      assert.deepEqual(latest.data.messages.map((m) => m.id), ids.slice(18))
      // Geçersiz around ve before ile birlikte kullanım
      for (const q of ['around=-1', 'around=abc', 'around=1.5', 'around=1e3', 'around=' + '9'.repeat(16),
        'around=' + ids[3] + '&before=' + ids[5], 'before=' + ids[5] + '&around=' + ids[3], 'before=x&around=' + ids[3]]) {
        h.expectStatus(await h.get(ctx, '/api/messages?channel=1&' + q, owner.token), 400, 'bad_request')
      }

      // Yetki: özel konuşmada yalnızca iki üye, ses kanalı ve olmayan kanal bulunamaz
      const dm = await h.post(ctx, '/api/dms/open', ayse.token, { userId: mehmet.user.id })
      h.expectStatus(dm, 200)
      const dmId = dm.data.dm.id
      const dmIds = []
      for (const i of h.times(4)) {
        const sent = await h.post(ctx, '/api/messages', ayse.token, { channelId: dmId, body: h.dmEnvelope(i) })
        h.expectStatus(sent, 200)
        dmIds.push(sent.data.message.id)
      }
      for (const who of [ayse, mehmet]) {
        const res = await h.get(ctx, '/api/messages?channel=' + dmId + '&around=' + dmIds[2] + '&limit=2', who.token)
        h.expectStatus(res, 200)
        assert.deepEqual(res.data.messages.map((m) => m.id), dmIds.slice(1, 3))
        assert.equal(res.data.hasMore, true)
        assert.equal(res.data.hasNewer, true)
      }
      for (const who of [owner, ali]) {
        h.expectStatus(await h.get(ctx, '/api/messages?channel=' + dmId + '&around=' + dmIds[2], who.token), 404, 'channel_not_found')
      }
      h.expectStatus(await h.get(ctx, '/api/messages?channel=3&around=1', owner.token), 404, 'channel_not_found')
      h.expectStatus(await h.get(ctx, '/api/messages?channel=999&around=1', owner.token), 404, 'channel_not_found')
      h.expectStatus(await h.get(ctx, '/api/messages?around=1', owner.token), 404, 'channel_not_found')
    } finally {
      await ctx.cleanup()
    }
  })

  it('kanal başına üst sınır aşılınca en eski mesaj düşer ve del olayı yayılır', async () => {
    const ctx = await h.startServer({ maxMessagesPerChannel: 3 })
    try {
      const owner = await h.setupOwner(ctx)
      const ids = []
      for (const i of h.times(3)) ids.push((await h.sendMessage(ctx, owner.token, 1)).id)
      const st = await h.stateOf(ctx, owner.token)
      const p = h.poller(ctx, owner.token, st)
      const fourth = await h.sendMessage(ctx, owner.token, 1)
      const res = await p.poll()
      const types = res.data.events.map((e) => e.type + ':' + (e.message ? e.message.id : e.messageId))
      assert.deepEqual(types, ['msg:' + fourth.id, 'del:' + ids[0]])
      const list = await h.get(ctx, '/api/messages?channel=1', owner.token)
      assert.deepEqual(list.data.messages.map((m) => m.id), [ids[1], ids[2], fourth.id])
    } finally {
      await ctx.cleanup()
    }
  })

  it('mesaj hız sınırı (gönderme ve düzenleme birlikte)', async () => {
    const ctx = await h.startServer({ messageLimit: 3, messageWindowMs: 60000 })
    try {
      const owner = await h.setupOwner(ctx)
      const m = await h.sendMessage(ctx, owner.token, 1)
      await h.sendMessage(ctx, owner.token, 1)
      h.expectStatus(await h.post(ctx, '/api/messages/edit', owner.token, { id: m.id, body: h.envelope() }), 200)
      const limited = await h.post(ctx, '/api/messages', owner.token, { channelId: 1, body: h.envelope() })
      h.expectStatus(limited, 429, 'rate_limited')
      assert.ok(Number(limited.headers['retry-after']) >= 1)
      h.expectStatus(await h.post(ctx, '/api/messages/edit', owner.token, { id: m.id, body: h.envelope() }), 429, 'rate_limited')
      // Silme sınırlanmaz
      h.expectStatus(await h.post(ctx, '/api/messages/delete', owner.token, { id: m.id }), 200)
    } finally {
      await ctx.cleanup()
    }
  })
})
