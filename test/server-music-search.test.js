'use strict'

// Telsiz DJ şarkı adıyla YouTube araması, sunucu tarafı (POST /api/music/search, istek 5): sahip ayarı (varsayılan
// kapalı, meta.music.search), DJ ve YouTube kaynağı şartı, oturum, ses odası ve kısıtlı kip denetimleri, sorgu
// doğrulaması, sonuçların temizlenmesi, kullanıcı başına hız sınırı, sunucu geneli 24 saatlik tavan, önbellek ve
// eşzamanlı aynı sorgunun tek aramaya inmesi, arayıcı hataları. Arama metninin günlüklere düşmediği, gerçek
// ayrıştırıcının sahte istek işleviyle çalıştığı, devre kesicinin günlüğe tek satır yazdığı, tavanın YouTube
// isteklerini saydığı ve sunucu kapanırken süren aramanın kesildiği de sınanır. Canlı YouTube'a hiçbir istek gitmez.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const h = require('./server-yardimci')
const i18n = require('../src/i18n')
const ys = require('../src/youtube-search')

const VOICE = 3
const TEXT = 1
const RAW_LOCKUP = fs.readFileSync(path.join(__dirname, 'fixtures', 'yt-arama', 'ornek-lockupviewmodel.json'), 'utf8')
// Aynı örneğin sonuç sayfası (HTML yedeği) biçimi
const PAGE_LOCKUP = '<html><script>var ytInitialData = ' + JSON.stringify(JSON.parse(RAW_LOCKUP)) + ';</script></html>'

// Sahte arayıcı: çağrılar kaydedilir, yanıtı reply verir (varsayılan iki sonuç)
function fakeSearch (reply) {
  const calls = []
  const fn = (query) => {
    calls.push(query)
    if (reply) return reply(query, calls.length)
    return Promise.resolve([
      { videoId: 'AAAAAAAAAA1', title: 'Sonuç: ' + query, channel: 'Kanal', durationS: 200 },
      { videoId: 'AAAAAAAAAA2', title: 'İkinci', channel: 'Kanal', durationS: 180 }
    ])
  }
  fn.calls = calls
  return fn
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

function search (ctx, token, q, channelId) {
  return h.post(ctx, '/api/music/search', token, { channelId: channelId === undefined ? VOICE : channelId, q })
}

async function enable (ctx, ownerToken, value) {
  h.expectStatus(await h.post(ctx, '/api/settings', ownerToken, { music: { search: value !== false } }), 200)
}

function allLogs (ctx) {
  const l = ctx.log.lines
  return l.info.concat(l.warn, l.error).join('\n')
}

describe('Telsiz DJ araması: sahip ayarı', () => {
  it('varsayılan kapalı (503 search_unavailable), yalnızca sahip açar, kalıcıdır, DJ veya YouTube kapalıyken kullanılamaz', async () => {
    const yt = fakeSearch()
    const { ctx, owner, ayse } = await room({ youtubeSearch: yt })
    let next = null
    try {
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      assert.equal((await h.stateOf(ctx, ayse.token)).meta.music.search, false)
      const off = await search(ctx, ayse.token, 'gece şarkısı')
      h.expectStatus(off, 503, 'search_unavailable')
      assert.equal(off.data.error, i18n.t('en', 'detail.musicSearchOff'))
      const offTr = await h.request(ctx, 'POST', '/api/music/search', { token: ayse.token, headers: { 'accept-language': 'tr' }, body: { channelId: VOICE, q: 'gece' } })
      assert.equal(offTr.data.error, 'Şarkı adıyla arama bu sunucuda kapalı. YouTube bağlantısını yapıştırın.')
      assert.deepEqual(yt.calls, [])

      // Yönetici açamaz, geçersiz değer reddedilir
      await h.makeAdmin(ctx, owner.token, ayse.user.id)
      h.expectStatus(await h.post(ctx, '/api/settings', ayse.token, { music: { search: true } }), 403, 'forbidden')
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { music: { search: 'evet' } }), 400, 'bad_request')
      await enable(ctx, owner.token)
      assert.deepEqual((await h.stateOf(ctx, ayse.token)).meta.music, { enabled: true, youtube: true, restricted: false, search: true })
      h.expectStatus(await search(ctx, ayse.token, 'gece şarkısı'), 200)
      assert.deepEqual(yt.calls, ['gece şarkısı'])

      // YouTube kaynağı kapalı: meta.search yanlış, uç 503
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { music: { youtube: false } }), 200)
      assert.equal((await h.stateOf(ctx, ayse.token)).meta.music.search, false)
      h.expectStatus(await search(ctx, ayse.token, 'başka'), 503, 'search_unavailable')
      // DJ kapalı: 403 dj_disabled
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { music: { youtube: true, enabled: false } }), 200)
      assert.equal((await h.stateOf(ctx, ayse.token)).meta.music.search, false)
      h.expectStatus(await search(ctx, ayse.token, 'başka'), 403, 'dj_disabled')
      assert.deepEqual(yt.calls, ['gece şarkısı'])

      // Ayar diske yazılır ve yeniden başlatmada korunur
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { music: { enabled: true } }), 200)
      await ctx.server.flush()
      const disk = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'state.json'), 'utf8'))
      assert.deepEqual(disk.music, { enabled: true, youtube: true, restricted: false, search: true })
      next = await ctx.restart()
      assert.equal((await h.stateOf(next, owner.token)).meta.music.search, true)
      await enable(next, owner.token, false)
      assert.equal((await h.stateOf(next, owner.token)).meta.music.search, false)
    } finally {
      if (next) await next.cleanup()
      else await ctx.cleanup()
    }
  })
})

