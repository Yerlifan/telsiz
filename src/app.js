'use strict'

// Telsiz HTTP sunucusu (SPEC-V2 bölüm 3, Ek A): yönlendirme, uç noktalar, rol yetkileri,
// hız sınırları, yüklemeler, statik beyaz liste ve düzgün kapanış.
// Sunucu mesaj gövdelerini, token'ları, parolaları ve anahtarları hiçbir zaman loglamaz.

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { pipeline } = require('node:stream')
const { openStore, StoreError } = require('./store')
const auth = require('./auth')
const util = require('./http-util')
const { createHub } = require('./hub')

const DEFAULT_SERVER_NAME = 'Telsiz'
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
  maxUsers: 500,
  maxSessionsPerUser: 10,
  sessionTtlMs: 90 * DAY_MS,
  maxChannels: 50,
  maxVoicePerChannel: 8,
  maxBodyChars: 24000,
  maxSignalChars: 16000,
  maxJsonBytes: 65536,
  uploadMaxBytes: 25 * 1024 * 1024 + 16,
  uploadQuotaBytes: 2048 * 1024 * 1024,
  maxUploadsPerMessage: 10,
  maxConcurrentUploads: 4,
  orphanUploadTtlMs: 3600000,
  maxMessagesPerChannel: 20000,
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
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  publicDir: path.join(__dirname, '..', 'public'),
  log: console
})

// En az 1 olması gereken tamsayı seçenekleri
const POSITIVE_OPTIONS = [
  'pollTimeoutMs', 'sweepIntervalMs', 'eventBufferSize', 'maxWaitersPerSession', 'maxUsers',
  'maxSessionsPerUser', 'sessionTtlMs', 'maxChannels', 'maxVoicePerChannel', 'maxBodyChars',
  'maxSignalChars', 'maxJsonBytes', 'uploadMaxBytes', 'uploadQuotaBytes', 'maxUploadsPerMessage',
  'maxConcurrentUploads', 'orphanUploadTtlMs', 'maxMessagesPerChannel', 'authLimit', 'authWindowMs',
  'loginFailLimit', 'loginFailWindowMs', 'messageLimit', 'messageWindowMs', 'uploadLimit',
  'uploadWindowMs', 'adminLimit', 'adminWindowMs', 'signalLimit', 'signalWindowMs'
]
const TIMER_OPTIONS = ['pollTimeoutMs', 'graceMs', 'sweepIntervalMs']

const ENVELOPE_RE = /^1\.[0-9a-f]{16}\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{24,}$/
const UPLOAD_ID_RE = /^[0-9a-f]{32}$/
const PEER_ID_RE = /^[0-9a-f]{16}$/
const KID_RE = /^[0-9a-f]{16}$/
const SESSION_HASH_RE = /^[0-9a-f]{64}$/
const ROLES = new Set(['owner', 'admin', 'member'])
const MESSAGE_MAX_CHARS = 2000
const MESSAGES_PAGE_DEFAULT = 50
const MESSAGES_PAGE_MAX = 100
// Oturumun son kullanım zamanı diske en fazla dakikada bir yazılır
const LAST_USED_RESOLUTION_MS = 60000
// Bu süre boyunca hiç veri gelmeyen yükleme iptal edilir
const UPLOAD_IDLE_MS = 60000
// Kapanışta açık bağlantılar için tanınan süre
const CLOSE_GRACE_MS = 2000
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000
const UPLOAD_PREFIX = '/api/uploads/'

const DEFAULT_CHANNELS = [
  { name: 'genel', type: 'text', position: 0 },
  { name: 'oyun', type: 'text', position: 1 },
  { name: 'Ses 1', type: 'voice', position: 0 },
  { name: 'Ses 2', type: 'voice', position: 1 }
]

const ERRORS = {
  bad_request: 'İstek geçersiz.',
  too_large: 'İstek çok büyük.',
  not_found: 'İstenen adres bulunamadı.',
  method_not_allowed: 'Bu adres bu istek yöntemini desteklemiyor.',
  invalid_token: 'Oturumunuz sona erdi. Lütfen yeniden giriş yapın.',
  banned: 'Bu hesap engellendi.',
  forbidden: 'Bu işlem için yetkiniz yok.',
  invalid_name: 'Kullanıcı adı 2 ile 20 karakter arasında olmalı ve yalnızca harf, rakam, boşluk, nokta, alt çizgi veya kısa çizgi içermelidir.',
  weak_password: 'Parola 8 ile 128 karakter arasında olmalıdır.',
  bad_code: 'Kod hatalı.',
  name_taken: 'Bu kullanıcı adı zaten kullanılıyor.',
  server_full: 'Sunucudaki hesap sayısı üst sınıra ulaştı.',
  bad_credentials: 'Kullanıcı adı veya parola hatalı.',
  rate_limited: 'Çok fazla istek gönderildi. Lütfen biraz bekleyip tekrar deneyin.',
  channel_not_found: 'Kanal bulunamadı.',
  message_not_found: 'Mesaj bulunamadı.',
  upload_not_found: 'Dosya bulunamadı.',
  user_not_found: 'Kullanıcı bulunamadı.',
  bad_body: 'Mesaj geçersiz veya çok uzun.',
  bad_uploads: 'Mesaja eklenen dosyalar geçersiz.',
  empty_upload: 'Boş dosya yüklenemez.',
  quota_full: 'Sunucudaki dosya alanı doldu. Sunucu sahibine başvurun.',
  busy: 'Sunucu şu anda başka yüklemeleri işliyor, birazdan tekrar deneyin.',
  invalid_channel_name: 'Kanal adı 1 ile 30 karakter arasında olmalı ve yalnızca harf, rakam, boşluk, nokta, alt çizgi veya kısa çizgi içermelidir.',
  invalid_channel_type: 'Kanal türü yazı veya ses olmalıdır.',
  channel_exists: 'Bu adda bir kanal zaten var.',
  too_many_channels: 'Kanal sayısı üst sınıra ulaştı.',
  last_text_channel: 'Son yazı kanalı silinemez.',
  invalid_server_name: 'Sunucu adı 1 ile 40 karakter arasında olmalıdır.',
  bad_kid: 'Anahtar kimliği geçersiz.',
  voice_full: 'Bu ses kanalı dolu.',
  bad_signal: 'Ses sinyali geçersiz.',
  not_in_voice: 'Önce bir ses kanalına katılmalısınız.',
  peer_not_found: 'Bağlanılmak istenen kişi bu ses kanalında değil.',
  shutting_down: 'Sunucu kapanıyor.',
  server_error: 'Sunucuda beklenmeyen bir hata oluştu.'
}

