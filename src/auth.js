'use strict'

// Kimlik doğrulama yardımcıları: kullanıcı adı kuralları, istemci anahtar türetme parametreleri
// ve anahtar biçimleri, scrypt karması, oturum token'ları ve cihaz etiketleri, güvenilir ters
// vekil listesi ve istemci IP'si, kayan pencereli hız sınırlayıcı, kurulum ve davet kodları.
// Parola sunucuya hiç gelmez. İstemci paroladan authKey türetir, sunucu yalnızca onun scrypt
// karmasını saklar. Bu modül hiçbir şey loglamaz.

const crypto = require('node:crypto')
const net = require('node:net')

const NAME_MIN = 2
const NAME_MAX = 32
const CHANNEL_NAME_MIN = 1
const CHANNEL_NAME_MAX = 30
const SERVER_NAME_MAX = 40
const ROLE_NAME_MAX = 24
// Frekans tanıtımı (giriş yapmamış ziyaretçilerin de gördüğü düz metin): kod noktası ve satır sınırı
const ABOUT_MAX = 600
const ABOUT_MAX_LINES = 6
const ABOUT_MAX_RAW = 4000
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128
// Temizlikten önce kabul edilen en uzun ham metin (aşırı uzun girdiyle işlemci harcanmasın)
const MAX_RAW_TEXT = 400

const NAME_RE = /^[\p{L}\p{N}_. -]+$/u
// Kullanıcı adı: küçük İngilizce harf, rakam, alt çizgi ve nokta
const USERNAME_RE = /^[a-z0-9_.]{2,32}$/
const UPPER_ASCII_RE = /[A-Z]+/g
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

// İstemci türetmesi: sunucunun kabul ettiği parametreler
const KDF_N_VALUES = Object.freeze([16384, 32768, 65536])
// Yeni hesapların ve parola değişikliklerinin türetme gücü (istemci public/crypto.js ile aynı). Var olmayan hesap
// için ön girişin sahte ayarı ve geçici parolalar da bunu kullanır. Eski hesaplar girişten sonra yükseltilir.
const KDF_DEFAULT_N = 65536
const KDF_R = 8
const KDF_P = 1
const KDF_SALT_BYTES = 16
const AUTH_KEY_RE = /^[0-9a-f]{64}$/
const AUTH_DOMAIN = 'telsiz-auth-v1'
const B64URL_RE = /^[A-Za-z0-9_-]+$/
const PUBLIC_KEY_BYTES = 32
const WRAPPED_KEY_RE = /^1w\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{60,70}$/

// Güvenilir vekil listesi ve X-Forwarded-For için üst sınırlar
const MAX_PROXY_ENTRIES = 64
const MAX_FORWARDED_CHARS = 2048
// Oturum etiketi: User-Agent'ın yalnızca bu kadarı incelenir, etiket en fazla 60 karakterdir
const UA_MAX_CHARS = 512
const SESSION_LABEL_MAX = 60

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

