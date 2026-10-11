'use strict'

// İçerik şikâyeti (POST /api/reports, GET /api/reports, POST /api/reports/resolve): üye okuyabildiği bir mesajı
// (yazı odasında veya üyesi olduğu özel konuşmada) ya da bir kişiyi frekans sahibine ve yöneticilere bildirir.
// Yetki (listeyi ve çözmeyi yalnızca sahip ve yöneticiler görür), alan denetimleri, aynı şikâyetin yinelenmemesi,
// kullanıcı başına saatlik hız sınırı, notun yalnızca grup anahtarıyla mühürlü zarf olarak kabul edilmesi ve
// diskte düz metin bulunmaması, özel görünümdeki açık şikâyet sayısı, kalıcılık ve 500 kayıt sınırı sınanır.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const i18n = require('../src/i18n')
const h = require('./server-yardimci')

const TEXT = 1
const PLAIN_NOTE = 'DUZ-METIN-SIKAYET-NOTU'

async function group (options) {
  const ctx = await h.startServer(options)
  const owner = await h.setupOwner(ctx)
  const admin = await h.addUser(ctx, owner.token, 'yonetici')
  const ayse = await h.addUser(ctx, owner.token, 'ayse')
  const mehmet = await h.addUser(ctx, owner.token, 'mehmet')
  const ali = await h.addUser(ctx, owner.token, 'ali')
  await h.makeAdmin(ctx, owner.token, admin.user.id)
  return { ctx, owner, admin, ayse, mehmet, ali }
}

function report (ctx, who, body) {
  return h.post(ctx, '/api/reports', who.token, body)
}

function messageReport (message, extra) {
  return Object.assign({ kind: 'message', channelId: message.channelId, messageId: message.id, targetUserId: message.authorId, reason: 'spam' }, extra || {})
}

function userReport (target, extra) {
  return Object.assign({ kind: 'user', targetUserId: target.user.id, reason: 'harassment' }, extra || {})
}

async function list (ctx, who) {
  const res = await h.get(ctx, '/api/reports', who.token)
  h.expectStatus(res, 200)
  return res.data.reports
}

function resolve (ctx, who, id) {
  return h.post(ctx, '/api/reports/resolve', who.token, { id })
}

async function openDm (ctx, from, to) {
  const res = await h.post(ctx, '/api/dms/open', from.token, { userId: to.user.id })
  h.expectStatus(res, 200)
  return res.data.dm.id
}

function statePath (ctx) {
  return path.join(ctx.dataDir, 'state.json')
}

function diskState (ctx) {
  return JSON.parse(fs.readFileSync(statePath(ctx), 'utf8'))
}

// Veri klasöründeki bütün dosyalarda aranan metin var mı
function dataDirHas (dir, text) {
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile() && fs.readFileSync(full).includes(text)) return true
    }
  }
  return false
}

