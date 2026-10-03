'use strict'

// Temel yardımcılar: sabitler, depolama anahtarları, çeviri (t) ve sunucu hata metinleri, sunucu
// istekleri (Accept-Language), Intl biçimleri, dosya adı ve ortam yardımcıları.

const API_TIMEOUT_MS = 20000
const POLL_TIMEOUT_MS = 35000
const TRANSFER_TIMEOUT_MS = 15 * 60 * 1000
const INFO_RETRY_MS = 3000
const GROUP_WINDOW_MS = 5 * 60 * 1000
const STICK_PX = 150
const PAGE_SIZE = 50
const MAX_RENDERED = 600
const TRIM_TO = 500
const IMAGE_CACHE_MAX = 100
const IMAGE_BOX_MAX = 360
const PHOTO_MAX_EDGE = 2560
const JPEG_QUALITY = 0.85
const UPLOAD_RETRY_MAX = 3
const UPLOAD_RETRY_MS = 2000
const UPLOAD_PARALLEL = 2
const IMAGE_PARALLEL = 3
const TOAST_MS = 5000
const RECENT_EMOJI_MAX = 24
const COUNTER_FROM = 1800
const REVOKE_DELAY_MS = 60000
const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const UPLOAD_ID_RE = /^[0-9a-f]{32}$/
const KID_RE = /^[0-9a-f]{16}$/
const B64URL_RE = /^[A-Za-z0-9_-]+$/
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
const EXEC_EXT = ['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'jar', 'apk', 'appx', 'msix', 'sh', 'command', 'app', 'dmg', 'pkg', 'lnk', 'reg', 'cpl', 'dll', 'iso', 'img']
const FILE_KINDS = {
  doc: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp', 'epub', 'pages', 'numbers', 'key'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'cab'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'wma', 'mid', 'midi'],
  video: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'wmv', 'flv', '3gp', 'mpg', 'mpeg'],
  code: ['js', 'mjs', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'html', 'htm', 'css', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'sh', 'bat', 'cmd', 'ps1', 'sql', 'lua', 'kt', 'swift', 'log'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'tif', 'tiff', 'ico', 'avif']
}
const FILE_ICONS = { doc: 'i-file-doc', archive: 'i-file-archive', audio: 'i-file-audio', video: 'i-file-video', code: 'i-file-code', image: 'i-file-image', other: 'i-file' }
const AVATAR_COLORS = 8

// Tarayıcı depolama anahtarları (Ek C: 'telsiz.' önekli). Dil seçimi i18n.js içinde 'telsiz.lang'.
const KEYS = {
  token: 'telsiz.token',
  recentEmoji: 'telsiz.emoji.recent',
  notify: 'telsiz.notify',
  peerVolume: 'telsiz.peerVolume',
  invite: 'telsiz.invite'
}

// Çeviri. Kullanıcıya görünen her metin i18n.js sözlüğünden gelir. Anahtarlar t('...') çağrılarında
// sabit yazılır, böylece denetleyici sözlükte varlıklarını doğrular. Dil değişince yeniden
// çevrilmesi gereken metinler () => t('...') biçiminde fonksiyon olarak verilir (bkz. setLive).
function t (key, params) {
  return window.I18N.t(key, params)
}

function hasText (key) {
  return window.I18N.has(key)
}

// Dize veya dize üreten fonksiyon kabul eden yerlerde son metni verir
function textOf (value) {
  if (typeof value === 'function') return String(value())
  return value === null || value === undefined ? '' : String(value)
}

function roleLabel (role) {
  if (role === 'owner') return t('roles.owner')
  if (role === 'admin') return t('roles.admin')
  if (role === 'member') return t('roles.member')
  return String(role || '')
}

// Kullanıcıya gösterilecek metni taşıyan hata. Metin, gösterim anında seçili dilde üretilir.
function textError (producer) {
  const err = new Error('ui_text')
  err.uiText = producer
  return err
}