// Kullanıcı adı: 2..32 karakter, yalnızca a-z, 0-9, alt çizgi ve nokta, nokta ile
// başlayamaz ve bitemez, iki nokta yan yana gelemez. İngilizce büyük harfler küçültülür
// (yerel ayara bakılmaz), başka hiçbir dönüşüm yapılmaz. Geçersizse null.
function cleanUsername (value) {
  if (typeof value !== 'string' || value.length > 64) return null
  const name = value.replace(UPPER_ASCII_RE, (part) => part.toLowerCase())
  if (!USERNAME_RE.test(name)) return null
  if (name.startsWith('.') || name.endsWith('.') || name.includes('..')) return null
  return name
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

// Özel rol adı: temizlik sonrası 1..24 kod noktası
function cleanRoleName (value) {
  const text = cleanText(value)
  if (text === null) return null
  const length = codePointLength(text)
  if (length < 1 || length > ROLE_NAME_MAX) return null
  return text
}

// Frekans tanıtımı: NFC, satır sonları \n olur, her satırda denetim ve biçim karakterleri silinir,
// boşluklar teklenir ve kırpılır, art arda boş satırlar teke iner, baştaki ve sondaki boş satırlar
// atılır. Boş metin geçerlidir (tanıtım kaldırılır). En fazla 600 kod noktası ve 6 satır, aşılırsa null.
function cleanAbout (value) {
  if (typeof value !== 'string' || value.length > ABOUT_MAX_RAW) return null
  const lines = value.normalize('NFC').split(/\r\n|\r|\n/).map((line) => line.replace(CONTROL_RE, '').replace(SPACE_RE, ' ').trim())
  const kept = []
  for (const line of lines) {
    if (line === '' && (kept.length === 0 || kept[kept.length - 1] === '')) continue
    kept.push(line)
  }
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop()
  if (kept.length > ABOUT_MAX_LINES) return null
  const text = kept.join('\n')
  if (codePointLength(text) > ABOUT_MAX) return null
  return text
}

// Ad karşılaştırma anahtarı (Türkçe büyük/küçük harf kuralları)
function nameKey (name) {
  return String(name).toLocaleLowerCase('tr-TR')
}

// Dolgusuz base64url dizgesi tam olarak verilen sayıda bayt taşıyorsa ve kanonik biçimdeyse true
function isB64urlBytes (value, bytes) {
  if (typeof value !== 'string' || value.length !== Math.ceil(bytes * 4 / 3) || !B64URL_RE.test(value)) return false
  const decoded = Buffer.from(value, 'base64url')
  return decoded.length === bytes && decoded.toString('base64url') === value
}

function isAuthKey (value) {
  return typeof value === 'string' && AUTH_KEY_RE.test(value)
}

// Türetme ayarları: { salt: b64url(16 bayt), N: 16384 | 32768 | 65536, r: 8, p: 1 }. Temiz kopya veya null.
function cleanKdf (value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (!isB64urlBytes(value.salt, KDF_SALT_BYTES)) return null
  if (!KDF_N_VALUES.includes(value.N) || value.r !== KDF_R || value.p !== KDF_P) return null
  return { salt: value.salt, N: value.N, r: KDF_R, p: KDF_P }
}

// X25519 açık anahtarı: 32 bayt, dolgusuz base64url (43 karakter)
function isPublicKey (value) {
  return isB64urlBytes(value, PUBLIC_KEY_BYTES)
}

// Parolayla sarılmış özel anahtar: '1w.' + b64url(nonce) + '.' + b64url(secretbox)
function isWrappedKey (value) {
  return typeof value === 'string' && WRAPPED_KEY_RE.test(value)
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
  if (!isPowerOfTwo(n) || n > SCRYPT_MAX_N) throw new TypeError('hashPassword: N must be a power of two.')
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

// İstemcinin yaptığı türetmenin Node karşılığı:
// master = scrypt(utf8(NFC(parola)), tuz, N, r=8, p=1, 32 bayt)
// authKey = hex(SHA512(utf8('telsiz-auth-v1') ‖ master) ilk 32 bayt)
// Sarma anahtarı burada hiç hesaplanmaz.
async function deriveAuthKey (password, salt, n) {
  if (!KDF_N_VALUES.includes(n)) throw new TypeError('deriveAuthKey: unsupported N.')
  if (!Buffer.isBuffer(salt) || salt.length !== KDF_SALT_BYTES) throw new TypeError('deriveAuthKey: the salt must be 16 bytes.')
  const master = await scryptAsync(passwordBytes(password), salt, n, KDF_R, KDF_P)
  const digest = crypto.createHash('sha512').update(Buffer.from(AUTH_DOMAIN, 'utf8')).update(master).digest()
  master.fill(0)
  return digest.subarray(0, KEY_LENGTH).toString('hex')
}

// Sahibin veya komut satırının parola sıfırlaması için geçici parola ve yeni kimlik bilgileri.
// İstemci geçici parolayla giriş yaparken aynı türetmeyi yapar ve aynı authKey'i bulur.
// serverN: sunucunun authKey'i saklarken kullandığı scrypt N değeri.
async function newCredentials (serverN) {
  const tempPassword = generateTempPassword()
  const salt = crypto.randomBytes(KDF_SALT_BYTES)
  const authKey = await deriveAuthKey(tempPassword, salt, KDF_DEFAULT_N)
  const passHash = await hashPassword(authKey, serverN)
  return {
    tempPassword,
    kdf: { salt: salt.toString('base64url'), N: KDF_DEFAULT_N, r: KDF_R, p: KDF_P },
    passHash
  }
}

// Var olmayan kullanıcı için ön giriş tuzu: HMAC-SHA256(sunucuSırrı, 'prelogin:' + ad) ilk 16 bayt.
// Aynı ad için her zaman aynıdır, böylece var olan ve olmayan hesaplar ayırt edilemez.
function preloginSalt (secretHex, name) {
  const mac = crypto.createHmac('sha256', Buffer.from(secretHex, 'hex')).update('prelogin:' + name, 'utf8').digest()
  return mac.subarray(0, KDF_SALT_BYTES).toString('base64url')
}

// Var olmayan hesabın sahte türetme ayarı. Önceki sürümlerde oluşturulan ve henüz yükseltilmemiş hesaplar
// KDF_LEGACY_N kullanır: ad başına sabit bir sayı, sunucudaki eski ayarlı hesapların payının altındaysa sahte ayar
// da eski N ve ona ait tuzu taşır. Böylece ön giriş yanıtının N değeri hesabın varlığını ele vermez. Pay düştükçe
// bazı sahte ayarlar yeni N'ye ve yeni tuza geçer, bu da gerçek bir hesabın yükseltilmesiyle aynı görünür.
const KDF_LEGACY_N = 16384
function preloginKdf (secretHex, name, legacyShare) {
  const pick = crypto.createHmac('sha256', Buffer.from(secretHex, 'hex')).update('prelogin-n:' + name, 'utf8').digest().readUInt32BE(0) / 4294967296
  const legacy = pick < legacyShare
  return { salt: preloginSalt(secretHex, legacy ? name + '\u0000eski' : name), N: legacy ? KDF_LEGACY_N : KDF_DEFAULT_N, r: KDF_R, p: KDF_P }
}

// Giriş cihazı işareti: başarılı girişte verilir, '<kimlik>.<HMAC>' biçimindedir. Parola veya oturum
// yerine geçmez, yalnızca hesap başına başarısız giriş sınırı dolduğunda daha önce giriş yapmış cihazın
// denemeye devam edebilmesini sağlar (ad bilen birinin hesabı kilitlemesi engellenir).
// epoch hesabın parola karmasıdır: parola değişince veya sıfırlanınca (her seferinde yeni tuz) önceki
// bütün işaretler geçersiz olur. Böylece parolayı bir zamanlar bilen biri biriktirdiği işaretlerle yeni
// parolayı hesap başına sınırın ötesinde deneyemez.
const LOGIN_DEVICE_RE = /^([0-9a-f]{24})\.([A-Za-z0-9_-]{43})$/

function loginDeviceMac (secretHex, userId, epoch, id) {
  return crypto.createHmac('sha256', Buffer.from(secretHex, 'hex')).update('login-device:' + userId + ':' + id + ':' + String(epoch), 'utf8').digest('base64url')
}

function newLoginDevice (secretHex, userId, epoch) {
  const id = crypto.randomBytes(12).toString('hex')
  return id + '.' + loginDeviceMac(secretHex, userId, epoch, id)
}

// Geçerli işaretin kimliği, değilse null. Karşılaştırma sabit zamanlıdır.
function loginDeviceId (secretHex, userId, epoch, value) {
  if (typeof value !== 'string' || value.length > 80) return null
  const match = LOGIN_DEVICE_RE.exec(value)
  if (!match) return null
  const expected = Buffer.from(loginDeviceMac(secretHex, userId, epoch, match[1]), 'utf8')
  const given = Buffer.from(match[2], 'utf8')
  return given.length === expected.length && crypto.timingSafeEqual(given, expected) ? match[1] : null
}

function newServerSecret () {
  return crypto.randomBytes(32).toString('hex')
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

// ---------------------------------------------------------------- oturum etiketi

// Sıra önemlidir: daha özel eşleşmeler önce gelir
const UA_DEVICES = [
  { re: /PlayStation 5/, label: 'PlayStation 5' },
  { re: /PlayStation 4/, label: 'PlayStation 4' },
  { re: /PlayStation/, label: 'PlayStation' },
  { re: /Nintendo Switch/, label: 'Nintendo Switch' }
]
const UA_SYSTEMS = [
  { re: /iPad/, label: 'iPad' },
  { re: /iPhone|iPod/, label: 'iPhone' },
  { re: /Android/, label: 'Android' },
  { re: /CrOS/, label: 'ChromeOS' },
  { re: /Xbox/, label: 'Xbox' },
  { re: /Windows/, label: 'Windows' },
  { re: /Macintosh|Mac OS X/, label: 'macOS' },
  { re: /Linux|X11/, label: 'Linux' }
]
const UA_BROWSERS = [
  { re: /Edg(e|A|iOS)?\//, label: 'Edge' },
  { re: /OPR\/|OPT\/|Opera/, label: 'Opera' },
  { re: /SamsungBrowser\//, label: 'Samsung Internet' },
  { re: /YaBrowser\//, label: 'Yandex' },
  { re: /Firefox\/|FxiOS\//, label: 'Firefox' },
  { re: /Chrome\/|CriOS\/|Chromium\//, label: 'Chrome' },
  { re: /Version\/[\d.]+.*Safari\//, label: 'Safari' }
]

function firstMatch (table, text) {
  for (const entry of table) {
    if (entry.re.test(text)) return entry.label
  }
  return null
}

// User-Agent'tan dil bağımsız kısa cihaz etiketi (ör. "Chrome, Windows", "Safari, iPhone",
// "PlayStation 5"). Tanınmazsa null döner, istemci kendi dilinde "Bilinmeyen cihaz" gösterir.
// User-Agent'ın kendisi hiçbir yerde saklanmaz.
function sessionLabel (userAgent) {
  if (typeof userAgent !== 'string' || userAgent === '') return null
  const ua = userAgent.slice(0, UA_MAX_CHARS)
  const device = firstMatch(UA_DEVICES, ua)
  if (device !== null) return device
  const parts = [firstMatch(UA_BROWSERS, ua), firstMatch(UA_SYSTEMS, ua)].filter((part) => part !== null)
  if (parts.length === 0) return null
  return parts.join(', ').slice(0, SESSION_LABEL_MAX)
}

// Diskten okunan oturum etiketinin geçerli olup olmadığı
function isSessionLabel (value) {
  return typeof value === 'string' && value !== '' && value.length <= SESSION_LABEL_MAX && !/[\u0000-\u001f\u007f]/.test(value)
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

// Güvenilir ters vekil listesi: 'loopback' (127.0.0.0/8 ve ::1), 'none' (hiçbiri), IP adresleri
// ve CIDR aralıkları (ör. 10.0.0.0/8, fd00::/8). Virgülle ayrılmış metin veya dizi kabul edilir.
// Geçerliyse temizlenmiş girdi dizisi, değilse null döner. Boş girdi varsayılan ['loopback'] olur.
function parseTrustedProxies (value) {
  let list
  if (Array.isArray(value)) list = value
  else if (typeof value === 'string') list = value.split(',')
  else return null
  if (list.length > MAX_PROXY_ENTRIES) return null
  const out = []
  for (const raw of list) {
    if (typeof raw !== 'string') return null
    const entry = raw.trim().toLowerCase()
    if (entry === '') continue
    if (entry === 'loopback' || entry === 'none') {
      out.push(entry)
      continue
    }
    const slash = entry.indexOf('/')
    const address = normalizeIp(slash === -1 ? entry : entry.slice(0, slash))
    const family = net.isIP(address)
    if (family === 0) return null
    if (slash === -1) {
      out.push(address)
      continue
    }
    const bitsText = entry.slice(slash + 1)
    const bits = /^\d{1,3}$/.test(bitsText) ? Number(bitsText) : -1
    if (bits < 0 || bits > (family === 4 ? 32 : 128)) return null
    out.push(address + '/' + bits)
  }
  if (out.length === 0) return ['loopback']
  if (out.includes('none') && out.length > 1) return null
  return out
}

// Ayrıştırılmış listeden adres denetleyicisi: (ip) => boolean
function trustPolicy (entries) {
  const list = parseTrustedProxies(entries)
  if (list === null) throw new TypeError('trustPolicy: invalid trusted proxy list.')
  const block = new net.BlockList()
  for (const entry of list) {
    if (entry === 'none') continue
    if (entry === 'loopback') {
      block.addSubnet('127.0.0.0', 8, 'ipv4')
      block.addAddress('::1', 'ipv6')
      continue
    }
    const slash = entry.indexOf('/')
    const address = slash === -1 ? entry : entry.slice(0, slash)
    const type = net.isIPv4(address) ? 'ipv4' : 'ipv6'
    if (slash === -1) block.addAddress(address, type)
    else block.addSubnet(address, Number(entry.slice(slash + 1)), type)
  }
  return (ip) => {
    const address = normalizeIp(ip)
    const family = net.isIP(address)
    if (family === 0) return false
    return block.check(address, family === 4 ? 'ipv4' : 'ipv6')
  }
}

// İstemci IP'si. Bağlantı güvenilir bir vekilden gelmiyorsa soket adresi kullanılır, başlıklara
// bakılmaz. Geliyorsa X-Forwarded-For sağdan sola okunur ve güvenilir olmayan ilk adres alınır
// (istemcinin kendi eklediği sahte girdiler solda kalır). Bozuk bir girdiye rastlanırsa daha
// solundakilere güvenilmez. X-Forwarded-For kullanılamıyorsa CF-Connecting-IP, o da yoksa soket adresi.
// trusts verilmezse yalnızca loopback güvenilirdir.
function clientIp (req, trusts) {
  const socket = req && req.socket
  const remote = normalizeIp(socket && socket.remoteAddress ? socket.remoteAddress : '')
  const isTrusted = typeof trusts === 'function' ? trusts : isLoopback
  if (!isTrusted(remote)) return remote
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') {
    // Çok uzun başlığın yalnızca sonu okunur (gerçek adres sağdadır). Kesilen ilk parça
    // geçerli ama yanlış bir adres gibi görünebileceği için atılır.
    const truncated = forwarded.length > MAX_FORWARDED_CHARS
    const parts = (truncated ? forwarded.slice(-MAX_FORWARDED_CHARS) : forwarded).split(',')
    if (truncated) parts.shift()
    let i = parts.length - 1
    let leftmost = null
    while (i >= 0) {
      const ip = headerIp(parts[i])
      if (ip === null) break
      if (!isTrusted(ip)) return ip
      leftmost = ip
      i--
    }
    // Zincirdeki tüm adresler güvenilir vekillerse en soldaki istemcidir
    if (i < 0 && leftmost !== null && !truncated) return leftmost
  }
  const cf = headerIp(req.headers['cf-connecting-ip'])
  if (cf) return cf
  return remote
}

// Yerel ağ adresleri: loopback, özel IPv4 blokları, bağlantı yerel ve benzersiz yerel IPv6 adresleri
const LOCAL_NETS = new net.BlockList()
LOCAL_NETS.addSubnet('127.0.0.0', 8, 'ipv4')
LOCAL_NETS.addSubnet('10.0.0.0', 8, 'ipv4')
LOCAL_NETS.addSubnet('172.16.0.0', 12, 'ipv4')
LOCAL_NETS.addSubnet('192.168.0.0', 16, 'ipv4')
LOCAL_NETS.addSubnet('169.254.0.0', 16, 'ipv4')
LOCAL_NETS.addAddress('::1', 'ipv6')
LOCAL_NETS.addSubnet('fc00::', 7, 'ipv6')
LOCAL_NETS.addSubnet('fe80::', 10, 'ipv6')

// Yönlendirme başlığı taşıyan bir istek güvenilir listede olmayan yerel bir adresten geliyorsa
// o adresi, gelmiyorsa null döndürür. Bu durum neredeyse her zaman GUVENILIR_VEKIL ayarının
// eksik olduğunu gösterir (ör. kapsayıcıda ters vekil bağlantıları Docker ağ geçidinden gelir)
// ve bütün istemciler tek bir IP adresinden geliyormuş gibi sayılır.
function untrustedLocalForwarder (req, trusts) {
  if (!req || !req.headers) return null
  const headers = req.headers
  if (typeof headers['x-forwarded-for'] !== 'string' && typeof headers['cf-connecting-ip'] !== 'string') return null
  const socket = req.socket
  const remote = normalizeIp(socket && socket.remoteAddress ? socket.remoteAddress : '')
  const family = net.isIP(remote)
  if (family === 0) return null
  const isTrusted = typeof trusts === 'function' ? trusts : isLoopback
  if (isTrusted(remote)) return null
  return LOCAL_NETS.check(remote, family === 4 ? 'ipv4' : 'ipv6') ? remote : null
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
  return ip || 'unknown'
}

// ---------------------------------------------------------------- hız sınırlayıcı

// Anahtar başına zaman dizisi tutan kayan pencere sayacı.
// consume ve blocked: izin varsa 0, yoksa yeniden denemeden önce beklenecek süre (ms).
// Tablo doluyken düşürülecek anahtar aranırken bakılan en eski anahtar sayısı (RateLimiter.evict)
const EVICT_SCAN = 64

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

  // Anahtarlar son kullanım sırasıyla tutulur. Tablo doluysa en uzun süredir kullanılmayan anahtar
  // düşürülür: çok sayıda farklı adresten gelen istekler tabloyu doldurup yeni istemcileri kilitleyemez.
  // O an sınırda olan (engelleyen) anahtarlar öncelikle korunur: en eski EVICT_SCAN anahtar içinden süresi dolmuş
  // veya sınırda olmayan ilk anahtar seçilir, hepsi sınırdaysa en eskisi düşer. Bu, sınırın hemen altında tutulan bir
  // sayacı korumaz: var olan hesapların sayaçları bu yüzden hiç düşürmeyen ayrı tablolardadır (src/app.js
  // accountNameLimiter, accountFailLimiter).
  evict (now) {
    let scanned = 0
    let victim = null
    for (const [key, times] of this.hits) {
      if (victim === null) victim = key
      this.prune(times, now)
      if (times.length < this.limit) {
        victim = key
        break
      }
      scanned++
      if (scanned >= EVICT_SCAN) break
    }
    if (victim !== null) this.hits.delete(victim)
  }

  hit (key, now) {
    const at = now === undefined ? Date.now() : now
    let times = this.hits.get(key)
    if (times) {
      this.hits.delete(key)
    } else {
      if (this.hits.size >= this.maxKeys) this.evict(at)
      times = []
    }
    this.hits.set(key, times)
    this.prune(times, at)
    times.push(at)
    if (times.length > this.limit) times.splice(0, times.length - this.limit)
    return true
  }

  consume (key, now) {
    const at = now === undefined ? Date.now() : now
    const wait = this.blocked(key, at)
    if (wait > 0) return wait
    this.hit(key, at)
    return 0
  }

  reset (key) {
    this.hits.delete(key)
  }

  // Öneki verilen bütün anahtarları siler (ör. bir hesabın adres başına sayaçları)
  resetPrefix (prefix) {
    for (const key of this.hits.keys()) {
      if (key.startsWith(prefix)) this.hits.delete(key)
    }
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
  ROLE_NAME_MAX,
  ABOUT_MAX,
  ABOUT_MAX_LINES,
  PASSWORD_MIN,
  PASSWORD_MAX,
  KDF_N_VALUES,
  KDF_DEFAULT_N,
  codePointLength,
  cleanUsername,
  cleanChannelName,
  cleanServerName,
  cleanRoleName,
  cleanAbout,
  nameKey,
  isAuthKey,
  cleanKdf,
  isPublicKey,
  isWrappedKey,
  deriveAuthKey,
  newCredentials,
  preloginSalt,
  preloginKdf,
  newLoginDevice,
  loginDeviceId,
  newServerSecret,
  hashPassword,
  verifyPassword,
  parseHash,
  newToken,
  hashToken,
  sessionLabel,
  isSessionLabel,
  parseTrustedProxies,
  trustPolicy,
  clientIp,
  untrustedLocalForwarder,
  ipKey,
  RateLimiter,
  generateCode,
  normalizeCode,
  formatCode,
  codeMatches,
  generateTempPassword
}