const SETUP_CODE_WRONG = 'Kurulum kodu hatalı. Sunucu penceresinde yazan kodu girin.'
const INVITE_CODE_WRONG = 'Davet kodu hatalı.'
const AUTH_RATE_MESSAGE = 'Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.'
const LOGIN_RATE_MESSAGE = 'Bu hesap için çok fazla hatalı giriş denemesi yapıldı. Lütfen daha sonra tekrar deneyin.'
const MESSAGE_RATE_MESSAGE = 'Çok hızlı mesaj gönderiyorsunuz, lütfen biraz bekleyin.'
const UPLOAD_RATE_MESSAGE = 'Çok fazla dosya yüklendi, lütfen biraz bekleyin.'
const OLD_PASSWORD_WRONG = 'Mevcut parola hatalı.'
const OWNER_ROLE_LOCKED = 'Sahibin rolü değiştirilemez.'
const SERVER_NAME_OWNER_ONLY = 'Sunucu adını yalnızca sahip değiştirebilir.'

const STATIC_FILES = new Map()
function addStatic (urlPath, file, type, csp) {
  STATIC_FILES.set(urlPath, { file, type, csp })
}
const HTML_TYPE = 'text/html; charset=utf-8'
const JS_TYPE = 'text/javascript; charset=utf-8'
addStatic('/', 'index.html', HTML_TYPE, util.HTML_CSP)
addStatic('/index.html', 'index.html', HTML_TYPE, util.HTML_CSP)
addStatic('/app.js', 'app.js', JS_TYPE, util.API_CSP)
addStatic('/crypto.js', 'crypto.js', JS_TYPE, util.API_CSP)
addStatic('/emoji.js', 'emoji.js', JS_TYPE, util.API_CSP)
addStatic('/voice.js', 'voice.js', JS_TYPE, util.API_CSP)
// Service worker kendi yanıtının CSP'sini kullanır, sayfa ile aynı politika verilir
addStatic('/sw.js', 'sw.js', JS_TYPE, util.HTML_CSP)
addStatic('/style.css', 'style.css', 'text/css; charset=utf-8', util.API_CSP)
addStatic('/favicon.svg', 'favicon.svg', 'image/svg+xml', util.API_CSP)
addStatic('/icons/icon-192.png', 'icons/icon-192.png', 'image/png', util.API_CSP)
addStatic('/icons/icon-512.png', 'icons/icon-512.png', 'image/png', util.API_CSP)
addStatic('/icons/apple-touch-icon.png', 'icons/apple-touch-icon.png', 'image/png', util.API_CSP)
addStatic('/vendor/nacl-fast.min.js', 'vendor/nacl-fast.min.js', JS_TYPE, util.API_CSP)
addStatic('/vendor/TWEETNACL-LICENSE.txt', 'vendor/TWEETNACL-LICENSE.txt', 'text/plain; charset=utf-8', util.API_CSP)

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

function errText (err) {
  if (!err) return 'bilinmeyen hata'
  const code = err.code ? String(err.code) + ' ' : ''
  return code + String(err.message || err).slice(0, 300)
}

// Hata kaydı: ad, kod, ileti ve yığın satırları (istek içeriği hiçbir zaman eklenmez)
function describeError (err) {
  if (!err) return 'bilinmeyen hata'
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
  if (!Array.isArray(list)) throw new TypeError('createChatServer: iceServers bir dizi olmalıdır.')
  return list.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new TypeError('createChatServer: iceServers öğesi geçersiz.')
    const urls = Array.isArray(entry.urls) ? entry.urls.slice() : entry.urls
    const urlList = Array.isArray(urls) ? urls : [urls]
    if (urlList.length === 0 || !urlList.every((u) => typeof u === 'string' && u !== '')) {
      throw new TypeError('createChatServer: iceServers adresleri geçersiz.')
    }
    const out = { urls }
    if (typeof entry.username === 'string') out.username = entry.username
    if (typeof entry.credential === 'string') out.credential = entry.credential
    return out
  })
}

function resolveOptions (options) {
  if (!options || typeof options !== 'object') throw new TypeError('createChatServer: seçenek nesnesi gereklidir.')
  const config = Object.assign({}, DEFAULTS)
  for (const key of Object.keys(options)) {
    if (options[key] !== undefined) config[key] = options[key]
  }
  if (typeof config.dataDir !== 'string' || config.dataDir === '') {
    throw new TypeError('createChatServer: dataDir seçeneği zorunludur.')
  }
  for (const key of POSITIVE_OPTIONS) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) {
      throw new TypeError('createChatServer: ' + key + ' pozitif bir tamsayı olmalıdır.')
    }
  }
  if (!Number.isSafeInteger(config.graceMs) || config.graceMs < 0) {
    throw new TypeError('createChatServer: graceMs negatif olmayan bir tamsayı olmalıdır.')
  }
  for (const key of TIMER_OPTIONS) {
    if (config[key] > MAX_TIMER_MS) throw new TypeError('createChatServer: ' + key + ' çok büyük.')
  }
  const n = config.scryptN
  if (!Number.isSafeInteger(n) || n < 2 || n > 1048576 || (n & (n - 1)) !== 0) {
    throw new TypeError('createChatServer: scryptN ikinin kuvveti olmalıdır.')
  }
  config.serverName = auth.cleanServerName(config.serverName) || DEFAULT_SERVER_NAME
  config.iceServers = cleanIceServers(config.iceServers)
  if (typeof config.publicDir !== 'string' || config.publicDir === '') {
    throw new TypeError('createChatServer: publicDir geçersiz.')
  }
  config.publicDir = path.resolve(config.publicDir)
  if (config.setupCode !== null && auth.normalizeCode(config.setupCode) === null) {
    throw new TypeError('createChatServer: setupCode yalnızca Crockford base32 karakterleri içermelidir.')
  }
  return config
}

