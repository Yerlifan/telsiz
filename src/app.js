'use strict'

// Telsiz HTTP sunucusu: yönlendirme, uç noktalar, rol yetkileri, hız sınırları, yüklemeler,
// hesaplar ve kişisel anahtarlar, profiller, durumlar ve oturumlar, arkadaşlar, engellemeler,
// özel mesajlar, özel mesajda sesli ve görüntülü arama, yazıyor bildirimleri, Telsiz DJ müzik durumu, statik beyaz
// liste ve düzgün kapanış.
// Sunucu parolayı hiç görmez (istemci authKey gönderir). Mesaj gövdelerini, profil zarflarını,
// token'ları, authKey değerlerini ve anahtarları hiçbir zaman loglamaz.
// API hata metinleri isteğin Accept-Language başlığına, günlük metinleri lang seçeneğine göre
// Türkçe veya İngilizcedir (src/i18n.js).

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { pipeline } = require('node:stream')
const { openStore, StoreError } = require('./store')
const auth = require('./auth')
const util = require('./http-util')
const { createHub } = require('./hub')
const { createSocial } = require('./social')
const { createMusic } = require('./music')
const { createCalls } = require('./calls')
const i18n = require('./i18n')
const runtime = require('./runtime')
const staticSource = require('./static-source')
const systemInfo = require('./system-info')

const DEFAULT_SERVER_NAME = 'Telsiz'
// Varsayılan günlük dili (server.js konsol dilini verir)
const DEFAULT_LOG_LANG = 'tr'
// SEA içinde derlemeye gömülen, değilse package.json'daki sürüm
const VERSION = runtime.version()
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_TIMER_MS = 2147483647

const DEFAULTS = Object.freeze({
  dataDir: null,
  serverName: DEFAULT_SERVER_NAME,
  setupCode: null,
  pollTimeoutMs: 25000,
  graceMs: 15000,
  sweepIntervalMs: 5000,
  eventBufferSize: 2000,
  maxWaitersPerSession: 2,
  scryptN: 16384,
  // Parola karmaları (scrypt) dosya işlemleriyle aynı libuv iş parçacığı havuzunda çalışır (varsayılan 4
  // iş parçacığı). Aynı anda en fazla hashConcurrency karma hesaplanır, en fazla hashQueueMax istek sırada
  // bekler, sıra doluysa istek 503 server_busy alır. Böylece çok sayıda adresten gelen giriş denemeleri
  // diske yazmayı ve dosya sunmayı durduramaz.
  hashConcurrency: 2,
  hashQueueMax: 32,
  maxUsers: 500,
  maxSessionsPerUser: 10,
  sessionTtlMs: 90 * DAY_MS,
  maxChannels: 50,
  maxVoicePerChannel: 8,
  maxBodyChars: 24000,
  // Şifreli ses sinyal zarfı. Ekran paylaşımı (Ek L1.10) görüntü parçalı SDP taşır: Chromium'da ölçülen
  // zarf yaklaşık 6400 ile 10000 karakter, çok ağ arayüzlü (çok ICE adaylı) makinelerde daha büyük. 16000
  // pay bırakmıyordu, 32000 en kötü ölçümün üç katıdır ve genel JSON gövde sınırının (65536) altındadır.
  maxSignalChars: 32000,
  maxJsonBytes: 65536,
  uploadMaxBytes: 25 * 1024 * 1024 + 16,
  uploadQuotaBytes: 2048 * 1024 * 1024,
  // Kullanıcı başına kota: kullanıcının hâlâ kayıtlı (mesaja, profile bağlı veya bekleyen) yüklemelerinin
  // toplam boyutu. Verilmezse ve tek dosya sınırından küçükse tek dosya sınırına yükseltilir.
  userUploadQuotaBytes: 512 * 1024 * 1024,
  maxUploadsPerMessage: 10,
  // İki kişi ikişer dosyayı birlikte yükleyebilsin diye altı: dört yer onlara gider, kalan iki yerden sonuncusu
  // yalnızca hiç yer tutmayan hesap ve adrese verilir (handleUpload)
  maxConcurrentUploads: 6,
  // Yükleme en az bu ortalama hızla sürmelidir (ilk uploadRateGraceMs süresinden sonra denetlenir). Bir kişi
  // damlatılan gövdeyle eşzamanlı yükleme yerlerini uzun süre tutamaz. 32 KB/sn (256 kbit/sn) yavaş bir mobil
  // bağlantının yükleme hızının da altındadır. Sınır bağlantının toplamına uygulanır: aynı hesabın veya aynı
  // adresin eşzamanlı yüklemeleri bu hızı aralarında paylaşır (istemci iki dosyayı birlikte gönderir), bir
  // yüklemeye düşen pay hiçbir zaman hızın yarısından az olmaz (MAX_UPLOADS_PER_USER). Ortalama denetimi süreyi
  // de sınırlar: her denetimde gönderilen bayt o ana kadar biriken paydan az olamaz, gönderilen bayt da dosya
  // boyutunu aşamaz. Ayrıca her istek en çok REQUEST_TIMEOUT_MS (15 dakika) sürebilir. Bu yüzden bir yükleme
  // yerini en çok min(15 dakika, max(uploadRateGraceMs, boyut / pay) ile bir denetim aralığı) kadar tutar: 25 MB
  // için tek başına yaklaşık 13,5 dakika, iki dosya birlikte yüklenirken 15 dakikalık istek sınırı.
  uploadMinBytesPerSec: 32768,
  uploadRateGraceMs: 30000,
  orphanUploadTtlMs: 3600000,
  maxMessagesPerChannel: 20000,
  // Tüm kanallardaki toplam mesaj sınırı (bellek koruması). Aşılınca yeni mesaj reddedilmez, en çok
  // mesajı olan kanalların en eski mesajları düşer (src/store.js trimTotal).
  maxTotalMessages: 500000,
  authLimit: 20,
  authWindowMs: 600000,
  loginFailLimit: 10,
  loginFailWindowMs: 900000,
  messageLimit: 5,
  messageWindowMs: 5000,
  uploadLimit: 10,
  uploadWindowMs: 60000,
  adminLimit: 30,
  adminWindowMs: 60000,
  signalLimit: 120,
  signalWindowMs: 10000,
  // Ses odasına katılma, ayrılma, mikrofon ve kamera durumu: kullanıcı başına 30 / signalWindowMs. Her biri
  // herkese tam meta yayını tetikler, sinyal iletilerinden daha sıkı sınırlanır.
  voiceLimit: 30,
  friendRequestLimit: 20,
  friendRequestWindowMs: 600000,
  // Yazıyor bildirimleri: kullanıcı başına 30 / 10 sn, bildirim 6 sn sonra kendiliğinden düşer
  typingLimit: 30,
  typingWindowMs: 10000,
  typingTtlMs: 6000,
  // Telsiz DJ durum yazımları: kullanıcı başına 30 / 10 sn. Boşalan ses odasının müzik durumu 30 dk sonra
  // bellekten silinir.
  musicLimit: 30,
  musicWindowMs: 10000,
  musicIdleMs: 30 * 60 * 1000,
  // Özel mesaj aramaları: başlatma ve reddetme kullanıcı başına 10 / 60 sn, cevaplanmayan arama 45 sn sonra düşer
  callLimit: 10,
  callWindowMs: 60000,
  callRingMs: 45000,
  maxFriends: 300,
  maxPendingRequests: 100,
  maxDmsPerUser: 500,
  maxProfileChars: 6000,
  avatarMaxBytes: 1024 * 1024 + 16,
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  trustedProxies: ['loopback'],
  // Statik dosyaların klasörü. Verilmezse SEA içinde gömülü dosyalar, değilse sunucu kodunun
  // yanındaki public klasörü kullanılır. staticSource verilirse ikisinin yerine geçer.
  publicDir: null,
  staticSource: null,
  lang: DEFAULT_LOG_LANG,
  log: console
})

// En az 1 olması gereken tamsayı seçenekleri
const POSITIVE_OPTIONS = [
  'pollTimeoutMs', 'sweepIntervalMs', 'eventBufferSize', 'maxWaitersPerSession', 'maxUsers',
  'maxSessionsPerUser', 'sessionTtlMs', 'maxChannels', 'maxVoicePerChannel', 'maxBodyChars',
  'maxSignalChars', 'maxJsonBytes', 'uploadMaxBytes', 'uploadQuotaBytes', 'maxUploadsPerMessage',
  'maxConcurrentUploads', 'orphanUploadTtlMs', 'maxMessagesPerChannel', 'authLimit', 'authWindowMs',
  'loginFailLimit', 'loginFailWindowMs', 'messageLimit', 'messageWindowMs', 'uploadLimit',
  'uploadWindowMs', 'adminLimit', 'adminWindowMs', 'signalLimit', 'signalWindowMs',
  'friendRequestLimit', 'friendRequestWindowMs', 'maxFriends', 'maxPendingRequests', 'maxDmsPerUser',
  'maxProfileChars', 'avatarMaxBytes', 'typingLimit', 'typingWindowMs', 'typingTtlMs', 'musicLimit',
  'musicWindowMs', 'musicIdleMs', 'userUploadQuotaBytes', 'maxTotalMessages', 'callLimit', 'callWindowMs',
  'callRingMs', 'voiceLimit', 'hashConcurrency', 'hashQueueMax', 'uploadMinBytesPerSec', 'uploadRateGraceMs'
]
const TIMER_OPTIONS = ['pollTimeoutMs', 'graceMs', 'sweepIntervalMs', 'typingTtlMs', 'callRingMs', 'uploadRateGraceMs']

// Yazı kanalı ve profil zarfı (grup anahtarı) ile özel mesaj zarfı (kişisel anahtarlar)
const ENVELOPE_RE = /^1\.[0-9a-f]{16}\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{24,}$/
const DM_ENVELOPE_RE = /^2\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{24,}$/
const UPLOAD_ID_RE = /^[0-9a-f]{32}$/
const PEER_ID_RE = /^[0-9a-f]{16}$/
const KID_RE = /^[0-9a-f]{16}$/
const SESSION_HASH_RE = /^[0-9a-f]{64}$/
const SERVER_SECRET_RE = /^[0-9a-f]{64}$/
const SESSION_ID_RE = /^[0-9a-f]{16}$/
// İstemcinin her yeni mesaj için ürettiği, yeniden göndermede aynı kalan kimlik
const CLIENT_MESSAGE_ID_RE = /^[0-9a-f]{16,64}$/
// Kullanıcı başına hatırlanan son istemci kimliği sayısı
const CLIENT_IDS_PER_USER = 50
const ROLES = new Set(['owner', 'admin', 'member'])
// Özel roller (yalnızca sahip yönetir): izin ve renk anahtarları, en fazla rol sayısı. Rollerin dizideki sırası
// rütbedir, ilk rol en üsttedir. Sahip ve yönetici her izne sahiptir, özel rol yalnızca üyeye izin kazandırır.
const ROLE_PERMS = ['messages', 'ban', 'voice', 'channels', 'dj']
const ROLE_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink']
const MAX_ROLES = 20
// Ses odası denetimi eylemleri (POST /api/voice/moderate)
const VOICE_MOD_ACTIONS = ['mute', 'unmute', 'disconnect', 'camera-off']
const STATUSES = new Set(['online', 'idle', 'dnd', 'invisible'])
const MANAGED_TYPES = new Set(['text', 'voice'])
const IDENTITY_MAX_CHARS = 2000
// Telsiz DJ şifreli durum zarfı (istemcideki TelsizMusic LIMITS.maxEnvChars ile aynı). En kötü durum
// (101 parça, en uzun adlar, dolu gone listesi) yaklaşık 105000 karakterdir.
const MUSIC_ENV_MAX_CHARS = 131072
// POST /api/music/state gövde sınırı: zarf ve alan adları için pay (genel maxJsonBytes yetmez)
const MUSIC_JSON_MAX_BYTES = 140000
// Her müzik yazımı bütün odaların haritasını (her odanın zarfı) uzun poll'daki herkese gönderir. Her yazım,
// haritada yazanın kendi yazdığı zarfların toplamı kadar (yeni zarf ve başka odalarda güncel zarfı hâlâ ona ait
// olanlar) bütçe harcar. Kullanıcı başına musicWindowMs içindeki toplam bu sınırı aşamaz: tek bir üye birkaç
// odaya en büyük zarfları bırakıp saniyede birkaç yazımla sunucunun çıkış bant genişliğini tüketemez. Başka
// odaların veya başka kişilerin zarfları yazana yüklenmez, böylece bir odadaki olağan DJ kullanımı diğer odaların
// durumu yüzünden kısılmaz (olağan kuyruklarda sınıra yaklaşılmaz).
const MUSIC_FANOUT_CHARS = 1024 * 1024
// Ses odası sınırları (frekans ayarı, yalnızca sahip değiştirir). Kapasite yeni katılımlara uygulanır,
// kimse odadan çıkarılmaz. maxVoicePerChannel seçeneği kapasitenin varsayılanıdır (bu aralığa sıkıştırılır).
const VOICE_CAPACITY_MIN = 2
const VOICE_CAPACITY_MAX = 12
// Oda başına aynı anda açık kamera sayısı, hiçbir zaman kapasiteden fazla olamaz
const MAX_CAMERAS_MIN = 1
const MAX_CAMERAS_MAX = 12
const DEFAULT_MAX_CAMERAS = 4
// Özel mesaj aramasının odası: yalnızca konuşmanın iki üyesi, ikisi de kamera açabilir (frekansın maxCameras ayarı
// uygulanmaz, sahibin kameraları kapatması uygulanır)
const CALL_CAPACITY = 2
const CALL_MAX_CAMERAS = 2
const VOICE_SETTING_KEYS = ['capacity', 'cameras', 'maxCameras']
const MUSIC_SETTING_KEYS = ['enabled', 'youtube', 'restricted']
const PROFILE_IDS_MAX = 100
// Silinmiş hesap kayıtları da (mesaj yazarı olarak) tutulduğu için toplam kayıt ayrıca sınırlanır
const USER_RECORDS_FACTOR = 4
const MESSAGE_MAX_CHARS = 2000
const MESSAGES_PAGE_DEFAULT = 50
const MESSAGES_PAGE_MAX = 100
// Oturumun son kullanım zamanı diske en fazla dakikada bir yazılır
const LAST_USED_RESOLUTION_MS = 60000
// Bu süre boyunca hiç veri gelmeyen yükleme iptal edilir
const UPLOAD_IDLE_MS = 60000
// Yükleme hızı denetiminin aralığı (ilk denetim DEFAULTS.uploadRateGraceMs sonunda)
const UPLOAD_RATE_CHECK_MS = 5000
// Bir kişinin ve bir istemci adresinin (IPv6'da /64 öneki) aynı anda sürdürebileceği yükleme sayısı (istemci
// en fazla iki dosyayı birlikte yükler). Genel sınır (maxConcurrentUploads) daha küçükse o geçerlidir. Son boş
// yer ayrıca yalnızca hiç yer tutmayan hesap ve adrese verilir (handleUpload).
const MAX_UPLOADS_PER_USER = 2
// Kapanışta açık bağlantılar için tanınan süre
const CLOSE_GRACE_MS = 2000
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000
// JSON gövdesi bu süre içinde tamamlanmazsa bağlantı kesilir (en büyük gövde 140 KB, en yavaş meşru
// istemci için bile geniş pay). Yükleme gövdeleri bu sınıra değil UPLOAD_IDLE_MS'ye tabidir.
const JSON_BODY_TIMEOUT_MS = 60000
const UPLOAD_PREFIX = '/api/uploads/'
// Hesap adı başına başarısız giriş sınırı (bütün adresler toplamı), hesap ve adres başına sınırın bu katıdır.
// Küçük tutulur: işaretsiz girişlerle bir hesap için yapılabilecek parola denemesi adres sayısıyla artmaz
// (varsayılan 15 dakikada 20). Giriş cihazı işareti olan istekler bu sınıra takılmaz.
const LOGIN_NAME_FAIL_FACTOR = 2
// Frekans fotoğrafı: içeriğin sha256 karmasının ilk 32 onaltılık hanesi (sürüm ve ETag), yalnızca PNG, JPEG
// ve WebP (gerçek dosya imzasıyla, Content-Type başlığına bakılmaz). SVG kabul edilmez.
const SERVER_ICON_HASH_RE = /^[0-9a-f]{32}$/
const SERVER_ICON_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
// Açılışta diskteki fotoğraf için en büyük okuma boyutu (sınır sonradan düşürülse de kayıtlı fotoğraf korunur)
const SERVER_ICON_READ_MAX = 16 * 1024 * 1024
// Varsayılan temanın (Arcade) koyu zemin rengi
const MANIFEST_COLOR = '#0f1015'

// İlk kurulumda oluşturulan kanallar, adları günlük dilinde
const DEFAULT_CHANNELS = [
  { key: 'defaults.channelGeneral', type: 'text', position: 0 },
  { key: 'defaults.channelGaming', type: 'text', position: 1 },
  { key: 'defaults.channelVoice1', type: 'voice', position: 0 },
  { key: 'defaults.channelVoice2', type: 'voice', position: 1 }
]

const STATIC_FILES = new Map()
function addStatic (urlPath, file, type, csp) {
  STATIC_FILES.set(urlPath, { file, type, csp })
}
const HTML_TYPE = 'text/html; charset=utf-8'
const JS_TYPE = 'text/javascript; charset=utf-8'
const TEXT_TYPE = 'text/plain; charset=utf-8'
const CSS_TYPE = 'text/css; charset=utf-8'
const WASM_TYPE = 'application/wasm'
addStatic('/', 'index.html', HTML_TYPE, util.HTML_CSP)
addStatic('/index.html', 'index.html', HTML_TYPE, util.HTML_CSP)
addStatic('/i18n.js', 'i18n.js', JS_TYPE, util.API_CSP)
addStatic('/theme-init.js', 'theme-init.js', JS_TYPE, util.API_CSP)
addStatic('/crypto.js', 'crypto.js', JS_TYPE, util.API_CSP)
addStatic('/emoji.js', 'emoji.js', JS_TYPE, util.API_CSP)
addStatic('/voice.js', 'voice.js', JS_TYPE, util.API_CSP)
// Gelişmiş gürültü engelleme: voice.js'in ses bağlamına yüklediği AudioWorklet işlemcisi
addStatic('/rnnoise-worklet.js', 'rnnoise-worklet.js', JS_TYPE, util.API_CSP)
addStatic('/music.js', 'music.js', JS_TYPE, util.API_CSP)
addStatic('/dj/youtube.js', 'dj/youtube.js', JS_TYPE, util.API_CSP)
// Service worker kendi yanıtının CSP'sini kullanır, sayfa ile aynı politika verilir
addStatic('/sw.js', 'sw.js', JS_TYPE, util.HTML_CSP)
addStatic('/style.css', 'style.css', CSS_TYPE, util.API_CSP)
addStatic('/favicon.svg', 'favicon.svg', 'image/svg+xml', util.API_CSP)
addStatic('/icons/icon-192.png', 'icons/icon-192.png', 'image/png', util.API_CSP)
addStatic('/icons/icon-512.png', 'icons/icon-512.png', 'image/png', util.API_CSP)
addStatic('/icons/apple-touch-icon.png', 'icons/apple-touch-icon.png', 'image/png', util.API_CSP)
addStatic('/vendor/nacl-fast.min.js', 'vendor/nacl-fast.min.js', JS_TYPE, util.API_CSP)
addStatic('/vendor/TWEETNACL-LICENSE.txt', 'vendor/TWEETNACL-LICENSE.txt', TEXT_TYPE, util.API_CSP)
addStatic('/vendor/scrypt.js', 'vendor/scrypt.js', JS_TYPE, util.API_CSP)
addStatic('/vendor/SCRYPT-JS-LICENSE.txt', 'vendor/SCRYPT-JS-LICENSE.txt', TEXT_TYPE, util.API_CSP)
// RNNoise'un WebAssembly derlemesi ve lisansları (@shiguredo/rnnoise-wasm 2022.2.0, değiştirilmemiş kopya)
addStatic('/vendor/rnnoise/rnnoise.wasm', 'vendor/rnnoise/rnnoise.wasm', WASM_TYPE, util.API_CSP)
addStatic('/vendor/rnnoise/RNNOISE-LICENSE.txt', 'vendor/rnnoise/RNNOISE-LICENSE.txt', TEXT_TYPE, util.API_CSP)
addStatic('/vendor/rnnoise/RNNOISE-WASM-LICENSE.txt', 'vendor/rnnoise/RNNOISE-WASM-LICENSE.txt', TEXT_TYPE, util.API_CSP)

// Desenle sunulan klasörler: yalnızca adı desene uyan, alt klasörü olmayan dosyalar. Desenler
// bölü, ters bölü, yüzde ve ardışık nokta içeremez, bu yüzden yol geçişi mümkün değildir.
const STATIC_DIRS = [
  { prefix: '/js/', dir: 'js', pattern: /^[0-9a-z-]+\.js$/, type: JS_TYPE, csp: util.API_CSP },
  { prefix: '/css/', dir: 'css', pattern: /^[0-9a-z-]+\.css$/, type: CSS_TYPE, csp: util.API_CSP },
  { prefix: '/css/skins/', dir: 'css/skins', pattern: /^[0-9a-z-]+\.css$/, type: CSS_TYPE, csp: util.API_CSP },
  { prefix: '/fonts/', dir: 'fonts', pattern: /^[a-z0-9-]+\.woff2$/, type: 'font/woff2', csp: util.API_CSP },
  { prefix: '/fonts/', dir: 'fonts', pattern: /^[A-Za-z0-9-]+\.txt$/, type: TEXT_TYPE, csp: util.API_CSP }
]
// Windows'ta aygıt adları (ör. con.js) dosya değil aygıt açar, bunlar hiç denenmez
const WINDOWS_DEVICE_RE = /^(con|prn|aux|nul|com\d|lpt\d)\./i

// Yol için beyaz liste girdisi: { file, type, csp } veya null
function staticEntry (pathname) {
  const fixed = STATIC_FILES.get(pathname)
  if (fixed) return fixed
  for (const def of STATIC_DIRS) {
    if (!pathname.startsWith(def.prefix)) continue
    const name = pathname.slice(def.prefix.length)
    if (!def.pattern.test(name) || WINDOWS_DEVICE_RE.test(name)) continue
    return { file: def.dir + '/' + name, type: def.type, csp: def.csp }
  }
  return null
}

function noop () {}

function isId (value) {
  return Number.isSafeInteger(value) && value >= 1
}

// JSON sayısı veya ondalık dizge olarak verilen pozitif kimlik, geçersizse null
function toId (value) {
  if (typeof value === 'number') return isId(value) ? value : null
  if (typeof value === 'string' && /^[1-9]\d{0,14}$/.test(value)) return Number(value)
  return null
}

function parseNonNegative (value) {
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) return null
  return Number(value)
}