// Hatanın metnini üreten fonksiyon (dil değişince yeniden çağrılabilir)
function errorProducer (err, fallback) {
  if (err && typeof err.uiText === 'function') return err.uiText
  return fallback
}

// crypto.js anahtar kodu hataları Error.code ile gelir (empty, bad_length, bad_char, bad_padding,
// bad_checksum, no_library, no_random)
function keyErrorText (err) {
  const code = err && typeof err.code === 'string' ? err.code : ''
  if (code && hasText('errors.key.' + code)) return t('errors.key.' + code)
  return t('key.invalid')
}

// Kalıcı depolama. localStorage veya sessionStorage kullanılamazsa bellekte devam edilir.

const memoryStore = { local: Object.create(null), session: Object.create(null) }

function storageArea (kind) {
  return kind === 'session' ? window.sessionStorage : window.localStorage
}

function storeGet (key, kind) {
  const k = kind || 'local'
  try {
    const value = storageArea(k).getItem(key)
    if (typeof value === 'string') return value
  } catch (err) {
    // Depolama kapalı, bellekteki kopyaya bakılır
  }
  const mem = memoryStore[k][key]
  return typeof mem === 'string' ? mem : null
}

function storeSet (key, value, kind) {
  const k = kind || 'local'
  memoryStore[k][key] = String(value)
  try {
    storageArea(k).setItem(key, String(value))
  } catch (err) {
    // Değer yalnızca bellekte kalır
  }
}

function storeRemove (key, kind) {
  const k = kind || 'local'
  delete memoryStore[k][key]
  try {
    storageArea(k).removeItem(key)
  } catch (err) {
    // Bellekteki kopya zaten silindi
  }
}

function storeGetJson (key, fallback) {
  const raw = storeGet(key)
  if (!raw) return fallback
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? value : fallback
  } catch (err) {
    return fallback
  }
}

function storeSetJson (key, value) {
  try {
    storeSet(key, JSON.stringify(value))
  } catch (err) {
    // Serileştirilemeyen değer yazılmaz
  }
}

// Sunucu istekleri. Dönen Promise reddedilmez, ağ hatası, zaman aşımı ve
// iptalde status 0 olur. Promise üzerinde abort() bulunur.

function parseJson (text) {
  if (typeof text !== 'string' || text === '') return null
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value : null
  } catch (err) {
    return null
  }
}

function bufferToText (buffer) {
  try {
    if (!buffer || !buffer.byteLength) return ''
    return window.E2EE.utf8.decode(new Uint8Array(buffer))
  } catch (err) {
    return ''
  }
}

function abortXhr (xhr) {
  if (!xhr) return
  try {
    xhr.abort()
  } catch (err) {
    // İstek zaten bitmiş olabilir
  }
}

function request (method, path, options) {
  const opts = options || {}
  const timeoutMs = opts.timeout || API_TIMEOUT_MS
  let xhr = null
  const promise = new Promise((resolve) => {
    let settled = false
    let backupTimer = 0
    const settle = (status, data, aborted) => {
      if (settled) return
      settled = true
      clearTimeout(backupTimer)
      resolve({ status: status, data: data, aborted: aborted === true })
    }
    try {
      xhr = new XMLHttpRequest()
      xhr.open(method, path, true)
      try {
        xhr.timeout = timeoutMs
      } catch (err) {
        // Yedek zamanlayıcı devreye girer
      }
      if (opts.responseType) xhr.responseType = opts.responseType
      const token = opts.token === undefined ? state.token : opts.token
      if (token) xhr.setRequestHeader('X-Token', token)
      // Sunucu hata metinlerini seçili dilde verir (Ek E1 madde 5)
      xhr.setRequestHeader('Accept-Language', window.I18N.lang)
      let payload = null
      if (opts.binary) {
        xhr.setRequestHeader('Content-Type', 'application/octet-stream')
        payload = opts.binary
      } else if (method !== 'GET') {
        xhr.setRequestHeader('Content-Type', 'application/json')
        payload = JSON.stringify(opts.body || {})
      }
      if (typeof opts.onProgress === 'function') {
        xhr.onprogress = (e) => {
          opts.onProgress(e)
        }
      }
      if (typeof opts.onUploadProgress === 'function' && xhr.upload) {
        xhr.upload.onprogress = (e) => {
          opts.onUploadProgress(e)
        }
      }
      xhr.onload = () => {
        let data = null
        if (opts.responseType === 'arraybuffer') {
          if (xhr.status === 200) {
            data = xhr.response instanceof ArrayBuffer ? xhr.response : null
          } else {
            data = parseJson(bufferToText(xhr.response))
          }
        } else {
          data = parseJson(xhr.responseText)
        }
        settle(xhr.status, data)
      }
      xhr.onerror = () => {
        settle(0, null)
      }
      xhr.ontimeout = () => {
        settle(0, null)
      }
      xhr.onabort = () => {
        settle(0, null, true)
      }
      backupTimer = setTimeout(() => {
        abortXhr(xhr)
        settle(0, null)
      }, timeoutMs + 3000)
      xhr.send(payload)
    } catch (err) {
      settle(0, null)
    }
  })
  promise.abort = () => {
    abortXhr(xhr)
  }
  return promise
}