describe('içerik şikâyeti', () => {
  it('üye yazı odasındaki mesajı bildirir, sahip ve yönetici listede görür, yönetici çözer', async () => {
    const { ctx, owner, admin, ayse, mehmet } = await group()
    try {
      const m = await h.sendMessage(ctx, mehmet.token, TEXT)
      const note = h.envelope(40)
      const res = await report(ctx, ayse, messageReport(m, { reason: 'harassment', note }))
      h.expectStatus(res, 200)
      assert.deepEqual(Object.keys(res.data).sort(), ['id', 'ok'])
      const id = res.data.id
      // Yanıt geldiğinde şikâyet diske yazılmıştır
      const saved = diskState(ctx).reports
      assert.equal(saved.length, 1)
      assert.equal(saved[0].note, note)

      // Aynı kişinin aynı mesaj için açık şikâyeti yinelenmez
      const again = await report(ctx, ayse, messageReport(m, { reason: 'spam' }))
      h.expectStatus(again, 200)
      assert.deepEqual(again.data, { ok: true, id, duplicate: true })

      for (const staff of [owner, admin]) {
        const reports = await list(ctx, staff)
        assert.equal(reports.length, 1)
        const r = reports[0]
        assert.deepEqual(r, {
          id,
          kind: 'message',
          reporterId: ayse.user.id,
          reporterName: 'ayse',
          targetUserId: mehmet.user.id,
          targetName: 'mehmet',
          channelId: TEXT,
          messageId: m.id,
          dm: false,
          reason: 'harassment',
          note,
          createdAt: r.createdAt,
          resolvedAt: null,
          resolvedBy: null,
          resolverName: ''
        })
        assert.equal(typeof r.createdAt, 'number')
      }

      // Liste ve çözme yalnızca sahip ve yöneticiler içindir
      for (const who of [ayse, mehmet]) {
        h.expectStatus(await h.get(ctx, '/api/reports', who.token), 403, 'forbidden')
        h.expectStatus(await resolve(ctx, who, id), 403, 'forbidden')
      }
      h.expectStatus(await h.get(ctx, '/api/reports', null), 401, 'invalid_token')
      h.expectStatus(await resolve(ctx, admin, 9999), 404, 'report_not_found')
      h.expectStatus(await resolve(ctx, admin, 'x'), 404, 'report_not_found')

      const done = await resolve(ctx, admin, id)
      h.expectStatus(done, 200)
      assert.equal(done.data.report.resolvedBy, admin.user.id)
      assert.equal(done.data.report.resolverName, 'yonetici')
      assert.equal(typeof done.data.report.resolvedAt, 'number')
      assert.equal(diskState(ctx).reports[0].resolvedBy, admin.user.id)
      // İkinci çözme ilk çözeni değiştirmez
      const twice = await resolve(ctx, owner, id)
      h.expectStatus(twice, 200)
      assert.equal(twice.data.report.resolvedBy, admin.user.id)
      assert.equal(twice.data.report.resolvedAt, done.data.report.resolvedAt)

      // Çözülen şikâyetten sonra aynı mesaj yeniden bildirilebilir
      const fresh = await report(ctx, ayse, messageReport(m))
      h.expectStatus(fresh, 200)
      assert.notEqual(fresh.data.id, id)
      const reports = await list(ctx, owner)
      assert.deepEqual(reports.map((r) => r.id), [fresh.data.id, id])
      assert.equal(reports[0].note, null)
    } finally {
      await ctx.cleanup()
    }
  })

  it('kişi şikâyeti ve alan denetimleri', async () => {
    const { ctx, owner, ayse, mehmet, ali } = await group()
    try {
      const m = await h.sendMessage(ctx, mehmet.token, TEXT)
      const own = await h.sendMessage(ctx, ayse.token, TEXT)
      h.expectStatus(await report(ctx, ayse, messageReport(m, { kind: 'mesaj' })), 400, 'bad_request')
      h.expectStatus(await report(ctx, ayse, messageReport(m, { reason: 'kotu' })), 400, 'bad_request')
      h.expectStatus(await report(ctx, ayse, { kind: 'message', reason: 'spam' }), 404, 'message_not_found')
      h.expectStatus(await report(ctx, ayse, messageReport(m, { messageId: 99999 })), 404, 'message_not_found')
      // Oda kimliği mesajın odası olmalı, hedef mesajın yazarı olmalı
      h.expectStatus(await report(ctx, ayse, messageReport(m, { channelId: TEXT + 1 })), 404, 'message_not_found')
      h.expectStatus(await report(ctx, ayse, messageReport(m, { targetUserId: ali.user.id })), 400, 'bad_request')
      // Kendi mesajı ve kendisi bildirilemez
      h.expectStatus(await report(ctx, ayse, messageReport(own)), 400, 'self')
      h.expectStatus(await report(ctx, ayse, userReport(ayse)), 400, 'self')
      // Kişi şikâyetinde mesaj alanları olmaz
      h.expectStatus(await report(ctx, ayse, userReport(mehmet, { messageId: m.id })), 400, 'bad_request')
      h.expectStatus(await report(ctx, ayse, userReport(mehmet, { channelId: TEXT })), 400, 'bad_request')
      h.expectStatus(await report(ctx, ayse, { kind: 'user', targetUserId: 9999, reason: 'spam' }), 404, 'user_not_found')
      h.expectStatus(await report(ctx, ayse, { kind: 'user', reason: 'spam' }), 404, 'user_not_found')

      const res = await report(ctx, ayse, userReport(mehmet, { channelId: null, messageId: null }))
      h.expectStatus(res, 200)
      const dup = await report(ctx, ayse, userReport(mehmet, { reason: 'other' }))
      assert.deepEqual(dup.data, { ok: true, id: res.data.id, duplicate: true })
      // Başka biri aynı kişiyi ayrıca bildirebilir
      const other = await report(ctx, ali, userReport(mehmet))
      h.expectStatus(other, 200)
      assert.notEqual(other.data.id, res.data.id)
      const reports = await list(ctx, owner)
      assert.deepEqual(reports.map((r) => [r.kind, r.reporterId, r.targetUserId, r.channelId, r.messageId, r.dm, r.reason]), [
        ['user', ali.user.id, mehmet.user.id, null, null, false, 'harassment'],
        ['user', ayse.user.id, mehmet.user.id, null, null, false, 'harassment']
      ])

      // Sahip de bildirilebilir (yöneticiler görür), silinmiş hesap bildirilemez ama eski şikâyette adı boş kalır
      h.expectStatus(await report(ctx, ali, userReport(owner, { reason: 'other' })), 200)
      h.expectStatus(await h.post(ctx, '/api/users/kick', owner.token, { userId: mehmet.user.id }), 200)
      h.expectStatus(await report(ctx, ali, userReport(mehmet)), 404, 'user_not_found')
      const after = await list(ctx, owner)
      assert.deepEqual(after.filter((r) => r.targetUserId === mehmet.user.id).map((r) => r.targetName), ['', ''])
      // Silinmiş yazarın mesajı yine bildirilebilir
      h.expectStatus(await report(ctx, ali, messageReport(m)), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('not yalnızca mühürlü zarf olarak kabul edilir, diskte düz metin bulunmaz', async () => {
    const { ctx, owner, ayse, mehmet } = await group()
    let running = true
    try {
      const m = await h.sendMessage(ctx, mehmet.token, TEXT)
      const bad = [PLAIN_NOTE, '', 42, { t: PLAIN_NOTE }, h.dmEnvelope(10), '1.' + PLAIN_NOTE, h.envelope(12001)]
      for (const note of bad) {
        h.expectStatus(await report(ctx, ayse, messageReport(m, { note })), 400, 'bad_report_note')
      }
      h.expectStatus(await report(ctx, ayse, userReport(mehmet, { note: PLAIN_NOTE })), 400, 'bad_report_note')
      assert.deepEqual(await list(ctx, owner), [])
      // Sınıra kadar büyük zarf kabul edilir (2000 karakterlik notun en kötü durumu sığar)
      const big = h.envelope(8000)
      assert.ok(big.length <= 12000 && big.length > 10000, String(big.length))
      const res = await report(ctx, ayse, messageReport(m, { note: big }))
      h.expectStatus(res, 200)
      const lang = await h.request(ctx, 'POST', '/api/reports', { token: ayse.token, body: userReport(mehmet, { note: PLAIN_NOTE }), headers: { 'accept-language': 'en' } })
      assert.equal(lang.data.error, i18n.t('en', 'errors.bad_report_note'))
      running = false
      await ctx.stop()
      assert.equal(dataDirHas(ctx.dataDir, PLAIN_NOTE), false)
      assert.equal(diskState(ctx).reports[0].note, big)
    } finally {
      if (running) await ctx.cleanup()
      else h.removeRoot(ctx.root)
    }
  })

  it('özel mesaj şikâyeti: yalnızca konuşmanın üyesi bildirir, kayıt özel konuşmayı gösterir', async () => {
    const { ctx, owner, ayse, mehmet, ali } = await group()
    try {
      const dmId = await openDm(ctx, ayse, mehmet)
      const res = await h.post(ctx, '/api/messages', mehmet.token, { channelId: dmId, body: h.dmEnvelope() })
      h.expectStatus(res, 200)
      const dm = res.data.message
      // Üye olmayan (sahip dahil) mesajı göremez ve bildiremez
      for (const who of [ali, owner]) {
        h.expectStatus(await report(ctx, who, messageReport(dm)), 404, 'message_not_found')
      }
      h.expectStatus(await report(ctx, mehmet, messageReport(dm)), 400, 'self')
      // Engel konmuş olsa da bildirilebilir
      h.expectStatus(await h.post(ctx, '/api/blocks/add', ayse.token, { userId: mehmet.user.id }), 200)
      const quoteNote = h.envelope(60)
      h.expectStatus(await report(ctx, ayse, messageReport(dm, { reason: 'illegal', note: quoteNote })), 200)
      const [r] = await list(ctx, owner)
      assert.equal(r.dm, true)
      assert.equal(r.channelId, dmId)
      assert.equal(r.messageId, dm.id)
      assert.equal(r.note, quoteNote)
    } finally {
      await ctx.cleanup()
    }
  })

  it('kullanıcı başına hız sınırı, yinelenen şikâyet sınırı harcamaz', async () => {
    const { ctx, ayse, mehmet, ali, owner } = await group({ reportLimit: 3 })
    try {
      const msgs = []
      for (const i of h.times(4)) msgs[i] = await h.sendMessage(ctx, mehmet.token, TEXT)
      for (const i of h.times(3)) h.expectStatus(await report(ctx, ayse, messageReport(msgs[i])), 200)
      // Yineleme sınırdayken de aynı yanıtı alır
      const dup = await report(ctx, ayse, messageReport(msgs[0]))
      h.expectStatus(dup, 200)
      assert.equal(dup.data.duplicate, true)
      const limited = await report(ctx, ayse, messageReport(msgs[3]))
      h.expectStatus(limited, 429, 'rate_limited')
      assert.ok(Number(limited.headers['retry-after']) >= 1)
      assert.equal(limited.data.error, i18n.t('en', 'detail.reportRate'))
      // Sınır kişiye özeldir
      h.expectStatus(await report(ctx, ali, messageReport(msgs[3])), 200)
      assert.equal((await list(ctx, owner)).length, 4)
    } finally {
      await ctx.cleanup()
    }
  })

  it('sahip ve yöneticilerin özel görünümünde açık şikâyet sayısı, üyelerde yok', async () => {
    const { ctx, owner, admin, ayse, mehmet } = await group()
    try {
      const priv = async (who) => (await h.stateOf(ctx, who.token)).private
      assert.equal((await priv(owner)).reports, 0)
      assert.equal((await priv(admin)).reports, 0)
      assert.equal('reports' in (await priv(ayse)), false)
      const st = await h.stateOf(ctx, owner.token)
      const p = h.poller(ctx, owner.token, st)
      const waiting = h.nextRequest(ctx.server, '/api/poll')
      const pending = p.poll()
      await waiting
      const res = await report(ctx, ayse, userReport(mehmet))
      h.expectStatus(res, 200)
      const woke = await pending
      h.expectStatus(woke, 200)
      assert.equal(woke.data.private.reports, 1)
      assert.equal((await priv(admin)).reports, 1)
      assert.equal('reports' in (await priv(ayse)), false)
      h.expectStatus(await resolve(ctx, admin, res.data.id), 200)
      assert.equal((await priv(owner)).reports, 0)
      // Yönetici olan üye sayıyı görür, üyeliğe dönen yönetici görmez
      h.expectStatus(await report(ctx, ayse, userReport(owner)), 200)
      await h.makeAdmin(ctx, owner.token, mehmet.user.id)
      assert.equal((await priv(mehmet)).reports, 1)
      h.expectStatus(await h.post(ctx, '/api/users/role', owner.token, { userId: mehmet.user.id, role: 'member' }), 200)
      assert.equal('reports' in (await priv(mehmet)), false)
    } finally {
      await ctx.cleanup()
    }
  })

  it('kalıcılık, bozuk kayıtların ayıklanması ve 500 kayıt sınırı', async () => {
    let ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const ayse = await h.addUser(ctx, owner.token, 'ayse')
      const mehmet = await h.addUser(ctx, owner.token, 'mehmet')
      const first = await report(ctx, ayse, userReport(mehmet))
      h.expectStatus(first, 200)
      ctx = await ctx.restart()
      const kept = await list(ctx, owner)
      assert.deepEqual(kept.map((r) => [r.id, r.kind, r.targetUserId]), [[first.data.id, 'user', mehmet.user.id]])

      // Diskteki listeye bozuk kayıtlar ve sınırı dolduran kayıtlar yazılır
      await ctx.stop()
      const disk = diskState(ctx)
      const base = disk.reports[0]
      const filler = []
      for (const i of h.times(499)) {
        filler.push(Object.assign({}, base, { id: 100 + i, createdAt: base.createdAt + i, resolvedAt: i === 5 ? base.createdAt + 10 : null, resolvedBy: i === 5 ? owner.user.id : null }))
      }
      disk.reports = [base].concat([
        { id: 'x' },
        Object.assign({}, base, { id: 7, note: PLAIN_NOTE }),
        Object.assign({}, base, { id: 8, kind: 'message', channelId: null }),
        Object.assign({}, base, { id: 9, resolvedAt: 5, resolvedBy: null }),
        Object.assign({}, base, { id: first.data.id })
      ], filler)
      disk.counters.report = 1
      fs.writeFileSync(statePath(ctx), JSON.stringify(disk))
      ctx = await h.startServer({}, ctx.root)
      assert.ok(ctx.log.lines.warn.some((line) => line === i18n.t('tr', 'log.invalidReports')), ctx.log.lines.warn.join('\n'))
      assert.equal((await list(ctx, owner)).length, 500)
      // Düzeltilen durum kısa bir gecikmeyle diske yazılır
      const loaded = await h.waitFor(() => {
        const d = diskState(ctx)
        return d.reports.length === 500 ? d : null
      }, { label: 'düzeltilen şikâyet listesi diske yazılmadı' })
      assert.equal(loaded.counters.report, 598)
      // Bozuk kayıt yeni durum dosyasında yok (önceki sürüm state.json.bak olarak durur)
      assert.equal(fs.readFileSync(statePath(ctx), 'utf8').includes(PLAIN_NOTE), false)

      // Liste doluyken en eski çözülmüş şikâyet düşer
      const ali = await h.addUser(ctx, owner.token, 'ali')
      const next = await report(ctx, ali, userReport(mehmet))
      h.expectStatus(next, 200)
      assert.equal(next.data.id, 599)
      let reports = await list(ctx, owner)
      assert.equal(reports.length, 500)
      assert.equal(reports.some((r) => r.id === 105), false)
      assert.equal(reports[0].id, 599)
      // Hepsi açıkken yeni şikâyet reddedilir
      const full = await report(ctx, ali, userReport(ayse))
      h.expectStatus(full, 503, 'reports_full')
      reports = await list(ctx, owner)
      assert.equal(reports.length, 500)
      // Çözülen yer açar
      h.expectStatus(await resolve(ctx, owner, 120), 200)
      h.expectStatus(await report(ctx, ali, userReport(ayse)), 200)
      assert.equal((await list(ctx, owner)).some((r) => r.id === 120), false)
    } finally {
      await ctx.cleanup()
    }
  })
})