// İsteğe bağlı sorgu sayacı: verilmemişse (veya boşsa) undefined, geçersizse null
function optionalCounter (raw) {
  if (raw === null || raw === '') return undefined
  return parseNonNegative(raw)
}

function errText (err, lang) {
  if (!err) return i18n.t(lang, 'log.unknownError')
  const code = err.code ? String(err.code) + ' ' : ''
  return code + String(err.message || err).slice(0, 300)
}

// Hata kaydı: ad, kod, ileti ve yığın satırları (istek içeriği hiçbir zaman eklenmez)
function describeError (err, lang) {
  if (!err) return i18n.t(lang, 'log.unknownError')
  const head = (err.name || 'Error') + (err.code ? ' [' + err.code + ']' : '') + ': ' + String(err.message || '').slice(0, 300)
  const frames = typeof err.stack === 'string' ? err.stack.split('\n').filter((line) => /^\s+at /.test(line)).slice(0, 8) : []
  return [head].concat(frames).join('\n')
}

function makeLogger (log) {
  if (log === null || log === false) return { info: noop, warn: noop, error: noop }
  const target = log || console
  function pick (name) {
    let fn = noop
    if (typeof target[name] === 'function') fn = target[name]
    else if (typeof target.log === 'function') fn = target.log
    return (text) => {
      try {
        fn.call(target, text)
      } catch (err) {
        // log hatası sunucuyu etkilememeli
      }
    }
  }
  return { info: pick('info'), warn: pick('warn'), error: pick('error') }
}

function cleanIceServers (list) {
  if (!Array.isArray(list)) throw new TypeError('createChatServer: iceServers must be an array.')
  return list.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new TypeError('createChatServer: invalid iceServers entry.')
    const urls = Array.isArray(entry.urls) ? entry.urls.slice() : entry.urls
    const urlList = Array.isArray(urls) ? urls : [urls]
    if (urlList.length === 0 || !urlList.every((u) => typeof u === 'string' && u !== '')) {
      throw new TypeError('createChatServer: invalid iceServers urls.')
    }
    const out = { urls }
    if (typeof entry.username === 'string') out.username = entry.username
    if (typeof entry.credential === 'string') out.credential = entry.credential
    return out
  })
}

function resolveOptions (options) {
  if (!options || typeof options !== 'object') throw new TypeError('createChatServer: an options object is required.')
  const config = Object.assign({}, DEFAULTS)
  for (const key of Object.keys(options)) {
    if (options[key] !== undefined) config[key] = options[key]
  }
  if (typeof config.dataDir !== 'string' || config.dataDir === '') {
    throw new TypeError('createChatServer: the dataDir option is required.')
  }
  for (const key of POSITIVE_OPTIONS) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) {
      throw new TypeError('createChatServer: ' + key + ' must be a positive integer.')
    }
  }
  if (options.userUploadQuotaBytes === undefined && config.userUploadQuotaBytes < config.uploadMaxBytes) {
    config.userUploadQuotaBytes = config.uploadMaxBytes
  }
  if (!Number.isSafeInteger(config.graceMs) || config.graceMs < 0) {
    throw new TypeError('createChatServer: graceMs must be a non-negative integer.')
  }
  for (const key of TIMER_OPTIONS) {
    if (config[key] > MAX_TIMER_MS) throw new TypeError('createChatServer: ' + key + ' is too large.')
  }
  const n = config.scryptN
  if (!Number.isSafeInteger(n) || n < 2 || n > 1048576 || (n & (n - 1)) !== 0) {
    throw new TypeError('createChatServer: scryptN must be a power of two.')
  }
  if (!i18n.LANGS.includes(config.lang)) throw new TypeError('createChatServer: lang must be one of ' + i18n.LANGS.join(', ') + '.')
  config.serverName = auth.cleanServerName(config.serverName) || DEFAULT_SERVER_NAME
  config.iceServers = cleanIceServers(config.iceServers)
  const proxies = auth.parseTrustedProxies(config.trustedProxies)
  if (proxies === null) throw new TypeError('createChatServer: invalid trustedProxies.')
  config.trustedProxies = proxies
  if (config.publicDir !== null && (typeof config.publicDir !== 'string' || config.publicDir === '')) {
    throw new TypeError('createChatServer: invalid publicDir.')
  }
  if (config.publicDir !== null) config.publicDir = path.resolve(config.publicDir)
  if (config.staticSource === null) config.staticSource = staticSource.defaultSource(config.publicDir)
  else if (!staticSource.isSource(config.staticSource)) throw new TypeError('createChatServer: invalid staticSource.')
  if (config.setupCode !== null && auth.normalizeCode(config.setupCode) === null) {
    throw new TypeError('createChatServer: setupCode may contain only Crockford base32 characters.')
  }
  return config
}

function corruptError (store, kindKey, lang) {
  const file = path.join(store.dir, 'state.json')
  return new StoreError(i18n.t(lang, 'log.corruptRecord', { file, kind: i18n.t(lang, kindKey) }), 'corrupt')
}

// Özel rol kaydı: { id, name, color, perms }. Geçersizse null. İzinler ROLE_PERMS sırasıyla ve tekrarsız tutulur.
function cleanRole (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !isId(value.id)) return null
  const name = auth.cleanRoleName(value.name)
  if (name === null || !ROLE_COLORS.includes(value.color) || !Array.isArray(value.perms)) return null
  return { id: value.id, name, color: value.color, perms: ROLE_PERMS.filter((p) => value.perms.includes(p)) }
}

function publicRole (role) {
  return { id: role.id, name: role.name, color: role.color, perms: role.perms.slice() }
}

// Yüklenen durumun temel kayıtlarını denetler. Bozuksa hiçbir şeyi değiştirmeden hata fırlatır.
// Silinmiş hesaplar (deleted: true) adsız ve karmasız kalır, mesaj yazarı olarak tutulur.
function checkLoadedState (store, state, lang) {
  const userIds = new Set()
  const names = new Set()
  for (const u of state.users) {
    if (!isId(u.id) || typeof u.name !== 'string' || !ROLES.has(u.role) || userIds.has(u.id)) {
      throw corruptError(store, 'log.kindUser', lang)
    }
    userIds.add(u.id)
    if (u.deleted === true) continue
    if (u.name === '' || typeof u.passHash !== 'string' || names.has(u.name)) throw corruptError(store, 'log.kindUser', lang)
    names.add(u.name)
  }
  const channelIds = new Set()
  for (const c of state.channels) {
    if (!isId(c.id) || channelIds.has(c.id)) throw corruptError(store, 'log.kindChannel', lang)
    if (c.type === 'dm') {
      const m = c.members
      if (!Array.isArray(m) || m.length !== 2 || !userIds.has(m[0]) || !userIds.has(m[1]) || m[0] === m[1]) {
        throw corruptError(store, 'log.kindDm', lang)
      }
    } else if (!MANAGED_TYPES.has(c.type) || typeof c.name !== 'string') {
      throw corruptError(store, 'log.kindChannel', lang)
    }
    channelIds.add(c.id)
  }
}

// Hesap kaydının kişisel anahtar, profil ve durum alanlarını tamamlar ve doğrular.
// Değişiklik olduysa true döner. Geçersiz anahtar alanları null yapılır (kullanıcı parola
// sıfırlamasıyla yeni anahtar alır), geçersiz profil zarfı silinir.
function normalizeUserFields (u, config, log) {
  let changed = false
  if (typeof u.deleted !== 'boolean') {
    u.deleted = u.deleted === true
    changed = true
  }
  const key = u.deleted ? '' : u.name
  if (u.key !== key) {
    u.key = key
    changed = true
  }
  const kdf = u.kdf === undefined || u.kdf === null ? null : auth.cleanKdf(u.kdf)
  if (kdf === null && u.kdf !== undefined && u.kdf !== null && !u.deleted) {
    log.warn(i18n.t(config.lang, 'log.badKdf', { id: u.id }))
  }
  if (u.kdf === undefined || !sameJson(kdf, u.kdf)) {
    u.kdf = kdf
    changed = true
  }
  const checks = {
    publicKey: auth.isPublicKey,
    wrappedKey: auth.isWrappedKey,
    identity: (value) => validEnvelope(value, IDENTITY_MAX_CHARS),
    profile: (value) => validEnvelope(value, config.maxProfileChars),
    // Yükleme kaydıyla eşleşmesi normalizeAvatars içinde denetlenir
    avatarUploadId: (value) => typeof value === 'string' && UPLOAD_ID_RE.test(value)
  }
  for (const field of Object.keys(checks)) {
    if (u[field] === null) continue
    if (u[field] === undefined || !checks[field](u[field])) {
      u[field] = null
      changed = true
    }
  }
  if (typeof u.allowMemberDms !== 'boolean') {
    u.allowMemberDms = u.allowMemberDms !== false
    changed = true
  }
  if (!Number.isSafeInteger(u.pv) || u.pv < 0) {
    u.pv = 0
    changed = true
  }
  if (!STATUSES.has(u.status)) {
    u.status = 'online'
    changed = true
  }
  return changed
}

// Profil resmi bağlantıları: kullanıcının avatarUploadId değeri, kendisinin yüklediği, mesaja
// bağlı olmayan bir kayda işaret etmeli ve o kayıt profileUserId ile kullanıcıya bağlı olmalı.
// Eşleşmeyen bağlantılar kaldırılır (kayıt sahipsiz kalır ve taramada silinir). Değişiklik sayısı döner.
function normalizeAvatars (state) {
  const records = new Map()
  for (const rec of state.uploads) records.set(rec.id, rec)
  const linked = new Set()
  let fixes = 0
  for (const u of state.users) {
    if (u.avatarUploadId === null) continue
    const rec = records.get(u.avatarUploadId)
    if (u.deleted || !rec || rec.uploaderId !== u.id || rec.messageId !== null || linked.has(rec)) {
      u.avatarUploadId = null
      fixes++
      continue
    }
    linked.add(rec)
    if (rec.profileUserId !== u.id) {
      rec.profileUserId = u.id
      fixes++
    }
  }
  for (const rec of state.uploads) {
    if (rec.profileUserId === undefined || linked.has(rec)) continue
    if (rec.profileUserId !== null) fixes++
    delete rec.profileUserId
  }
  return fixes
}

// Zararsız eksikleri tamamlar. Değişiklik olduysa true döner.
function normalizeLoadedState (state, config, log) {
  const lang = config.lang
  let changed = false
  let maxUser = 0
  for (const u of state.users) {
    if (normalizeUserFields(u, config, log)) changed = true
    if (typeof u.banned !== 'boolean') {
      u.banned = u.banned === true
      changed = true
    }
    if (typeof u.createdAt !== 'number' || !Number.isFinite(u.createdAt)) {
      u.createdAt = 0
      changed = true
    }
    if (u.id > maxUser) maxUser = u.id
  }
  if (state.counters.user < maxUser) {
    state.counters.user = maxUser
    changed = true
  }

  let maxChannel = 0
  for (const c of state.channels) {
    if (c.type === 'dm') {
      if (c.members[0] > c.members[1]) {
        c.members = [c.members[1], c.members[0]]
        changed = true
      }
    } else if (!Number.isSafeInteger(c.position) || c.position < 0) {
      c.position = 1000000 + c.id
      changed = true
    }
    if (typeof c.createdAt !== 'number' || !Number.isFinite(c.createdAt)) {
      c.createdAt = 0
      changed = true
    }
    if (c.id > maxChannel) maxChannel = c.id
  }
  if (state.counters.channel < maxChannel) {
    state.counters.channel = maxChannel
    changed = true
  }
  if (!state.channels.some((c) => c.type === 'text')) {
    const name = i18n.t(lang, 'defaults.channelGeneral')
    state.counters.channel++
    state.channels.push({ id: state.counters.channel, name, type: 'text', position: 0, createdAt: Date.now() })
    log.warn(i18n.t(lang, 'log.textChannelCreated', { name }))
    changed = true
  }
  for (const type of ['text', 'voice']) {
    const list = state.channels.filter((c) => c.type === type).sort((a, b) => a.position - b.position || a.id - b.id)
    list.forEach((c, i) => {
      if (c.position !== i) {
        c.position = i
        changed = true
      }
    })
  }

  const userIds = new Set(state.users.map((u) => u.id))
  const seenSessions = new Set()
  const sessions = state.sessions.filter((s) => {
    if (typeof s.hash !== 'string' || !SESSION_HASH_RE.test(s.hash) || seenSessions.has(s.hash) || !userIds.has(s.userId)) return false
    seenSessions.add(s.hash)
    if (typeof s.createdAt !== 'number' || !Number.isFinite(s.createdAt)) s.createdAt = 0
    if (typeof s.lastUsed !== 'number' || !Number.isFinite(s.lastUsed)) s.lastUsed = s.createdAt
    if (s.label !== null && !auth.isSessionLabel(s.label)) s.label = null
    return true
  })
  if (sessions.length !== state.sessions.length) {
    log.warn(i18n.t(lang, 'log.invalidSessions', { count: state.sessions.length - sessions.length }))
    state.sessions = sessions
    changed = true
  }

  const seenUploads = new Set()
  const uploads = state.uploads.filter((r) => {
    if (typeof r.id !== 'string' || !UPLOAD_ID_RE.test(r.id) || seenUploads.has(r.id)) return false
    if (typeof r.size !== 'number' || !Number.isFinite(r.size) || r.size < 0) return false
    if (!isId(r.uploaderId) || typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt)) return false
    if (r.messageId !== null && !isId(r.messageId)) return false
    seenUploads.add(r.id)
    return true
  })
  if (uploads.length !== state.uploads.length) {
    log.warn(i18n.t(lang, 'log.invalidUploads', { count: state.uploads.length - uploads.length }))
    state.uploads = uploads
    changed = true
  }
  const avatarFixes = normalizeAvatars(state)
  if (avatarFixes > 0) {
    log.warn(i18n.t(lang, 'log.invalidAvatars', { count: avatarFixes }))
    changed = true
  }

  // Özel roller eski durum dosyalarında yoktur, boş listeyle başlar (yazım gerekmez)
  if (state.roles === undefined) {
    state.roles = []
  } else {
    const seenRoles = new Set()
    const roles = (Array.isArray(state.roles) ? state.roles : []).map(cleanRole).filter((r) => {
      if (!r || seenRoles.has(r.id)) return false
      seenRoles.add(r.id)
      return true
    }).slice(0, MAX_ROLES)
    if (!sameJson(roles, state.roles)) {
      log.warn(i18n.t(lang, 'log.invalidRoles'))
      state.roles = roles
      changed = true
    }
  }
  const maxRole = state.roles.reduce((max, r) => Math.max(max, r.id), 0)
  if (!Number.isSafeInteger(state.counters.role) || state.counters.role < maxRole) {
    if (state.counters.role !== undefined || maxRole > 0) changed = true
    state.counters.role = Math.max(maxRole, Number.isSafeInteger(state.counters.role) && state.counters.role > 0 ? state.counters.role : 0)
  }
  // Hesabın özel rolü ve ses susturması eski kayıtlarda yoktur (yazım gerekmez), silinen role bağlı rol kalkar
  const roleIds = new Set(state.roles.map((r) => r.id))
  for (const u of state.users) {
    if (u.roleId === undefined) {
      u.roleId = null
    } else if (u.roleId !== null && !roleIds.has(u.roleId)) {
      u.roleId = null
      changed = true
    }
    if (u.voiceMuted === undefined) {
      u.voiceMuted = false
    } else if (typeof u.voiceMuted !== 'boolean') {
      u.voiceMuted = u.voiceMuted === true
      changed = true
    }
    // Parola sıfırlandı, yeni parola bekleniyor (eski kayıtlarda yoktur): anahtarı olmayan hesap sıfırlanmış sayılır,
    // böylece yükseltmeden önce sıfırlanmış hesaba da geçici parolayla anahtar yüklenemez
    if (typeof u.resetPending !== 'boolean') u.resetPending = u.deleted !== true && u.wrappedKey === null
  }

  const invite = auth.normalizeCode(state.inviteCode)
  if (invite === null || invite.length !== 10) {
    state.inviteCode = auth.generateCode()
    changed = true
  }
  const serverName = auth.cleanServerName(state.serverName)
  if (serverName === null) {
    state.serverName = config.serverName
    changed = true
  }
  // Frekans fotoğrafı eski durum dosyalarında yoktur (yazım gerekmez), geçersiz kayıt silinir
  if (state.serverIcon === undefined) {
    state.serverIcon = null
  } else if (!sameJson(cleanServerIconRecord(state.serverIcon), state.serverIcon)) {
    state.serverIcon = cleanServerIconRecord(state.serverIcon)
    changed = true
  }
  // Frekans tanıtımı eski durum dosyalarında yoktur, boş metinle başlar (yazım gerekmez)
  if (state.about === undefined) {
    state.about = ''
  } else if (auth.cleanAbout(state.about) !== state.about) {
    state.about = auth.cleanAbout(state.about) || ''
    changed = true
  }
  if (state.activeKid !== null && !KID_RE.test(state.activeKid)) {
    state.activeKid = null
    changed = true
  }
  if (typeof state.serverSecret !== 'string' || !SERVER_SECRET_RE.test(state.serverSecret)) {
    state.serverSecret = auth.newServerSecret()
    changed = true
  }
  const music = cleanMusicSettings(state.music)
  if (!sameJson(music, state.music)) {
    state.music = music
    changed = true
  }
  // Ses odası ayarı eski durum dosyalarında yoktur, varsayılanlarla başlar (yazım gerekmez)
  const voice = cleanVoiceSettings(state.voice, defaultVoiceCapacity(config))
  if (state.voice === undefined) {
    state.voice = voice
  } else if (!sameJson(voice, state.voice)) {
    state.voice = voice
    changed = true
  }
  return changed
}

// Telsiz DJ sunucu ayarı: { enabled, youtube, restricted }. enabled ve youtube eksikse açık, restricted (kuyruğu
// odada DJ izni olan biri varken yalnızca o yönetir) eksikse kapalıdır.
function cleanMusicSettings (value) {
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : true,
    youtube: typeof src.youtube === 'boolean' ? src.youtube : true,
    restricted: typeof src.restricted === 'boolean' ? src.restricted : false
  }
}

function intInRange (value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max
}

// Varsayılan ses odası kapasitesi: maxVoicePerChannel seçeneği, izin verilen aralığa sıkıştırılmış
function defaultVoiceCapacity (config) {
  return Math.min(VOICE_CAPACITY_MAX, Math.max(VOICE_CAPACITY_MIN, config.maxVoicePerChannel))
}

// Ses odası ayarı: { capacity, cameras, maxCameras }. Eksik veya geçersiz alan varsayılana döner,
// kamera sınırı kapasiteyi aşamaz.
function cleanVoiceSettings (value, defaultCapacity) {
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const capacity = intInRange(src.capacity, VOICE_CAPACITY_MIN, VOICE_CAPACITY_MAX) ? src.capacity : defaultCapacity
  const maxCameras = intInRange(src.maxCameras, MAX_CAMERAS_MIN, MAX_CAMERAS_MAX) ? src.maxCameras : DEFAULT_MAX_CAMERAS
  return {
    capacity,
    cameras: typeof src.cameras === 'boolean' ? src.cameras : true,
    maxCameras: Math.min(maxCameras, capacity)
  }
}

function prepareState (store, config, log) {
  if (!store.state) {
    const state = store.initState({
      version: 2,
      serverName: config.serverName,
      // Frekans tanıtımı: sahibin yazdığı, herkese açık düz metin (GET /api/info)
      about: '',
      serverIcon: null,
      inviteCode: auth.generateCode(),
      activeKid: null,
      counters: { user: 0, channel: 0, message: 0, role: 0 },
      users: [],
      sessions: [],
      channels: [],
      uploads: [],
      // Ön giriş yanıtlarındaki sahte tuzlar için, hiçbir yanıtta gönderilmez
      serverSecret: auth.newServerSecret(),
      friendships: [],
      blocks: [],
      // Özel roller (sahip oluşturur, dizideki sıra rütbedir)
      roles: [],
      // Telsiz DJ varsayılan olarak açık gelir (Ek L2.1)
      music: { enabled: true, youtube: true, restricted: false },
      // Ses odası kapasitesi ve kameralar (sahip değiştirir)
      voice: cleanVoiceSettings(null, defaultVoiceCapacity(config))
    })
    const now = Date.now()
    for (const def of DEFAULT_CHANNELS) {
      state.counters.channel++
      state.channels.push({ id: state.counters.channel, name: i18n.t(config.lang, def.key), type: def.type, position: def.position, createdAt: now })
    }
    store.saveState()
    return state
  }
  const state = store.state
  checkLoadedState(store, state, config.lang)
  if (normalizeLoadedState(state, config, log)) store.saveState()
  return state
}

function publicUser (user) {
  return { id: user.id, name: user.name, role: user.role }
}

// Hub bu kayıttan başkalarına gösterilen biçimi üretir (görünmez durum hiçbir zaman gönderilmez)
function metaUser (user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    roleId: user.roleId === undefined ? null : user.roleId,
    voiceMuted: user.voiceMuted === true,
    pv: user.pv,
    status: user.status
  }
}

function ownKeys (user) {
  return { publicKey: user.publicKey, wrappedKey: user.wrappedKey }
}

function publicChannel (channel) {
  return { id: channel.id, name: channel.name, type: channel.type, position: channel.position }
}

function isStaff (user) {
  return user.role === 'owner' || user.role === 'admin'
}

function channelOrder (a, b) {
  if (a.type !== b.type) return a.type === 'text' ? -1 : 1
  return a.position - b.position || a.id - b.id
}

function validEnvelope (value, maxChars) {
  return typeof value === 'string' && value.length <= maxChars && ENVELOPE_RE.test(value)
}

function validDmEnvelope (value, maxChars) {
  return typeof value === 'string' && value.length <= maxChars && DM_ENVELOPE_RE.test(value)
}

function sameJson (a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// Dosya imzasından resim türü: image/png, image/jpeg, image/webp veya null
function imageType (data) {
  if (!Buffer.isBuffer(data) || data.length < 16) return null
  if (data.length >= 24 && data.subarray(0, 8).equals(PNG_SIGNATURE) && data.toString('latin1', 12, 16) === 'IHDR') return 'image/png'
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP' && /^VP8[ LX]$/.test(data.toString('latin1', 12, 16))) return 'image/webp'
  return null
}

function serverIconHash (data) {
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32)
}

// Kayıtlı frekans fotoğrafı: { hash, type, size } veya null
function cleanServerIconRecord (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (typeof value.hash !== 'string' || !SERVER_ICON_HASH_RE.test(value.hash) || !SERVER_ICON_TYPES.has(value.type)) return null
  if (!Number.isSafeInteger(value.size) || value.size <= 0) return null
  return { hash: value.hash, type: value.type, size: value.size }
}