// Oturumlu istek. 401 ve engelleme yanıtları ortak olarak ele alınır.
function api (method, path, body, options) {
  const opts = Object.assign({}, options || {})
  if (body !== undefined && body !== null) opts.body = body
  const pending = request(method, path, opts)
  const out = pending.then((res) => {
    checkAuthFailure(res)
    return res
  })
  out.abort = pending.abort
  return out
}

function checkAuthFailure (res) {
  if (!state.token || !res) return
  const code = res.data && typeof res.data.code === 'string' ? res.data.code : ''
  if (res.status === 401 && code !== 'bad_credentials') {
    handleSessionLost('expired')
  } else if (res.status === 403 && code === 'banned') {
    handleSessionLost('banned')
  }
}

// Sunucu hatasının gösterilecek metni (Ek E1 madde 5): önce bağlama özgü metin (overrides[code]),
// sonra t('errors.' + code), yoksa sunucunun kendi metni, o da yoksa fallback. fallback ve
// overrides değerleri çevrilmiş metinlerdir. Dil değişince yeniden çevrilmesi için çağrı
// () => errorText(res, t('...')) biçiminde fonksiyon olarak verilir.
function errorText (res, fallback, overrides) {
  const data = res && res.data && typeof res.data === 'object' ? res.data : null
  const code = data && typeof data.code === 'string' ? data.code : ''
  if (code && overrides && Object.prototype.hasOwnProperty.call(overrides, code)) return overrides[code]
  if (code && hasText('errors.' + code)) return t('errors.' + code)
  if (data && typeof data.error === 'string' && data.error) return data.error
  if (!res || res.status === 0) return t('net.unreachable')
  return fallback
}

// Genel yardımcılar

