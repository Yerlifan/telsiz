'use strict'

// Telsiz DJ şarkı adıyla YouTube araması (src/youtube-search.js, istek 5). Canlı YouTube'a hiçbir istek gitmez:
// ayrıştırıcı test/fixtures/yt-arama altındaki elle hazırlanmış örnek yanıtlarla, arama akışı enjekte edilen
// istek işleviyle, ağ katmanı (yönlendirme, boyut, sıkıştırma, zaman aşımı) bu bilgisayarda açılan sahte bir
// HTTP sunucusuyla sınanır.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const ys = require('../src/youtube-search')

const FIXTURES = path.join(__dirname, 'fixtures', 'yt-arama')
const RAW_VIDEO = fs.readFileSync(path.join(FIXTURES, 'ornek-videorenderer.json'), 'utf8')
const RAW_LOCKUP = fs.readFileSync(path.join(FIXTURES, 'ornek-lockupviewmodel.json'), 'utf8')
const SKIPPED = ['TLSZreklam4', 'TLSZcanli03', 'TLSZraf0005']

function fixture (raw) {
  return JSON.parse(raw)
}

// Tek bir itemSectionRenderer içinde verilen öğeler
function response (items) {
  return { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }] } } } } }
}

function video (id, extra) {
  return { videoRenderer: Object.assign({ videoId: id, title: { runs: [{ text: 'Parça ' + id }] }, ownerText: { runs: [{ text: 'Kanal' }] }, lengthText: { simpleText: '3:00' } }, extra || {}) }
}

function failsWith (fn, reason) {
  assert.throws(fn, (err) => err.code === 'search_failed' && err.reason === reason)
}

