'use strict'

// Telsiz DJ: şarkı adıyla YouTube araması (istek 5). Sunucu sahibi Ayarlar'dan açar, varsayılan kapalıdır.
// Resmî YouTube Data API ve anahtar kullanılmaz: sunucu YouTube web arayüzünün kendi arama ucunu (InnerTube,
// POST /youtubei/v1/search) çağırır, olmazsa sonuç sayfasındaki ytInitialData verisini okur. YouTube Hizmet
// Şartları otomatik erişimi yasaklar, sahip bu riski açarken onaylar. Yanıt biçimi belgelenmemiştir ve
// değişebilir: ayrıştırıcı ağaçta yalnızca tanınan video düğümlerini toplar, reklam, raf, kanal ve oynatma
// listesi alt ağaçlarına inmez. Yapı tanınmazsa arama başarısız sayılır, art arda hatalarda bir süre kapanır.
// Bu modül hiçbir bağımlılık kullanmaz (node:https), yönlendirme izlemez ve arama metnini hiçbir zaman günlüğe
// yazmaz. Biçim bilgisi açık kaynaklı InnerTube istemcilerinin kaynak kodundan çıkarıldı ve canlı YouTube'da
// sınanmadı. İlk canlı deneme sunucuda yapılır (docs/MIMARI.md, Telsiz DJ araması).

const https = require('node:https')

const HOST = 'www.youtube.com'
const ORIGIN = 'https://www.youtube.com'
const SEARCH_PATH = '/youtubei/v1/search?prettyPrint=false'
const RESULTS_PATH = '/results'
// Yalnızca video süzgeci: protobuf { 2: { 2: 1 } }, base64 EgIQAQ==. Gövdeye URL kodlu konur (youtubei.js
// biçimi), sonuç sayfası adresinde URLSearchParams kodlar. Süzgecin uygulandığına güvenilmez, ayrıştırıcı
// yine türe göre süzer.
const VIDEO_PARAMS = 'EgIQAQ%3D%3D'
const VIDEO_SP = 'EgIQAQ=='
// Web istemcisinin sürümü. Sonuç sayfası okunduğunda sayfadaki değerle bellekte güncellenir.
const DEFAULT_CLIENT_VERSION = '2.20260720.04.00'
const CLIENT_VERSION_RE = /^\d+\.\d{8}\.\d{2}\.\d{2}$/
const CLIENT_VERSION_TEXT_RE = /"INNERTUBE_CONTEXT_CLIENT_VERSION":"([0-9.]{1,32})"/
// Sabit bir masaüstü tarayıcı kimliği (dönüşümlü değildir)
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
// AB onay sayfasını atlamak için açık kaynaklı istemcilerde görülen çerez
const CONSENT_COOKIE = 'SOCS=CAI'
// ytInitialData atamasının olası biçimleri
const DATA_MARKERS = ['var ytInitialData = ', 'window["ytInitialData"] = ']

const LIMITS = Object.freeze({
  // Bir aramanın iki isteği (InnerTube ve sonuç sayfası) toplam bu sürede biter
  timeoutMs: 8000,
  jsonMaxBytes: 4 * 1024 * 1024,
  htmlMaxBytes: 6 * 1024 * 1024,
  maxNodes: 200000,
  maxDepth: 64,
  // Başlık ve kanal adı, kod noktası
  textMax: 120,
  // Art arda bu kadar kullanılamayan yanıttan sonra arama breakerMs boyunca kapanır
  breakerFails: 3,
  breakerMs: 60 * 60 * 1000
})

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/
const DURATION_RE = /^\d{1,3}(?::\d{1,2}){1,2}$/
const UNSAFE_TEXT_G = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g