function wait (ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function sameId (a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false
  return String(a) === String(b)
}

function codePoints (text) {
  return Array.from(typeof text === 'string' ? text : '')
}

function cpLength (text) {
  return codePoints(text).length
}

function cpSlice (text, max) {
  const cps = codePoints(text)
  return cps.length > max ? cps.slice(0, max).join('') + '...' : cps.join('')
}

function normalizeName (value) {
  let text = String(value || '')
  try {
    text = text.normalize('NFC')
  } catch (err) {
    // normalize yoksa olduğu gibi
  }
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim()
}

function toDate (ts) {
  const date = new Date(typeof ts === 'number' ? ts : Number(ts) || 0)
  return isNaN(date.getTime()) ? new Date(0) : date
}

function sameDay (a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// Tarih, saat ve boyut biçimleri seçili dile göre Intl ile (i18n.js)
function formatClock (ts) {
  return window.I18N.formatTime(toDate(ts).getTime())
}

// Bugünse yalnızca saat, değilse tarih ve saat
function formatShort (ts) {
  const date = toDate(ts)
  if (sameDay(date, new Date())) return formatClock(date.getTime())
  return window.I18N.formatDate(date.getTime(), 'short')
}

function formatLong (ts) {
  return window.I18N.formatDate(toDate(ts).getTime(), 'long')
}

function formatSize (bytes) {
  return window.I18N.formatSize(bytes)
}

function formatNumber (n) {
  return window.I18N.formatNumber(n)
}

function formatPercent (value) {
  return t('common.percent', { value: value })
}

function fileExt (name) {
  const text = String(name || '')
  const dot = text.lastIndexOf('.')
  if (dot <= 0 || dot === text.length - 1) return ''
  return text.slice(dot + 1).toLowerCase()
}

function replaceExt (name, ext) {
  const text = String(name || '')
  const dot = text.lastIndexOf('.')
  const base = dot > 0 ? text.slice(0, dot) : text
  return (base || t('files.photoName')) + '.' + ext
}

function fileKind (name) {
  const ext = fileExt(name)
  const kinds = Object.keys(FILE_KINDS)
  const found = kinds.filter((k) => FILE_KINDS[k].indexOf(ext) !== -1)
  return found.length ? found[0] : 'other'
}

function isExecutable (name) {
  return EXEC_EXT.indexOf(fileExt(name)) !== -1
}

// Dosya adı temizliği (Ek A1). crypto.js sağlıyorsa onunki kullanılır, boş kalan ada
// arayüz dilindeki yedek ad verilir.
function cleanFileName (value) {
  const fallback = t('files.defaultName')
  const e2ee = window.E2EE
  if (e2ee && typeof e2ee.sanitizeFileName === 'function') {
    try {
      return e2ee.sanitizeFileName(String(value || ''), fallback)
    } catch (err) {
      // Yerel yedek kullanılır
    }
  }
  let name = String(value || '')
  try {
    name = name.normalize('NFC')
  } catch (err) {
    // normalize yoksa olduğu gibi
  }
  name = name.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\/\\:*?"<>|]/g, '').replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
  let cps = Array.from(name)
  if (cps.length > 120) {
    const dot = cps.lastIndexOf('.')
    const extLen = dot > 0 ? cps.length - dot : 0
    cps = extLen >= 2 && extLen <= 17 ? cps.slice(0, 120 - extLen).concat(cps.slice(dot)) : cps.slice(0, 120)
  }
  name = cps.join('')
  return name || fallback
}

function avatarClass (userId) {
  const text = String(userId === undefined || userId === null ? '' : userId)
  let n = Number(text)
  if (!isFinite(n) || text === '') {
    n = 0
    codePoints(text).forEach((ch) => {
      n = (n * 31 + ch.codePointAt(0)) % 2147483647
    })
  }
  return 'avatar-c' + (Math.abs(Math.floor(n)) % AVATAR_COLORS)
}

function initial (name) {
  const cps = codePoints(String(name || '?').trim())
  if (!cps.length) return '?'
  try {
    return cps[0].toLocaleUpperCase(window.I18N.locale())
  } catch (err) {
    return cps[0].toUpperCase()
  }
}

function isIos () {
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone () {
  try {
    if (navigator.standalone === true) return true
    return Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  } catch (err) {
    return false
  }
}

function isNarrow () {
  return window.innerWidth < 760
}

function isWide () {
  return window.innerWidth >= 1000
}

function isConnected (node) {
  if (!node) return false
  if (typeof node.isConnected === 'boolean') return node.isConnected
  return document.documentElement.contains(node)
}

function nextFrame (fn) {
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(fn)
  } else {
    setTimeout(fn, 16)
  }
}

function readBlobBytes (blob) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader()
      reader.onload = () => {
        resolve(new Uint8Array(reader.result))
      }
      reader.onerror = () => {
        reject(textError(() => t('attach.readFailed')))
      }
      reader.readAsArrayBuffer(blob)
    } catch (err) {
      reject(err)
    }
  })
}

function cryptoReady () {
  try {
    return Boolean(window.E2EE && typeof window.E2EE.available === 'function' && window.E2EE.available())
  } catch (err) {
    return false
  }
}