describe('ayrıştırıcı: örnek yanıtlar', () => {
  it('iki örnek dosyadan yalnızca TLSZornek01 ve TLSZornek02 çıkar, reklam, canlı yayın, raf ve liste atlanır', () => {
    for (const raw of [RAW_VIDEO, RAW_LOCKUP]) {
      // Atlanan kimlikler örnekte gerçekten bulunur
      for (const id of SKIPPED) assert.ok(raw.indexOf(id) !== -1, id)
      const results = ys.parseSearchResponse(fixture(raw))
      assert.deepEqual(results.map((r) => r.videoId), ['TLSZornek01', 'TLSZornek02'])
      assert.deepEqual(results[0], { videoId: 'TLSZornek01', title: 'Örnek Sanatçı Gece Şarkısı (Resmi Video)', channel: 'Örnek Sanatçı', durationS: 213 })
      assert.equal(results[1].durationS, 3723)
    }
    assert.equal(ys.parseSearchResponse(fixture(RAW_VIDEO))[1].title, 'Gece Şarkısı & Diğer Şarkılar (Uzun Kayıt)')
    assert.equal(ys.parseSearchResponse(fixture(RAW_LOCKUP))[1].channel, 'Örnek Müzik Arşivi and Örnek Sanatçı')
  })

  it('iki biçim aynı yanıtta karışık gelebilir, aynı kimlik bir kez alınır', () => {
    const a = fixture(RAW_VIDEO).contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents
    const b = fixture(RAW_LOCKUP).contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents
    const results = ys.parseSearchResponse(response(b.concat(a)))
    assert.deepEqual(results.map((r) => r.videoId), ['TLSZornek01', 'TLSZornek02'])
    // Önce görülen (lockup) kayıt kalır
    assert.equal(results[1].title, 'Gece Şarkısı & Diğer Şarkılar (Ortak Kayıt)')
  })

  it('belge sırası korunur, birden çok bölüm ve devam yanıtı gezilir, yan sütun atlanır', () => {
    const data = {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [
                { itemSectionRenderer: { contents: [video('aaaaaaaaaa1'), video('aaaaaaaaaa2')] } },
                { itemSectionRenderer: { contents: [video('aaaaaaaaaa3')] } }
              ]
            }
          },
          secondaryContents: { itemSectionRenderer: { contents: [video('bbbbbbbbbb1')] } }
        }
      }
    }
    assert.deepEqual(ys.parseSearchResponse(data).map((r) => r.videoId), ['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa3'])
    const more = { onResponseReceivedCommands: [{ appendContinuationItemsAction: { continuationItems: [{ itemSectionRenderer: { contents: [video('cccccccccc1')] } }] } }], secondaryContents: [video('bbbbbbbbbb2')] }
    assert.deepEqual(ys.parseSearchResponse(more).map((r) => r.videoId), ['cccccccccc1'])
  })

  it('reklam alt ağaçlarına (promoted dahil), raflara, kanal ve oynatma listesi öğelerine inilmez', () => {
    const data = response([
      { promotedSparklesWebRenderer: { content: video('ddddddddd01') } },
      { promotedSomethingNewRenderer: { content: video('ddddddddd02') } },
      { carouselAdRenderer: { items: [video('ddddddddd03')] } },
      { playlistRenderer: { videos: [{ childVideoRenderer: { videoId: 'ddddddddd04' } }], content: video('ddddddddd05') } },
      { radioRenderer: { content: video('ddddddddd06') } },
      { reelShelfRenderer: { items: [video('ddddddddd07')] } },
      { lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', contentId: 'ddddddddd08' } },
      { unknownWrapperRenderer: { content: video('ddddddddd09') } }
    ])
    // Bilinmeyen yeni sarmalayıcı aşılır
    assert.deepEqual(ys.parseSearchResponse(data).map((r) => r.videoId), ['ddddddddd09'])
  })

  it('canlı, yaklaşan ve süresi ayrıştırılamayan öğeler atlanır, süre örtüden de okunur', () => {
    const data = response([
      video('eeeeeeeeee1', { lengthText: undefined, thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { style: 'LIVE', text: { simpleText: 'LIVE' } } }] }),
      video('eeeeeeeeee2', { upcomingEventData: { startTime: '1900000000' } }),
      video('eeeeeeeeee3', { badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW' } }] }),
      video('eeeeeeeeee4', { lengthText: { simpleText: 'yakında' } }),
      video('eeeeeeeeee5', { lengthText: undefined }),
      video('eeeeeeeeee6', { lengthText: undefined, thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { style: 'DEFAULT', text: { simpleText: '4:05' } } }] }),
      video('eeeeeeeeee7', { lengthText: { simpleText: '0:00' } }),
      { compactVideoRenderer: { videoId: 'eeeeeeeeee8', title: { simpleText: 'Dar' }, lengthText: { simpleText: '10:00' }, shortBylineText: { runs: [{ text: 'K' }] } } }
    ])
    const results = ys.parseSearchResponse(data)
    assert.deepEqual(results.map((r) => [r.videoId, r.durationS]), [['eeeeeeeeee6', 245], ['eeeeeeeeee8', 600]])
    assert.equal(results[1].channel, 'K')
  })

  it('geçersiz kimlik reddedilir', () => {
    const data = response([video('kisa'), video('cok-uzun-kimlik1'), video('bosluk var!'), { lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', contentId: 'x'.repeat(12) } }, video('ffffffffff1')])
    assert.deepEqual(ys.parseSearchResponse(data).map((r) => r.videoId), ['ffffffffff1'])
  })

  it('başlık ve kanal adı temizlenir: denetim ve yön karakterleri, boşluk, 120 kod noktası', () => {
    const ctl = String.fromCharCode(0, 7, 0x1b, 0x9f)
    const bidi = String.fromCharCode(0x202e, 0x2066, 0x200b, 0xfeff)
    const emoji = String.fromCharCode(0xd83c, 0xdfb5)
    const lone = String.fromCharCode(0xd800)
    const long = emoji.repeat(130)
    const data = response([video('ggggggggggg', { title: { runs: [{ text: '  Ad' + ctl + 'ı' }, { text: bidi + '\n\tSon' + lone + '  ' }] }, ownerText: { runs: [{ text: long }] } })])
    const r = ys.parseSearchResponse(data)[0]
    assert.equal(r.title, 'Ad ı Son' + String.fromCharCode(0xfffd))
    assert.equal(r.channel, emoji.repeat(120))
    assert.equal(ys.cleanText(5), '')
  })

  it('tanınmayan yapı biçim hatasıdır, boş sonuç listesi hata değildir', () => {
    for (const data of [null, 'metin', [], {}, { contents: {} }, { contents: { twoColumnSearchResultsRenderer: { primaryContents: { yeniBicim: [{ a: 1 }] } } } }]) {
      failsWith(() => ys.parseSearchResponse(data), 'format')
    }
    assert.deepEqual(ys.parseSearchResponse(response([])), [])
    assert.deepEqual(ys.parseSearchResponse(response([{ channelRenderer: { channelId: 'UC' } }])), [])
  })

  it('düğüm sınırı aşılınca hata, derinlik sınırının altına inilmez', () => {
    const many = new Array(ys.LIMITS.maxNodes + 10).fill(0).map(() => ({ a: 1 }))
    failsWith(() => ys.parseSearchResponse(response(many)), 'too_many_nodes')
    let deep = video('hhhhhhhhhhh')
    for (const n of new Array(100).fill(0)) deep = { sarmal: deep, n }
    assert.deepEqual(ys.parseSearchResponse(response([deep, video('hhhhhhhhhh2')])).map((r) => r.videoId), ['hhhhhhhhhh2'])
  })

  it('cleanResults: enjekte edilen arayıcının sonuçları da temizlenir ve sınırlanır', () => {
    const list = [
      { videoId: 'iiiiiiiiii1', title: 'Bir', channel: 'K', durationS: 60 },
      { videoId: 'iiiiiiiiii1', title: 'Tekrar', channel: 'K', durationS: 60 },
      { videoId: '<script>', title: 'Kötü', durationS: 60 },
      { videoId: 'iiiiiiiiii2', title: 'Süresiz', durationS: 0 },
      { videoId: 'iiiiiiiiii3', title: 42, channel: null, durationS: 61 },
      null,
      'metin',
      { videoId: 'iiiiiiiiii4', title: 'Dört', channel: 'K', durationS: 62 }
    ]
    assert.deepEqual(ys.cleanResults(list, 5), [
      { videoId: 'iiiiiiiiii1', title: 'Bir', channel: 'K', durationS: 60 },
      { videoId: 'iiiiiiiiii3', title: '', channel: '', durationS: 61 },
      { videoId: 'iiiiiiiiii4', title: 'Dört', channel: 'K', durationS: 62 }
    ])
    assert.equal(ys.cleanResults(list, 1).length, 1)
    assert.deepEqual(ys.cleanResults('yok'), [])
  })
})

describe('HTML yedeği: ytInitialData çıkarımı', () => {
  it('süslü parantez sayacı dizgi içini ve kaçışları atlar, kaçışlı </script> metni bozmaz', () => {
    const data = fixture(RAW_VIDEO)
    data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents[3].videoRenderer.title = { runs: [{ text: 'a }"{ <\/script> \\ b' }] }
    const json = JSON.stringify(data).split('</').join('<\\/')
    const html = '<html><head><script>var other = { "x": "}" };</script></head><body><script nonce="n">var ytInitialData = ' + json + ';</script><script>var ytInitialPlayerResponse = {"y": 1};</script></body></html>'
    const out = ys.extractInitialData(html)
    assert.ok(out)
    const results = ys.parseSearchResponse(out)
    assert.deepEqual(results.map((r) => r.videoId), ['TLSZornek01', 'TLSZornek02'])
    assert.equal(results[0].title, 'a }"{ </script> \\ b')
  })

  it('window["ytInitialData"] biçimi de okunur, işaret yoksa veya JSON bozuksa null', () => {
    assert.deepEqual(ys.extractInitialData('<script>window["ytInitialData"] = {"a":[1,{"b":"}"}]};</script>'), { a: [1, { b: '}' }] })
    assert.equal(ys.extractInitialData('<html>yok</html>'), null)
    assert.equal(ys.extractInitialData('var ytInitialData = {"a": 1'), null)
    assert.equal(ys.extractInitialData('var ytInitialData = {"a": tanımsız};'), null)
    assert.equal(ys.extractInitialData('var ytInitialData = [1];'), null)
    assert.equal(ys.extractInitialData(null), null)
    // İlk işaret bozuksa ikincisi denenir
    assert.deepEqual(ys.extractInitialData('var ytInitialData = {bozuk}; window["ytInitialData"] = {"ok": true};'), { ok: true })
  })

  it('istemci sürümü sayfadan veya cver alanından okunur, desene uymayan yok sayılır', () => {
    assert.equal(ys.readClientVersion('..."INNERTUBE_CONTEXT_CLIENT_VERSION":"2.20261005.01.00",...', null), '2.20261005.01.00')
    assert.equal(ys.readClientVersion('"INNERTUBE_CONTEXT_CLIENT_VERSION":"1.2.3"', null), null)
    assert.equal(ys.readClientVersion('', fixture(RAW_LOCKUP)), '2.20261001.00.00')
    assert.equal(ys.readClientVersion('', { responseContext: { serviceTrackingParams: [{ params: [{ key: 'cver', value: 'x' }] }] } }), null)
  })
})

// Sahte istek işlevi: her çağrı kaydedilir, yanıtlar sırayla verilir (işlev ya da { status, text })
function fakeRequest (replies) {
  const calls = []
  const fn = (opts) => {
    calls.push(opts)
    const next = replies.length > 1 ? replies.shift() : replies[0]
    return Promise.resolve().then(() => (typeof next === 'function' ? next(opts) : next))
  }
  fn.calls = calls
  return fn
}

function page (data, version) {
  return '<html><script>var ytInitialData = ' + JSON.stringify(data) + ';</script><script>ytcfg.set({"INNERTUBE_CONTEXT_CLIENT_VERSION":"' + (version || '2.20261010.00.00') + '"})</script></html>'
}

function networkError () {
  const err = new Error('youtube search: timeout')
  err.code = 'search_failed'
  err.reason = 'timeout'
  err.counts = false
  throw err
}

describe('arama akışı (enjekte edilen istek işlevi)', () => {
  it('InnerTube isteği: sabit adres, anahtarsız, video süzgeci, istemci bağlamı ve başlıklar', async () => {
    const request = fakeRequest([{ status: 200, text: RAW_LOCKUP }])
    const engine = ys.createYouTubeSearch({ request })
    const results = await engine.search('gece şarkısı')
    assert.deepEqual(results.map((r) => r.videoId), ['TLSZornek01', 'TLSZornek02'])
    assert.equal(request.calls.length, 1)
    const call = request.calls[0]
    assert.equal(call.method, 'POST')
    assert.equal(call.path, '/youtubei/v1/search?prettyPrint=false')
    assert.ok(!/key=/.test(call.path))
    assert.deepEqual(JSON.parse(call.body), {
      context: { client: { clientName: 'WEB', clientVersion: ys.DEFAULT_CLIENT_VERSION, hl: 'en', gl: 'US', utcOffsetMinutes: 0 }, user: {} },
      query: 'gece şarkısı',
      params: 'EgIQAQ%3D%3D'
    })
    assert.equal(call.headers['Content-Type'], 'application/json')
    assert.equal(call.headers['Content-Length'], String(Buffer.byteLength(call.body)))
    assert.equal(call.headers['X-Youtube-Client-Name'], '1')
    assert.equal(call.headers['X-Youtube-Client-Version'], ys.DEFAULT_CLIENT_VERSION)
    assert.equal(call.headers.Origin, 'https://www.youtube.com')
    assert.equal(call.headers.Referer, 'https://www.youtube.com/')
    assert.equal(call.headers.Cookie, 'SOCS=CAI')
    assert.match(call.headers['User-Agent'], /^Mozilla\/5\.0 /)
    assert.equal(call.maxBytes, ys.LIMITS.jsonMaxBytes)
    assert.ok(call.timeoutMs > 0 && call.timeoutMs <= ys.LIMITS.timeoutMs)
  })

  it('InnerTube başarısız olursa sonuç sayfası okunur, öğrenilen istemci sürümü sonraki istekte kullanılır', async () => {
    const request = fakeRequest([{ status: 400, text: '{}' }, { status: 200, text: page(fixture(RAW_VIDEO), '2.20261010.00.00') }, { status: 200, text: RAW_VIDEO }])
    const engine = ys.createYouTubeSearch({ request })
    const results = await engine.search('lobi & şarkı')
    assert.deepEqual(results.map((r) => r.videoId), ['TLSZornek01', 'TLSZornek02'])
    const get = request.calls[1]
    assert.equal(get.method, 'GET')
    const url = new URL('https://www.youtube.com' + get.path)
    assert.equal(url.pathname, '/results')
    assert.equal(url.searchParams.get('search_query'), 'lobi & şarkı')
    assert.equal(url.searchParams.get('sp'), 'EgIQAQ==')
    assert.ok(get.path.indexOf('sp=EgIQAQ%3D%3D') !== -1, get.path)
    assert.equal(url.searchParams.get('hl'), 'en')
    assert.equal(url.searchParams.get('gl'), 'US')
    assert.equal(get.headers.Cookie, 'SOCS=CAI')
    assert.equal(get.maxBytes, ys.LIMITS.htmlMaxBytes)
    assert.equal(engine.status().clientVersion, '2.20261010.00.00')
    await engine.search('ikinci')
    assert.equal(JSON.parse(request.calls[2].body).context.client.clientVersion, '2.20261010.00.00')
    assert.equal(request.calls[2].headers['X-Youtube-Client-Version'], '2.20261010.00.00')
  })

  it('sonuç yoksa boş dizi döner ve hata sayılmaz', async () => {
    const request = fakeRequest([{ status: 200, text: JSON.stringify(response([])) }])
    const engine = ys.createYouTubeSearch({ request })
    assert.deepEqual(await engine.search('hiç'), [])
    assert.equal(engine.status().fails, 0)
    assert.equal(request.calls.length, 1)
  })

  it('devre kesici: art arda 3 kullanılamayan yanıttan sonra 1 saat istek atılmaz, tek günlük satırı, sonra yeniden dener', async () => {
    let clock = 1000000
    const breaks = []
    const request = fakeRequest([{ status: 200, text: '<html>JSON değil</html>' }])
    const engine = ys.createYouTubeSearch({ request, now: () => clock, onBreak: (reason, minutes) => breaks.push([reason, minutes]) })
    for (const i of [0, 1, 2]) {
      await assert.rejects(engine.search('sorgu-' + i), (err) => err.code === 'search_failed' && err.message.indexOf('sorgu') === -1)
    }
    // Her aramada InnerTube ve sonuç sayfası denendi
    assert.equal(request.calls.length, 6)
    assert.deepEqual(breaks, [['no_initial_data', 60]])
    await assert.rejects(engine.search('dördüncü'), (err) => err.code === 'search_failed' && err.reason === 'paused')
    assert.equal(request.calls.length, 6, 'kesici açıkken istek atılmadı')
    clock += ys.LIMITS.breakerMs
    await assert.rejects(engine.search('beşinci'), (err) => err.code === 'search_failed')
    assert.equal(request.calls.length, 8)
    assert.equal(breaks.length, 1)
    // Günlüğe giden neden sabit bir belirteçtir, arama metnini taşımaz
    assert.ok(breaks.every((b) => /^[a-z_0-9]+$/.test(b[0])))
  })

  it('başarılı arama sayacı sıfırlar, ağ hataları ve zaman aşımı kesiciye sayılmaz', async () => {
    const bad = { status: 503, text: '' }
    const good = { status: 200, text: RAW_VIDEO }
    const breaks = []
    const request = fakeRequest([bad, bad, bad, bad, good, bad, bad, bad, bad, networkError, networkError, networkError, networkError, networkError, networkError, bad, bad])
    const engine = ys.createYouTubeSearch({ request, onBreak: (reason) => breaks.push(reason) })
    await assert.rejects(engine.search('a'))
    await assert.rejects(engine.search('b'))
    assert.equal(engine.status().fails, 2)
    assert.equal((await engine.search('c')).length, 2)
    assert.equal(engine.status().fails, 0)
    await assert.rejects(engine.search('d'))
    await assert.rejects(engine.search('e'))
    for (const i of [0, 1, 2]) await assert.rejects(engine.search('ağ-' + i), (err) => err.reason === 'timeout')
    assert.equal(engine.status().fails, 2)
    assert.deepEqual(breaks, [])
    await assert.rejects(engine.search('f'), (err) => err.reason === 'status_503')
    assert.deepEqual(breaks, ['status_503'])
  })

  it('boş sorgu istek atmadan reddedilir', async () => {
    const request = fakeRequest([{ status: 200, text: RAW_VIDEO }])
    const engine = ys.createYouTubeSearch({ request })
    for (const q of ['', '   ', null, 5]) await assert.rejects(engine.search(q), (err) => err.code === 'search_failed')
    assert.equal(request.calls.length, 0)
  })
})

// Sahte sunucu: her istek kaydedilir, yanıtı handler verir
async function fakeServer (handler) {
  const seen = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
      handler(req, res)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const request = ys.makeRequester({ transport: http, host: '127.0.0.1', port: server.address().port })
  const close = () => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    return new Promise((resolve) => server.close(resolve))
  }
  return { seen, request, close }
}