function corruptError (store, kind) {
  return new StoreError('Veri dosyasındaki (' + path.join(store.dir, 'state.json') + ') bir ' + kind + ' kaydı geçersiz. Verilerinizi korumak için sunucu başlatılmadı. Dosyayı yedekten geri yükleyin veya elle onarın.', 'corrupt')
}

// Yüklenen durumun temel kayıtlarını denetler. Bozuksa hiçbir şeyi değiştirmeden hata fırlatır.
function checkLoadedState (store, state) {
  const userIds = new Set()
  const userKeys = new Set()
  for (const u of state.users) {
    if (!isId(u.id) || typeof u.name !== 'string' || u.name === '' || !ROLES.has(u.role) || typeof u.passHash !== 'string') {
      throw corruptError(store, 'kullanıcı')
    }
    const key = auth.nameKey(u.name)
    if (userIds.has(u.id) || userKeys.has(key)) throw corruptError(store, 'kullanıcı')
    userIds.add(u.id)
    userKeys.add(key)
  }
  const channelIds = new Set()
  for (const c of state.channels) {
    if (!isId(c.id) || typeof c.name !== 'string' || (c.type !== 'text' && c.type !== 'voice') || channelIds.has(c.id)) {
      throw corruptError(store, 'kanal')
    }
    channelIds.add(c.id)
  }
}

