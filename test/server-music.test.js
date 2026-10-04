'use strict'

// Telsiz DJ sunucu tarafı (SPEC-V2 Ek L2.6, L2.7, L2.10): poll ve /api/state alanları (now, muv, music),
// POST /api/music/state (CAS, yetki, zarf deseni ve sınırı, gövde sınırı, hız sınırı, sunucu onaylı yazar
// bilgisi), uzun poll'un müzik sürümüyle uyanması, boşalan odanın durumunun silinmesi, sunucu ayarı
// (meta.music, yalnızca sahip değiştirir), DJ kapalıyken yazım reddi ve durumun diske yazılmaması.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const h = require('./server-yardimci')

const VOICE = 3
const VOICE2 = 4
const TEXT = 1
const ENV_MAX = 131072

// Tam olarak n karakterlik, sunucunun kabul ettiği biçimde zarf (n en az 77)
function envOfLength (n) {
  const head = '1.' + crypto.randomBytes(8).toString('hex') + '.' + crypto.randomBytes(24).toString('base64url') + '.'
  const tail = crypto.randomBytes(Math.ceil((n - head.length) * 3 / 4) + 3).toString('base64url').slice(0, n - head.length)
  return head + tail
}

async function room (options) {
  const ctx = await h.startServer(options)
  const owner = await h.setupOwner(ctx)
  const ayse = await h.addUser(ctx, owner.token, 'ayse')
  const mehmet = await h.addUser(ctx, owner.token, 'mehmet')
  return { ctx, owner, ayse, mehmet }
}

function join (ctx, token, channelId) {
  return h.post(ctx, '/api/voice/join', token, { channelId })
}

function write (ctx, token, channelId, expect, env) {
  return h.post(ctx, '/api/music/state', token, { channelId, expect, env: env === undefined ? h.envelope() : env })
}

function expectNow (res) {
  assert.equal(typeof res.data.now, 'number', res.text)
  assert.ok(Math.abs(res.data.now - Date.now()) < 5000, res.text)
}