function get (request, extra) {
  return request(Object.assign({ method: 'GET', path: '/results?search_query=x', headers: { Accept: 'text/html' }, maxBytes: 1000, timeoutMs: 2000 }, extra || {}))
}

describe('ağ katmanı (sahte HTTP sunucusu)', () => {
  it('gövde ve başlıklar gider, yanıt metni döner', async () => {
    const s = await fakeServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"tamam":"evet"}')
    })
    try {
      const res = await s.request({ method: 'POST', path: '/youtubei/v1/search?prettyPrint=false', headers: { 'Content-Type': 'application/json', 'X-Deneme': '1' }, body: '{"query":"ş"}', maxBytes: 100, timeoutMs: 2000 })
      assert.deepEqual(res, { status: 200, text: '{"tamam":"evet"}' })
      assert.equal(s.seen[0].method, 'POST')
      assert.equal(s.seen[0].url, '/youtubei/v1/search?prettyPrint=false')
      assert.equal(s.seen[0].headers['x-deneme'], '1')
      assert.equal(s.seen[0].body, '{"query":"ş"}')
      assert.equal(s.seen[0].headers['accept-encoding'], undefined)
    } finally {
      await s.close()
    }
  })

  it('yönlendirme izlenmez, onay sayfası ayrı bildirilir', async () => {
    let target = 'https://consent.youtube.com/m?continue=x'
    const s = await fakeServer((req, res) => {
      res.writeHead(302, { Location: target })
      res.end()
    })
    try {
      await assert.rejects(get(s.request), (err) => err.code === 'search_failed' && err.reason === 'consent_redirect' && err.counts === true)
      target = '/baska'
      await assert.rejects(get(s.request), (err) => err.reason === 'redirect')
      assert.equal(s.seen.length, 2, 'yönlendirilen adrese istek gitmedi')
    } finally {
      await s.close()
    }
  })

  it('boyut sınırı: bildirilen ya da akan gövde sınırı aşınca kesilir', async () => {
    let mode = 'declared'
    const s = await fakeServer((req, res) => {
      if (mode === 'declared') {
        res.writeHead(200, { 'Content-Length': '5000' })
        res.end('x'.repeat(5000))
        return
      }
      res.writeHead(200)
      res.write('x'.repeat(600))
      setTimeout(() => res.end('y'.repeat(600)), 20)
    })
    try {
      await assert.rejects(get(s.request), (err) => err.reason === 'too_large' && err.counts === true)
      mode = 'chunked'
      await assert.rejects(get(s.request), (err) => err.reason === 'too_large')
    } finally {
      await s.close()
    }
  })

  it('sıkıştırılmış yanıt kabul edilmez', async () => {
    const s = await fakeServer((req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip' })
      res.end('abc')
    })
    try {
      await assert.rejects(get(s.request), (err) => err.reason === 'encoding')
    } finally {
      await s.close()
    }
  })

  it('zaman aşımı ve bağlantı hatası ağ hatasıdır (kesiciye sayılmaz), abortAll süren isteği keser', async () => {
    const s = await fakeServer(() => {})
    try {
      await assert.rejects(get(s.request, { timeoutMs: 100 }), (err) => err.reason === 'timeout' && err.counts === false)
      const pending = get(s.request, { timeoutMs: 5000 })
      await new Promise((resolve) => setTimeout(resolve, 100))
      s.request.abortAll()
      await assert.rejects(pending, (err) => err.code === 'search_failed' && err.counts === false)
    } finally {
      await s.close()
    }
    const closed = ys.makeRequester({ transport: http, host: '127.0.0.1', port: 9 })
    await assert.rejects(get(closed), (err) => err.reason === 'network' && err.counts === false)
  })
})