// Reklam düğümleri (sınıf adı: ilk harf büyük, Renderer ve Model ekleri silinmiş). Alt ağaçlarına inilmez.
const AD_CLASSES = new Set([
  'AdSlot', 'DisplayAd', 'SearchPyv', 'MealbarPromo', 'PrimetimePromo', 'PromotedSparklesWeb',
  'CompactPromotedVideo', 'BrandVideoShelf', 'BrandVideoSingleton', 'StatementBanner', 'GuideSigninPromo',
  'AdsEngagementPanelContent', 'MiniGameCardView', 'GenAiFeedbackFormView', 'PlayerInterstitial',
  'InterstitialView', 'CarouselAd', 'PromotedVideo', 'PromotedSparklesTextSearch', 'CompactPromotedItem'
])
// Sonuç olmayan kapsayıcılar: raflar, kanal ve oynatma listesi öğeleri, yan sütun
const SKIP_KEYS = new Set([
  'shelfRenderer', 'richShelfRenderer', 'reelShelfRenderer', 'horizontalCardListRenderer', 'playlistRenderer',
  'radioRenderer', 'channelRenderer', 'universalWatchCardRenderer', 'secondaryContents'
])
const VIDEO_KEYS = new Set(['videoRenderer', 'compactVideoRenderer', 'gridVideoRenderer'])
const LOCKUP_KEY = 'lockupViewModel'
const LOCKUP_VIDEO = 'LOCKUP_CONTENT_TYPE_VIDEO'
// Sonuç listesinin tanınan kapsayıcıları: biri görülmezse ve hiç video düğümü yoksa biçim değişmiş sayılır
const STRUCTURE_KEYS = new Set(['sectionListRenderer', 'itemSectionRenderer', 'richGridRenderer', 'appendContinuationItemsAction'])

function noop () {}

// code: search_failed veya search_unavailable. reason: günlük için sabit, İngilizce bir belirteç (arama metni
// içermez). counts: yanıt geldi ama kullanılamadı (devre kesiciye sayılır). Ağ hataları ve zaman aşımı sayılmaz.
function searchError (code, reason, counts) {
  const err = new Error('youtube search: ' + reason)
  err.code = code
  err.reason = reason
  err.counts = Boolean(counts)
  return err
}

function responseError (reason) {
  return searchError('search_failed', reason, true)
}

function isObj (value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// Metin temizliği (istemcideki TelsizMusic cleanText ile aynı kural): NFC, denetim ve yön karakterleri boşluk
// olur, boşluklar sadeleşir, en çok max kod noktası, eşsiz vekil yarımları U+FFFD olur
function cleanText (value, max) {
  if (typeof value !== 'string') return ''
  let text = value
  try {
    text = text.normalize('NFC')
  } catch (err) {
    text = value
  }
  text = text.replace(UNSAFE_TEXT_G, ' ').replace(/\s+/g, ' ').trim()
  const limit = Number.isSafeInteger(max) && max > 0 ? max : LIMITS.textMax
  const out = []
  let i = 0
  while (i < text.length && out.length < limit) {
    const c = text.charCodeAt(i)
    const d = i + 1 < text.length ? text.charCodeAt(i + 1) : 0
    if (c >= 0xd800 && c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff) {
      out.push(text.slice(i, i + 2))
      i += 2
    } else {
      out.push(c >= 0xd800 && c <= 0xdfff ? '\ufffd' : text.charAt(i))
      i++
    }
  }
  return out.join('').trim()
}

// Bir sonuç listesini istemciye gidecek biçime getirir: geçersiz kimlik ve süre elenir, kimlik tekrarı atılır,
// metinler temizlenir, en çok max öğe. Enjekte edilen arayıcıların sonuçları da buradan geçer (src/app.js).
function cleanResults (list, max) {
  const out = []
  const seen = new Set()
  const limit = Number.isSafeInteger(max) && max > 0 ? max : Infinity
  if (!Array.isArray(list)) return out
  for (const item of list) {
    if (out.length >= limit) break
    if (!isObj(item) || typeof item.videoId !== 'string' || !VIDEO_ID_RE.test(item.videoId) || seen.has(item.videoId)) continue
    const durationS = Number.isSafeInteger(item.durationS) && item.durationS > 0 && item.durationS <= 999 * 3600 ? item.durationS : 0
    if (durationS === 0) continue
    seen.add(item.videoId)
    out.push({ videoId: item.videoId, title: cleanText(item.title, LIMITS.textMax), channel: cleanText(item.channel, LIMITS.textMax), durationS })
  }
  return out
}

// ---------------------------------------------------------------- ayrıştırıcı

function className (key) {
  return (key.charAt(0).toUpperCase() + key.slice(1)).replace(/Renderer|Model/g, '')
}

function isAdKey (key) {
  return AD_CLASSES.has(className(key)) || /^promoted/i.test(key)
}

// Metin alanı: { simpleText }, { runs: [{ text }] } veya { content } (yeni biçim)
function textOf (t) {
  if (!isObj(t)) return ''
  if (typeof t.simpleText === 'string') return t.simpleText
  if (Array.isArray(t.runs)) return t.runs.map((r) => (r && typeof r.text === 'string' ? r.text : '')).join('')
  if (typeof t.content === 'string') return t.content
  return ''
}

// "3:33" veya "1:02:03" biçimli süre, saniye. Başka biçimde null.
function seconds (value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!DURATION_RE.test(text)) return null
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0)
}