describe('Telsiz DJ: durum alanları ve yazım', () => {
  it('/api/state ve poll now, muv ve müzik haritasını verir, meta.music varsayılan olarak açıktır', async () => {
    const { ctx, owner } = await room()
    try {
      const st = await h.stateOf(ctx, owner.token)
      assert.equal(typeof st.muv, 'number')
      assert.deepEqual(st.music, {})
      assert.ok(Math.abs(st.now - Date.now()) < 5000)
      assert.deepEqual(st.meta.music, { enabled: true, youtube: true, restricted: false })
      // muv sorgusu sunucununkinden farklıysa poll hemen müzik haritasıyla döner
      const stale = await h.get(ctx, '/api/poll?since=' + st.seq + '&mv=' + st.metaVersion + '&pmv=' + st.pmv + '&muv=0&sig=0&boot=' + st.boot, owner.token)
      h.expectStatus(stale, 200)
      assert.deepEqual(stale.data.music, {})
      assert.equal(stale.data.muv, st.muv)
      expectNow(stale)
      // Resync yanıtı da müzik haritasını taşır
      const resync = await h.get(ctx, '/api/poll?since=0&mv=0&sig=0&boot=0000000000000000', owner.token)
      assert.equal(resync.data.resync, true)
      assert.deepEqual(resync.data.music, {})
      assert.equal(resync.data.muv, st.muv)
      expectNow(resync)
    } finally {
      await ctx.cleanup()
    }
  })

  it('CAS: 200 { v, at, now }, eski sürüme 409 ve güncel kayıt, boş odada 409 v 0, yazan sunucuca bildirilir', async () => {
    const { ctx, owner, ayse, mehmet } = await room()
    try {
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      h.expectStatus(await join(ctx, mehmet.token, VOICE), 200)
      const env1 = h.envelope()
      // Boş odaya expect 0 dışında yazılamaz
      const empty = await write(ctx, ayse.token, VOICE, 5, env1)
      h.expectStatus(empty, 409)
      assert.equal(empty.data.v, 0)
      assert.equal(empty.data.at, 0)
      assert.equal(empty.data.by, null)
      assert.equal(empty.data.env, null)
      expectNow(empty)

      const first = await write(ctx, ayse.token, VOICE, 0, env1)
      h.expectStatus(first, 200)
      assert.deepEqual(Object.keys(first.data).sort(), ['at', 'now', 'v'])
      assert.ok(first.data.v >= 1)
      assert.ok(Math.abs(first.data.at - Date.now()) < 5000)
      expectNow(first)

      // Eşzamanlı yazımda eski sürümle gelen 409 alır, güncel kayıt yazanıyla döner
      const env2 = h.envelope()
      const second = await write(ctx, mehmet.token, VOICE, first.data.v, env2)
      h.expectStatus(second, 200)
      assert.ok(second.data.v > first.data.v)
      const lost = await write(ctx, ayse.token, VOICE, first.data.v, h.envelope())
      h.expectStatus(lost, 409)
      assert.equal(lost.data.v, second.data.v)
      assert.equal(lost.data.at, second.data.at)
      assert.equal(lost.data.by, mehmet.user.id)
      assert.equal(lost.data.env, env2)
      assert.equal(lost.data.since, 0)
      assert.deepEqual(lost.data.writes, [{ v: first.data.v, by: ayse.user.id }, { v: second.data.v, by: mehmet.user.id }])
      assert.deepEqual(lost.data.authors, [ayse.user.id, mehmet.user.id].sort((a, b) => a - b))
      expectNow(lost)

      // Poll haritası aynı kaydı verir (odada olmayan da görür)
      const st = await h.stateOf(ctx, owner.token)
      assert.deepEqual(st.music, {
        [String(VOICE)]: {
          v: second.data.v,
          at: second.data.at,
          by: mehmet.user.id,
          env: env2,
          since: 0,
          writes: [{ v: first.data.v, by: ayse.user.id }, { v: second.data.v, by: mehmet.user.id }],
          authors: [ayse.user.id, mehmet.user.id].sort((a, b) => a - b)
        }
      })
      // Gövdedeki başka alanlar yazarı değiştiremez
      const spoof = await h.post(ctx, '/api/music/state', ayse.token, { channelId: VOICE, expect: second.data.v, env: h.envelope(), by: owner.user.id })
      h.expectStatus(spoof, 200)
      assert.equal((await h.stateOf(ctx, owner.token)).music[String(VOICE)].by, ayse.user.id)
    } finally {
      await ctx.cleanup()
    }
  })

  it('sürüm sunucu genelinde tek sayaçtır: odalar arasında ve oda silinip yeniden oluşunca azalmaz, yeniden kullanılmaz', async () => {
    const { ctx, owner, ayse, mehmet } = await room()
    try {
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      h.expectStatus(await join(ctx, mehmet.token, VOICE2), 200)
      const seen = []
      const a1 = await write(ctx, ayse.token, VOICE, 0)
      seen.push(a1.data.v)
      const m1 = await write(ctx, mehmet.token, VOICE2, 0)
      seen.push(m1.data.v)
      const a2 = await write(ctx, ayse.token, VOICE, a1.data.v)
      seen.push(a2.data.v)
      // Kanal silinince durumu kalkar
      h.expectStatus(await h.post(ctx, '/api/channels/delete', owner.token, { id: VOICE2 }), 200)
      let st = await h.stateOf(ctx, owner.token)
      assert.deepEqual(Object.keys(st.music), [String(VOICE)])
      // Yeni ses kanalı: ilk yazım yine artan sayaçtan
      const created = await h.post(ctx, '/api/channels/create', owner.token, { name: 'Ses 3', type: 'voice' })
      h.expectStatus(created, 200)
      const newId = created.data.channel.id
      h.expectStatus(await join(ctx, mehmet.token, newId), 200)
      const m2 = await write(ctx, mehmet.token, newId, 0)
      h.expectStatus(m2, 200)
      seen.push(m2.data.v)
      assert.ok(seen.every((v, i) => i === 0 || v > seen[i - 1]), JSON.stringify(seen))
      st = await h.stateOf(ctx, owner.token)
      assert.equal(st.music[String(newId)].since, 0)
      assert.deepEqual(st.music[String(newId)].writes, [{ v: m2.data.v, by: mehmet.user.id }])
    } finally {
      await ctx.cleanup()
    }
  })

  it('yetki ve doğrulama: 401, 404, 403 not_in_voice, 400 bad_request ve bad_envelope, 413, her hata now taşır', async () => {
    const { ctx, ayse, mehmet } = await room()
    try {
      // Oturum yok
      const anon = await h.request(ctx, 'POST', '/api/music/state', { body: { channelId: VOICE, expect: 0, env: h.envelope() } })
      h.expectStatus(anon, 401, 'invalid_token')
      // Seste değil
      let res = await write(ctx, ayse.token, VOICE, 0)
      h.expectStatus(res, 403, 'not_in_voice')
      expectNow(res)
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      h.expectStatus(await join(ctx, mehmet.token, VOICE2), 200)
      // Başka ses odasında olan bu odaya yazamaz
      h.expectStatus(await write(ctx, mehmet.token, VOICE, 0), 403, 'not_in_voice')
      // Kanal yok, yazı kanalı, sayı olmayan kimlik
      for (const channelId of [99, TEXT, String(VOICE), null, 0, -3, 3.5]) {
        res = await write(ctx, ayse.token, channelId, 0)
        h.expectStatus(res, 404, 'channel_not_found')
        expectNow(res)
      }
      // expect
      for (const expect of [undefined, -1, 1.5, '0', null, Number.MAX_SAFE_INTEGER + 2]) {
        res = await h.post(ctx, '/api/music/state', ayse.token, { channelId: VOICE, expect, env: h.envelope() })
        h.expectStatus(res, 400, 'bad_request')
        expectNow(res)
      }
      // Zarf biçimi
      for (const env of [42, null, '', 'düz metin', '2.' + 'a'.repeat(32) + '.' + 'b'.repeat(30), h.envelope().replace('1.', '9.'), '<script>']) {
        res = await write(ctx, ayse.token, VOICE, 0, env)
        h.expectStatus(res, 400, 'bad_envelope')
        expectNow(res)
      }
      // Zarf üst sınırı: tam 131072 karakter kabul, bir fazlası 413 (gövde genel 65536 bayt sınırını aşar)
      const max = envOfLength(ENV_MAX)
      assert.equal(max.length, ENV_MAX)
      res = await write(ctx, ayse.token, VOICE, 0, max)
      h.expectStatus(res, 200)
      const v = res.data.v
      res = await write(ctx, ayse.token, VOICE, v, envOfLength(ENV_MAX + 1))
      h.expectStatus(res, 413, 'too_large')
      expectNow(res)
      // Gövde 140000 baytı aşarsa okunmadan 413
      const huge = await h.request(ctx, 'POST', '/api/music/state', { token: ayse.token, body: JSON.stringify({ channelId: VOICE, expect: v, env: 'x'.repeat(140001) }) })
      h.expectStatus(huge, 413, 'too_large')
      // Başka uçların gövde sınırı değişmedi
      const bigTyping = await h.request(ctx, 'POST', '/api/typing', { token: ayse.token, body: JSON.stringify({ channelId: TEXT, typing: true, pad: 'x'.repeat(70000) }) })
      h.expectStatus(bigTyping, 413, 'too_large')
      // Bozuk JSON
      h.expectStatus(await h.request(ctx, 'POST', '/api/music/state', { token: ayse.token, body: '{bozuk' }), 400, 'bad_request')
      // Durum değişmedi
      const st = await h.stateOf(ctx, ayse.token)
      assert.equal(st.music[String(VOICE)].v, v)
      assert.equal(st.music[String(VOICE)].env, max)
    } finally {
      await ctx.cleanup()
    }
  })

  it('kullanıcının başka bir oturumu seste ise o cihazdan da yazabilir, sesten çıkınca yazamaz', async () => {
    const { ctx, ayse } = await room()
    try {
      const phone = await h.login(ctx, 'ayse')
      h.expectStatus(phone, 200)
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      const res = await write(ctx, phone.data.token, VOICE, 0)
      h.expectStatus(res, 200)
      const st = await h.stateOf(ctx, ayse.token)
      assert.equal(st.music[String(VOICE)].by, ayse.user.id)
      h.expectStatus(await h.post(ctx, '/api/voice/leave', ayse.token), 200)
      h.expectStatus(await write(ctx, phone.data.token, VOICE, res.data.v), 403, 'not_in_voice')
    } finally {
      await ctx.cleanup()
    }
  })

  it('hız sınırı: kullanıcı başına, Retry-After ile 429, geçersiz istekler sayılmaz', async () => {
    const { ctx, ayse, mehmet } = await room({ musicLimit: 3, musicWindowMs: 60000 })
    try {
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      h.expectStatus(await join(ctx, mehmet.token, VOICE), 200)
      // Biçimi geçersiz istek hız sayacını tüketmez
      h.expectStatus(await write(ctx, ayse.token, VOICE, 0, 'bozuk'), 400, 'bad_envelope')
      let v = 0
      for (const i of h.times(3)) {
        void i
        const res = await write(ctx, ayse.token, VOICE, v)
        h.expectStatus(res, 200)
        v = res.data.v
      }
      const limited = await write(ctx, ayse.token, VOICE, v)
      h.expectStatus(limited, 429, 'rate_limited')
      assert.ok(Number(limited.headers['retry-after']) >= 1)
      expectNow(limited)
      // Çakışan yazım da sayılır (çakışmalar sınırsız tekrar edilemez)
      h.expectStatus(await write(ctx, mehmet.token, VOICE, 0), 409)
      // Başka kullanıcının sınırı ayrıdır
      h.expectStatus(await write(ctx, mehmet.token, VOICE, v), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('hata metinleri iki dildedir', async () => {
    const { ctx, owner, ayse } = await room()
    try {
      const tr = await h.request(ctx, 'POST', '/api/music/state', { token: ayse.token, headers: { 'accept-language': 'tr' }, body: { channelId: VOICE, expect: 0, env: h.envelope() } })
      h.expectStatus(tr, 403, 'not_in_voice')
      assert.match(tr.data.error, /ses odas/)
      const en = await h.request(ctx, 'POST', '/api/music/state', { token: ayse.token, headers: { 'accept-language': 'en' }, body: { channelId: VOICE, expect: 0, env: h.envelope() } })
      assert.match(en.data.error, /voice room/)
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { music: { enabled: false } }), 200)
      const off = await h.request(ctx, 'POST', '/api/music/state', { token: ayse.token, headers: { 'accept-language': 'tr' }, body: { channelId: VOICE, expect: 0, env: h.envelope() } })
      h.expectStatus(off, 403, 'dj_disabled')
      assert.equal(off.data.error, 'Telsiz DJ bu frekansta kapalı.')
      const offEn = await h.request(ctx, 'POST', '/api/music/state', { token: ayse.token, headers: { 'accept-language': 'en' }, body: { channelId: VOICE, expect: 0, env: h.envelope() } })
      assert.equal(offEn.data.error, 'Telsiz DJ is turned off on this frequency.')
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { music: { enabled: true } }), 200)
      const bad = await h.request(ctx, 'POST', '/api/music/state', { token: ayse.token, headers: { 'accept-language': 'en' }, body: { channelId: VOICE, expect: 0, env: 'x' } })
      h.expectStatus(bad, 400, 'bad_envelope')
      assert.equal(bad.data.error, 'The music state is invalid.')
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('Telsiz DJ: yazar geçmişi', () => {
  it('writes son 32 yazımı, since ondan öncesini, authors odanın bu oturumunda yazmış herkesi verir', async () => {
    const { ctx, owner, ayse, mehmet } = await room()
    try {
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      h.expectStatus(await join(ctx, mehmet.token, VOICE), 200)
      const versions = []
      let v = 0
      for (const i of h.times(40)) {
        const token = i === 0 ? mehmet.token : ayse.token
        const res = await write(ctx, token, VOICE, v)
        h.expectStatus(res, 200)
        v = res.data.v
        versions.push(v)
      }
      const rec = (await h.stateOf(ctx, owner.token)).music[String(VOICE)]
      assert.equal(rec.writes.length, 32)
      assert.deepEqual(rec.writes.map((w) => w.v), versions.slice(8))
      assert.equal(rec.since, versions[7])
      assert.ok(rec.writes.every((w) => w.by === ayse.user.id))
      // Mehmet'in yazımı geçmişten düştü ama odanın yazarlarında kalır
      assert.deepEqual(rec.authors, [ayse.user.id, mehmet.user.id].sort((a, b) => a - b))
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('Telsiz DJ: uzun poll', () => {
  it('muv izleyen poll müzik değişince uyanır, izlemeyen uyanmaz, güncel muv ile bekler', async () => {
    const { ctx, owner, ayse } = await room({ pollTimeoutMs: 1500 })
    try {
      const st = await h.stateOf(ctx, owner.token)
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      // Ses katılımının meta değişikliği önce tüketilir
      const st2 = await h.stateOf(ctx, owner.token)
      const base = '/api/poll?since=' + st2.seq + '&mv=' + st2.metaVersion + '&pmv=' + st2.pmv + '&sig=0&boot=' + st.boot
      // Güncel muv ile poll bekler, müzik yazımında uyanır
      let waiting = h.nextRequest(ctx.server, '/api/poll')
      const started = Date.now()
      const tracked = h.get(ctx, base + '&muv=' + st2.muv, owner.token)
      await waiting
      await h.sleep(50)
      const env = h.envelope()
      const res = await write(ctx, ayse.token, VOICE, 0, env)
      h.expectStatus(res, 200)
      const woke = await tracked
      assert.ok(Date.now() - started < 1400, 'poll müzik yazımında uyanmalı')
      assert.ok(woke.data.muv > st2.muv)
      assert.equal(woke.data.music[String(VOICE)].env, env)
      assert.equal(woke.data.music[String(VOICE)].by, ayse.user.id)
      expectNow(woke)
      // muv vermeyen poll müzik yazımıyla uyanmaz (zaman aşımına kadar bekler, harita gelmez)
      waiting = h.nextRequest(ctx.server, '/api/poll')
      const started2 = Date.now()
      const untracked = h.get(ctx, base, owner.token)
      await waiting
      await h.sleep(50)
      h.expectStatus(await write(ctx, ayse.token, VOICE, res.data.v), 200)
      const quiet = await untracked
      assert.ok(Date.now() - started2 >= 1300, 'muv vermeyen poll uyanmamalı')
      assert.equal(quiet.data.music, undefined)
      assert.equal(typeof quiet.data.muv, 'number')
      expectNow(quiet)
      // Eski muv hemen yanıtlanır
      const stale = await h.get(ctx, base + '&muv=' + woke.data.muv, owner.token)
      assert.ok(stale.data.muv > woke.data.muv)
      assert.ok(stale.data.music[String(VOICE)])
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('Telsiz DJ: boşalan oda ve bellek', () => {
  it('oda boşalınca durum ayarlanan süre sonra silinir, muv artar, oda yeniden dolarsa süre sıfırlanır', async () => {
    const { ctx, owner, ayse } = await room({ musicIdleMs: 400 })
    try {
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      h.expectStatus(await write(ctx, ayse.token, VOICE, 0), 200)
      const before = await h.stateOf(ctx, owner.token)
      assert.ok(before.music[String(VOICE)])
      // Odada biri varken silinmez
      await h.sleep(600)
      assert.ok((await h.stateOf(ctx, owner.token)).music[String(VOICE)])
      // Boşalır, süre dolmadan geri gelirse kalır
      h.expectStatus(await h.post(ctx, '/api/voice/leave', ayse.token), 200)
      await h.sleep(200)
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      await h.sleep(400)
      assert.ok((await h.stateOf(ctx, owner.token)).music[String(VOICE)])
      // Boşalır ve süre dolar
      h.expectStatus(await h.post(ctx, '/api/voice/leave', ayse.token), 200)
      const left = Date.now()
      const gone = await h.waitFor(async () => {
        const st = await h.stateOf(ctx, owner.token)
        return st.music[String(VOICE)] ? null : st
      }, { timeout: 3000, label: 'müzik durumu silinmeli' })
      assert.ok(Date.now() - left >= 380)
      assert.ok(gone.muv > before.muv)
      assert.equal(ctx.server.stats().musicRooms, 0)
    } finally {
      await ctx.cleanup()
    }
  })

  it('müzik durumu diske yazılmaz, sunucu yeniden başlayınca kaybolur ve boot değişir', async () => {
    const { ctx, owner, ayse } = await room()
    let next = null
    try {
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      const env = h.envelope(400)
      h.expectStatus(await write(ctx, ayse.token, VOICE, 0, env), 200)
      const st = await h.stateOf(ctx, owner.token)
      await ctx.server.flush()
      const files = []
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) walk(full)
          else files.push(full)
        }
      }
      walk(ctx.dataDir)
      for (const file of files) assert.ok(!fs.readFileSync(file).includes(env.slice(-40)), file)
      next = await ctx.restart()
      const after = await h.stateOf(next, owner.token)
      assert.notEqual(after.boot, st.boot)
      assert.deepEqual(after.music, {})
    } finally {
      if (next) await next.cleanup()
      else await ctx.cleanup()
    }
  })
})

describe('Telsiz DJ: sunucu ayarı', () => {
  it('yalnızca sahip değiştirir, meta.music yayımlanır ve kalıcıdır, DJ kapalıyken yazım 403 dj_disabled', async () => {
    const { ctx, owner, ayse } = await room()
    let next = null
    try {
      await h.makeAdmin(ctx, owner.token, ayse.user.id)
      // Yönetici ve üye değiştiremez
      h.expectStatus(await h.post(ctx, '/api/settings', ayse.token, { music: { enabled: false } }), 403, 'forbidden')
      // Geçersiz gövdeler
      for (const music of [null, true, [], {}, { enabled: 'hayir' }, { youtube: 0 }, { enabled: false, other: true }]) {
        h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { music }), 400, 'bad_request')
      }
      let meta = (await h.stateOf(ctx, owner.token)).meta
      assert.deepEqual(meta.music, { enabled: true, youtube: true, restricted: false })

      // YouTube kapalı: yalnızca meta (içerik sunucuya görünmez, istemciler uygular), yazım sürer
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      const st0 = await h.stateOf(ctx, ayse.token)
      const p = h.poller(ctx, ayse.token, st0)
      const waiting = h.nextRequest(ctx.server, '/api/poll')
      const pending = p.poll()
      await waiting
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { music: { youtube: false } }), 200)
      const woke = await pending
      assert.deepEqual(woke.data.meta.music, { enabled: true, youtube: false, restricted: false })
      const w1 = await write(ctx, ayse.token, VOICE, 0)
      h.expectStatus(w1, 200)

      // DJ kapalı: yazım 403, mevcut durum haritada kalır
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { music: { enabled: false } }), 200)
      meta = (await h.stateOf(ctx, owner.token)).meta
      assert.deepEqual(meta.music, { enabled: false, youtube: false, restricted: false })
      const off = await write(ctx, ayse.token, VOICE, w1.data.v)
      h.expectStatus(off, 403, 'dj_disabled')
      expectNow(off)

      // Diğer ayarlarla birlikte gönderilebilir, kalıcıdır
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { serverName: 'Yeni ad', music: { youtube: true } }), 200)
      await ctx.server.flush()
      const disk = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'state.json'), 'utf8'))
      assert.deepEqual(disk.music, { enabled: false, youtube: true, restricted: false })
      next = await ctx.restart()
      meta = (await h.stateOf(next, owner.token)).meta
      assert.deepEqual(meta.music, { enabled: false, youtube: true, restricted: false })
      assert.equal(meta.serverName, 'Yeni ad')
      h.expectStatus(await h.post(next, '/api/settings', owner.token, { music: { enabled: true } }), 200)
      meta = (await h.stateOf(next, owner.token)).meta
      assert.deepEqual(meta.music, { enabled: true, youtube: true, restricted: false })
    } finally {
      if (next) await next.cleanup()
      else await ctx.cleanup()
    }
  })

  it('eski veri dosyasında ayar yoksa veya bozuksa varsayılan (açık) kullanılır', async () => {
    const ctx = await h.startServer()
    let next = null
    try {
      const owner = await h.setupOwner(ctx)
      await ctx.server.flush()
      await ctx.stop()
      const file = path.join(ctx.dataDir, 'state.json')
      const disk = JSON.parse(fs.readFileSync(file, 'utf8'))
      assert.deepEqual(disk.music, { enabled: true, youtube: true, restricted: false })
      disk.music = { enabled: 'evet' }
      fs.writeFileSync(file, JSON.stringify(disk))
      next = await h.startServer({}, ctx.root)
      assert.deepEqual((await h.stateOf(next, owner.token)).meta.music, { enabled: true, youtube: true, restricted: false })
      await next.stop()
      delete disk.music
      fs.writeFileSync(file, JSON.stringify(disk))
      next = await h.startServer({}, ctx.root)
      assert.deepEqual((await h.stateOf(next, owner.token)).meta.music, { enabled: true, youtube: true, restricted: false })
      await next.server.flush()
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).music, { enabled: true, youtube: true, restricted: false })
    } finally {
      if (next) await next.cleanup()
      else h.removeRoot(ctx.root)
    }
  })
})
