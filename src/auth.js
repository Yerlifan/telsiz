'use strict'

// Kimlik doğrulama yardımcıları (SPEC-V2 3.4): ad ve parola kuralları, scrypt parola karması,
// oturum token'ları, istemci IP'si, kayan pencereli hız sınırlayıcı, kurulum ve davet kodları.
// Bu modül hiçbir şey loglamaz.

const crypto = require('node:crypto')
const net = require('node:net')

const NAME_MIN = 2
const NAME_MAX = 20
const CHANNEL_NAME_MIN = 1
const CHANNEL_NAME_MAX = 30
const SERVER_NAME_MAX = 40
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128
// Temizlikten önce kabul edilen en uzun ham metin (aşırı uzun girdiyle işlemci harcanmasın)
const MAX_RAW_TEXT = 400

const NAME_RE = /^[\p{L}\p{N}_. -]+$/u
const CONTROL_RE = /\p{C}/gu
const SPACE_RE = /\s+/gu

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_CHARS_RE = /^[0-9A-HJKMNP-TV-Z]+$/
const CODE_LENGTH = 10
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const TEMP_LENGTH = 12

const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 32
const SALT_LENGTH = 16
const SCRYPT_MAX_N = 1048576

function codePointLength (text) {
  return Array.from(text).length
}

// NFC, denetim ve biçim karakterlerini silme, boşlukları tekleme ve kırpma
function cleanText (value) {
  if (typeof value !== 'string' || value.length > MAX_RAW_TEXT) return null
  return value.normalize('NFC').replace(CONTROL_RE, '').replace(SPACE_RE, ' ').trim()
}

function cleanPatterned (value, min, max) {
  const text = cleanText(value)
  if (text === null) return null
  const length = codePointLength(text)
  if (length < min || length > max || !NAME_RE.test(text)) return null
  return text
}

// Kullanıcı adı: 2..20 kod noktası, harf, rakam, boşluk, nokta, alt çizgi, kısa çizgi
function cleanName (value) {
  return cleanPatterned(value, NAME_MIN, NAME_MAX)
}

// Kanal adı: ad kurallarıyla aynı temizlik, 1..30 kod noktası
function cleanChannelName (value) {
  return cleanPatterned(value, CHANNEL_NAME_MIN, CHANNEL_NAME_MAX)
}

// Sunucu adı: temizlik sonrası 1..40 kod noktası
function cleanServerName (value) {
  const text = cleanText(value)
  if (text === null) return null
  const length = codePointLength(text)
  if (length < 1 || length > SERVER_NAME_MAX) return null
  return text
}

// Ad karşılaştırma anahtarı (Türkçe büyük/küçük harf kuralları)
function nameKey (name) {
  return String(name).toLocaleLowerCase('tr-TR')
}

function isValidPassword (value) {
  if (typeof value !== 'string' || value.length > PASSWORD_MAX * 2) return false
  const length = codePointLength(value)
  return length >= PASSWORD_MIN && length <= PASSWORD_MAX
}

function passwordBytes (password) {
  return Buffer.from(typeof password === 'string' ? password.normalize('NFC') : '', 'utf8')
}

function scryptAsync (secret, salt, n, r, p) {
  return new Promise((resolve, reject) => {
    const maxmem = 128 * n * r * p + 4 * 1024 * 1024
    crypto.scrypt(secret, salt, KEY_LENGTH, { N: n, r, p, maxmem }, (err, key) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
}

function isPowerOfTwo (n) {
  return Number.isSafeInteger(n) && n >= 2 && (n & (n - 1)) === 0
}

// Biçim: scrypt$N$r$p$tuzB64$karmaB64
async function hashPassword (password, n) {
  if (!isPowerOfTwo(n) || n > SCRYPT_MAX_N) throw new TypeError('hashPassword: N ikinin kuvveti olmalıdır.')
  const salt = crypto.randomBytes(SALT_LENGTH)
  const key = await scryptAsync(passwordBytes(password), salt, n, SCRYPT_R, SCRYPT_P)
  return ['scrypt', n, SCRYPT_R, SCRYPT_P, salt.toString('base64'), key.toString('base64')].join('$')
}

function parseHash (stored) {
  if (typeof stored !== 'string' || stored.length > 512) return null
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!isPowerOfTwo(n) || n > SCRYPT_MAX_N) return null
  if (!Number.isSafeInteger(r) || r < 1 || r > 32) return null
  if (!Number.isSafeInteger(p) || p < 1 || p > 16) return null
  const salt = Buffer.from(parts[4], 'base64')
  const key = Buffer.from(parts[5], 'base64')
  if (salt.length < 8 || key.length !== KEY_LENGTH) return null
  return { n, r, p, salt, key }
}

// Karma geçersizse de aynı maliyette bir hesap yapılır, sonuç false olur.
async function verifyPassword (password, stored) {
  const parsed = parseHash(stored)
  if (!parsed) {
    await scryptAsync(passwordBytes(password), crypto.randomBytes(SALT_LENGTH), 16384, SCRYPT_R, SCRYPT_P)
    return false
  }
  const key = await scryptAsync(passwordBytes(password), parsed.salt, parsed.n, parsed.r, parsed.p)
  const equal = crypto.timingSafeEqual(key, parsed.key)
  return equal && typeof password === 'string'
}

function newToken () {
  return crypto.randomBytes(32).toString('base64url')
}

function hashToken (token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex')
}

function sha256 (text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest()
}

// ---------------------------------------------------------------- istemci IP'si

function normalizeIp (value) {
  let ip = String(value || '').trim().toLowerCase()
  const zone = ip.indexOf('%')
  if (zone !== -1) ip = ip.slice(0, zone)
  if (ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7))) ip = ip.slice(7)
  return ip
}