// Zararsız eksikleri tamamlar. Değişiklik olduysa true döner.
function normalizeLoadedState (state, config, log) {
  let changed = false
  let maxUser = 0
  for (const u of state.users) {
    const key = auth.nameKey(u.name)
    if (u.key !== key) {
      u.key = key
      changed = true
    }
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
    if (!Number.isSafeInteger(c.position) || c.position < 0) {
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
    state.counters.channel++
    state.channels.push({ id: state.counters.channel, name: 'genel', type: 'text', position: 0, createdAt: Date.now() })
    log.warn('Uyarı: veri dosyasında yazı kanalı yoktu, "genel" kanalı oluşturuldu.')
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
    return true
  })
  if (sessions.length !== state.sessions.length) {
    log.warn('Uyarı: veri dosyasındaki ' + (state.sessions.length - sessions.length) + ' geçersiz oturum kaydı silindi.')
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
    log.warn('Uyarı: veri dosyasındaki ' + (state.uploads.length - uploads.length) + ' geçersiz yükleme kaydı yok sayıldı.')
    state.uploads = uploads
    changed = true
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
  if (state.activeKid !== null && !KID_RE.test(state.activeKid)) {
    state.activeKid = null
    changed = true
  }
  return changed
}

function prepareState (store, config, log) {
  if (!store.state) {
    const state = store.initState({
      version: 2,
      serverName: config.serverName,
      inviteCode: auth.generateCode(),
      activeKid: null,
      counters: { user: 0, channel: 0, message: 0 },
      users: [],
      sessions: [],
      channels: [],
      uploads: []
    })
    const now = Date.now()
    for (const def of DEFAULT_CHANNELS) {
      state.counters.channel++
      state.channels.push({ id: state.counters.channel, name: def.name, type: def.type, position: def.position, createdAt: now })
    }
    store.saveState()
    return state
  }
  const state = store.state
  checkLoadedState(store, state)
  if (normalizeLoadedState(state, config, log)) store.saveState()
  return state
}

function publicUser (user) {
  return { id: user.id, name: user.name, role: user.role }
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

async function createChatServer (options) {
  const config = resolveOptions(options)
  const log = makeLogger(config.log)
  const store = await openStore({ dir: config.dataDir, maxMessagesPerChannel: config.maxMessagesPerChannel, log: config.log })
  let state
  let dummyHash
  try {
    state = prepareState(store, config, log)
    // Bilinmeyen kullanıcı girişlerinde aynı maliyette doğrulama yapılır
    dummyHash = await auth.hashPassword(crypto.randomBytes(16).toString('hex'), config.scryptN)
  } catch (err) {
    await store.close().catch(noop)
    throw err
  }

  const collator = new Intl.Collator('tr')
  const usersById = new Map()
  const usersByKey = new Map()
  const sessionsByHash = new Map()
  const uploadsById = new Map()
  for (const u of state.users) {
    usersById.set(u.id, u)
    usersByKey.set(u.key, u)
  }
  for (const s of state.sessions) sessionsByHash.set(s.hash, s)
  for (const r of state.uploads) uploadsById.set(r.id, r)
  let uploadsUsed = store.uploadsBytes()
  let inflightBytes = 0
  let activeUploads = 0
  const uploadJobs = new Set()

  let setupCode = null
  let setupCodeDisplay = null
  if (!ownerExists()) {
    const given = config.setupCode === null ? auth.generateCode() : config.setupCode
    setupCode = auth.normalizeCode(given)
    setupCodeDisplay = auth.formatCode(setupCode)
  }

  const authLimiter = new auth.RateLimiter(config.authLimit, config.authWindowMs)
  const loginFailLimiter = new auth.RateLimiter(config.loginFailLimit, config.loginFailWindowMs)
  const messageLimiter = new auth.RateLimiter(config.messageLimit, config.messageWindowMs)
  const uploadLimiter = new auth.RateLimiter(config.uploadLimit, config.uploadWindowMs)
  const adminLimiter = new auth.RateLimiter(config.adminLimit, config.adminWindowMs)
  const signalLimiter = new auth.RateLimiter(config.signalLimit, config.signalWindowMs)
  // Ses katılma, ayrılma ve durum bildirimleri herkese meta yayını tetiklediği için ayrıca sınırlanır
  const voiceLimiter = new auth.RateLimiter(config.signalLimit, config.signalWindowMs)
  const limiters = [authLimiter, loginFailLimiter, messageLimiter, uploadLimiter, adminLimiter, signalLimiter, voiceLimiter]

  let closing = false
  const lastUsedResolution = Math.min(LAST_USED_RESOLUTION_MS, Math.floor(config.sessionTtlMs / 10))

  const hub = createHub({
    pollTimeoutMs: config.pollTimeoutMs,
    graceMs: config.graceMs,
    eventBufferSize: config.eventBufferSize,
    maxWaitersPerSession: config.maxWaitersPerSession,
    getBase: metaBase,
    send: (res, status, payload) => util.sendJson(res, status, payload, closingHeaders())
  })

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
    serverNameMax: auth.SERVER_NAME_MAX
  }

  // ---------------------------------------------------------------- durum yardımcıları

  function ownerExists () {
    return state.users.some((u) => u.role === 'owner')
  }

  function metaBase () {
    const channels = state.channels.slice().sort(channelOrder).map(publicChannel)
    const users = state.users
      .filter((u) => !u.banned)
      .sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id)
      .map(publicUser)
    return { serverName: state.serverName, activeKid: state.activeKid, channels, users }
  }

  function findChannel (id) {
    if (id === null) return null
    return state.channels.find((c) => c.id === id) || null
  }

  function findChannelOfType (id, type) {
    const channel = findChannel(id)
    return channel && channel.type === type ? channel : null
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

  function replyInvalidToken (res) {
    util.sendJson(res, 401, { error: ERRORS.invalid_token, code: 'invalid_token' }, closingHeaders())
  }

  function replyBanned (res) {
    util.sendJson(res, 403, { error: ERRORS.banned, code: 'banned' }, closingHeaders())
  }

  // Oturumları diskten ve bellekten siler, bekleyen poll'larına hata yanıtı gider.
  function deleteSessions (list, reason) {
    if (list.length === 0) return
    const doomed = new Set(list)
    state.sessions = state.sessions.filter((s) => !doomed.has(s))
    const reply = reason === 'banned' ? replyBanned : replyInvalidToken
    for (const s of list) {
      sessionsByHash.delete(s.hash)
      hub.removeSession(s.hash, reply)
    }
    store.saveState()
  }

  function sessionsOf (userId) {
    return state.sessions.filter((s) => s.userId === userId)
  }

  // Yeni oturum açar ve token'ı döner. Diske yalnızca token'ın SHA-256 karması yazılır.
  function createSession (user) {
    const token = auth.newToken()
    const hash = auth.hashToken(token)
    const now = Date.now()
    const own = sessionsOf(user.id)
    if (own.length >= config.maxSessionsPerUser) {
      own.sort((a, b) => a.lastUsed - b.lastUsed || a.createdAt - b.createdAt)
      deleteSessions(own.slice(0, own.length - config.maxSessionsPerUser + 1), 'invalid_token')
    }
    const session = { hash, userId: user.id, createdAt: now, lastUsed: now }
    state.sessions.push(session)
    sessionsByHash.set(hash, session)
    store.saveState()
    return token
  }

  function uploadSize (rec) {
    return typeof rec.size === 'number' && Number.isFinite(rec.size) && rec.size > 0 ? rec.size : 0
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
      store.saveState()
    }
    for (const id of files) {
      store.removeUpload(id).catch((err) => log.warn('Uyarı: yükleme dosyası silinemedi: ' + errText(err)))
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

  function fail (ctx, status, code, message, headers) {
    const extra = Object.assign({}, headers || {}, closingHeaders() || {})
    util.sendJson(ctx.res, status, { error: message || ERRORS[code] || ERRORS.server_error, code }, extra, { drain: canDrain(ctx) })
  }

  // Yükleme gövdesi okunmadan verilen ret yanıtında, boyutu bilinen ve sınırı aşmayan gövde
  // bağlantı açıkken okunup atılır. Böylece tarayıcı yanıtı (ör. 503 busy) bağlantı sıfırlanmadan alır.
  // Boyutu bilinmeyen veya sınırı aşan gövdede bağlantı yanıttan sonra kapatılır.
  function canDrain (ctx) {
    if (!ctx.drainable || closing) return false
    const declared = util.contentLength(ctx.req)
    return declared !== null && declared <= config.uploadMaxBytes
  }

  function tooMany (ctx, waitMs, message) {
    fail(ctx, 429, 'rate_limited', message, { 'Retry-After': String(Math.max(1, Math.ceil(waitMs / 1000))) })
  }

  function failEarly (req, res, status, code, headers) {
    util.sendJson(res, status, { error: ERRORS[code], code }, Object.assign({}, headers || {}, closingHeaders() || {}))
  }

  function internalError (res, err, label) {
    if (err && err.code === 'closed') {
      util.sendJson(res, 503, { error: ERRORS.shutting_down, code: 'shutting_down' }, { Connection: 'close' })
      return
    }
    log.error('İstek işlenirken beklenmeyen hata (' + label + '): ' + describeError(err))
    if (util.canRespond(res)) {
      util.sendJson(res, 500, { error: ERRORS.server_error, code: 'server_error' }, closingHeaders())
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

  function takeAdminSlot (ctx) {
    const wait = adminLimiter.consume('u' + ctx.user.id)
    if (wait === 0) return true
    tooMany(ctx, wait)
    return false
  }

  function requestIpKey (req) {
    return auth.ipKey(auth.clientIp(req))
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
    if (!user || now - session.lastUsed > config.sessionTtlMs) {
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
    return sessionsByHash.get(ctx.session.hash) === ctx.session && !ctx.user.banned
  }

  // ---------------------------------------------------------------- uç noktalar: hesap

  function handleInfo (ctx) {
    ok(ctx, { serverName: state.serverName, setupRequired: !ownerExists(), limits })
  }

  function codeAccepted (setup, input) {
    if (setup) return setupCode !== null && auth.codeMatches(input, setupCode)
    const invite = auth.normalizeCode(state.inviteCode)
    return invite !== null && auth.codeMatches(input, invite)
  }

  async function handleRegister (ctx) {
    const wait = authLimiter.consume(requestIpKey(ctx.req), ctx.now)
    if (wait > 0) return tooMany(ctx, wait, AUTH_RATE_MESSAGE)
    const b = ctx.body
    const name = auth.cleanName(b.name)
    if (name === null) return fail(ctx, 400, 'invalid_name')
    if (!auth.isValidPassword(b.password)) return fail(ctx, 400, 'weak_password')
    const setup = !ownerExists()
    const input = setup ? b.setupCode : b.inviteCode
    if (!codeAccepted(setup, input)) return fail(ctx, 403, 'bad_code', setup ? SETUP_CODE_WRONG : INVITE_CODE_WRONG)
    if (state.users.length >= config.maxUsers) return fail(ctx, 503, 'server_full')
    const key = auth.nameKey(name)
    if (usersByKey.has(key)) return fail(ctx, 409, 'name_taken')

    const passHash = await auth.hashPassword(b.password, config.scryptN)

    // Karma hesaplanırken durum değişmiş olabilir (ör. aynı anda iki kurulum isteği), denetimler yinelenir
    if (closing) return fail(ctx, 503, 'shutting_down')
    if (setup !== !ownerExists() || !codeAccepted(setup, input)) {
      return fail(ctx, 403, 'bad_code', setup ? SETUP_CODE_WRONG : INVITE_CODE_WRONG)
    }
    if (state.users.length >= config.maxUsers) return fail(ctx, 503, 'server_full')
    if (usersByKey.has(key)) return fail(ctx, 409, 'name_taken')

    state.counters.user++
    const user = {
      id: state.counters.user,
      name,
      key,
      role: setup ? 'owner' : 'member',
      passHash,
      createdAt: Date.now(),
      banned: false
    }
    state.users.push(user)
    usersById.set(user.id, user)
    usersByKey.set(key, user)
    if (setup) {
      setupCode = null
      setupCodeDisplay = null
      log.info('Sahip hesabı oluşturuldu. Kurulum kodu artık geçersiz.')
    }
    const token = createSession(user)
    store.saveState()
    hub.bumpMeta()
    ok(ctx, { token, user: publicUser(user) })
  }

  async function handleLogin (ctx) {
    const wait = authLimiter.consume(requestIpKey(ctx.req), ctx.now)
    if (wait > 0) return tooMany(ctx, wait, AUTH_RATE_MESSAGE)
    const b = ctx.body
    const password = typeof b.password === 'string' ? b.password : ''
    const name = auth.cleanName(b.name)
    const key = name === null ? null : auth.nameKey(name)
    const failKey = key === null ? null : 'n:' + key
    if (failKey !== null) {
      const blocked = loginFailLimiter.blocked(failKey, ctx.now)
      if (blocked > 0) return tooMany(ctx, blocked, LOGIN_RATE_MESSAGE)
    }
    const user = key === null ? null : usersByKey.get(key) || null
    const good = await auth.verifyPassword(password, user ? user.passHash : dummyHash)
    if (!user || !good || password === '') {
      if (failKey !== null) loginFailLimiter.hit(failKey)
      return fail(ctx, 401, 'bad_credentials')
    }
    if (user.banned) return fail(ctx, 403, 'banned')
    if (closing) return fail(ctx, 503, 'shutting_down')
    loginFailLimiter.reset(failKey)
    const token = createSession(user)
    ok(ctx, { token, user: publicUser(user) })
  }

  function handleLogout (ctx) {
    deleteSessions([ctx.session], 'invalid_token')
    ok(ctx, { ok: true })
  }

  function handleState (ctx) {
    const data = {
      boot: hub.bootId,
      seq: hub.getSeq(),
      metaVersion: hub.getMetaVersion(),
      meta: hub.meta(),
      me: publicUser(ctx.user),
      peerId: ctx.rt.peerId,
      sigSeq: ctx.rt.sigSeq,
      iceServers: config.iceServers
    }
    if (isStaff(ctx.user)) data.inviteCode = state.inviteCode
    ok(ctx, data)
  }

  function handlePoll (ctx) {
    const q = ctx.query
    hub.poll(ctx.rt, { since: q.get('since'), mv: q.get('mv'), sig: q.get('sig'), boot: q.get('boot') }, ctx.res)
  }

  async function handleMyPassword (ctx) {
    const b = ctx.body
    if (!auth.isValidPassword(b.newPassword)) return fail(ctx, 400, 'weak_password')
    const failKey = 'p:' + ctx.user.id
    const blocked = loginFailLimiter.blocked(failKey, ctx.now)
    if (blocked > 0) return tooMany(ctx, blocked, LOGIN_RATE_MESSAGE)
    const oldPassword = typeof b.oldPassword === 'string' ? b.oldPassword : ''
    const good = await auth.verifyPassword(oldPassword, ctx.user.passHash)
    if (!good || oldPassword === '') {
      loginFailLimiter.hit(failKey)
      return fail(ctx, 401, 'bad_credentials', OLD_PASSWORD_WRONG)
    }
    const passHash = await auth.hashPassword(b.newPassword, config.scryptN)
    if (closing) return fail(ctx, 503, 'shutting_down')
    if (!stillSignedIn(ctx)) return fail(ctx, 401, 'invalid_token')
    ctx.user.passHash = passHash
    loginFailLimiter.reset(failKey)
    loginFailLimiter.reset('n:' + ctx.user.key)
    deleteSessions(sessionsOf(ctx.user.id).filter((s) => s !== ctx.session), 'invalid_token')
    store.saveState()
    ok(ctx, { ok: true })
  }

  // ---------------------------------------------------------------- uç noktalar: mesajlar

  function handleMessagesList (ctx) {
    const q = ctx.query
    const channel = findChannelOfType(toId(q.get('channel')), 'text')
    if (!channel) return fail(ctx, 404, 'channel_not_found')
    let before
    const beforeRaw = q.get('before')
    if (beforeRaw !== null && beforeRaw !== '') {
      before = parseNonNegative(beforeRaw)
      if (before === null) return fail(ctx, 400, 'bad_request')
    }
    let limit = MESSAGES_PAGE_DEFAULT
    const limitRaw = q.get('limit')
    if (limitRaw !== null && limitRaw !== '') {
      const parsed = parseNonNegative(limitRaw)
      if (parsed === null) return fail(ctx, 400, 'bad_request')
      limit = Math.min(MESSAGES_PAGE_MAX, Math.max(1, parsed))
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
      if (!rec || rec.uploaderId !== user.id || rec.messageId !== null) return null
      records.push(rec)
    }
    return records
  }

  function takeMessageSlot (ctx) {
    const wait = messageLimiter.consume('u' + ctx.user.id, ctx.now)
    if (wait === 0) return true
    tooMany(ctx, wait, MESSAGE_RATE_MESSAGE)
    return false
  }

  function emitDropped (dropped) {
    if (dropped.length === 0) return
    removeUploads(uploadsOfMessages(dropped))
    for (const m of dropped) hub.emit({ type: 'del', channelId: m.channelId, messageId: m.id })
  }

  function handleMessageSend (ctx) {
    const b = ctx.body
    const channel = findChannelOfType(toId(b.channelId), 'text')
    if (!channel) return fail(ctx, 404, 'channel_not_found')
    if (!validEnvelope(b.body, config.maxBodyChars)) return fail(ctx, 400, 'bad_body')
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
    const saved = store.getMessage(message.id) || message
    hub.emit({ type: 'msg', channelId: channel.id, message: saved })
    emitDropped(dropped)
    ok(ctx, { ok: true, message: saved })
  }

  function findLiveMessage (value) {
    const id = toId(value)
    if (id === null) return null
    const message = store.getMessage(id)
    if (!message || !findChannelOfType(message.channelId, 'text')) return null
    return message
  }

  function handleMessageEdit (ctx) {
    const b = ctx.body
    const message = findLiveMessage(b.id)
    if (!message) return fail(ctx, 404, 'message_not_found')
    if (message.authorId !== ctx.user.id) return fail(ctx, 403, 'forbidden')
    if (!validEnvelope(b.body, config.maxBodyChars)) return fail(ctx, 400, 'bad_body')
    if (!takeMessageSlot(ctx)) return
    const updated = store.editMessage(message.id, b.body, Date.now())
    if (!updated) return fail(ctx, 404, 'message_not_found')
    hub.emit({ type: 'edit', channelId: updated.channelId, message: updated })
    ok(ctx, { ok: true, message: updated })
  }

  function handleMessageDelete (ctx) {
    const message = findLiveMessage(ctx.body.id)
    if (!message) return fail(ctx, 404, 'message_not_found')
    if (message.authorId !== ctx.user.id && !isStaff(ctx.user)) return fail(ctx, 403, 'forbidden')
    const removed = store.deleteMessage(message.id)
    if (!removed) return fail(ctx, 404, 'message_not_found')
    removeUploads(removed.uploads)
    hub.emit({ type: 'del', channelId: removed.channelId, messageId: removed.id })
    ok(ctx, { ok: true })
  }

  // ---------------------------------------------------------------- uç noktalar: yüklemeler

  // İstek gövdesini akışla geçici dosyaya yazar.
  // Sonuç: 'ok' | 'too_large' | 'quota_full' | 'aborted' | 'error'
  function receiveUpload (job, ws) {
    const req = job.req
    return new Promise((resolve) => {
      let done = false
      let idleTimer = null
      function finish (result) {
        if (done) return
        done = true
        clearTimeout(idleTimer)
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
      if (req.destroyed) finish('aborted')
    })
  }

  async function handleUpload (ctx) {
    const wait = uploadLimiter.consume('u' + ctx.user.id, ctx.now)
    if (wait > 0) return tooMany(ctx, wait, UPLOAD_RATE_MESSAGE)
    if (activeUploads >= config.maxConcurrentUploads) return fail(ctx, 503, 'busy')
    const declared = util.contentLength(ctx.req)
    if (declared !== null && declared > config.uploadMaxBytes) return fail(ctx, 413, 'too_large', tooLargeUploadMessage())
    if (declared === 0) return fail(ctx, 400, 'empty_upload')
    if (uploadsUsed + inflightBytes + (declared || 1) > config.uploadQuotaBytes) return fail(ctx, 507, 'quota_full')
    // Bundan sonra gövde okunur, ret yanıtlarında bağlantı kapatılır
    ctx.drainable = false

    const id = crypto.randomBytes(16).toString('hex')
    const job = { req: ctx.req, bytes: 0, finish: null }
    activeUploads++
    uploadJobs.add(job)
    try {
      const ws = store.createUploadWriteStream(id)
      const result = await receiveUpload(job, ws)
      if (result !== 'ok') {
        await store.discardUpload(id).catch((err) => log.warn('Uyarı: yarım yükleme silinemedi: ' + errText(err)))
        if (result === 'too_large') return fail(ctx, 413, 'too_large', tooLargeUploadMessage())
        if (result === 'quota_full') return fail(ctx, 507, 'quota_full')
        if (result === 'error') return fail(ctx, 500, 'server_error')
        return
      }
      const size = await store.commitUpload(id)
      if (size === 0) {
        await store.removeUpload(id).catch(noop)
        return fail(ctx, 400, 'empty_upload')
      }
      const rec = { id, size, uploaderId: ctx.user.id, createdAt: Date.now(), messageId: null }
      state.uploads.push(rec)
      uploadsById.set(id, rec)
      uploadsUsed += size
      store.saveState()
      ok(ctx, { id, size })
    } finally {
      activeUploads--
      inflightBytes -= job.bytes
      uploadJobs.delete(job)
    }
  }

  function tooLargeUploadMessage () {
    const mb = Math.floor((config.uploadMaxBytes - 16) / (1024 * 1024))
    return mb >= 1 ? 'Dosya çok büyük. En fazla ' + mb + ' MB yüklenebilir.' : 'Dosya çok büyük.'
  }

  // Mesaja bağlı yükleme var olan bir kanaldaysa herkese, bağlı değilse yalnızca yükleyene açıktır.
  function canDownload (rec, user) {
    if (rec.messageId === null) return rec.uploaderId === user.id
    const message = store.getMessage(rec.messageId)
    return Boolean(message) && findChannelOfType(message.channelId, 'text') !== null
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
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') log.warn('Uyarı: dosya gönderilemedi: ' + errText(err))
    })
  }

  // ---------------------------------------------------------------- uç noktalar: kanallar

  function handleChannelCreate (ctx) {
    if (!requireStaff(ctx) || !takeAdminSlot(ctx)) return
    const b = ctx.body
    const name = auth.cleanChannelName(b.name)
    if (name === null) return fail(ctx, 400, 'invalid_channel_name')
    if (b.type !== 'text' && b.type !== 'voice') return fail(ctx, 400, 'invalid_channel_type')
    if (state.channels.length >= config.maxChannels) return fail(ctx, 409, 'too_many_channels')
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
    renumber(channel.type)
    store.saveState()
    hub.bumpMeta()
    ok(ctx, { ok: true, channel: publicChannel(channel) })
  }

  function handleChannelUpdate (ctx) {
    if (!requireStaff(ctx) || !takeAdminSlot(ctx)) return
    const b = ctx.body
    const channel = findChannel(toId(b.id))
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
    if (!requireStaff(ctx) || !takeAdminSlot(ctx)) return
    const channel = findChannel(toId(ctx.body.id))
    if (!channel) return fail(ctx, 404, 'channel_not_found')
    if (channel.type === 'text' && channelsOfType('text').length <= 1) return fail(ctx, 409, 'last_text_channel')
    state.channels = state.channels.filter((c) => c !== channel)
    renumber(channel.type)
    if (channel.type === 'voice') {
      hub.kickVoiceChannel(channel.id)
    } else {
      const removed = store.deleteChannelMessages(channel.id)
      removeUploads(uploadsOfMessages(removed))
    }
    store.saveState()
    hub.bumpMeta()
    ok(ctx, { ok: true })
  }

  // ---------------------------------------------------------------- uç noktalar: üyeler ve ayarlar

  function findUser (value) {
    const id = toId(value)
    return id === null ? null : usersById.get(id) || null
  }

  function handleUserRole (ctx) {
    if (!requireOwner(ctx) || !takeAdminSlot(ctx)) return
    const b = ctx.body
    if (b.role !== 'admin' && b.role !== 'member') return fail(ctx, 400, 'bad_request')
    const target = findUser(b.userId)
    if (!target) return fail(ctx, 404, 'user_not_found')
    if (target.role === 'owner') return fail(ctx, 403, 'forbidden', OWNER_ROLE_LOCKED)
    if (target.role !== b.role) {
      target.role = b.role
      store.saveState()
      hub.bumpMeta()
    }
    ok(ctx, { ok: true })
  }

  // Sahip herkesi (kendisi hariç), yönetici yalnızca üyeleri engeller veya engelini kaldırır.
  function handleUserBan (ctx) {
    if (!requireStaff(ctx) || !takeAdminSlot(ctx)) return
    const b = ctx.body
    if (typeof b.banned !== 'boolean') return fail(ctx, 400, 'bad_request')
    const target = findUser(b.userId)
    if (!target) return fail(ctx, 404, 'user_not_found')
    if (target.id === ctx.user.id || target.role === 'owner') return fail(ctx, 403, 'forbidden')
    if (ctx.user.role === 'admin' && target.role !== 'member') return fail(ctx, 403, 'forbidden')
    if (target.banned !== b.banned) {
      target.banned = b.banned
      if (b.banned) deleteSessions(sessionsOf(target.id), 'banned')
      store.saveState()
      hub.bumpMeta()
    }
    ok(ctx, { ok: true })
  }

  async function handleResetPassword (ctx) {
    if (!requireOwner(ctx)) return
    const target = findUser(ctx.body.userId)
    if (!target) return fail(ctx, 404, 'user_not_found')
    if (target.id === ctx.user.id) return fail(ctx, 403, 'forbidden')
    if (!takeAdminSlot(ctx)) return
    const tempPassword = auth.generateTempPassword()
    const passHash = await auth.hashPassword(tempPassword, config.scryptN)
    if (closing) return fail(ctx, 503, 'shutting_down')
    if (!stillSignedIn(ctx) || ctx.user.role !== 'owner') return fail(ctx, 403, 'forbidden')
    target.passHash = passHash
    loginFailLimiter.reset('n:' + target.key)
    deleteSessions(sessionsOf(target.id), 'invalid_token')
    store.saveState()
    ok(ctx, { ok: true, tempPassword })
  }

  function handleSettings (ctx) {
    if (!requireStaff(ctx)) return
    const b = ctx.body
    const hasName = b.serverName !== undefined
    const hasKid = b.activeKid !== undefined
    if (!hasName && !hasKid) return fail(ctx, 400, 'bad_request')
    if (hasName && ctx.user.role !== 'owner') return fail(ctx, 403, 'forbidden', SERVER_NAME_OWNER_ONLY)
    if (!takeAdminSlot(ctx)) return
    let serverName = null
    if (hasName) {
      serverName = auth.cleanServerName(b.serverName)
      if (serverName === null) return fail(ctx, 400, 'invalid_server_name')
    }
    if (hasKid && b.activeKid !== null && (typeof b.activeKid !== 'string' || !KID_RE.test(b.activeKid))) {
      return fail(ctx, 400, 'bad_kid')
    }
    if (hasName) state.serverName = serverName
    if (hasKid) state.activeKid = b.activeKid
    store.saveState()
    hub.bumpMeta()
    ok(ctx, { ok: true })
  }

  function handleInviteRotate (ctx) {
    if (!requireStaff(ctx) || !takeAdminSlot(ctx)) return
    state.inviteCode = auth.generateCode()
    store.saveState()
    ok(ctx, { ok: true, inviteCode: state.inviteCode })
  }

  // ---------------------------------------------------------------- uç noktalar: ses

  function takeVoiceSlot (ctx) {
    const wait = voiceLimiter.consume('u' + ctx.user.id, ctx.now)
    if (wait === 0) return true
    tooMany(ctx, wait)
    return false
  }

  function handleVoiceJoin (ctx) {
    if (!takeVoiceSlot(ctx)) return
    const channel = findChannelOfType(toId(ctx.body.channelId), 'voice')
    if (!channel) return fail(ctx, 404, 'channel_not_found')
    const members = hub.voiceJoin(ctx.rt, channel.id, config.maxVoicePerChannel)
    if (members === null) return fail(ctx, 409, 'voice_full')
    ok(ctx, { ok: true, peerId: ctx.rt.peerId, members, iceServers: config.iceServers })
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
    hub.setVoiceState(ctx.rt, b.muted, b.deafened)
    ok(ctx, { ok: true })
  }

  function handleVoiceSignal (ctx) {
    const wait = signalLimiter.consume('u' + ctx.user.id, ctx.now)
    if (wait > 0) return tooMany(ctx, wait)
    const b = ctx.body
    if (typeof b.to !== 'string' || !PEER_ID_RE.test(b.to) || !validEnvelope(b.data, config.maxSignalChars)) {
      return fail(ctx, 400, 'bad_signal')
    }
    const result = hub.signal(ctx.rt, b.to, b.data)
    if (result === 'not_in_voice') return fail(ctx, 403, 'not_in_voice')
    if (result === 'peer_not_found') return fail(ctx, 404, 'peer_not_found')
    ok(ctx, { ok: true })
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
  route('/api/register', 'POST', handleRegister, { auth: false })
  route('/api/login', 'POST', handleLogin, { auth: false })
  route('/api/logout', 'POST', handleLogout)
  route('/api/state', 'GET', handleState)
  route('/api/poll', 'GET', handlePoll)
  route('/api/messages', 'GET', handleMessagesList)
  route('/api/messages', 'POST', handleMessageSend)
  route('/api/messages/edit', 'POST', handleMessageEdit)
  route('/api/messages/delete', 'POST', handleMessageDelete)
  route('/api/uploads', 'POST', handleUpload, { body: 'stream' })
  route('/api/channels/create', 'POST', handleChannelCreate)
  route('/api/channels/update', 'POST', handleChannelUpdate)
  route('/api/channels/delete', 'POST', handleChannelDelete)
  route('/api/users/role', 'POST', handleUserRole)
  route('/api/users/ban', 'POST', handleUserBan)
  route('/api/users/reset-password', 'POST', handleResetPassword)
  route('/api/me/password', 'POST', handleMyPassword)
  route('/api/settings', 'POST', handleSettings)
  route('/api/invite/rotate', 'POST', handleInviteRotate)
  route('/api/voice/join', 'POST', handleVoiceJoin)
  route('/api/voice/leave', 'POST', handleVoiceLeave)
  route('/api/voice/state', 'POST', handleVoiceState)
  route('/api/voice/signal', 'POST', handleVoiceSignal)
  const downloadRoute = new Map([['GET', { handler: handleDownload, auth: true, body: 'none' }]])

  async function runRoute (ctx, def) {
    if (def.body === 'json') {
      const result = await util.readBody(ctx.req, config.maxJsonBytes)
      if (result.aborted) return
      if (result.tooLarge) return fail(ctx, 413, 'too_large')
      const body = util.parseJsonObject(result.text)
      if (body === null) return fail(ctx, 400, 'bad_request')
      ctx.body = body
      ctx.now = Date.now()
    }
    if (closing) return fail(ctx, 503, 'shutting_down')
    if (def.auth && !authenticate(ctx)) return
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
    const ctx = { req, res, query, param, body: {}, now: Date.now(), user: null, session: null, rt: null, drainable: def.body === 'stream' }
    const label = req.method + ' ' + (param === null ? pathname : UPLOAD_PREFIX + '<id>')
    runRoute(ctx, def).catch((err) => internalError(res, err, label))
  }

  function serveManifest (req, res) {
    const name = state.serverName
    const manifest = {
      name,
      short_name: Array.from(name).slice(0, 12).join('').trim() || name,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#1e1f22',
      theme_color: '#1e1f22',
      lang: 'tr',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
      ]
    }
    const body = Buffer.from(JSON.stringify(manifest), 'utf8')
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Content-Security-Policy', util.API_CSP)
    res.setHeader('Content-Length', body.length)
    if (req.method === 'HEAD') res.end()
    else res.end(body)
  }

  // Yalnızca beyaz listedeki yollar diskten okunur, genel dosya sunumu yoktur.
  function handleStatic (req, res, pathname) {
    const isManifest = pathname === '/manifest.webmanifest'
    const entry = isManifest ? null : STATIC_FILES.get(pathname)
    if (!isManifest && !entry) return util.sendText(res, 404, 'Sayfa bulunamadı.')
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return util.sendText(res, 405, 'Bu adres bu istek yöntemini desteklemiyor.', { Allow: 'GET, HEAD' })
    }
    if (closing) res.setHeader('Connection', 'close')
    if (isManifest) return serveManifest(req, res)
    const file = path.join(config.publicDir, ...entry.file.split('/'))
    util.serveFile(req, res, file, entry).catch((err) => internalError(res, err, req.method + ' ' + pathname))
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
      const expired = state.sessions.filter((s) => now - s.lastUsed > config.sessionTtlMs || !usersById.has(s.userId))
      if (expired.length > 0) deleteSessions(expired, 'invalid_token')
      const orphans = []
      for (const rec of state.uploads) {
        if (rec.messageId === null && now - rec.createdAt > config.orphanUploadTtlMs) orphans.push(rec.id)
      }
      if (orphans.length > 0) removeUploads(orphans)
      for (const limiter of limiters) limiter.sweep(now)
    } catch (err) {
      log.error('Tarama sırasında beklenmeyen hata: ' + describeError(err))
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
    return Object.assign(hub.stats(), { activeUploads, uploadsBytes: uploadsUsed, users: state.users.length, storedSessions: state.sessions.length })
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