function arrayOf (value) {
  return Array.isArray(value) ? value : []
}

// Eski biçim video öğesi (videoRenderer, compactVideoRenderer, gridVideoRenderer)
function readVideoRenderer (v) {
  if (!isObj(v) || typeof v.videoId !== 'string' || !VIDEO_ID_RE.test(v.videoId)) return null
  const overlays = arrayOf(v.thumbnailOverlays).map((o) => (isObj(o) ? o.thumbnailOverlayTimeStatusRenderer : null)).filter(isObj)
  const live = arrayOf(v.badges).some((b) => isObj(b) && isObj(b.metadataBadgeRenderer) && b.metadataBadgeRenderer.style === 'BADGE_STYLE_TYPE_LIVE_NOW') ||
    overlays.some((o) => o.style === 'LIVE' || o.style === 'UPCOMING') ||
    Boolean(v.upcomingEventData)
  let duration = seconds(textOf(v.lengthText))
  if (duration === null) {
    for (const o of overlays) {
      if (duration === null) duration = seconds(textOf(o.text))
    }
  }
  return {
    videoId: v.videoId,
    title: textOf(v.title),
    channel: textOf(v.ownerText) || textOf(v.longBylineText) || textOf(v.shortBylineText),
    durationS: live || duration === null ? 0 : duration
  }
}

// Yeni biçim öğe (lockupViewModel). Yalnızca video türü okunur, oynatma listesi ve diğerleri null.
function readLockup (l) {
  if (!isObj(l) || l.contentType !== LOCKUP_VIDEO || typeof l.contentId !== 'string' || !VIDEO_ID_RE.test(l.contentId)) return null
  const meta = isObj(l.metadata) && isObj(l.metadata.lockupMetadataViewModel) ? l.metadata.lockupMetadataViewModel : null
  const cmv = meta && isObj(meta.metadata) && isObj(meta.metadata.contentMetadataViewModel) ? meta.metadata.contentMetadataViewModel : null
  const rows = cmv ? arrayOf(cmv.metadataRows) : []
  const tvm = isObj(l.contentImage) && isObj(l.contentImage.thumbnailViewModel) ? l.contentImage.thumbnailViewModel : null
  const badges = []
  for (const o of tvm ? arrayOf(tvm.overlays) : []) {
    if (!isObj(o)) continue
    const a = isObj(o.thumbnailBottomOverlayViewModel) ? arrayOf(o.thumbnailBottomOverlayViewModel.badges) : []
    const b = isObj(o.thumbnailOverlayBadgeViewModel) ? arrayOf(o.thumbnailOverlayBadgeViewModel.thumbnailBadges) : []
    for (const r of a.concat(b)) {
      if (isObj(r) && isObj(r.thumbnailBadgeViewModel)) badges.push(r.thumbnailBadgeViewModel)
    }
  }
  const live = badges.some((r) => {
    const source = isObj(r.icon) ? arrayOf(r.icon.sources)[0] : null
    return isObj(source) && isObj(source.clientResource) && source.clientResource.imageName === 'LIVE'
  })
  let duration = null
  for (const r of badges) {
    if (duration === null) duration = seconds(typeof r.text === 'string' ? r.text : '')
  }
  const firstRow = isObj(rows[0]) ? arrayOf(rows[0].metadataParts) : []
  const part = isObj(firstRow[0]) ? firstRow[0] : null
  return {
    videoId: l.contentId,
    title: meta ? textOf(meta.title) : '',
    channel: part ? textOf(part.text) : '',
    durationS: live || duration === null ? 0 : duration
  }
}