function isLoopback (ip) {
  return ip === '::1' || (net.isIPv4(ip) && ip.startsWith('127.'))
}

function headerIp (value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '' || text.length > 64 || net.isIP(text) === 0) return null
  return normalizeIp(text)
}

// Soket loopback ise (tünel veya ters vekil) cf-connecting-ip, yoksa x-forwarded-for ilk girdisi.
function clientIp (req) {
  const socket = req && req.socket
  const remote = normalizeIp(socket && socket.remoteAddress ? socket.remoteAddress : '')
  if (isLoopback(remote)) {
    const cf = headerIp(req.headers['cf-connecting-ip'])
    if (cf) return cf
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string') {
      const first = headerIp(forwarded.split(',')[0])
      if (first) return first
    }
  }
  return remote
}

// IPv6 adresleri /64 önekine göre gruplanır (bir bağlantı genellikle bütün bir /64 alır).
function ipv6Prefix (ip) {
  let text = ip
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':')
    const v4 = text.slice(lastColon + 1).split('.').map(Number)
    text = text.slice(0, lastColon + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16)
  }
  const halves = text.split('::')
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length > 1 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length > 1 ? Math.max(0, 8 - head.length - tail.length) : 0
  const groups = head.concat(new Array(fill).fill('0'), tail)
  return groups.slice(0, 4).map((g) => parseInt(g || '0', 16).toString(16)).join(':') + '::/64'
}

function ipKey (ip) {
  if (net.isIPv6(ip)) return ipv6Prefix(ip)
  return ip || 'bilinmiyor'
}

// ---------------------------------------------------------------- hız sınırlayıcı

// Anahtar başına zaman dizisi tutan kayan pencere sayacı.
// consume ve blocked: izin varsa 0, yoksa yeniden denemeden önce beklenecek süre (ms).
class RateLimiter {
  constructor (limit, windowMs, maxKeys) {
    this.limit = limit
    this.windowMs = windowMs
    this.maxKeys = maxKeys || 100000
    this.hits = new Map()
  }

  prune (times, now) {
    let drop = 0
    while (drop < times.length && now - times[drop] >= this.windowMs) drop++
    if (drop > 0) times.splice(0, drop)
  }

  wait (times, now) {
    return Math.max(1, times[0] + this.windowMs - now)
  }

  blocked (key, now) {
    const at = now === undefined ? Date.now() : now
    const times = this.hits.get(key)
    if (!times) return 0
    this.prune(times, at)
    return times.length >= this.limit ? this.wait(times, at) : 0
  }

  hit (key, now) {
    const at = now === undefined ? Date.now() : now
    let times = this.hits.get(key)
    if (!times) {
      if (this.hits.size >= this.maxKeys) {
        this.sweep(at)
        if (this.hits.size >= this.maxKeys) return false
      }
      times = []
      this.hits.set(key, times)
    }
    this.prune(times, at)
    times.push(at)
    if (times.length > this.limit) times.splice(0, times.length - this.limit)
    return true
  }

  consume (key, now) {
    const at = now === undefined ? Date.now() : now
    const wait = this.blocked(key, at)
    if (wait > 0) return wait
    // Anahtar tablosu doluysa (çok sayıda farklı adresten saldırı) yeni anahtar reddedilir
    if (!this.hit(key, at)) return this.windowMs
    return 0
  }

  reset (key) {
    this.hits.delete(key)
  }

  sweep (now) {
    const at = now === undefined ? Date.now() : now
    for (const [key, times] of this.hits) {
      this.prune(times, at)
      if (times.length === 0) this.hits.delete(key)
    }
  }
}

// ---------------------------------------------------------------- kodlar

function randomFrom (alphabet, length) {
  let out = ''
  while (out.length < length) out += alphabet[crypto.randomInt(alphabet.length)]
  return out
}

// 10 karakterlik Crockford base32 kod, XXXXX-XXXXX biçiminde
function generateCode () {
  const raw = randomFrom(CODE_ALPHABET, CODE_LENGTH)
  return raw.slice(0, 5) + '-' + raw.slice(5)
}

// Büyük/küçük harf, boşluk ve tire duyarsız, O→0, I ve L→1. Geçersizse null.
function normalizeCode (value) {
  if (typeof value !== 'string' || value.length > 64) return null
  const text = value.toUpperCase().replace(/[\s-]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (text === '' || !CODE_CHARS_RE.test(text)) return null
  return text
}

function formatCode (normalized) {
  if (normalized.length !== CODE_LENGTH) return normalized
  return normalized.slice(0, 5) + '-' + normalized.slice(5)
}

// expected normalleştirilmiş koddur. Karşılaştırma sabit zamanlıdır.
function codeMatches (input, expected) {
  const given = normalizeCode(input)
  if (typeof expected !== 'string' || expected === '') return false
  const a = sha256(given === null ? '' : given)
  const b = sha256(expected)
  return crypto.timingSafeEqual(a, b) && given !== null
}

function generateTempPassword () {
  return randomFrom(TEMP_ALPHABET, TEMP_LENGTH)
}

module.exports = {
  NAME_MIN,
  NAME_MAX,
  CHANNEL_NAME_MAX,
  SERVER_NAME_MAX,
  PASSWORD_MIN,
  PASSWORD_MAX,
  codePointLength,
  cleanName,
  cleanChannelName,
  cleanServerName,
  nameKey,
  isValidPassword,
  hashPassword,
  verifyPassword,
  parseHash,
  newToken,
  hashToken,
  clientIp,
  ipKey,
  RateLimiter,
  generateCode,
  normalizeCode,
  formatCode,
  codeMatches,
  generateTempPassword
}
