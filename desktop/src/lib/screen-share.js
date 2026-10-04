'use strict'

// Ekran paylaşımı kararları (Ek L1.9). Electron'a bağımlı değildir, ana süreç (src/main.js)
// bu işlevleri desktopCapturer, ekran seçici penceresi ve session işleyicileriyle birleştirir.
//
// Akış ve gerekçe:
// 1. Sayfa getDisplayMedia çağırır. Electron önce mediaTypes listesi boş bir 'media' izin isteği
//    üretir (src/lib/permissions.js bunu 'display' kararıyla buraya yönlendirir). Eski
//    chromeMediaSource: 'desktop' çağrısı da aynı isteği üretir ve izin verilirse seçici
//    olmadan ekranı yakalar. Bu yüzden onay noktası izin aşamasıdır: istek yalnızca son birkaç
//    saniyede gerçek bir kullanıcı girişi (tıklama veya tuş) olduysa kabul edilir ve kullanıcı
//    seçicide bir ekran veya pencere seçerse izin verilir. Seçim kısa süreli bir bekleyen kayıt
//    olarak saklanır.
// 2. Hemen ardından Electron setDisplayMediaRequestHandler işleyicisini çağırır. İstek yalnızca
//    telsiz://app ana çerçevesinden, kullanıcı hareketiyle ve görüntü isteyerek gelmişse bekleyen
//    seçim tüketilir ve o kaynak verilir. Seçim yoksa veya süresi geçmişse istek reddedilir.
// 3. İzin verildiği hâlde seçim kısa süre içinde tüketilmezse istek getDisplayMedia değildir
//    (eski yol), ana süreç sayfayı yeniden yükleyerek yakalamayı durdurur.
// Sistem sesi (audio: 'loopback') Electron belgelerine göre (electron.d.ts, Streams.audio) şu an
// yalnızca Windows'ta desteklenir, diğer sistemlerde seçenek gösterilmez. Sayfa sesi
// restrictOwnAudio ile ister. Electron 43.4 ve 44 ile sonraki sürümler bu istekte 'loopback'
// yanıtını uygulamanın kendi süreç ağacının sesi hariç yakalamaya (loopbackWithoutChrome) çevirir,
// böylece Telsiz'de çalan konuşmalar paylaşılan sese girmez. Bu ayrımı desteklemeyen eski Windows
// sürümlerinde Chromium düz yakalamaya döner.

const { originOf } = require('./navigation')

// Kullanıcı girişinden sonra ekran seçicinin açılabileceği en uzun süre
const ACTIVATION_WINDOW_MS = 5000
// İzin verildikten sonra seçimin getDisplayMedia işleyicisince tüketilmesi gereken süre
const PENDING_TTL_MS = 3000
// Kullanıcının seçicide karar vermesi için en uzun süre
const PICKER_TIMEOUT_MS = 2 * 60 * 1000
const MAX_SOURCES = 60
const MAX_NAME_LENGTH = 200
const MAX_THUMBNAIL_CHARS = 2 * 1024 * 1024
const SOURCE_ID_RE = /^(screen|window):[0-9A-Za-z_-]{1,40}:[0-9A-Za-z_-]{1,40}$/
const THUMBNAIL_PREFIX = 'data:image/png;base64,'
const THUMBNAIL_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/

// Son gerçek kullanıcı girişi ekran seçiciyi açmaya yetecek kadar yeni mi?
function hasRecentActivation (lastActivationAt, now) {
  return Number.isFinite(lastActivationAt) && lastActivationAt > 0 && now >= lastActivationAt && now - lastActivationAt <= ACTIVATION_WINDOW_MS
}

// setDisplayMediaRequestHandler isteği kabul edilebilir mi? request: { securityOrigin,
// videoRequested, audioRequested, userGesture }, frame: { url, isMainFrame } (çerçeve yoksa null)
function isAcceptableDisplayRequest (request, frame, allowedOrigin) {
  if (!request || typeof request !== 'object' || !frame) return false
  if (frame.isMainFrame !== true) return false
  if (typeof allowedOrigin !== 'string' || allowedOrigin === '') return false
  if (originOf(request.securityOrigin) !== allowedOrigin || originOf(frame.url) !== allowedOrigin) return false
  return request.userGesture === true && request.videoRequested === true
}

function cleanName (value) {
  const text = typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim() : ''
  return Array.from(text).slice(0, MAX_NAME_LENGTH).join('')
}

// desktopCapturer kaynaklarından seçiciye gönderilecek düz liste. sources: [{ id, name,
// thumbnail }] (thumbnail burada data:image/png;base64 dizgesi olmalıdır). Geçersiz kaynaklar
// atlanır, ekranlar önce gelir.
function toPickerSources (sources) {
  const out = []
  const seen = new Set()
  for (const source of Array.isArray(sources) ? sources : []) {
    if (!source || typeof source.id !== 'string' || !SOURCE_ID_RE.test(source.id) || seen.has(source.id)) continue
    const thumb = typeof source.thumbnail === 'string' && source.thumbnail.length <= MAX_THUMBNAIL_CHARS && THUMBNAIL_RE.test(source.thumbnail)
      ? source.thumbnail
      : ''
    seen.add(source.id)
    out.push({ id: source.id, name: cleanName(source.name), type: source.id.startsWith('screen:') ? 'screen' : 'window', thumbnail: thumb })
    if (out.length >= MAX_SOURCES) break
  }
  out.sort((a, b) => (a.type === b.type ? 0 : a.type === 'screen' ? -1 : 1))
  return out
}

// Seçicinin bildirdiği seçimi doğrular. offered: toPickerSources sonucu, choice: { id, systemAudio }
// Sonuç: { video: { id, name }, systemAudio } veya null
function resolveChoice (offered, choice, platform) {
  if (!choice || typeof choice !== 'object' || typeof choice.id !== 'string') return null
  const source = (Array.isArray(offered) ? offered : []).find((item) => item.id === choice.id)
  if (!source) return null
  return {
    video: { id: source.id, name: source.name },
    systemAudio: choice.systemAudio === true && systemAudioSupported(platform)
  }
}

function systemAudioSupported (platform) {
  return platform === 'win32'
}

// Bekleyen seçimden setDisplayMediaRequestHandler yanıtı. Seçim yoksa boş nesne (ret).
function buildStreams (pending, request, platform) {
  if (!pending || !pending.video) return {}
  const streams = { video: { id: pending.video.id, name: pending.video.name } }
  if (pending.systemAudio === true && request && request.audioRequested === true && systemAudioSupported(platform)) {
    streams.audio = 'loopback'
  }
  return streams
}

// Bekleyen seçimin hâlâ geçerli olup olmadığı
function isPendingFresh (pending, contentsId, now) {
  return Boolean(pending) && pending.contentsId === contentsId && now >= pending.createdAt && now - pending.createdAt <= PENDING_TTL_MS
}

module.exports = {
  ACTIVATION_WINDOW_MS,
  PENDING_TTL_MS,
  PICKER_TIMEOUT_MS,
  MAX_SOURCES,
  THUMBNAIL_PREFIX,
  hasRecentActivation,
  isAcceptableDisplayRequest,
  toPickerSources,
  resolveChoice,
  systemAudioSupported,
  buildStreams,
  isPendingFresh
}