// Ağaçta (özyineleme yerine açık yığınla) tanınan video düğümlerini belge sırasıyla toplar. Reklam ve atlanacak
// kapsayıcıların alt ağaçlarına, video düğümlerinin içine ve maxDepth'ten derine inilmez. maxNodes aşılırsa hata.
// Aynı kimlik bir kez alınır (ilk görülen).
function collectVideos (root) {
  const out = []
  const seen = new Set()
  let recognized = false
  let nodes = 0
  // Öğeler [düğüm, derinlik, anahtar]. Çocuklar sondan başa itilir, böylece belge sırasıyla çıkar.
  const stack = [[root, 0, '']]
  while (stack.length > 0) {
    const top = stack.pop()
    const node = top[0]
    const depth = top[1]
    const key = top[2]
    nodes += 1
    if (nodes > LIMITS.maxNodes) throw responseError('too_many_nodes')
    if (key && (VIDEO_KEYS.has(key) || key === LOCKUP_KEY)) {
      recognized = true
      const item = key === LOCKUP_KEY ? readLockup(node) : readVideoRenderer(node)
      if (item && !seen.has(item.videoId)) {
        seen.add(item.videoId)
        out.push(item)
      }
      continue
    }
    if (key && STRUCTURE_KEYS.has(key)) recognized = true
    if (!node || typeof node !== 'object' || depth >= LIMITS.maxDepth) continue
    if (Array.isArray(node)) {
      let i = node.length
      while (i > 0) {
        i -= 1
        if (node[i] && typeof node[i] === 'object') stack.push([node[i], depth + 1, ''])
      }
      continue
    }
    const keys = Object.keys(node)
    let j = keys.length
    while (j > 0) {
      j -= 1
      const k = keys[j]
      const value = node[k]
      if (!value || typeof value !== 'object' || SKIP_KEYS.has(k) || isAdKey(k)) continue
      stack.push([value, depth + 1, k])
    }
  }
  return { items: out, recognized }
}

// InnerTube yanıtından ya da ytInitialData'dan çalınabilir sonuçlar (canlı ve süresiz öğeler atlanır). Yapı
// tanınmazsa search_failed (format) hatası atar. Sonuç yoksa boş dizi.
function parseSearchResponse (data) {
  if (!isObj(data)) throw responseError('format')
  const two = isObj(data.contents) && isObj(data.contents.twoColumnSearchResultsRenderer) ? data.contents.twoColumnSearchResultsRenderer : null
  const root = two && isObj(two.primaryContents) ? two.primaryContents : data
  const result = collectVideos(root)
  if (!result.recognized) throw responseError('format')
  return cleanResults(result.items.filter((item) => item.durationS > 0))
}