// Açılışta kayıtlı fotoğrafı belleğe okur ve doğrular (tür ve karma). Dosya eksik veya bozuksa kayıt
// silinir. Kayıtlı fotoğraf dışındaki dosyalar (yarım kalmış yazımlar, eski fotoğraflar) temizlenir.
async function loadServerIcon (store, state, config, log) {
  const rec = state.serverIcon
  let icon = null
  if (rec) {
    const data = await store.readServerIcon(rec.hash, SERVER_ICON_READ_MAX)
    const type = data ? imageType(data) : null
    if (data && type && serverIconHash(data) === rec.hash) {
      icon = { hash: rec.hash, type, data }
      if (rec.type !== type || rec.size !== data.length) {
        state.serverIcon = { hash: rec.hash, type, size: data.length }
        store.saveState()
      }
    } else {
      log.warn(i18n.t(config.lang, 'log.serverIconMissing'))
      state.serverIcon = null
      store.saveState()
    }
  }
  await store.removeServerIconsExcept(icon ? icon.hash : null)
  return icon
}

async function createChatServer (options) {
  const config = resolveOptions(options)
  const log = makeLogger(config.log)
  const store = await openStore({ dir: config.dataDir, maxMessagesPerChannel: config.maxMessagesPerChannel, maxTotalMessages: config.maxTotalMessages, log: config.log, lang: config.lang })
  let state
  let dummyHash
  // Frekans fotoğrafı bellekte tutulur: { hash, type, data } veya null
  let serverIcon = null
  try {
    state = prepareState(store, config, log)
    serverIcon = await loadServerIcon(store, state, config, log)
    // Bilinmeyen kullanıcı girişlerinde aynı maliyette doğrulama yapılır
    dummyHash = await auth.hashPassword(crypto.randomBytes(16).toString('hex'), config.scryptN)
  } catch (err) {
    await store.close().catch(noop)
    throw err
  }

  const collator = new Intl.Collator('tr')
  const usersById = new Map()
  // Silinmemiş hesaplar, kullanıcı adına göre (adlar zaten küçük harflidir, doğrudan karşılaştırılır)
  const usersByKey = new Map()
  const sessionsByHash = new Map()
  const uploadsById = new Map()
  const channelsById = new Map()
  for (const u of state.users) {
    usersById.set(u.id, u)
    if (!u.deleted) usersByKey.set(u.key, u)
  }
  for (const s of state.sessions) sessionsByHash.set(s.hash, s)
  for (const r of state.uploads) uploadsById.set(r.id, r)
  for (const c of state.channels) channelsById.set(c.id, c)
  let uploadsUsed = store.uploadsBytes()
  // Kullanıcı kimliği -> kayıtlı yüklemelerinin toplam boyutu (kullanıcı başına kota için)
  const uploadsUsedBy = new Map()
  for (const r of state.uploads) addUserUploadBytes(r.uploaderId, uploadSize(r))
  let inflightBytes = 0
  let activeUploads = 0
  const uploadJobs = new Set()
  // Kullanıcı kimliği -> (clientMessageId -> mesaj kimliği), en eski önce. Yalnızca bellekte tutulur:
  // yanıtı kaybolan gönderim saniyeler içinde yinelenir, yeniden başlatmadan sonra kimliklerin
  // unutulması en kötü durumda eski davranışa (yinelenen mesaja) döner ve her mesajda diske yazmaya değmez.
  const sentByClientId = new Map()

  let setupCode = null
  let setupCodeDisplay = null
  if (!ownerExists()) {
    const given = config.setupCode === null ? auth.generateCode() : config.setupCode
    setupCode = auth.normalizeCode(given)
    setupCodeDisplay = auth.formatCode(setupCode)
  }

  const authLimiter = new auth.RateLimiter(config.authLimit, config.authWindowMs)
  // Ön giriş ve kullanıcı adı uygunluk sorguları: aynı sınırlar, ayrı sayaç (bir giriş iki deneme sayılmasın)
  const lookupLimiter = new auth.RateLimiter(config.authLimit, config.authWindowMs)
  // Başarısız giriş: hesap ve istemci adresi (veya giriş cihazı işareti) başına sert sınır. Yalnızca hesap
  // adına bağlı sayaç bütün adresleri kapsar, LOGIN_NAME_FAIL_FACTOR kat geniştir ve dolduğunda yalnızca
  // işaretsiz girişleri durdurur.
  const loginFailLimiter = new auth.RateLimiter(config.loginFailLimit, config.loginFailWindowMs)
  const loginNameLimiter = new auth.RateLimiter(config.loginFailLimit * LOGIN_NAME_FAIL_FACTOR, config.loginFailWindowMs)
  const messageLimiter = new auth.RateLimiter(config.messageLimit, config.messageWindowMs)
  const uploadLimiter = new auth.RateLimiter(config.uploadLimit, config.uploadWindowMs)
  const adminLimiter = new auth.RateLimiter(config.adminLimit, config.adminWindowMs)
  const signalLimiter = new auth.RateLimiter(config.signalLimit, config.signalWindowMs)
  // Ses katılma, ayrılma ve durum bildirimleri herkese meta yayını tetiklediği için ayrıca sınırlanır
  const voiceLimiter = new auth.RateLimiter(config.voiceLimit, config.signalWindowMs)
  const friendLimiter = new auth.RateLimiter(config.friendRequestLimit, config.friendRequestWindowMs)
  // Arkadaşlık yanıtları, engellemeler, özel mesaj açma, kişisel anahtar, ayar ve oturum işlemleri
  const socialLimiter = new auth.RateLimiter(config.adminLimit, config.adminWindowMs)
  // Profil ve durum değişiklikleri herkese meta yayını tetiklediği için ayrıca sınırlanır
  const profileLimiter = new auth.RateLimiter(config.adminLimit, config.adminWindowMs)
  const typingLimiter = new auth.RateLimiter(config.typingLimit, config.typingWindowMs)
  const musicLimiter = new auth.RateLimiter(config.musicLimit, config.musicWindowMs)
  // Özel mesaj aramasını başlatma ve reddetme (karşı tarafın zilini çaldırdığı için ayrıca sınırlanır)
  const callLimiter = new auth.RateLimiter(config.callLimit, config.callWindowMs)
  const limiters = [authLimiter, lookupLimiter, loginFailLimiter, loginNameLimiter, messageLimiter, uploadLimiter, adminLimiter,
    signalLimiter, voiceLimiter, friendLimiter, socialLimiter, profileLimiter, typingLimiter, musicLimiter, callLimiter]
  const trustsProxy = auth.trustPolicy(config.trustedProxies)
  // Güvenilmeyen yerel vekil uyarısı yalnızca bir kez yazılır
  let proxyWarned = false

  let closing = false
  const lastUsedResolution = Math.min(LAST_USED_RESOLUTION_MS, Math.floor(config.sessionTtlMs / 10))

  // Kişiye özel meta önbelleği (kullanıcı kimliğine göre), değişiklikte silinir
  const privateCache = new Map()

  // Telsiz DJ müzik durumları: yalnızca bellekte, ses odası başına (src/music.js)
  const music = createMusic({ idleMs: config.musicIdleMs, onChange: () => hub.bumpMusic() })

  const hub = createHub({
    pollTimeoutMs: config.pollTimeoutMs,
    graceMs: config.graceMs,
    eventBufferSize: config.eventBufferSize,
    maxWaitersPerSession: config.maxWaitersPerSession,
    typingTtlMs: config.typingTtlMs,
    getBase: metaBase,
    getPrivate: privateOf,
    music: { version: music.version, map: music.map },
    isHidden: (userId) => {
      const user = usersById.get(userId)
      return Boolean(user) && user.status === 'invisible'
    },
    // Engel ilişkisi olan iki kullanıcı (hangi yönde olursa olsun) birbirinin yazıyor bilgisini görmez
    canSeeTyping: (viewerId, typerId) => !social.isBlockedEither(viewerId, typerId),
    // Özel mesaj konuşmasının kanalı aramanın ses odasıdır: herkese açık metaya girmez
    isPrivateRoom: (channelId) => {
      const channel = channelsById.get(channelId)
      return Boolean(channel) && channel.type === 'dm'
    },
    onPrivateVoice: callVoiceChanged,
    send: (res, status, json) => util.sendJsonText(res, status, json, closingHeaders())
  })

  // Özel mesaj aramaları: yalnızca bellekte, konuşma başına (src/calls.js). Biten aramanın odasındaki oturumlar
  // çıkarılır, iki üyenin özel görünümü yenilenir.
  const calls = createCalls({
    ringMs: config.callRingMs,
    onEnd: (rec) => {
      hub.kickVoiceRoom(rec.dmId)
      privateChanged(rec.members)
    }
  })

  const social = createSocial({
    state,
    limits: { maxFriends: config.maxFriends, maxPendingRequests: config.maxPendingRequests, maxDmsPerUser: config.maxDmsPerUser },
    lastMessageOf,
    onChange: privateChanged,
    save: () => store.saveState()
  })
  if (social.dirty) {
    log.warn(i18n.t(config.lang, 'log.invalidSocial'))
    store.saveState()
  }

  const limits = {
    nameMin: auth.NAME_MIN,
    nameMax: auth.NAME_MAX,
    passwordMin: auth.PASSWORD_MIN,
    passwordMax: auth.PASSWORD_MAX,
    messageMaxChars: MESSAGE_MAX_CHARS,
    maxBodyChars: config.maxBodyChars,
    uploadMaxBytes: config.uploadMaxBytes,
    maxUploadsPerMessage: config.maxUploadsPerMessage,
    channelNameMax: auth.CHANNEL_NAME_MAX,
    serverNameMax: auth.SERVER_NAME_MAX,
    aboutMax: auth.ABOUT_MAX,
    aboutMaxLines: auth.ABOUT_MAX_LINES,
    maxProfileChars: config.maxProfileChars,
    avatarMaxBytes: config.avatarMaxBytes,
    // Frekans fotoğrafı profil resmiyle aynı sınırı kullanır
    serverIconMaxBytes: config.avatarMaxBytes,
    // Ses odası ayarlarının izin verilen aralıkları
    voiceCapacityMin: VOICE_CAPACITY_MIN,
    voiceCapacityMax: VOICE_CAPACITY_MAX,
    maxCamerasMin: MAX_CAMERAS_MIN,
    maxCamerasMax: MAX_CAMERAS_MAX
  }

  // ---------------------------------------------------------------- durum yardımcıları

  function ownerExists () {
    return state.users.some((u) => u.role === 'owner' && !u.deleted)
  }

  function liveUserCount () {
    let n = 0
    for (const u of state.users) {
      if (!u.deleted) n++
    }
    return n
  }

  function serverFull () {
    return liveUserCount() >= config.maxUsers || state.users.length >= config.maxUsers * USER_RECORDS_FACTOR
  }

  // Özel mesaj konuşmaları, engelli ve silinmiş hesaplar herkese açık metada yer almaz
  function metaBase () {
    const channels = state.channels.filter((c) => MANAGED_TYPES.has(c.type)).sort(channelOrder).map(publicChannel)
    const users = state.users
      .filter((u) => !u.banned && !u.deleted)
      .sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id)
      .map(metaUser)
    return {
      serverName: state.serverName,
      serverIcon: serverIcon ? serverIcon.hash : null,
      activeKid: state.activeKid,
      channels,
      users,
      roles: state.roles.map(publicRole),
      music: { enabled: state.music.enabled, youtube: state.music.youtube, restricted: state.music.restricted },
      voiceSettings: { capacity: state.voice.capacity, cameras: state.voice.cameras, maxCameras: state.voice.maxCameras }
    }
  }

  function lastMessageOf (channelId) {
    const page = store.listMessages(channelId, { limit: 1 })
    return page.messages.length > 0 ? page.messages[page.messages.length - 1] : null
  }

  function privateOf (userId) {
    let view = privateCache.get(userId)
    // Önbellekteki görünümün çalan aramasının zil süresi dolduysa görünüm yeniden kurulur (süpürme kaydı henüz
    // silmemiş olabilir, süresi dolmuş arama görünmez)
    if (view && view.call && view.call.state === 'ringing' && Date.now() >= view.call.ringUntil) view = null
    if (!view) {
      const user = usersById.get(userId)
      view = user
        ? Object.assign(social.privateView(user), { call: callViewFor(userId) })
        : { friends: [], incoming: [], outgoing: [], blocked: [], dms: [], allowMemberDms: false, status: 'online', call: null }
      privateCache.set(userId, view)
    }
    return view
  }

  // Aramanın bir üyeye görünümü. members: arama odasındaki etkin oturumlar.
  function callView (rec, userId) {
    return {
      dmId: rec.dmId,
      userId: rec.caller === userId ? rec.callee : rec.caller,
      video: rec.video,
      state: rec.state,
      role: rec.caller === userId ? 'caller' : 'callee',
      createdAt: rec.createdAt,
      ringUntil: rec.ringUntil,
      answeredAt: rec.answeredAt,
      members: hub.voiceMembersOf(rec.dmId)
    }
  }

  // Kullanıcının özel görünümündeki arama (etkin olan öncelikli, sonra en yeni, zil süresi dolmuş olan hariç) veya null
  function callViewFor (userId) {
    const rec = calls.latestOf(userId, Date.now())
    return rec ? callView(rec, userId) : null
  }

  // Özel arama odasının ses üyeliği veya durumu değişti (hub bildirir): iki üye de odadayken arama etkin olur, odaya
  // katılmış bir üye ayrılınca (çıkış, oturumun düşmesi, başka odaya geçiş) arama biter. Genel meta sürümü artmaz,
  // yalnızca iki üyenin özel görünümü yenilenir.
  function callVoiceChanged (channelId) {
    const rec = calls.get(channelId)
    if (!rec) return
    if (!calls.sync(rec, hub.voiceUserIds(channelId), Date.now())) {
      calls.end(rec)
      return
    }
    privateChanged(rec.members)
  }

  // Kullanıcının çalan ve süren aramaları biter (yasaklama, frekanstan atma, hesap silme)
  function endCallsOf (userId) {
    for (const rec of calls.ofUser(userId)) calls.end(rec)
  }

  // Kullanıcının başka konuşmalardaki çalan aramaları iptal edilir (yeni arama, kabul veya bir aramanın odasına
  // katılma)
  function cancelRingingBy (userId, exceptDmId) {
    for (const rec of calls.ringingBy(userId, exceptDmId)) calls.end(rec)
  }

  // İki kullanıcı arasındaki arama biter (engel, arkadaşlıktan çıkarma)
  function endCallBetween (a, b) {
    const dm = social.dmBetween(a, b)
    const rec = dm ? calls.get(dm.id) : null
    if (rec) calls.end(rec)
  }

  // Kişiye özel görünümü değişen kullanıcılar: yalnızca onların bekleyen poll'ları uyanır
  function privateChanged (userIds) {
    for (const id of new Set(userIds)) {
      privateCache.delete(id)
      hub.bumpPrivate(id)
    }
  }

  function findChannel (id) {
    if (id === null) return null
    return channelsById.get(id) || null
  }

  function findChannelOfType (id, type) {
    const channel = findChannel(id)
    return channel && channel.type === type ? channel : null
  }

  // Kanal yönetimi uç noktalarının gördüğü kanallar (yazı ve ses, özel mesajlar hariç)
  function findManagedChannel (id) {
    const channel = findChannel(id)
    return channel && MANAGED_TYPES.has(channel.type) ? channel : null
  }

  function managedChannelCount () {
    let n = 0
    for (const c of state.channels) {
      if (MANAGED_TYPES.has(c.type)) n++
    }
    return n
  }

  // Kullanıcının okuyabildiği kanal: herhangi bir yazı kanalı veya üyesi olduğu özel konuşma
  function readableChannel (id, user) {
    const channel = findChannel(id)
    if (!channel) return null
    if (channel.type === 'text') return channel
    if (channel.type === 'dm' && social.isMember(channel, user.id)) return channel
    return null
  }

  // Olay hedef kitlesi: yazı kanalında herkes, özel konuşmada yalnızca iki üye
  function audienceOf (channel) {
    return channel && channel.type === 'dm' ? channel.members.slice() : null
  }

  // Özel konuşmaya yeni içerik yazılabilir mi: karşı taraf var, sunucudan engelli değil,
  // iki yönde de kişisel engel yok
  function canWriteDm (channel, user) {
    const other = usersById.get(social.otherMember(channel, user.id))
    if (!other || other.deleted || other.banned) return false
    return !social.isBlockedEither(user.id, other.id)
  }

  function channelsOfType (type) {
    return state.channels.filter((c) => c.type === type).sort((a, b) => a.position - b.position || a.id - b.id)
  }

  function renumber (type) {
    channelsOfType(type).forEach((c, i) => {
      c.position = i
    })
  }

  function channelNameTaken (type, name, exceptId) {
    const key = auth.nameKey(name)
    return state.channels.some((c) => c.type === type && c.id !== exceptId && auth.nameKey(c.name) === key)
  }

  // İsteğin dili (Accept-Language). Yanıt nesnesinden de bulunur (bekleyen poll yanıtları için).
  function langOf (req) {
    return i18n.pickLang(req && req.headers ? req.headers['accept-language'] : undefined)
  }

  function errorBody (lang, code, detailKey, params) {
    const key = detailKey || 'errors.' + code
    const fallback = i18n.has(lang, key) ? key : 'errors.server_error'
    return { error: i18n.t(lang, fallback, params), code }
  }

  function replyInvalidToken (res) {
    util.sendJson(res, 401, errorBody(langOf(res.req), 'invalid_token'), closingHeaders())
  }

  function replyBanned (res) {
    util.sendJson(res, 403, errorBody(langOf(res.req), 'banned'), closingHeaders())
  }

  // Frekanstan atılan kişinin bekleyen poll'ları: oturum geçersizdir (401), kod istemcinin "frekanstan
  // çıkarıldınız" demesi içindir. Sonraki istekler oturum bulunamadığı için 401 invalid_token alır.
  function replyKicked (res) {
    util.sendJson(res, 401, errorBody(langOf(res.req), 'kicked'), closingHeaders())
  }

  // Oturumları diskten ve bellekten siler, bekleyen poll'larına hata yanıtı gider. Bu oturumlarla
  // sürmekte olan yüklemeler kesilir (işleyici geçici dosyayı siler ve 401 veya 403 döner).
  // reason: 'invalid_token', 'banned' (403 banned) veya 'kicked' (401 kicked)
  function deleteSessions (list, reason) {
    if (list.length === 0) return
    const doomed = new Set(list)
    state.sessions = state.sessions.filter((s) => !doomed.has(s))
    const reply = reason === 'banned' ? replyBanned : reason === 'kicked' ? replyKicked : replyInvalidToken
    for (const s of list) {
      sessionsByHash.delete(s.hash)
      hub.removeSession(s.hash, reply)
    }
    // Hiç oturumu kalmayan arayanın çalan aramaları biter (odaya hiç katılmamış olsa da arama sahipsiz kalmaz)
    for (const userId of new Set(list.map((s) => s.userId))) {
      if (sessionsOf(userId).length > 0) continue
      for (const rec of calls.ringingBy(userId, null)) calls.end(rec)
    }
    for (const job of uploadJobs) {
      if (job.finish && doomed.has(job.session)) {
        job.req.pause()
        job.finish('signed_out')
      }
    }
    store.saveState()
  }

  function sessionsOf (userId) {
    return state.sessions.filter((s) => s.userId === userId)
  }

  // Yeni oturum açar ve token'ı döner. Diske yalnızca token'ın SHA-256 karması ve User-Agent'tan
  // türetilen kısa cihaz etiketi yazılır.
  function createSession (user, req) {
    const token = auth.newToken()
    const hash = auth.hashToken(token)
    const now = Date.now()
    const own = sessionsOf(user.id)
    if (own.length >= config.maxSessionsPerUser) {
      own.sort((a, b) => a.lastUsed - b.lastUsed || a.createdAt - b.createdAt)
      deleteSessions(own.slice(0, own.length - config.maxSessionsPerUser + 1), 'invalid_token')
    }
    const session = { hash, userId: user.id, createdAt: now, lastUsed: now, label: auth.sessionLabel(req.headers['user-agent']) }
    state.sessions.push(session)
    sessionsByHash.set(hash, session)
    store.saveState()
    return token
  }

  function uploadSize (rec) {
    return typeof rec.size === 'number' && Number.isFinite(rec.size) && rec.size > 0 ? rec.size : 0
  }

  function addUserUploadBytes (userId, delta) {
    const next = (uploadsUsedBy.get(userId) || 0) + delta
    if (next > 0) uploadsUsedBy.set(userId, next)
    else uploadsUsedBy.delete(userId)
  }

  // Kullanıcının kayıtlı yüklemeleri ve sürmekte olan yüklemelerinin şimdiye kadar gelen baytları
  function userUploadBytes (userId) {
    let total = uploadsUsedBy.get(userId) || 0
    for (const job of uploadJobs) {
      if (job.userId === userId) total += job.bytes
    }
    return total
  }

  // Güvenlikle ilgili değişikliklerin (parola, oturum kapatma, engelleme, rol, davet kodu, grup
  // anahtarı, hesap silme) başarı yanıtı state.json diske yazılıp fsync edildikten sonra gider.
  // Bellekteki etki hemen uygulanır. Yazım başarısız olursa hata işleyicisi günlüğe yazar ve
  // 500 server_error döner (store kapanmışsa 503). Değişiklik bellekte kalır, çünkü geri almak
  // yarım kalmış yan etkileri (kapanan oturumlar, gönderilen olaylar) geri getiremez. Store'un
  // yeniden deneme döngüsü onu daha sonra yazar. Aynı anda bekleyen istekler tek yazımı paylaşır.
  function okDurable (ctx, data) {
    return store.flushState().then(() => ok(ctx, data))
  }

  // Yükleme kayıtlarını ve dosyalarını siler.
  function removeUploads (ids) {
    if (!ids || ids.length === 0) return
    const doomed = new Set()
    const files = new Set()
    for (const id of ids) {
      if (typeof id !== 'string' || !UPLOAD_ID_RE.test(id)) continue
      files.add(id)
      const rec = uploadsById.get(id)
      if (!rec) continue
      doomed.add(rec)
      uploadsById.delete(id)
      uploadsUsed -= uploadSize(rec)
    }
    if (doomed.size > 0) {
      state.uploads = state.uploads.filter((r) => !doomed.has(r))
      for (const rec of doomed) addUserUploadBytes(rec.uploaderId, -uploadSize(rec))
      store.saveState()
    }
    for (const id of files) {
      store.removeUpload(id).catch((err) => log.warn(i18n.t(config.lang, 'log.uploadRemoveFailed', { error: errText(err, config.lang) })))
    }
  }

  function uploadsOfMessages (messages) {
    const ids = []
    for (const m of messages) {
      for (const id of m.uploads) ids.push(id)
    }
    return ids
  }

  // ---------------------------------------------------------------- yanıt yardımcıları

  function closingHeaders () {
    return closing ? { Connection: 'close' } : null
  }

  function ok (ctx, data) {
    util.sendJson(ctx.res, 200, data, closingHeaders())
  }

  // detailKey: kodun genel metni yerine kullanılacak sözlük anahtarı (ör. 'detail.setupCodeWrong')
  function fail (ctx, status, code, detailKey, headers, params) {
    const extra = Object.assign({}, headers || {}, closingHeaders() || {})
    util.sendJson(ctx.res, status, errorBody(langOf(ctx.req), code, detailKey, params), extra, { drain: canDrain(ctx) })
  }

  // Yükleme gövdesi okunmadan verilen ret yanıtında, boyutu bilinen ve sınırı aşmayan gövde
  // bağlantı açıkken okunup atılır. Böylece tarayıcı yanıtı (ör. 503 busy) bağlantı sıfırlanmadan alır.
  // Boyutu bilinmeyen veya sınırı aşan gövdede bağlantı yanıttan sonra kapatılır.
  // Kimlik doğrulaması gövde okunmadan yapılan JSON isteklerinde de aynı kural geçerlidir, sınır
  // o yolun gövde sınırıdır (ctx.drainLimit).
  function canDrain (ctx) {
    if (!ctx.drainable || closing) return false
    const declared = util.contentLength(ctx.req)
    return declared !== null && declared <= ctx.drainLimit
  }

  function tooMany (ctx, waitMs, detailKey) {
    fail(ctx, 429, 'rate_limited', detailKey, { 'Retry-After': String(Math.max(1, Math.ceil(waitMs / 1000))) })
  }

  function failEarly (req, res, status, code, headers) {
    util.sendJson(res, status, errorBody(langOf(req), code), Object.assign({}, headers || {}, closingHeaders() || {}))
  }

  function internalError (res, err, label) {
    const lang = langOf(res.req)
    if (err && err.code === 'closed') {
      util.sendJson(res, 503, errorBody(lang, 'shutting_down'), { Connection: 'close' })
      return
    }
    if (err && err.code === 'hash_busy' && util.canRespond(res)) {
      util.sendJson(res, 503, errorBody(lang, 'server_busy'), Object.assign({ 'Retry-After': '1' }, closingHeaders() || {}))
      return
    }
    log.error(i18n.t(config.lang, 'log.requestError', { label, error: describeError(err, config.lang) }))
    if (util.canRespond(res)) {
      util.sendJson(res, 500, errorBody(lang, 'server_error'), closingHeaders())
    } else if (!res.writableEnded) {
      res.destroy()
    }
  }

  function requireStaff (ctx) {
    if (isStaff(ctx.user)) return true
    fail(ctx, 403, 'forbidden')
    return false
  }

  function requireOwner (ctx) {
    if (ctx.user.role === 'owner') return true
    fail(ctx, 403, 'forbidden')
    return false
  }

  function findRole (id) {
    return state.roles.find((r) => r.id === id) || null
  }

  // Kullanıcının izni var mı: sahip ve yönetici her izne, üye özel rolünün izinlerine sahiptir
  function hasPerm (user, perm) {
    if (isStaff(user)) return true
    const role = isId(user.roleId) ? findRole(user.roleId) : null
    return Boolean(role) && role.perms.includes(perm)
  }

  function requirePerm (ctx, perm) {
    if (hasPerm(ctx.user, perm)) return true
    fail(ctx, 403, 'forbidden')
    return false
  }

  // Rütbe (küçük sayı üstte): sahip, yönetici, özel roller dizideki sırayla, rolsüz üye en altta
  function rankOf (user) {
    if (user.role === 'owner') return -2
    if (user.role === 'admin') return -1
    const index = isId(user.roleId) ? state.roles.findIndex((r) => r.id === user.roleId) : -1
    return index === -1 ? MAX_ROLES : index
  }

  // Engelleme, frekanstan atma ve ses odası denetimi yalnızca alt rütbedeki birine uygulanabilir
  function outranks (actor, target) {
    return rankOf(actor) < rankOf(target)
  }

  function takeAdminSlot (ctx) {
    const wait = adminLimiter.consume('u' + ctx.user.id)
    if (wait === 0) return true
    tooMany(ctx, wait)
    return false
  }

  function requestIpKey (req) {
    // Yönlendirme başlığı güvenilir olmayan yerel bir adresten gelirse yönetici bir kez uyarılır,
    // çünkü bu durumda bütün istemciler aynı hız sınırı kovasını paylaşır
    if (!proxyWarned) {
      const forwarder = auth.untrustedLocalForwarder(req, trustsProxy)
      if (forwarder !== null) {
        proxyWarned = true
        log.warn(i18n.t(config.lang, 'log.untrustedForwarder', { address: forwarder }))
      }
    }
    return auth.ipKey(auth.clientIp(req, trustsProxy))
  }

  // ---------------------------------------------------------------- kimlik doğrulama

  function authenticate (ctx) {
    const token = ctx.req.headers['x-token']
    if (typeof token !== 'string' || token.length < 16 || token.length > 256) {
      fail(ctx, 401, 'invalid_token')
      return false
    }
    const hash = auth.hashToken(token)
    const session = sessionsByHash.get(hash)
    if (!session) {
      fail(ctx, 401, 'invalid_token')
      return false
    }
    const now = ctx.now
    const user = usersById.get(session.userId)
    if (!user || user.deleted || now - session.lastUsed > config.sessionTtlMs) {
      deleteSessions([session], 'invalid_token')
      fail(ctx, 401, 'invalid_token')
      return false
    }
    if (user.banned) {
      deleteSessions(sessionsOf(user.id), 'banned')
      fail(ctx, 403, 'banned')
      return false
    }
    if (now - session.lastUsed > lastUsedResolution) {
      session.lastUsed = now
      store.saveState()
    }
    ctx.user = user
    ctx.session = session
    ctx.rt = hub.touch(hash, user.id, now)
    return true
  }

  // await sonrası oturum hâlâ geçerli mi
  function stillSignedIn (ctx) {
    return sessionsByHash.get(ctx.session.hash) === ctx.session && !ctx.user.banned && !ctx.user.deleted
  }

  // Oturum await sırasında kapandıysa kimlik katmanının vereceği yanıt: engelliyse 403, değilse 401
  function failSignedOut (ctx) {
    return ctx.user.banned ? fail(ctx, 403, 'banned') : fail(ctx, 401, 'invalid_token')
  }

  // Silinmemiş hesap (sunucudan engelli olanlar dahil), yoksa null
  function findLiveUser (value) {
    const id = toId(value)
    const user = id === null ? null : usersById.get(id) || null
    return user && !user.deleted ? user : null
  }

  // Parola karması sırası (DEFAULTS.hashConcurrency). Sıra doluysa 'hash_busy' kodlu hata fırlatılır,
  // istek işleyicisi bunu 503 server_busy yanıtına çevirir (internalError).
  let hashRunning = 0
  const hashQueue = []
  async function gatedHash (fn) {
    if (hashRunning < config.hashConcurrency) {
      hashRunning++
    } else {
      if (hashQueue.length >= config.hashQueueMax) throw Object.assign(new Error('hash queue full'), { code: 'hash_busy' })
      await new Promise((resolve) => hashQueue.push(resolve))
    }
    try {
      return await fn()
    } finally {
      const next = hashQueue.shift()
      if (next) next()
      else hashRunning--
    }
  }

  // Kayıtlı karma ile authKey doğrulaması. Hesap yoksa veya karması yoksa aynı maliyetle
  // sahte karma doğrulanır. Sonuç yalnızca bekleme süresince karma değişmediyse geçerlidir.
  async function checkAuthKey (user, value) {
    const authKey = auth.isAuthKey(value) ? value : ''
    const usable = Boolean(user) && !user.deleted && typeof user.passHash === 'string' && Boolean(user.kdf)
    const hashUsed = usable ? user.passHash : dummyHash
    const good = await gatedHash(() => auth.verifyPassword(authKey === '' ? 'x' : authKey, hashUsed))
    return good && usable && authKey !== '' && user.passHash === hashUsed && !user.deleted
  }

  // Hesabın kendi işlemlerinde (parola, kullanıcı adı, silme) hatalı authKey denemesi sınırı
  function accountBlocked (ctx, failKey) {
    const blocked = loginFailLimiter.blocked(failKey, ctx.now)
    if (blocked === 0) return false
    tooMany(ctx, blocked, 'detail.loginRate')
    return true
  }

  function takeSocialSlot (ctx) {
    const wait = socialLimiter.consume('u' + ctx.user.id, ctx.now)
    if (wait === 0) return true
    tooMany(ctx, wait)
    return false
  }

  function takeLookupSlot (ctx) {
    const wait = lookupLimiter.consume(requestIpKey(ctx.req), ctx.now)
    if (wait === 0) return true
    tooMany(ctx, wait, 'detail.authRate')
    return false
  }

  // Parola sıfırlaması sonrası anahtar alanları. Geçici parolayı sıfırlayan sahip (veya CLI ile işletmeci) de bilir:
  // yeni anahtar çifti yalnızca geçici paroladan farklı yeni bir parolayla birlikte kurulabilir (handleMyPassword),
  // geçici parolayla /api/me/keys reddedilir. Böylece geçici parolayı bilen biri kişinin yeni kimlik anahtarını
  // seçemez veya açamaz. Kişiden önce davranırsa kişi geçici parolayla giremez ve durumu fark eder.
  function applyCredentials (user, creds) {
    user.passHash = creds.passHash
    user.kdf = creds.kdf
    user.publicKey = null
    user.wrappedKey = null
    user.identity = null
    user.resetPending = true
    user.pv++
  }

  // ---------------------------------------------------------------- uç noktalar: hesap

  function handleInfo (ctx) {
    // about herkese açıktır ve şifrelenmez: giriş yapmamış ziyaretçiler tanıtım sayfasında görür
    // Frekans fotoğrafının karması da herkese açıktır (GET /api/server-icon)
    ok(ctx, { serverName: state.serverName, serverIcon: serverIcon ? serverIcon.hash : null, about: state.about, setupRequired: !ownerExists(), version: VERSION, limits })
  }

  function codeAccepted (setup, input) {
    if (setup) return setupCode !== null && auth.codeMatches(input, setupCode)
    const invite = auth.normalizeCode(state.inviteCode)
    return invite !== null && auth.codeMatches(input, invite)
  }

  // Yalnızca geçerli davet veya kurulum koduyla sorgulanabilir (ad taraması engellenir)
  function handleUsernameAvailable (ctx) {
    if (!takeLookupSlot(ctx)) return
    const b = ctx.body
    const setup = !ownerExists()
    if (!codeAccepted(setup, b.code)) return fail(ctx, 403, 'bad_code', setup ? 'detail.setupCodeWrong' : 'detail.inviteCodeWrong')
    const name = auth.cleanUsername(b.name)
    if (name === null) return ok(ctx, { available: false, valid: false })
    ok(ctx, { available: !usersByKey.has(name), valid: true })
  }

  // İstemcinin parolasından anahtar türetmesi için tuz ve parametreler.
  // Hesap yoksa aynı biçimde, ad başına sabit sahte tuz döner. HMAC her durumda hesaplanır.
  function handlePrelogin (ctx) {
    if (!takeLookupSlot(ctx)) return
    const raw = ctx.body.name
    if (typeof raw !== 'string' || raw.length > 64) return fail(ctx, 400, 'bad_request')
    const name = auth.cleanUsername(raw)
    const fakeSalt = auth.preloginSalt(state.serverSecret, name === null ? raw : name)
    const user = name === null ? null : usersByKey.get(name) || null
    const kdf = user && user.kdf ? user.kdf : { salt: fakeSalt, N: auth.KDF_DEFAULT_N, r: 8, p: 1 }
    ok(ctx, { kdf: { salt: kdf.salt, N: kdf.N, r: kdf.r, p: kdf.p } })
  }

  async function handleRegister (ctx) {
    const wait = authLimiter.consume(requestIpKey(ctx.req), ctx.now)
    if (wait > 0) return tooMany(ctx, wait, 'detail.authRate')
    const b = ctx.body
    const name = auth.cleanUsername(b.name)
    if (name === null) return fail(ctx, 400, 'invalid_name')
    if (!auth.isAuthKey(b.authKey)) return fail(ctx, 400, 'bad_auth_key')
    const kdf = auth.cleanKdf(b.kdf)
    if (kdf === null) return fail(ctx, 400, 'bad_kdf')
    if (!auth.isPublicKey(b.publicKey) || !auth.isWrappedKey(b.wrappedKey)) return fail(ctx, 400, 'bad_keys')
    const setup = !ownerExists()
    const input = setup ? b.setupCode : b.inviteCode
    if (!codeAccepted(setup, input)) return fail(ctx, 403, 'bad_code', setup ? 'detail.setupCodeWrong' : 'detail.inviteCodeWrong')
    if (serverFull()) return fail(ctx, 503, 'server_full')
    if (usersByKey.has(name)) return fail(ctx, 409, 'name_taken')

    const passHash = await gatedHash(() => auth.hashPassword(b.authKey, config.scryptN))

    // Karma hesaplanırken durum değişmiş olabilir (ör. aynı anda iki kurulum isteği), denetimler yinelenir
    if (closing) return fail(ctx, 503, 'shutting_down')
    if (setup !== !ownerExists() || !codeAccepted(setup, input)) {
      return fail(ctx, 403, 'bad_code', setup ? 'detail.setupCodeWrong' : 'detail.inviteCodeWrong')
    }
    if (serverFull()) return fail(ctx, 503, 'server_full')
    if (usersByKey.has(name)) return fail(ctx, 409, 'name_taken')

    state.counters.user++
    const user = {
      id: state.counters.user,
      name,
      key: name,
      role: setup ? 'owner' : 'member',
      passHash,
      kdf,
      publicKey: b.publicKey,
      wrappedKey: b.wrappedKey,
      identity: null,
      profile: null,
      avatarUploadId: null,
      status: 'online',
      allowMemberDms: true,
      pv: 0,
      createdAt: Date.now(),
      banned: false,
      deleted: false,
      roleId: null,
      voiceMuted: false,
      resetPending: false
    }
    state.users.push(user)
    usersById.set(user.id, user)
    usersByKey.set(name, user)
    if (setup) {
      setupCode = null
      setupCodeDisplay = null
      log.info(i18n.t(config.lang, 'log.ownerCreated'))
    }
    const token = createSession(user, ctx.req)
    store.saveState()
    hub.bumpMeta()
    ok(ctx, { token, user: publicUser(user), device: auth.newLoginDevice(state.serverSecret, user.id, user.passHash) })
  }

  // Başarısız giriş sayaçları. Geçerli giriş cihazı işareti olan istek yalnızca işaretin sayacına,
  // diğerleri hesap ve adres sayacına ile hesap adı sayacına bağlıdır. Böylece adı bilen biri hatalı
  // denemelerle hesabın daha önce giriş yapılmış cihazlarını kilitleyemez, çok sayıda adresten de hesap
  // başına hesap adı sınırından fazla parola deneyemez.
  function loginFailKeys (ctx, name, user, device) {
    if (name === null) return []
    const deviceId = user ? auth.loginDeviceId(state.serverSecret, user.id, user.passHash, device) : null
    if (deviceId !== null) return [{ limiter: loginFailLimiter, key: 'd:' + deviceId }]
    return [
      { limiter: loginFailLimiter, key: 'n:' + name + '|' + requestIpKey(ctx.req) },
      { limiter: loginNameLimiter, key: 'n:' + name }
    ]
  }

  // Hesabın bütün başarısız giriş sayaçları (parola değişince veya sıfırlanınca)
  function resetLoginFails (name) {
    loginNameLimiter.reset('n:' + name)
    loginFailLimiter.resetPrefix('n:' + name + '|')
  }

  // Geçerli giriş cihazı işareti korunur, yoksa yenisi verilir. İşaret parola karmasına bağlıdır
  // (auth.loginDeviceId): parola değişince veya sıfırlanınca önceki işaretler geçersiz olur.
  function loginDeviceFor (user, given) {
    if (auth.loginDeviceId(state.serverSecret, user.id, user.passHash, given) !== null) return given
    return auth.newLoginDevice(state.serverSecret, user.id, user.passHash)
  }

  async function handleLogin (ctx) {
    const wait = authLimiter.consume(requestIpKey(ctx.req), ctx.now)
    if (wait > 0) return tooMany(ctx, wait, 'detail.authRate')
    const b = ctx.body
    const name = auth.cleanUsername(b.name)
    const user = name === null ? null : usersByKey.get(name) || null
    const failKeys = loginFailKeys(ctx, name, user, b.device)
    for (const f of failKeys) {
      const blocked = f.limiter.blocked(f.key, ctx.now)
      if (blocked > 0) return tooMany(ctx, blocked, 'detail.loginRate')
    }
    const good = await checkAuthKey(user, b.authKey)
    if (!good || usersByKey.get(name) !== user) {
      for (const f of failKeys) f.limiter.hit(f.key)
      // İşaretli denemeler de hesap adı sayacına eklenir (işaretsiz girişlerin sınırı ortaktır)
      if (failKeys.length === 1) loginNameLimiter.hit('n:' + name)
      return fail(ctx, 401, 'bad_credentials')
    }
    if (user.banned) return fail(ctx, 403, 'banned')
    if (closing) return fail(ctx, 503, 'shutting_down')
    // İşaretli başarılı giriş hesap adı sayacını sıfırlamaz: sürmekte olan bir saldırı, kişinin bilinen
    // cihazından girmesiyle yeni deneme hakkı kazanmaz
    for (const f of failKeys) f.limiter.reset(f.key)
    const token = createSession(user, ctx.req)
    const data = { token, user: publicUser(user), keys: ownKeys(user), device: loginDeviceFor(user, b.device) }
    if (user.resetPending === true) data.resetPending = true
    ok(ctx, data)
  }

  function handleLogout (ctx) {
    deleteSessions([ctx.session], 'invalid_token')
    return okDurable(ctx, { ok: true })
  }

  function handleState (ctx) {
    const data = {
      boot: hub.bootId,
      seq: hub.getSeq(),
      metaVersion: hub.getMetaVersion(),
      meta: hub.meta(),
      pmv: hub.privateVersion(ctx.user.id),
      private: privateOf(ctx.user.id),
      tv: hub.typingVersion(ctx.user.id),
      typing: hub.typingOf(ctx.user.id),
      muv: music.version(),
      music: music.map(),
      now: Date.now(),
      me: Object.assign(publicUser(ctx.user), { status: ctx.user.status }),
      keys: ownKeys(ctx.user),
      peerId: ctx.rt.peerId,
      sigSeq: ctx.rt.sigSeq,
      iceServers: config.iceServers,
      // Sunucudan engellenen hesaplar metada yoktur, eski mesajlarında adları buradan gösterilir
      formerUsers: bannedUsers().map((u) => ({ id: u.id, name: u.name }))
    }
    if (ctx.user.resetPending === true) data.resetPending = true
    if (isStaff(ctx.user)) data.inviteCode = state.inviteCode
    // Yönetim ekranında engeli kaldırmak için (engelleme izni olanlar)
    if (hasPerm(ctx.user, 'ban')) data.bannedUsers = bannedUsers().map((u) => ({ id: u.id, name: u.name, role: u.role }))
    ok(ctx, data)
  }

  function bannedUsers () {
    return state.users.filter((u) => u.banned && !u.deleted).sort((a, b) => a.id - b.id)
  }

  function handlePoll (ctx) {
    const q = ctx.query
    hub.poll(ctx.rt, { since: q.get('since'), mv: q.get('mv'), pmv: q.get('pmv'), tv: q.get('tv'), muv: q.get('muv'), sig: q.get('sig'), boot: q.get('boot') }, ctx.res)
  }

  // İstemci aynı özel anahtarı yeni parolayla yeniden sarar. Diğer oturumlar kapanır. Anahtar çifti yoksa (parola
  // sıfırlaması sonrası) yeni çift ({ publicKey, wrappedKey }, yeni parolayla sarılmış) bu istekle kurulabilir.
  async function handleMyPassword (ctx) {
    const b = ctx.body
    const user = ctx.user
    if (!auth.isAuthKey(b.newAuthKey)) return fail(ctx, 400, 'bad_auth_key')
    const kdf = auth.cleanKdf(b.kdf)
    if (kdf === null) return fail(ctx, 400, 'bad_kdf')
    // Anahtar çifti varsa yeniden sarılmış özel anahtar zorunludur, yoksa yeni çift verilebilir veya boş kalır.
    // Çifti olan hesaba yeni açık anahtar gönderen istek reddedilir: eski durumdaki bir sekme yeni çift üretip
    // açık anahtarla eşleşmeyen bir özel anahtarı sessizce yerleştiremez.
    const hadKeys = user.publicKey !== null
    const noWrapped = b.wrappedKey === undefined || b.wrappedKey === null
    const hasPublic = b.publicKey !== undefined && b.publicKey !== null
    const newPair = !hadKeys && hasPublic
    if (hadKeys ? hasPublic || !auth.isWrappedKey(b.wrappedKey) : newPair ? !auth.isPublicKey(b.publicKey) || !auth.isWrappedKey(b.wrappedKey) : !noWrapped) return fail(ctx, 400, 'bad_keys')
    const failKey = 'p:' + user.id
    if (accountBlocked(ctx, failKey)) return
    const good = await checkAuthKey(user, b.oldAuthKey)
    if (!good) {
      loginFailLimiter.hit(failKey)
      return fail(ctx, 401, 'bad_credentials', 'detail.oldPasswordWrong')
    }
    const hashUsed = user.passHash
    const passHash = await gatedHash(() => auth.hashPassword(b.newAuthKey, config.scryptN))
    if (closing) return fail(ctx, 503, 'shutting_down')
    if (!stillSignedIn(ctx)) return fail(ctx, 401, 'invalid_token')
    if (user.passHash !== hashUsed) return fail(ctx, 401, 'bad_credentials', 'detail.oldPasswordWrong')
    if ((user.publicKey !== null) !== hadKeys) return fail(ctx, 400, 'bad_keys')
    user.passHash = passHash
    user.kdf = kdf
    user.wrappedKey = hadKeys || newPair ? b.wrappedKey : null
    user.resetPending = false
    if (newPair) {
      user.publicKey = b.publicKey
      user.identity = null
      user.pv++
      hub.bumpMeta()
    }
    loginFailLimiter.reset(failKey)
    resetLoginFails(user.key)
    deleteSessions(sessionsOf(user.id).filter((s) => s !== ctx.session), 'invalid_token')
    store.saveState()
    // Önceki giriş cihazı işaretleri yeni parola karmasıyla geçersizdir, bu cihaz yenisini alır
    return okDurable(ctx, { ok: true, device: auth.newLoginDevice(state.serverSecret, user.id, user.passHash) })
  }

  // Türetme gücünü yükseltir: aynı parola, daha güçlü yeni ayar (yeni tuz, daha büyük N). İstemci girişten sonra eski
  // ayarlı hesapta aynı özel anahtarı yeni ayarla türetilen anahtarla yeniden sarar. Parola aynı kaldığı için diğer
  // oturumlar kapanmaz. Ayar yalnızca güçlenebilir, geçici paroladaki hesap önce parolasını değiştirmelidir. Önceki
  // giriş cihazı işaretleri yeni karmayla geçersizdir, bu cihaz yenisini alır.
  async function handleMyKdf (ctx) {
    const b = ctx.body
    const user = ctx.user
    if (user.resetPending === true) return fail(ctx, 409, 'password_change_required')
    if (!auth.isAuthKey(b.newAuthKey)) return fail(ctx, 400, 'bad_auth_key')
    const kdf = auth.cleanKdf(b.kdf)
    if (kdf === null || !user.kdf || kdf.N <= user.kdf.N || kdf.salt === user.kdf.salt) return fail(ctx, 400, 'bad_kdf')
    const hadKeys = user.publicKey !== null
    const noWrapped = b.wrappedKey === undefined || b.wrappedKey === null
    if (b.publicKey !== undefined || (hadKeys ? !auth.isWrappedKey(b.wrappedKey) : !noWrapped)) return fail(ctx, 400, 'bad_keys')
    const failKey = 'p:' + user.id
    if (accountBlocked(ctx, failKey)) return
    const good = await checkAuthKey(user, b.oldAuthKey)
    if (!good) {
      loginFailLimiter.hit(failKey)
      return fail(ctx, 401, 'bad_credentials', 'detail.passwordWrong')
    }
    const hashUsed = user.passHash
    const kdfUsed = user.kdf
    const passHash = await gatedHash(() => auth.hashPassword(b.newAuthKey, config.scryptN))
    if (closing) return fail(ctx, 503, 'shutting_down')
    if (!stillSignedIn(ctx)) return fail(ctx, 401, 'invalid_token')
    if (user.passHash !== hashUsed || user.kdf !== kdfUsed || user.resetPending === true) return fail(ctx, 401, 'bad_credentials', 'detail.passwordWrong')
    if ((user.publicKey !== null) !== hadKeys) return fail(ctx, 400, 'bad_keys')
    user.passHash = passHash
    user.kdf = kdf
    if (hadKeys) user.wrappedKey = b.wrappedKey
    loginFailLimiter.reset(failKey)
    store.saveState()
    return okDurable(ctx, { ok: true, device: auth.newLoginDevice(state.serverSecret, user.id, user.passHash) })
  }

  // Parola sıfırlamasından sonra (sarılmış anahtar yokken) yeni anahtar çifti yüklenir
  function handleMyKeys (ctx) {
    if (!takeSocialSlot(ctx)) return
    const b = ctx.body
    if (!auth.isPublicKey(b.publicKey) || !auth.isWrappedKey(b.wrappedKey)) return fail(ctx, 400, 'bad_keys')
    const user = ctx.user
    if (user.wrappedKey !== null) return fail(ctx, 409, 'keys_exist')
    // Sıfırlamadan sonra anahtar çifti yalnızca yeni parolayla birlikte kurulur (applyCredentials, handleMyPassword)
    if (user.resetPending === true) return fail(ctx, 409, 'password_change_required')
    user.publicKey = b.publicKey
    user.wrappedKey = b.wrappedKey
    user.identity = null
    user.pv++
    store.saveState()
    hub.bumpMeta()
    ok(ctx, { ok: true })
  }

  // Grup anahtarıyla mühürlenmiş { v, u, pk } kaydı. Sunucu yalnızca zarf biçimini denetler.
  function handleMyIdentity (ctx) {
    if (!takeSocialSlot(ctx)) return
    const identity = ctx.body.identity
    if (!validEnvelope(identity, IDENTITY_MAX_CHARS)) return fail(ctx, 400, 'bad_identity')
    const user = ctx.user
    if (user.publicKey === null) return fail(ctx, 409, 'no_keys')
    if (user.identity !== identity) {
      user.identity = identity
      user.pv++
      store.saveState()
      hub.bumpMeta()
    }
    ok(ctx, { ok: true })
  }

  async function handleMyUsername (ctx) {
    const wait = authLimiter.consume(requestIpKey(ctx.req), ctx.now)
    if (wait > 0) return tooMany(ctx, wait, 'detail.authRate')
    const user = ctx.user
    const name = auth.cleanUsername(ctx.body.name)
    if (name === null) return fail(ctx, 400, 'invalid_name')
    if (name !== user.name && usersByKey.has(name)) return fail(ctx, 409, 'name_taken')
    const failKey = 'p:' + user.id
    if (accountBlocked(ctx, failKey)) return
    const good = await checkAuthKey(user, ctx.body.authKey)
    if (!good) {
      loginFailLimiter.hit(failKey)
      return fail(ctx, 401, 'bad_credentials', 'detail.passwordWrong')
    }
    if (closing) return fail(ctx, 503, 'shutting_down')
    if (!stillSignedIn(ctx)) return fail(ctx, 401, 'invalid_token')
    loginFailLimiter.reset(failKey)
    if (name !== user.name) {
      if (usersByKey.has(name)) return fail(ctx, 409, 'name_taken')
      usersByKey.delete(user.key)
      user.name = name
      user.key = name
      usersByKey.set(name, user)
      store.saveState()
      hub.bumpMeta()
    }
    ok(ctx, { ok: true, user: publicUser(user) })
  }

  // Hesap silme (authKey ile veya frekanstan atma): oturumlar, ses, anahtarlar, arkadaşlık ve engel kayıtları
  // silinir, ad serbest kalır. Mesajlar ve özel mesaj geçmişi kalır, yazar silinmiş görünür. reason
  // bekleyen poll'lara giden yanıtı seçer (deleteSessions).
  function deleteAccount (user, reason = 'invalid_token') {
    endCallsOf(user.id)
    deleteSessions(sessionsOf(user.id), reason)
    usersByKey.delete(user.key)
    user.deleted = true
    user.name = ''
    user.key = ''
    user.role = 'member'
    user.passHash = null
    user.kdf = null
    user.publicKey = null
    user.wrappedKey = null
    user.identity = null
    user.pv++
    // Profil ve profil resmi silinir (profil resmi de bağlanmamış yüklemeler arasında silinir)
    const doomed = []
    if (user.avatarUploadId !== null) doomed.push(user.avatarUploadId)
    user.profile = null
    user.avatarUploadId = null
    user.status = 'online'
    for (const rec of state.uploads) {
      if (rec.uploaderId === user.id && rec.messageId === null) doomed.push(rec.id)
    }
    removeUploads(doomed)
    social.removeUser(user.id)
    privateCache.delete(user.id)
    sentByClientId.delete(user.id)
    store.saveState()
    hub.bumpMeta()
  }

  async function handleMyDelete (ctx) {
    const user = ctx.user
    if (user.role === 'owner') return fail(ctx, 403, 'owner_cannot_delete')
    const wait = authLimiter.consume(requestIpKey(ctx.req), ctx.now)
    if (wait > 0) return tooMany(ctx, wait, 'detail.authRate')
    const failKey = 'p:' + user.id
    if (accountBlocked(ctx, failKey)) return
    const good = await checkAuthKey(user, ctx.body.authKey)
    if (!good) {
      loginFailLimiter.hit(failKey)
      return fail(ctx, 401, 'bad_credentials', 'detail.passwordWrong')
    }
    if (closing) return fail(ctx, 503, 'shutting_down')
    if (!stillSignedIn(ctx)) return fail(ctx, 401, 'invalid_token')
    if (user.role === 'owner') return fail(ctx, 403, 'owner_cannot_delete')
    loginFailLimiter.reset(failKey)
    deleteAccount(user)
    return okDurable(ctx, { ok: true })
  }

  // Sunucu üyelerinden (arkadaş olmayanlardan) yeni özel mesaj kabul etme
  function handleMySettings (ctx) {
    const b = ctx.body
    if (typeof b.allowMemberDms !== 'boolean') return fail(ctx, 400, 'bad_request')
    if (!takeSocialSlot(ctx)) return
    if (ctx.user.allowMemberDms !== b.allowMemberDms) {
      ctx.user.allowMemberDms = b.allowMemberDms
      store.saveState()
      privateChanged([ctx.user.id])
    }
    ok(ctx, { ok: true })
  }

  // Profil zarfı (yoksa null), profil resmi, açık anahtar ve kimlik kaydı.
  // Silinmiş ve engelli hesaplar listelenmez.
  function handleProfiles (ctx) {
    const raw = ctx.query.get('ids')
    if (typeof raw !== 'string' || raw === '' || raw.length > PROFILE_IDS_MAX * 16) return fail(ctx, 400, 'bad_request')
    const parts = raw.split(',')
    if (parts.length > PROFILE_IDS_MAX) return fail(ctx, 400, 'bad_request')
    const ids = []
    for (const part of parts) {
      const id = toId(part)
      if (id === null) return fail(ctx, 400, 'bad_request')
      if (!ids.includes(id)) ids.push(id)
    }
    const profiles = []
    for (const id of ids) {
      const u = usersById.get(id)
      if (!u || u.deleted || u.banned) continue
      profiles.push({
        id: u.id,
        pv: u.pv,
        profile: typeof u.profile === 'string' ? u.profile : null,
        avatarUploadId: typeof u.avatarUploadId === 'string' ? u.avatarUploadId : null,
        publicKey: u.publicKey,
        identity: u.identity
      })
    }
    ok(ctx, { profiles })
  }

  function takeProfileSlot (ctx) {
    const wait = profileLimiter.consume('u' + ctx.user.id, ctx.now)
    if (wait === 0) return true
    tooMany(ctx, wait)
    return false
  }

  // Profil: grup anahtarıyla şifrelenmiş zarf (null ile silinir) ve profil resmi yüklemesi
  // (null ile kaldırılır). Profil resmi kullanıcının kendi yüklediği, mesaja veya başka bir
  // profile bağlı olmayan bir yükleme olmalıdır. Değişen eski profil resmi silinir.
  function handleMyProfile (ctx) {
    const b = ctx.body
    const user = ctx.user
    if (b.profile !== null && !validEnvelope(b.profile, config.maxProfileChars)) return fail(ctx, 400, 'bad_profile')
    let rec = null
    if (b.avatarUploadId !== null) {
      if (typeof b.avatarUploadId !== 'string' || !UPLOAD_ID_RE.test(b.avatarUploadId)) return fail(ctx, 400, 'bad_avatar')
      rec = uploadsById.get(b.avatarUploadId) || null
      const ownFree = rec !== null && rec.uploaderId === user.id && rec.messageId === null
      const linkedElsewhere = rec !== null && isId(rec.profileUserId) && rec.profileUserId !== user.id
      if (!ownFree || linkedElsewhere) return fail(ctx, 400, 'bad_avatar')
      if (rec.size > config.avatarMaxBytes) return fail(ctx, 413, 'avatar_too_large')
    }
    if (!takeProfileSlot(ctx)) return
    const nextAvatar = rec === null ? null : rec.id
    if (user.profile === b.profile && user.avatarUploadId === nextAvatar) return ok(ctx, { ok: true, pv: user.pv })
    const previous = user.avatarUploadId
    user.profile = b.profile
    user.avatarUploadId = nextAvatar
    if (rec !== null) rec.profileUserId = user.id
    user.pv++
    if (previous !== null && previous !== nextAvatar) removeUploads([previous])
    store.saveState()
    hub.bumpMeta()
    ok(ctx, { ok: true, pv: user.pv })
  }

  // Durum: online, idle, dnd veya invisible. Görünmez kullanıcı başkalarına çevrimdışı görünür.
  function handleMyStatus (ctx) {
    const status = ctx.body.status
    if (typeof status !== 'string' || !STATUSES.has(status)) return fail(ctx, 400, 'bad_status')
    if (!takeProfileSlot(ctx)) return
    const user = ctx.user
    if (user.status !== status) {
      user.status = status
      store.saveState()
      privateChanged([user.id])
      hub.bumpMeta()
    }
    ok(ctx, { ok: true, status })
  }

  function sessionView (s, current) {
    const rt = hub.runtime(s.hash)
    const lastUsed = Math.max(s.lastUsed, rt ? rt.lastSeen : 0)
    return { id: s.hash.slice(0, 16), label: s.label || null, createdAt: s.createdAt, lastUsed, current: s === current }
  }

  // Kullanıcının kendi oturumları: bu cihaz önce, sonra son kullanıma göre yeniden eskiye.
  // Kimlik token karmasının ilk 16 hex karakteridir, token'ın kendisi hiçbir zaman dönmez.
  function handleMySessions (ctx) {
    const list = sessionsOf(ctx.user.id).map((s) => sessionView(s, ctx.session))
    list.sort((a, b) => Number(b.current) - Number(a.current) || b.lastUsed - a.lastUsed || b.createdAt - a.createdAt)
    ok(ctx, { sessions: list })
  }

  // { id } ile tek oturum veya { others: true } ile bu cihaz dışındaki tüm oturumlar kapatılır.
  // Yalnızca kendi oturumları kapatılabilir. Kapatılan oturumun bekleyen poll'ları 401 alır.
  function handleMySessionsRevoke (ctx) {
    const b = ctx.body
    const byId = b.id !== undefined
    const others = b.others !== undefined
    if (byId === others) return fail(ctx, 400, 'bad_request')
    if (byId ? typeof b.id !== 'string' || !SESSION_ID_RE.test(b.id) : b.others !== true) return fail(ctx, 400, 'bad_request')
    if (!takeSocialSlot(ctx)) return
    const own = sessionsOf(ctx.user.id)
    const doomed = byId ? own.filter((s) => s.hash.startsWith(b.id)) : own.filter((s) => s !== ctx.session)
    if (byId && doomed.length === 0) return fail(ctx, 404, 'session_not_found')
    deleteSessions(doomed, 'invalid_token')
    return okDurable(ctx, { ok: true, revoked: doomed.length })
  }

  // ---------------------------------------------------------------- uç noktalar: arkadaşlar ve engeller

  const SOCIAL_STATUS = {
    request_failed: 403,
    already_friends: 409,
    already_pending: 409,
    too_many_pending: 409,
    too_many_friends: 409,
    request_not_found: 404,
    not_friends: 404
  }

  function socialResult (ctx, result, targetId) {
    if (result.error) return fail(ctx, SOCIAL_STATUS[result.error] || 400, result.error)
    ok(ctx, { ok: true, userId: targetId, state: result.state })
  }

  // Hedef kullanıcı: silinmemiş (yeni istekte sunucudan engellenmemiş de olmalı).
  // Bulunamazsa yanıt verilir ve null döner.
  function socialTarget (ctx, value, newRequest) {
    const target = findLiveUser(value)
    if (!target || (newRequest && target.banned)) {
      fail(ctx, 404, 'user_not_found')
      return null
    }
    if (target.id === ctx.user.id) {
      fail(ctx, 400, 'self')
      return null
    }
    return target
  }

  function handleFriendRequest (ctx) {
    const wait = friendLimiter.consume('u' + ctx.user.id, ctx.now)
    if (wait > 0) return tooMany(ctx, wait)
    const b = ctx.body
    let targetRef = b.userId
    if (b.userId === undefined) {
      const name = auth.cleanUsername(b.name)
      if (name === null) return fail(ctx, 400, 'invalid_name')
      const byName = usersByKey.get(name)
      targetRef = byName ? byName.id : null
    }
    const target = socialTarget(ctx, targetRef, true)
    if (!target) return
    socialResult(ctx, social.request(ctx.user.id, target.id, Date.now()), target.id)
  }

  function handleFriendAccept (ctx) {
    if (!takeSocialSlot(ctx)) return
    const target = socialTarget(ctx, ctx.body.userId)
    if (!target) return
    socialResult(ctx, social.accept(ctx.user.id, target.id), target.id)
  }

  function handleFriendDecline (ctx) {
    if (!takeSocialSlot(ctx)) return
    const target = socialTarget(ctx, ctx.body.userId)
    if (!target) return
    socialResult(ctx, social.decline(ctx.user.id, target.id), target.id)
  }

  // Arkadaşlık bitince aralarındaki çalan veya süren arama da biter
  function handleFriendRemove (ctx) {
    if (!takeSocialSlot(ctx)) return
    const target = socialTarget(ctx, ctx.body.userId)
    if (!target) return
    const result = social.remove(ctx.user.id, target.id)
    if (!result.error) endCallBetween(ctx.user.id, target.id)
    socialResult(ctx, result, target.id)
  }

  // Sunucudan engellenmiş kişi de kişisel olarak engellenebilir. Aralarındaki çalan veya süren arama biter.
  function handleBlockAdd (ctx) {
    if (!takeSocialSlot(ctx)) return
    const target = findLiveUser(ctx.body.userId)
    if (!target) return fail(ctx, 404, 'user_not_found')
    if (target.id === ctx.user.id) return fail(ctx, 400, 'self')
    const result = social.block(ctx.user.id, target.id, Date.now())
    if (!result.error) {
      hub.typingPairChanged(ctx.user.id, target.id)
      endCallBetween(ctx.user.id, target.id)
    }
    if (!result.error) return okDurable(ctx, { ok: true, userId: target.id, state: result.state })
    socialResult(ctx, result, target.id)
  }

  function handleBlockRemove (ctx) {
    if (!takeSocialSlot(ctx)) return
    const id = toId(ctx.body.userId)
    if (id === null) return fail(ctx, 400, 'bad_request')
    if (id === ctx.user.id) return fail(ctx, 400, 'self')
    const result = social.unblock(ctx.user.id, id)
    if (!result.error) hub.typingPairChanged(ctx.user.id, id)
    socialResult(ctx, result, id)
  }

  // Konuşma varsa (iki yönde engel yoksa) mevcut olan döner. Yeni konuşma için
  // iki yönde engel olmamalı ve taraflar arkadaş olmalı veya hedef üyelerden mesaj kabul etmeli.
  function handleDmOpen (ctx) {
    if (!takeSocialSlot(ctx)) return
    const me = ctx.user
    const target = findLiveUser(ctx.body.userId)
    if (!target) return fail(ctx, 404, 'user_not_found')
    if (target.id === me.id) return fail(ctx, 400, 'self')
    if (target.banned || social.isBlockedEither(me.id, target.id)) return fail(ctx, 403, 'dm_not_allowed')
    let dm = social.dmBetween(me.id, target.id)
    if (!dm) {
      if (!social.areFriends(me.id, target.id) && !target.allowMemberDms) return fail(ctx, 403, 'dm_not_allowed')
      if (social.dmCount(me.id) >= config.maxDmsPerUser || social.dmCount(target.id) >= config.maxDmsPerUser) {
        return fail(ctx, 409, 'too_many_dms')
      }
      dm = social.createDm(me.id, target.id, Date.now())
      channelsById.set(dm.id, dm)
    }
    ok(ctx, { ok: true, dm: { id: dm.id, userId: target.id } })
  }

  // ---------------------------------------------------------------- uç noktalar: mesajlar

  // Yazı kanalı veya üyesi olunan özel konuşma. Başkasının konuşması bulunamadı olarak görünür.
  // before: bu kimlikten eski sayfa ({ messages, hasMore }). around: bu kimliğin etrafındaki sayfa
  // (yaklaşık limit/2 eski mesaj, mesajın kendisi ve yeni mesajlar, { messages, hasMore, hasNewer }).
  // Mesaj bu kanalda yoksa (ör. silinmişse) aynı konumun etrafı döner. İkisi birlikte verilemez.
  function handleMessagesList (ctx) {
    const q = ctx.query
    const channel = readableChannel(toId(q.get('channel')), ctx.user)
    if (!channel) return fail(ctx, 404, 'channel_not_found')
    const before = optionalCounter(q.get('before'))
    const around = optionalCounter(q.get('around'))
    if (before === null || around === null || (before !== undefined && around !== undefined)) return fail(ctx, 400, 'bad_request')
    let limit = MESSAGES_PAGE_DEFAULT
    const limitRaw = q.get('limit')
    if (limitRaw !== null && limitRaw !== '') {
      const parsed = parseNonNegative(limitRaw)
      if (parsed === null) return fail(ctx, 400, 'bad_request')
      limit = Math.min(MESSAGES_PAGE_MAX, Math.max(1, parsed))
    }
    if (around !== undefined) {
      const page = store.listAround(channel.id, { around, limit })
      return ok(ctx, { messages: page.messages, hasMore: page.hasMore, hasNewer: page.hasNewer })
    }
    const result = store.listMessages(channel.id, { before, limit })
    ok(ctx, { messages: result.messages, hasMore: result.hasMore })
  }

  // Mesaja eklenecek yüklemeler: gönderene ait, henüz bağlanmamış, var olan kayıtlar. Geçersizse null.
  function pickUploads (value, user) {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value) || value.length > config.maxUploadsPerMessage) return null
    const seen = new Set()
    const records = []
    for (const id of value) {
      if (typeof id !== 'string' || !UPLOAD_ID_RE.test(id) || seen.has(id)) return null
      seen.add(id)
      const rec = uploadsById.get(id)
      // Profil resmi olarak kullanılan yükleme mesaja eklenemez
      if (!rec || rec.uploaderId !== user.id || rec.messageId !== null || isId(rec.profileUserId)) return null
      records.push(rec)
    }
    return records
  }

  function takeMessageSlot (ctx) {
    const wait = messageLimiter.consume('u' + ctx.user.id, ctx.now)
    if (wait === 0) return true
    tooMany(ctx, wait, 'detail.messageRate')
    return false
  }

  // Yazı kanalında yalnızca grup anahtarı zarfı (1.), özel konuşmada yalnızca kişisel anahtar zarfı (2.)
  function validBody (channel, body) {
    return channel.type === 'dm' ? validDmEnvelope(body, config.maxBodyChars) : validEnvelope(body, config.maxBodyChars)
  }

  function emitMessageEvent (channel, event) {
    hub.emit(event, audienceOf(channel))
  }

  function emitDropped (dropped) {
    if (dropped.length === 0) return
    removeUploads(uploadsOfMessages(dropped))
    const touched = new Set()
    for (const m of dropped) {
      const channel = findChannel(m.channelId)
      emitMessageEvent(channel, { type: 'del', channelId: m.channelId, messageId: m.id })
      if (channel && channel.type === 'dm') touched.add(channel)
    }
    for (const channel of touched) social.touchDm(channel)
  }

  // Bu kullanıcının bu istemci kimliğiyle bu kanala daha önce gönderdiği ve hâlâ duran mesaj, yoksa null
  function sentMessageOf (user, clientId, channel) {
    const sent = sentByClientId.get(user.id)
    const messageId = sent ? sent.get(clientId) : undefined
    if (messageId === undefined) return null
    const message = store.getMessage(messageId)
    if (!message || message.channelId !== channel.id || message.authorId !== user.id) return null
    return message
  }

  function rememberClientId (user, clientId, messageId) {
    let sent = sentByClientId.get(user.id)
    if (!sent) {
      sent = new Map()
      sentByClientId.set(user.id, sent)
    }
    sent.delete(clientId)
    sent.set(clientId, messageId)
    if (sent.size > CLIENT_IDS_PER_USER) sent.delete(sent.keys().next().value)
  }

  // clientMessageId (isteğe bağlı): aynı kimlikle gelen yineleme yeni mesaj açmaz, ilk mesaj aynı
  // yanıt şekliyle döner. Ekler, hız sınırı ve yazma izni yinelemede yeniden işlenmez.
  function handleMessageSend (ctx) {
    const b = ctx.body
    const clientId = b.clientMessageId
    if (clientId !== undefined && (typeof clientId !== 'string' || !CLIENT_MESSAGE_ID_RE.test(clientId))) return fail(ctx, 400, 'bad_request')
    const channel = readableChannel(toId(b.channelId), ctx.user)
    if (!channel) return fail(ctx, 404, 'channel_not_found')
    const earlier = clientId === undefined ? null : sentMessageOf(ctx.user, clientId, channel)
    if (earlier) return ok(ctx, { ok: true, message: earlier })
    if (channel.type === 'dm' && !canWriteDm(channel, ctx.user)) return fail(ctx, 403, 'dm_not_allowed')
    if (!validBody(channel, b.body)) return fail(ctx, 400, 'bad_body')
    const records = pickUploads(b.uploads, ctx.user)
    if (records === null) return fail(ctx, 400, 'bad_uploads')
    if (!takeMessageSlot(ctx)) return
    state.counters.message++
    const message = {
      id: state.counters.message,
      channelId: channel.id,
      authorId: ctx.user.id,
      body: b.body,
      createdAt: Date.now(),
      editedAt: null,
      uploads: records.map((r) => r.id)
    }
    const dropped = store.addMessage(message)
    for (const rec of records) rec.messageId = message.id
    store.saveState()
    if (clientId !== undefined) rememberClientId(ctx.user, clientId, message.id)
    const saved = store.getMessage(message.id) || message
    emitMessageEvent(channel, { type: 'msg', channelId: channel.id, message: saved })
    // Mesajı gönderen artık bu kanalda yazmıyordur
    hub.setTyping(channel.id, audienceOf(channel), ctx.user.id, false, ctx.now)
    if (channel.type === 'dm') social.touchDm(channel)
    emitDropped(dropped)
    ok(ctx, { ok: true, message: saved })
  }

  // Kullanıcının erişebildiği kanaldaki mesaj ve kanalı, yoksa null
  function findLiveMessage (value, user) {
    const id = toId(value)
    if (id === null) return null
    const message = store.getMessage(id)
    if (!message) return null
    const channel = readableChannel(message.channelId, user)
    return channel ? { message, channel } : null
  }

  function handleMessageEdit (ctx) {
    const b = ctx.body
    const found = findLiveMessage(b.id, ctx.user)
    if (!found) return fail(ctx, 404, 'message_not_found')
    const { message, channel } = found
    if (message.authorId !== ctx.user.id) return fail(ctx, 403, 'forbidden')
    if (channel.type === 'dm' && !canWriteDm(channel, ctx.user)) return fail(ctx, 403, 'dm_not_allowed')
    if (!validBody(channel, b.body)) return fail(ctx, 400, 'bad_body')
    if (!takeMessageSlot(ctx)) return
    const updated = store.editMessage(message.id, b.body, Date.now())
    if (!updated) return fail(ctx, 404, 'message_not_found')
    emitMessageEvent(channel, { type: 'edit', channelId: updated.channelId, message: updated })
    // Büyüyen gövde toplam gövde bütçesini aşabilir (src/store.js AVG_BODY_CHARS)
    emitDropped(store.trimMessages())
    ok(ctx, { ok: true, message: updated })
  }

  // Yazı kanalında kendi mesajı veya mesaj silme izni olan (sahip, yönetici, izinli rol), özel konuşmada
  // yalnızca kendi mesajı
  function handleMessageDelete (ctx) {
    const found = findLiveMessage(ctx.body.id, ctx.user)
    if (!found) return fail(ctx, 404, 'message_not_found')
    const { message, channel } = found
    const own = message.authorId === ctx.user.id
    if (!own && (channel.type === 'dm' || !hasPerm(ctx.user, 'messages'))) return fail(ctx, 403, 'forbidden')
    const removed = store.deleteMessage(message.id)
    if (!removed) return fail(ctx, 404, 'message_not_found')
    removeUploads(removed.uploads)
    emitMessageEvent(channel, { type: 'del', channelId: removed.channelId, messageId: removed.id })
    if (channel.type === 'dm') social.touchDm(channel)
    ok(ctx, { ok: true })
  }

  // ---------------------------------------------------------------- uç noktalar: yazıyor

  // Yazıyor bildirimi (stop: true ile geri alınır). Kalıcı değildir, diske yazılmaz. Yazı kanalında
  // herkese, özel konuşmada yalnızca iki üyeye duyurulur. Yeni mesaj yazılamayan özel konuşmada
  // (engel, karşı taraf engelli veya silinmiş) yazmaya başlanamaz, bırakmak her zaman serbesttir.
  function handleTyping (ctx) {
    const b = ctx.body
    if (b.stop !== undefined && typeof b.stop !== 'boolean') return fail(ctx, 400, 'bad_request')
    const wait = typingLimiter.consume('u' + ctx.user.id, ctx.now)
    if (wait > 0) return tooMany(ctx, wait, 'detail.typingRate')
    const channel = readableChannel(toId(b.channelId), ctx.user)
    if (!channel) return fail(ctx, 404, 'channel_not_found')
    const on = b.stop !== true
    if (on && channel.type === 'dm' && !canWriteDm(channel, ctx.user)) return fail(ctx, 403, 'dm_not_allowed')
    hub.setTyping(channel.id, audienceOf(channel), ctx.user.id, on, ctx.now)
    ok(ctx, { ok: true })
  }

  // ---------------------------------------------------------------- uç noktalar: yüklemeler

  // İstek gövdesini akışla geçici dosyaya yazar.
  // Sonuç: 'ok' | 'too_large' | 'quota_full' | 'user_quota_full' | 'aborted' | 'error' | 'signed_out' (deleteSessions keser)
  function receiveUpload (job, ws) {
    const req = job.req
    return new Promise((resolve) => {
      let done = false
      let idleTimer = null
      let rateTimer = null
      function finish (result) {
        if (done) return
        done = true
        clearTimeout(idleTimer)
        clearTimeout(rateTimer)
        req.removeListener('data', onData)
        req.removeListener('end', onEnd)
        req.removeListener('error', onAbort)
        req.removeListener('close', onClose)
        ws.removeListener('drain', onDrain)
        ws.removeListener('error', onWriteError)
        job.finish = null
        resolve(result)
      }
      function armIdle () {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          finish('aborted')
          req.destroy()
        }, UPLOAD_IDLE_MS)
        if (typeof idleTimer.unref === 'function') idleTimer.unref()
      }
      // Gelen bayt, yüklemenin hız alt sınırından biriken payının altındaysa yükleme kesilir (damlatılan gövde
      // yükleme yerini tutamaz). Pay accrueUploadAllowance ile eşzamanlı yükleme sayısına göre biriktirilir.
      function armRate (delay) {
        rateTimer = setTimeout(() => {
          accrueUploadAllowance(Date.now())
          if (job.bytes < job.allowance) {
            finish('aborted')
            req.destroy()
            return
          }
          armRate(UPLOAD_RATE_CHECK_MS)
        }, delay)
        if (typeof rateTimer.unref === 'function') rateTimer.unref()
      }
      function onData (chunk) {
        if (done) return
        armIdle()
        job.bytes += chunk.length
        inflightBytes += chunk.length
        if (job.bytes > config.uploadMaxBytes) {
          req.pause()
          finish('too_large')
          return
        }
        if (uploadsUsed + inflightBytes > config.uploadQuotaBytes) {
          req.pause()
          finish('quota_full')
          return
        }
        if (userUploadBytes(job.userId) > config.userUploadQuotaBytes) {
          req.pause()
          finish('user_quota_full')
          return
        }
        if (!ws.write(chunk)) req.pause()
      }
      function onDrain () {
        if (!done) req.resume()
      }
      function onEnd () {
        ws.end()
        finish('ok')
      }
      function onAbort () {
        finish('aborted')
      }
      function onClose () {
        if (!req.complete) finish('aborted')
      }
      function onWriteError () {
        req.pause()
        finish('error')
      }
      job.finish = finish
      req.on('data', onData)
      req.on('end', onEnd)
      req.on('error', onAbort)
      req.on('close', onClose)
      ws.on('drain', onDrain)
      ws.on('error', onWriteError)
      armIdle()
      armRate(config.uploadRateGraceMs)
      if (req.destroyed) finish('aborted')
    })
  }

  // Bir yüklemenin hız alt sınırından aldığı pay: aynı hesabın veya aynı adresin eşzamanlı yüklemeleri sınırı
  // paylaşır. Bölen en çok MAX_UPLOADS_PER_USER olur, böylece bir yüklemeye düşen pay sınırın yarısının altına
  // inmez ve yer tutma süresi sınırlı kalır.
  function uploadShare (job) {
    let count = 1
    for (const other of uploadJobs) {
      if (other !== job && (other.userId === job.userId || other.ipKey === job.ipKey)) count++
    }
    return Math.min(count, MAX_UPLOADS_PER_USER)
  }

  // Her yüklemenin hız alt sınırından o ana kadar biriken payını (bayt) günceller. Eşzamanlı yükleme sayısı
  // değişmeden önce (yükleme başlarken ve biterken) ve her hız denetiminde çağrılır, böylece her zaman aralığı
  // o aralıktaki yükleme sayısına göre hesaplanır: diğer dosya bitince kalan yükleme geçmiş süre için
  // cezalandırılmaz, yalnızca bundan sonrası için sınırın tamamını karşılamalıdır.
  function accrueUploadAllowance (now) {
    for (const job of uploadJobs) {
      if (now > job.accruedAt) job.allowance += (now - job.accruedAt) * config.uploadMinBytesPerSec / 1000 / uploadShare(job)
      job.accruedAt = now
    }
  }

  async function handleUpload (ctx) {
    const wait = uploadLimiter.consume('u' + ctx.user.id, ctx.now)
    if (wait > 0) return tooMany(ctx, wait, 'detail.uploadRate')
    if (activeUploads >= config.maxConcurrentUploads) return fail(ctx, 503, 'busy')
    // Birkaç hesap bütün yerleri tutup herkesin yüklemesini engelleyemesin: hesap ve adres başına en fazla
    // MAX_UPLOADS_PER_USER yer, son boş yer de yalnızca hiç yer tutmayan hesap ve adrese verilir. Varsayılan altı
    // yerin hepsini tutmak için en az dört hesap ve dört ayrı adres gerekir, her hesap ve adres yerlerini en az
    // uploadMinBytesPerSec toplam hızla gerçekten veri göndererek tutar. Bu kurallarla verilen ret sunucu dolu
    // olduğu için verilen busy yanıtından ayrı olarak busy_reserved kodunu taşır: istemci bekleyip yeniden dener,
    // yer tutan yükleme (kendisinin veya aynı ağdaki birinin) bitince yer açılır.
    const ipKey = requestIpKey(ctx.req)
    let ownJobs = 0
    let ipJobs = 0
    for (const job of uploadJobs) {
      if (job.userId === ctx.user.id) ownJobs++
      if (job.ipKey === ipKey) ipJobs++
    }
    if (ownJobs >= MAX_UPLOADS_PER_USER || ipJobs >= MAX_UPLOADS_PER_USER) return fail(ctx, 503, 'busy_reserved')
    if (activeUploads === config.maxConcurrentUploads - 1 && (ownJobs > 0 || ipJobs > 0)) return fail(ctx, 503, 'busy_reserved')
    const declared = util.contentLength(ctx.req)
    if (declared !== null && declared > config.uploadMaxBytes) return failTooLarge(ctx)
    if (declared === 0) return fail(ctx, 400, 'empty_upload')
    if (uploadsUsed + inflightBytes + (declared || 1) > config.uploadQuotaBytes) return fail(ctx, 507, 'quota_full')
    if (userUploadBytes(ctx.user.id) + (declared || 1) > config.userUploadQuotaBytes) return fail(ctx, 507, 'user_quota_full')
    // Bundan sonra gövde okunur, ret yanıtlarında bağlantı kapatılır
    ctx.drainable = false

    const id = crypto.randomBytes(16).toString('hex')
    const startedAt = Date.now()
    const job = { req: ctx.req, session: ctx.session, userId: ctx.user.id, ipKey, bytes: 0, allowance: 0, accruedAt: startedAt, finish: null }
    accrueUploadAllowance(startedAt)
    activeUploads++
    uploadJobs.add(job)
    try {
      const ws = store.createUploadWriteStream(id)
      const result = await receiveUpload(job, ws)
      if (result !== 'ok') {
        await store.discardUpload(id).catch((err) => log.warn(i18n.t(config.lang, 'log.partialUploadRemoveFailed', { error: errText(err, config.lang) })))
        if (result === 'too_large') return failTooLarge(ctx)
        if (result === 'quota_full') return fail(ctx, 507, 'quota_full')
        if (result === 'user_quota_full') return fail(ctx, 507, 'user_quota_full')
        if (result === 'error') return fail(ctx, 500, 'server_error')
        if (result === 'signed_out') return failSignedOut(ctx)
        return
      }
      const size = await store.commitUpload(id)
      // Gövde okunurken veya dosya kaydedilirken oturum kapanmış ya da hesap engellenmiş, silinmiş olabilir
      if (!stillSignedIn(ctx)) {
        await store.removeUpload(id).catch(noop)
        return failSignedOut(ctx)
      }
      if (size === 0) {
        await store.removeUpload(id).catch(noop)
        return fail(ctx, 400, 'empty_upload')
      }
      const rec = { id, size, uploaderId: ctx.user.id, createdAt: Date.now(), messageId: null }
      state.uploads.push(rec)
      uploadsById.set(id, rec)
      uploadsUsed += size
      addUserUploadBytes(rec.uploaderId, size)
      store.saveState()
      ok(ctx, { id, size })
    } finally {
      accrueUploadAllowance(Date.now())
      activeUploads--
      inflightBytes -= job.bytes
      uploadJobs.delete(job)
    }
  }

  function failTooLarge (ctx) {
    const mb = Math.floor((config.uploadMaxBytes - 16) / (1024 * 1024))
    if (mb >= 1) return fail(ctx, 413, 'too_large', 'detail.uploadTooLarge', null, { mb })
    return fail(ctx, 413, 'too_large', 'detail.fileTooLarge')
  }

  // Profil resmine bağlı yükleme: bağlı olduğu hesap silinmemiş ve engellenmemişse oturum açmış
  // herkese açıktır.
  function isAvatarRecord (rec) {
    if (!isId(rec.profileUserId)) return false
    const owner = usersById.get(rec.profileUserId)
    return Boolean(owner) && owner.avatarUploadId === rec.id
  }

  // Mesaja bağlı yükleme: yazı kanalındaysa herkese, özel konuşmadaysa yalnızca iki üyeye açıktır.
  // Profil resmi herkese, başka hiçbir yere bağlı olmayan yükleme yalnızca yükleyene açıktır.
  function canDownload (rec, user) {
    if (isAvatarRecord(rec)) {
      const owner = usersById.get(rec.profileUserId)
      return !owner.deleted && !owner.banned
    }
    if (rec.messageId === null) return rec.uploaderId === user.id
    const message = store.getMessage(rec.messageId)
    return Boolean(message) && readableChannel(message.channelId, user) !== null
  }

  async function handleDownload (ctx) {
    const id = ctx.param
    if (typeof id !== 'string' || !UPLOAD_ID_RE.test(id)) return fail(ctx, 404, 'not_found')
    const rec = uploadsById.get(id)
    if (!rec || !canDownload(rec, ctx.user)) return fail(ctx, 404, 'upload_not_found')
    let handle
    try {
      handle = await fs.promises.open(store.uploadPath(id), 'r')
    } catch (err) {
      if (err && err.code === 'ENOENT') return fail(ctx, 404, 'upload_not_found')
      throw err
    }
    let info
    try {
      info = await handle.stat()
    } catch (err) {
      await handle.close().catch(noop)
      throw err
    }
    const res = ctx.res
    if (!util.canRespond(res)) {
      await handle.close().catch(noop)
      return
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Length', info.size)
    res.setHeader('Content-Disposition', 'attachment')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Security-Policy', util.DOWNLOAD_CSP)
    if (closing) res.setHeader('Connection', 'close')
    const stream = handle.createReadStream({ autoClose: true })
    pipeline(stream, res, (err) => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') log.warn(i18n.t(config.lang, 'log.downloadFailed', { error: errText(err, config.lang) }))
    })
  }

  // ---------------------------------------------------------------- uç noktalar: kanallar

  function handleChannelCreate (ctx) {
    if (!requirePerm(ctx, 'channels') || !takeAdminSlot(ctx)) return
    const b = ctx.body
    const name = auth.cleanChannelName(b.name)
    if (name === null) return fail(ctx, 400, 'invalid_channel_name')
    if (b.type !== 'text' && b.type !== 'voice') return fail(ctx, 400, 'invalid_channel_type')
    if (managedChannelCount() >= config.maxChannels) return fail(ctx, 409, 'too_many_channels')
    if (channelNameTaken(b.type, name, null)) return fail(ctx, 409, 'channel_exists')
    state.counters.channel++
    const channel = {
      id: state.counters.channel,
      name,
      type: b.type,
      position: channelsOfType(b.type).length,
      createdAt: Date.now()
    }
    state.channels.push(channel)
    channelsById.set(channel.id, channel)
    renumber(channel.type)
    store.saveState()
    hub.bumpMeta()
    ok(ctx, { ok: true, channel: publicChannel(channel) })
  }

  function handleChannelUpdate (ctx) {
    if (!requirePerm(ctx, 'channels') || !takeAdminSlot(ctx)) return
    const b = ctx.body
    const channel = findManagedChannel(toId(b.id))
    if (!channel) return fail(ctx, 404, 'channel_not_found')
    const hasName = b.name !== undefined
    const hasPosition = b.position !== undefined
    if (!hasName && !hasPosition) return fail(ctx, 400, 'bad_request')
    let name = null
    if (hasName) {
      name = auth.cleanChannelName(b.name)
      if (name === null) return fail(ctx, 400, 'invalid_channel_name')
      if (channelNameTaken(channel.type, name, channel.id)) return fail(ctx, 409, 'channel_exists')
    }
    if (hasPosition && (!Number.isSafeInteger(b.position) || b.position < 0 || b.position > config.maxChannels)) {
      return fail(ctx, 400, 'bad_request')
    }
    if (name !== null) channel.name = name
    if (hasPosition) {
      const list = channelsOfType(channel.type).filter((c) => c !== channel)
      list.splice(Math.min(b.position, list.length), 0, channel)
      list.forEach((c, i) => {
        c.position = i
      })
    }
    store.saveState()
    hub.bumpMeta()
    ok(ctx, { ok: true, channel: publicChannel(channel) })
  }

  function handleChannelDelete (ctx) {
    if (!requirePerm(ctx, 'channels') || !takeAdminSlot(ctx)) return
    const channel = findManagedChannel(toId(ctx.body.id))
    if (!channel) return fail(ctx, 404, 'channel_not_found')
    if (channel.type === 'text' && channelsOfType('text').length <= 1) return fail(ctx, 409, 'last_text_channel')
    state.channels = state.channels.filter((c) => c !== channel)
    channelsById.delete(channel.id)
    renumber(channel.type)
    if (channel.type === 'voice') {
      hub.kickVoiceRoom(channel.id)
      music.remove(channel.id)
    } else {
      hub.clearTypingChannel(channel.id)
      const removed = store.deleteChannelMessages(channel.id)
      removeUploads(uploadsOfMessages(removed))
    }
    store.saveState()
    hub.bumpMeta()
    ok(ctx, { ok: true })
  }

  // ---------------------------------------------------------------- uç noktalar: üyeler ve ayarlar

  function findUser (value) {
    return findLiveUser(value)
  }

  function handleUserRole (ctx) {
    if (!requireOwner(ctx) || !takeAdminSlot(ctx)) return
    const b = ctx.body
    if (b.role !== 'admin' && b.role !== 'member') return fail(ctx, 400, 'bad_request')
    const target = findUser(b.userId)
    if (!target) return fail(ctx, 404, 'user_not_found')
    if (target.role === 'owner') return fail(ctx, 403, 'forbidden', 'detail.ownerRoleLocked')
    if (target.role !== b.role) {
      target.role = b.role
      store.saveState()
      hub.bumpMeta()
    }
    return okDurable(ctx, { ok: true })
  }

  // Engelleme izni olan, kendinden alt rütbedeki birini engeller veya engelini kaldırır: sahip herkesi (kendisi
  // hariç), yönetici üyeleri, izinli rol rolsüz üyeleri ve listede kendinden aşağıdaki rollerin üyelerini.
  function handleUserBan (ctx) {
    if (!requirePerm(ctx, 'ban') || !takeAdminSlot(ctx)) return
    const b = ctx.body
    if (typeof b.banned !== 'boolean') return fail(ctx, 400, 'bad_request')
    const target = findUser(b.userId)
    if (!target) return fail(ctx, 404, 'user_not_found')
    if (target.id === ctx.user.id || !outranks(ctx.user, target)) return fail(ctx, 403, 'forbidden')
    if (target.banned !== b.banned) {
      target.banned = b.banned
      if (b.banned) {
        endCallsOf(target.id)
        deleteSessions(sessionsOf(target.id), 'banned')
      }
      store.saveState()
      hub.bumpMeta()
    }
    return okDurable(ctx, { ok: true })
  }

  // POST /api/users/kick { userId }: engelleme izni olan, kendinden alt rütbedeki birini frekanstan atar (izin
  // ve rütbe kuralı engellemeyle aynı). Atma hesabı siler (deleteAccount): oturumlar kapanır, ad serbest kalır,
  // mesajlar kalır ve yazarı silinmiş görünür. Kişi ancak davet koduyla yeniden kayıt olarak dönebilir. Sahip
  // hiçbir zaman atılamaz.
  function handleUserKick (ctx) {
    if (!requirePerm(ctx, 'ban') || !takeAdminSlot(ctx)) return
    const target = findUser(ctx.body.userId)
    if (!target) return fail(ctx, 404, 'user_not_found')
    if (target.id === ctx.user.id || target.role === 'owner' || !outranks(ctx.user, target)) return fail(ctx, 403, 'forbidden')
    deleteAccount(target, 'kicked')
    return okDurable(ctx, { ok: true })
  }

  // ---------------------------------------------------------------- uç noktalar: özel roller

  // İzin listesi: ROLE_PERMS içinden, tekrarsız ve ROLE_PERMS sırasıyla. Geçersizse null.
  function rolePerms (value) {
    if (!Array.isArray(value) || value.length > ROLE_PERMS.length || !value.every((p) => ROLE_PERMS.includes(p))) return null
    if (new Set(value).size !== value.length) return null
    return ROLE_PERMS.filter((p) => value.includes(p))
  }

  function roleNameTaken (name, exceptId) {
    const key = name.toLocaleLowerCase('tr')
    return state.roles.some((r) => r.id !== exceptId && r.name.toLocaleLowerCase('tr') === key)
  }

  // POST /api/roles/create { name, color, perms }: yalnızca sahip. Yeni rol listenin sonuna (en alta) eklenir.
  function handleRoleCreate (ctx) {
    if (!requireOwner(ctx) || !takeAdminSlot(ctx)) return
    const b = ctx.body
    const name = auth.cleanRoleName(b.name)
    if (name === null) return fail(ctx, 400, 'invalid_role_name', null, null, { max: auth.ROLE_NAME_MAX })
    if (!ROLE_COLORS.includes(b.color)) return fail(ctx, 400, 'bad_request')
    const perms = rolePerms(b.perms)
    if (perms === null) return fail(ctx, 400, 'bad_request')
    if (state.roles.length >= MAX_ROLES) return fail(ctx, 409, 'too_many_roles', null, null, { max: MAX_ROLES })
    if (roleNameTaken(name, null)) return fail(ctx, 409, 'role_exists')
    state.counters.role++
    const role = { id: state.counters.role, name, color: b.color, perms }
    state.roles.push(role)
    store.saveState()
    hub.bumpMeta()
    return okDurable(ctx, { ok: true, role: publicRole(role) })
  }

  // POST /api/roles/update { id, name?, color?, perms?, position? } (en az biri): yalnızca sahip. position rolün
  // listedeki yeni sırasıdır (0 en üst), rütbeyi belirler.
  function handleRoleUpdate (ctx) {
    if (!requireOwner(ctx) || !takeAdminSlot(ctx)) return
    const b = ctx.body
    const role = findRole(toId(b.id))
    if (!role) return fail(ctx, 404, 'role_not_found')
    const hasName = b.name !== undefined
    const hasColor = b.color !== undefined
    const hasPerms = b.perms !== undefined
    const hasPosition = b.position !== undefined
    if (!hasName && !hasColor && !hasPerms && !hasPosition) return fail(ctx, 400, 'bad_request')
    let name = null
    if (hasName) {
      name = auth.cleanRoleName(b.name)
      if (name === null) return fail(ctx, 400, 'invalid_role_name', null, null, { max: auth.ROLE_NAME_MAX })
      if (roleNameTaken(name, role.id)) return fail(ctx, 409, 'role_exists')
    }
    if (hasColor && !ROLE_COLORS.includes(b.color)) return fail(ctx, 400, 'bad_request')
    const perms = hasPerms ? rolePerms(b.perms) : null
    if (hasPerms && perms === null) return fail(ctx, 400, 'bad_request')
    if (hasPosition && (!Number.isSafeInteger(b.position) || b.position < 0 || b.position >= MAX_ROLES)) return fail(ctx, 400, 'bad_request')
    if (name !== null) role.name = name
    if (hasColor) role.color = b.color
    if (perms !== null) role.perms = perms
    if (hasPosition) {
      const list = state.roles.filter((r) => r !== role)
      list.splice(Math.min(b.position, list.length), 0, role)
      state.roles = list
    }
    store.saveState()
    hub.bumpMeta()
    return okDurable(ctx, { ok: true, role: publicRole(role) })
  }

  // POST /api/roles/delete { id }: yalnızca sahip. Rolü taşıyan üyeler rolsüz kalır.
  function handleRoleDelete (ctx) {
    if (!requireOwner(ctx) || !takeAdminSlot(ctx)) return
    const role = findRole(toId(ctx.body.id))
    if (!role) return fail(ctx, 404, 'role_not_found')
    state.roles = state.roles.filter((r) => r !== role)
    for (const u of state.users) {
      if (u.roleId === role.id) u.roleId = null
    }
    store.saveState()
    hub.bumpMeta()
    return okDurable(ctx, { ok: true })
  }

  // POST /api/users/custom-role { userId, roleId: kimlik | null }: yalnızca sahip, sahibe rol verilemez
  function handleUserCustomRole (ctx) {
    if (!requireOwner(ctx) || !takeAdminSlot(ctx)) return
    const b = ctx.body
    if (b.roleId === undefined) return fail(ctx, 400, 'bad_request')
    const target = findUser(b.userId)
    if (!target) return fail(ctx, 404, 'user_not_found')
    if (target.role === 'owner') return fail(ctx, 403, 'forbidden', 'detail.ownerRoleLocked')
    let roleId = null
    if (b.roleId !== null) {
      const role = findRole(toId(b.roleId))
      if (!role) return fail(ctx, 404, 'role_not_found')
      roleId = role.id
    }
    if (target.roleId !== roleId) {
      target.roleId = roleId
      store.saveState()
      hub.bumpMeta()
    }
    return okDurable(ctx, { ok: true })
  }

  // Geçici parola için istemciyle aynı türetme sunucuda yapılır. Kişisel anahtarlar
  // silinir (kullanıcı sonraki girişte yeni anahtar çifti üretir, eski özel mesajları okunamaz).
  async function handleResetPassword (ctx) {
    if (!requireOwner(ctx)) return
    const target = findLiveUser(ctx.body.userId)
    if (!target) return fail(ctx, 404, 'user_not_found')
    if (target.id === ctx.user.id) return fail(ctx, 403, 'forbidden')
    if (!takeAdminSlot(ctx)) return
    const creds = await gatedHash(() => auth.newCredentials(config.scryptN))
    if (closing) return fail(ctx, 503, 'shutting_down')
    if (!stillSignedIn(ctx) || ctx.user.role !== 'owner') return fail(ctx, 403, 'forbidden')
    if (target.deleted) return fail(ctx, 404, 'user_not_found')
    applyCredentials(target, creds)
    resetLoginFails(target.key)
    loginFailLimiter.reset('p:' + target.id)
    deleteSessions(sessionsOf(target.id), 'invalid_token')
    store.saveState()
    hub.bumpMeta()
    return okDurable(ctx, { ok: true, tempPassword: creds.tempPassword })
  }

  // Telsiz DJ ayar değişikliği: { enabled?, youtube? } (en az biri, yalnızca boolean). Geçersizse null.
  function musicSettingsPatch (value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const keys = Object.keys(value)
    if (keys.length === 0 || !keys.every((k) => MUSIC_SETTING_KEYS.includes(k) && typeof value[k] === 'boolean')) return null
    return value
  }

  // Ses odası ayar değişikliği: { capacity?, cameras?, maxCameras? } (en az biri). Mevcut ayarla birleşmiş
  // yeni ayar döner, geçersizse null. Kamera sınırı kapasiteyi aşarsa istek reddedilir (sessizce düşürülmez).
  function voiceSettingsPatch (value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const keys = Object.keys(value)
    if (keys.length === 0 || !keys.every((k) => VOICE_SETTING_KEYS.includes(k))) return null
    if (value.capacity !== undefined && !intInRange(value.capacity, VOICE_CAPACITY_MIN, VOICE_CAPACITY_MAX)) return null
    if (value.maxCameras !== undefined && !intInRange(value.maxCameras, MAX_CAMERAS_MIN, MAX_CAMERAS_MAX)) return null
    if (value.cameras !== undefined && typeof value.cameras !== 'boolean') return null
    const next = Object.assign({}, state.voice, value)
    if (next.maxCameras > next.capacity) return null
    return next
  }

  function handleSettings (ctx) {
    if (!requireStaff(ctx)) return
    const b = ctx.body
    const hasName = b.serverName !== undefined
    const hasKid = b.activeKid !== undefined
    const hasMusic = b.music !== undefined
    const hasAbout = b.about !== undefined
    const hasVoice = b.voice !== undefined
    if (!hasName && !hasKid && !hasMusic && !hasAbout && !hasVoice) return fail(ctx, 400, 'bad_request')
    if (hasName && ctx.user.role !== 'owner') return fail(ctx, 403, 'forbidden', 'detail.serverNameOwnerOnly')
    if (hasMusic && ctx.user.role !== 'owner') return fail(ctx, 403, 'forbidden', 'detail.musicOwnerOnly')
    if (hasAbout && ctx.user.role !== 'owner') return fail(ctx, 403, 'forbidden', 'detail.aboutOwnerOnly')
    if (hasVoice && ctx.user.role !== 'owner') return fail(ctx, 403, 'forbidden', 'detail.voiceOwnerOnly')
    if (!takeAdminSlot(ctx)) return
    let serverName = null
    if (hasName) {
      serverName = auth.cleanServerName(b.serverName)
      if (serverName === null) return fail(ctx, 400, 'invalid_server_name')
    }
    if (hasKid && b.activeKid !== null && (typeof b.activeKid !== 'string' || !KID_RE.test(b.activeKid))) {
      return fail(ctx, 400, 'bad_kid')
    }
    const musicPatch = hasMusic ? musicSettingsPatch(b.music) : null
    if (hasMusic && musicPatch === null) return fail(ctx, 400, 'bad_request')
    const about = hasAbout ? auth.cleanAbout(b.about) : null
    if (hasAbout && about === null) return fail(ctx, 400, 'invalid_about')
    const voicePatch = hasVoice ? voiceSettingsPatch(b.voice) : null
    if (hasVoice && voicePatch === null) {
      return fail(ctx, 400, 'invalid_voice_settings', null, null, {
        min: VOICE_CAPACITY_MIN, max: VOICE_CAPACITY_MAX, camMin: MAX_CAMERAS_MIN, camMax: MAX_CAMERAS_MAX
      })
    }
    if (hasName) state.serverName = serverName
    if (hasAbout) state.about = about
    if (hasKid) state.activeKid = b.activeKid
    if (musicPatch) state.music = cleanMusicSettings(Object.assign({}, state.music, musicPatch))
    if (voicePatch) {
      state.voice = cleanVoiceSettings(voicePatch, defaultVoiceCapacity(config))
      // Kameralar kapatıldıysa açık kameralar da kapanır (istemciler metadan görüp yayını durdurur)
      if (!state.voice.cameras) hub.clearCameras()
    }
    store.saveState()
    hub.bumpMeta()
    // Grup anahtarı değişimi (activeKid) ve ses odası sınırları kalıcı olmadan yanıt verilmez
    if (hasKid || hasVoice) return okDurable(ctx, { ok: true, voice: state.voice })
    ok(ctx, { ok: true })
  }

  // ---------------------------------------------------------------- uç noktalar: frekans fotoğrafı

  // Frekans fotoğrafı herkese açık üst veridir (frekans adı gibi), uçtan uca şifrelenmez. Giriş öncesi
  // ekranlar ve diğer frekansların bantları için oturumsuz sunulur. ETag içeriğin karmasıdır.
  function handleServerIconGet (ctx) {
    const icon = serverIcon
    if (!icon) return fail(ctx, 404, 'not_found')
    const res = ctx.res
    if (!util.canRespond(res)) return
    const etag = '"' + icon.hash + '"'
    res.setHeader('Content-Type', icon.type)
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('ETag', etag)
    res.setHeader('Content-Security-Policy', util.DOWNLOAD_CSP)
    if (closing) res.setHeader('Connection', 'close')
    if (util.etagMatches(ctx.req.headers['if-none-match'], etag)) {
      res.statusCode = 304
      res.end()
      return
    }
    res.statusCode = 200
    res.setHeader('Content-Length', icon.data.length)
    if (ctx.req.method === 'HEAD') res.end()
    else res.end(icon.data)
  }

  // Frekans adı gibi yalnızca sahip değiştirebilir. Yüklemede gövde okunmadan önce denetlenir.
  function serverIconAllowed (ctx) {
    if (ctx.user.role !== 'owner') {
      fail(ctx, 403, 'forbidden', 'detail.serverIconOwnerOnly')
      return false
    }
    return takeAdminSlot(ctx)
  }

  function failServerIconTooLarge (ctx) {
    return fail(ctx, 413, 'server_icon_too_large', null, null, { kb: Math.floor(config.avatarMaxBytes / 1024) })
  }

  // Eski fotoğrafın dosyası yeni kayıt diske yazıldıktan sonra silinir (o sırada yeniden seçildiyse silinmez)
  function dropServerIconFile (icon) {
    if (!icon || (serverIcon && serverIcon.hash === icon.hash)) return
    store.removeServerIcon(icon.hash).catch((err) => log.warn(i18n.t(config.lang, 'log.serverIconRemoveFailed', { error: errText(err, config.lang) })))
  }

  // POST /api/server-icon: gövde resmin kendisidir (Content-Type'a bakılmaz, tür dosya imzasından). Dosya
  // önce atomik yazılır, sonra kayıt state.json'a geçer ve yanıt kayıt diske yazılınca gider.
  async function handleServerIconUpload (ctx) {
    const data = ctx.raw
    if (!data || data.length === 0) return fail(ctx, 400, 'empty_upload')
    const type = imageType(data)
    if (!type) return fail(ctx, 400, 'bad_server_icon')
    const hash = serverIconHash(data)
    if (serverIcon && serverIcon.hash === hash) return ok(ctx, { ok: true, serverIcon: hash })
    await store.writeServerIcon(hash, data)
    const previous = serverIcon
    serverIcon = { hash, type, data }
    state.serverIcon = { hash, type, size: data.length }
    store.saveState()
    hub.bumpMeta()
    await okDurable(ctx, { ok: true, serverIcon: hash })
    dropServerIconFile(previous)
  }

  async function handleServerIconDelete (ctx) {
    if (!serverIconAllowed(ctx)) return
    if (!serverIcon) return ok(ctx, { ok: true, serverIcon: null })
    const previous = serverIcon
    serverIcon = null
    state.serverIcon = null
    store.saveState()
    hub.bumpMeta()
    await okDurable(ctx, { ok: true, serverIcon: null })
    dropServerIconFile(previous)
  }

  function handleInviteRotate (ctx) {
    if (!requireStaff(ctx) || !takeAdminSlot(ctx)) return
    state.inviteCode = auth.generateCode()
    store.saveState()
    return okDurable(ctx, { ok: true, inviteCode: state.inviteCode })
  }

  // ---------------------------------------------------------------- uç noktalar: sunucu bilgileri

  // TURN adreslerinin ana makinesi (turn:ad:port?transport=udp biçiminden)
  function turnHosts () {
    const hosts = []
    for (const server of config.iceServers) {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
      for (const url of urls) {
        const m = /^turns?:(\[[^\]]+\]|[^:?/]+)/i.exec(String(url))
        if (m) hosts.push(m[1].replace(/^\[|\]$/g, '').toLowerCase())
      }
    }
    return hosts
  }

  // TURN bu makinede mi: adres isteğin Host başlığındaki adla aynı veya geri döngü adresi
  function turnIsLocal (req, hosts) {
    const header = typeof req.headers.host === 'string' ? req.headers.host.toLowerCase() : ''
    const own = header.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
    return hosts.some((h) => h === own || h === 'localhost' || h === '::1' || /^127\./.test(h))
  }

  // GET /api/server-info (sahip ve yöneticiler): donanım, disk, bellek ve kullanım bilgileri. Yalnızca
  // sayısal üst veri döner, içerik ve kişisel bilgi yoktur. Öneriyi istemci bu bilgilerden hesaplar.
  async function handleServerInfo (ctx) {
    if (!requireStaff(ctx) || !takeAdminSlot(ctx)) return
    const facts = await systemInfo.collect({ dataDir: store.dir })
    let online = 0
    for (const u of state.users) {
      if (!u.deleted && !u.banned && u.status !== 'invisible' && hub.isUserOnline(u.id)) online++
    }
    let inVoice = 0
    let cameras = 0
    const voiceMeta = hub.meta().voice
    for (const id of Object.keys(voiceMeta)) {
      for (const m of voiceMeta[id]) {
        inVoice++
        if (m.camera) cameras++
      }
    }
    const hosts = turnHosts()
    ok(ctx, Object.assign(facts, {
      version: VERSION,
      data: {
        uploadsBytes: uploadsUsed,
        uploadQuotaBytes: config.uploadQuotaBytes,
        messageCount: store.messageCount(),
        maxTotalMessages: config.maxTotalMessages,
        users: liveUserCount(),
        maxUsers: config.maxUsers
      },
      online,
      voice: { inVoice, cameras },
      turn: { configured: hosts.length > 0, local: hosts.length > 0 && turnIsLocal(ctx.req, hosts) }
    }))
  }

  // ---------------------------------------------------------------- uç noktalar: ses

  function takeVoiceSlot (ctx) {
    const wait = voiceLimiter.consume('u' + ctx.user.id, ctx.now)
    if (wait === 0) return true
    tooMany(ctx, wait)
    return false
  }

  // Oturum özel mesaj aramasının odasında mı
  function inCallRoom (rt) {
    if (rt.voiceChannelId === null) return false
    const channel = findChannel(rt.voiceChannelId)
    return Boolean(channel) && channel.type === 'dm'
  }

  // Ses odasına veya özel mesaj aramasının odasına katılma. Aramanın odasına yalnızca konuşmanın iki üyesi, arkadaşken,
  // yazışma engeli yokken ve konuşmada çalan veya süren bir arama varken katılabilir. Aksi halde konuşma yok görünür.
  // Sunucu susturması özel aramaya uygulanmaz.
  function handleVoiceJoin (ctx) {
    if (!takeVoiceSlot(ctx)) return
    const channel = findChannel(toId(ctx.body.channelId))
    if (channel && channel.type === 'dm') {
      const rec = callableDm(channel, ctx.user) ? calls.live(channel.id, Date.now()) : null
      // Reddettiği aramanın odasına aranan katılamaz (arama ona görünmez)
      if (!rec || calls.hiddenFrom(rec, ctx.user.id)) return fail(ctx, 404, 'channel_not_found')
      const callMembers = hub.voiceJoin(ctx.rt, channel.id, CALL_CAPACITY)
      if (callMembers === null) return fail(ctx, 409, 'voice_full')
      cancelRingingBy(ctx.user.id, channel.id)
      return ok(ctx, { ok: true, peerId: ctx.rt.peerId, members: callMembers, iceServers: config.iceServers })
    }
    if (!channel || channel.type !== 'voice') return fail(ctx, 404, 'channel_not_found')
    const members = hub.voiceJoin(ctx.rt, channel.id, state.voice.capacity)
    if (members === null) return fail(ctx, 409, 'voice_full')
    if (ctx.user.voiceMuted === true) hub.forceMute(ctx.user.id)
    ok(ctx, { ok: true, peerId: ctx.rt.peerId, members, iceServers: config.iceServers })
  }

  // POST /api/voice/camera { on }: kameranın açık olduğu bilgisi (görüntünün kendisi kişiler arasında doğrudan
  // akar, sunucudan geçmez). Sunucu yalnızca sahibin ayarını ve oda başına kamera sınırını uygular (özel aramada 2).
  function handleVoiceCamera (ctx) {
    const b = ctx.body
    if (typeof b.on !== 'boolean') return fail(ctx, 400, 'bad_request')
    if (!takeVoiceSlot(ctx)) return
    if (b.on && !state.voice.cameras) return fail(ctx, 403, 'camera_disabled')
    const max = inCallRoom(ctx.rt) ? CALL_MAX_CAMERAS : state.voice.maxCameras
    const result = hub.setCamera(ctx.rt, b.on, max)
    if (result === 'not_in_voice') return fail(ctx, 403, 'not_in_voice')
    if (result === 'camera_limit') return fail(ctx, 409, 'camera_limit', null, null, { max })
    ok(ctx, { ok: true, camera: b.on })
  }

  function handleVoiceLeave (ctx) {
    if (!takeVoiceSlot(ctx)) return
    hub.voiceLeave(ctx.rt)
    ok(ctx, { ok: true })
  }

  function handleVoiceState (ctx) {
    const b = ctx.body
    if (typeof b.muted !== 'boolean' || typeof b.deafened !== 'boolean') return fail(ctx, 400, 'bad_request')
    if (!takeVoiceSlot(ctx)) return
    // Herkes için susturulmuş kişinin mikrofonu ses odalarında kapalı görünür (özel aramada değil)
    const forced = ctx.user.voiceMuted === true && !inCallRoom(ctx.rt)
    hub.setVoiceState(ctx.rt, b.muted || forced, b.deafened)
    ok(ctx, { ok: true })
  }

  // POST /api/voice/moderate { userId, action: 'mute' | 'unmute' | 'disconnect' | 'camera-off' } (ses odası denetimi
  // izni). Hedef işlemi yapandan alt rütbede olmalıdır. Susturma hesaba yazılır: kişi odadan çıkıp girse de, sunucu
  // yeniden başlasa da sürer. Ses kişiler arasında doğrudan aktığı için susturmayı istemciler uygular: kişinin kendi
  // istemcisi mikrofonu kapatır, diğerlerinin istemcisi o kişinin sesini çalmaz. Çıkarma kişiyi yalnızca o anki
  // odadan çıkarır, yeniden katılabilir. Kamerayı kapatma tek seferliktir: sunucu kişinin kamerasını kapalı yapar,
  // kişinin istemcisi metadan görüp yerel kamerayı durdurur, kişi kamerasını yeniden açabilir. Denetim özel mesaj
  // aramalarına uzanmaz: hedef yalnızca bir aramadaysa seste değilmiş gibi yanıt verilir (aramanın varlığı sızmaz).
  function handleVoiceModerate (ctx) {
    if (!requirePerm(ctx, 'voice') || !takeAdminSlot(ctx)) return
    const b = ctx.body
    if (!VOICE_MOD_ACTIONS.includes(b.action)) return fail(ctx, 400, 'bad_request')
    const target = findUser(b.userId)
    if (!target || target.banned) return fail(ctx, 404, 'user_not_found')
    if (target.id === ctx.user.id || !outranks(ctx.user, target)) return fail(ctx, 403, 'forbidden')
    if (b.action === 'disconnect') {
      if (!hub.kickVoiceUser(target.id)) return fail(ctx, 409, 'target_not_in_voice')
      return ok(ctx, { ok: true })
    }
    if (b.action === 'camera-off') {
      const result = hub.forceCameraOff(target.id)
      if (result === 'not_in_voice') return fail(ctx, 409, 'target_not_in_voice')
      if (result === 'camera_off') return fail(ctx, 409, 'target_camera_off')
      return ok(ctx, { ok: true })
    }
    const muted = b.action === 'mute'
    if (target.voiceMuted !== muted) {
      target.voiceMuted = muted
      if (muted) hub.forceMute(target.id)
      store.saveState()
      hub.bumpMeta()
    }
    return okDurable(ctx, { ok: true })
  }

  // Ses odasında DJ izni olan (sahip ve yönetici dahil) biri var mı
  function djInRoom (channelId) {
    return hub.voiceUserIds(channelId).some((id) => {
      const u = usersById.get(id)
      return Boolean(u) && !u.banned && !u.deleted && hasPerm(u, 'dj')
    })
  }

  function handleVoiceSignal (ctx) {
    const wait = signalLimiter.consume('u' + ctx.user.id, ctx.now)
    if (wait > 0) return tooMany(ctx, wait)
    const b = ctx.body
    // Özel aramada sinyaller çiftin kişisel anahtarlarıyla şifrelenir ('2.' zarfı), ses odasında grup anahtarıyla
    const envelopeOk = inCallRoom(ctx.rt) ? validDmEnvelope(b.data, config.maxSignalChars) : validEnvelope(b.data, config.maxSignalChars)
    if (typeof b.to !== 'string' || !PEER_ID_RE.test(b.to) || !envelopeOk) {
      return fail(ctx, 400, 'bad_signal')
    }
    const result = hub.signal(ctx.rt, b.to, b.data)
    if (result === 'not_in_voice') return fail(ctx, 403, 'not_in_voice')
    if (result === 'peer_not_found') return fail(ctx, 404, 'peer_not_found')
    ok(ctx, { ok: true })
  }

  // ---------------------------------------------------------------- uç noktalar: özel mesaj aramaları

  function takeCallSlot (ctx) {
    const wait = callLimiter.consume('u' + ctx.user.id, ctx.now)
    if (wait === 0) return true
    tooMany(ctx, wait)
    return false
  }

  // Kullanıcının üyesi olduğu özel konuşma, değilse veya yoksa null (varlığı sızdırılmaz)
  function memberDm (value, user) {
    const channel = findChannel(toId(value))
    return channel && social.isMember(channel, user.id) ? channel : null
  }

  // Konuşmada arama yapılabilir mi: yazışma engeli yok (iki yönde kişisel engel, yasaklı veya silinmiş hesap) ve
  // taraflar arkadaş
  function callableDm (channel, user) {
    return social.isMember(channel, user.id) && canWriteDm(channel, user) && social.areFriends(user.id, social.otherMember(channel, user.id))
  }

  // POST /api/calls/start { dmId, video }: konuşmanın iki üyesi arkadaşsa sesli (video false) veya görüntülü arama
  // başlatır. Karşı taraf bu konuşmada zaten arıyorsa (iki taraf aynı anda aradı) arama kabul sayılır (answer: true),
  // istemci odaya katılınca arama başlar. Aynı arayanın çalan araması veya süren arama olduğu gibi döner. Yeni arama,
  // arayanın başka konuşmalardaki çalan aramalarını iptal eder. Zil, karşı tarafın çevrimiçi, görünmez veya meşgul
  // olmasından bağımsız olarak her durumda kaydedilir.
  function handleCallStart (ctx) {
    if (!takeCallSlot(ctx)) return
    const b = ctx.body
    if (b.video !== undefined && typeof b.video !== 'boolean') return fail(ctx, 400, 'bad_request')
    const dm = memberDm(b.dmId, ctx.user)
    if (!dm) return fail(ctx, 404, 'channel_not_found')
    if (!canWriteDm(dm, ctx.user)) return fail(ctx, 403, 'dm_not_allowed')
    if (!social.areFriends(ctx.user.id, social.otherMember(dm, ctx.user.id))) return fail(ctx, 403, 'call_not_allowed')
    const now = Date.now()
    let existing = calls.live(dm.id, now)
    // Reddettiği aramanın arananı geri arıyorsa reddedilen arama biter, yeni arama başlar
    if (existing && calls.hiddenFrom(existing, ctx.user.id)) {
      calls.end(existing)
      existing = null
    }
    if (existing) {
      const answer = existing.state === 'ringing' && existing.callee === ctx.user.id
      if (!answer) return ok(ctx, { ok: true, call: callView(existing, ctx.user.id) })
      // Kabul eden kişinin kendi çalan aramaları iptal edilir
      cancelRingingBy(ctx.user.id, dm.id)
      return ok(ctx, { ok: true, call: callView(existing, ctx.user.id), answer: true })
    }
    const rec = calls.create(dm, ctx.user.id, b.video === true, now)
    cancelRingingBy(ctx.user.id, dm.id)
    privateChanged(rec.members)
    ok(ctx, { ok: true, call: callView(rec, ctx.user.id) })
  }

  // POST /api/calls/decline { dmId }: çalan aramayı aranan reddeder veya arayan iptal eder, süren aramada aramayı
  // bitirir. Reddetme ile cevapsız kalma arayan için ayırt edilemez: aranan reddedince zil yalnızca onun cihazlarında
  // durur, arayan için arama zil süresi dolana kadar çalar ve cevapsız aramayla aynı anda biter. Böylece arananın açık
  // bir cihazı olduğu (görünmez olsa bile) zamanlamadan anlaşılamaz. Aranan arama odasına katılmışsa (arayan onu
  // odada görmüştür) arama hemen biter. Kayıt yoksa da başarılı döner.
  function handleCallDecline (ctx) {
    if (!takeCallSlot(ctx)) return
    const dm = memberDm(ctx.body.dmId, ctx.user)
    if (!dm) return fail(ctx, 404, 'channel_not_found')
    const rec = calls.live(dm.id, Date.now())
    if (rec && rec.state === 'ringing' && rec.callee === ctx.user.id && !rec.joined.has(ctx.user.id)) {
      if (calls.decline(rec)) privateChanged([ctx.user.id])
    } else if (rec) {
      calls.end(rec)
    }
    ok(ctx, { ok: true })
  }

  // ---------------------------------------------------------------- uç noktalar: Telsiz DJ

  // Müzik ucunun her yanıtı sunucu zamanını (now) taşır, istemci saat farkını bununla kestirir
  function musicFail (ctx, status, code, detailKey, headers) {
    const body = Object.assign(errorBody(langOf(ctx.req), code, detailKey), { now: Date.now() })
    util.sendJson(ctx.res, status, body, Object.assign({}, headers || {}, closingHeaders() || {}))
  }

  // POST /api/music/state { channelId, expect, env } (Ek L2.10). Yalnızca o ses odasında bulunan (herhangi
  // bir oturumuyla) kullanıcı yazabilir. Sürüm karşılaştırmalı: expect güncel sürüm değilse 409 ve güncel
  // kayıt (oda boşsa v 0). Sunucu zarfın içeriğini görmez, yalnızca biçimini ve boyutunu denetler.
  // Kullanıcı kimliği -> { start, used }: musicWindowMs penceresinde yazımların harcadığı bütçe (MUSIC_FANOUT_CHARS)
  const musicFanout = new Map()

  // Bu boyutta bir yazım için beklenecek süre (ms), izin varsa 0. Pencerenin ilk yazımı her boyutta geçer.
  function musicFanoutWait (userId, cost, now) {
    const rec = musicFanout.get(userId)
    if (!rec || now - rec.start >= config.musicWindowMs) return 0
    if (rec.used + cost <= MUSIC_FANOUT_CHARS) return 0
    return Math.max(1, rec.start + config.musicWindowMs - now)
  }

  function chargeMusicFanout (userId, cost, now) {
    let rec = musicFanout.get(userId)
    if (!rec || now - rec.start >= config.musicWindowMs) {
      rec = { start: now, used: 0 }
      musicFanout.set(userId, rec)
    }
    rec.used += cost
  }

  function handleMusicState (ctx) {
    const b = ctx.body
    if (!state.music.enabled) return musicFail(ctx, 403, 'dj_disabled')
    const channel = isId(b.channelId) ? findChannelOfType(b.channelId, 'voice') : null
    if (!channel) return musicFail(ctx, 404, 'channel_not_found')
    if (!hub.userInVoice(ctx.user.id, channel.id)) return musicFail(ctx, 403, 'not_in_voice', 'detail.musicNotInRoom')
    // Kısıtlı kipte odada DJ izni olan biri varken kuyruğu yalnızca DJ izni olanlar yönetir. Odada kimse yoksa
    // herkes yazabilir, böylece DJ odadan çıkınca müzik takılı kalmaz.
    if (state.music.restricted && !hasPerm(ctx.user, 'dj') && djInRoom(channel.id)) {
      return musicFail(ctx, 403, 'dj_restricted', 'detail.musicRestricted')
    }
    if (!Number.isSafeInteger(b.expect) || b.expect < 0) return musicFail(ctx, 400, 'bad_request')
    if (typeof b.env !== 'string') return musicFail(ctx, 400, 'bad_envelope')
    if (b.env.length > MUSIC_ENV_MAX_CHARS) return musicFail(ctx, 413, 'too_large')
    if (!ENVELOPE_RE.test(b.env)) return musicFail(ctx, 400, 'bad_envelope')
    const cost = music.authoredChars(ctx.user.id, channel.id, b.env)
    const fanoutWait = musicFanoutWait(ctx.user.id, cost, ctx.now)
    const wait = fanoutWait > 0 ? fanoutWait : musicLimiter.consume('u' + ctx.user.id, ctx.now)
    if (wait > 0) return musicFail(ctx, 429, 'rate_limited', 'detail.musicRate', { 'Retry-After': String(Math.max(1, Math.ceil(wait / 1000))) })
    const now = Date.now()
    const result = music.write(channel.id, ctx.user.id, b.expect, b.env, now)
    if (result.ok) chargeMusicFanout(ctx.user.id, cost, ctx.now)
    if (!result.ok) {
      const rec = result.record
      const data = rec ? Object.assign({}, rec, { now }) : { v: 0, at: 0, by: null, env: null, now }
      return util.sendJson(ctx.res, 409, data, closingHeaders())
    }
    ok(ctx, { v: result.v, at: result.at, now })
  }

  // ---------------------------------------------------------------- yönlendirme

  const routes = new Map()
  function route (urlPath, method, handler, opts) {
    let byMethod = routes.get(urlPath)
    if (!byMethod) {
      byMethod = new Map()
      routes.set(urlPath, byMethod)
    }
    const body = method === 'POST' ? 'json' : 'none'
    byMethod.set(method, Object.assign({ handler, auth: true, body }, opts || {}))
  }
  route('/api/info', 'GET', handleInfo, { auth: false })
  route('/api/username-available', 'POST', handleUsernameAvailable, { auth: false })
  route('/api/prelogin', 'POST', handlePrelogin, { auth: false })
  route('/api/register', 'POST', handleRegister, { auth: false })
  route('/api/login', 'POST', handleLogin, { auth: false })
  route('/api/logout', 'POST', handleLogout)
  route('/api/state', 'GET', handleState)
  route('/api/poll', 'GET', handlePoll)
  route('/api/messages', 'GET', handleMessagesList)
  route('/api/messages', 'POST', handleMessageSend)
  route('/api/messages/edit', 'POST', handleMessageEdit)
  route('/api/messages/delete', 'POST', handleMessageDelete)
  route('/api/typing', 'POST', handleTyping)
  route('/api/uploads', 'POST', handleUpload, { body: 'stream' })
  route('/api/channels/create', 'POST', handleChannelCreate)
  route('/api/channels/update', 'POST', handleChannelUpdate)
  route('/api/channels/delete', 'POST', handleChannelDelete)
  route('/api/users/role', 'POST', handleUserRole)
  route('/api/users/ban', 'POST', handleUserBan)
  route('/api/users/kick', 'POST', handleUserKick)
  route('/api/users/custom-role', 'POST', handleUserCustomRole)
  route('/api/roles/create', 'POST', handleRoleCreate)
  route('/api/roles/update', 'POST', handleRoleUpdate)
  route('/api/roles/delete', 'POST', handleRoleDelete)
  route('/api/users/reset-password', 'POST', handleResetPassword)
  route('/api/me/password', 'POST', handleMyPassword)
  route('/api/me/keys', 'POST', handleMyKeys)
  route('/api/me/kdf', 'POST', handleMyKdf)
  route('/api/me/identity', 'POST', handleMyIdentity)
  route('/api/me/username', 'POST', handleMyUsername)
  route('/api/me/delete', 'POST', handleMyDelete)
  route('/api/me/settings', 'POST', handleMySettings)
  route('/api/me/profile', 'POST', handleMyProfile)
  route('/api/me/status', 'POST', handleMyStatus)
  route('/api/me/sessions', 'GET', handleMySessions)
  route('/api/me/sessions/revoke', 'POST', handleMySessionsRevoke)
  route('/api/profiles', 'GET', handleProfiles)
  route('/api/friends/request', 'POST', handleFriendRequest)
  route('/api/friends/accept', 'POST', handleFriendAccept)
  route('/api/friends/decline', 'POST', handleFriendDecline)
  route('/api/friends/remove', 'POST', handleFriendRemove)
  route('/api/blocks/add', 'POST', handleBlockAdd)
  route('/api/blocks/remove', 'POST', handleBlockRemove)
  route('/api/dms/open', 'POST', handleDmOpen)
  route('/api/settings', 'POST', handleSettings)
  route('/api/invite/rotate', 'POST', handleInviteRotate)
  route('/api/server-icon', 'GET', handleServerIconGet, { auth: false })
  route('/api/server-icon', 'HEAD', handleServerIconGet, { auth: false })
  route('/api/server-icon', 'POST', handleServerIconUpload, { body: 'binary', maxBytes: config.avatarMaxBytes, before: serverIconAllowed, tooLarge: failServerIconTooLarge })
  route('/api/server-icon/delete', 'POST', handleServerIconDelete)
  route('/api/voice/join', 'POST', handleVoiceJoin)
  route('/api/voice/leave', 'POST', handleVoiceLeave)
  route('/api/voice/state', 'POST', handleVoiceState)
  route('/api/voice/signal', 'POST', handleVoiceSignal)
  route('/api/voice/camera', 'POST', handleVoiceCamera)
  route('/api/voice/moderate', 'POST', handleVoiceModerate)
  route('/api/calls/start', 'POST', handleCallStart)
  route('/api/calls/decline', 'POST', handleCallDecline)
  route('/api/server-info', 'GET', handleServerInfo)
  route('/api/music/state', 'POST', handleMusicState, { maxBytes: Math.max(config.maxJsonBytes, MUSIC_JSON_MAX_BYTES) })
  const downloadRoute = new Map([['GET', { handler: handleDownload, auth: true, body: 'none' }]])

  // Kimlik isteyen yollarda oturum, gövde okunmadan önce (yalnızca X-Token başlığıyla) doğrulanır.
  // Böylece oturumu olmayan biri sunucuya gövde (müzik yolunda 140 KB'a kadar) okutamaz ve bellekte
  // tutturamaz. Gövde okunurken oturum kapanmış veya hesap engellenmiş olabilir, okumadan sonra yeniden
  // denetlenir.
  async function runRoute (ctx, def) {
    if (def.body === 'json') {
      const maxBytes = def.maxBytes || config.maxJsonBytes
      if (def.auth) {
        ctx.drainable = true
        ctx.drainLimit = maxBytes
        const signedIn = authenticate(ctx)
        ctx.drainable = false
        if (!signedIn) return
      }
      const result = await util.readBody(ctx.req, maxBytes, JSON_BODY_TIMEOUT_MS)
      if (result.aborted) return
      if (result.tooLarge) return fail(ctx, 413, 'too_large')
      const body = util.parseJsonObject(result.text)
      if (body === null) return fail(ctx, 400, 'bad_request')
      ctx.body = body
      ctx.now = Date.now()
      if (closing) return fail(ctx, 503, 'shutting_down')
      if (def.auth && !stillSignedIn(ctx)) return failSignedOut(ctx)
    } else if (def.body === 'binary') {
      // Ham ikili gövde (frekans fotoğrafı): oturum, yetki (def.before) ve bildirilen boyut gövde
      // okunmadan denetlenir
      const maxBytes = def.maxBytes || config.maxJsonBytes
      ctx.drainable = true
      ctx.drainLimit = maxBytes
      let allowed = authenticate(ctx) && (!def.before || def.before(ctx))
      const declared = util.contentLength(ctx.req)
      if (allowed && declared !== null && declared > maxBytes) {
        if (def.tooLarge) def.tooLarge(ctx)
        else fail(ctx, 413, 'too_large')
        allowed = false
      }
      ctx.drainable = false
      if (!allowed) return
      const result = await util.readBody(ctx.req, maxBytes, JSON_BODY_TIMEOUT_MS, true)
      if (result.aborted) return
      if (result.tooLarge) return def.tooLarge ? def.tooLarge(ctx) : fail(ctx, 413, 'too_large')
      ctx.raw = result.buffer
      ctx.now = Date.now()
      if (closing) return fail(ctx, 503, 'shutting_down')
      if (!stillSignedIn(ctx)) return failSignedOut(ctx)
    } else {
      if (closing) return fail(ctx, 503, 'shutting_down')
      if (def.auth && !authenticate(ctx)) return
    }
    await def.handler(ctx)
  }

  function handleApi (req, res, pathname, query) {
    let byMethod = routes.get(pathname)
    let param = null
    if (!byMethod && pathname.startsWith(UPLOAD_PREFIX)) {
      byMethod = downloadRoute
      param = pathname.slice(UPLOAD_PREFIX.length)
    }
    if (!byMethod) return failEarly(req, res, 404, 'not_found')
    const def = byMethod.get(req.method)
    if (!def) return failEarly(req, res, 405, 'method_not_allowed', { Allow: Array.from(byMethod.keys()).join(', ') })
    if (closing) return failEarly(req, res, 503, 'shutting_down')
    const ctx = { req, res, query, param, body: {}, raw: null, now: Date.now(), user: null, session: null, rt: null, drainable: def.body === 'stream', drainLimit: config.uploadMaxBytes }
    const label = req.method + ' ' + (param === null ? pathname : UPLOAD_PREFIX + '<id>')
    runRoute(ctx, def).catch((err) => internalError(res, err, label))
  }

  // Uygulama bildirimi: dil isteğin Accept-Language başlığından, renkler varsayılan temanın
  // (Arcade) koyu zemin rengi
  function serveManifest (req, res) {
    const name = state.serverName
    const manifest = {
      name,
      short_name: Array.from(name).slice(0, 12).join('').trim() || name,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: MANIFEST_COLOR,
      theme_color: MANIFEST_COLOR,
      lang: langOf(req),
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
      ]
    }
    const body = Buffer.from(JSON.stringify(manifest), 'utf8')
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Vary', 'Accept-Language')
    res.setHeader('Content-Security-Policy', util.API_CSP)
    res.setHeader('Content-Length', body.length)
    if (req.method === 'HEAD') res.end()
    else res.end(body)
  }

  // Yalnızca beyaz listedeki yollar ve desene uyan klasör dosyaları okunur (diskten veya SEA
  // içine gömülü dosyalardan, ikisinde de aynı beyaz liste ve başlıklarla), genel dosya sunumu yoktur.
  function handleStatic (req, res, pathname) {
    const lang = langOf(req)
    const isManifest = pathname === '/manifest.webmanifest'
    const entry = isManifest ? null : staticEntry(pathname)
    if (!isManifest && !entry) return util.sendText(res, 404, i18n.t(lang, 'http.notFound'))
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return util.sendText(res, 405, i18n.t(lang, 'http.methodNotAllowed'), { Allow: 'GET, HEAD' })
    }
    if (closing) res.setHeader('Connection', 'close')
    if (isManifest) return serveManifest(req, res)
    util.serveFile(req, res, config.staticSource, entry, i18n.t(lang, 'http.notFound')).catch((err) => internalError(res, err, req.method + ' ' + pathname))
  }

  function onRequest (req, res) {
    // Bağlantı hataları dinleyicisiz kalıp süreci düşürmesin
    req.on('error', noop)
    res.on('error', noop)
    try {
      util.setSecurityHeaders(res)
      const parts = util.splitUrl(req.url)
      if (parts.pathname === '/api' || parts.pathname.startsWith('/api/')) handleApi(req, res, parts.pathname, parts.query)
      else handleStatic(req, res, parts.pathname)
    } catch (err) {
      internalError(res, err, String(req.method))
    }
  }

  // ---------------------------------------------------------------- tarama

  function sweep () {
    try {
      const now = Date.now()
      hub.sweep(now)
      for (const rec of calls.expired(now)) calls.end(rec)
      music.sweep(now, (channelId) => hub.voiceOccupied(channelId))
      const expired = state.sessions.filter((s) => {
        const user = usersById.get(s.userId)
        return now - s.lastUsed > config.sessionTtlMs || !user || user.deleted
      })
      if (expired.length > 0) deleteSessions(expired, 'invalid_token')
      const orphans = []
      for (const rec of state.uploads) {
        if (rec.messageId === null && !isAvatarRecord(rec) && now - rec.createdAt > config.orphanUploadTtlMs) orphans.push(rec.id)
      }
      if (orphans.length > 0) removeUploads(orphans)
      for (const limiter of limiters) limiter.sweep(now)
      for (const [userId, rec] of musicFanout) {
        if (now - rec.start >= config.musicWindowMs) musicFanout.delete(userId)
      }
    } catch (err) {
      log.error(i18n.t(config.lang, 'log.sweepError', { error: describeError(err, config.lang) }))
    }
  }

  const sweepTimer = setInterval(sweep, config.sweepIntervalMs)
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref()

  // ---------------------------------------------------------------- sunucu nesnesi

  const server = http.createServer(onRequest)
  server.requestTimeout = REQUEST_TIMEOUT_MS
  server.headersTimeout = 60000

  const httpClose = server.close.bind(server)
  let closePromise = null

  async function shutdown () {
    closing = true
    clearInterval(sweepTimer)
    hub.close()
    for (const job of Array.from(uploadJobs)) {
      if (job.finish) job.finish('aborted')
      job.req.destroy()
    }
    if (server.listening) {
      await new Promise((resolve) => {
        const force = setTimeout(() => {
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
        }, CLOSE_GRACE_MS)
        if (typeof force.unref === 'function') force.unref()
        httpClose(() => {
          clearTimeout(force)
          resolve()
        })
        if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections()
      })
    }
    // Yanıtı bekleyen yükleme işleyicilerinin bitmesi beklenir
    let rounds = 0
    while (activeUploads > 0 && rounds < 100) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      rounds++
    }
    await store.close()
  }

  // Bekleyen poll'ları yanıtlar, zamanlayıcıları durdurur, bağlantıları kapatır ve store'u flush edip kapatır.
  server.close = function close (callback) {
    if (!closePromise) closePromise = shutdown()
    if (typeof callback === 'function') closePromise.then(() => callback(), (err) => callback(err))
    return server
  }

  server.flush = function flush () {
    return store.flush()
  }

  server.stats = function stats () {
    return Object.assign(hub.stats(), { activeUploads, uploadsBytes: uploadsUsed, users: state.users.length, storedSessions: state.sessions.length, musicRooms: music.size() })
  }

  Object.defineProperty(server, 'setupCode', {
    enumerable: true,
    get () {
      return ownerExists() ? null : setupCodeDisplay
    }
  })
  Object.defineProperty(server, 'serverName', {
    enumerable: true,
    get () {
      return state.serverName
    }
  })
  Object.defineProperty(server, 'dataDir', { enumerable: true, value: store.dir })

  return server
}

module.exports = { createChatServer, DEFAULTS }