describe('Telsiz DJ araması: uç noktası', () => {
  it('sahte arayıcıyla temizlenmiş sonuç: en çok 5, geçersiz kimlik, tekrar ve süresiz öğe elenir, sorgu sadeleşir', async () => {
    const ctl = String.fromCharCode(0, 0x1b, 0x202e)
    const yt = fakeSearch(() => Promise.resolve([
      { videoId: 'BBBBBBBBBB1', title: ' Ad' + ctl + 'Soyad ', channel: 'K' + ctl, durationS: 61, thumbnail: 'https://i.ytimg.com/x.jpg' },
      { videoId: '<img src=x>', title: 'Kötü', channel: 'K', durationS: 60 },
      { videoId: 'BBBBBBBBBB1', title: 'Tekrar', channel: 'K', durationS: 60 },
      { videoId: 'BBBBBBBBBB2', title: 'Canlı', channel: 'K', durationS: 0 },
      { videoId: 'BBBBBBBBBB3', title: 'x'.repeat(300), channel: 'K', durationS: 62 },
      { videoId: 'BBBBBBBBBB4', title: 'Dört', channel: 'K', durationS: 63 },
      { videoId: 'BBBBBBBBBB5', title: 'Beş', channel: 'K', durationS: 64 },
      { videoId: 'BBBBBBBBBB6', title: 'Altı', channel: 'K', durationS: 65 },
      { videoId: 'BBBBBBBBBB7', title: 'Yedi', channel: 'K', durationS: 66 }
    ]))
    const { ctx, owner, ayse } = await room({ youtubeSearch: yt })
    try {
      await enable(ctx, owner.token)
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      const res = await search(ctx, ayse.token, '  gece\nşarkısı\t' + String.fromCharCode(0x200b) + ' ')
      h.expectStatus(res, 200)
      assert.deepEqual(yt.calls, ['gece şarkısı'])
      assert.deepEqual(Object.keys(res.data), ['results'])
      assert.deepEqual(res.data.results.map((r) => r.videoId), ['BBBBBBBBBB1', 'BBBBBBBBBB3', 'BBBBBBBBBB4', 'BBBBBBBBBB5', 'BBBBBBBBBB6'])
      assert.deepEqual(res.data.results[0], { videoId: 'BBBBBBBBBB1', title: 'Ad Soyad', channel: 'K', durationS: 61 })
      assert.equal(res.data.results[1].title, 'x'.repeat(120))
    } finally {
      await ctx.cleanup()
    }
  })

  it('oturum, ses odası, oda türü, kısıtlı kip ve sorgu denetimleri', async () => {
    const yt = fakeSearch()
    const { ctx, owner, ayse, mehmet } = await room({ youtubeSearch: yt })
    try {
      await enable(ctx, owner.token)
      h.expectStatus(await search(ctx, null, 'gece'), 401)
      h.expectStatus(await search(ctx, ayse.token, 'gece'), 403, 'not_in_voice')
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      h.expectStatus(await search(ctx, ayse.token, 'gece', TEXT), 404, 'channel_not_found')
      h.expectStatus(await search(ctx, ayse.token, 'gece', 'abc'), 404, 'channel_not_found')
      h.expectStatus(await search(ctx, ayse.token, 'gece', 999), 404, 'channel_not_found')
      for (const q of ['', '   ', '\n\t', 'a'.repeat(201), 42, null, ['gece']]) {
        const bad = await search(ctx, ayse.token, q)
        h.expectStatus(bad, 400, 'bad_query')
        assert.equal(bad.data.error, i18n.t('en', 'detail.musicSearchQuery', { max: 200 }))
      }
      // 200 kod noktası (vekil çiftleri tek sayılır) kabul edilir
      const emoji = String.fromCharCode(0xd83c, 0xdfb5)
      h.expectStatus(await search(ctx, ayse.token, emoji.repeat(200)), 200)
      h.expectStatus(await search(ctx, ayse.token, emoji.repeat(201)), 400, 'bad_query')
      assert.equal(yt.calls.length, 1)

      // Kısıtlı kip: odada DJ izni olan (yönetici) varken üye arayamaz, o çıkınca arayabilir
      await h.makeAdmin(ctx, owner.token, ayse.user.id)
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { music: { restricted: true } }), 200)
      h.expectStatus(await join(ctx, mehmet.token, VOICE), 200)
      h.expectStatus(await search(ctx, mehmet.token, 'kısıtlı'), 403, 'dj_restricted')
      h.expectStatus(await search(ctx, ayse.token, 'kısıtlı'), 200)
      h.expectStatus(await h.post(ctx, '/api/voice/leave', ayse.token, {}), 200)
      h.expectStatus(await search(ctx, mehmet.token, 'kısıtlı'), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('kullanıcı başına 429 rate_limited, sunucu geneli tavan 429 search_daily_limit, önbellek isabeti arayıcıya ve tavana sayılmaz', async () => {
    const yt = fakeSearch()
    const { ctx, owner, ayse, mehmet } = await room({ youtubeSearch: yt, musicSearchLimit: 3, musicSearchDailyMax: 4 })
    try {
      await enable(ctx, owner.token)
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      h.expectStatus(await join(ctx, mehmet.token, VOICE), 200)
      for (const q of ['bir', 'iki', 'üç']) h.expectStatus(await search(ctx, ayse.token, q), 200)
      const limited = await search(ctx, ayse.token, 'dört')
      h.expectStatus(limited, 429, 'rate_limited')
      assert.equal(limited.data.error, i18n.t('en', 'detail.musicSearchRate'))
      assert.ok(Number(limited.headers['retry-after']) >= 1)
      assert.deepEqual(yt.calls, ['bir', 'iki', 'üç'])
      // Önbellek: büyük ve küçük harf aynı sorgudur, arayıcı yeniden çağrılmaz
      const hit = await search(ctx, mehmet.token, 'Bir')
      h.expectStatus(hit, 200)
      assert.equal(hit.data.results[0].title, 'Sonuç: bir')
      assert.deepEqual(yt.calls, ['bir', 'iki', 'üç'])
      h.expectStatus(await search(ctx, mehmet.token, 'dört'), 200)
      const daily = await search(ctx, mehmet.token, 'beş')
      h.expectStatus(daily, 429, 'search_daily_limit')
      assert.ok(Number(daily.headers['retry-after']) > 3600)
      assert.deepEqual(yt.calls, ['bir', 'iki', 'üç', 'dört'])
      // Tavan dolu olsa da önbellekteki sorgu verilir (kullanıcı başına sınırı dolmamış biri)
      h.expectStatus(await join(ctx, owner.token, VOICE), 200)
      h.expectStatus(await search(ctx, owner.token, 'iki'), 200)
      h.expectStatus(await search(ctx, owner.token, 'altı'), 429, 'search_daily_limit')
      assert.equal(yt.calls.length, 4)
    } finally {
      await ctx.cleanup()
    }
  })

  it('arayıcı hataları: search_failed 502, search_unavailable 503, sonuç yoksa boş liste, hatalar önbelleğe girmez', async () => {
    let mode = 'failed'
    const yt = fakeSearch(() => {
      if (mode === 'failed') return Promise.reject(Object.assign(new Error('x'), { code: 'search_failed' }))
      if (mode === 'unavailable') return Promise.reject(Object.assign(new Error('x'), { code: 'search_unavailable' }))
      if (mode === 'throw') throw new Error('beklenmeyen')
      if (mode === 'junk') return Promise.resolve({ results: 'yok' })
      return Promise.resolve([])
    })
    const { ctx, owner, ayse } = await room({ youtubeSearch: yt })
    try {
      await enable(ctx, owner.token)
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      const failed = await search(ctx, ayse.token, 'sorgu')
      h.expectStatus(failed, 502, 'search_failed')
      assert.equal(failed.data.error, i18n.t('en', 'detail.musicSearchFailed'))
      mode = 'unavailable'
      h.expectStatus(await search(ctx, ayse.token, 'sorgu'), 503, 'search_unavailable')
      mode = 'throw'
      h.expectStatus(await search(ctx, ayse.token, 'sorgu'), 502, 'search_failed')
      mode = 'junk'
      const junk = await search(ctx, ayse.token, 'sorgu')
      h.expectStatus(junk, 200)
      assert.deepEqual(junk.data, { results: [] })
      mode = 'empty'
      h.expectStatus(await search(ctx, ayse.token, 'başka'), 200)
      assert.equal(yt.calls.length, 5)
    } finally {
      await ctx.cleanup()
    }
  })

  it('aynı anda gelen aynı sorgu tek aramaya iner', async () => {
    let release = null
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const yt = fakeSearch(() => gate.then(() => [{ videoId: 'CCCCCCCCCC1', title: 'Tek', channel: 'K', durationS: 90 }]))
    const { ctx, owner, ayse, mehmet } = await room({ youtubeSearch: yt })
    try {
      await enable(ctx, owner.token)
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      h.expectStatus(await join(ctx, mehmet.token, VOICE), 200)
      const a = search(ctx, ayse.token, 'aynı sorgu')
      const b = search(ctx, mehmet.token, 'Aynı Sorgu')
      await h.waitFor(() => yt.calls.length === 1)
      await h.sleep(50)
      release()
      const [ra, rb] = await Promise.all([a, b])
      h.expectStatus(ra, 200)
      h.expectStatus(rb, 200)
      assert.deepEqual(ra.data, rb.data)
      assert.deepEqual(yt.calls, ['aynı sorgu'])
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('Telsiz DJ araması: gerçek ayrıştırıcı ve günlük', () => {
  it('sahte istek işleviyle örnek yanıt ayrıştırılır, devre kesici günlüğe tek satır yazar, sorgu hiçbir günlüğe düşmez', async () => {
    let reply = { status: 200, text: RAW_LOCKUP }
    const requests = []
    const request = (opts) => {
      requests.push(opts)
      return Promise.resolve(reply)
    }
    const { ctx, owner, ayse } = await room({ youtubeSearch: { request } })
    try {
      await enable(ctx, owner.token)
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      const res = await search(ctx, ayse.token, 'GIZLISORGU gece')
      h.expectStatus(res, 200)
      assert.deepEqual(res.data.results.map((r) => r.videoId), ['TLSZornek01', 'TLSZornek02'])
      assert.deepEqual(res.data.results[0], { videoId: 'TLSZornek01', title: 'Örnek Sanatçı Gece Şarkısı (Resmi Video)', channel: 'Örnek Sanatçı', durationS: 213 })
      assert.equal(JSON.parse(requests[0].body).query, 'GIZLISORGU gece')

      // YouTube biçimi değişti: art arda üç kullanılamayan yanıt devre kesiciyi açar
      reply = { status: 200, text: '{"yeniBicim":true}' }
      for (const q of ['GIZLISORGU 1', 'GIZLISORGU 2', 'GIZLISORGU 3']) {
        const bad = await search(ctx, ayse.token, q)
        h.expectStatus(bad, 502, 'search_failed')
        assert.ok(bad.text.indexOf('GIZLISORGU') === -1)
      }
      assert.equal(ctx.log.lines.warn.length, 1, ctx.log.lines.warn.join('\n'))
      assert.equal(ctx.log.lines.warn[0], i18n.t('tr', 'log.musicSearchPaused', { minutes: 60, reason: 'format' }))
      const count = requests.length
      h.expectStatus(await search(ctx, ayse.token, 'GIZLISORGU 4'), 502, 'search_failed')
      assert.equal(requests.length, count, 'kesici açıkken YouTube\'a istek gitmedi')
      // Bağlantıyla ekleme (DJ durumu yazımı) etkilenmez
      h.expectStatus(await h.post(ctx, '/api/music/state', ayse.token, { channelId: VOICE, expect: 0, env: h.envelope() }), 200)
      assert.equal(allLogs(ctx).indexOf('GIZLISORGU'), -1, 'sorgu günlükte yok')
    } finally {
      await ctx.cleanup()
    }
  })

  it('sunucu geneli tavan YouTube isteklerini sayar: yedeğe düşen arama iki istek sayılır, kesici açıkken reddedilen arama sayılmaz', async () => {
    // InnerTube 400 verir, sonuç sayfası çalışır: her arama iki istek
    const requests = []
    let broken = false
    const request = (opts) => {
      requests.push(opts.method)
      if (broken) return Promise.resolve({ status: 200, text: '{"yeniBicim":true}' })
      return Promise.resolve(opts.method === 'POST' ? { status: 400, text: '{}' } : { status: 200, text: PAGE_LOCKUP })
    }
    let r = await room({ youtubeSearch: { request }, musicSearchDailyMax: 5, musicSearchLimit: 50 })
    try {
      await enable(r.ctx, r.owner.token)
      h.expectStatus(await join(r.ctx, r.ayse.token, VOICE), 200)
      for (const q of ['bir', 'iki']) {
        const res = await search(r.ctx, r.ayse.token, q)
        h.expectStatus(res, 200)
        assert.equal(res.data.results[0].videoId, 'TLSZornek01')
      }
      assert.deepEqual(requests, ['POST', 'GET', 'POST', 'GET'])
      // Beşinci istek InnerTube'a gider, yedeğe izin kalmaz: yedek denenmez, arama başarısız
      h.expectStatus(await search(r.ctx, r.ayse.token, 'üç'), 502, 'search_failed')
      assert.deepEqual(requests, ['POST', 'GET', 'POST', 'GET', 'POST'])
      const daily = await search(r.ctx, r.ayse.token, 'dört')
      h.expectStatus(daily, 429, 'search_daily_limit')
      assert.ok(Number(daily.headers['retry-after']) > 3600)
      assert.equal(requests.length, 5)
      // Önbellekteki sorgu tavan doluyken de verilir
      h.expectStatus(await search(r.ctx, r.ayse.token, 'BIR'), 200)
      assert.equal(requests.length, 5)
    } finally {
      await r.ctx.cleanup()
    }

    // Kesici açıkken istek atılmaz ve tavan düşmez: tavan dolmadığı için yanıt 429 değil 502 olur
    requests.length = 0
    broken = true
    r = await room({ youtubeSearch: { request }, musicSearchDailyMax: 7, musicSearchLimit: 50 })
    try {
      await enable(r.ctx, r.owner.token)
      h.expectStatus(await join(r.ctx, r.ayse.token, VOICE), 200)
      for (const q of ['bir', 'iki', 'üç']) h.expectStatus(await search(r.ctx, r.ayse.token, q), 502, 'search_failed')
      assert.equal(requests.length, 6)
      assert.equal(r.ctx.log.lines.warn.length, 1)
      for (const q of ['dört', 'beş', 'altı', 'yedi']) h.expectStatus(await search(r.ctx, r.ayse.token, q), 502, 'search_failed')
      assert.equal(requests.length, 6, 'kesici açıkken istek atılmadı')
    } finally {
      await r.ctx.cleanup()
    }
  })

  it('sunucu kapanırken süren arama kesilir: istemci 503 shutting_down alır, sonuç sayfası istenmez, kapanış beklemez', async () => {
    // Hiç yanıt vermeyen sahte YouTube (gerçek ağ katmanı, yerel sunucu)
    const seen = []
    const yt = http.createServer((req) => {
      seen.push(req.method + ' ' + req.url.split('?')[0])
    })
    await new Promise((resolve) => yt.listen(0, '127.0.0.1', resolve))
    const request = ys.makeRequester({ transport: http, host: '127.0.0.1', port: yt.address().port })
    const { ctx, owner, ayse } = await room({ youtubeSearch: { request } })
    let stopped = false
    try {
      await enable(ctx, owner.token)
      h.expectStatus(await join(ctx, ayse.token, VOICE), 200)
      const pending = search(ctx, ayse.token, 'GIZLISORGU kapanış')
      await h.waitFor(() => seen.length === 1)
      const t0 = Date.now()
      const closed = ctx.stop()
      const res = await pending
      await closed
      stopped = true
      h.expectStatus(res, 503, 'shutting_down')
      assert.ok(Date.now() - t0 < 1500, 'kapanış ' + (Date.now() - t0) + ' ms sürdü')
      await h.sleep(100)
      assert.deepEqual(seen, ['POST /youtubei/v1/search'])
      assert.equal(allLogs(ctx).indexOf('GIZLISORGU'), -1)
    } finally {
      if (typeof yt.closeAllConnections === 'function') yt.closeAllConnections()
      await new Promise((resolve) => yt.close(resolve))
      if (stopped) h.removeRoot(ctx.root)
      else await ctx.cleanup()
    }
  })

  it('geçersiz youtubeSearch seçeneği reddedilir', async () => {
    for (const value of ['evet', 5, { request: 'x' }]) {
      const root = h.makeRoot()
      try {
        await assert.rejects(h.startServer({ youtubeSearch: value }, root), /youtubeSearch/)
      } finally {
        h.removeRoot(root)
      }
    }
  })
})