// Dizgi ve kaçış karakterini bilen süslü parantez sayacı: start'taki { karakterinin eşi, yoksa -1
function matchBrace (text, start) {
  let depth = 0
  let inString = false
  let escaped = false
  let i = start - 1
  while (i + 1 < text.length) {
    i += 1
    const c = text.charCodeAt(i)
    if (inString) {
      if (escaped) escaped = false
      else if (c === 92) escaped = true
      else if (c === 34) inString = false
      continue
    }
    if (c === 34) {
      inString = true
    } else if (c === 123) {
      depth += 1
    } else if (c === 125) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

// Sonuç sayfasındaki ytInitialData nesnesi, bulunamazsa veya ayrıştırılamazsa null
function extractInitialData (html) {
  if (typeof html !== 'string') return null
  for (const marker of DATA_MARKERS) {
    const at = html.indexOf(marker)
    if (at === -1) continue
    const start = at + marker.length
    if (html.charAt(start) !== '{') continue
    const end = matchBrace(html, start)
    if (end === -1) continue
    try {
      const data = JSON.parse(html.slice(start, end + 1))
      if (isObj(data)) return data
    } catch (err) {
      // Bir sonraki işaret denenir
    }
  }
  return null
}

// Sayfadaki ya da yanıttaki web istemcisi sürümü, desene uymuyorsa null
function readClientVersion (html, data) {
  const m = typeof html === 'string' ? CLIENT_VERSION_TEXT_RE.exec(html) : null
  if (m && CLIENT_VERSION_RE.test(m[1])) return m[1]
  const ctx = isObj(data) && isObj(data.responseContext) ? data.responseContext : null
  for (const service of ctx ? arrayOf(ctx.serviceTrackingParams) : []) {
    for (const p of isObj(service) ? arrayOf(service.params) : []) {
      if (isObj(p) && p.key === 'cver' && typeof p.value === 'string' && CLIENT_VERSION_RE.test(p.value)) return p.value
    }
  }
  return null
}

// ---------------------------------------------------------------- ağ

// İstek işlevi: { method, path, headers, body, maxBytes, timeoutMs } -> Promise<{ status, text }>. Yalnızca sabit
// sunucuya gider, yönlendirme izlenmez (3xx başarısızlıktır), sıkıştırma istenmez ve sıkıştırılmış yanıt kabul
// edilmez, gövde maxBytes'ı aşınca bağlantı kesilir. transport, host ve port yalnızca testler içindir.
function makeRequester (options) {
  const o = options || {}
  const transport = o.transport || https
  const host = o.host || HOST
  const port = o.port || 443
  const active = new Set()
  function request (opts) {
    return new Promise((resolve, reject) => {
      let settled = false
      let req = null
      const finish = (err, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        active.delete(req)
        if (err) {
          if (req) req.destroy()
          reject(err)
        } else {
          resolve(value)
        }
      }
      const timer = setTimeout(() => finish(searchError('search_failed', 'timeout', false)), Math.max(1, opts.timeoutMs || LIMITS.timeoutMs))
      try {
        req = transport.request({ host, port, method: opts.method, path: opts.path, headers: opts.headers }, (res) => {
          const status = res.statusCode
          if (status >= 300 && status < 400) {
            const location = String(res.headers.location || '')
            res.resume()
            finish(responseError(/consent\./i.test(location) ? 'consent_redirect' : 'redirect'))
            return
          }
          const encoding = String(res.headers['content-encoding'] || 'identity').toLowerCase()
          if (encoding !== 'identity') {
            res.resume()
            finish(responseError('encoding'))
            return
          }
          const declared = Number(res.headers['content-length'])
          if (Number.isFinite(declared) && declared > opts.maxBytes) {
            res.resume()
            finish(responseError('too_large'))
            return
          }
          const chunks = []
          let bytes = 0
          res.on('data', (chunk) => {
            if (settled) return
            bytes += chunk.length
            if (bytes > opts.maxBytes) {
              finish(responseError('too_large'))
              return
            }
            chunks.push(chunk)
          })
          res.on('end', () => finish(null, { status, text: Buffer.concat(chunks).toString('utf8') }))
          res.on('error', () => finish(searchError('search_failed', 'network', false)))
          res.on('aborted', () => finish(searchError('search_failed', 'network', false)))
        })
      } catch (err) {
        finish(searchError('search_failed', 'network', false))
        return
      }
      active.add(req)
      req.on('error', () => finish(searchError('search_failed', 'network', false)))
      if (opts.body !== undefined && opts.body !== null) req.write(opts.body)
      req.end()
    })
  }
  // Süren istekleri keser (sunucu kapanırken)
  request.abortAll = function abortAll () {
    for (const req of Array.from(active)) req.destroy(searchError('search_failed', 'closed', false))
    active.clear()
  }
  return request
}

// ---------------------------------------------------------------- arama

// options: { request, now, onBreak(reason, minutes) }. Sonuç { search(query), close(), status() }.
// search: Promise<[{ videoId, title, channel, durationS }]> (çalınabilir sonuçlar, sonuç yoksa boş dizi). Hata
// kodu search_failed. Devre kesici açıkken istek atılmadan search_failed döner.
function createYouTubeSearch (options) {
  const o = options || {}
  const request = typeof o.request === 'function' ? o.request : makeRequester()
  const now = typeof o.now === 'function' ? o.now : Date.now
  const onBreak = typeof o.onBreak === 'function' ? o.onBreak : noop
  let clientVersion = DEFAULT_CLIENT_VERSION
  let fails = 0
  let openUntil = 0

  function remaining (deadline) {
    return Math.max(1, deadline - now())
  }

  async function viaApi (query, deadline) {
    const body = JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US', utcOffsetMinutes: 0 }, user: {} },
      query,
      params: VIDEO_PARAMS
    })
    const res = await request({
      method: 'POST',
      path: SEARCH_PATH,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
        Accept: '*/*',
        'Accept-Language': 'en-US,en',
        'X-Youtube-Client-Name': '1',
        'X-Youtube-Client-Version': clientVersion,
        Origin: ORIGIN,
        Referer: ORIGIN + '/',
        'User-Agent': USER_AGENT,
        Cookie: CONSENT_COOKIE
      },
      body,
      maxBytes: LIMITS.jsonMaxBytes,
      timeoutMs: remaining(deadline)
    })
    if (res.status !== 200) throw responseError('status_' + Number(res.status))
    let data = null
    try {
      data = JSON.parse(res.text)
    } catch (err) {
      throw responseError('json')
    }
    return parseSearchResponse(data)
  }

  async function viaPage (query, deadline) {
    const qs = new URLSearchParams({ search_query: query, sp: VIDEO_SP, hl: 'en', gl: 'US' }).toString()
    const res = await request({
      method: 'GET',
      path: RESULTS_PATH + '?' + qs,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en',
        Referer: ORIGIN + '/',
        'User-Agent': USER_AGENT,
        Cookie: CONSENT_COOKIE
      },
      maxBytes: LIMITS.htmlMaxBytes,
      timeoutMs: remaining(deadline)
    })
    if (res.status !== 200) throw responseError('status_' + Number(res.status))
    const data = extractInitialData(res.text)
    if (!data) throw responseError('no_initial_data')
    const version = readClientVersion(res.text, data)
    if (version) clientVersion = version
    return parseSearchResponse(data)
  }

  async function search (query) {
    if (typeof query !== 'string' || query.trim() === '') throw searchError('search_failed', 'bad_query', false)
    if (now() < openUntil) throw searchError('search_failed', 'paused', false)
    const deadline = now() + LIMITS.timeoutMs
    let failure = null
    try {
      const results = await viaApi(query, deadline)
      fails = 0
      return results
    } catch (err) {
      failure = err
    }
    if (failure && failure.reason !== 'closed' && now() < deadline) {
      try {
        const results = await viaPage(query, deadline)
        fails = 0
        return results
      } catch (err) {
        // Gelen yanıtla ilgili ilk hata korunur (günlükteki neden InnerTube'unki olur)
        if (!failure.counts && err.counts) failure = err
      }
    }
    if (failure && failure.counts) {
      fails += 1
      if (fails >= LIMITS.breakerFails) {
        fails = 0
        openUntil = now() + LIMITS.breakerMs
        onBreak(failure.reason, Math.round(LIMITS.breakerMs / 60000))
      }
    }
    throw searchError('search_failed', failure ? failure.reason : 'unknown', false)
  }

  function close () {
    if (typeof request.abortAll === 'function') request.abortAll()
  }

  function status () {
    return { clientVersion, fails, pausedUntil: openUntil }
  }

  return { search, close, status }
}

module.exports = {
  LIMITS,
  DEFAULT_CLIENT_VERSION,
  VIDEO_PARAMS,
  createYouTubeSearch,
  makeRequester,
  parseSearchResponse,
  extractInitialData,
  readClientVersion,
  cleanResults,
  cleanText
}
